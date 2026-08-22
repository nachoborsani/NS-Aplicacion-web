"""Cadena completa diaria de Scheffelaar: benef → credencial → OME de cabecera.

Corre los tres pasos EN SECUENCIA (cada uno sobre lo que dejó el anterior):
  1. Barrido de benef (completa los N° de beneficio que faltan).
  2. Descarga de credenciales (backlog completo) y ESPERA a que termine.
  3. Generación de OME de cabecera (solo a los que ya tienen credencial).

Pensado para correr programado 2 veces por día (17:00 y al otro día 10:00) vía
pipeline_schedule.py. Uso manual: python pipeline_scheffelaar.py
"""
from __future__ import annotations

import sys
import time

import benef_sweep
import ome_cabecera_sweep
from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config

ESPERA_MAX_CREDENCIAL_S = 2 * 60 * 60   # techo de espera de la credencial (2 h)


def log(m: str) -> None:
    print(m, flush=True)


def run() -> None:
    # --- Paso 1: benef (sin disparar la credencial: la maneja esta cadena). ---
    log("=== [1/3] Barrido de benef ===")
    try:
        benef_sweep.run(progress=lambda m: None, disparar_credencial=False)
    except Exception as e:  # noqa: BLE001
        log(f"benef falló (sigo igual con credencial/OME): {e!r}")

    # --- Paso 2: credencial (backlog completo) y esperar a que termine. ---
    log("=== [2/3] Descarga de credenciales (y espera) ===")
    cfg = load_config()
    web = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
    try:
        web.login(cfg.get("username", ""), cfg.get("password", ""))
        web.correr_credenciales_scheffelaar()   # todo el backlog pendiente
        time.sleep(8)                            # darle tiempo a arrancar
        esperado = 0
        while web.credencial_corriendo() and esperado < ESPERA_MAX_CREDENCIAL_S:
            time.sleep(20)
            esperado += 20
        log(f"credenciales listas (esperé {esperado}s).")
    except Exception as e:  # noqa: BLE001
        log(f"credencial falló (sigo con OME sobre lo que haya): {e!r}")

    # --- Paso 3: OME de cabecera (solo a los que tienen credencial). ---
    log("=== [3/3] Generación de OME de cabecera ===")
    try:
        ome_cabecera_sweep.run(progress=lambda m: None)
    except Exception as e:  # noqa: BLE001
        log(f"OME falló: {e!r}")

    log("=== Cadena completa terminada ===")


if __name__ == "__main__":  # pragma: no cover
    try:
        run()
    except Exception as exc:  # noqa: BLE001
        import traceback
        log(f"FALLO: {exc!r}")
        log(traceback.format_exc())
        sys.exit(1)
