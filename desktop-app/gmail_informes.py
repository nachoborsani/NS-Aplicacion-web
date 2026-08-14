import base64
from pathlib import Path

from app_paths import get_base_dir, get_data_dir, get_resource_path


SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
TIPOS_ACEPTADOS = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/png",
    "image/bmp",
    "image/tiff",
}


def get_gmail_credentials_path() -> Path:
    candidates = (
        get_resource_path("resources/credentials.json"),
        get_base_dir() / "credentials" / "credentials.json",
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def get_gmail_token_path() -> Path:
    return get_data_dir() / "token_gmail.json"


def _load_google_deps():
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
    except ImportError as exc:
        raise RuntimeError(
            "Faltan dependencias de Gmail. Instala requirements.txt y volve a abrir la app."
        ) from exc
    return Request, Credentials, InstalledAppFlow, build


def autenticar(
    credentials_path: Path | str | None = None,
    token_path: Path | str | None = None,
    interactive: bool = True,
):
    Request, Credentials, InstalledAppFlow, _build = _load_google_deps()
    credentials_path = Path(credentials_path or get_gmail_credentials_path())
    token_path = Path(token_path or get_gmail_token_path())

    if not credentials_path.exists():
        raise RuntimeError(f"No se encontro credentials.json de Gmail en {credentials_path}")

    creds = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        elif interactive:
            flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), SCOPES)
            creds = flow.run_local_server(port=0)
        else:
            raise RuntimeError("No hay token Gmail valido.")
        token_path.parent.mkdir(parents=True, exist_ok=True)
        token_path.write_text(creds.to_json(), encoding="utf-8")
    return creds


def get_connected_email(
    credentials_path: Path | str | None = None,
    token_path: Path | str | None = None,
    interactive: bool = True,
) -> str:
    _Request, _Credentials, _InstalledAppFlow, build = _load_google_deps()
    creds = autenticar(credentials_path=credentials_path, token_path=token_path, interactive=interactive)
    service = build("gmail", "v1", credentials=creds)
    profile = service.users().getProfile(userId="me").execute()
    return str(profile.get("emailAddress", "")).strip()


def descargar_informes(
    credentials_path: Path | str | None,
    token_path: Path | str | None,
    destino: Path | str,
    fecha_desde: str,
    fecha_hasta: str,
    callback_progreso=None,
    should_stop=None,
) -> int:
    """
    fecha_desde y fecha_hasta van en formato YYYY/MM/DD.
    Gmail interpreta before como fecha exclusiva.
    """
    _Request, _Credentials, _InstalledAppFlow, build = _load_google_deps()
    creds = autenticar(credentials_path=credentials_path, token_path=token_path)
    service = build("gmail", "v1", credentials=creds)

    q = f"has:attachment after:{fecha_desde} before:{fecha_hasta}"
    threads: list[dict] = []
    token = None
    while True:
        if should_stop and should_stop():
            break
        response = (
            service.users()
            .threads()
            .list(userId="me", q=q, maxResults=500, pageToken=token)
            .execute()
        )
        threads.extend(response.get("threads", []))
        token = response.get("nextPageToken")
        if not token:
            break

    destino = Path(destino)
    destino.mkdir(parents=True, exist_ok=True)
    total = 0

    for thread in threads:
        if should_stop and should_stop():
            break
        try:
            thread_data = (
                service.users()
                .threads()
                .get(userId="me", id=thread["id"], format="full")
                .execute()
            )
            for msg in thread_data.get("messages", []):
                if should_stop and should_stop():
                    break
                for part in _iter_parts(msg.get("payload", {})):
                    if should_stop and should_stop():
                        break
                    filename = str(part.get("filename", "")).strip()
                    if not filename or part.get("mimeType") not in TIPOS_ACEPTADOS:
                        continue
                    safe_filename = Path(filename).name
                    dest_file = destino / safe_filename
                    if dest_file.exists():
                        continue
                    body = part.get("body", {})
                    attachment_id = body.get("attachmentId")
                    data = body.get("data")
                    if attachment_id and not data:
                        data = (
                            service.users()
                            .messages()
                            .attachments()
                            .get(userId="me", messageId=msg["id"], id=attachment_id)
                            .execute()
                            .get("data", "")
                        )
                    if not data:
                        continue
                    dest_file.write_bytes(base64.urlsafe_b64decode(data + "=="))
                    total += 1
                    if callback_progreso:
                        callback_progreso(safe_filename)
        except Exception:
            continue

    return total


def _iter_parts(payload: dict):
    for part in payload.get("parts", []) or []:
        yield part
        yield from _iter_parts(part)
