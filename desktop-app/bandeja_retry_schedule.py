"""Programa el reintento nocturno de bandejas con error (tarea de Windows).

Tarea "NS - Reintentar bandejas con error" que corre bandeja_retry.py a las 22:00
(2 h después del refresco principal de las 20:00). Le pregunta a la web qué
clientes quedaron con error y re-baja solo esos. Si no hay ninguno, no hace nada.

Uso: python bandeja_retry_schedule.py 22:00   -> programa
     python bandeja_retry_schedule.py off      -> desactiva
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from app_paths import get_base_dir, get_data_dir, get_logs_dir
from task_utils import actions_hidden_xml, write_vbs_launcher

TASK_NAME = "NS - Reintentar bandejas con error"
DEFAULT_HORARIOS = ["22:00"]
CREATE_NO_WINDOW = 0x08000000


def valid_hora(h) -> bool:
    try:
        hh, mm = str(h).strip().split(":")
        return 0 <= int(hh) <= 23 and 0 <= int(mm) <= 59
    except Exception:
        return False


def _norm_hora(h) -> str:
    hh, mm = str(h).strip().split(":")
    return f"{int(hh):02d}:{int(mm):02d}"


def _python_exe() -> str:
    venv = get_base_dir() / ".venv" / "Scripts" / "python.exe"
    return str(venv) if venv.exists() else sys.executable


def _run_command() -> str:
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --run-bandeja-retry'
    return f'"{_python_exe()}" "bandeja_retry.py"'


def _bat_path() -> Path:
    return get_base_dir() / "reintentar_bandeja.bat"


def _vbs_path() -> Path:
    return get_base_dir() / "reintentar_bandeja.vbs"


def _write_bat() -> Path:
    base = get_base_dir()
    log = get_logs_dir() / "bandeja_retry_last.log"
    bat = _bat_path()
    contenido = (
        "@echo off\r\n"
        "REM Reintento nocturno de las bandejas que quedaron con error.\r\n"
        f'cd /d "{base}"\r\n'
        'set "PLAYWRIGHT_BROWSERS_PATH=%CD%\\playwright-browsers"\r\n'
        'set "PYTHONIOENCODING=utf-8"\r\n'
        f'{_run_command()} > "{log}" 2>&1\r\n'
    )
    bat.write_text(contenido, encoding="utf-8")
    return bat


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
        "  <RegistrationInfo><Description>Reintenta las bandejas que quedaron con error en "
        "el refresco de la noche (NS). Generado por la app.</Description></RegistrationInfo>\n"
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
        + actions_hidden_xml(_vbs_path()) +
        "</Task>\n"
    )


def _run(args) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, creationflags=CREATE_NO_WINDOW)


def apply_schedule(horarios: list[str], enabled: bool) -> tuple[bool, str]:
    horarios = sorted(dict.fromkeys(_norm_hora(h) for h in horarios if valid_hora(h)))
    if enabled and not horarios:
        return False, "Poné al menos un horario válido (HH:MM)."
    if not enabled:
        _run(["schtasks", "/delete", "/tn", TASK_NAME, "/f"])
        return True, "Reintento nocturno desactivado."
    _write_bat()
    write_vbs_launcher(_bat_path(), _vbs_path())   # wrapper oculto (sin ventana negra)
    xml_path = get_data_dir() / "ns_bandeja_retry_task.xml"
    xml_path.write_text(_build_xml(horarios), encoding="utf-16")
    res = _run(["schtasks", "/create", "/tn", TASK_NAME, "/xml", str(xml_path), "/f"])
    if res.returncode != 0:
        return False, (res.stderr or res.stdout or "No se pudo crear la tarea.").strip()
    return True, "Programado: " + ", ".join(horarios) + " hs. Corre aunque cierres la app."


def get_status() -> dict:
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


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].lower() in {"off", "delete", "desactivar"}:
        ok, msg = apply_schedule([], False)
    else:
        horas = [h for h in sys.argv[1:] if valid_hora(h)] or DEFAULT_HORARIOS
        ok, msg = apply_schedule(horas, True)
    print(("OK: " if ok else "ERROR: ") + msg)
    print("Estado:", json.dumps(get_status(), ensure_ascii=False))
