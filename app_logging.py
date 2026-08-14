from datetime import datetime

from app_paths import get_log_file


def log_message(message: str) -> None:
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {message}"

    try:
        print(line)
    except Exception:
        pass

    try:
        log_file = get_log_file()
        with log_file.open("a", encoding="utf-8") as file:
            file.write(line + "\n")
    except Exception:
        pass
