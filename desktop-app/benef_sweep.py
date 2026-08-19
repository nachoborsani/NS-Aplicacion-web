"""Barrido diario del benef (Scheffelaar).

Busca en el padrón de PAMI el N° de beneficio de las filas de la planilla de
Scheffelaar que tienen DNI pero todavía no tienen benef, y lo escribe en la
planilla (a través de la web, que es la que tiene la conexión a Google). Después,
la corrida de credenciales de la web les baja la credencial.

La app hace SOLO la parte de navegador (buscar en el padrón, con su captcha); la
lectura/escritura de la planilla va por la web. Solo lectura del padrón, no
transmite nada. Pensado para correr programado (tarea de Windows) a las 19:00.

Uso manual:  python benef_sweep.py
"""
from __future__ import annotations

import sys
import time

from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config
import pami_scraper as ps


def log(m: str) -> None:
    print(m, flush=True)


def run(progress=None) -> dict:
    resumen = {"faltan": 0, "escritos": 0, "sin_benef": 0, "errores": 0}
    cfg = load_config()
    web = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
    web.login(cfg.get("username", ""), cfg.get("password", ""))

    faltan = web.faltan_benef_scheffelaar()
    resumen["faltan"] = len(faltan)
    log(f"Filas con DNI y sin benef: {len(faltan)}")
    if not faltan:
        log("Nada para buscar.")
        return resumen

    sesion = ps.iniciar_sesion(headless=True)
    try:
        total = len(faltan)
        for i, fila in enumerate(faltan, 1):
            dni = str(fila.get("dni", "")).strip()
            row = fila.get("sheetRow")
            nombre = str(fila.get("nombre", "")).strip()
            if not dni:
                continue
            if progress:
                progress(f"{i}/{total} · {nombre or dni}")
            log(f"[{i}/{total}] fila {row} · {nombre} · DNI {dni} …")
            try:
                r = ps.procesar_afiliado(dni, sesion.page, modo_busqueda=ps.MODO_DNI)
                benef = str(r.get("beneficio_encontrado", "")).strip()
                if benef:
                    try:
                        web.set_benef_scheffelaar(row, benef)
                        resumen["escritos"] += 1
                        log(f"    benef {benef} → escrito en la planilla")
                    except Exception as e:  # noqa: BLE001
                        resumen["errores"] += 1
                        log(f"    encontró {benef} pero falló al escribir: {e!r}")
                else:
                    resumen["sin_benef"] += 1
                    log(f"    sin benef en el padrón ({r.get('clasificacion', '')})")
            except Exception as e:  # noqa: BLE001
                resumen["errores"] += 1
                log(f"    error en el padrón: {e!r}")
            time.sleep(1)  # no martillar PAMI
    finally:
        try:
            ps.cerrar_sesion(sesion)
        except Exception:  # noqa: BLE001
            pass

    log(f"=== listo: {resumen['escritos']} escritos · {resumen['sin_benef']} sin benef · {resumen['errores']} errores ===")
    return resumen


if __name__ == "__main__":  # pragma: no cover
    try:
        run(progress=lambda m: None)
    except Exception as exc:  # noqa: BLE001
        import traceback
        log(f"FALLO: {exc!r}")
        log(traceback.format_exc())
        sys.exit(1)
