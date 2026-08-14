from __future__ import annotations

import re
from pathlib import Path

from google_sheets_ome import (
    OFFICE_FILE_MESSAGE,
    _column_letter,
    _execute_sheets_request,
    _normalize_header,
    build_sheets_service,
    extract_spreadsheet_id,
    is_office_file_url,
    normalize_spreadsheet_url,
)


def _find_credencial_header_index(headers: list[str], *aliases: str) -> int | None:
    normalized_headers = [_normalize_header(header) for header in headers]
    normalized_aliases = [_normalize_header(alias) for alias in aliases if alias]

    for alias in normalized_aliases:
        for index, header in enumerate(normalized_headers):
            if header and header == alias:
                return index

    for alias in normalized_aliases:
        if len(alias) < 4:
            continue
        for index, header in enumerate(normalized_headers):
            if not header:
                continue
            if header.startswith(alias) or alias.startswith(header):
                return index
    return None


def _detect_credencial_layout(headers: list[str]) -> dict[str, int | None]:
    return {
        "benef_col": _find_credencial_header_index(
            headers,
            "f",
            "benef",
            "num benef",
            "numero benef",
            "numero de benef",
            "numero de beneficiario",
            "nro de beneficiario",
            "n benef",
            "beneficio",
            "beneficiario",
            "numero afiliacion",
            "afiliacion",
        ),
        "dni_col": _find_credencial_header_index(
            headers,
            "dni",
            "documento",
            "numero dni",
            "nro dni",
        ),
        "tramite_col": _find_credencial_header_index(
            headers,
            "tramite",
            "numero tramite",
            "numero de tramite",
            "nro tramite",
            "n tramite",
        ),
        "sexo_col": _find_credencial_header_index(
            headers,
            "sexo",
            "genero",
        ),
        "nombre_col": _find_credencial_header_index(
            headers,
            "nombre y apellido",
            "apellido y nombre",
            "nombre",
            "afiliado",
            "paciente",
        ),
        "estado_col": _find_credencial_header_index(
            headers,
            "estado",
            "resultado",
            "descargada",
        ),
        "archivo_col": _find_credencial_header_index(
            headers,
            "credencial",
            "archivo pdf",
            "pdf credencial",
            "pdf descargado",
            "ruta pdf",
            "pdf",
        ),
        "observaciones_col": _find_credencial_header_index(
            headers,
            "observaciones",
            "observacion",
            "detalle",
            "mensaje",
        ),
    }


def _profile_specific_layout(headers: list[str], sheet_profile: str) -> dict[str, int | None]:
    profile_name = str(sheet_profile or "").strip().upper()
    normalized_headers = [_normalize_header(header) for header in headers]
    detected = _detect_credencial_layout(headers)

    if profile_name == "PLAN SALUD CIMA":
        explicit_map = {
            "benef_col": "numero de beneficiario",
            "dni_col": "dni paciente",
            "tramite_col": "numero de tramite",
            "sexo_col": None,
            "nombre_col": "nombre paciente",
            "estado_col": "credencial",
            "archivo_col": "credencial",
            "observaciones_col": None,
        }
        resolved: dict[str, int | None] = {}
        for key, expected_header in explicit_map.items():
            if expected_header is None:
                resolved[key] = None
                continue
            normalized_expected = _normalize_header(expected_header)
            try:
                resolved[key] = normalized_headers.index(normalized_expected)
            except ValueError:
                resolved[key] = detected.get(key)
        return resolved

    return detected


_SHEET_TEXT_PREFIX_RE = re.compile(r"^[\s'\u2018\u2019\u02bc`\u00b4]+")


def _clean_sheet_cell_value(value: object) -> str:
    text = str(value or "")
    text = text.replace("\ufeff", "").replace("\u200b", "").strip()
    return _SHEET_TEXT_PREFIX_RE.sub("", text).strip()


def _cell_value(row: list[str], index: int | None) -> str:
    if index is None or index < 0 or index >= len(row):
        return ""
    return _clean_sheet_cell_value(row[index])


def _find_previous_tramite(
    rows: list[list[str]],
    current_index: int,
    layout: dict[str, int | None],
) -> dict[str, str | int] | None:
    current_row = rows[current_index] if 0 <= current_index < len(rows) else []
    current_benef = _cell_value(current_row, layout["benef_col"])
    current_dni = _cell_value(current_row, layout["dni_col"])
    if not current_benef and not current_dni:
        return None

    for previous_index in range(current_index - 1, -1, -1):
        previous_row = rows[previous_index]
        previous_tramite = _cell_value(previous_row, layout["tramite_col"])
        if not previous_tramite:
            continue
        previous_benef = _cell_value(previous_row, layout["benef_col"])
        previous_dni = _cell_value(previous_row, layout["dni_col"])
        if current_benef and previous_benef and current_benef == previous_benef:
            return {
                "tramite": previous_tramite,
                "source_row": previous_index + 2,
                "matched_by": "BENEF",
            }
        if current_dni and previous_dni and current_dni == previous_dni:
            return {
                "tramite": previous_tramite,
                "source_row": previous_index + 2,
                "matched_by": "DNI",
            }
    return None


def _effective_target_end_row(start_row: int, max_rows: int | None, end_row: int | None) -> int | None:
    candidates: list[int] = []
    if max_rows is not None and max_rows > 0:
        candidates.append(start_row + max_rows - 1)
    if end_row is not None and end_row >= start_row:
        candidates.append(end_row)
    if not candidates:
        return None
    return min(candidates)


def _resolve_sheet_name(service, spreadsheet_id: str, requested_sheet_name: str) -> str:
    requested = str(requested_sheet_name or "").strip()
    if not requested:
        return requested

    response = _execute_sheets_request(
        service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="sheets.properties.title",
        )
    )
    available = [
        str(item.get("properties", {}).get("title", "")).strip()
        for item in response.get("sheets", [])
        if str(item.get("properties", {}).get("title", "")).strip()
    ]
    if requested in available:
        return requested

    normalized_requested = _normalize_header(requested)
    normalized_map = {_normalize_header(name): name for name in available}
    if normalized_requested in normalized_map:
        return normalized_map[normalized_requested]

    for candidate in available:
        normalized_candidate = _normalize_header(candidate)
        if normalized_candidate.startswith(normalized_requested) or normalized_requested.startswith(normalized_candidate):
            return candidate

    for candidate in available:
        normalized_candidate = _normalize_header(candidate)
        if normalized_requested and normalized_requested in normalized_candidate:
            return candidate

    raise RuntimeError(
        f"No se encontro la pestaÃ±a '{requested}'. Disponibles: {', '.join(available[:8]) or 'ninguna'}."
    )


def read_credencial_sheet_rows(
    *,
    spreadsheet_url_or_id: str,
    sheet_name: str,
    start_row: int = 2,
    max_rows: int | None = None,
    end_row: int | None = None,
    sheet_profile: str = "",
    only_with_tramite: bool = False,
) -> dict[str, list[dict]]:
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    service = build_sheets_service(interactive=False)
    resolved_sheet_name = _resolve_sheet_name(service, spreadsheet_id, sheet_name)

    headers_response = _execute_sheets_request(
        service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=f"'{resolved_sheet_name}'!A1:Z1")
    )
    header_values = headers_response.get("values", [])
    headers = [str(value or "").strip() for value in (header_values[0] if header_values else [])]
    profile_name = str(sheet_profile or "").strip().upper()
    layout = _profile_specific_layout(headers, profile_name)
    status_index = layout["archivo_col"] if profile_name in {"SCHEFE", "PLAN SALUD CIMA"} else layout["estado_col"]

    missing = [
        label
        for label, index in (
            ("BENEF", layout["benef_col"]),
            ("DNI", layout["dni_col"]),
            ("TRAMITE", layout["tramite_col"]),
        )
        if index is None
    ]
    if missing:
        raise RuntimeError(
            f"Faltan columnas requeridas en la hoja '{resolved_sheet_name}': {', '.join(missing)}."
        )

    range_suffix = f"Z{end_row}" if end_row is not None and end_row >= start_row else "Z"
    range_name = f"'{resolved_sheet_name}'!A{start_row}:{range_suffix}"
    response = _execute_sheets_request(
        service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=range_name)
    )
    values = response.get("values", [])

    rows: list[dict] = []
    missing_benef_rows: list[dict] = []
    missing_tramite_rows: list[dict] = []
    for offset, row in enumerate(values, start=start_row):
        estado = _cell_value(row, status_index)
        benef = _cell_value(row, layout["benef_col"])
        dni = _cell_value(row, layout["dni_col"])
        tramite = _cell_value(row, layout["tramite_col"])
        sexo = _cell_value(row, layout["sexo_col"])
        nombre = _cell_value(row, layout["nombre_col"])
        if estado:
            continue
        if not any((benef, dni, tramite, sexo)):
            continue
        if only_with_tramite and not tramite:
            continue
        if not benef and dni:
            missing_benef_rows.append(
                {
                    "sheet_row": offset,
                    "benef": "",
                    "dni": dni,
                    "tramite": tramite,
                    "sexo": sexo,
                    "nombre": nombre,
                    "observaciones": "Falta BENEF",
                }
            )
            continue
        if benef and dni and not tramite:
            if only_with_tramite:
                continue
            missing_tramite_rows.append(
                {
                    "sheet_row": offset,
                    "benef": benef,
                    "dni": dni,
                    "tramite": "",
                    "sexo": sexo,
                    "nombre": nombre,
                    "observaciones": "Falta Tramite",
                }
            )
            continue
        if not all((benef, dni, tramite)):
            if only_with_tramite:
                continue
            raise RuntimeError(
                f"La fila {offset} de la hoja '{resolved_sheet_name}' tiene datos incompletos para credencial."
            )
        rows.append(
            {
                "sheet_row": offset,
                "benef": benef,
                "dni": dni,
                "tramite": tramite,
                "sexo": sexo,
                "nombre": nombre,
            }
        )
        if max_rows is not None and max_rows > 0 and len(rows) >= max_rows:
            break
    return {
        "records": rows,
        "missing_benef": missing_benef_rows,
        "missing_tramite": missing_tramite_rows,
    }


def repair_credencial_sheet_missing_tramites(
    *,
    spreadsheet_url_or_id: str,
    sheet_name: str,
    start_row: int = 2,
    max_rows: int | None = None,
    end_row: int | None = None,
    sheet_profile: str = "",
) -> dict[str, object]:
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    service = build_sheets_service(interactive=False)
    resolved_sheet_name = _resolve_sheet_name(service, spreadsheet_id, sheet_name)

    headers_response = _execute_sheets_request(
        service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=f"'{resolved_sheet_name}'!A1:Z1")
    )
    header_values = headers_response.get("values", [])
    headers = [str(value or "").strip() for value in (header_values[0] if header_values else [])]
    profile_name = str(sheet_profile or "").strip().upper()
    layout = _profile_specific_layout(headers, profile_name)

    required_missing = [
        label
        for label, index in (
            ("BENEF", layout["benef_col"]),
            ("DNI", layout["dni_col"]),
            ("TRAMITE", layout["tramite_col"]),
        )
        if index is None
    ]
    if required_missing:
        raise RuntimeError(
            f"Faltan columnas requeridas en la hoja '{resolved_sheet_name}': {', '.join(required_missing)}."
        )

    target_end_row = _effective_target_end_row(start_row, max_rows, end_row)
    fetch_suffix = f"Z{target_end_row}" if target_end_row is not None and target_end_row >= 2 else "Z"
    response = _execute_sheets_request(
        service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"'{resolved_sheet_name}'!A2:{fetch_suffix}",
        )
    )
    values = response.get("values", [])
    status_index = layout["archivo_col"] if profile_name in {"SCHEFE", "PLAN SALUD CIMA"} else layout["estado_col"]
    tramite_letter = _column_letter(layout["tramite_col"])
    updates: list[dict] = []
    matches: list[dict[str, object]] = []
    reviewed = 0
    unresolved = 0

    for index, row in enumerate(values):
        sheet_row = index + 2
        if sheet_row < start_row:
            continue
        if target_end_row is not None and sheet_row > target_end_row:
            break
        estado = _cell_value(row, status_index)
        benef = _cell_value(row, layout["benef_col"])
        dni = _cell_value(row, layout["dni_col"])
        tramite = _cell_value(row, layout["tramite_col"])
        if estado or not benef or not dni or tramite:
            continue
        reviewed += 1
        previous = _find_previous_tramite(values, index, layout)
        if not previous:
            unresolved += 1
            continue
        recovered_tramite = str(previous.get("tramite", "")).strip()
        if not recovered_tramite:
            unresolved += 1
            continue
        updates.append(
            {
                "range": f"'{resolved_sheet_name}'!{tramite_letter}{sheet_row}",
                "values": [[recovered_tramite]],
            }
        )
        matches.append(
            {
                "sheet_row": sheet_row,
                "tramite": recovered_tramite,
                "source_row": int(previous.get("source_row", 0) or 0),
                "matched_by": str(previous.get("matched_by", "")).strip(),
                "benef": benef,
                "dni": dni,
            }
        )
        if layout["tramite_col"] is not None:
            while len(row) <= layout["tramite_col"]:
                row.append("")
            row[layout["tramite_col"]] = recovered_tramite

    if updates:
        _execute_sheets_request(
            service.spreadsheets()
            .values()
            .batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={
                    "valueInputOption": "USER_ENTERED",
                    "data": updates,
                },
            )
        )
    return {
        "updated": len(updates),
        "reviewed": reviewed,
        "unresolved": unresolved,
        "matches": matches,
        "sheet_name": resolved_sheet_name,
        "target_end_row": target_end_row,
    }


def write_credencial_sheet_results(
    *,
    spreadsheet_url_or_id: str,
    sheet_name: str,
    result_rows: list[dict],
    sheet_profile: str = "",
) -> int:
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    service = build_sheets_service(interactive=False)
    resolved_sheet_name = _resolve_sheet_name(service, spreadsheet_id, sheet_name)

    headers_response = _execute_sheets_request(
        service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=f"'{resolved_sheet_name}'!A1:Z1")
    )
    header_values = headers_response.get("values", [])
    headers = [str(value or "").strip() for value in (header_values[0] if header_values else [])]
    profile_name = str(sheet_profile or "").strip().upper()
    layout = _profile_specific_layout(headers, profile_name)
    if profile_name == "SCHEFE":
        estado_letter = "I"
        archivo_letter = "I"
    elif profile_name == "PLAN SALUD CIMA":
        estado_letter = "H"
        archivo_letter = "H"
    else:
        estado_letter = _column_letter(layout["estado_col"]) if layout["estado_col"] is not None else "N"
        archivo_letter = _column_letter(layout["archivo_col"]) if layout["archivo_col"] is not None else None
    observaciones_letter = _column_letter(layout["observaciones_col"]) if layout["observaciones_col"] is not None else None

    data: list[dict] = []
    for row in result_rows:
        sheet_row = row.get("sheet_row")
        if not sheet_row:
            continue
        sheet_row_int = int(sheet_row)
        estado = str(row.get("estado", "")).strip()
        archivo_pdf = str(row.get("archivo_drive_url", "") or row.get("archivo_pdf", "")).strip()
        drive_url = str(row.get("archivo_drive_url", "")).strip()
        observaciones = str(row.get("observaciones", "")).strip()
        if estado_letter and estado_letter == archivo_letter:
            if drive_url and estado.upper() == "DESCARGADA":
                cell_value = f'=HYPERLINK("{drive_url}";"DESCARGADA")'
            elif archivo_pdf and estado.upper() == "DESCARGADA":
                cell_value = archivo_pdf
            else:
                cell_value = estado or observaciones
            data.append(
                {
                    "range": f"'{resolved_sheet_name}'!{estado_letter}{sheet_row_int}",
                    "values": [[cell_value]],
                }
            )
        elif estado_letter:
            data.append(
                {
                    "range": f"'{resolved_sheet_name}'!{estado_letter}{sheet_row_int}",
                    "values": [[estado]],
                }
            )
        if archivo_letter and archivo_letter != estado_letter:
            if drive_url and estado.upper() == "DESCARGADA":
                archivo_value = f'=HYPERLINK("{drive_url}";"DESCARGADA")'
            else:
                archivo_value = archivo_pdf
            data.append(
                {
                    "range": f"'{resolved_sheet_name}'!{archivo_letter}{sheet_row_int}",
                    "values": [[archivo_value]],
                }
            )
        if observaciones_letter:
            data.append(
                {
                    "range": f"'{resolved_sheet_name}'!{observaciones_letter}{sheet_row_int}",
                    "values": [[observaciones]],
                }
            )

    if not data:
        return 0

    _execute_sheets_request(
        service.spreadsheets()
        .values()
        .batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={
                "valueInputOption": "USER_ENTERED",
                "data": data,
            },
        )
    )
    return sum(1 for row in result_rows if row.get("sheet_row"))


__all__ = [
    "OFFICE_FILE_MESSAGE",
    "is_office_file_url",
    "normalize_spreadsheet_url",
    "repair_credencial_sheet_missing_tramites",
    "read_credencial_sheet_rows",
    "write_credencial_sheet_results",
]

