import subprocess
import sys
import webbrowser
import ctypes
import hashlib
import json
import re
from pathlib import Path
from tkinter import messagebox

import customtkinter as ctk

from app_paths import get_data_dir
from app_dialogs import install_dialog_parenting
from app_updates import buscar_actualizacion
from app_version import APP_VERSION, CHECK_UPDATES_ON_START
from app_settings import load_medicos_config
from app_credentials import refresh_object_profile_credentials
from app_theme import (
    APP_BG,
    BACK,
    BACK_HOVER,
    BORDER,
    PRIMARY,
    PRIMARY_HOVER,
    RADIUS,
    SECONDARY,
    SECONDARY_HOVER,
    SECTION_BG,
    SURFACE,
    SURFACE_ALT,
    TEXT,
    TEXT_MUTED,
    TEXT_SOFT,
    compact_ctk_tree,
    configure_ttk_report_style,
    small_font,
    title_font,
)


_APP_MUTEX_HANDLE = None


def _acquire_single_instance_lock() -> bool:
    if not sys.platform.startswith("win"):
        return True

    global _APP_MUTEX_HANDLE
    kernel32 = ctypes.windll.kernel32
    lock_key = hashlib.md5(str(Path.cwd()).lower().encode("utf-8")).hexdigest()[:12]
    mutex_name = f"Local\\SuitePami_{lock_key}"
    handle = kernel32.CreateMutexW(None, True, mutex_name)
    if not handle:
        return True

    ERROR_ALREADY_EXISTS = 183
    WAIT_OBJECT_0 = 0
    WAIT_ABANDONED = 0x00000080
    WAIT_TIMEOUT = 0x00000102
    error = kernel32.GetLastError()
    if error == ERROR_ALREADY_EXISTS:
        wait_result = kernel32.WaitForSingleObject(handle, 10000)
        if wait_result not in (WAIT_OBJECT_0, WAIT_ABANDONED):
            try:
                messagebox.showwarning(
                    "Suite PAMI",
                    "La app ya esta abierta. Cerra la otra ventana antes de iniciar una nueva.",
                )
            except Exception:
                pass
            kernel32.CloseHandle(handle)
            return False
        if wait_result == WAIT_TIMEOUT:
            kernel32.CloseHandle(handle)
            return False

    _APP_MUTEX_HANDLE = handle
    return True


class HomeFrame(ctk.CTkFrame):
    def __init__(
        self,
        master,
        card_columns,
        open_settings,
        open_padron,
        open_panel_rapido,
        open_credencial,
        open_transmision,
        open_ome_med_cabecera,
        open_ome_especialista,
        open_activar,
        open_liberar_cupo,
        open_verificar,
        open_documentacion,
        open_validacion,
        open_afip,
        open_ns_conexion,
        open_refresco,
    ) -> None:
        super().__init__(master, fg_color=APP_BG)
        self.card_columns = card_columns
        self.cards = [
            (
                "Panel Rápido",
                "Centralizar tareas frecuentes sin entrar a los módulos completos.",
                open_panel_rapido,
            ),
            (
                "Descargar Credencial Provisoria",
                "Cargar datos individuales o por lote, descargar PDFs y guardar un reporte Excel si querés.",
                open_credencial,
            ),
            (
                "Transmisión Automática",
                "Gestionar perfiles de acceso, abrir PAMI visible y automatizar la transmisión de OMEs.",
                open_transmision,
            ),
            (
                "Generar OME Médico Cabecera",
                "Abrir CUP, guardar perfiles médicos y automatizar la generación de OMEs de médico de cabecera.",
                open_ome_med_cabecera,
            ),
            (
                "Generar OME Especialista",
                "Usar la misma base de trabajo OME con un módulo separado para prácticas y códigos de especialistas.",
                open_ome_especialista,
            ),
            (
                "Activar OME",
                "Abrir el panel de aceptación, preparar turnos por lote y automatizar la confirmación.",
                open_activar,
            ),
            (
                "Liberar Cupo",
                "Detectar OMEs no validadas y cancelar su aceptación para liberar cupo de turnos.",
                open_liberar_cupo,
            ),
            (
                "Verificar OMEs",
                "Cruzar el reporte de turnos CIMA con el panel de órdenes médicas y generar un Excel con el estado de cada paciente.",
                open_verificar,
            ),
            (
                "Subir Documentación OME",
                "Cruzar informes PDF con el XLS de Transmisión y cargar documentación en OMEs pendientes.",
                open_documentacion,
            ),
            (
                "Validación OME (BETA)",
                "Preparar la validación del paciente con app Android de PAMI y QR de credencial.",
                open_validacion,
            ),
            (
                "Facturación AFIP",
                "Generar Factura C para PAMI desde Comprobantes en línea y guardar PDF, ZIPs y datos de emisión.",
                open_afip,
            ),
            (
                "Conexión con NS",
                "Conectarse a la web NS y traer los nomencladores del mes que elijas, sin copiar el Excel a mano.",
                open_ns_conexion,
            ),
            (
                "Refresco automático",
                "Programar los horarios en que la app baja la bandeja del mes en curso y la sube a la web NS.",
                open_refresco,
            ),
        ]
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self.scroll_frame = ctk.CTkScrollableFrame(self, fg_color=APP_BG)
        self.scroll_frame.grid(row=0, column=0, sticky="nsew")
        self.title_label = ctk.CTkLabel(
            self.scroll_frame,
            text="Seleccioná el módulo que querés usar",
            font=title_font(22),
            text_color=TEXT,
        )
        self.title_label.grid(row=0, column=0, columnspan=self.card_columns, padx=8, pady=(8, 6), sticky="w")
        self._render_cards()

    def update_card_columns(self, card_columns: int) -> None:
        if card_columns == self.card_columns:
            return
        self.card_columns = card_columns
        self._render_cards()

    def _render_cards(self) -> None:
        for child in self.scroll_frame.winfo_children():
            if child is not self.title_label:
                child.destroy()
        for column in range(6):
            self.scroll_frame.grid_columnconfigure(column, weight=0, uniform="")
        self.scroll_frame.grid_columnconfigure(tuple(range(self.card_columns)), weight=1, uniform="home_cards")
        self.title_label.grid_configure(columnspan=self.card_columns)

        for index, (title, subtitle, command) in enumerate(self.cards):
            row = 1 + (index // self.card_columns)
            column = index % self.card_columns
            self._build_card(row=row, column=column, title=title, subtitle=subtitle, command=command)

    def _card_text_wrap(self) -> tuple[int, int]:
        if self.card_columns <= 2:
            return 300, 320
        if self.card_columns == 3:
            return 220, 235
        return 175, 185

    def _build_card(self, row: int, column: int, title: str, subtitle: str, command) -> None:
        title_wrap, subtitle_wrap = self._card_text_wrap()
        card = ctk.CTkFrame(self.scroll_frame, corner_radius=RADIUS, fg_color=SURFACE, border_width=1, border_color=BORDER)
        card.grid(row=row, column=column, padx=5, pady=5, sticky="nsew")
        card.grid_columnconfigure(0, weight=1)
        card.grid_rowconfigure(1, weight=1)
        ctk.CTkLabel(
            card,
            text=title,
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color=TEXT,
            justify="left",
            anchor="w",
            wraplength=title_wrap,
        ).grid(
            row=0, column=0, padx=12, pady=(12, 5), sticky="w"
        )
        ctk.CTkLabel(
            card,
            text=subtitle,
            justify="left",
            anchor="nw",
            wraplength=subtitle_wrap,
            font=small_font(11),
            text_color=TEXT_MUTED,
        ).grid(row=1, column=0, padx=12, pady=(0, 10), sticky="nsew")
        ctk.CTkButton(
            card,
            text="Abrir módulo",
            command=command,
            height=26,
            width=112,
            font=small_font(11, bold=True),
        ).grid(row=2, column=0, padx=12, pady=(0, 12), sticky="sw")


class PamiDesktopApp(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()

        ctk.set_appearance_mode("light")
        ctk.set_default_color_theme("blue")
        self.configure(fg_color=APP_BG)

        self.title("Suite PAMI")
        self.data_dir = get_data_dir()
        self.window_state_file = Path(self.data_dir) / "window_state.json"
        self.resizable(True, True)
        self.start_module_key = self._extract_start_module_key()
        self.current_module_key = "home"
        self.ui_scale = self._compute_ui_scale()
        self.home_card_columns = 3
        self._home_layout_after_id = None
        ctk.set_widget_scaling(self.ui_scale)
        ctk.set_window_scaling(self.ui_scale)
        self._set_min_window_size()
        if not self._restore_window_state():
            self._set_initial_window_size()
        install_dialog_parenting(self)
        self._configure_ttk_styles()

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)
        self.header_frame = self._build_header()

        self.home_frame = HomeFrame(
            self,
            self.home_card_columns,
            self.show_settings_module,
            self.show_padron_module,
            self.show_panel_rapido_module,
            self.show_credencial_module,
            self.show_transmision_module,
            self.show_ome_med_cabecera_module,
            self.show_ome_especialista_module,
            self.show_activar_module,
            self.show_liberar_cupo_module,
            self.show_verificar_module,
            self.show_documentacion_module,
            self.show_validacion_module,
            self.show_afip_module,
            self.show_ns_conexion_module,
            self.show_refresco_module,
        )

        self.padron_frame = None
        self.settings_frame = None
        self.panel_rapido_frame = None
        self.credencial_frame = None
        self.transmision_frame = None
        self.ome_med_cabecera_frame = None
        self.ome_especialista_frame = None
        self.activar_frame = None
        self.liberar_cupo_frame = None
        self.verificar_frame = None
        self.documentacion_frame = None
        self.validacion_frame = None
        self.afip_frame = None
        self.ns_conexion_frame = None
        self.refresco_frame = None

        self._show_start_destination()
        self.bind("<Configure>", self._on_window_configure)
        if CHECK_UPDATES_ON_START:
            self.after(1200, lambda: self._check_for_updates(interactive=False))
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def _compute_ui_scale(self) -> float:
        screen_w = self.winfo_screenwidth()
        screen_h = self.winfo_screenheight()
        scale_w = screen_w / 1600
        scale_h = screen_h / 950
        return max(0.82, min(1.0, min(scale_w, scale_h)))

    def _compute_home_card_columns(self, window_w: int | None = None) -> int:
        current_width = window_w or self.winfo_width() or self.winfo_screenwidth()
        if current_width < 1180:
            return 2
        if current_width < 1680:
            return 3
        return 4

    def _on_window_configure(self, _event=None) -> None:
        if self._home_layout_after_id is not None:
            try:
                self.after_cancel(self._home_layout_after_id)
            except Exception:
                pass
        self._home_layout_after_id = self.after(120, self._refresh_home_layout)

    def _refresh_home_layout(self) -> None:
        self._home_layout_after_id = None
        columns = self._compute_home_card_columns(self.winfo_width())
        if columns != self.home_card_columns:
            self.home_card_columns = columns
            if self.home_frame is not None:
                self.home_frame.update_card_columns(columns)

    def _set_min_window_size(self) -> None:
        min_w = int(900 * self.ui_scale)
        min_h = int(620 * self.ui_scale)
        self.minsize(max(min_w, 820), max(min_h, 560))

    def _configure_ttk_styles(self) -> None:
        configure_ttk_report_style(self, ui_scale=self.ui_scale)

    def _extract_start_module_key(self) -> str | None:
        prefix = "--module="
        for arg in sys.argv[1:]:
            if arg.startswith(prefix):
                value = arg[len(prefix):].strip()
                return value or None
        return None

    def _startup_routes(self) -> dict[str, callable]:
        return {
            "home": self.show_home,
            "settings": self.show_settings_module,
            "padron": self.show_padron_module,
            "panel_rapido": self.show_panel_rapido_module,
            "credencial": self.show_credencial_module,
            "transmision": self.show_transmision_module,
            "ome_med_cabecera": self.show_ome_med_cabecera_module,
            "ome_especialista": self.show_ome_especialista_module,
            "activar": self.show_activar_module,
            "liberar_cupo": self.show_liberar_cupo_module,
            "verificar": self.show_verificar_module,
            "documentacion": self.show_documentacion_module,
            "validacion": self.show_validacion_module,
            "afip": self.show_afip_module,
            "ns_conexion": self.show_ns_conexion_module,
            "refresco": self.show_refresco_module,
        }

    def _show_start_destination(self) -> None:
        route = self._startup_routes().get(self.start_module_key or "home", self.show_home)
        route()

    def _build_header(self):
        header = ctk.CTkFrame(self, corner_radius=RADIUS, fg_color=SURFACE_ALT, border_width=1, border_color=BORDER)
        header.grid(row=0, column=0, padx=8, pady=(6, 6), sticky="ew")
        header.grid_columnconfigure(0, weight=1)
        header.grid_columnconfigure(1, weight=0)
        header.grid_columnconfigure(2, weight=0)
        header.grid_columnconfigure(3, weight=0)
        ctk.CTkLabel(header, text="Suite PAMI", font=title_font(22), text_color=TEXT).grid(
            row=0, column=0, padx=12, pady=(10, 2), sticky="w"
        )
        ctk.CTkLabel(
            header,
            text="Suite de escritorio para padrón, credenciales provisorias, transmisión automática, OME y activación.",
            font=small_font(12),
            text_color=TEXT_MUTED,
        ).grid(row=1, column=0, padx=12, pady=(0, 4), sticky="w")
        ctk.CTkLabel(header, text=f"Carpeta de trabajo: {self.data_dir}", font=small_font(11), text_color=TEXT_SOFT).grid(
            row=2, column=0, padx=12, pady=(0, 10), sticky="w"
        )
        ctk.CTkButton(
            header,
            text="Configuración",
            command=self.show_settings_module,
            width=138,
            height=28,
            fg_color=SECONDARY,
            hover_color=SECONDARY_HOVER,
            font=small_font(11, bold=True),
        ).grid(row=0, column=1, rowspan=3, padx=(10, 6), pady=10, sticky="e")
        ctk.CTkButton(
            header,
            text="Reiniciar app",
            command=self._restart_app,
            width=132,
            height=28,
            fg_color=SECONDARY,
            hover_color=SECONDARY_HOVER,
            font=small_font(11, bold=True),
        ).grid(row=0, column=3, rowspan=3, padx=(6, 12), pady=10, sticky="e")
        return header

    def _check_for_updates(self, interactive: bool = True) -> None:
        result = buscar_actualizacion()
        estado = result.get("estado")

        if estado == "disponible":
            version_remota = result.get("version_remota", "")
            mensaje = (
                f"Hay una actualizacion disponible.\n\n"
                f"Version actual: {APP_VERSION}\n"
                f"Version nueva: {version_remota}"
            )
            notes = str(result.get("mensaje") or "").strip()
            if notes:
                mensaje += f"\n\nDetalle:\n{notes}"
            if messagebox.askyesno("Actualizacion disponible", f"{mensaje}\n\n¿Quieres abrir la descarga ahora?"):
                webbrowser.open(str(result.get("download_url") or ""))
            return

        if estado == "actualizado":
            if interactive:
                version_remota = result.get("version_remota") or APP_VERSION
                messagebox.showinfo(
                    "Sin actualizaciones",
                    f"Ya tienes la ultima version disponible.\n\nVersion actual: {APP_VERSION}\nVersion publicada: {version_remota}",
                )
            return

        mensaje = str(result.get("mensaje") or "No se pudo verificar la actualización.")
        if interactive or estado == "error":
            messagebox.showwarning("Actualizaciones", mensaje)

    def _set_initial_window_size(self) -> None:
        screen_w = self.winfo_screenwidth()
        screen_h = self.winfo_screenheight()
        width = min(max(int(1200 * self.ui_scale), 1000), max(screen_w - 40, 900))
        height = min(max(int(800 * self.ui_scale), 700), max(screen_h - 80, 620))
        pos_x = max((screen_w - width) // 2, 0)
        pos_y = max((screen_h - height) // 2, 0)
        self.geometry(f"{width}x{height}+{pos_x}+{pos_y}")

    def _restore_window_state(self) -> bool:
        try:
            data = json.loads(self.window_state_file.read_text(encoding="utf-8"))
            geometry = str(data.get("geometry") or "").strip()
            state = str(data.get("state") or "normal").strip()
            if not self._geometry_is_visible(geometry):
                return False
            self.geometry(geometry)
            if state == "zoomed":
                self.after(100, lambda: self.state("zoomed"))
            return True
        except Exception:
            return False

    def _save_window_state(self) -> None:
        try:
            state = self.state()
            geometry = self.geometry()
            if state == "zoomed":
                self.state("normal")
                self.update_idletasks()
                geometry = self.geometry()
                self.state("zoomed")
            self.window_state_file.parent.mkdir(parents=True, exist_ok=True)
            self.window_state_file.write_text(
                json.dumps({"geometry": geometry, "state": state}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            pass

    def _geometry_is_visible(self, geometry: str) -> bool:
        match = re.match(r"^(\d+)x(\d+)([+-]\d+)([+-]\d+)$", geometry or "")
        if not match:
            return False
        width = int(match.group(1))
        height = int(match.group(2))
        x = int(match.group(3))
        y = int(match.group(4))
        screen_w = self.winfo_screenwidth()
        screen_h = self.winfo_screenheight()
        margin = 80
        visible_x = x < screen_w - margin and x + width > margin
        visible_y = y < screen_h - margin and y + height > margin
        return visible_x and visible_y

    def _iter_frames(self):
        yield self.home_frame
        for frame in (
            self.settings_frame,
            self.padron_frame,
            self.panel_rapido_frame,
            self.credencial_frame,
            self.transmision_frame,
            self.ome_med_cabecera_frame,
            self.ome_especialista_frame,
            self.activar_frame,
            self.liberar_cupo_frame,
            self.verificar_frame,
            self.documentacion_frame,
            self.validacion_frame,
            self.afip_frame,
            self.ns_conexion_frame,
            self.refresco_frame,
        ):
            if frame is not None:
                yield frame

    def _hide_all(self) -> None:
        self.header_frame.grid_forget()
        for frame in self._iter_frames():
            frame.grid_forget()

    def _show_module(self, frame) -> None:
        self._hide_all()
        frame.grid(row=1, column=0, padx=0, pady=0, sticky="nsew")
        refresh_panel = getattr(frame, "refresh_shared_credentials", None)
        if callable(refresh_panel):
            refresh_panel()
        refresh_object_profile_credentials(frame)
        # compact_ctk_tree recorre todo el arbol de widgets: solo hace falta una vez
        # (es idempotente). Repetirlo en cada cambio de modulo generaba lag.
        if not getattr(frame, "_compacted", False):
            compact_ctk_tree(frame)
            frame._compacted = True

    def _get_padron_frame(self):
        if self.padron_frame is None:
            from padron_module import PadronModuleFrame

            self.padron_frame = PadronModuleFrame(self, self.show_home)
        return self.padron_frame

    def _get_settings_frame(self):
        if self.settings_frame is None:
            from settings_module import SettingsFrame

            self.settings_frame = SettingsFrame(self, self.show_home, self.refresh_settings_config)
        return self.settings_frame

    def _get_panel_rapido_frame(self):
        if self.panel_rapido_frame is None:
            from app_panel_rapido import PanelRapidoFrame

            self.panel_rapido_frame = PanelRapidoFrame(
                self,
                self.show_home,
                self.show_credencial_module,
                self.show_activar_module,
                self.show_liberar_cupo_module,
                lambda: self._restart_app("panel_rapido"),
            )
        return self.panel_rapido_frame

    def _get_credencial_frame(self):
        if self.credencial_frame is None:
            from credencial_module import CredencialModuleFrame

            self.credencial_frame = CredencialModuleFrame(self, self.show_home, lambda: self._restart_app("credencial"))
        return self.credencial_frame

    def _get_transmision_frame(self):
        if self.transmision_frame is None:
            from app_transmision import PamiTransmisionModuleFrame

            self.transmision_frame = PamiTransmisionModuleFrame(self, self.show_home)
        return self.transmision_frame

    def _get_ome_med_cabecera_frame(self):
        if self.ome_med_cabecera_frame is None:
            from app_ome import PamiOmeMedCabeceraModuleFrame

            self.ome_med_cabecera_frame = PamiOmeMedCabeceraModuleFrame(self, self.show_home)
        return self.ome_med_cabecera_frame

    def _get_ome_especialista_frame(self):
        if self.ome_especialista_frame is None:
            from app_ome import PamiOmeEspecialistaModuleFrame

            self.ome_especialista_frame = PamiOmeEspecialistaModuleFrame(self, self.show_home)
        return self.ome_especialista_frame

    def _get_activar_frame(self):
        if self.activar_frame is None:
            from app_activar import PamiActivarModuleFrame

            self.activar_frame = PamiActivarModuleFrame(self, self.show_home)
        return self.activar_frame

    def _get_liberar_cupo_frame(self):
        if self.liberar_cupo_frame is None:
            from app_liberar_cupo import PamiLiberarCupoModuleFrame

            self.liberar_cupo_frame = PamiLiberarCupoModuleFrame(self, self.show_home)
        return self.liberar_cupo_frame

    def _get_verificar_frame(self):
        if self.verificar_frame is None:
            from app_verificar import VerificarFrame

            self.verificar_frame = VerificarFrame(self, self.show_home, lambda: self._restart_app("verificar"))
        return self.verificar_frame

    def _get_documentacion_frame(self):
        if self.documentacion_frame is None:
            from app_documentacion import DocumentacionOmeFrame

            self.documentacion_frame = DocumentacionOmeFrame(self, self.show_home)
        return self.documentacion_frame

    def _get_validacion_frame(self):
        if self.validacion_frame is None:
            from app_validacion import ValidacionOmeBetaFrame

            self.validacion_frame = ValidacionOmeBetaFrame(self, self.show_home)
        return self.validacion_frame

    def _get_afip_frame(self):
        if self.afip_frame is None:
            from app_afip import AfipFacturacionFrame

            self.afip_frame = AfipFacturacionFrame(self, self.show_home)
        return self.afip_frame

    def _get_ns_conexion_frame(self):
        if self.ns_conexion_frame is None:
            from app_ns_conexion import NSConexionFrame

            self.ns_conexion_frame = NSConexionFrame(self, self.show_home)
        return self.ns_conexion_frame

    def _get_refresco_frame(self):
        if self.refresco_frame is None:
            from app_refresco import RefrescoAutomaticoFrame

            self.refresco_frame = RefrescoAutomaticoFrame(self, self.show_home)
        return self.refresco_frame

    def show_home(self) -> None:
        self._hide_all()
        self.current_module_key = "home"
        self.header_frame.grid(row=0, column=0, padx=8, pady=(6, 6), sticky="ew")
        self.home_frame.grid(row=1, column=0, padx=8, pady=(0, 8), sticky="nsew")
        compact_ctk_tree(self.header_frame)
        compact_ctk_tree(self.home_frame)

    def show_settings_module(self) -> None:
        self.current_module_key = "settings"
        self._show_module(self._get_settings_frame())

    def show_padron_module(self) -> None:
        self.current_module_key = "padron"
        self._show_module(self._get_padron_frame())

    def show_panel_rapido_module(self) -> None:
        self.current_module_key = "panel_rapido"
        self._show_module(self._get_panel_rapido_frame())

    def show_credencial_module(self) -> None:
        self.current_module_key = "credencial"
        self._show_module(self._get_credencial_frame())

    def show_transmision_module(self) -> None:
        self.current_module_key = "transmision"
        self._show_module(self._get_transmision_frame())

    def show_ome_med_cabecera_module(self) -> None:
        self.current_module_key = "ome_med_cabecera"
        self._show_module(self._get_ome_med_cabecera_frame())

    def show_ome_especialista_module(self) -> None:
        self.current_module_key = "ome_especialista"
        self._show_module(self._get_ome_especialista_frame())

    def show_activar_module(self) -> None:
        self.current_module_key = "activar"
        self._show_module(self._get_activar_frame())

    def show_liberar_cupo_module(self) -> None:
        self.current_module_key = "liberar_cupo"
        self._show_module(self._get_liberar_cupo_frame())

    def show_verificar_module(self) -> None:
        self.current_module_key = "verificar"
        self._show_module(self._get_verificar_frame())

    def show_documentacion_module(self) -> None:
        self.current_module_key = "documentacion"
        self._show_module(self._get_documentacion_frame())

    def show_validacion_module(self) -> None:
        self.current_module_key = "validacion"
        self._show_module(self._get_validacion_frame())

    def show_afip_module(self) -> None:
        self.current_module_key = "afip"
        self._show_module(self._get_afip_frame())

    def show_ns_conexion_module(self) -> None:
        self.current_module_key = "ns_conexion"
        self._show_module(self._get_ns_conexion_frame())

    def show_refresco_module(self) -> None:
        self.current_module_key = "refresco"
        self._show_module(self._get_refresco_frame())

    def _close_modules(self) -> None:
        for frame in self._iter_frames():
            if frame is not None and hasattr(frame, "on_close"):
                try:
                    frame.on_close()
                except Exception:
                    pass

    def _active_work_labels(self) -> list[str]:
        frame_labels = (
            ("padron_frame", "Padrón"),
            ("panel_rapido_frame", "Panel Rápido"),
            ("credencial_frame", "Credenciales"),
            ("transmision_frame", "Transmisión"),
            ("ome_med_cabecera_frame", "OME Cabecera"),
            ("ome_especialista_frame", "OME Especialista"),
            ("activar_frame", "Activar OME"),
            ("liberar_cupo_frame", "Liberar Cupo"),
            ("verificar_frame", "Verificar OMEs"),
            ("documentacion_frame", "Documentación OME"),
            ("validacion_frame", "Validación OME"),
            ("afip_frame", "Facturación AFIP"),
        )
        active_flags = (
            "processing",
            "action_running",
            "transmision_bot_active",
            "live_status_enabled",
            "status_poll_pending",
            "final_summary_running",
        )
        labels: list[str] = []
        for attr_name, label in frame_labels:
            frame = getattr(self, attr_name, None)
            if frame is None:
                continue
            if any(bool(getattr(frame, flag, False)) for flag in active_flags):
                labels.append(label)
        return labels

    def _confirm_interrupt_active_work(self, action_label: str) -> bool:
        active_labels = self._active_work_labels()
        if not active_labels:
            return True
        detalle = ", ".join(active_labels[:4])
        if len(active_labels) > 4:
            detalle += f" y {len(active_labels) - 4} más"
        return messagebox.askyesno(
            "Proceso en curso",
            "Hay procesos activos en la app.\n\n"
            f"Módulos activos: {detalle}.\n\n"
            "Si interrumpís ahora, puede quedar una descarga, subida a Drive o escritura en Sheets sin terminar.\n\n"
            f"¿Querés {action_label} igual?",
        )

    def _dispose_module_frame(self, attribute_name: str) -> None:
        frame = getattr(self, attribute_name, None)
        if frame is None:
            return
        try:
            if hasattr(frame, "on_close"):
                frame.on_close()
        except Exception:
            pass
        try:
            frame.destroy()
        except Exception:
            pass
        setattr(self, attribute_name, None)

    def refresh_settings_config(self, payload: dict | None = None) -> None:
        payload = payload or {}
        section = str(payload.get("section") or "").strip()

        if section == "medicos":
            medicos_actualizados = payload.get("medicos") or load_medicos_config()
            if self.padron_frame is not None:
                self.padron_frame.refresh_medicos(medicos_actualizados)
            return

        if section == "panel_rapido":
            if self.panel_rapido_frame is not None and hasattr(self.panel_rapido_frame, "refresh_panel_rapido_config"):
                self.panel_rapido_frame.refresh_panel_rapido_config()
            return

        frame_by_section = {
            "transmision": "transmision_frame",
            "ome_med_cabecera": "ome_med_cabecera_frame",
            "ome_especialista": "ome_especialista_frame",
            "activar": "activar_frame",
            "liberar_cupo": "liberar_cupo_frame",
            "verificar": "verificar_frame",
            "documentacion": "documentacion_frame",
            "afip": "afip_frame",
        }
        frame_name = frame_by_section.get(section)
        if frame_name:
            self._dispose_module_frame(frame_name)

    def _restart_app(self, target_module: str | None = None) -> None:
        if not self._confirm_interrupt_active_work("reiniciar la app"):
            return
        module_key = (target_module or self.current_module_key or "home").strip()
        preserved_args = [arg for arg in sys.argv[1:] if not arg.startswith("--module=")]
        if getattr(sys, "frozen", False):
            cmd = [sys.executable, *preserved_args, f"--module={module_key}"]
        else:
            script_path = Path(sys.argv[0]).resolve()
            cmd = [self._python_gui_executable(), str(script_path), *preserved_args, f"--module={module_key}"]

        if sys.platform.startswith("win"):
            subprocess.Popen(
                cmd,
                cwd=str(Path.cwd()),
                creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
                close_fds=True,
            )
        else:
            subprocess.Popen(cmd, cwd=str(Path.cwd()), start_new_session=True)
        self._save_window_state()
        self._close_modules()
        self.destroy()

    def _python_gui_executable(self) -> str:
        executable = Path(sys.executable)
        if sys.platform.startswith("win") and executable.name.lower() == "python.exe":
            pythonw = executable.with_name("pythonw.exe")
            if pythonw.exists():
                return str(pythonw)
        return str(executable)

    def _on_close(self) -> None:
        if not self._confirm_interrupt_active_work("cerrar la app"):
            return
        self._save_window_state()
        self._close_modules()
        self.destroy()


if __name__ == "__main__":
    # Modo headless para la tarea programada (útil cuando la app está compilada
    # como .exe y no hay python del venv para correr bandeja_sync.py directo).
    if "--run-bandeja-sync" in sys.argv:
        from bandeja_sync import sync_all
        for _r in sync_all(progress=lambda m: print("  ", m)):
            estado = f"OK — {_r.get('count')} filas" if _r.get("ok") else f"FALLO — {_r.get('error')}"
            print(f"  {str(_r.get('name'))[:32]:32} -> {estado}")
        sys.exit(0)
    if "--run-bandeja-retry" in sys.argv:
        import bandeja_retry
        bandeja_retry.run(progress=lambda m: print("  ", m))
        sys.exit(0)
    if "--run-bandeja-poller" in sys.argv:
        import bandeja_poller
        bandeja_poller.run(progress=lambda m: print("  ", m))
        sys.exit(0)
    if _acquire_single_instance_lock():
        app = PamiDesktopApp()
        app.mainloop()
