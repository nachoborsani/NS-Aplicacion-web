"""Utilidades para que las tareas programadas corran SIN ventana de consola.

Windows muestra una ventana negra cuando una tarea programada corre un .bat.
Para ocultarla, la tarea lanza un .vbs wrapper que a su vez corre el .bat con
ventana invisible (`WScript.Shell.Run <bat>, 0, True` → 0 = oculto, True =
espera a que termine, así la tarea refleja la duración real).
"""
from __future__ import annotations

from pathlib import Path

WSCRIPT = r"C:\Windows\System32\wscript.exe"


def write_vbs_launcher(bat_path: Path, vbs_path: Path) -> Path:
    """Escribe el .vbs que corre el .bat oculto y esperando su fin."""
    contenido = (
        'Set sh = CreateObject("WScript.Shell")\r\n'
        f'sh.Run """{bat_path}""", 0, True\r\n'
    )
    vbs_path.write_text(contenido, encoding="utf-8")
    return vbs_path


def actions_hidden_xml(vbs_path: Path) -> str:
    """Bloque <Actions> del XML de la tarea: corre el .vbs oculto con wscript."""
    return (
        '  <Actions Context="Author"><Exec>'
        f"<Command>{WSCRIPT}</Command>"
        f'<Arguments>//B //Nologo "{vbs_path}"</Arguments>'
        "</Exec></Actions>\n"
    )
