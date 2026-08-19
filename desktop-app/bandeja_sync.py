"""Sincroniza la bandeja del mes de cada cliente: PAMI -> web.

Para cada cliente: baja usuario/clave PAMI de la web, abre PAMI (sin ventana),
exporta la bandeja del mes (mismos filtros que Transmisión, dejando *validada* y
*transmitida* vacías -> trae TODA la bandeja), la parsea y la sube a la web para
que se vea en el panel "Dashboard mes en curso".

Pensado para correr de noche (tarea programada de Windows). NO transmite nada:
solo exporta y sube. Uso manual:  python bandeja_sync.py [2026-07] [slug1,slug2]
"""

from __future__ import annotations

import calendar
import json
import sys
import tempfile
import time
import traceback
from datetime import date
from pathlib import Path

from openpyxl import load_workbook

from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config

_MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
          "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

# Techo de espera para la transmisión de un cliente (el bot puede hacer varios
# barridos). Generoso para el backlog de la 1ra corrida; las diarias terminan
# en segundos. Si vence, seguimos con la descarga igual y reportamos lo que haya.
_TRANSMIT_TIMEOUT_S = 1800


def _current_period() -> str:
    t = date.today()
    return f"{t.year}-{t.month:02d}"


# --------------------------------------------------------------------------- #
# Transmisión automática (1 vez por día por cliente)
# --------------------------------------------------------------------------- #
def _transmit_state_path() -> Path:
    try:
        from app_paths import get_data_dir
        return get_data_dir() / "transmit_state.json"
    except Exception:
        return Path(tempfile.gettempdir()) / "transmit_state.json"


def _load_transmit_state() -> dict:
    try:
        return json.loads(_transmit_state_path().read_text("utf-8"))
    except Exception:
        return {}


def _ya_transmitido_hoy(slug: str) -> bool:
    return _load_transmit_state().get(slug) == date.today().isoformat()


def _marcar_transmitido_hoy(slug: str) -> None:
    st = _load_transmit_state()
    st[slug] = date.today().isoformat()
    try:
        p = _transmit_state_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(st, ensure_ascii=False, indent=2), "utf-8")
    except Exception:
        pass


def _correr_transmision(bot, desde: str, hasta: str, progress=None) -> dict:
    """Corre el bot de transmisión (solo valida=Sí, transmitida=No) y espera a que
    termine. El bot solo transmite OMEs con informe cargado; las que les falta
    informe las saltea. Devuelve {transmitidas, errores, lastError, status}."""
    bot.iniciar_bot({
        "fecha_desde": desde, "fecha_hasta": hasta,
        "validada": "Si", "transmitida": "No",
    })
    estado: dict = {}
    completo = False
    fin = time.monotonic() + _TRANSMIT_TIMEOUT_S
    while time.monotonic() < fin:
        estado = bot.obtener_estado() or {}
        if progress:
            progress(f"transmitiendo… {estado.get('procesados', 0)} enviadas")
        if estado.get("status") in ("DONE", "ERROR"):
            completo = True
            break
        time.sleep(3)
    return {
        "transmitidas": int(estado.get("procesados") or 0),
        "errores": int(estado.get("errores") or 0),
        "lastError": str(estado.get("lastError") or ""),
        "status": str(estado.get("status") or "TIMEOUT"),
        "completo": completo,  # False = cortó por timeout, quedaron pendientes
    }


def month_range(period: str) -> tuple[str, str, str]:
    """'2026-07' -> ('01/07/2026', '31/07/2026', 'Julio 2026'). Fechas en formato PAMI.

    Para el MES EN CURSO cortamos en AYER (días cerrados), no en fin de mes: así no
    traemos turnos futuros ya agendados que todavía no pasaron. Los meses pasados
    se bajan completos. (Idea a futuro: informar también la proyección del mes
    completo — ver memoria ns-bandeja-sync-mes-en-curso.)
    """
    year, month = int(period[:4]), int(period[5:7])
    last = calendar.monthrange(year, month)[1]
    hasta_dia = last
    hoy = date.today()
    if (year, month) == (hoy.year, hoy.month):
        hasta_dia = max(1, hoy.day - 1)  # hasta ayer (clamp al día 1)
    return f"01/{month:02d}/{year}", f"{hasta_dia:02d}/{month:02d}/{year}", f"{_MESES[month]} {year}"


def parse_bandeja_excel(path: str) -> tuple[list[dict], list[str]]:
    """Lee el Excel exportado y devuelve (filas como dicts, columnas). La primera
    fila no vacía se toma como encabezado."""
    workbook = load_workbook(path, read_only=True, data_only=True)
    ws = workbook.active
    rows_iter = ws.iter_rows(values_only=True)

    header = None
    for raw in rows_iter:
        if raw and any(cell not in (None, "") for cell in raw):
            header = [str(cell).strip() if cell is not None else "" for cell in raw]
            break
    if not header:
        return [], []

    columns = [h for h in header if h]
    data: list[dict] = []
    for raw in rows_iter:
        if not raw or all(cell in (None, "") for cell in raw):
            continue
        row: dict = {}
        for i, name in enumerate(header):
            if not name:
                continue
            value = raw[i] if i < len(raw) else None
            row[name] = "" if value is None else str(value)
        data.append(row)
    return data, columns


def sync_client(web: NSWebClient, client: dict, period: str, progress=None,
                transmitir: bool = False) -> dict:
    """Baja la bandeja de un cliente y la sube. Si transmitir=True y todavía no se
    transmitió hoy, corre el bot de transmisión ANTES de exportar (1x/día). Nunca
    lanza: devuelve el resultado."""
    slug = client.get("slug", "")
    name = client.get("name", slug)
    try:
        cred = web.client_pami(slug)
    except Exception as exc:  # noqa: BLE001
        return {"slug": slug, "name": name, "ok": False, "error": f"credenciales: {exc}"}
    if not cred.get("pamiUser") or not cred.get("pamiPassword"):
        return {"slug": slug, "name": name, "ok": False, "error": "sin usuario/clave PAMI cargados en la web"}

    desde, hasta, label = month_range(period)
    tmp = Path(tempfile.gettempdir()) / f"bandeja_{slug}_{period}.xlsx"
    transmit_info = None
    try:
        from pami_transmision import PamiTransmisionController

        bot = PamiTransmisionController()
        try:
            bot.abrir_pami(usuario=cred["pamiUser"], clave=cred["pamiPassword"], headless=True)
            # 1) Transmitir pendientes del rango (1x/día). El bot solo transmite las
            #    que tienen informe cargado; el resto queda para "faltan informes".
            if transmitir and not _ya_transmitido_hoy(slug):
                if progress:
                    progress(f"{name}: transmitiendo pendientes…")
                transmit_info = _correr_transmision(bot, desde, hasta, progress=progress)
                _marcar_transmitido_hoy(slug)
            # 2) Exportar la bandeja completa (validada/transmitida vacías).
            if progress:
                progress(f"{name}: bajando bandeja…")
            exported = bot.exportar_excel_panel(str(tmp), {"fecha_desde": desde, "fecha_hasta": hasta})
        finally:
            try:
                bot.cerrar()
            except Exception:  # noqa: BLE001
                pass

        rows, columns = parse_bandeja_excel(exported)
        web.upload_bandeja(slug, period, rows, columns=columns, month_label=label,
                           generated_at=date.today().isoformat())
        res = {"slug": slug, "name": name, "ok": True, "count": len(rows)}
        if transmit_info is not None:
            res["transmit"] = transmit_info
        return res
    except Exception as exc:  # noqa: BLE001
        return {"slug": slug, "name": name, "ok": False, "error": str(exc),
                "trace": traceback.format_exc()}


def sync_all(period: str | None = None, only_slugs: list[str] | None = None,
             base_url: str = "", admin_user: str = "", admin_pass: str = "",
             progress=None, transmitir: bool | None = None) -> list[dict]:
    """Recorre los clientes de la web y sincroniza la bandeja de cada uno.

    Se conecta con una cuenta ADMIN (el endpoint de credenciales es admin-only).
    Por defecto usa la conexión guardada en 'Conexión con NS'. Si transmitir es
    None, lo lee de la config del panel 'Refresco automático'.
    """
    cfg = load_config()
    web = NSWebClient(base_url or cfg.get("base_url") or DEFAULT_BASE_URL)
    web.login(admin_user or cfg.get("username", ""), admin_pass or cfg.get("password", ""))
    period = period or _current_period()
    if transmitir is None:
        try:
            import bandeja_schedule
            transmitir = bool(bandeja_schedule.load_config().get("transmitir"))
        except Exception:  # noqa: BLE001
            transmitir = False

    results: list[dict] = []
    for client in web.list_clients():
        if only_slugs and client.get("slug") not in only_slugs:
            continue
        res = sync_client(web, client, period, progress=progress, transmitir=transmitir)
        # Reportamos el resultado (ok/error + transmisión) para el indicador de salud.
        try:
            t = res.get("transmit") or {}
            web.report_bandeja_estado(
                res.get("slug", ""), res.get("ok"), res.get("count"), res.get("error", ""),
                transmitidas=t.get("transmitidas"), transmit_errores=t.get("errores"),
                transmit_error=t.get("lastError"),
            )
        except Exception:  # noqa: BLE001 - un fallo del reporte no corta el sync
            pass
        results.append(res)
    return results


if __name__ == "__main__":  # pragma: no cover
    period_arg = sys.argv[1] if len(sys.argv) > 1 else None
    slugs_arg = sys.argv[2].split(",") if len(sys.argv) > 2 else None
    print(f"Sincronizando bandeja {period_arg or _current_period()} …")
    for r in sync_all(period_arg, only_slugs=slugs_arg, progress=lambda m: print("  ", m)):
        estado = f"OK — {r.get('count')} filas" if r.get("ok") else f"FALLO — {r.get('error')}"
        print(f"  {r['name'][:32]:32} -> {estado}")
