from __future__ import annotations

import re

from google_sheets_ome import (
    _execute_sheets_request,
    _normalize_header,
    build_sheets_service,
    extract_spreadsheet_id,
)


def _cell_string(cell: dict) -> str:
    for key in ("formattedValue",):
        value = cell.get(key)
        if value is not None:
            return str(value).strip()
    value_data = cell.get("effectiveValue") or cell.get("userEnteredValue") or {}
    for key in ("stringValue", "numberValue", "formulaValue"):
        value = value_data.get(key)
        if value is not None:
            return str(value).strip()
    return ""


def _cell_link(cell: dict) -> str:
    direct = str(cell.get("hyperlink") or "").strip()
    if direct:
        return direct

    text_format = ((cell.get("userEnteredFormat") or {}).get("textFormat") or {})
    link = str((text_format.get("link") or {}).get("uri") or "").strip()
    if link:
        return link

    for run in cell.get("textFormatRuns") or []:
        run_link = str((((run.get("format") or {}).get("link") or {}).get("uri")) or "").strip()
        if run_link:
            return run_link

    formula = str((cell.get("userEnteredValue") or {}).get("formulaValue") or "").strip()
    match = re.search(r'HYPERLINK\("([^"]+)"\s*[,;]', formula, flags=re.I)
    if match:
        return match.group(1).strip()
    return ""


def _find_header(headers: list[str], *aliases: str) -> int | None:
    normalized = [_normalize_header(header) for header in headers]
    normalized_aliases = [_normalize_header(alias) for alias in aliases]
    for alias in normalized_aliases:
        for index, header in enumerate(normalized):
            if header and (header == alias or alias in header or header in alias):
                return index
    return None


def _resolve_first_sheet(service, spreadsheet_id: str, sheet_name: str = "") -> tuple[str, int]:
    response = _execute_sheets_request(
        service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="sheets.properties(title,sheetId,index)",
        )
    )
    sheets = response.get("sheets", [])
    if not sheets:
        raise RuntimeError("La planilla no tiene pestanas.")
    requested = str(sheet_name or "").strip()
    if requested:
        for sheet in sheets:
            props = sheet.get("properties", {})
            title = str(props.get("title", "")).strip()
            if title == requested or _normalize_header(title) == _normalize_header(requested):
                return title, int(props.get("sheetId") or 0)
        raise RuntimeError(f"No se encontro la pestana '{requested}'.")
    props = sorted((sheet.get("properties", {}) for sheet in sheets), key=lambda item: int(item.get("index") or 0))[0]
    return str(props.get("title", "")).strip(), int(props.get("sheetId") or 0)


def _quote_sheet_name(sheet_name: str) -> str:
    return "'" + str(sheet_name).replace("'", "''") + "'"


def _column_letter(index: int) -> str:
    if index < 0:
        raise ValueError("Indice de columna invalido.")
    result = ""
    current = index
    while current >= 0:
        current, remainder = divmod(current, 26)
        result = chr(65 + remainder) + result
        current -= 1
    return result


def _parse_column_label(value: str | int) -> int:
    if isinstance(value, int):
        return value
    raw = str(value or "").strip().upper()
    if not raw:
        raise ValueError("Falta la columna de validacion.")
    if raw.isdigit():
        return int(raw) - 1
    if not re.fullmatch(r"[A-Z]+", raw):
        raise ValueError(f"Columna invalida: {value}")
    index = 0
    for char in raw:
        index = index * 26 + (ord(char) - ord("A") + 1)
    return index - 1


def _digits(value: str) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def mark_validation_sheet_row(
    *,
    spreadsheet_url_or_id: str,
    sheet_name: str = "",
    ome: str = "",
    beneficio: str = "",
    value: str = "SI",
    validation_column: str | int = "O",
) -> dict:
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    service = build_sheets_service(interactive=False)
    resolved_name, sheet_id = _resolve_first_sheet(service, spreadsheet_id, sheet_name)

    response = _execute_sheets_request(
        service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            includeGridData=True,
            ranges=[f"{_quote_sheet_name(resolved_name)}!A1:Z"],
            fields="sheets(data(rowData(values(formattedValue,effectiveValue,userEnteredValue))))",
        )
    )
    sheet = (response.get("sheets") or [{}])[0]
    row_data = ((sheet.get("data") or [{}])[0].get("rowData") or [])
    if not row_data:
        raise RuntimeError("La planilla no tiene filas para buscar.")

    headers = [_cell_string(cell) for cell in (row_data[0].get("values") or [])]
    benef_col = _find_header(headers, "num benef", "numero benef", "nro benef", "benef", "beneficio", "afiliacion")
    ome_col = _find_header(headers, "ome", "nro ome", "numero ome", "numero de orden medica")
    if benef_col is None:
        benef_col = 0
    if ome_col is None:
        ome_col = 8

    target_ome = _digits(ome)
    target_benef = _digits(beneficio)
    if not target_ome and not target_benef:
        raise RuntimeError("Falta OME o beneficio para cruzar contra la planilla.")

    matches: list[dict] = []
    for row_number, row in enumerate(row_data[1:], start=2):
        cells = row.get("values") or []
        row_ome = _digits(_cell_string(cells[ome_col]) if ome_col < len(cells) else "")
        row_benef = _digits(_cell_string(cells[benef_col]) if benef_col < len(cells) else "")
        ome_ok = bool(target_ome and row_ome and row_ome == target_ome)
        benef_ok = bool(target_benef and row_benef and row_benef == target_benef)
        if target_ome and target_benef:
            matched = ome_ok and benef_ok
        else:
            matched = ome_ok or benef_ok
        if matched:
            matches.append(
                {
                    "sheet_row": row_number,
                    "ome": row_ome,
                    "beneficio": row_benef,
                }
            )

    if not matches:
        raise RuntimeError(f"No encontre fila para OME={ome or '-'} BENEF={beneficio or '-'}.")
    if len(matches) > 1:
        raise RuntimeError(f"Hay {len(matches)} filas que coinciden con OME/BENEF. No escribo para evitar error.")

    row_number = matches[0]["sheet_row"]
    validation_col_index = _parse_column_label(validation_column)
    validation_col_label = _column_letter(validation_col_index)
    range_name = f"{_quote_sheet_name(resolved_name)}!{validation_col_label}{row_number}"
    _execute_sheets_request(
        service.spreadsheets()
        .values()
        .update(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption="USER_ENTERED",
            body={"values": [[value]]},
        )
    )
    return {
        "sheet_name": resolved_name,
        "sheet_id": sheet_id,
        "sheet_row": row_number,
        "validation_column": validation_col_label,
        "value": value,
    }


def read_validation_sheet_rows(
    *,
    spreadsheet_url_or_id: str,
    sheet_name: str = "",
    start_row: int = 2,
    max_rows: int | None = None,
    credential_column_index: int = 13,
) -> list[dict]:
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    service = build_sheets_service(interactive=False)
    resolved_name, sheet_id = _resolve_first_sheet(service, spreadsheet_id, sheet_name)

    response = _execute_sheets_request(
        service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            includeGridData=True,
            ranges=[f"'{resolved_name}'!A1:Z"],
            fields=(
                "sheets(data(rowData(values(formattedValue,hyperlink,userEnteredValue,"
                "effectiveValue,userEnteredFormat/textFormat/link,textFormatRuns))))"
            ),
        )
    )
    sheet = (response.get("sheets") or [{}])[0]
    row_data = ((sheet.get("data") or [{}])[0].get("rowData") or [])
    if not row_data:
        return []

    header_cells = (row_data[0].get("values") or [])
    headers = [_cell_string(cell) for cell in header_cells]
    nombre_col = _find_header(headers, "nombre y apellido", "apellido y nombre", "nombre", "paciente")
    benef_col = _find_header(headers, "num benef", "numero benef", "nro benef", "benef", "beneficio", "afiliacion")
    dni_col = _find_header(headers, "dni", "documento")
    ome_col = _find_header(headers, "ome", "nro ome", "numero ome")
    credencial_col = credential_column_index

    rows: list[dict] = []
    start_index = max(int(start_row or 2) - 1, 1)
    for row_number, row in enumerate(row_data[start_index:], start=start_index + 1):
        cells = row.get("values") or []
        credential_cell = cells[credencial_col] if credencial_col < len(cells) else {}
        credential_status = _cell_string(credential_cell)
        credential_url = _cell_link(credential_cell)
        if _normalize_header(credential_status) != "descargada" and not credential_url:
            continue

        record = {
            "sheet_row": row_number,
            "sheet_name": resolved_name,
            "sheet_id": sheet_id,
            "paciente": _cell_string(cells[nombre_col]) if nombre_col is not None and nombre_col < len(cells) else "",
            "beneficio": _cell_string(cells[benef_col]) if benef_col is not None and benef_col < len(cells) else "",
            "dni": _cell_string(cells[dni_col]) if dni_col is not None and dni_col < len(cells) else "",
            "ome": _cell_string(cells[ome_col]) if ome_col is not None and ome_col < len(cells) else "",
            "credencial_estado": credential_status,
            "credencial_url": credential_url,
        }
        if not any((record["paciente"], record["beneficio"], record["dni"], record["ome"], record["credencial_url"])):
            continue
        rows.append(record)
        if max_rows is not None and max_rows > 0 and len(rows) >= max_rows:
            break
    return rows


def inspect_validation_sheet_rows(
    *,
    spreadsheet_url_or_id: str,
    sheet_name: str = "",
    start_row: int = 2,
    max_rows: int | None = None,
    credential_column_index: int = 13,
) -> dict:
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    service = build_sheets_service(interactive=False)
    resolved_name, sheet_id = _resolve_first_sheet(service, spreadsheet_id, sheet_name)

    end_row = start_row + max(max_rows or 25, 1) - 1
    response = _execute_sheets_request(
        service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            includeGridData=True,
            ranges=[f"'{resolved_name}'!A1:Z1", f"'{resolved_name}'!A{start_row}:Z{end_row}"],
            fields=(
                "sheets(data(rowData(values(formattedValue,hyperlink,userEnteredValue,"
                "effectiveValue,userEnteredFormat/textFormat/link,textFormatRuns))))"
            ),
        )
    )
    sheet = (response.get("sheets") or [{}])[0]
    data_blocks = sheet.get("data") or []
    header_rows = (data_blocks[0].get("rowData") or []) if data_blocks else []
    data_rows = (data_blocks[1].get("rowData") or []) if len(data_blocks) > 1 else []
    headers = [_cell_string(cell) for cell in ((header_rows[0].get("values") or []) if header_rows else [])]

    nombre_col = _find_header(headers, "nombre y apellido", "apellido y nombre", "nombre", "paciente")
    benef_col = _find_header(headers, "num benef", "numero benef", "nro benef", "benef", "beneficio", "afiliacion")
    dni_col = _find_header(headers, "dni", "documento")
    ome_col = _find_header(headers, "ome", "nro ome", "numero ome")

    samples: list[dict] = []
    matches = 0
    for offset, row in enumerate(data_rows, start=start_row):
        cells = row.get("values") or []
        credential_cell = cells[credential_column_index] if credential_column_index < len(cells) else {}
        status = _cell_string(credential_cell)
        link = _cell_link(credential_cell)
        if _normalize_header(status) == "descargada" or link:
            matches += 1
        if len(samples) < 10:
            samples.append(
                {
                    "sheet_row": offset,
                    "paciente": _cell_string(cells[nombre_col]) if nombre_col is not None and nombre_col < len(cells) else "",
                    "beneficio": _cell_string(cells[benef_col]) if benef_col is not None and benef_col < len(cells) else "",
                    "dni": _cell_string(cells[dni_col]) if dni_col is not None and dni_col < len(cells) else "",
                    "ome": _cell_string(cells[ome_col]) if ome_col is not None and ome_col < len(cells) else "",
                    "credencial_estado": status,
                    "credencial_link": link,
                }
            )
    return {
        "sheet_name": resolved_name,
        "sheet_id": sheet_id,
        "start_row": start_row,
        "end_row": end_row,
        "credential_column": "N" if credential_column_index == 13 else str(credential_column_index + 1),
        "rows_seen": len(data_rows),
        "matches": matches,
        "samples": samples,
    }
