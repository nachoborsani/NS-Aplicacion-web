"""Barrido de generación de OME de cabecera (Scheffelaar).

Genera la OME de médico de cabecera SOLO a los afiliados que YA tienen la
credencial descargada y todavía no tienen OME, arrancando desde una fila. Corre
DESPUÉS del barrido de credenciales (para trabajar sobre lo que ya tiene
credencial). Reusa la maquinaria probada de la app:
  - google_sheets_ome.read_ome_sheet_rows(require_credential_ok=True) → candidatos
    (con credencial DESCARGADA, sin OME, con benef/DNI).
  - PamiOmeGenerator.process_patient → genera la OME con una práctica. Acá hacemos
    la CASCADA: si una práctica da LIMITE, se prueba la siguiente de las 4.
  - google_sheets_ome.write_ome_sheet_results → escribe el nro de OME + fecha.

Diagnóstico fijo: "Z000 - Examen medico general". Prácticas de cabecera en orden
de cascada: 427122 → 427121 → 427120 → 427109.

La clave PAMI se lee de la WEB (fuente de verdad, admin-only), igual que el benef.

Uso manual (PRIMERO probar con 1):
    python ome_cabecera_sweep.py 1     # procesa solo 1 fila (prueba)
    python ome_cabecera_sweep.py       # procesa todas las pendientes desde 4718
"""
from __future__ import annotations

import asyncio
import sys

from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config
from pami_ome_generator import PamiOmeGenerator, PatientInput
from google_sheets_ome import read_ome_sheet_rows, write_ome_sheet_results

CLIENTE_SLUG = "scheffelaar-mc"
SPREADSHEET = "https://docs.google.com/spreadsheets/d/1sZP1NuVzyzjc17lrFFePy6IVQNUB3epNXJIXoBJI334/edit"
SHEET_NAME = "Schefelar"
START_ROW = 4718
# PAMI llena el campo CÓDIGO y clickea la opción que EMPIEZA con este texto, así
# que va solo el código (la descripción de PAMI puede diferir de la de la app).
DIAGNOSTICO = "Z000"
# Cascada: se prueba en orden; si una da LIMITE/LIMITE_ANUAL, va la siguiente.
PRACTICAS = ["427122", "427121", "427120", "427109"]

# Resultados que significan "quedó una OME" (o ya la tenía) -> se corta la cascada.
OK_RESULTS = {"OK", "GENERADA", "YA_TIENE_OME"}
# Resultados donde probar OTRA práctica tiene sentido.
CASCADA_RESULTS = {"LIMITE", "LIMITE_ANUAL"}


def log(m: str) -> None:
    print(m, flush=True)


async def _procesar(user: str, clave: str, candidatos: list[dict], progress=None) -> tuple[list[dict], dict]:
    resumen = {"candidatos": len(candidatos), "generadas": 0, "ya_tenian": 0, "limite": 0, "errores": 0}
    result_rows: list[dict] = []
    total = len(candidatos)
    async with PamiOmeGenerator(user=user, password=clave, headless=True) as gen:
        for i, fila in enumerate(candidatos, 1):
            benef = str(fila.get("beneficio", "") or "").strip()
            dni = str(fila.get("dni", "") or "").strip()
            nombre = str(fila.get("nombre", "") or "").strip()
            sheet_row = fila.get("sheet_row")
            if progress:
                progress(f"{i}/{total} · {nombre or benef or dni}")
            log(f"[{i}/{total}] fila {sheet_row} · {nombre} · benef {benef or '-'} / dni {dni or '-'} …")

            ultimo = None
            for practica in PRACTICAS:
                try:
                    res = await gen.process_patient(PatientInput(
                        modo=fila.get("modo", "BENEF"),
                        afiliado=fila.get("afiliado", benef or dni),
                        diagnostico=DIAGNOSTICO,
                        practica=practica,
                        dni=dni,
                        nombre=nombre,
                    ))
                except Exception as e:  # noqa: BLE001
                    ultimo = None
                    log(f"    error en el panel: {e!r}")
                    resumen["errores"] += 1
                    break
                ultimo = res
                estado = getattr(res, "resultado", "") or ""
                if estado in OK_RESULTS:
                    nro = str(getattr(res, "nro_ome", "") or "").strip()
                    if estado == "YA_TIENE_OME":
                        resumen["ya_tenian"] += 1
                        log(f"    ya tenía OME ({nro or '-'})")
                    else:
                        resumen["generadas"] += 1
                        log(f"    OME {nro} generada (práctica {practica})")
                    break
                if estado in CASCADA_RESULTS:
                    log(f"    práctica {practica} → {estado}, pruebo la siguiente")
                    continue
                # BAJA / NO_DNI / DOBLE_DNI / ERROR* → cortamos, no vale probar otra
                resumen["errores"] += 1
                log(f"    {estado} (no genera)")
                break
            else:
                # se agotaron las 4 prácticas, todas LIMITE
                resumen["limite"] += 1
                log("    todas las prácticas dieron LIMITE")

            # Escribir de vuelta SOLO si el resultado es definitivo (OME generada,
            # ya tenía, límite, baja, etc.). Un error TRANSITORIO (ERROR*) no se
            # escribe: la fila queda pendiente y se reintenta en la próxima corrida.
            if ultimo is not None and sheet_row:
                es_transitorio = str(getattr(ultimo, "resultado", "")).strip().upper().startswith("ERROR")
                if not es_transitorio:
                    d = ultimo.to_row() if hasattr(ultimo, "to_row") else {}
                    d["sheet_row"] = sheet_row
                    d.setdefault("beneficio", benef)
                    d.setdefault("dni", dni)
                    result_rows.append(d)
    return result_rows, resumen


def run(progress=None) -> dict:
    cfg = load_config()
    web = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
    web.login(cfg.get("username", ""), cfg.get("password", ""))

    # Clave PAMI de Scheffelaar desde la web (fuente de verdad).
    cred = web.client_pami(CLIENTE_SLUG)
    user = str(cred.get("pamiUser", "")).strip()
    clave = str(cred.get("pamiPassword", "") or "")
    if not user or not clave:
        log("Scheffelaar no tiene usuario/clave PAMI cargados en la web.")
        return {"candidatos": 0, "error": "sin clave PAMI"}

    # Límite opcional para prueba: python ome_cabecera_sweep.py 1 → 1 fila.
    limite = None
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        limite = int(sys.argv[1])
        log(f"(modo prueba: solo {limite} fila/s)")

    filas = read_ome_sheet_rows(
        spreadsheet_url_or_id=SPREADSHEET,
        sheet_name=SHEET_NAME,
        fallback_diagnostico=DIAGNOSTICO,
        default_practica=PRACTICAS[0],
        start_row=START_ROW,
        max_rows=limite,
        require_credential_ok=True,   # SOLO los que tienen credencial descargada
    )
    # read_ome_sheet_rows igual devuelve las sin credencial marcadas: las filtramos.
    candidatos = [f for f in filas if not f.get("credential_blocked")]
    log(f"Candidatos (con credencial, sin OME, desde fila {START_ROW}): {len(candidatos)}")
    if not candidatos:
        log("Nada para generar.")
        return {"candidatos": 0, "generadas": 0, "ya_tenian": 0, "limite": 0, "errores": 0}

    result_rows, resumen = asyncio.run(_procesar(user, clave, candidatos, progress=progress))

    # Escribir los OMEs generados de vuelta en la planilla.
    escritas = 0
    if result_rows:
        try:
            escritas = write_ome_sheet_results(
                spreadsheet_url_or_id=SPREADSHEET,
                sheet_name=SHEET_NAME,
                result_rows=result_rows,
            )
        except Exception as e:  # noqa: BLE001
            log(f"No pude escribir los resultados en la planilla: {e!r}")

    log(f"=== listo: {resumen['generadas']} generadas · {resumen['ya_tenian']} ya tenían · "
        f"{resumen['limite']} límite · {resumen['errores']} errores · {escritas} escritas en planilla ===")
    return resumen


if __name__ == "__main__":  # pragma: no cover
    try:
        run(progress=lambda m: None)
    except Exception as exc:  # noqa: BLE001
        import traceback
        log(f"FALLO: {exc!r}")
        log(traceback.format_exc())
        sys.exit(1)
