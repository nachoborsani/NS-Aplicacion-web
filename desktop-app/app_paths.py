import os
import shutil
import sys
from pathlib import Path


APP_NAME = "Consulta PAMI"


def is_frozen() -> bool:
    return getattr(sys, "frozen", False)


def get_base_dir() -> Path:
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def get_resource_dir() -> Path:
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS", get_base_dir()))
    return get_base_dir()


def get_resource_path(relative_path: str) -> Path:
    return get_resource_dir() / relative_path


def get_data_dir() -> Path:
    if is_frozen():
        local_appdata = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        data_dir = local_appdata / APP_NAME
    else:
        data_dir = get_base_dir()

    data_dir.mkdir(parents=True, exist_ok=True)
    _seed_initial_data_files(data_dir)
    return data_dir


def _seed_initial_data_files(data_dir: Path) -> None:
    seed_patterns = (
        "usuarios_*.json",
    )
    source_dirs: list[Path] = []
    for candidate in (get_base_dir(), get_resource_dir()):
        if candidate not in source_dirs and candidate.exists():
            source_dirs.append(candidate)

    for source_dir in source_dirs:
        for pattern in seed_patterns:
            for source_file in source_dir.glob(pattern):
                destination_file = data_dir / source_file.name
                if destination_file.exists():
                    continue
                try:
                    shutil.copy2(source_file, destination_file)
                except Exception:
                    continue


def get_output_dir() -> Path:
    output_dir = get_data_dir() / "salidas"
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def get_errors_dir() -> Path:
    errors_dir = get_data_dir() / "errores"
    errors_dir.mkdir(parents=True, exist_ok=True)
    return errors_dir


def get_logs_dir() -> Path:
    logs_dir = get_data_dir() / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    return logs_dir


def get_log_file() -> Path:
    return get_logs_dir() / "consulta_pami.log"
