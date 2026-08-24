"""Reintento nocturno de las bandejas que quedaron con error.

La corrida principal (bandeja_sync.py, 20:00) a veces falla en algún cliente por
un parpadeo transitorio de la web (HTTP 502 durante un deploy de Railway) o de
PAMI. Este script corre más tarde (22:00), le pregunta a la web qué clientes
quedaron con error en el último sync y **re-baja solo esos** — no todos.

Si no hay ninguno con error, no hace nada (ni avisa, para no meter ruido). Si
reintenta, avisa por Telegram cuántos recuperó y cuáles siguen fallando.

Uso manual:  python bandeja_retry.py [2026-07]
"""
from __future__ import annotations

import sys

import bandeja_sync
from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config


def _slugs_con_error(estados: dict) -> list[str]:
    """De los estados de la web, los slugs cuyo último sync quedó en error.

    Excluye los que NO bajan bandeja (médicos de cabecera: Navarro, Scheffelaar).
    Si no, el reintento los corre con only_slugs (que saltea la exclusión del
    barrido) y el error de login se auto-perpetúa para siempre."""
    fallados = []
    for slug, est in (estados or {}).items():
        if slug in bandeja_sync.EXCLUIDOS_AUTO:
            continue
        if isinstance(est, dict) and not est.get("ok"):
            fallados.append(slug)
    return fallados


def run(period: str | None = None, progress=None) -> dict:
    prog = progress or (lambda m: print("  ", m))
    cfg = load_config()
    web = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
    web.login(cfg.get("username", ""), cfg.get("password", ""))

    try:
        estados = web.bandeja_estados()
    except Exception as exc:  # noqa: BLE001
        prog(f"no pude leer los estados de la web: {exc!r}")
        return {"reintentados": 0, "recuperados": 0, "siguen": [], "error": str(exc)}

    fallados = _slugs_con_error(estados)
    if not fallados:
        prog("no hay bandejas con error; nada que reintentar.")
        return {"reintentados": 0, "recuperados": 0, "siguen": []}

    prog(f"reintentando {len(fallados)}: {', '.join(fallados)}")
    resultados = bandeja_sync.sync_all(period, only_slugs=fallados, progress=prog)

    ok = [r for r in resultados if r.get("ok")]
    siguen = [r for r in resultados if not r.get("ok")]
    resumen = {
        "reintentados": len(resultados),
        "recuperados": len(ok),
        "siguen": [r.get("name") or r.get("slug") for r in siguen],
    }

    # Aviso por Telegram: solo si efectivamente reintentamos algo. Separa
    # 'clave equivocada' de 'error transitorio' (mismo formato que el sync).
    try:
        cuerpo = bandeja_sync.armar_aviso_telegram(
            resultados, bandeja_sync._current_period(), titulo="Reintento bandejas")
        msg = f"🔁 Recuperados {len(ok)}/{len(resultados)}.\n{cuerpo}"
        web.avisar(msg)
        prog("aviso Telegram enviado")
    except Exception as e:  # noqa: BLE001 - el aviso no debe cortar el reintento
        prog(f"no pude enviar el aviso Telegram: {e!r}")

    return resumen


if __name__ == "__main__":  # pragma: no cover
    period_arg = sys.argv[1] if len(sys.argv) > 1 else None
    print("Reintento de bandejas con error…")
    res = run(period_arg)
    print(f"  → reintentados {res['reintentados']} · recuperados {res['recuperados']}"
          + (f" · siguen: {', '.join(res['siguen'])}" if res.get("siguen") else ""))
