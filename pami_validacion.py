from __future__ import annotations

import shutil
import subprocess
import tempfile
import unicodedata
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Callable

from app_logging import log_message


@dataclass
class AndroidDevice:
    serial: str
    state: str


class ValidacionOmeController:
    def __init__(
        self,
        log_callback: Callable[[str], None] | None = None,
        status_callback: Callable[[str], None] | None = None,
    ) -> None:
        self.log_callback = log_callback or (lambda _: None)
        self.status_callback = status_callback or (lambda _: None)

    def adb_available(self) -> bool:
        available = shutil.which("adb") is not None
        self._status("ADB detectado." if available else "ADB no encontrado en PATH.")
        return available

    def list_devices(self) -> list[AndroidDevice]:
        if not self.adb_available():
            return []

        result = self._run_adb(["devices"])
        devices: list[AndroidDevice] = []
        for line in result.stdout.splitlines()[1:]:
            parts = line.strip().split()
            if len(parts) >= 2:
                devices.append(AndroidDevice(serial=parts[0], state=parts[1]))

        if devices:
            self._status(f"Dispositivos detectados: {len(devices)}")
            for device in devices:
                self._log(f"ADB device: {device.serial} | {device.state}")
        else:
            self._status("ADB disponible, sin dispositivos conectados.")
        return devices

    def open_app(self, package: str, activity: str = "", device_serial: str = "") -> None:
        package = package.strip()
        activity = activity.strip()
        device_serial = device_serial.strip()
        if not package:
            raise RuntimeError("Completa el paquete de la app Android antes de abrirla.")
        if not self.adb_available():
            raise RuntimeError("ADB no esta disponible en PATH.")

        args = ["-s", device_serial] if device_serial else []
        if activity:
            component = f"{package}/{activity}"
            self._run_adb([*args, "shell", "am", "start", "-n", component])
            self._status(f"Intentando abrir activity: {component}")
            return

        self._run_adb([*args, "shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1"])
        self._status(f"Intentando abrir app: {package}")

    def read_screen_text(self, device_serial: str = "") -> str:
        if not self.adb_available():
            raise RuntimeError("ADB no esta disponible en PATH.")

        args = ["-s", device_serial.strip()] if device_serial.strip() else []
        remote_path = "/sdcard/window_dump_validacion.xml"
        self._run_adb([*args, "shell", "uiautomator", "dump", remote_path])

        with tempfile.TemporaryDirectory() as tmp_dir:
            local_path = f"{tmp_dir}/window_dump_validacion.xml"
            self._run_adb([*args, "pull", remote_path, local_path])
            tree = ET.parse(local_path)

        texts: list[str] = []
        for node in tree.iter("node"):
            text = (node.attrib.get("text") or "").strip()
            if text:
                texts.append(text)

        unique_texts = list(dict.fromkeys(texts))
        result = "\n".join(unique_texts)
        if "orden validada con exito" in self._normalize_text(result):
            self._status("Pantalla detectada: orden validada con exito.")
        elif result:
            self._status("Texto de pantalla leido desde Android.")
        else:
            self._status("No se detecto texto accesible en la pantalla Android.")
        return result

    def validation_success_visible(self, device_serial: str = "", screen_text: str = "") -> bool:
        text = screen_text or self.read_screen_text(device_serial=device_serial)
        normalized = self._normalize_text(text)
        return "orden validada con exito" in normalized or "validada con exito" in normalized

    def parse_order_details(self, screen_text: str) -> dict:
        lines = [line.strip() for line in str(screen_text or "").splitlines() if line.strip()]
        normalized_lines = [self._normalize_text(line) for line in lines]

        def after_label(*labels: str) -> str:
            normalized_labels = [self._normalize_text(label) for label in labels]
            for index, normalized in enumerate(normalized_lines):
                if any(label in normalized for label in normalized_labels):
                    if index + 1 < len(lines):
                        return lines[index + 1].strip()
            return ""

        return {
            "paciente": after_label("Nombre de la persona afiliada", "persona afiliada"),
            "ome": after_label("Numero de orden medica", "Número de orden médica", "orden medica"),
            "fecha_hora_orden": after_label("Fecha y hora"),
            "beneficio": after_label("Numero de afiliacion", "Número de afiliación", "afiliacion"),
            "practica": after_label("Practica", "Práctica"),
        }

    def read_order_details(self, device_serial: str = "", screen_text: str = "") -> dict:
        text = screen_text or self.read_screen_text(device_serial=device_serial)
        return self.parse_order_details(text)

    def tap_order_for_patient(self, patient_name: str, device_serial: str = "") -> bool:
        patient_norm = self._normalize_text(patient_name)
        patient_words = [word for word in patient_norm.split() if len(word) > 2]
        if not patient_words:
            raise RuntimeError("Falta el nombre del paciente para buscar la orden.")

        xml_text = self._dump_screen_xml(device_serial=device_serial)
        root = ET.fromstring(xml_text)
        nodes = self._visible_nodes(root)

        patient_nodes = [
            node
            for node in nodes
            if node["center"] and all(word in node["norm"] for word in patient_words[:2])
        ]
        order_buttons = [
            node
            for node in nodes
            if node["center"] and "ver orden completa" in node["norm"]
        ]
        if not patient_nodes:
            self._status(f"No se encontro paciente visible en Android: {patient_name}")
            return False
        if not order_buttons:
            self._status("No se encontro boton 'Ver orden completa' visible.")
            return False

        patient_y = patient_nodes[0]["center"][1]
        candidates = [button for button in order_buttons if button["center"][1] >= patient_y - 20]
        if not candidates:
            candidates = order_buttons
        candidates.sort(key=lambda button: abs(button["center"][1] - patient_y))
        target = candidates[0]
        args = ["-s", device_serial.strip()] if device_serial.strip() else []
        self._run_adb([*args, "shell", "input", "tap", str(target["center"][0]), str(target["center"][1])])
        self._status(f"Orden abierta para: {patient_name}")
        return True

    def prepare_scanner(self, device_serial: str = "") -> bool:
        tapped_validate = self.tap_text("Validar prestación", device_serial=device_serial) or self.tap_text(
            "Validar prestacion", device_serial=device_serial
        )
        if tapped_validate:
            import time

            time.sleep(0.8)
        tapped_scan = self.tap_text("Escanear QR", device_serial=device_serial)
        if tapped_scan:
            self._status("Escaner QR abierto en el celular.")
        return tapped_scan

    def tap_text(self, text: str, device_serial: str = "") -> bool:
        target = self._normalize_text(text)
        if not target:
            raise RuntimeError("Falta el texto a tocar.")
        xml_text = self._dump_screen_xml(device_serial=device_serial)
        root = ET.fromstring(xml_text)
        for node in root.iter("node"):
            node_text = self._normalize_text(node.attrib.get("text") or node.attrib.get("content-desc") or "")
            if target not in node_text:
                continue
            bounds = node.attrib.get("bounds") or ""
            center = self._bounds_center(bounds)
            if center is None:
                continue
            args = ["-s", device_serial.strip()] if device_serial.strip() else []
            self._run_adb([*args, "shell", "input", "tap", str(center[0]), str(center[1])])
            self._status(f"Toque enviado sobre: {text}")
            return True
        self._status(f"No se encontro texto visible para tocar: {text}")
        return False

    def _visible_nodes(self, root: ET.Element) -> list[dict]:
        nodes: list[dict] = []
        for node in root.iter("node"):
            text = (node.attrib.get("text") or node.attrib.get("content-desc") or "").strip()
            if not text:
                continue
            bounds = node.attrib.get("bounds") or ""
            nodes.append(
                {
                    "text": text,
                    "norm": self._normalize_text(text),
                    "bounds": bounds,
                    "center": self._bounds_center(bounds),
                }
            )
        return nodes

    def _dump_screen_xml(self, device_serial: str = "") -> str:
        if not self.adb_available():
            raise RuntimeError("ADB no esta disponible en PATH.")
        args = ["-s", device_serial.strip()] if device_serial.strip() else []
        remote_path = "/sdcard/window_dump_validacion.xml"
        self._run_adb([*args, "shell", "uiautomator", "dump", remote_path])
        with tempfile.TemporaryDirectory() as tmp_dir:
            local_path = f"{tmp_dir}/window_dump_validacion.xml"
            self._run_adb([*args, "pull", remote_path, local_path])
            with open(local_path, "r", encoding="utf-8") as fh:
                return fh.read()

    def _normalize_text(self, value: str) -> str:
        normalized = unicodedata.normalize("NFD", str(value or ""))
        without_accents = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
        return " ".join(without_accents.lower().split())

    def _bounds_center(self, bounds: str) -> tuple[int, int] | None:
        import re

        match = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", str(bounds or ""))
        if not match:
            return None
        x1, y1, x2, y2 = [int(value) for value in match.groups()]
        return ((x1 + x2) // 2, (y1 + y2) // 2)

    def _run_adb(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        command = ["adb", *args]
        self._log(f"Ejecutando: {' '.join(command)}")
        startupinfo = None
        creationflags = 0
        if hasattr(subprocess, "STARTUPINFO"):
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
            startupinfo=startupinfo,
            creationflags=creationflags,
        )
        if result.stdout.strip():
            self._log(result.stdout.strip())
        if result.stderr.strip():
            self._log(result.stderr.strip())
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "ADB devolvio error.")
        return result

    def _log(self, message: str) -> None:
        log_message(f"[VALIDACION OME BETA] {message}")
        self.log_callback(message)

    def _status(self, message: str) -> None:
        log_message(f"[VALIDACION OME BETA] {message}")
        self.status_callback(message)
