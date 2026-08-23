"""Cadena diaria de médicos de cabecera: benef → credencial → OME → activar.

Corre los 4 pasos EN SECUENCIA para CADA cliente de CLIENTES_CADENA
(Scheffelaar, Dube, …), cada paso sobre lo que dejó el anterior. Todos
idempotentes: re-correr solo completa lo que falta.

  1. benef — completa los N° de beneficio que faltan (desde start_row del
     cliente) y DISPARA la credencial de esas filas nuevas (quirúrgico).
  2. credencial — ESPERA a que termine la descarga que disparó el benef.
  3. OME — genera OME de cabecera a los que ya tienen credencial DESCARGADA.
  4. activar — agenda el turno SOLO de las OMEs generadas en esta tanda.

Pensado para la tarea de Windows "NS - Cadena Scheffelaar" (Lun-Vie 10/17/19:30).
Uso manual: python pipeline_scheffelaar.py
"""
from __future__ import annotations

import sys
import time

import activacion_sweep
import benef_sweep
import ome_cabecera_sweep
from cadena_clientes import get_cliente
from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config

# Clientes que corren en la cadena automática (en orden).
CLIENTES_CADENA = ["scheffelaar-mc", "dubesarky-ezequiel"]
ESPERA_MAX_CREDENCIAL_S = 2 * 60 * 60   # techo de espera de la credencial (2 h)


def log(m: str) -> None:
    print(m, flush=True)


def _correr_cliente(slug: str, web) -> None:
    C = get_cliente(slug)
    nombre = C.get("nombre", slug)
    cred_key = C["cred_key"]
    log(f"========== Cliente: {nombre} ==========")

    # --- Paso 1: benef (dispara la credencial de las filas nuevas, quirúrgico). ---
    log("=== [1/4] Barrido de benef ===")
    try:
        benef_sweep.run(cliente_slug=slug, progress=lambda m: None, disparar_credencial=True)
    except Exception as e:  # noqa: BLE001
        log(f"benef falló (sigo con credencial/OME): {e!r}")

    # --- Paso 2: esperar a que termine la descarga de credenciales. ---
    log("=== [2/4] Descarga de credenciales (espera) ===")
    try:
        time.sleep(8)                            # darle tiempo a arrancar
        esperado = 0
        while web.credencial_corriendo(cred_key) and esperado < ESPERA_MAX_CREDENCIAL_S:
            time.sleep(20)
            esperado += 20
        log(f"credenciales listas (esperé {esperado}s).")
    except Exception as e:  # noqa: BLE001
        log(f"espera de credencial falló (sigo con OME): {e!r}")

    # --- Paso 3: OME de cabecera (solo a los que tienen credencial). ---
    log("=== [3/4] Generación de OME de cabecera ===")
    filas_generadas = []
    try:
        resumen_ome = ome_cabecera_sweep.run(cliente_slug=slug, progress=lambda m: None) or {}
        filas_generadas = list(resumen_ome.get("filas_con_ome") or [])
    except Exception as e:  # noqa: BLE001
        log(f"OME falló: {e!r}")

    # --- Paso 4: activar SOLO las OMEs generadas en ESTA tanda. ---
    log(f"=== [4/4] Activación de turnos ({len(filas_generadas)} de esta tanda) ===")
    if filas_generadas:
        try:
            activacion_sweep.run(cliente_slug=slug, progress=lambda m: None, solo_filas=filas_generadas)
        except Exception as e:  # noqa: BLE001
            log(f"activación falló: {e!r}")
    else:
        log("No hubo OMEs nuevas para activar en esta tanda.")


def run() -> None:
    cfg = load_config()
    web = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
    web.login(cfg.get("username", ""), cfg.get("password", ""))
    for slug in CLIENTES_CADENA:
        try:
            _correr_cliente(slug, web)
        except Exception as e:  # noqa: BLE001
            log(f"cliente {slug} falló entero (sigo con el próximo): {e!r}")
    log("=== Cadena completa terminada (todos los clientes) ===")


if __name__ == "__main__":  # pragma: no cover
    try:
        run()
    except Exception as exc:  # noqa: BLE001
        import traceback
        log(f"FALLO: {exc!r}")
        log(traceback.format_exc())
        sys.exit(1)
