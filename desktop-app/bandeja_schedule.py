"""Programa el refresco automático de la bandeja (tarea programada de Windows).

El panel "Refresco automático" (app_refresco.py) usa esto para:
- Guardar la config (horarios + on/off) en refresco_config.json.
- Crear/actualizar/borrar la tarea de Windows "NS - Refrescar bandeja mes en curso".
- Consultar el estado (última corrida, resultado, próxima corrida).

La ejecución en sí la hace bandeja_sync.py (necesita PAMI + navegador local); acá
solo se programa cuándo corre. La tarea tiene StartWhenAvailable=true: si la PC
estaba apagada a la hora del refresco, corre apenas prende.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from app_paths import get_base_dir, get_data_dir, get_logs_dir

TASK_NAME = "NS - Refrescar bandeja mes en curso"
CONFIG_FILE = "refresco_config.json"
# Una sola corrida a la noche: a las 13:00 el día está a medio trabajar, no sirve.
# A las 20:00 los consultorios ya cerraron → transmite + baja mes en curso (hasta
# hoy) + baja la bandeja de adelante (desde mañana).
DEFAULT_HORARIOS = ["20:00"]
CREATE_NO_WINDOW = 0x08000000  # que subprocess no abra ventanas de consola


# --------------------------------------------------------------------------- #
# Config local (refresco_config.json)
# --------------------------------------------------------------------------- #
def _config_path() -> Path:
    return get_data_dir() / CONFIG_FILE


def valid_hora(h) -> bool:
    try:
        hh, mm = str(h).strip().split(":")
        return 0 <= int(hh) <= 23 and 0 <= int(mm) <= 59
    except Exception:
        return False


def _norm_hora(h) -> str:
    hh, mm = str(h).strip().split(":")
    return f"{int(hh):02d}:{int(mm):02d}"


def load_config() -> dict:
    try:
        data = json.loads(_config_path().read_text("utf-8"))
        if isinstance(data, dict):
            hs = [_norm_hora(h) for h in (data.get("horarios") or []) if valid_hora(h)]
            return {
                "enabled": bool(data.get("enabled")),
                "horarios": hs or list(DEFAULT_HORARIOS),
                # Transmitir automáticamente 1 vez al día (en el primer refresco).
                "transmitir": bool(data.get("transmitir")),
            }
    except Exception:
        pass
    return {"enabled": False, "horarios": list(DEFAULT_HORARIOS), "transmitir": False}


def save_config(cfg: dict) -> None:
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), "utf-8")


# --------------------------------------------------------------------------- #
# Comando que corre el sync (source vs frozen) + .bat
# --------------------------------------------------------------------------- #
def _python_exe() -> str:
    """El python del venv (tiene las dependencias), si existe; si no, el actual."""
    venv = get_base_dir() / ".venv" / "Scripts" / "python.exe"
    return str(venv) if venv.exists() else sys.executable


def _sync_command() -> str:
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --run-bandeja-sync'
    return f'"{_python_exe()}" "bandeja_sync.py"'


def _bat_path() -> Path:
    return get_base_dir() / "refrescar_bandeja.bat"


def _write_bat() -> Path:
    base = get_base_dir()
    log = get_logs_dir() / "bandeja_sync_last.log"
    bat = _bat_path()
    contenido = (
        "@echo off\r\n"
        "REM Generado por el panel 'Refresco automatico'. Corre el sync de la bandeja.\r\n"
        f'cd /d "{base}"\r\n'
        'set "PLAYWRIGHT_BROWSERS_PATH=%CD%\\playwright-browsers"\r\n'
        f'{_sync_command()} > "{log}" 2>&1\r\n'
    )
    bat.write_text(contenido, encoding="utf-8")
    return bat


# --------------------------------------------------------------------------- #
# Tarea programada de Windows
# --------------------------------------------------------------------------- #
def _build_xml(horarios: list[str]) -> str:
    triggers = "\n".join(
        "    <CalendarTrigger>\n"
        f"      <StartBoundary>2026-01-01T{h}:00</StartBoundary>\n"
        "      <Enabled>true</Enabled>\n"
        "      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>\n"
        "    </CalendarTrigger>"
        for h in horarios
    )
    bat = _bat_path()
    return (
        '<?xml version="1.0" encoding="UTF-16"?>\n'
        '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\n'
        "  <RegistrationInfo><Description>Refresca la bandeja del mes en curso (NS) "
        "desde PAMI. Generado por el panel Refresco automatico.</Description></RegistrationInfo>\n"
        "  <Triggers>\n" + triggers + "\n  </Triggers>\n"
        '  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType>'
        "<RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\n"
        "  <Settings>\n"
        "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\n"
        "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\n"
        "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\n"
        "    <StartWhenAvailable>true</StartWhenAvailable>\n"
        "    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>\n"
        "    <AllowStartOnDemand>true</AllowStartOnDemand>\n"
        "    <Enabled>true</Enabled>\n"
        "    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>\n"
        "    <Priority>7</Priority>\n"
        "  </Settings>\n"
        f"  <Actions Context=\"Author\"><Exec><Command>{bat}</Command></Exec></Actions>\n"
        "</Task>\n"
    )


def _run(args) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, creationflags=CREATE_NO_WINDOW)


def apply_schedule(horarios: list[str], enabled: bool, transmitir: bool = False) -> tuple[bool, str]:
    """Crea/actualiza (o borra) la tarea de Windows. Devuelve (ok, mensaje)."""
    horarios = [_norm_hora(h) for h in horarios if valid_hora(h)]
    # sin duplicados, ordenados
    horarios = sorted(dict.fromkeys(horarios))
    if enabled and not horarios:
        return False, "Poné al menos un horario válido (HH:MM)."
    save_config({"enabled": enabled, "horarios": horarios or list(DEFAULT_HORARIOS), "transmitir": bool(transmitir)})
    if not enabled:
        _run(["schtasks", "/delete", "/tn", TASK_NAME, "/f"])
        return True, "Refresco automático desactivado."
    _write_bat()
    xml_path = get_data_dir() / "ns_bandeja_task.xml"
    xml_path.write_text(_build_xml(horarios), encoding="utf-16")
    res = _run(["schtasks", "/create", "/tn", TASK_NAME, "/xml", str(xml_path), "/f"])
    if res.returncode != 0:
        return False, (res.stderr or res.stdout or "No se pudo crear la tarea programada.").strip()
    return True, "Programado: " + ", ".join(horarios) + " hs. Corre aunque cierres la app."


def get_status() -> dict:
    """Estado de la tarea vía PowerShell (campos estructurados). {exists, state,
    lastRun, lastResult, nextRun}."""
    ps = (
        "$ErrorActionPreference='SilentlyContinue';"
        f"$t=Get-ScheduledTask -TaskName '{TASK_NAME}';"
        "if(-not $t){ Write-Output '{\"exists\":false}'; exit 0 };"
        f"$i=Get-ScheduledTaskInfo -TaskName '{TASK_NAME}';"
        "[pscustomobject]@{exists=$true;state=[string]$t.State;"
        "lastRun=[string]$i.LastRunTime;lastResult=$i.LastTaskResult;"
        "nextRun=[string]$i.NextRunTime} | ConvertTo-Json -Compress"
    )
    res = _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps])
    try:
        return json.loads((res.stdout or "").strip() or '{"exists":false}')
    except Exception:
        return {"exists": False}
