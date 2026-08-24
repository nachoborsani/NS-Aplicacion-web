"""Programa el sondeo del refresco on-demand (tarea de Windows cada ~10 min).

Tarea "NS - Poller refresco bandejas" que corre bandeja_poller.py cada 10 minutos.
Si la web tiene un refresco pedido (botón "Actualizar ahora"), la PC lo corre.
Consumo mínimo: sin pedido, es una consulta HTTP y listo. Corre OCULTA.

Uso: python bandeja_poller_schedule.py 10    -> cada 10 min (default)
     python bandeja_poller_schedule.py off    -> desactiva
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from app_paths import get_base_dir, get_data_dir, get_logs_dir
from task_utils import actions_hidden_xml, write_vbs_launcher

TASK_NAME = "NS - Poller refresco bandejas"
DEFAULT_MINUTOS = 10
CREATE_NO_WINDOW = 0x08000000


def _python_exe() -> str:
    venv = get_base_dir() / ".venv" / "Scripts" / "python.exe"
    return str(venv) if venv.exists() else sys.executable


def _run_command() -> str:
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --run-bandeja-poller'
    return f'"{_python_exe()}" "bandeja_poller.py"'


def _bat_path() -> Path:
    return get_base_dir() / "poller_refresco.bat"


def _vbs_path() -> Path:
    return get_base_dir() / "poller_refresco.vbs"


def _write_bat() -> Path:
    base = get_base_dir()
    log = get_logs_dir() / "bandeja_poller_last.log"
    bat = _bat_path()
    contenido = (
        "@echo off\r\n"
        "REM Sondeo del refresco on-demand de bandejas.\r\n"
        f'cd /d "{base}"\r\n'
        'set "PLAYWRIGHT_BROWSERS_PATH=%CD%\\playwright-browsers"\r\n'
        'set "PYTHONIOENCODING=utf-8"\r\n'
        f'{_run_command()} > "{log}" 2>&1\r\n'
    )
    bat.write_text(contenido, encoding="utf-8")
    return bat


def _build_xml(minutos: int) -> str:
    # Dispara a las 00:00 y se repite cada N minutos durante todo el día.
    trigger = (
        "    <CalendarTrigger>\n"
        "      <StartBoundary>2026-01-01T00:00:00</StartBoundary>\n"
        "      <Enabled>true</Enabled>\n"
        "      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>\n"
        "      <Repetition>\n"
        f"        <Interval>PT{int(minutos)}M</Interval>\n"
        "        <Duration>P1D</Duration>\n"
        "        <StopAtDurationEnd>false</StopAtDurationEnd>\n"
        "      </Repetition>\n"
        "    </CalendarTrigger>"
    )
    return (
        '<?xml version="1.0" encoding="UTF-16"?>\n'
        '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\n'
        "  <RegistrationInfo><Description>Sondea el refresco on-demand de bandejas (NS): "
        "si la web lo pidió, corre la bajada. Generado por la app.</Description></RegistrationInfo>\n"
        "  <Triggers>\n" + trigger + "\n  </Triggers>\n"
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


def apply_schedule(minutos: int, enabled: bool) -> tuple[bool, str]:
    minutos = max(2, min(60, int(minutos or DEFAULT_MINUTOS)))
    if not enabled:
        _run(["schtasks", "/delete", "/tn", TASK_NAME, "/f"])
        return True, "Poller de refresco desactivado."
    _write_bat()
    write_vbs_launcher(_bat_path(), _vbs_path())
    xml_path = get_data_dir() / "ns_bandeja_poller_task.xml"
    xml_path.write_text(_build_xml(minutos), encoding="utf-16")
    res = _run(["schtasks", "/create", "/tn", TASK_NAME, "/xml", str(xml_path), "/f"])
    if res.returncode != 0:
        return False, (res.stderr or res.stdout or "No se pudo crear la tarea.").strip()
    return True, f"Programado: sondea cada {minutos} min. Corre oculto aunque cierres la app."


def get_status() -> dict:
    ps = (
        "$ErrorActionPreference='SilentlyContinue';"
        f"$t=Get-ScheduledTask -TaskName '{TASK_NAME}';"
        "if(-not $t){ Write-Output '{\"exists\":false}'; exit 0 };"
        f"$i=Get-ScheduledTaskInfo -TaskName '{TASK_NAME}';"
        "[pscustomobject]@{exists=$true;state=[string]$t.State;"
        "lastRun=[string]$i.LastRunTime;nextRun=[string]$i.NextRunTime} | ConvertTo-Json -Compress"
    )
    res = _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps])
    try:
        return json.loads((res.stdout or "").strip() or '{"exists":false}')
    except Exception:
        return {"exists": False}


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].lower() in {"off", "delete", "desactivar"}:
        ok, msg = apply_schedule(0, False)
    else:
        mins = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else DEFAULT_MINUTOS
        ok, msg = apply_schedule(mins, True)
    print(("OK: " if ok else "ERROR: ") + msg)
    print("Estado:", json.dumps(get_status(), ensure_ascii=False))
