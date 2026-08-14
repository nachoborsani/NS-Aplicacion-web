"""Fuente central del nomenclador para la app de escritorio (Opción A).

La web NS es la única fuente: los módulos (OME, Activar, resolver de plan de
salud) leen el nomenclador del período de trabajo elegido, tomado del cache que
dejó la pantalla 'Conexión con NS'. El período de trabajo por defecto es siempre
el último descargado; se puede fijar otro y queda recordado.

`catalog_rows(period)` devuelve las filas en el MISMO formato posicional que traía
el Excel (row[0]=código de módulo, row[1]=descripción de módulo, row[2]=código de
práctica, row[3]=descripción de práctica, row[4]=""), así cada módulo reutiliza su
propia lógica de armado de PracticeCatalogItem sin cambios.
"""

from __future__ import annotations

from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config, save_config

WORKING_KEY = "working_period"


def _client() -> NSWebClient:
    return NSWebClient(load_config().get("base_url") or DEFAULT_BASE_URL)


def available_periods() -> list[str]:
    """Meses descargados en esta PC, ordenados ascendente (el último es el más nuevo)."""
    try:
        return _client().cached_periods()
    except Exception:
        return []


def working_period() -> str:
    """Período de trabajo: el elegido (si está y sigue descargado), si no el último."""
    periods = available_periods()
    if not periods:
        return ""
    chosen = load_config().get(WORKING_KEY)
    if chosen and chosen in periods:
        return chosen
    return periods[-1]


def set_working_period(period: str) -> None:
    cfg = load_config()
    cfg[WORKING_KEY] = period or ""
    save_config(cfg)


def has_catalog(period: str | None = None) -> bool:
    period = period or working_period()
    return bool(period) and _client().cached_catalog(period) is not None


def catalog_meta(period: str | None = None) -> dict | None:
    """Devuelve {period, label, count, rowCount, complete} del cache, o None."""
    period = period or working_period()
    if not period:
        return None
    cat = _client().cached_catalog(period)
    if not cat:
        return None
    return {
        "period": cat.get("period", period),
        "label": cat.get("label", period),
        "count": cat.get("count", len(cat.get("practicas", []))),
        "rowCount": cat.get("rowCount", 0),
        "complete": cat.get("complete", True),
    }


def catalog_rows(period: str | None = None) -> list[tuple]:
    """Filas del nomenclador del período, en formato posicional tipo Excel.

    (module_code, module_name, practice_code, practice_description, "")
    Lista vacía si no hay nada descargado para ese período.
    """
    period = period or working_period()
    if not period:
        return []
    cat = _client().cached_catalog(period)
    if not cat:
        return []
    rows: list[tuple] = []
    for p in cat.get("practicas", []):
        rows.append((
            getattr(p, "module_code", "") or (p.get("module_code", "") if isinstance(p, dict) else ""),
            getattr(p, "module_name", "") or (p.get("module_name", "") if isinstance(p, dict) else ""),
            getattr(p, "code", "") or (p.get("code", "") if isinstance(p, dict) else ""),
            getattr(p, "description", "") or (p.get("description", "") if isinstance(p, dict) else ""),
            "",
        ))
    return rows
