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

import json
import sys
import time
from datetime import date
from pathlib import Path

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


# Aviso por Telegram cuando el bot NO puede entrar a PAMI (clave vencida/cambiada o
# cuenta bloqueada): la cadena de ese cliente no genera OMEs ni activa turnos hasta
# que se corrija. Se avisa UNA vez por cliente por día — las corridas 10/17/19:30 no
# tienen que mandar el mismo aviso tres veces.
def _es_fallo_login_pami(e) -> bool:
    return "revisar credenciales" in str(e).lower()


def _alert_state_path() -> Path:
    return Path(__file__).with_name("pipeline_alert_state.json")


def _ya_avise_hoy(slug: str) -> bool:
    try:
        return json.loads(_alert_state_path().read_text("utf-8")).get(slug) == date.today().isoformat()
    except Exception:
        return False


def _marcar_avise_hoy(slug: str) -> None:
    try:
        p = _alert_state_path()
        try:
            st = json.loads(p.read_text("utf-8"))
        except Exception:
            st = {}
        st[slug] = date.today().isoformat()
        p.write_text(json.dumps(st, ensure_ascii=False, indent=2), "utf-8")
    except Exception:
        pass


def _correr_cliente(slug: str, web) -> None:
    C = get_cliente(slug)
    nombre = C.get("nombre", slug)
    cred_key = C["cred_key"]
    log(f"========== Cliente: {nombre} ==========")
    fallo_login = False   # PAMI rechazó el login en algún paso → se avisa por Telegram

    # --- Paso 1: benef (dispara la credencial de las filas nuevas, quirúrgico). ---
    log("=== [1/4] Barrido de benef ===")
    try:
        benef_sweep.run(cliente_slug=slug, progress=lambda m: None, disparar_credencial=True)
    except Exception as e:  # noqa: BLE001
        log(f"benef falló (sigo con credencial/OME): {e!r}")
        if _es_fallo_login_pami(e):
            fallo_login = True

    # --- Paso 1.4: curar la planilla ANTES de bajar credenciales (si el cliente lo
    #     pide). Reusa la credencial del paciente que ya la tiene DESCARGADA por benef,
    #     DNI o N° de trámite, y corrige el benef/DNI mal tipeado desde la fila
    #     validada. Así una fila con el DNI mal cargado no dispara una bajada nueva
    #     (que además PAMI rechaza) cuando el paciente ya está descargado más arriba. ---
    if C.get("curar_antes_de_credencial"):
        log("=== [1.4/4] Curación previa (reusa credencial ya descargada) ===")
        try:
            import curar_planilla
            r = curar_planilla.curar(slug=slug, apply=True, todo=False) or {}
            log(f"→ curación: {r.get('reuso', 0)} credencial(es) reusadas, "
                f"{r.get('benef', 0)+r.get('dni', 0)} identidad(es) corregidas, "
                f"{r.get('limpia', 0)} para re-bajar.")
        except Exception as e:  # noqa: BLE001
            log(f"curación previa falló (sigo): {e!r}")

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
        if _es_fallo_login_pami(e):
            fallo_login = True

    # --- Paso 4: activar TODO lo que tenga OME sin activar (no solo la tanda). ---
    # Antes se pasaba solo_filas=filas_generadas, así que una fila que se generaba en
    # una corrida que NO llegaba a activar (se cortó / falló) quedaba HUÉRFANA para
    # siempre: las corridas siguientes la veían "ya tenía OME", no entraba en la tanda
    # y nunca se activaba. Sin solo_filas, el barrido levanta esas huérfanas también.
    # Es seguro: el sweep ya saltea las que tienen la col de activación marcada (no
    # re-activa, no duplica turnos), así que en régimen solo activa lo realmente nuevo.
    log("=== [4/4] Activación de turnos (todo lo que tenga OME sin activar) ===")
    try:
        res_act = activacion_sweep.run(cliente_slug=slug, progress=lambda m: None) or {}
        log(f"  {res_act.get('activadas', 0)} activada(s) · {res_act.get('errores', 0)} error(es) "
            f"· de {res_act.get('candidatos', 0)} candidata(s).")
    except Exception as e:  # noqa: BLE001
        log(f"activación falló: {e!r}")
        if _es_fallo_login_pami(e):
            fallo_login = True

    # --- Aviso: si PAMI rechazó el login en algún paso, avisar por Telegram (1x/día). ---
    if fallo_login and not _ya_avise_hoy(slug):
        try:
            web.avisar(
                f"⚠️ Cadena automática — {nombre}: el bot no pudo entrar a PAMI "
                f"(revisar las credenciales de PAMI de este cliente). Mientras no se "
                f"corrija, no se generan OMEs de cabecera ni se activan turnos."
            )
            _marcar_avise_hoy(slug)
            log("→ aviso Telegram enviado (fallo de login PAMI).")
        except Exception as e:  # noqa: BLE001 - el aviso no debe cortar la cadena
            log(f"no pude enviar el aviso Telegram: {e!r}")


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
