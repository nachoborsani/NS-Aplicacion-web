"""Barrido de activación de OMEs de cabecera (Scheffelaar).

Toma las filas desde START_ROW que YA tienen OME (col H) y todavía NO están
activadas/validadas (col M "Validacion" vacía), y agenda el turno en PAMI vía
PamiActivarController (escenario A: aceptación directa). Marca la col M como
"ACTIVADA" apenas cada una queda ACEPTADA, así un corte/reintento NO re-activa
(no duplica turnos).

Reglas de negocio (definidas con el dueño):
  - Fecha del turno = día siguiente HÁBIL (mañana; si cae finde, el lunes).
  - Horarios desde 10:00, escalonados cada 15 min (10:00, 10:15, 10:30…).
  - Modalidad presencial. Boca: la que ofrezca PAMI (automática).
  - Col M: vacía=candidata · "ACTIVADA"=nuestra · "SI"=validada por el empleado.

Uso:  python activacion_sweep.py 1     # prueba: solo 1 candidata
      python activacion_sweep.py       # todas las pendientes desde START_ROW
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timedelta

from cadena_clientes import get_cliente
from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config
from pami_activar import PamiActivarController
from google_sheets_ome import build_sheets_service, extract_spreadsheet_id

CLIENTE_SLUG_DEFAULT = "scheffelaar-mc"
HORA_INICIO = "10:00"
INTERVALO_MIN = 15
MODALIDAD = "P"


def log(m: str) -> None:
    print(m, flush=True)


def _cell(row: list, i: int) -> str:
    return str(row[i]).strip() if i < len(row) else ""


# --- Próximo slot de turno libre por cliente ---------------------------------
# Los turnos se agendan en una ventana [hora_inicio, hora_tope] cada N min (según
# el cliente: Scheffelaar 10:00-19:00 c/15, Dube 08:00-19:00 c/10). Como la cadena
# corre 3 veces al día (10/17/19:30) y todas apuntan al MISMO día hábil, sin
# memoria cada corrida arrancaría de nuevo en la hora de inicio y pisaría los slots
# de la corrida anterior. Guardamos el PRÓXIMO slot libre por cliente (persistido)
# para que cada corrida siga desde ahí. Si un día se llena (pasa del tope), el slot
# desborda al próximo día hábil. Scheffelaar y Dube llevan cuentas separadas
# (prestadores distintos, sus turnos no chocan entre sí).
_SLOTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "activacion_slots.json")


def _slots_load() -> dict:
    try:
        with open(_SLOTS_FILE, encoding="utf-8") as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _parse_hhmm(s, default: str = "10:00") -> tuple[int, int]:
    try:
        h, m = str(s).split(":")
        return int(h), int(m)
    except Exception:
        h, m = default.split(":")
        return int(h), int(m)


def _proximo_habil_desde(d: date) -> date:
    while d.weekday() >= 5:      # 5=sábado, 6=domingo → saltar al lunes
        d += timedelta(days=1)
    return d


def siguiente_slot(dt: datetime, h_ini: int, m_ini: int, h_top: int, m_top: int, intervalo: int) -> datetime:
    """El slot que sigue a dt; si pasa del tope, salta al próximo día hábil al inicio."""
    nxt = dt + timedelta(minutes=intervalo)
    tope = nxt.replace(hour=h_top, minute=m_top, second=0, microsecond=0)
    if nxt <= tope:
        return nxt
    d = _proximo_habil_desde(nxt.date() + timedelta(days=1))
    return datetime(d.year, d.month, d.day, h_ini, m_ini)


def slots_next(cliente_slug: str):
    """Próximo slot libre guardado para ese cliente (datetime) o None."""
    v = _slots_load().get(cliente_slug)
    try:
        return datetime.strptime(v, "%Y-%m-%d %H:%M") if v else None
    except Exception:
        return None


def slots_set_next(cliente_slug: str, dt: datetime) -> None:
    d = _slots_load()
    d[cliente_slug] = dt.strftime("%Y-%m-%d %H:%M")
    try:
        with open(_SLOTS_FILE, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log(f"  (aviso: no pude guardar el próximo turno: {e})")


def _solo_digitos(s: str) -> str:
    return "".join(c for c in str(s) if c.isdigit())


def _col_letter(i0: int) -> str:
    s, n = "", i0
    while True:
        s = chr(ord("A") + n % 26) + s
        n = n // 26 - 1
        if n < 0:
            break
    return s


def proximo_habil() -> str:
    d = date.today() + timedelta(days=1)
    while d.weekday() >= 5:      # 5=sábado, 6=domingo → saltar al lunes
        d += timedelta(days=1)
    return d.strftime("%d/%m/%Y")


def run(cliente_slug: str = CLIENTE_SLUG_DEFAULT, limite: int | None = None,
        progress=None, solo_filas=None) -> dict:
    # solo_filas: si viene, activar SOLO esas filas (lo generado en la tanda de la
    # cadena), no todo el backlog. Igual se respeta el chequeo de la col de
    # activación vacía (no re-activa lo ya activado → no duplica turnos).
    C = get_cliente(cliente_slug)
    nombre = C.get("nombre", cliente_slug)
    start_row = int(C.get("start_row") or 2)
    cols = C["cols"]
    col_ome = cols["ome"]
    col_activ = cols["activacion"]       # donde marcamos activada / fecha
    col_benef = cols.get("benef")
    col_dni = cols.get("dni")
    col_nombre = cols.get("nombre")
    # Qué se escribe al activar: "ACTIVADA" (texto) o la fecha del turno.
    marca_es_fecha = str(C.get("activacion_marca", "ACTIVADA")).upper() == "FECHA"

    filas_permitidas = {int(f) for f in solo_filas} if solo_filas else None
    cfg = load_config()
    web = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
    web.login(cfg.get("username", ""), cfg.get("password", ""))
    cred = web.client_pami(cliente_slug)
    user = str(cred.get("pamiUser", "")).strip()
    clave = str(cred.get("pamiPassword", "") or "")
    if not user or not clave:
        log(f"{nombre} no tiene usuario/clave PAMI cargados en la web.")
        return {"error": "sin clave PAMI"}

    svc = build_sheets_service(interactive=False)
    sid = extract_spreadsheet_id(C["spreadsheet"])
    values = svc.spreadsheets().values().get(
        spreadsheetId=sid, range=f"{C['sheet_name']}!A{start_row}:R", majorDimension="ROWS",
    ).execute().get("values", [])

    candidatos = []
    for offset, row in enumerate(values):
        sheet_row = start_row + offset
        if filas_permitidas is not None and sheet_row not in filas_permitidas:
            continue                      # fuera de la tanda pedida
        ome = _solo_digitos(_cell(row, col_ome))
        if not ome:                       # sin OME → no se puede activar
            continue
        if _cell(row, col_activ):         # col activación no vacía → ya activada, saltear
            continue
        candidatos.append({
            "sheet_row": sheet_row,
            "ome": ome,
            "benef": _cell(row, col_benef) if col_benef is not None else "",
            "dni": _cell(row, col_dni) if col_dni is not None else "",
            "nombre": _cell(row, col_nombre) if col_nombre is not None else "",
        })

    if limite:
        candidatos = candidatos[:limite]
    log(f"{nombre}: candidatos a activar (con OME, sin activar, desde {start_row}): {len(candidatos)}")
    if not candidatos:
        return {"candidatos": 0, "activadas": 0, "errores": 0}

    h_ini, m_ini = _parse_hhmm(C.get("activacion_hora_inicio", HORA_INICIO))
    h_top, m_top = _parse_hhmm(C.get("activacion_hora_tope", "19:00"))
    intervalo = int(C.get("activacion_intervalo_min", INTERVALO_MIN) or INTERVALO_MIN)
    d0 = _proximo_habil_desde(date.today() + timedelta(days=1))
    base = datetime(d0.year, d0.month, d0.day, h_ini, m_ini)   # primer slot del próximo día hábil
    prev = slots_next(cliente_slug)
    cur = prev if (prev and prev >= base) else base
    if cur > base:
        log(f"Sigo desde el próximo slot libre: {cur:%d/%m/%Y %H:%M} "
            f"(no piso los turnos de corridas anteriores).")
    else:
        log(f"Turnos desde {cur:%d/%m/%Y %H:%M}, cada {intervalo} min, tope {h_top:02d}:{m_top:02d}.")

    ctrl = PamiActivarController(log_callback=log, status_callback=lambda m: None)
    ctrl.abrir_panel(usuario=user, clave=clave, headless=True)
    activadas = errores = 0
    try:
        for i, c in enumerate(candidatos, 1):
            entry = {
                "n_afiliado": c["benef"] or c["dni"],
                "n_orden": c["ome"],
                "fecha": cur.strftime("%d/%m/%Y"),
                "hora": cur.strftime("%H"),
                "minuto": cur.strftime("%M"),
                "modalidad": MODALIDAD, "practica": "", "boca": "",
            }
            if progress:
                progress(f"{i}/{len(candidatos)} · {c['nombre']} · {entry['hora']}:{entry['minuto']}")
            resultado = ctrl.activar_lote(lote=[entry])
            det = resultado.detalle[0] if resultado.detalle else None
            estado = getattr(det, "estado_final", "ERROR") if det else "ERROR"
            if estado == "ACEPTADA":
                # Marcar la col de activación INMEDIATAMENTE (si se corta, el
                # reintento la saltea). Texto "ACTIVADA" o la fecha del turno.
                marca = entry["fecha"] if marca_es_fecha else "ACTIVADA"
                svc.spreadsheets().values().update(
                    spreadsheetId=sid,
                    range=f"{C['sheet_name']}!{_col_letter(col_activ)}{c['sheet_row']}",
                    valueInputOption="USER_ENTERED",
                    body={"values": [[marca]]},
                ).execute()
                activadas += 1
                cur = siguiente_slot(cur, h_ini, m_ini, h_top, m_top, intervalo)  # avanza (con tope/desborde)
                slots_set_next(cliente_slug, cur)     # persistir el próximo libre
                log(f"  fila {c['sheet_row']} · {c['nombre']} · OME {c['ome']} → ACTIVADA "
                    f"({entry['fecha']} {entry['hora']}:{entry['minuto']})")
            else:
                errores += 1
                # NO avanzamos el reloj: el slot no se ocupó, lo usa el próximo candidato.
                log(f"  fila {c['sheet_row']} · {c['nombre']} · OME {c['ome']} → {estado} "
                    f"({getattr(det, 'mensaje', '') if det else ''})")
    finally:
        ctrl.cerrar_navegador()

    log(f"=== listo: {activadas} activadas · {errores} con error · de {len(candidatos)} candidatas ===")
    return {"candidatos": len(candidatos), "activadas": activadas, "errores": errores}


if __name__ == "__main__":
    _slug = CLIENTE_SLUG_DEFAULT
    _lim = None
    for _a in sys.argv[1:]:
        if _a.isdigit():
            _lim = int(_a)
        elif "-" in _a:
            _slug = _a
    run(cliente_slug=_slug, limite=_lim, progress=lambda m: None)
