# -*- coding: utf-8 -*-
"""Worker de la PC para la cola de tareas de la web NS.

Escucha las tareas que encola la web (heartbeat/next), las corre en PAMI y reporta
el resultado (log/complete). Es el puente que le falta a la cabina para que los
botones "Auditar" y "Subir" funcionen: la web (Railway) no llega a PAMI, la PC sí.

Tipos de tarea:
  - healthcheck        : prueba (responde "vivo").
  - auditar-informes   : verifica en PAMI qué informes están cargados/transmitidos.
  - subir-informes     : adjunta el informe a la OME en PAMI (upload real + transmite).

Auth: el token de la cola lo obtiene logueado como admin (/api/admin/worker/token);
los datos (informes, clave PAMI, archivos) los saca con la sesión admin.

USO (dejarlo corriendo en la PC, o como tarea de Windows):
    python worker_pami.py
"""
from __future__ import annotations

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


# --- Datos desde la web (sesión admin) -------------------------------------
def _informes(web, slug, ids):
    data = web._request("GET", f"/api/clientes/{slug}/informes")
    items = data.get("items", []) if isinstance(data, dict) else []
    idset = set(ids or [])
    return [it for it in items if (not idset or it.get("id") in idset)]


def _ome_de(it):
    r = it.get("resuelto") or {}
    if r.get("ome"):
        return str(r["ome"])
    return str((it.get("match") or {}).get("ome") or "")


def _creds(web, slug):
    cred = web.client_pami(slug)
    return str(cred.get("pamiUser", "")).strip(), str(cred.get("pamiPassword", "") or "")


def _descargar_archivo(web, slug, informe_id, dest: Path):
    """Baja el archivo original del informe con la cookie de la sesión admin."""
    host, port, https = _split(web.base_url)
    headers = {"Cookie": web._cookie} if getattr(web, "_cookie", "") else {}
    conn = (http.client.HTTPSConnection if https else http.client.HTTPConnection)(host, port, timeout=60)
    try:
        conn.request("GET", f"/api/clientes/{slug}/informes/{informe_id}/archivo", headers=headers)
        r = conn.getresponse()
        body = r.read()
        if r.status != 200:
            raise RuntimeError(f"HTTP {r.status} al bajar el archivo")
        dest.write_bytes(body)
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
        filas.append({
            "beneficio": p.get("beneficio") or ex.get("beneficio") or "",
            "paciente": ex.get("nombre", ""), "dni": ex.get("dni", ""),
            "practica": ex.get("practica", ""), "turno": "", "ome": _ome_de(it), "id": it.get("id"),
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


def tarea_subir(web, slug, payload, tlog):
    infos = _informes(web, slug, payload.get("informeIds"))
    user, clave = _creds(web, slug)
    if not user or not clave:
        raise RuntimeError("El cliente no tiene usuario/clave PAMI cargados en la web.")
    tmp = Path(tempfile.mkdtemp(prefix="ns_subir_"))
    items = []
    for it in infos:
        ome = _ome_de(it)
        if not ome:
            tlog(f"{it.get('filename','')[:24]} sin OME → salteado")
            continue
        ex = it.get("extract") or {}
        p = (it.get("match") or {}).get("prestacion") or {}
        dest = tmp / (it.get("stored") or (str(it.get("id", "")) + str(it.get("ext", ""))))
        try:
            _descargar_archivo(web, slug, it["id"], dest)
        except Exception as e:  # noqa: BLE001
            tlog(f"No pude bajar {it.get('filename','')}: {e}")
            continue
        items.append({
            "archivo": str(dest), "filename": it.get("filename", ""),
            "prestacion": {"n_orden": ome, "beneficio": p.get("beneficio") or ex.get("beneficio") or "",
                           "nombre": ex.get("nombre", ""), "practica": ex.get("practica", "")},
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
    for r in res:
        d = {"filename": r.get("filename", ""), "ome": (r.get("prestacion") or {}).get("n_orden", ""),
             "estado": r.get("estado"), "motivo": r.get("motivo", "")}
        tlog(f"{d['filename'][:24]:24} OME {d['ome']} → {d['estado']} ({d['motivo']})")
        detalle.append(d)
    return {"total": len(items), "subidos": ok, "detalle": detalle}


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
        return tarea_subir(web, slug, payload, tlog)
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
