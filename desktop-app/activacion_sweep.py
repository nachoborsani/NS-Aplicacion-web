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

    fecha = proximo_habil()
    cur = datetime.strptime(f"{fecha} {HORA_INICIO}", "%d/%m/%Y %H:%M")
    log(f"Fecha de los turnos: {fecha} (desde {HORA_INICIO}, cada {INTERVALO_MIN} min).")

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
                log(f"  fila {c['sheet_row']} · {c['nombre']} · OME {c['ome']} → ACTIVADA "
                    f"({entry['fecha']} {entry['hora']}:{entry['minuto']})")
            else:
                errores += 1
                log(f"  fila {c['sheet_row']} · {c['nombre']} · OME {c['ome']} → {estado} "
                    f"({getattr(det, 'mensaje', '') if det else ''})")
            cur += timedelta(minutes=INTERVALO_MIN)
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
