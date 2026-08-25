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
import credencial_pendientes
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

    # --- Paso 1.5: filas ya completas (benef+dni+trámite) SIN credencial → disparar
    #     la descarga. La cadena por sí sola no las agarra (solo dispara para las filas
    #     nuevas del barrido); estas ya venían con beneficio. Las que ya tienen la
    #     credencial en Drive (gemelo) se marcan DESCARGADA en la auto-curación y NO
    #     entran acá (no se re-bajan, no se duplican). ---
    log("=== [1.5/4] Credencial de filas completas sin credencial ===")
    try:
        r = credencial_pendientes.preparar(C)
        if r["reusadas"]:
            log(f"→ {r['reusadas']} fila(s) reusaron credencial ya en Drive (marca DESCARGADA, no se re-baja).")
        if r["bajar"]:
            web.correr_credenciales(cred_key, rows=r["bajar"])
            log(f"→ Disparada la descarga de credencial de {len(r['bajar'])} fila(s) sin credencial.")
        if not r["reusadas"] and not r["bajar"]:
            log("Nada pendiente de credencial.")
    except Exception as e:  # noqa: BLE001
        log(f"credencial de pendientes falló (sigo): {e!r}")

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
    # En TANDAS: cada run() abre su propio navegador y lo cierra, así procesar un
    # backlog grande (ej. 46) no acumula contextos y no cierra el navegador a mitad
    # (el TargetClosedError que vimos con 46 de golpe). Operación normal = 1 tanda.
    log("=== [3/4] Generación de OME de cabecera ===")
    filas_generadas = []
    try:
        for _tanda in range(1, 13):  # reintentos con navegador fresco (tope por seguridad)
            # SIN limite: cada tanda procesa TODAS las candidatas que quedan (las que
            # ya tienen OME quedan afuera solas). Si una tanda se cae a mitad, la
            # siguiente arranca con navegador nuevo y termina el resto. (OJO: `limite`
            # en el sweep limita la VENTANA DE FILAS, no la cantidad de candidatas.)
            resumen_ome = ome_cabecera_sweep.run(cliente_slug=slug, progress=lambda m: None) or {}
            nuevas = list(resumen_ome.get("filas_con_ome") or [])
            filas_generadas.extend(nuevas)
            log(f"  tanda {_tanda}: {len(nuevas)} OME(s).")
            if not nuevas:
                break  # no quedó nada por generar (o lo que queda falla)
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
