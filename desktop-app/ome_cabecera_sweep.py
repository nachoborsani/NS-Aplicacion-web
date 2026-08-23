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

from cadena_clientes import get_cliente, layout_ome
from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config
from pami_ome_generator import PamiOmeGenerator, PatientInput
from google_sheets_ome import read_ome_sheet_rows, write_ome_sheet_results

CLIENTE_SLUG_DEFAULT = "scheffelaar-mc"

# Resultados que significan "quedó una OME" (o ya la tenía) -> se corta la cascada.
OK_RESULTS = {"OK", "GENERADA", "YA_TIENE_OME"}
# Resultados donde probar OTRA práctica tiene sentido.
CASCADA_RESULTS = {"LIMITE", "LIMITE_ANUAL"}


def log(m: str) -> None:
    print(m, flush=True)


async def _procesar(user: str, clave: str, candidatos: list[dict], diagnostico: str,
                    practicas: list[str], progress=None) -> tuple[list[dict], dict]:
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
            for practica in practicas:
                try:
                    res = await gen.process_patient(PatientInput(
                        modo=fila.get("modo", "BENEF"),
                        afiliado=fila.get("afiliado", benef or dni),
                        diagnostico=diagnostico,
                        practica=practica,
                        dni=dni,
                        nombre=nombre,
                        # Cabecera: las 4 consultas son la misma OME. Si PAMI dice
                        # "ya tiene OME", buscar el número bajo cualquiera de ellas.
                        practicas_equivalentes=tuple(practicas),
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


def run(cliente_slug: str = CLIENTE_SLUG_DEFAULT, progress=None, limite: int | None = None) -> dict:
    C = get_cliente(cliente_slug)
    nombre = C.get("nombre", cliente_slug)
    diagnostico = C.get("diagnostico", "Z000")
    practicas = list(C.get("practicas") or ["427122", "427121", "427120", "427109"])
    start_row = int(C.get("start_row") or 2)
    override = layout_ome(C)

    cfg = load_config()
    web = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
    web.login(cfg.get("username", ""), cfg.get("password", ""))

    # Clave PAMI del cliente desde la web (fuente de verdad).
    cred = web.client_pami(cliente_slug)
    user = str(cred.get("pamiUser", "")).strip()
    clave = str(cred.get("pamiPassword", "") or "")
    if not user or not clave:
        log(f"{nombre} no tiene usuario/clave PAMI cargados en la web.")
        return {"candidatos": 0, "error": "sin clave PAMI"}

    filas = read_ome_sheet_rows(
        spreadsheet_url_or_id=C["spreadsheet"],
        sheet_name=C["sheet_name"],
        fallback_diagnostico=diagnostico,
        default_practica=practicas[0],
        start_row=start_row,
        max_rows=limite,
        require_credential_ok=True,   # SOLO los que tienen credencial descargada
        layout_override=override,
    )
    # read_ome_sheet_rows igual devuelve las sin credencial marcadas: las filtramos.
    candidatos = [f for f in filas if not f.get("credential_blocked")]
    log(f"{nombre}: candidatos (con credencial, sin OME, desde fila {start_row}): {len(candidatos)}")
    if not candidatos:
        log("Nada para generar.")
        return {"candidatos": 0, "generadas": 0, "ya_tenian": 0, "limite": 0, "errores": 0}

    result_rows, resumen = asyncio.run(_procesar(user, clave, candidatos, diagnostico, practicas, progress=progress))

    # Escribir los OMEs generados de vuelta en la planilla.
    escritas = 0
    if result_rows:
        try:
            escritas = write_ome_sheet_results(
                spreadsheet_url_or_id=C["spreadsheet"],
                sheet_name=C["sheet_name"],
                result_rows=result_rows,
                layout_override=override,
            )
        except Exception as e:  # noqa: BLE001
            log(f"No pude escribir los resultados en la planilla: {e!r}")

    # Filas que quedaron CON OME en esta tanda (generadas o ya la tenían y le
    # recuperamos el número). La cadena usa esto para activar SOLO lo de esta
    # corrida, no todo el backlog.
    filas_con_ome = [
        r.get("sheet_row") for r in result_rows
        if str(r.get("resultado", "")).upper() in OK_RESULTS
        and str(r.get("nro_ome", "") or r.get("n_orden", "") or "").strip()
        and r.get("sheet_row")
    ]
    resumen["filas_con_ome"] = filas_con_ome

    log(f"=== listo: {resumen['generadas']} generadas · {resumen['ya_tenian']} ya tenían · "
        f"{resumen['limite']} límite · {resumen['errores']} errores · {escritas} escritas en planilla ===")
    return resumen


if __name__ == "__main__":  # pragma: no cover
    # Uso: python ome_cabecera_sweep.py [cliente_slug] [limite]
    _slug = CLIENTE_SLUG_DEFAULT
    _lim = None
    for _a in sys.argv[1:]:
        if _a.isdigit():
            _lim = int(_a)
        elif "-" in _a:
            _slug = _a
    try:
        run(cliente_slug=_slug, progress=lambda m: None, limite=_lim)
    except Exception as exc:  # noqa: BLE001
        import traceback
        log(f"FALLO: {exc!r}")
        log(traceback.format_exc())
        sys.exit(1)
