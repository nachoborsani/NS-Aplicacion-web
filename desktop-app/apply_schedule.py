# -*- coding: utf-8 -*-
"""Reaplica los timers systemd de la automatización según el horario configurado
en la web (GET /api/admin/worker/schedule). Corre cada pocos minutos en el server
(ns-schedule-apply.timer). Si la versión no cambió, no toca nada.

SEGURIDAD: valida TODO lo que viene de la web (horas HH:MM, días de un vocabulario
fijo, poller 1..60) antes de escribir cualquier unidad systemd. Nunca escribe texto
libre en un archivo de unidad.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config

APP = Path(__file__).resolve().parent
UNIT_DIR = Path("/etc/systemd/system")
VER_FILE = APP / ".schedule_version"
DIAS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def log(m: str) -> None:
    print(m, flush=True)


def _horas(arr):
    out = []
    for t in (arr or []):
        t = str(t).strip()
        if _TIME.match(t) and t not in out:
            out.append(t)
    return sorted(out)[:8]


def _validar(s: dict) -> dict:
    s = s if isinstance(s, dict) else {}
    poller = s.get("pollerCadaMin")
    try:
        poller = int(poller)
    except Exception:
        poller = 10
    if not (1 <= poller <= 60):
        poller = 10
    br = str(s.get("bandejaRefresh", "20:00"))
    rt = str(s.get("bandejaRetry", "22:00"))
    cad_src = s.get("scheffelaarCadena") if isinstance(s.get("scheffelaarCadena"), dict) else {}
    cad = {d: _horas(cad_src.get(d)) for d in DIAS}
    b = s.get("scheffelaarBenef") if isinstance(s.get("scheffelaarBenef"), dict) else {}
    bdias = [d for d in DIAS if d in (b.get("dias") or [])]
    return {
        "bandejaRefresh": br if _TIME.match(br) else "20:00",
        "bandejaRetry": rt if _TIME.match(rt) else "22:00",
        "pollerCadaMin": poller,
        "scheffelaarCadena": cad,
        "scheffelaarBenef": {"dias": bdias, "hora": str(b.get("hora")) if _TIME.match(str(b.get("hora", ""))) else "19:00"},
    }


def _timer_unit(desc: str, oncal_lines: list[str], persistent: bool) -> str:
    cuerpo = "\n".join(f"OnCalendar={x}" for x in oncal_lines)
    return (
        "[Unit]\n"
        f"Description={desc}\n"
        "[Timer]\n"
        f"{cuerpo}\n"
        f"Persistent={'true' if persistent else 'false'}\n"
        "[Install]\n"
        "WantedBy=timers.target\n"
    )


def _sc(*args) -> None:
    subprocess.run(["systemctl", *args], check=False)


def _aplicar_timer(nombre: str, oncal_lines: list[str], persistent: bool, desc: str) -> str:
    """Escribe/enciende el timer si tiene horarios; lo apaga si quedó vacío."""
    unit = UNIT_DIR / f"{nombre}.timer"
    if oncal_lines:
        unit.write_text(_timer_unit(desc, oncal_lines, persistent), encoding="utf-8")
        return "on"
    # Sin horarios: apagar (no puede haber un .timer sin OnCalendar).
    _sc("disable", "--now", f"{nombre}.timer")
    return "off"


def main() -> int:
    cfg = load_config()
    web = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
    try:
        web.login(cfg.get("username", ""), cfg.get("password", ""))
        data = web._request("GET", "/api/admin/worker/schedule")
    except Exception as e:  # noqa: BLE001
        log(f"no pude leer el horario de la web: {e!r}")
        return 0  # no romper el timer: reintenta en la próxima vuelta

    if not isinstance(data, dict) or "schedule" not in data:
        log("respuesta sin schedule; nada que hacer.")
        return 0
    version = str(data.get("version", ""))
    try:
        actual = VER_FILE.read_text("utf-8").strip()
    except Exception:
        actual = ""
    if version and version == actual:
        return 0  # sin cambios

    s = _validar(data.get("schedule"))
    log(f"Aplicando horario v{version}…")

    # Timers "encendidos" (con horario) para enable+restart; el resto se apaga solo.
    encendidos = []

    st = _aplicar_timer("ns-bandeja-refresh", [f"*-*-* {s['bandejaRefresh']}:00"], True, "NS refrescar bandeja mes en curso")
    if st == "on": encendidos.append("ns-bandeja-refresh")

    st = _aplicar_timer("ns-bandeja-retry", [f"*-*-* {s['bandejaRetry']}:00"], True, "NS reintentar bandejas con error")
    if st == "on": encendidos.append("ns-bandeja-retry")

    st = _aplicar_timer("ns-bandeja-poller", [f"*:0/{s['pollerCadaMin']}"], False, "NS poller refresco bandejas")
    if st == "on": encendidos.append("ns-bandeja-poller")

    cad_lines = []
    for d in DIAS:
        for hora in s["scheffelaarCadena"][d]:
            cad_lines.append(f"{d} {hora}:00")
    st = _aplicar_timer("ns-scheffelaar-cadena", cad_lines, False, "NS cadena Scheffelaar")
    if st == "on": encendidos.append("ns-scheffelaar-cadena")

    b = s["scheffelaarBenef"]
    benef_lines = [f"{','.join(b['dias'])} {b['hora']}:00"] if b["dias"] else []
    st = _aplicar_timer("ns-scheffelaar-benef", benef_lines, False, "NS barrido beneficiarios Scheffelaar")
    if st == "on": encendidos.append("ns-scheffelaar-benef")

    _sc("daemon-reload")
    for t in encendidos:
        _sc("enable", f"{t}.timer")
        _sc("restart", f"{t}.timer")

    VER_FILE.write_text(version, encoding="utf-8")
    log(f"Horario v{version} aplicado. Timers activos: {', '.join(encendidos) or '(ninguno)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
