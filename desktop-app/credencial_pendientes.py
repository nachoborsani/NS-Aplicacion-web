# -*- coding: utf-8 -*-
"""
Deja lista la credencial de las filas que la cadena por sí sola no agarra.

La cadena solo dispara la credencial de las filas NUEVAS del barrido de benef. Las
filas que ya venían con beneficio quedan colgadas. Esto las resuelve SIN duplicar:

  - Si el paciente YA tiene la credencial (hay un gemelo DESCARGADA por DNI o por
    beneficio) → el PDF ya está en Drive, así que se copia **la celda tal cual del
    gemelo** (la fórmula con el link, ej. =HIPERVINCULO(...;"DESCARGADA")). NO se
    re-baja.
  - Si no la tiene nadie → se devuelve para que la cadena la baje (una vez).

Lee con valueRenderOption=FORMULA para traer la fórmula del gemelo y la escribe con
USER_ENTERED para que quede como link vivo, no como texto.
"""
from google_sheets_ome import (
    build_sheets_service, extract_spreadsheet_id, _execute_sheets_request, _column_letter,
)
from google_sheets_credenciales import _resolve_sheet_name


def _dig(s):
    return "".join(c for c in str(s or "") if c.isdigit())


def _tiene_descargada(cel: str) -> bool:
    return "DESCARGADA" in str(cel or "").upper()


def _es_formula(cel: str) -> bool:
    return str(cel or "").lstrip().startswith("=")


def preparar(cli: dict) -> dict:
    """Marca/copiala credencial de las filas que reusan y devuelve las que hay que
    bajar. Devuelve {"reusadas": int, "bajar": list[int], "sin_col": bool}."""
    C = cli["cols"]
    if any(k not in C for k in ("benef", "dni", "tramite", "credencial", "ome")):
        # Ej. Scheffelaar no tiene columna de trámite en la planilla.
        return {"reusadas": 0, "bajar": [], "sin_col": True}
    ci_b, ci_d, ci_t, ci_c, ci_o = C["benef"], C["dni"], C["tramite"], C["credencial"], C["ome"]
    start_row = int(cli.get("start_row", 2))

    spreadsheet_id = extract_spreadsheet_id(cli["spreadsheet"])
    service = build_sheets_service(interactive=False)
    sheet_name = _resolve_sheet_name(service, spreadsheet_id, cli["sheet_name"])
    # FORMULA: trae la fórmula (=HIPERVINCULO...) de las celdas de credencial.
    values = _execute_sheets_request(
        service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f"'{sheet_name}'!A2:O",
            valueRenderOption="FORMULA",
        )
    ).get("values", [])

    def cell(r, i):
        return (r[i] if i < len(r) else "") or ""

    # Contenido de credencial "bueno" por paciente (prioriza la fórmula con link).
    cred_dni, cred_benef = {}, {}
    def guardar(mapa, clave, contenido):
        if not clave:
            return
        prev = mapa.get(clave)
        if prev is None or (_es_formula(contenido) and not _es_formula(prev)):
            mapa[clave] = contenido
    for r in values:
        cel_c = cell(r, ci_c)
        if _tiene_descargada(cel_c):
            guardar(cred_dni, _dig(cell(r, ci_d)), cel_c)
            guardar(cred_benef, _dig(cell(r, ci_b)), cel_c)

    updates, bajar = [], []
    for idx, r in enumerate(values):
        sheet_row = idx + 2
        if sheet_row < start_row:
            continue
        benef, dni, tram = _dig(cell(r, ci_b)), _dig(cell(r, ci_d)), _dig(cell(r, ci_t))
        cel_c = cell(r, ci_c)
        ome = str(cell(r, ci_o)).strip()
        if not (benef and dni and tram) or ome or _tiene_descargada(cel_c):
            continue
        gemelo = cred_dni.get(dni) or cred_benef.get(benef)
        if gemelo:
            updates.append({"range": f"'{sheet_name}'!{_column_letter(ci_c)}{sheet_row}", "values": [[gemelo]]})
        else:
            bajar.append(sheet_row)

    if updates:
        _execute_sheets_request(
            service.spreadsheets().values().batchUpdate(
                spreadsheetId=spreadsheet_id,
                # USER_ENTERED: interpreta la fórmula como link vivo, no como texto.
                body={"valueInputOption": "USER_ENTERED", "data": updates},
            )
        )
    return {"reusadas": len(updates), "bajar": bajar, "sin_col": False}


# Corrección puntual: filas que quedaron con "DESCARGADA" en TEXTO PLANO (sin link)
# porque una versión anterior las marcó a mano. Les copia la fórmula del gemelo.
def corregir_links_planos(cli: dict) -> dict:
    C = cli["cols"]
    if any(k not in C for k in ("benef", "dni", "credencial")):
        return {"corregidas": 0}
    ci_b, ci_d, ci_c = C["benef"], C["dni"], C["credencial"]
    start_row = int(cli.get("start_row", 2))
    spreadsheet_id = extract_spreadsheet_id(cli["spreadsheet"])
    service = build_sheets_service(interactive=False)
    sheet_name = _resolve_sheet_name(service, spreadsheet_id, cli["sheet_name"])
    values = _execute_sheets_request(
        service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f"'{sheet_name}'!A2:O",
            valueRenderOption="FORMULA",
        )
    ).get("values", [])

    def cell(r, i):
        return (r[i] if i < len(r) else "") or ""

    # Fórmulas-link buenas por paciente.
    f_dni, f_benef = {}, {}
    for r in values:
        cel = cell(r, ci_c)
        if _tiene_descargada(cel) and _es_formula(cel):
            if _dig(cell(r, ci_d)): f_dni.setdefault(_dig(cell(r, ci_d)), cel)
            if _dig(cell(r, ci_b)): f_benef.setdefault(_dig(cell(r, ci_b)), cel)

    updates = []
    for idx, r in enumerate(values):
        sheet_row = idx + 2
        if sheet_row < start_row:
            continue
        cel = cell(r, ci_c)
        # Plano = dice DESCARGADA pero NO es fórmula (no tiene el link).
        if _tiene_descargada(cel) and not _es_formula(cel):
            gemelo = f_dni.get(_dig(cell(r, ci_d))) or f_benef.get(_dig(cell(r, ci_b)))
            if gemelo:
                updates.append({"range": f"'{sheet_name}'!{_column_letter(ci_c)}{sheet_row}", "values": [[gemelo]]})
    if updates:
        _execute_sheets_request(
            service.spreadsheets().values().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"valueInputOption": "USER_ENTERED", "data": updates},
            )
        )
    return {"corregidas": len(updates)}
