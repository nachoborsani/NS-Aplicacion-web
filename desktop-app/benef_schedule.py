"""Programa el barrido diario del benef de Scheffelaar (tarea de Windows).

Crea/actualiza/borra la tarea "NS - Barrido benef Scheffelaar" que corre
benef_sweep.py a la hora configurada (por defecto 19:00). Mismo patrón que
bandeja_schedule.py: StartWhenAvailable, corre aunque cierres la app.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from app_paths import get_base_dir, get_data_dir, get_logs_dir

TASK_NAME = "NS - Barrido benef Scheffelaar"
CONFIG_FILE = "benef_schedule_config.json"
DEFAULT_HORARIOS = ["19:00"]
CREATE_NO_WINDOW = 0x08000000


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
            return {"enabled": bool(data.get("enabled")), "horarios": hs or list(DEFAULT_HORARIOS)}
    except Exception:
        pass
    return {"enabled": False, "horarios": list(DEFAULT_HORARIOS)}


def save_config(cfg: dict) -> None:
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), "utf-8")


def _python_exe() -> str:
    venv = get_base_dir() / ".venv" / "Scripts" / "python.exe"
    return str(venv) if venv.exists() else sys.executable


def _run_command() -> str:
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --run-benef-sweep'
    return f'"{_python_exe()}" "benef_sweep.py"'


def _bat_path() -> Path:
    return get_base_dir() / "barrido_benef.bat"


def _write_bat() -> Path:
    base = get_base_dir()
    log = get_logs_dir() / "benef_sweep_last.log"
    bat = _bat_path()
    contenido = (
        "@echo off\r\n"
        "REM Generado por el panel de barrido de benef. Corre benef_sweep.py.\r\n"
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
        "  <RegistrationInfo><Description>Barrido diario del benef de Scheffelaar (padrón PAMI). "
        "Generado por la app.</Description></RegistrationInfo>\n"
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
        "    <ExecutionTimeLimit>PT3H</ExecutionTimeLimit>\n"
        "    <Priority>7</Priority>\n"
        "  </Settings>\n"
        f"  <Actions Context=\"Author\"><Exec><Command>{bat}</Command></Exec></Actions>\n"
        "</Task>\n"
    )


def _run(args) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, creationflags=CREATE_NO_WINDOW)


def apply_schedule(horarios: list[str], enabled: bool) -> tuple[bool, str]:
    horarios = sorted(dict.fromkeys(_norm_hora(h) for h in horarios if valid_hora(h)))
    if enabled and not horarios:
        return False, "Poné al menos un horario válido (HH:MM)."
    save_config({"enabled": enabled, "horarios": horarios or list(DEFAULT_HORARIOS)})
    if not enabled:
        _run(["schtasks", "/delete", "/tn", TASK_NAME, "/f"])
        return True, "Barrido de benef desactivado."
    _write_bat()
    xml_path = get_data_dir() / "ns_benef_task.xml"
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
