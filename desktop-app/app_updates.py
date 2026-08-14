import json
import re
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from app_version import APP_VERSION, UPDATE_DOWNLOAD_URL, UPDATE_METADATA_URL


def _version_key(value: str) -> tuple[int, ...]:
    text = str(value or "").strip().lower()
    text = text[1:] if text.startswith("v") else text
    numbers = re.findall(r"\d+", text)
    return tuple(int(part) for part in numbers) if numbers else (0,)


def _es_version_mayor(version_remota: str, version_actual: str) -> bool:
    remote = _version_key(version_remota)
    current = _version_key(version_actual)
    max_len = max(len(remote), len(current))
    remote += (0,) * (max_len - len(remote))
    current += (0,) * (max_len - len(current))
    return remote > current


def _leer_json_desde_ruta(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _leer_metadata(timeout: int = 8) -> tuple[dict | None, str]:
    source = (UPDATE_METADATA_URL or "").strip()
    if not source:
        local_path = Path(__file__).resolve().with_name("version.json")
        if local_path.exists():
            return _leer_json_desde_ruta(local_path), str(local_path)
        return None, ""

    parsed = urlparse(source)
    if parsed.scheme in {"http", "https"}:
        request = urllib.request.Request(
            source,
            headers={
                "Accept": "application/json",
                "User-Agent": "Consulta-PAMI-Updater",
            },
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read().decode("utf-8")
        return json.loads(payload), source

    if parsed.scheme == "file":
        local_path = Path(parsed.path)
        return _leer_json_desde_ruta(local_path), str(local_path)

    local_path = Path(source)
    return _leer_json_desde_ruta(local_path), str(local_path)


def buscar_actualizacion(timeout: int = 8) -> dict:
    try:
        metadata, source = _leer_metadata(timeout=timeout)
    except urllib.error.HTTPError as exc:
        return {
            "estado": "error",
            "version_actual": APP_VERSION,
            "mensaje": f"No se pudo leer version.json remoto: HTTP {exc.code}.",
        }
    except FileNotFoundError:
        return {
            "estado": "sin_configurar",
            "version_actual": APP_VERSION,
            "mensaje": "No se encontro el archivo version.json configurado.",
        }
    except json.JSONDecodeError as exc:
        return {
            "estado": "error",
            "version_actual": APP_VERSION,
            "mensaje": f"version.json no es valido: {exc}",
        }
    except Exception as exc:
        return {
            "estado": "error",
            "version_actual": APP_VERSION,
            "mensaje": f"No se pudo consultar version.json: {exc}",
        }

    if not metadata:
        return {
            "estado": "sin_configurar",
            "version_actual": APP_VERSION,
            "mensaje": "Falta configurar UPDATE_METADATA_URL o publicar version.json.",
        }

    version_remota = str(metadata.get("version") or "").strip()
    if not version_remota:
        return {
            "estado": "error",
            "version_actual": APP_VERSION,
            "mensaje": "version.json no incluye el campo 'version'.",
        }

    download_url = str(metadata.get("download_url") or metadata.get("url") or UPDATE_DOWNLOAD_URL or "").strip()
    notes = str(metadata.get("notes") or "").strip()

    if not _es_version_mayor(version_remota, APP_VERSION):
        return {
            "estado": "actualizado",
            "version_actual": APP_VERSION,
            "version_remota": version_remota,
            "mensaje": notes,
            "source": source,
        }

    if not download_url:
        return {
            "estado": "error",
            "version_actual": APP_VERSION,
            "version_remota": version_remota,
            "mensaje": "Hay una version nueva pero version.json no incluye 'download_url'.",
            "source": source,
        }

    return {
        "estado": "disponible",
        "version_actual": APP_VERSION,
        "version_remota": version_remota,
        "download_url": download_url,
        "mensaje": notes,
        "source": source,
    }
