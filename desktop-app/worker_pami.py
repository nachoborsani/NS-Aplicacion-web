# -*- coding: utf-8 -*-
"""Worker de la PC para la cola de tareas de la web NS.

Escucha las tareas que encola la web (heartbeat/next), las corre en PAMI y reporta
el resultado (log/complete). Es el puente que le falta a la cabina para que los
botones "Auditar" y "Subir" funcionen: la web (Railway) no llega a PAMI, la PC sí.

Tipos de tarea:
  - healthcheck        : prueba (responde "vivo").
  - auditar-informes   : verifica en PAMI qué informes están cargados/transmitidos.
  - subir-informes     : adjunta el informe a la OME en PAMI (upload real + transmite).
  - liberar-cupo       : cancela aceptaciones de OMEs no validadas para liberar cupo.
  - crear-ome          : genera una OME especialista con credenciales del médico.
  - crear-informe-cabecera : completa y guarda el informe CUP de médico de cabecera.

Auth: el token de la cola lo obtiene logueado como admin (/api/admin/worker/token);
los datos (informes, clave PAMI, archivos) los saca con la sesión admin.

USO (dejarlo corriendo en la PC, o como tarea de Windows):
    python worker_pami.py
"""
from __future__ import annotations

import csv
import dataclasses
import http.client
import json
import platform
import socket
import tempfile
import time
import traceback
import urllib.parse
from pathlib import Path

from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config
from pami_documentacion import PamiDocumentacionController

POLL_SEG = 5
WORKER_ID = (socket.gethostname() or "pc-ns")[:60]


def log(m: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


def _split(base: str):
    u = urllib.parse.urlsplit(base.rstrip("/"))
    return u.hostname, (u.port or (443 if u.scheme == "https" else 80)), u.scheme == "https"


class Cola:
    """Cliente HTTP de la cola de tareas (auth por token bearer)."""

    def __init__(self, base: str, token: str):
        self.base = base.rstrip("/")
        self.token = token
        self.host, self.port, self.https = _split(self.base)

    def _req(self, method: str, path: str, body=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Authorization": f"Bearer {self.token}"}
        if data:
            headers["Content-Type"] = "application/json"
        conn = (http.client.HTTPSConnection if self.https else http.client.HTTPConnection)(self.host, self.port, timeout=30)
        try:
            conn.request(method, path, body=data, headers=headers)
            r = conn.getresponse()
            txt = r.read().decode("utf-8") or "{}"
            return json.loads(txt) if txt[:1] in "{[" else {}
        finally:
            conn.close()

    def heartbeat(self, status="online", message=""):
        try:
            self._req("POST", "/api/worker/heartbeat", {
                "workerId": WORKER_ID, "hostname": WORKER_ID,
                "platform": platform.platform()[:100], "status": status, "message": message[:400],
            })
        except Exception as e:  # noqa: BLE001
            log(f"heartbeat falló: {e}")

    def proxima(self):
        try:
            return self._req("GET", f"/api/worker/tasks/next?workerId={urllib.parse.quote(WORKER_ID)}").get("task")
        except Exception:  # noqa: BLE001
            return None

    def tlog(self, tid, m, level="info"):
        try:
            self._req("POST", f"/api/worker/tasks/{urllib.parse.quote(tid)}/log", {"level": level, "message": str(m)[:500]})
        except Exception:  # noqa: BLE001
            pass

    def completar(self, tid, ok=True, error="", result=None):
        try:
            self._req("POST", f"/api/worker/tasks/{urllib.parse.quote(tid)}/complete",
                      {"ok": ok, "error": str(error)[:900], "result": result})
        except Exception:  # noqa: BLE001
            pass

    def captura(self, tid, png_b64, ome="", estado="", motivo=""):
        """Sube a la web la captura de pantalla del error (para verla sin la PC)."""
        try:
            r = self._req("POST", f"/api/worker/tasks/{urllib.parse.quote(tid)}/captura",
                          {"pngB64": png_b64, "ome": str(ome)[:40], "estado": str(estado)[:40], "motivo": str(motivo)[:300]})
            return bool(r and r.get("ok"))
        except Exception:  # noqa: BLE001
            return False


# --- Datos desde la web (sesión admin) -------------------------------------
def _informes(web, slug, ids):
    data = web._request("GET", f"/api/clientes/{slug}/informes")
    items = data.get("items", []) if isinstance(data, dict) else []
    idset = set(ids or [])
    return [it for it in items if (not idset or it.get("id") in idset)]


def _ome_de(it):
    omes = _omes_de(it)
    return omes[0] if omes else ""


def _omes_de(it):
    """OMEs a las que va este informe. Un informe puede cubrir varias (otorrino:
    otomicroscopía + rinomanometría) → se sube el mismo archivo a cada una."""
    r = it.get("resuelto") or {}
    if r.get("omes"):
        return [str(o) for o in r["omes"] if o]
    if r.get("ome"):
        return [str(r["ome"])]
    m = str((it.get("match") or {}).get("ome") or "")
    return [m] if m else []


def _creds(web, slug):
    cred = web.client_pami(slug)
    return str(cred.get("pamiUser", "")).strip(), str(cred.get("pamiPassword", "") or "")


def _medico_creds(web, slug, medico_id):
    cred = web.client_medico_pami(slug, medico_id)
    return {
        "nombre": str(cred.get("nombre", "") or "").strip(),
        "especialidad": str(cred.get("especialidad", "") or "").strip(),
        "usuario": str(cred.get("usuario", "") or "").strip(),
        "clave": str(cred.get("clave", "") or ""),
    }


def _descargar_archivo(web, slug, informe_id, dest: Path):
    """Baja el archivo original del informe con la cookie de la sesión admin.
    Reintenta ante 5xx pasajeros (deploy / gateway) y cortes de conexión."""
    host, port, https = _split(web.base_url)
    headers = {"Cookie": web._cookie} if getattr(web, "_cookie", "") else {}
    last = ""
    for intento in range(3):
        conn = (http.client.HTTPSConnection if https else http.client.HTTPConnection)(host, port, timeout=60)
        try:
            conn.request("GET", f"/api/clientes/{slug}/informes/{informe_id}/archivo", headers=headers)
            r = conn.getresponse()
            body = r.read()
            if r.status >= 500:
                last = f"HTTP {r.status} al bajar el archivo"
                if intento < 2:
                    time.sleep(0.8 * (intento + 1)); continue
                raise RuntimeError(last)
            if r.status != 200:
                raise RuntimeError(f"HTTP {r.status} al bajar el archivo")
            dest.write_bytes(body)
            return
        except (ConnectionResetError, http.client.IncompleteRead) as exc:
            last = str(exc)
            if intento < 2:
                time.sleep(0.8 * (intento + 1)); continue
            raise RuntimeError(f"No pude bajar el archivo: {last}")
        finally:
            conn.close()


# --- Tareas ----------------------------------------------------------------
def tarea_auditar(web, slug, payload, tlog):
    from auditar_informes_enviados_pami import auditar_filas
    infos = _informes(web, slug, payload.get("informeIds"))
    user, clave = _creds(web, slug)
    if not user or not clave:
        raise RuntimeError("El cliente no tiene usuario/clave PAMI cargados en la web.")
    filas = []
    for it in infos:
        ex = it.get("extract") or {}
        p = (it.get("match") or {}).get("prestacion") or {}
        for ome in (_omes_de(it) or [""]):  # una fila por OME (el informe puede cubrir varias)
            filas.append({
                "beneficio": p.get("beneficio") or ex.get("beneficio") or "",
                "paciente": ex.get("nombre", ""), "dni": ex.get("dni", ""),
                "practica": ex.get("practica", ""), "turno": "", "ome": ome, "id": it.get("id"),
            })
    tlog(f"Verificando {len(filas)} informe(s) en PAMI…")
    res = auditar_filas(filas, usuario=user, clave=clave, headless=True)
    con_doc = sum(1 for r in res if r.get("documentacion_cargada") == "SI")
    detalle = []
    for f, r in zip(filas, res):
        tlog(f"{(r.get('paciente') or '')[:22]:22} OME {r.get('ome') or '-'} → doc={r.get('documentacion_cargada')} trans={r.get('transmitida')}")
        detalle.append({"id": f.get("id"), "paciente": r.get("paciente"), "ome": r.get("ome"),
                        "doc": r.get("documentacion_cargada"), "trans": r.get("transmitida"), "estado": r.get("estado_pami")})
    return {"total": len(res), "con_doc": con_doc, "detalle": detalle}


def tarea_subir(web, slug, payload, tlog, cola=None, tid=None):
    infos = _informes(web, slug, payload.get("informeIds"))
    user, clave = _creds(web, slug)
    if not user or not clave:
        raise RuntimeError("El cliente no tiene usuario/clave PAMI cargados en la web.")
    tmp = Path(tempfile.mkdtemp(prefix="ns_subir_"))
    items = []
    for it in infos:
        omes = _omes_de(it)
        if not omes:
            tlog(f"{it.get('filename','')[:24]} sin OME → salteado")
            continue
        ex = it.get("extract") or {}
        p = (it.get("match") or {}).get("prestacion") or {}
        dest = tmp / (it.get("stored") or (str(it.get("id", "")) + str(it.get("ext", ""))))
        try:
            _descargar_archivo(web, slug, it["id"], dest)  # se baja una vez y se sube a cada OME
        except Exception as e:  # noqa: BLE001
            tlog(f"No pude bajar {it.get('filename','')}: {e}")
            continue
        if len(omes) > 1:
            tlog(f"{it.get('filename','')[:24]} cubre {len(omes)} OMEs → se sube a cada una")
        # El turno define el rango de fechas con que el bot filtra el panel de
        # Transmisión. Sin turno, PAMI filtra por defecto (mes actual) y no
        # aparecen las OMEs de meses anteriores → "No se encontró la OME". Lo
        # tomamos del match (prestación de la bandeja) o de la fecha del informe.
        turno = p.get("turno") or ex.get("fecha") or ""
        for ome in omes:
            items.append({
                "archivo": str(dest), "filename": it.get("filename", ""),
                "prestacion": {"n_orden": ome, "beneficio": p.get("beneficio") or ex.get("beneficio") or "",
                               "nombre": ex.get("nombre", ""), "practica": ex.get("practica", ""),
                               "turno": turno},
            })
    if not items:
        return {"total": 0, "subidos": 0, "detalle": []}
    tlog(f"Subiendo {len(items)} informe(s) a PAMI…")
    ctrl = PamiDocumentacionController(usuario=user, clave=clave,
                                       log_callback=lambda m: tlog(str(m)), status_callback=lambda m: None, headless=True)
    try:
        res = ctrl.cargar_lote(items)
    finally:
        ctrl.cerrar()
    ok = sum(1 for r in res if r.get("estado") in ("transmitido", "ya_transmitido"))
    detalle = []
    subidas = 0
    for r in res:
        ome = (r.get("prestacion") or {}).get("n_orden", "")
        estado = r.get("estado")
        motivo = r.get("motivo", "")
        # Si el bot capturó la pantalla del error, la subimos a la web (máx. 5 por tarea
        # para no abusar) y la sacamos del result (no viaja en 'complete').
        b64 = r.pop("captura_b64", None)
        tiene_captura = False
        if b64 and cola and tid and subidas < 5:
            if cola.captura(tid, b64, ome=ome, estado=estado, motivo=motivo):
                tiene_captura = True
                subidas += 1
        d = {"filename": r.get("filename", ""), "ome": ome, "estado": estado, "motivo": motivo}
        if tiene_captura:
            d["captura"] = True
        tlog(f"{d['filename'][:24]:24} OME {d['ome']} → {d['estado']} ({d['motivo']})")
        detalle.append(d)
    return {"total": len(items), "subidos": ok, "detalle": detalle}


def tarea_plan_salud_benef(web, slug, payload, tlog):
    """Busca en PAMI el beneficio por DNI (padrón autenticado) con el login de un
    cliente (ej. Dubesarky), para completar la planilla de Plan Salud. Solo BUSCA
    y devuelve resultados; la escritura la decide la web. No crea nada en PAMI."""
    import asyncio
    from pami_ome_generator import PamiOmeGenerator, PatientInput

    login_slug = str(payload.get("loginSlug") or "").strip()
    if not login_slug:
        raise RuntimeError("Falta el cliente cuyo login PAMI usar (loginSlug).")
    cred = web.client_pami(login_slug)
    user = str((cred or {}).get("pamiUser", "")).strip()
    clave = str((cred or {}).get("pamiPassword", "") or "")
    if not user or not clave:
        raise RuntimeError(f"El cliente {login_slug} no tiene usuario/clave PAMI cargados en la web.")
    items = payload.get("items") or []
    resultados = []

    async def _run():
        async with PamiOmeGenerator(user=user, password=clave, headless=True) as gen:
            for i, it in enumerate(items, 1):
                dni = "".join(ch for ch in str(it.get("dni", "") or "") if ch.isdigit())
                fila = it.get("fila")
                nombre = str(it.get("nombre", "") or "")
                if not dni:
                    resultados.append({"fila": fila, "dni": "", "beneficio": "", "nombre": nombre, "resultado": "SIN_DNI"})
                    continue
                tlog(f"[{i}/{len(items)}] fila {fila} · {nombre} · DNI {dni} …")
                try:
                    res = await gen.process_patient(PatientInput(
                        modo="DNI", afiliado=dni, diagnostico="", practica="",
                        dni=dni, nombre=nombre, completar_benef=True,
                    ))
                    benef = str(getattr(res, "beneficio", "") or "").strip()
                    resultados.append({
                        "fila": fila, "dni": dni, "beneficio": benef,
                        "nombre": str(getattr(res, "nombre", "") or "") or nombre,
                        "resultado": str(getattr(res, "resultado", "") or ""),
                    })
                    tlog(f"    {benef or 'no encontrado'}")
                except Exception as e:  # noqa: BLE001
                    resultados.append({"fila": fila, "dni": dni, "beneficio": "", "nombre": nombre, "resultado": f"ERROR: {str(e)[:120]}"})
                    tlog(f"    error: {e}")

    asyncio.run(_run())
    return {"resultados": resultados}


def tarea_verificar_medicos(web, slug, payload, tlog):
    """Prueba el login a CUP PAMI de uno o varios médicos y devuelve su estado."""
    from pami_ome_generator import verificar_login_sync

    ids = payload.get("medicoIds") or ([payload.get("medicoId")] if payload.get("medicoId") else [])
    ids = [str(x).strip() for x in ids if str(x or "").strip()]
    if not ids:
        raise RuntimeError("No llegaron médicos para verificar.")
    resultados = []
    for mid in ids:
        try:
            cred = _medico_creds(web, slug, mid)
            user, clave, nombre = cred["usuario"], cred["clave"], (cred.get("nombre") or mid)
            if not user or not clave:
                resultados.append({"medicoId": mid, "estado": "inactivo", "detalle": "Sin usuario o clave cargados."})
                tlog(f"{nombre}: sin usuario/clave")
                continue
            tlog(f"Verificando {nombre}…")
            r = verificar_login_sync(user=user, password=clave, headless=True)
            resultados.append({"medicoId": mid, "estado": r.get("estado", "error"), "detalle": r.get("detalle", "")})
            tlog(f"{nombre}: {r.get('estado')}")
        except Exception as exc:  # noqa: BLE001
            resultados.append({"medicoId": mid, "estado": "error", "detalle": str(exc)[:300]})
            tlog(f"{mid}: error {exc}")
    return {"resultados": resultados}


def tarea_crear_ome(web, slug, payload, tlog):
    from pami_ome_generator import run_batch_sync

    # Sin médico llega desde el bot de Telegram, donde la OME la genera un médico
    # de cabecera: es uno solo y deriva a todas las especialidades, así que firma
    # con el usuario de PAMI del propio centro y no hay a quién elegir.
    medico_id = str(payload.get("medicoId", "") or "").strip()
    if medico_id:
        cred = _medico_creds(web, slug, medico_id)
        quien = cred["nombre"] or cred["usuario"]
        falta = "El médico seleccionado no tiene usuario/clave PAMI cargados en la web."
    else:
        cli = web.client_pami(slug) or {}
        cred = {
            "nombre": str(payload.get("medicoNombre", "") or "").strip(),
            "especialidad": "",
            "usuario": str(cli.get("pamiUser", "") or "").strip(),
            "clave": str(cli.get("pamiPassword", "") or ""),
        }
        quien = cred["nombre"] or cred["usuario"]
        falta = "El centro no tiene usuario/clave PAMI cargados en la web."
    user, clave = cred["usuario"], cred["clave"]
    if not user or not clave:
        raise RuntimeError(falta)

    modo = str(payload.get("modo", "") or "").strip().upper()
    beneficio = "".join(ch for ch in str(payload.get("beneficio", "") or "") if ch.isdigit())
    dni = "".join(ch for ch in str(payload.get("dni", "") or "") if ch.isdigit())
    if modo not in {"BENEF", "DNI"}:
        modo = "DNI" if not beneficio and dni else "BENEF"
    afiliado = dni if modo == "DNI" else beneficio
    diagnostico = str(payload.get("diagnostico", "") or "Z000").strip().upper()
    codigo = "".join(ch for ch in str(payload.get("codigo", "") or "") if ch.isdigit())
    practica_desc = str(payload.get("practica", "") or "").strip()
    nombre = str(payload.get("nombre", "") or "").strip()

    if not afiliado:
        raise RuntimeError("Falta BENEF o DNI para generar la OME.")
    if not diagnostico or not codigo:
        raise RuntimeError("Falta diagnóstico o código de práctica.")

    tmp = Path(tempfile.mkdtemp(prefix="ns_crear_ome_"))
    input_path = tmp / "ome_input.csv"
    output_path = tmp / "ome_resultado.csv"
    with input_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["modo", "afiliado", "beneficio", "dni", "nombre", "diagnostico", "practica"])
        writer.writeheader()
        writer.writerow({
            "modo": modo,
            "afiliado": afiliado,
            "beneficio": beneficio,
            "dni": dni,
            "nombre": nombre,
            "diagnostico": diagnostico,
            "practica": codigo,
        })

    tlog(f"Generando OME especialista con {quien or user}.")
    tlog(f"Paciente {nombre or afiliado} · práctica {codigo}{(' - ' + practica_desc) if practica_desc else ''}.")
    summary = run_batch_sync(
        input_path=input_path,
        output_path=output_path,
        user=user,
        password=clave,
        dry_run=False,
        headless=True,
        log_callback=lambda m: tlog(str(m)),
    )

    rows = []
    if output_path.exists():
        with output_path.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
    row = rows[0] if rows else {}
    resultado = str(row.get("resultado") or "").strip()
    nro_ome = str(row.get("nro_ome") or "").strip()
    if nro_ome:
        tlog(f"OME generada: {nro_ome}.")
    else:
        tlog(f"PAMI terminó sin número de OME: {resultado or 'sin resultado'}.")
    return {
        "total": int(summary.get("total", len(rows)) or len(rows)),
        "resultado": resultado,
        "nro_ome": nro_ome,
        "nombre": row.get("nombre") or nombre,
        "practica": practica_desc or codigo,
        "medico": cred["nombre"],
        "row": row,
    }


def _plantilla_informe_cabecera(payload):
    plantilla = payload.get("plantilla") if isinstance(payload.get("plantilla"), dict) else {}
    return {
        "codigo": str(plantilla.get("codigo") or "").strip(),
        "genero": str(plantilla.get("genero") or "").strip(),
        "taMax": str(plantilla.get("taMax") or "140").strip() or "140",
        "taMin": str(plantilla.get("taMin") or "90").strip() or "90",
        "peso": str(plantilla.get("peso") or "86").strip() or "86",
        "motivo": str(plantilla.get("motivo") or "control de salud").strip() or "control de salud",
        "examen": str(plantilla.get("examen") or "no presenta").strip() or "no presenta",
        "diagnostico": str(plantilla.get("diagnostico") or "control de salud").strip() or "control de salud",
        "tratamiento": str(plantilla.get("tratamiento") or "recetas").strip() or "recetas",
    }


def tarea_crear_informe_cabecera(web, slug, payload, tlog):
    """Crea uno o varios informes de cabecera en UNA sola sesión de PAMI.

    La pantalla puede mandar un solo paciente (`item` + `plantilla`) o una tanda
    (`items`: [{item, plantilla}, ...]). La tanda entra acá y no como N tareas
    porque cada tarea abre y cierra el navegador: 59 informes serían 59 logins.
    Reusando la sesión, el login se hace una vez.

    Un paciente que falla no corta la tanda: queda anotado con su motivo y se
    sigue con el resto. Cortar dejaría a medio hacer algo que ya no se sabe por
    dónde iba.
    """
    from pami_informes_cabecera import PamiInformesCabeceraController

    pedidos = payload.get("items")
    if not isinstance(pedidos, list) or not pedidos:
        item = payload.get("item") if isinstance(payload.get("item"), dict) else {}
        if not item:
            raise RuntimeError("No llegó el paciente para crear el informe.")
        pedidos = [{"item": item, "plantilla": payload.get("plantilla")}]

    user, clave = _creds(web, slug)
    if not user or not clave:
        raise RuntimeError("El cliente no tiene usuario/clave PAMI cargados en la web.")

    ctrl = PamiInformesCabeceraController(
        log_callback=lambda m: tlog(str(m)),
        status_callback=lambda m: tlog(str(m)),
        headless=True,
    )
    detalle: list[dict] = []
    guardados = 0
    errores = 0
    try:
        for i, pedido in enumerate(pedidos, start=1):
            item = pedido.get("item") if isinstance(pedido, dict) else {}
            if not isinstance(item, dict):
                item = {}
            ome = "".join(ch for ch in str(item.get("ome") or item.get("n_orden") or "") if ch.isdigit())
            nombre = str(item.get("nombre") or item.get("paciente") or "").strip()
            practica = str(item.get("practica") or "").strip()
            plantilla = _plantilla_informe_cabecera(pedido)
            if not ome:
                errores += 1
                detalle.append({"ome": "", "paciente": nombre, "practica": practica,
                                "plantilla": plantilla.get("codigo", ""),
                                "error": "la fila no tiene número de OME"})
                continue
            if len(pedidos) > 1:
                tlog(f"[{i}/{len(pedidos)}] {nombre or ome} · OME {ome}")
            else:
                tlog(f"Creando informe de cabecera para {nombre or ome} · OME {ome}.")
            if plantilla.get("codigo"):
                tlog(f"Plantilla: {plantilla.get('codigo')}.")
            if practica:
                tlog(f"Práctica: {practica[:120]}")
            try:
                res = ctrl.abrir_y_preparar_informe(
                    usuario=user,
                    clave=clave,
                    item=item,
                    plantilla=plantilla,
                )
                guardados += 1
                detalle.append({"ome": ome, "paciente": nombre, "practica": practica,
                                "plantilla": plantilla.get("codigo", ""),
                                "estado": (res or {}).get("estado") or "guardado"})
            except Exception as exc:  # noqa: BLE001 - uno que falla no corta la tanda
                errores += 1
                motivo = str(exc).strip() or "error al crear el informe"
                tlog(f"ERROR en {nombre or ome}: {motivo}")
                detalle.append({"ome": ome, "paciente": nombre, "practica": practica,
                                "plantilla": plantilla.get("codigo", ""), "error": motivo[:300]})
    finally:
        ctrl.cerrar()

    # Si no se guardó NINGUNO, la tarea es un fracaso y tiene que verse como tal:
    # devolverla como "lista" con 0 hechos se lee como que salió bien.
    if not guardados:
        primero = next((d.get("error") for d in detalle if d.get("error")), "")
        raise RuntimeError(primero or "No se pudo crear ningún informe.")

    primero = detalle[0] if detalle else {}
    return {
        "total": len(pedidos),
        "guardados": guardados,
        "errores": errores,
        "ome": primero.get("ome", ""),
        "paciente": primero.get("paciente", ""),
        "practica": primero.get("practica", ""),
        "plantilla": primero.get("plantilla", ""),
        "detalle": detalle,
    }

def tarea_liberar_cupo(web, slug, payload, tlog):
    from pami_liberar_cupo import PamiLiberarCupoController

    user, clave = _creds(web, slug)
    if not user or not clave:
        raise RuntimeError("El cliente no tiene usuario/clave PAMI cargados en la web.")

    candidatas = payload.get("omes") or payload.get("candidatas") or []
    if not isinstance(candidatas, list):
        candidatas = []
    candidatas = [x for x in candidatas if isinstance(x, dict) and str(x.get("n_orden", "") or "").strip()]
    if not candidatas:
        return {"total": 0, "liberadas": 0, "errores": 0, "omitidas": 0, "detalle": []}

    tlog(f"Liberando cupo de {len(candidatas)} OME(s) en PAMI...")
    ctrl = PamiLiberarCupoController(log_callback=lambda m: tlog(str(m)), status_callback=lambda m: None)
    try:
        ctrl.abrir_pami(user, clave, headless=True)
        resumen = ctrl.liberar_omes(candidatas)
    finally:
        ctrl.cerrar()

    detalle = []
    for r in resumen.detalle:
        d = dataclasses.asdict(r)
        detalle.append(d)
        extra = (" · vto " + d.get("f_vencimiento", "")) if d.get("f_vencimiento") else ""
        tlog(f"OME {d.get('n_orden','')} -> {d.get('estado','')}{extra}")
    return {
        "total": len(candidatas),
        "liberadas": resumen.ok,
        "errores": resumen.errores,
        "omitidas": resumen.omitidos,
        "detalle": detalle,
    }


def dispatch(task, web, cola):
    tid = task["id"]
    tipo = task["type"]
    slug = task.get("clientSlug", "")
    payload = task.get("payload") or {}

    def tlog(m):
        log(f"  {m}")
        cola.tlog(tid, m)

    if tipo == "healthcheck":
        tlog("Worker vivo.")
        return {"ok": True}
    if tipo == "auditar-informes":
        return tarea_auditar(web, slug, payload, tlog)
    if tipo == "subir-informes":
        return tarea_subir(web, slug, payload, tlog, cola, tid)
    if tipo == "crear-ome":
        return tarea_crear_ome(web, slug, payload, tlog)
    if tipo == "crear-informe-cabecera":
        return tarea_crear_informe_cabecera(web, slug, payload, tlog)
    if tipo == "verificar-medico":
        return tarea_verificar_medicos(web, slug, payload, tlog)
    if tipo == "plan-salud-benef":
        return tarea_plan_salud_benef(web, slug, payload, tlog)
    if tipo == "liberar-cupo":
        return tarea_liberar_cupo(web, slug, payload, tlog)
    raise RuntimeError(f"Tipo de tarea no soportado por este worker: {tipo}")


def main():
    cfg = load_config()
    base = cfg.get("base_url") or DEFAULT_BASE_URL
    web = NSWebClient(base)
    web.login(cfg.get("username", ""), cfg.get("password", ""))
    token = (web._request("GET", "/api/admin/worker/token") or {}).get("token", "")
    if not token:
        raise SystemExit("No pude obtener el token del worker (¿el usuario de la app es admin?).")
    cola = Cola(base, token)
    log(f"Worker '{WORKER_ID}' conectado a {base}. Esperando tareas…")
    while True:
        cola.heartbeat()
        task = cola.proxima()
        if not task:
            time.sleep(POLL_SEG)
            continue
        tid = task["id"]
        log(f"Tarea {task['type']} ({tid[:8]}) para {task.get('clientSlug') or '-'}")
        try:
            result = dispatch(task, web, cola)
            cola.completar(tid, ok=True, result=result)
            log(f"  → OK: {result}")
        except Exception as e:  # noqa: BLE001
            log(f"  → ERROR: {e}")
            log(traceback.format_exc())
            cola.completar(tid, ok=False, error=str(e))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Worker detenido a mano.")
