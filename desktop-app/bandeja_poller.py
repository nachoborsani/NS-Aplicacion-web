"""Sondeo del refresco on-demand: si la web tiene un refresco de bandejas PEDIDO,
corre la bajada. Pensado para correr cada ~10 min (tarea de Windows).

Consumo mínimo: si no hay pedido, hace UNA consulta HTTP y sale (no abre PAMI ni
navegador). Recién cuando hay un pedido (botón "Actualizar ahora" de la web),
corre `bandeja_sync.sync_all` — lo mismo que la tarea programada.
"""
from __future__ import annotations

import bandeja_sync
from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config


def log(m: str) -> None:
    print(m, flush=True)


def run(progress=None) -> None:
    cfg = load_config()
    web = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
    web.login(cfg.get("username", ""), cfg.get("password", ""))

    try:
        st = web._request("GET", "/api/bandeja/refresco/estado")
    except Exception as e:  # noqa: BLE001
        log(f"no pude leer el estado del refresco: {e!r}")
        return
    if not (isinstance(st, dict) and st.get("pendiente")):
        log("sin refresco pedido; nada que hacer.")
        return
    if st.get("corriendo"):
        log("ya hay un refresco corriendo; salgo.")
        return

    pedido = st.get("pedidoAt")
    log(f"refresco pedido ({pedido}) — corriendo la bajada…")
    try:
        web._request("POST", "/api/bandeja/refresco/ack", body={"corriendo": True})
    except Exception:  # noqa: BLE001
        pass

    try:
        resultados = bandeja_sync.sync_all(progress=progress or (lambda m: log("  " + m)))
        ok = sum(1 for r in resultados if r.get("ok"))
        log(f"bajada lista: {ok}/{len(resultados)} ok.")
        # Aviso por Telegram (separa clave equivocada de error transitorio).
        try:
            msg = bandeja_sync.armar_aviso_telegram(
                resultados, bandeja_sync._current_period(), titulo="Refresco manual")
            web.avisar(msg)
        except Exception:  # noqa: BLE001
            pass
    finally:
        # Marca ESE pedido como hecho (si entró otro pedido durante la corrida,
        # queda pendiente y el próximo sondeo lo agarra).
        try:
            web._request("POST", "/api/bandeja/refresco/ack", body={"pedidoAt": pedido})
        except Exception as e:  # noqa: BLE001
            log(f"no pude marcar el refresco como hecho: {e!r}")


if __name__ == "__main__":  # pragma: no cover
    try:
        run()
    except Exception as exc:  # noqa: BLE001
        import traceback
        log(f"FALLO: {exc!r}")
        log(traceback.format_exc())
