from __future__ import annotations

import os
import re
from pathlib import Path

from gmail_informes import _load_google_deps, get_gmail_credentials_path
from google_sheets_ome import SHEETS_SCOPES, _configure_google_ssl_certificates, get_sheets_token_path


DRIVE_SCOPES = list(SHEETS_SCOPES)


def get_drive_token_path() -> Path:
    return get_sheets_token_path()


def autenticar_drive(
    credentials_path: Path | str | None = None,
    token_path: Path | str | None = None,
    interactive: bool = True,
):
    _configure_google_ssl_certificates()
    Request, Credentials, InstalledAppFlow, _build = _load_google_deps()
    credentials_path = Path(credentials_path or get_gmail_credentials_path())
    token_path = Path(token_path or get_drive_token_path())

    if not credentials_path.exists():
        raise RuntimeError(f"No se encontro credentials.json de Google en {credentials_path}")

    creds = None
    if token_path.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(token_path), DRIVE_SCOPES)
        except Exception as exc:
            normalized = str(exc).lower()
            if "scope has changed" in normalized:
                try:
                    token_path.unlink()
                except Exception:
                    pass
                creds = None
            else:
                raise

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        elif interactive:
            previous_relax_scope = os.environ.get("OAUTHLIB_RELAX_TOKEN_SCOPE")
            os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
            try:
                flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), DRIVE_SCOPES)
                creds = flow.run_local_server(port=0)
            finally:
                if previous_relax_scope is None:
                    os.environ.pop("OAUTHLIB_RELAX_TOKEN_SCOPE", None)
                else:
                    os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = previous_relax_scope
        else:
            raise RuntimeError("No hay token Google Drive valido.")

        token_path.parent.mkdir(parents=True, exist_ok=True)
        token_path.write_text(creds.to_json(), encoding="utf-8")

    return creds


def build_drive_service(
    credentials_path: Path | str | None = None,
    token_path: Path | str | None = None,
    interactive: bool = True,
):
    _Request, _Credentials, _InstalledAppFlow, build = _load_google_deps()
    creds = autenticar_drive(
        credentials_path=credentials_path,
        token_path=token_path,
        interactive=interactive,
    )
    return build("drive", "v3", credentials=creds)


def get_connected_drive_email(
    credentials_path: Path | str | None = None,
    token_path: Path | str | None = None,
    interactive: bool = True,
) -> str:
    _Request, _Credentials, _InstalledAppFlow, build = _load_google_deps()
    creds = autenticar_drive(
        credentials_path=credentials_path,
        token_path=token_path,
        interactive=interactive,
    )
    service = build("oauth2", "v2", credentials=creds)
    profile = service.userinfo().get().execute()
    return str(profile.get("email", "")).strip()


def extract_drive_folder_id(folder_url_or_id: str) -> str:
    raw = (folder_url_or_id or "").strip()
    if not raw:
        raise RuntimeError("Falta la carpeta de Google Drive.")
    if "drive.google.com" in raw:
        match = re.search(r"/folders/([a-zA-Z0-9_-]+)", raw)
        if match:
            return match.group(1)
        raise RuntimeError("No se pudo leer el ID de la carpeta de Google Drive.")
    return raw


def _friendly_drive_error(exc: Exception) -> RuntimeError:
    message = str(exc)
    normalized = message.lower()
    if "pem lib" in normalized or "_ssl.c:" in normalized or "ssl:" in normalized:
        return RuntimeError(
            "Google Drive fallo por un problema SSL/certificados locales.\n\n"
            f"Detalle: {message}\n\n"
            "Volve a conectar Google Sheets/Drive y reintenta. Si persiste, hay que regenerar el bundle local de certificados."
        )
    if "google drive api has not been used" in normalized or "accessnotconfigured" in normalized:
        return RuntimeError(
            "La cuenta Google ya se autentico, pero la API de Google Drive no esta habilitada en el proyecto OAuth de estas credenciales.\n\n"
            "Hay que entrar una sola vez a Google Cloud Console y habilitar 'Google Drive API' para el mismo proyecto que ya usa Sheets.\n\n"
            "Despues de habilitarla, espera unos minutos y vuelve a probar."
        )
    if "http error 403" in normalized:
        return RuntimeError(f"Google Drive rechazo la operacion (403). Detalle: {message}")
    return RuntimeError(f"No se pudo operar con Google Drive: {message}")


def resolve_child_folder_id(parent_folder_url_or_id: str, child_folder_name: str, *, interactive: bool = False) -> str:
    try:
        service = build_drive_service(interactive=interactive)
        parent_id = extract_drive_folder_id(parent_folder_url_or_id)
        safe_name = child_folder_name.replace("'", "\\'")
        response = (
            service.files()
            .list(
                q=(
                    f"'{parent_id}' in parents and trashed = false and "
                    f"mimeType = 'application/vnd.google-apps.folder' and "
                    f"name = '{safe_name}'"
                ),
                fields="files(id,name)",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                pageSize=10,
            )
            .execute()
        )
        files = response.get("files", [])
        if not files:
            raise RuntimeError(f"No se encontro la carpeta '{child_folder_name}' dentro del Drive configurado.")
        return str(files[0]["id"])
    except RuntimeError:
        raise
    except Exception as exc:
        raise _friendly_drive_error(exc) from exc


def _find_existing_file_in_folder(service, folder_id: str, file_name: str) -> dict | None:
    safe_name = str(file_name or "").replace("'", "\\'")
    response = (
        service.files()
        .list(
            q=(
                f"'{folder_id}' in parents and trashed = false and "
                f"name = '{safe_name}'"
            ),
            fields="files(id,name,webViewLink,webContentLink,modifiedTime)",
            orderBy="modifiedTime desc",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
            pageSize=10,
        )
        .execute()
    )
    files = response.get("files", [])
    return files[0] if files else None


def upload_file_to_drive_folder(
    file_path: str | Path,
    folder_id: str,
    target_name: str | None = None,
    *,
    interactive: bool = False,
) -> dict:
    from googleapiclient.http import MediaFileUpload

    try:
        path = Path(file_path)
        if not path.exists():
            raise RuntimeError(f"No existe el archivo para subir a Drive: {path}")

        service = build_drive_service(interactive=interactive)
        final_name = target_name or path.name
        metadata = {
            "name": final_name,
            "parents": [folder_id],
        }
        media = MediaFileUpload(str(path), mimetype="application/pdf", resumable=False)
        existing = _find_existing_file_in_folder(service, folder_id, final_name)
        if existing:
            created = (
                service.files()
                .update(
                    fileId=str(existing.get("id", "")).strip(),
                    body={"name": final_name},
                    media_body=media,
                    fields="id,name,webViewLink,webContentLink",
                    supportsAllDrives=True,
                )
                .execute()
            )
        else:
            created = (
                service.files()
                .create(
                    body=metadata,
                    media_body=media,
                    fields="id,name,webViewLink,webContentLink",
                    supportsAllDrives=True,
                )
                .execute()
            )
        return {
            "id": str(created.get("id", "")).strip(),
            "name": str(created.get("name", "")).strip(),
            "webViewLink": str(created.get("webViewLink", "")).strip(),
            "webContentLink": str(created.get("webContentLink", "")).strip(),
        }
    except RuntimeError:
        raise
    except Exception as exc:
        raise _friendly_drive_error(exc) from exc
