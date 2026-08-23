from __future__ import annotations

import os
import re
import ssl
import unicodedata
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from app_paths import get_data_dir
from gmail_informes import _load_google_deps, get_gmail_credentials_path


SHEETS_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/drive",
]

OFFICE_FILE_MESSAGE = (
    "La hoja guardada no es una Hoja de calculo nativa de Google Sheets. "
    "Converti el archivo y volve a guardar la URL."
)


def _windows_ca_bundle_path() -> Path | None:
    if os.name != "nt" or not hasattr(ssl, "enum_certificates"):
        return None
    try:
        import certifi
    except Exception:
        return None

    bundle_path = get_data_dir() / "windows_certifi_ca_bundle.pem"
    try:
        certifi_text = Path(certifi.where()).read_text(encoding="ascii")
        parts = [certifi_text]
        seen = {certifi_text}
        for store_name in ("ROOT", "CA"):
            try:
                certificates = ssl.enum_certificates(store_name)
            except Exception:
                certificates = []
            for certificate, encoding, _trust in certificates:
                if encoding != "x509_asn":
                    continue
                pem = ssl.DER_cert_to_PEM_cert(certificate)
                if pem not in seen:
                    seen.add(pem)
                    parts.append(pem)
        bundle_path.write_text("\n".join(parts), encoding="ascii")
        return bundle_path
    except Exception:
        return None


def _configure_google_ssl_certificates() -> None:
    try:
        import truststore

        truststore.inject_into_ssl()
        for env_name in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE"):
            current = os.environ.get(env_name, "")
            if current and Path(current).name == "windows_certifi_ca_bundle.pem":
                os.environ.pop(env_name, None)
        return
    except Exception:
        pass

    ca_path = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
    if ca_path and Path(ca_path).name == "windows_certifi_ca_bundle.pem":
        os.environ.pop("SSL_CERT_FILE", None)
        os.environ.pop("REQUESTS_CA_BUNDLE", None)
        ca_path = ""
    if not ca_path:
        try:
            import certifi

            ca_path = certifi.where()
            os.environ["SSL_CERT_FILE"] = ca_path
            os.environ["REQUESTS_CA_BUNDLE"] = ca_path
        except Exception:
            bundle_path = _windows_ca_bundle_path()
            if bundle_path:
                ca_path = str(bundle_path)
                os.environ["SSL_CERT_FILE"] = ca_path
                os.environ["REQUESTS_CA_BUNDLE"] = ca_path
    if not ca_path:
        return
    try:
        import httplib2

        httplib2.CA_CERTS = ca_path
    except Exception:
        pass


def get_sheets_token_path() -> Path:
    return get_data_dir() / "token_sheets.json"


def autenticar_sheets(
    credentials_path: Path | str | None = None,
    token_path: Path | str | None = None,
    interactive: bool = True,
):
    _configure_google_ssl_certificates()
    Request, Credentials, InstalledAppFlow, _build = _load_google_deps()
    credentials_path = Path(credentials_path or get_gmail_credentials_path())
    token_path = Path(token_path or get_sheets_token_path())

    if not credentials_path.exists():
        raise RuntimeError(f"No se encontro credentials.json de Google en {credentials_path}")

    creds = None
    if token_path.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(token_path), SHEETS_SCOPES)
        except Exception as exc:
            normalized_error = str(exc).lower()
            if "scope has changed" in normalized_error:
                try:
                    token_path.unlink()
                except Exception:
                    pass
                creds = None
            else:
                raise

    def run_interactive_flow():
        previous_relax_scope = None
        try:
            previous_relax_scope = os.environ.get("OAUTHLIB_RELAX_TOKEN_SCOPE")
            os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
            flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), SHEETS_SCOPES)
            return flow.run_local_server(port=0)
        except Exception as exc:
            raw_error = str(exc)
            normalized_error = raw_error.lower()
            if "access_denied" in normalized_error:
                raise RuntimeError(
                    "La cuenta Google no esta autorizada para esta app. Usa una cuenta habilitada como tester del cliente OAuth."
                ) from exc
            if "scope has changed" in normalized_error:
                try:
                    if token_path.exists():
                        token_path.unlink()
                except Exception:
                    pass
                raise RuntimeError(
                    "Cambio el permiso solicitado para Google Sheets. Se limpio el token de Sheets. Vuelve a presionar Conectar Sheets."
                ) from exc
            if ("connection aborted" in normalized_error and "permission denied" in normalized_error) or "permissionerror(13" in normalized_error:
                try:
                    if token_path.exists():
                        token_path.unlink()
                except Exception:
                    pass
                raise RuntimeError(
                    "No se pudo completar la autorizacion de Google Sheets porque el navegador o Windows corto el permiso del callback local.\n\n"
                    "Se limpio el token local. Presiona Conectar Sheets nuevamente, acepta los permisos de Google y espera a que la pagina confirme la conexion."
                ) from exc
            raise RuntimeError(f"No se pudo completar la conexion con Google Sheets: {raw_error}") from exc
        finally:
            if previous_relax_scope is None:
                os.environ.pop("OAUTHLIB_RELAX_TOKEN_SCOPE", None)
            else:
                os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = previous_relax_scope

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception as exc:
                raw_error = str(exc)
                normalized_error = raw_error.lower()
                if "invalid_grant" in normalized_error or "expired" in normalized_error or "revoked" in normalized_error:
                    try:
                        token_path.unlink()
                    except Exception:
                        pass
                    if interactive:
                        creds = run_interactive_flow()
                    else:
                        raise RuntimeError(
                            "La conexion de Google Sheets vencio o fue revocada. "
                            "Presiona Conectar Sheets para autorizar la cuenta nuevamente."
                        ) from exc
                    if not creds:
                        raise RuntimeError("No se pudo completar la conexion con Google Sheets.") from exc
                else:
                    raise
        elif interactive:
            creds = run_interactive_flow()
        else:
            raise RuntimeError("No hay token Google Sheets valido.")
        token_path.parent.mkdir(parents=True, exist_ok=True)
        token_path.write_text(creds.to_json(), encoding="utf-8")
    return creds


def get_connected_google_email(
    credentials_path: Path | str | None = None,
    token_path: Path | str | None = None,
    interactive: bool = True,
) -> str:
    _Request, _Credentials, _InstalledAppFlow, build = _load_google_deps()
    creds = autenticar_sheets(
        credentials_path=credentials_path,
        token_path=token_path,
        interactive=interactive,
    )
    service = build("oauth2", "v2", credentials=creds)
    profile = service.userinfo().get().execute()
    return str(profile.get("email", "")).strip()


def build_sheets_service(
    credentials_path: Path | str | None = None,
    token_path: Path | str | None = None,
    interactive: bool = True,
):
    _Request, _Credentials, _InstalledAppFlow, build = _load_google_deps()
    creds = autenticar_sheets(
        credentials_path=credentials_path,
        token_path=token_path,
        interactive=interactive,
    )
    return build("sheets", "v4", credentials=creds)


def check_sheets_connection(
    *,
    credentials_path: Path | str | None = None,
    token_path: Path | str | None = None,
    spreadsheet_url_or_id: str = "",
    sheet_name: str = "",
    interactive: bool = False,
) -> str:
    email = get_connected_google_email(
        credentials_path=credentials_path,
        token_path=token_path,
        interactive=interactive,
    )
    target = (spreadsheet_url_or_id or "").strip()
    if target:
        spreadsheet_id = extract_spreadsheet_id(target)
        service = build_sheets_service(
            credentials_path=credentials_path,
            token_path=token_path,
            interactive=False,
        )
        response = _execute_sheets_request(
            service.spreadsheets()
            .get(spreadsheetId=spreadsheet_id, fields="properties.title,sheets.properties.title")
        )
        if sheet_name:
            available_sheets = {
                str(item.get("properties", {}).get("title", "")).strip()
                for item in response.get("sheets", [])
            }
            if sheet_name.strip() not in available_sheets:
                raise RuntimeError(
                    f"Google Sheets conectado como {email or 'cuenta Google'}, "
                    f"pero no se encontro la pestana '{sheet_name}'."
                )
    return email


def list_spreadsheet_sheet_names(
    *,
    spreadsheet_url_or_id: str,
    credentials_path: Path | str | None = None,
    token_path: Path | str | None = None,
    interactive: bool = False,
) -> list[str]:
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    service = build_sheets_service(
        credentials_path=credentials_path,
        token_path=token_path,
        interactive=interactive,
    )
    response = _execute_sheets_request(
        service.spreadsheets()
        .get(spreadsheetId=spreadsheet_id, fields="sheets.properties.title")
    )
    return [
        str(item.get("properties", {}).get("title", "")).strip()
        for item in response.get("sheets", [])
        if str(item.get("properties", {}).get("title", "")).strip()
    ]


def _has_office_file_params(spreadsheet_url_or_id: str) -> bool:
    raw = (spreadsheet_url_or_id or "").strip()
    if not raw:
        return False
    parsed = urlparse(raw)
    params = parse_qs(parsed.query)
    return (
        any(value.lower() == "true" for value in params.get("rtpof", []))
        or any(value.lower() == "true" for value in params.get("sd", []))
    )


def is_office_file_url(spreadsheet_url_or_id: str) -> bool:
    return _has_office_file_params(spreadsheet_url_or_id)


def normalize_spreadsheet_url(spreadsheet_url_or_id: str) -> str:
    raw = (spreadsheet_url_or_id or "").strip()
    if not raw:
        return ""
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", raw)
    if not match:
        return raw

    parsed = urlparse(raw)
    spreadsheet_id = match.group(1)
    params = parse_qs(parsed.query)
    clean_params = {}
    for key in ("gid",):
        values = [value for value in params.get(key, []) if value]
        if values:
            clean_params[key] = values[-1]
    fragment = parsed.fragment or ""
    if not fragment and clean_params.get("gid"):
        fragment = f"gid={clean_params['gid']}"
    query = urlencode(clean_params)
    return urlunparse(("https", "docs.google.com", f"/spreadsheets/d/{spreadsheet_id}/edit", "", query, fragment))


def extract_spreadsheet_id(spreadsheet_url_or_id: str) -> str:
    raw = (spreadsheet_url_or_id or "").strip()
    if not raw:
        raise RuntimeError("Falta la URL o ID de la planilla.")
    if _has_office_file_params(raw):
        raise RuntimeError(OFFICE_FILE_MESSAGE)
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", raw)
    if match:
        return match.group(1)
    return raw


def _execute_sheets_request(request):
    try:
        return request.execute()
    except Exception as exc:
        raw_error = str(exc)
        normalized = unicodedata.normalize("NFKD", raw_error)
        normalized = "".join(char for char in normalized if not unicodedata.combining(char)).lower()
        if (
            "operation is not supported for this document" in normalized
            or "must not be an office file" in normalized
            or "office file" in normalized
        ):
            raise RuntimeError(OFFICE_FILE_MESSAGE) from exc
        if "unable to parse range" in normalized:
            match = re.search(r"Unable to parse range:\s*'?([^'!]+)'?!", raw_error)
            sheet_name = match.group(1).strip() if match else ""
            if sheet_name:
                raise RuntimeError(
                    f"No se pudo leer la pestaña '{sheet_name}' en Google Sheets. "
                    "Revisa que el nombre de la pestaña exista y este escrito exactamente igual."
                ) from exc
            raise RuntimeError(
                "No se pudo leer el rango de Google Sheets. "
                "Revisa que el nombre de la pestaña exista y este escrito exactamente igual."
            ) from exc
        raise RuntimeError(f"No se pudo operar con Google Sheets: {raw_error}") from exc


def _normalize_header(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[^a-zA-Z0-9]+", " ", text).strip().lower()
    return re.sub(r"\s+", " ", text)


def _column_letter(index: int) -> str:
    if index < 0:
        raise ValueError("El indice de columna no puede ser negativo.")
    result = ""
    current = index + 1
    while current:
        current, remainder = divmod(current - 1, 26)
        result = chr(65 + remainder) + result
    return result


def _quote_sheet_name(sheet_name: str) -> str:
    return "'" + str(sheet_name or "").replace("'", "''") + "'"


def _get_sheet_grid_limits(service, spreadsheet_id: str, sheet_name: str) -> tuple[int, int]:
    response = _execute_sheets_request(
        service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="sheets.properties(title,gridProperties(rowCount,columnCount))",
        )
    )
    for sheet in response.get("sheets", []):
        properties = sheet.get("properties", {})
        if str(properties.get("title", "")).strip() != sheet_name:
            continue
        grid = properties.get("gridProperties", {})
        row_count = int(grid.get("rowCount") or 1)
        column_count = int(grid.get("columnCount") or 1)
        return max(row_count, 1), max(column_count, 1)
    raise RuntimeError(
        f"No se encontro la pestana '{sheet_name}' en Google Sheets. "
        "Revisa que el nombre este escrito exactamente igual."
    )


def _find_header_index(headers: list[str], *aliases: str) -> int | None:
    normalized_headers = [_normalize_header(header) for header in headers]
    normalized_aliases = [_normalize_header(alias) for alias in aliases if alias]
    for alias in normalized_aliases:
        for index, header in enumerate(normalized_headers):
            if not header:
                continue
            if header == alias or alias in header or header in alias:
                return index
    return None


def _find_result_date_index(headers: list[str], ome_index: int | None) -> int | None:
    normalized_headers = [_normalize_header(header) for header in headers]
    generation_headers = {
        "fecha generacion",
        "fecha ome",
        "fecha generacion ome",
        "fecha generada",
        "fecha resultado",
        "generada",
        "generado",
        "generacion",
    }
    for index, header in enumerate(normalized_headers):
        if not header:
            continue
        if header in generation_headers:
            return index
    if ome_index is None:
        return None
    for index in range(ome_index + 1, len(normalized_headers)):
        header = normalized_headers[index]
        if header == "fecha":
            return index
    return None


def _looks_like_headerless_plan_salud_row(values: list[str]) -> bool:
    if len(values) < 6:
        return False
    first_cell = str(values[0] or "").strip()
    if not re.match(r"^\d{1,2}/\d{1,2}/\d{2,4}$", first_cell):
        return False
    dni_value = re.sub(r"\D+", "", str(values[2] or ""))
    practice_value = str(values[5] or "").strip()
    return len(dni_value) >= 6 and bool(practice_value)


def _detect_sheet_layout(headers: list[str]) -> dict[str, int | None]:
    if _looks_like_headerless_plan_salud_row(headers):
        return {
            "beneficio_col": 3,
            "dni_col": 2,
            "diagnostico_col": None,
            "practica_col": 5,
            "ome_col": 6,
            "fecha_col": 8,
            "nombre_col": 1,
            "credencial_col": 7,
        }

    ome_col = _find_header_index(
        headers,
        "ome",
        "nro ome",
        "numero ome",
    )
    return {
        "beneficio_col": _find_header_index(
            headers,
            "num benef",
            "numero benef",
            "nro benef",
            "benef",
            "beneficio",
            "f",
        ),
        "dni_col": _find_header_index(
            headers,
            "dni",
            "numero dni",
            "nro dni",
            "nro documento",
            "n documento",
            "n doc",
        ),
        "diagnostico_col": _find_header_index(
            headers,
            "dx",
            "diagnostico",
            "diagnostico rapido",
        ),
        "practica_col": _find_header_index(
            headers,
            "practica",
            "practica general",
            "especialidad o practica",
            "especialidad practica",
            "especialidad",
            "prestacion",
        ),
        "ome_col": ome_col,
        "fecha_col": _find_result_date_index(headers, ome_col),
        "nombre_col": _find_header_index(
            headers,
            "nombre y apellido",
            "apellido y nombre",
            "nombre",
            "nombre paciente",
        ),
        "credencial_col": _find_header_index(
            headers,
            "credencial",
            "estado credencial",
            "credenciales",
        ),
    }


def _cell_value(row: list[str], index: int | None) -> str:
    if index is None or index < 0 or index >= len(row):
        return ""
    return str(row[index] or "").strip()


def _looks_like_document_number(value: str) -> bool:
    digits = re.sub(r"\D+", "", str(value or ""))
    return len(digits) >= 6


def _normalize_status_text(value: str) -> str:
    normalized = unicodedata.normalize("NFD", str(value or ""))
    normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return " ".join(normalized.upper().split())


def _is_pending_ome_marker(value: str) -> bool:
    parts = [
        _normalize_status_text(part)
        for part in re.split(r"\s*//\s*", str(value or ""))
        if str(part or "").strip()
    ]
    if not parts:
        return False
    # "YA TIENE OME" sin número es un resultado INCOMPLETO: el paciente tiene una
    # OME pero no pudimos traer el número. Lo tratamos como pendiente para que la
    # próxima corrida lo reintente (y con el fix de búsqueda por práctica
    # equivalente, la recupere). Cuando se escribe el número real, ya no matchea.
    return all(part in {"NO ENCONTRADA", "NO ENCONTRADO", "YA TIENE OME"} for part in parts)


def _row_has_table_context(row: list[str], layout: dict[str, int | None]) -> bool:
    ignored_cols = {
        index
        for index in (
            layout.get("beneficio_col"),
            layout.get("dni_col"),
            layout.get("ome_col"),
            layout.get("fecha_col"),
        )
        if isinstance(index, int)
    }
    for index, value in enumerate(row[:12]):
        if index in ignored_cols:
            continue
        if str(value or "").strip():
            return True
    return False


def read_ome_sheet_rows(
    *,
    spreadsheet_url_or_id: str,
    sheet_name: str,
    fallback_diagnostico: str = "",
    default_practica: str = "",
    start_row: int = 2,
    max_rows: int | None = None,
    complete_benef_only: bool = False,
    complete_dni_only: bool = False,
    require_credential_ok: bool = False,
) -> list[dict]:
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    service = build_sheets_service(interactive=False)
    row_count, column_count = _get_sheet_grid_limits(service, spreadsheet_id, sheet_name)
    header_end_col = _column_letter(min(column_count, 26) - 1)

    headers_response = _execute_sheets_request(
        service.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=f"{_quote_sheet_name(sheet_name)}!A1:{header_end_col}1")
    )
    header_values = headers_response.get("values", [])
    headers = [str(value or "").strip() for value in (header_values[0] if header_values else [])]
    layout = _detect_sheet_layout(headers)

    only_complete_data = complete_benef_only or complete_dni_only
    if layout["ome_col"] is None and not only_complete_data:
        raise RuntimeError(f"No se encontro la columna OME en la hoja '{sheet_name}'.")
    if complete_benef_only and layout["beneficio_col"] is None:
        raise RuntimeError(f"No se encontro la columna Num Benef en la hoja '{sheet_name}'.")
    if complete_benef_only and layout["dni_col"] is None:
        raise RuntimeError(f"No se encontro la columna DNI en la hoja '{sheet_name}'.")
    if complete_dni_only and layout["beneficio_col"] is None:
        raise RuntimeError(f"No se encontro la columna Num Benef en la hoja '{sheet_name}'.")
    if complete_dni_only and layout["dni_col"] is None:
        raise RuntimeError(f"No se encontro la columna DNI en la hoja '{sheet_name}'.")
    if not only_complete_data and layout["beneficio_col"] is None and layout["dni_col"] is None:
        raise RuntimeError(f"No se encontro una columna de BENEF o DNI en la hoja '{sheet_name}'.")
    if require_credential_ok and not only_complete_data and layout.get("credencial_col") is None:
        raise RuntimeError(f"No se encontro la columna CREDENCIAL en la hoja '{sheet_name}'.")

    if start_row > row_count:
        return []
    end_row = row_count
    if max_rows is not None and max_rows > 0:
        end_row = min(row_count, start_row + max_rows - 1)
    range_end_col = _column_letter(min(column_count, 26) - 1)
    range_name = f"{_quote_sheet_name(sheet_name)}!A{start_row}:{range_end_col}{end_row}"
    response = _execute_sheets_request(
        service.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=range_name)
    )
    values = response.get("values", [])

    rows: list[dict] = []
    table_started = False
    for offset, row in enumerate(values, start=start_row):
        beneficio = _cell_value(row, layout["beneficio_col"])
        dni = _cell_value(row, layout["dni_col"])
        diagnostico = _cell_value(row, layout["diagnostico_col"])
        practica = _cell_value(row, layout["practica_col"])
        ome_value = _cell_value(row, layout["ome_col"])
        nombre = _cell_value(row, layout["nombre_col"])
        credencial = _cell_value(row, layout.get("credencial_col"))
        has_table_context = _row_has_table_context(row, layout)
        if has_table_context:
            table_started = True
        elif table_started:
            break

        if complete_benef_only:
            if not has_table_context:
                continue
            if not _looks_like_document_number(dni):
                continue
        elif complete_dni_only:
            if not has_table_context:
                continue
            if not beneficio:
                continue
            if _looks_like_document_number(dni):
                continue
        else:
            if not has_table_context:
                continue
            if ome_value and not _is_pending_ome_marker(ome_value):
                continue
            credential_blocked = (
                require_credential_ok
                and not only_complete_data
                and _normalize_status_text(credencial) != "DESCARGADA"
            )
            if not credential_blocked and not beneficio and not dni:
                continue

        modo = "BENEF" if beneficio else "DNI"
        if complete_benef_only:
            modo = "DNI"
        elif complete_dni_only:
            modo = "BENEF"
        afiliado = dni if complete_benef_only else (beneficio or dni)
        rows.append(
            {
                "sheet_row": offset,
                "modo": modo,
                "afiliado": afiliado,
                "beneficio": beneficio,
                "dni": dni,
                "nombre": nombre,
                "credencial": credencial,
                "credential_blocked": bool(
                    require_credential_ok
                    and not only_complete_data
                    and _normalize_status_text(credencial) != "DESCARGADA"
                ),
                "diagnostico": diagnostico or fallback_diagnostico,
                "practica": practica or default_practica,
                "practica_origen": practica,
            }
        )
        if max_rows is not None and max_rows > 0 and len(rows) >= max_rows:
            break
    return rows


def _visible_sheet_result(resultado: str, nro_ome: str) -> str:
    normalized = (resultado or "").strip().upper()
    nro = (nro_ome or "").strip()
    if nro:
        return nro
    if normalized == "YA_TIENE_OME":
        return "YA TIENE OME"
    if normalized == "LIMITE_ANUAL":
        return "LIMITE ANUAL"
    if not normalized:
        return ""
    if normalized.startswith("ERROR"):
        return "ERROR"
    if normalized == "NO_DNI":
        return "NO DNI"
    if normalized == "NO_PAMI":
        return "NO PAMI"
    if normalized == "DOBLE_DNI":
        return "DOBLE DNI"
    if normalized in {"BENEF_COMPLETADO", "DNI_COMPLETADO"}:
        return ""
    if normalized == "VERIFICAR_CREDENCIAL":
        return "Verificar credencial"
    return normalized


def _multi_visible_sheet_result(resultado: str, nro_ome: str) -> str:
    normalized = (resultado or "").strip().upper()
    nro = (nro_ome or "").strip()
    if nro:
        return nro
    if normalized == "YA_TIENE_OME":
        return "YA TIENE OME"
    if normalized == "LIMITE_ANUAL":
        return "LIMITE ANUAL"
    if normalized == "GENERADA":
        return "YA_EXISTIA"
    return _visible_sheet_result(resultado, nro_ome)


def _sheet_generation_date(resultado: str, nro_ome: str) -> str:
    nro = (nro_ome or "").strip()
    normalized = (resultado or "").strip().upper()
    if nro:
        return datetime.now().strftime("%d/%m/%Y")
    if normalized in {"OK", "GENERADA", "YA_TIENE_OME"}:
        return datetime.now().strftime("%d/%m/%Y")
    return ""


def _group_sheet_result_rows(result_rows: list[dict]) -> list[dict]:
    grouped: dict[int, dict] = {}
    ordered_keys: list[int] = []

    for row in result_rows:
        sheet_row_raw = row.get("sheet_row")
        if not str(sheet_row_raw or "").strip().isdigit():
            continue
        sheet_row = int(sheet_row_raw)
        if sheet_row not in grouped:
            grouped[sheet_row] = {
                "sheet_row": sheet_row,
                "result_rows": [],
                "beneficio": "",
                "dni": "",
            }
            ordered_keys.append(sheet_row)
        grouped[sheet_row]["result_rows"].append(row)
        if not grouped[sheet_row]["beneficio"]:
            grouped[sheet_row]["beneficio"] = str(row.get("beneficio", "") or "").strip()
        if not grouped[sheet_row]["dni"]:
            grouped[sheet_row]["dni"] = str(row.get("dni", "") or "").strip()

    consolidated: list[dict] = []
    for sheet_row in ordered_keys:
        group = grouped[sheet_row]
        rows = group["result_rows"]
        multiple = len(rows) > 1
        values = [
            (_multi_visible_sheet_result if multiple else _visible_sheet_result)(
                str(item.get("resultado", "")),
                str(item.get("nro_ome", "")),
            )
            for item in rows
        ]
        joined_value = " // ".join([value for value in values if value])
        generation_date = ""
        for item in rows:
            generation_date = _sheet_generation_date(
                str(item.get("resultado", "")),
                str(item.get("nro_ome", "")),
            )
            if generation_date:
                break
        consolidated.append(
            {
                "sheet_row": sheet_row,
                "value": joined_value,
                "beneficio": group["beneficio"],
                "dni": group["dni"],
                "generation_date": generation_date,
                "only_complete_benef": bool(rows) and all(
                    str(item.get("resultado", "")).strip().upper() == "BENEF_COMPLETADO"
                    for item in rows
                ),
                "only_complete_dni": bool(rows) and all(
                    str(item.get("resultado", "")).strip().upper() == "DNI_COMPLETADO"
                    for item in rows
                ),
            }
        )
    return consolidated


def write_ome_sheet_results(
    *,
    spreadsheet_url_or_id: str,
    sheet_name: str,
    result_rows: list[dict],
) -> int:
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    service = build_sheets_service(interactive=False)

    headers_response = _execute_sheets_request(
        service.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=f"{_quote_sheet_name(sheet_name)}!A1:Z1")
    )
    header_values = headers_response.get("values", [])
    headers = [str(value or "").strip() for value in (header_values[0] if header_values else [])]
    layout = _detect_sheet_layout(headers)

    consolidated_rows = _group_sheet_result_rows(result_rows)

    only_complete_benef = bool(result_rows) and all(
        str(row.get("resultado", "")).strip().upper() == "BENEF_COMPLETADO"
        for row in result_rows
    )
    only_complete_dni = bool(result_rows) and all(
        str(row.get("resultado", "")).strip().upper() == "DNI_COMPLETADO"
        for row in result_rows
    )

    ome_col = layout["ome_col"]
    if ome_col is None and not (only_complete_benef or only_complete_dni):
        raise RuntimeError(f"No se encontro la columna OME en la hoja '{sheet_name}'.")

    ome_letter = _column_letter(ome_col) if ome_col is not None else None
    fecha_letter = _column_letter(layout["fecha_col"]) if layout["fecha_col"] is not None else "L"
    beneficio_letter = (
        _column_letter(layout["beneficio_col"])
        if layout["beneficio_col"] is not None
        else None
    )
    if only_complete_benef and beneficio_letter is None:
        raise RuntimeError(f"No se encontro la columna Num Benef en la hoja '{sheet_name}'.")
    dni_letter = (
        _column_letter(layout["dni_col"])
        if layout["dni_col"] is not None
        else None
    )
    if only_complete_dni and dni_letter is None:
        raise RuntimeError(f"No se encontro la columna DNI en la hoja '{sheet_name}'.")

    data = []
    quoted_sheet_name = _quote_sheet_name(sheet_name)
    for row in consolidated_rows:
        sheet_row = row.get("sheet_row")
        if not sheet_row:
            continue
        resultado = "BENEF_COMPLETADO" if row.get("only_complete_benef") else ""
        if row.get("only_complete_dni"):
            resultado = "DNI_COMPLETADO"
        value = str(row.get("value", "") or "").strip()
        beneficio = str(row.get("beneficio", "") or "").strip()
        dni = str(row.get("dni", "") or "").strip()
        generation_date = str(row.get("generation_date", "") or "").strip()
        if resultado not in {"BENEF_COMPLETADO", "DNI_COMPLETADO"} and ome_letter:
            data.append(
                {
                    "range": f"{quoted_sheet_name}!{ome_letter}{int(sheet_row)}",
                    "values": [[value]],
                }
            )
        if dni and dni_letter:
            data.append(
                {
                    "range": f"{quoted_sheet_name}!{dni_letter}{int(sheet_row)}",
                    "values": [[dni]],
                }
            )
        if generation_date and fecha_letter:
            data.append(
                {
                    "range": f"{quoted_sheet_name}!{fecha_letter}{int(sheet_row)}",
                    "values": [[generation_date]],
                }
            )
        if beneficio and beneficio_letter:
            data.append(
                {
                    "range": f"{quoted_sheet_name}!{beneficio_letter}{int(sheet_row)}",
                    "values": [[beneficio]],
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
    return len(consolidated_rows)
