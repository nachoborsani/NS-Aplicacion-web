import csv
import json
import queue
import re
import shutil
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from uuid import uuid4

import customtkinter as ctk

from app_credentials import sync_profile_records, upsert_shared_credentials_from_records
from app_settings import PANEL_RAPIDO_MODULES, load_panel_rapido_config, save_panel_rapido_config
from app_paths import get_data_dir, get_log_file, get_output_dir
from app_transmision import DatePickerDialog
from credencial_module import (
    DESTINATION_PROFILE_MAP,
    DRIVE_PARENT_FOLDER_URL,
    DESTINO_DRIVE_FOLDER_NAMES,
    DESTINO_LOCAL,
    DESTINO_OPTIONS,
    LIMIT_MODE_END_ROW,
    LIMIT_MODE_OPTIONS,
    LIMIT_MODE_TOPE,
    SHEET_PROFILE_DUBE,
    SHEET_PROFILE_OPTIONS,
    SHEET_PROFILE_PLAN_SALUD_CIMA,
    SHEET_PROFILE_SCHEFE,
    clear_local_pdf_paths_for_drive_results,
    normalize_limit_mode,
)
from credencial_scraper import procesar_lote_credenciales
from gmail_informes import get_gmail_credentials_path
from google_drive_storage import (
    get_connected_drive_email,
    get_drive_token_path,
    resolve_child_folder_id,
    upload_file_to_drive_folder,
)
from google_sheets_credenciales import (
    read_credencial_sheet_rows,
    repair_credencial_sheet_missing_tramites,
    write_credencial_sheet_results,
)
from google_sheets_ome import (
    OFFICE_FILE_MESSAGE,
    build_sheets_service,
    check_sheets_connection,
    extract_spreadsheet_id,
    get_sheets_token_path,
    is_office_file_url,
    list_spreadsheet_sheet_names,
    normalize_spreadsheet_url,
    read_ome_sheet_rows,
    write_ome_sheet_results,
)
from pami_activar import PamiActivarController
from pami_liberar_cupo import PamiLiberarCupoController, exportar_reporte_no_validadas
from pami_plan_salud_resolver import (
    explain_unresolved_plan_salud_practice,
    is_skippable_plan_salud_practice,
    resolve_plan_salud_practice,
    resolve_plan_salud_practices,
)
from pami_transmision import PamiTransmisionController
from pami_ome_generator import run_batch_sync


DEFAULT_DIAGNOSTICO = "Z000"
DEFAULT_PRACTICA = "427122"


class PanelRapidoFrame(ctk.CTkFrame):
    def __init__(
        self,
        master,
        on_back=None,
        open_credencial=None,
        open_activar=None,
        open_liberar_cupo=None,
        restart_app=None,
    ) -> None:
        super().__init__(master, fg_color="#f7fafc")
        self.on_back = on_back
        self.open_credencial = open_credencial
        self.open_activar = open_activar
        self.open_liberar_cupo = open_liberar_cupo
        self.restart_app = restart_app
        self.data_dir = get_data_dir()
        self.sheet_settings_file = Path(self.data_dir) / "ome_med_cabecera_sheets_config.json"
        self.specialist_sheet_settings_file = Path(self.data_dir) / "ome_especialista_sheets_config.json"
        self.activar_sheet_settings_file = Path(self.data_dir) / "activar_sheets_config.json"
        self.credencial_settings_file = Path(self.data_dir) / "credenciales_sheets_config.json"
        self.credencial_destination_dir = Path(self.data_dir) / "CREDENCIALES"
        self.credencial_destination_dir.mkdir(parents=True, exist_ok=True)
        self.profiles_file = Path(self.data_dir) / "usuarios_ome_med_cabecera.json"
        self.specialist_profiles_file = Path(self.data_dir) / "usuarios_ome_especialista.json"
        self.activar_profiles_file = Path(self.data_dir) / "usuarios_activar.json"
        self.transmision_profiles_file = Path(self.data_dir) / "usuarios_transmision.json"
        self.liberar_cupo_profiles_file = Path(self.data_dir) / "usuarios_liberar_cupo.json"
        self.event_queue: queue.Queue = queue.Queue()
        self.action_queue: queue.Queue = queue.Queue()
        self.action_thread: threading.Thread | None = None
        self.activar_action_queue: queue.Queue = queue.Queue()
        self.activar_action_thread: threading.Thread | None = None
        self.action_running = False
        self.stop_requested = False
        self.transmision_bot_active = False
        self.transmision_poll_pending = False
        self.transmision_poll_after_id = None
        self.transmision_next_poll_at = 0.0
        self.transmision_done_notified = False
        self._suspend_credencial_settings_save = False
        self._syncing_credencial_limit_mode = False
        self.sheet_settings = self._load_sheet_settings()
        self.specialist_sheet_settings = self._load_specialist_sheet_settings()
        self.activar_sheet_settings = self._load_activate_sheet_settings()
        self.credencial_settings = self._load_credencial_settings()
        self.credencial_sheet_profiles = self._build_credencial_sheet_profiles()
        self.credencial_url_profiles = self._build_credencial_url_profiles()
        self.credencial_sheet_profile_key = str(self.credencial_settings.get("active_sheet_profile", SHEET_PROFILE_DUBE)).strip()
        if self.credencial_sheet_profile_key not in SHEET_PROFILE_OPTIONS:
            self.credencial_sheet_profile_key = SHEET_PROFILE_DUBE
        self._syncing_credencial_profile_destination = False
        self.credencial_missing_benef_rows: list[dict] = []
        self.credencial_missing_tramite_rows: list[dict] = []
        self.credencial_recovered_tramite_rows: list[dict] = []
        self.sheet_profiles = self._extract_sheet_profiles(self.sheet_settings)
        self.selected_sheet_profile_id = str(self.sheet_settings.get("selected_profile_id", "")).strip()
        self.sheet_profile_lookup: dict[str, dict] = {}
        self.saved_profiles = self._load_saved_profiles()
        self.specialist_sheet_profiles = self._extract_sheet_profiles(self.specialist_sheet_settings)
        self.selected_specialist_sheet_profile_id = str(self.specialist_sheet_settings.get("selected_profile_id", "")).strip()
        self.specialist_sheet_profile_lookup: dict[str, dict] = {}
        self.specialist_saved_profiles = self._load_specialist_profiles()
        self.activar_sheet_profiles = self._extract_activate_sheet_profiles(self.activar_sheet_settings)
        self.selected_activar_sheet_profile_id = str(self.activar_sheet_settings.get("selected_profile_id", "")).strip()
        self.activar_sheet_profile_lookup: dict[str, dict] = {}
        self.activar_saved_profiles = self._load_activate_profiles()
        self.panel_config = load_panel_rapido_config()
        self.transmision_profiles = self._load_transmision_profiles()
        self.transmision_profile_lookup: dict[str, dict] = {}
        self.liberar_cupo_profiles = self._load_liberar_cupo_profiles()
        self.liberar_cupo_profile_lookup: dict[str, dict] = {}
        self.liberar_cupo_detected_rows: list[dict] = []
        self.transmision_controller = PamiTransmisionController(
            log_callback=lambda message: self.event_queue.put(("transmision_log", message)),
            status_callback=lambda message: self.event_queue.put(("transmision_status", message)),
        )
        self.liberar_cupo_controller = PamiLiberarCupoController(
            log_callback=lambda message: self.event_queue.put(("liberar_cupo_log", message)),
            status_callback=lambda message: self.event_queue.put(("liberar_cupo_status", message)),
        )
        self.activar_controller = PamiActivarController(
            log_callback=lambda message: self.event_queue.put(("activar_log", message)),
            status_callback=lambda message: self.event_queue.put(("activar_status", message)),
        )

        self._build_ui()
        self.after(400, self._start_sheets_status_check)
        self.after(520, self._start_specialist_sheets_status_check)
        self.after(650, self._start_credencial_sheets_status_check)
        self.after(150, self._process_ui_queue)

    def _build_ui(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        top = ctk.CTkFrame(self, corner_radius=8, fg_color="#f7fafc", border_width=1, border_color="#d8e2ec")
        top.grid(row=0, column=0, padx=8, pady=(6, 4), sticky="ew")
        top.grid_columnconfigure(1, weight=1)
        if self.on_back:
            ctk.CTkButton(top, text="Volver", width=72, height=26, command=self.on_back, fg_color="#9aafc3").grid(
                row=0, column=0, padx=(8, 8), pady=5, sticky="w"
            )
        ctk.CTkLabel(top, text="Panel Rapido", font=ctk.CTkFont(size=20, weight="bold"), text_color="#16324f").grid(
            row=0, column=1, padx=(6, 8), pady=5, sticky="w"
        )
        ctk.CTkLabel(
            top,
            text="Accesos compactos PAMI",
            font=ctk.CTkFont(size=12),
            text_color="#51657a",
        ).grid(row=0, column=2, padx=(0, 10), pady=5, sticky="e")
        ctk.CTkButton(
            top,
            text="Config",
            width=70,
            height=26,
            command=self._open_panel_config_dialog,
            fg_color="#66788a",
            hover_color="#536577",
        ).grid(row=0, column=3, padx=(0, 6), pady=5, sticky="e")
        ctk.CTkButton(
            top,
            text="Reiniciar",
            width=82,
            height=26,
            command=self._restart_from_panel,
            fg_color="#66788a",
            hover_color="#536577",
        ).grid(row=0, column=4, padx=(0, 8), pady=5, sticky="e")

        content = ctk.CTkScrollableFrame(self, corner_radius=8, fg_color="#ffffff")
        content.grid(row=1, column=0, padx=8, pady=(0, 7), sticky="nsew")
        content.grid_columnconfigure(0, weight=1)
        self.content_frame = content

        self._build_credenciales_block(content)

        block = ctk.CTkFrame(content, corner_radius=8, fg_color="#f4f8fb", border_width=1, border_color="#d8e2ec")
        self.med_cabecera_block = block
        for col in range(12):
            block.grid_columnconfigure(col, weight=0)
        block.grid_columnconfigure(12, weight=1)

        ctk.CTkLabel(
            block,
            text="Med Cabecera - Sheets",
            font=ctk.CTkFont(size=15, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, columnspan=4, padx=8, pady=(8, 3), sticky="w")
        ctk.CTkLabel(
            block,
            text="BENEF u OME 427122",
            font=ctk.CTkFont(size=11),
            text_color="#51657a",
        ).grid(row=0, column=8, columnspan=4, padx=8, pady=(8, 3), sticky="e")

        self.sheet_url_var = ctk.StringVar(value=normalize_spreadsheet_url(str(self.sheet_settings.get("spreadsheet_url", ""))))
        self.sheet_template_display_var = ctk.StringVar(value="")
        self.sheet_name_var = ctk.StringVar(value=str(self.sheet_settings.get("sheet_name", "Mc Dube")))
        self.sheet_start_row_var = ctk.StringVar(value=str(self.sheet_settings.get("start_row", 2)))
        self.sheet_max_rows_var = ctk.StringVar(value=str(self.sheet_settings.get("max_rows", 40)))
        self.sheet_limit_mode_var = ctk.StringVar(
            value=self._sheet_limit_mode_label(self.sheet_settings.get("limit_mode", "cantidad"))
        )
        self.sheet_profile_var = ctk.StringVar(value="")
        self.profile_var = ctk.StringVar(value="")
        self.profile_name_var = ctk.StringVar(value="")
        self.profile_user_var = ctk.StringVar(value="")
        self.profile_password_var = ctk.StringVar(value="")
        self.ver_web_var = ctk.BooleanVar(value=bool(self.panel_config.get("ver_web_default", False)))
        self.specialist_sheet_url_var = ctk.StringVar(
            value=normalize_spreadsheet_url(str(self.specialist_sheet_settings.get("spreadsheet_url", "")))
        )
        self.specialist_template_display_var = ctk.StringVar(value="")
        self.specialist_sheet_name_var = ctk.StringVar(value=str(self.specialist_sheet_settings.get("sheet_name", "JULIO")))
        self.specialist_sheet_tabs = self._settings_sheet_tabs(
            self.specialist_sheet_settings,
            self.specialist_sheet_name_var.get(),
        )
        self.specialist_sheet_start_row_var = ctk.StringVar(value=str(self.specialist_sheet_settings.get("start_row", 2)))
        self.specialist_sheet_max_rows_var = ctk.StringVar(value=str(self.specialist_sheet_settings.get("max_rows", 40)))
        self.specialist_sheet_profile_var = ctk.StringVar(value="")
        self.specialist_profile_var = ctk.StringVar(value="")
        self.specialist_profile_name_var = ctk.StringVar(value="")
        self.specialist_profile_user_var = ctk.StringVar(value="")
        self.specialist_profile_password_var = ctk.StringVar(value="")
        self.specialist_ver_web_var = ctk.BooleanVar(
            value=bool(self.specialist_sheet_settings.get("browser_visible", self.panel_config.get("ver_web_default", False)))
        )
        self.specialist_sheets_status_var = ctk.StringVar(value="Google Sheets no conectado")
        self.specialist_status_var = ctk.StringVar(value="Especialista listo.")
        self.sheets_status_var = ctk.StringVar(value="Google Sheets no conectado")
        self.status_var = ctk.StringVar(value="Listo.")
        self.active_config_var = ctk.StringVar(value="")
        self.result_summary_var = ctk.StringVar(value="Sin ejecuciones en esta sesion.")
        self.transmision_profile_var = ctk.StringVar(value="")
        self.transmision_fecha_desde_var = ctk.StringVar(value="")
        self.transmision_fecha_hasta_var = ctk.StringVar(value=self._today_str())
        self.transmision_validada_var = ctk.StringVar(value="")
        self.transmision_transmitida_var = ctk.StringVar(value="")
        self.transmision_ver_web_var = ctk.BooleanVar(value=bool(self.panel_config.get("ver_web_default", False)))
        self.transmision_status_var = ctk.StringVar(value="Transmision lista.")
        self.transmision_badge_var = ctk.StringVar(value="SIN CORRER")
        self.liberar_cupo_profile_var = ctk.StringVar(value="")
        self.liberar_cupo_fecha_desde_var = ctk.StringVar(value=self._today_str())
        self.liberar_cupo_fecha_hasta_var = ctk.StringVar(value=self._today_str())
        self.liberar_cupo_max_pages_var = ctk.StringVar(value="10")
        self.liberar_cupo_ver_web_var = ctk.BooleanVar(value=False)
        self.liberar_cupo_status_var = ctk.StringVar(value="Liberar Cupo listo.")
        self.activar_sheet_url_var = ctk.StringVar(value=normalize_spreadsheet_url(str(self.activar_sheet_settings.get("spreadsheet_url", ""))))
        self.activar_template_display_var = ctk.StringVar(value="")
        self.activar_sheet_name_var = ctk.StringVar(value=str(self.activar_sheet_settings.get("sheet_name", "Mc Dube")))
        self.activar_sheet_start_row_var = ctk.StringVar(value=str(self.activar_sheet_settings.get("start_row", 2)))
        self.activar_sheet_max_rows_var = ctk.StringVar(value=str(self.activar_sheet_settings.get("max_rows", 40)))
        self.activar_sheet_profile_var = ctk.StringVar(value="")
        initial_activar_sheet_name = str(self.activar_sheet_settings.get("sheet_name", "")).strip()
        self.activar_sheet_tabs = self._settings_sheet_tabs(
            self.activar_sheet_settings,
            initial_activar_sheet_name,
        )
        self.activar_profile_var = ctk.StringVar(value="")
        self.activar_profile_name_var = ctk.StringVar(value="")
        self.activar_profile_user_var = ctk.StringVar(value="")
        self.activar_profile_password_var = ctk.StringVar(value="")
        self.activar_ver_web_var = ctk.BooleanVar(value=bool(self.activar_sheet_settings.get("browser_visible", self.panel_config.get("ver_web_default", False))))
        self.activar_sheets_status_var = ctk.StringVar(value="Google Sheets no conectado")
        self.activar_status_var = ctk.StringVar(value="Buscador OME listo.")
        for variable in (
            self.sheet_url_var,
            self.sheet_name_var,
            self.sheet_start_row_var,
            self.sheet_max_rows_var,
            self.sheet_limit_mode_var,
            self.profile_user_var,
            self.specialist_sheet_url_var,
            self.specialist_sheet_name_var,
            self.specialist_sheet_start_row_var,
            self.specialist_sheet_max_rows_var,
            self.specialist_profile_user_var,
        ):
            variable.trace_add("write", lambda *_args: self._update_active_config())
        for variable in (
            self.activar_sheet_url_var,
            self.activar_sheet_name_var,
            self.activar_sheet_start_row_var,
            self.activar_sheet_max_rows_var,
            self.activar_profile_user_var,
        ):
            variable.trace_add("write", lambda *_args: self._update_active_config())
        self._build_specialist_block(content)

        ctk.CTkLabel(block, text="Hoja", text_color="#16324f").grid(row=1, column=0, padx=8, pady=3, sticky="w")
        self.sheet_combo = ctk.CTkComboBox(
            block,
            values=self._sheet_profile_options() or [""],
            variable=self.sheet_profile_var,
            command=self._on_sheet_profile_selected,
            state="readonly",
            width=360,
            height=28,
        )
        self.sheet_combo.grid(row=1, column=1, columnspan=5, padx=(0, 14), pady=3, sticky="w")

        ctk.CTkLabel(block, text="PAMI", text_color="#16324f").grid(row=1, column=6, padx=(6, 6), pady=3, sticky="w")
        self.profile_combo = ctk.CTkComboBox(
            block,
            values=self._profile_options() or [""],
            variable=self.profile_var,
            command=self._on_profile_selected,
            state="readonly",
            width=300,
            height=28,
        )
        self.profile_combo.grid(row=1, column=7, columnspan=5, padx=(0, 8), pady=3, sticky="w")

        ctk.CTkLabel(block, text="Plantilla", text_color="#16324f").grid(row=2, column=0, padx=8, pady=3, sticky="w")
        self.sheet_url_entry = ctk.CTkEntry(block, textvariable=self.sheet_template_display_var, height=28, state="readonly")
        self.sheet_url_entry.grid(row=2, column=1, columnspan=4, padx=(0, 14), pady=3, sticky="w")
        self.sheet_url_entry.bind("<Button-1>", lambda _event: self._open_sheet_template_dialog("cabecera"), add="+")
        self.sheet_url_config_button = ctk.CTkButton(
            block,
            text="⚙",
            command=lambda: self._open_sheet_template_dialog("cabecera"),
            width=32,
            height=28,
            fg_color="#66788a",
            hover_color="#536577",
        )
        self.sheet_url_config_button.grid(row=2, column=5, padx=(0, 6), pady=3, sticky="w")

        ctk.CTkLabel(block, text="Pest.", text_color="#16324f").grid(row=2, column=6, padx=(6, 6), pady=3, sticky="w")
        self.sheet_name_entry = ctk.CTkEntry(block, textvariable=self.sheet_name_var, width=130, height=28)
        self.sheet_name_entry.grid(row=2, column=7, padx=(0, 6), pady=3, sticky="ew")

        ctk.CTkLabel(block, text="Fila", text_color="#16324f").grid(row=2, column=8, padx=(4, 4), pady=3, sticky="w")
        self.sheet_start_entry = ctk.CTkEntry(block, textvariable=self.sheet_start_row_var, width=70, height=28)
        self.sheet_start_entry.grid(row=2, column=9, padx=(0, 6), pady=3, sticky="w")

        self.sheet_limit_mode_combo = ctk.CTkComboBox(
            block,
            values=["Cantidad", "Fila final"],
            variable=self.sheet_limit_mode_var,
            state="readonly",
            width=88,
            height=28,
        )
        self.sheet_limit_mode_combo.grid(row=2, column=10, padx=(4, 4), pady=3, sticky="w")
        self.sheet_max_entry = ctk.CTkEntry(block, textvariable=self.sheet_max_rows_var, width=70, height=28)
        self.sheet_max_entry.grid(row=2, column=11, padx=(0, 8), pady=3, sticky="w")

        actions = ctk.CTkFrame(block, fg_color="transparent")
        actions.grid(row=3, column=0, columnspan=12, padx=8, pady=(2, 3), sticky="w")

        self.ver_web_check = ctk.CTkCheckBox(actions, text="Ver web", variable=self.ver_web_var, text_color="#16324f")
        self.ver_web_check.grid(row=0, column=0, padx=(0, 14), pady=0, sticky="w")

        self.connect_button = ctk.CTkButton(
            actions,
            text="Conectar",
            command=lambda: self._run_action(self._connect_sheets_account),
            width=104,
            height=28,
        )
        self.connect_button.grid(row=0, column=1, padx=(0, 6), pady=0, sticky="w")

        self.run_button = ctk.CTkButton(
            actions,
            text="Verificar BENEF",
            command=lambda: self._run_action(self._run_complete_benef_from_sheets),
            fg_color="#1f7a46",
            hover_color="#176238",
            width=132,
            height=28,
        )
        self.run_button.grid(row=0, column=2, padx=(0, 6), pady=0, sticky="w")

        self.generate_ome_button = ctk.CTkButton(
            actions,
            text="Generar OME",
            command=lambda: self._run_action(self._run_generate_ome_from_sheets),
            fg_color="#245b9d",
            hover_color="#1d4b82",
            width=128,
            height=28,
        )
        self.generate_ome_button.grid(row=0, column=3, padx=(0, 6), pady=0, sticky="w")

        self.stop_button = ctk.CTkButton(
            actions,
            text="Detener",
            command=self._request_stop,
            fg_color="#bd6b2a",
            hover_color="#9d571f",
            width=88,
            height=28,
        )
        self.stop_button.grid(row=0, column=4, padx=(0, 6), pady=0, sticky="w")

        self.refresh_button = ctk.CTkButton(
            actions,
            text="Recargar",
            command=self._refresh_sources,
            fg_color="#66788a",
            hover_color="#536577",
            width=88,
            height=28,
        )
        self.refresh_button.grid(row=0, column=5, padx=(0, 16), pady=0, sticky="w")

        ctk.CTkLabel(actions, textvariable=self.sheets_status_var, text_color="#51657a", font=ctk.CTkFont(size=11)).grid(
            row=0, column=6, padx=(0, 14), pady=0, sticky="w"
        )
        ctk.CTkLabel(actions, textvariable=self.status_var, text_color="#16324f", font=ctk.CTkFont(size=11, weight="bold")).grid(
            row=0, column=7, padx=(0, 14), pady=0, sticky="w"
        )
        ctk.CTkLabel(actions, textvariable=self.active_config_var, text_color="#51657a", font=ctk.CTkFont(size=11)).grid(
            row=0, column=8, padx=0, pady=0, sticky="w"
        )

        self._build_activar_block(content)

        results = ctk.CTkFrame(content, corner_radius=8, fg_color="#f7fafc", border_width=1, border_color="#d8e2ec")
        self.results_block = results
        results.grid_columnconfigure(0, weight=1)
        result_header = ctk.CTkFrame(results, fg_color="transparent")
        result_header.grid(row=0, column=0, padx=8, pady=(6, 3), sticky="ew")
        result_header.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(
            result_header,
            text="Resultado rapido",
            font=ctk.CTkFont(size=15, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=(0, 8), pady=0, sticky="w")
        ctk.CTkLabel(
            result_header,
            textvariable=self.result_summary_var,
            text_color="#51657a",
            font=ctk.CTkFont(size=11),
        ).grid(row=0, column=1, padx=0, pady=0, sticky="w")
        self.results_table = ttk.Treeview(
            results,
            columns=("fila", "dni", "beneficio", "nombre", "resultado"),
            show="headings",
            height=2,
        )
        for column, text, width in (
            ("fila", "Fila", 52),
            ("dni", "DNI", 92),
            ("beneficio", "BENEF", 122),
            ("nombre", "Nombre", 220),
            ("resultado", "Resultado", 128),
        ):
            self.results_table.heading(column, text=text)
            self.results_table.column(column, width=width, anchor="w")
        self.results_table.grid(row=1, column=0, padx=8, pady=(0, 6), sticky="ew")

        self._build_transmision_block(content)
        self._build_liberar_cupo_block(content)

        self._restore_sheet_profile_selection()
        self._load_initial_profile_into_form()
        self._restore_specialist_sheet_profile_selection()
        self._load_initial_specialist_profile_into_form()
        self._restore_activate_sheet_profile_selection()
        self._load_initial_activate_profile_into_form()
        self._restore_transmision_profile_selection()
        self._restore_liberar_cupo_profile_selection()
        self._update_active_config()
        self._apply_panel_layout()
        self._compact_panel_widgets()
        self._set_controls_enabled(True)

    def _build_activar_block(self, content) -> None:
        block = ctk.CTkFrame(content, corner_radius=8, fg_color="#f4f8fb", border_width=1, border_color="#d8e2ec")
        self.activar_block = block
        for col in range(12):
            block.grid_columnconfigure(col, weight=0)
        block.grid_columnconfigure(12, weight=1)

        ctk.CTkLabel(
            block,
            text="Activar OME - Sheets",
            font=ctk.CTkFont(size=15, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, columnspan=4, padx=8, pady=(8, 3), sticky="w")
        ctk.CTkLabel(
            block,
            text="Buscador rapido de OMEs + acceso al modulo completo",
            font=ctk.CTkFont(size=11),
            text_color="#51657a",
        ).grid(row=0, column=7, columnspan=5, padx=8, pady=(8, 3), sticky="e")

        ctk.CTkLabel(block, text="Hoja", text_color="#16324f").grid(row=1, column=0, padx=8, pady=3, sticky="w")
        self.activar_sheet_combo = ctk.CTkComboBox(
            block,
            values=self._activate_sheet_profile_options() or [""],
            variable=self.activar_sheet_profile_var,
            command=self._on_activate_sheet_profile_selected,
            state="readonly",
            width=360,
            height=28,
        )
        self.activar_sheet_combo.grid(row=1, column=1, columnspan=5, padx=(0, 14), pady=3, sticky="w")

        ctk.CTkLabel(block, text="PAMI", text_color="#16324f").grid(row=1, column=6, padx=(6, 6), pady=3, sticky="w")
        self.activar_profile_combo = ctk.CTkComboBox(
            block,
            values=self._activate_profile_options() or [""],
            variable=self.activar_profile_var,
            command=self._on_activate_profile_selected,
            state="readonly",
            width=300,
            height=28,
        )
        self.activar_profile_combo.grid(row=1, column=7, columnspan=5, padx=(0, 8), pady=3, sticky="w")

        ctk.CTkLabel(block, text="Plantilla", text_color="#16324f").grid(row=2, column=0, padx=8, pady=3, sticky="w")
        self.activar_sheet_url_entry = ctk.CTkEntry(
            block,
            textvariable=self.activar_template_display_var,
            height=28,
            state="readonly",
        )
        self.activar_sheet_url_entry.grid(row=2, column=1, columnspan=4, padx=(0, 14), pady=3, sticky="w")
        self.activar_sheet_url_entry.bind("<Button-1>", lambda _event: self._open_sheet_template_dialog("activar"), add="+")
        self.activar_sheet_url_config_button = ctk.CTkButton(
            block,
            text="⚙",
            command=lambda: self._open_sheet_template_dialog("activar"),
            width=32,
            height=28,
            fg_color="#66788a",
            hover_color="#536577",
        )
        self.activar_sheet_url_config_button.grid(row=2, column=5, padx=(0, 6), pady=3, sticky="w")

        ctk.CTkLabel(block, text="Pest.", text_color="#16324f").grid(row=2, column=6, padx=(6, 6), pady=3, sticky="w")
        self.activar_sheet_name_entry = ctk.CTkComboBox(
            block,
            values=self.activar_sheet_tabs or [self.activar_sheet_name_var.get() or ""],
            variable=self.activar_sheet_name_var,
            width=130,
            height=28,
            state="normal",
        )
        self.activar_sheet_name_entry.grid(row=2, column=7, padx=(0, 6), pady=3, sticky="w")

        ctk.CTkLabel(block, text="Fila", text_color="#16324f").grid(row=2, column=8, padx=(4, 4), pady=3, sticky="w")
        self.activar_sheet_start_entry = ctk.CTkEntry(block, textvariable=self.activar_sheet_start_row_var, width=70, height=28)
        self.activar_sheet_start_entry.grid(row=2, column=9, padx=(0, 6), pady=3, sticky="w")

        ctk.CTkLabel(block, text="Tope", text_color="#16324f").grid(row=2, column=10, padx=(4, 4), pady=3, sticky="w")
        self.activar_sheet_max_entry = ctk.CTkEntry(block, textvariable=self.activar_sheet_max_rows_var, width=70, height=28)
        self.activar_sheet_max_entry.grid(row=2, column=11, padx=(0, 8), pady=3, sticky="w")

        actions = ctk.CTkFrame(block, fg_color="transparent")
        actions.grid(row=3, column=0, columnspan=12, padx=8, pady=(2, 6), sticky="w")

        self.activar_ver_web_check = ctk.CTkCheckBox(actions, text="Ver web", variable=self.activar_ver_web_var, text_color="#16324f")
        self.activar_ver_web_check.grid(row=0, column=0, padx=(0, 14), pady=0, sticky="w")

        self.activar_connect_button = ctk.CTkButton(
            actions,
            text="Conectar",
            command=lambda: self._run_activar_action(self._connect_activate_sheets_account),
            width=104,
            height=28,
        )
        self.activar_connect_button.grid(row=0, column=1, padx=(0, 6), pady=0, sticky="w")

        self.activar_tabs_button = ctk.CTkButton(
            actions,
            text="Pags",
            command=lambda: self._run_activar_action(self._load_activate_sheet_tabs),
            width=76,
            height=28,
            fg_color="#66788a",
            hover_color="#536577",
        )
        self.activar_tabs_button.grid(row=0, column=2, padx=(0, 6), pady=0, sticky="w")

        self.activar_lookup_button = ctk.CTkButton(
            actions,
            text="Buscar N° OME",
            command=lambda: self._run_activar_action(self._run_activate_ome_lookup_from_sheets),
            fg_color="#bd6b2a",
            hover_color="#9d571f",
            width=134,
            height=28,
        )
        self.activar_lookup_button.grid(row=0, column=3, padx=(0, 6), pady=0, sticky="w")

        self.open_activar_button = ctk.CTkButton(
            actions,
            text="Abrir modulo",
            command=self._open_activar_module,
            fg_color="#245b9d",
            hover_color="#1d4b82",
            width=116,
            height=28,
        )
        self.open_activar_button.grid(row=0, column=4, padx=(0, 6), pady=0, sticky="w")

        self.activar_refresh_button = ctk.CTkButton(
            actions,
            text="Recargar",
            command=self._refresh_sources,
            fg_color="#66788a",
            hover_color="#536577",
            width=88,
            height=28,
        )
        self.activar_refresh_button.grid(row=0, column=5, padx=(0, 16), pady=0, sticky="w")

        ctk.CTkLabel(actions, textvariable=self.activar_sheets_status_var, text_color="#51657a", font=ctk.CTkFont(size=11)).grid(
            row=0, column=6, padx=(0, 14), pady=0, sticky="w"
        )
        ctk.CTkLabel(actions, textvariable=self.activar_status_var, text_color="#16324f", font=ctk.CTkFont(size=11, weight="bold")).grid(
            row=0, column=7, padx=(0, 14), pady=0, sticky="w"
        )

    def _build_credenciales_block(self, content) -> None:
        block = ctk.CTkFrame(content, corner_radius=8, fg_color="#f4f8fb", border_width=1, border_color="#d8e2ec")
        self.credenciales_block = block
        block.grid_columnconfigure(0, weight=1)

        active_credencial_profile = self._get_credencial_sheet_profile_values(self.credencial_sheet_profile_key)
        self.credencial_sheet_profile_var = ctk.StringVar(value=self.credencial_sheet_profile_key)
        self.credencial_internal_name_var = ctk.StringVar(value=str(active_credencial_profile.get("internal_name", "")).strip())
        self.credencial_url_var = ctk.StringVar(
            value=normalize_spreadsheet_url(str(active_credencial_profile.get("spreadsheet_url", "")))
        )
        self.credencial_template_display_var = ctk.StringVar(value="")
        self.credencial_sheet_name_var = ctk.StringVar(value=str(active_credencial_profile.get("sheet_name", "")))
        self.credencial_start_row_var = ctk.StringVar(value=str(active_credencial_profile.get("start_row", 2)))
        self.credencial_max_rows_var = ctk.StringVar(value=str(active_credencial_profile.get("max_rows", "40")))
        self.credencial_end_row_var = ctk.StringVar(value=str(active_credencial_profile.get("end_row", "")))
        self.credencial_limit_mode_var = ctk.StringVar(
            value=normalize_limit_mode(
                str(active_credencial_profile.get("limit_mode", LIMIT_MODE_TOPE)),
                has_end_row=bool(str(active_credencial_profile.get("end_row", "")).strip()),
            )
        )
        self.credencial_only_with_tramite_var = ctk.BooleanVar(value=bool(active_credencial_profile.get("only_with_tramite", False)))
        initial_sheet_name = str(self.credencial_settings.get("sheet_name", "")).strip()
        self.credencial_sheet_tabs = [initial_sheet_name] if initial_sheet_name else []
        saved_destination = str(self.credencial_settings.get("destination_mode", DESTINO_LOCAL))
        self.credencial_destination_var = ctk.StringVar(
            value=saved_destination if saved_destination in DESTINO_OPTIONS else DESTINO_LOCAL
        )
        self.credencial_status_var = ctk.StringVar(value="Credenciales listas.")
        if self.credencial_limit_mode_var.get() not in LIMIT_MODE_OPTIONS:
            self.credencial_limit_mode_var.set(
                normalize_limit_mode("", has_end_row=bool(self.credencial_end_row_var.get().strip()))
            )
        for variable in (
            self.credencial_internal_name_var,
            self.credencial_url_var,
            self.credencial_sheet_name_var,
            self.credencial_start_row_var,
            self.credencial_max_rows_var,
            self.credencial_end_row_var,
            self.credencial_limit_mode_var,
            self.credencial_only_with_tramite_var,
            self.credencial_destination_var,
        ):
            variable.trace_add("write", lambda *_args: self._save_credencial_settings())

        header = ctk.CTkFrame(block, fg_color="transparent")
        header.grid(row=0, column=0, padx=8, pady=(8, 2), sticky="ew")
        header.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            header,
            text="Credenciales",
            font=ctk.CTkFont(size=15, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=0, pady=0, sticky="w")
        ctk.CTkLabel(
            header,
            textvariable=self.credencial_status_var,
            font=ctk.CTkFont(size=11),
            text_color="#51657a",
        ).grid(row=0, column=1, padx=(12, 0), pady=0, sticky="e")

        sheet_bar = ctk.CTkFrame(block, fg_color="transparent")
        sheet_bar.grid(row=1, column=0, padx=8, pady=(2, 4), sticky="ew")
        sheet_bar.grid_columnconfigure(10, weight=1)

        range_bar = ctk.CTkFrame(block, fg_color="transparent")
        range_bar.grid(row=2, column=0, padx=8, pady=(0, 8), sticky="ew")
        range_bar.grid_columnconfigure(9, weight=1)

        ctk.CTkLabel(sheet_bar, text="Perfil", text_color="#16324f").grid(row=0, column=0, padx=(0, 6), pady=0, sticky="w")
        self.credencial_profile_combo = ctk.CTkComboBox(
            sheet_bar,
            values=SHEET_PROFILE_OPTIONS,
            variable=self.credencial_sheet_profile_var,
            command=self._on_credencial_profile_changed,
            state="readonly",
            width=148,
            height=28,
        )
        self.credencial_profile_combo.grid(row=0, column=1, padx=(0, 12), pady=0, sticky="w")

        ctk.CTkLabel(sheet_bar, text="Destino", text_color="#16324f").grid(row=0, column=2, padx=(0, 6), pady=0, sticky="w")
        self.credencial_destination_combo = ctk.CTkComboBox(
            sheet_bar,
            values=DESTINO_OPTIONS,
            variable=self.credencial_destination_var,
            command=self._on_credencial_destination_changed,
            state="readonly",
            width=235,
            height=28,
        )
        self.credencial_destination_combo.grid(row=0, column=3, padx=(0, 16), pady=0, sticky="w")

        ctk.CTkLabel(sheet_bar, text="Hoja", text_color="#16324f").grid(row=0, column=4, padx=(0, 6), pady=0, sticky="w")
        self.credencial_url_entry = ctk.CTkEntry(
            sheet_bar,
            textvariable=self.credencial_template_display_var,
            width=190,
            height=28,
            state="readonly",
        )
        self.credencial_url_entry.grid(row=0, column=5, padx=(0, 12), pady=0, sticky="w")
        self.credencial_url_entry.bind("<Button-1>", lambda _event: self._open_credencial_sheet_template_dialog(), add="+")

        self.credencial_url_config_button = ctk.CTkButton(
            sheet_bar,
            text="Configurar",
            command=self._open_credencial_sheet_template_dialog,
            width=96,
            height=28,
            fg_color="#66788a",
            hover_color="#536577",
        )
        self.credencial_url_config_button.grid(row=0, column=6, padx=(0, 12), pady=0, sticky="w")

        ctk.CTkLabel(sheet_bar, text="Pest.", text_color="#16324f").grid(row=0, column=7, padx=(0, 6), pady=0, sticky="w")
        self.credencial_sheet_name_combo = ctk.CTkComboBox(
            sheet_bar,
            values=self.credencial_sheet_tabs or [""],
            variable=self.credencial_sheet_name_var,
            command=lambda _selected: (self._save_credencial_settings(), self._update_credencial_template_display()),
            width=190,
            height=28,
        )
        self.credencial_sheet_name_combo.grid(row=0, column=8, padx=(0, 8), pady=0, sticky="w")
        self.credencial_tabs_button = ctk.CTkButton(
            sheet_bar,
            text="Pest.",
            command=lambda: self._run_action(self._load_credencial_sheet_tabs),
            width=64,
            height=28,
            fg_color="#66788a",
            hover_color="#536577",
        )
        self.credencial_tabs_button.grid(row=0, column=9, padx=0, pady=0, sticky="w")

        ctk.CTkLabel(range_bar, text="Fila inicial", text_color="#16324f").grid(row=0, column=0, padx=(0, 6), pady=0, sticky="w")
        self.credencial_start_row_entry = ctk.CTkEntry(range_bar, textvariable=self.credencial_start_row_var, width=76, height=28)
        self.credencial_start_row_entry.grid(row=0, column=1, padx=(0, 14), pady=0, sticky="w")

        ctk.CTkLabel(range_bar, text="Modo", text_color="#16324f").grid(row=0, column=2, padx=(0, 6), pady=0, sticky="w")
        self.credencial_limit_mode_combo = ctk.CTkComboBox(
            range_bar,
            values=LIMIT_MODE_OPTIONS,
            variable=self.credencial_limit_mode_var,
            command=self._on_credencial_limit_mode_changed,
            state="readonly",
            width=124,
            height=28,
        )
        self.credencial_limit_mode_combo.grid(row=0, column=3, padx=(0, 14), pady=0, sticky="w")

        ctk.CTkLabel(range_bar, text="Tope", text_color="#16324f").grid(row=0, column=4, padx=(0, 6), pady=0, sticky="w")
        self.credencial_max_rows_entry = ctk.CTkEntry(range_bar, textvariable=self.credencial_max_rows_var, width=76, height=28)
        self.credencial_max_rows_entry.grid(row=0, column=5, padx=(0, 14), pady=0, sticky="w")

        ctk.CTkLabel(range_bar, text="Hasta fila", text_color="#16324f").grid(row=0, column=6, padx=(0, 6), pady=0, sticky="w")
        self.credencial_end_row_entry = ctk.CTkEntry(
            range_bar,
            textvariable=self.credencial_end_row_var,
            width=86,
            height=28,
            placeholder_text="Opc.",
        )
        self.credencial_end_row_entry.grid(row=0, column=7, padx=(0, 18), pady=0, sticky="w")

        self.credencial_only_with_tramite_check = ctk.CTkCheckBox(
            range_bar,
            text="Solo con trámite",
            variable=self.credencial_only_with_tramite_var,
            command=self._save_credencial_settings,
            width=126,
        )
        self.credencial_only_with_tramite_check.grid(row=0, column=8, padx=(0, 14), pady=0, sticky="w")

        actions = ctk.CTkFrame(range_bar, fg_color="transparent")
        actions.grid(row=0, column=9, padx=(4, 0), pady=0, sticky="w")

        self.credencial_connect_button = ctk.CTkButton(
            actions,
            text="Conectar",
            command=lambda: self._run_action(self._connect_credencial_sheets_account),
            width=92,
            height=28,
            fg_color="#245b9d",
            hover_color="#1d4b82",
        )
        self.credencial_connect_button.grid(row=0, column=0, padx=(0, 6), pady=0, sticky="w")
        self.credencial_save_button = ctk.CTkButton(
            actions,
            text="Guardar config",
            command=self._save_current_credencial_url,
            width=108,
            height=28,
            fg_color="#66788a",
            hover_color="#536577",
        )
        self.credencial_save_button.grid(row=0, column=1, padx=(0, 6), pady=0, sticky="w")

        self.credencial_scan_button = ctk.CTkButton(
            actions,
            text="Barrido tramite",
            command=lambda: self._run_action(lambda: self._scan_credencial_sheet_missing_tramites(notify=True)),
            width=124,
            height=28,
            fg_color="#66788a",
            hover_color="#536577",
        )
        self.credencial_scan_button.grid(row=0, column=2, padx=(0, 6), pady=0, sticky="w")

        self.credencial_run_button = ctk.CTkButton(
            actions,
            text="Descargar",
            command=lambda: self._run_action(self._run_credenciales_from_sheets),
            width=96,
            height=28,
            fg_color="#1f7a46",
            hover_color="#176238",
        )
        self.credencial_run_button.grid(row=0, column=3, padx=(0, 6), pady=0, sticky="w")

        self.open_credenciales_button = ctk.CTkButton(
            actions,
            text="Abrir modulo",
            command=self._open_credenciales_module,
            width=120,
            height=28,
            fg_color="#245b9d",
            hover_color="#1d4b82",
        )
        self.open_credenciales_button.grid(row=0, column=4, padx=0, pady=0, sticky="w")
        self._apply_credencial_limit_mode()
        self._update_credencial_template_display()

    def _open_credenciales_module(self) -> None:
        if self.open_credencial is None:
            messagebox.showwarning("Credenciales", "El acceso al modulo de credenciales no esta disponible.")
            return
        self.open_credencial()

    def _open_liberar_cupo_module(self) -> None:
        if self.open_liberar_cupo is None:
            messagebox.showwarning("Liberar Cupo", "El acceso al modulo Liberar Cupo no esta disponible.")
            return
        self.open_liberar_cupo()

    def _restart_from_panel(self) -> None:
        if self.restart_app is None:
            messagebox.showwarning("Panel Rapido", "El reinicio de la app no esta disponible.")
            return
        if self.action_running or self.transmision_bot_active:
            if not messagebox.askyesno(
                "Reiniciar app",
                "Hay una accion o transmision en curso.\n\nSi reinicias ahora se cerraran los navegadores activos.\n\n¿Reiniciar igual?",
            ):
                return
        else:
            if not messagebox.askyesno("Reiniciar app", "¿Reiniciar la app y volver al Panel Rapido?"):
                return
        self.restart_app()

    def _build_transmision_block(self, content) -> None:
        block = ctk.CTkFrame(content, corner_radius=8, fg_color="#f4f8fb", border_width=1, border_color="#d8e2ec")
        self.transmision_block = block
        block.grid_columnconfigure(0, weight=1)

        header = ctk.CTkFrame(block, fg_color="transparent")
        header.grid(row=0, column=0, padx=10, pady=(8, 4), sticky="ew")
        header.grid_columnconfigure(3, weight=1)

        ctk.CTkLabel(
            header,
            text="Transmision",
            font=ctk.CTkFont(size=15, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=(0, 10), pady=0, sticky="w")
        self.transmision_badge_label = ctk.CTkLabel(
            header,
            textvariable=self.transmision_badge_var,
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color="#ffffff",
            fg_color="#66788a",
            corner_radius=6,
            width=82,
            height=22,
        )
        self.transmision_badge_label.grid(row=0, column=1, padx=(0, 10), pady=0, sticky="w")
        ctk.CTkLabel(
            header,
            textvariable=self.transmision_status_var,
            font=ctk.CTkFont(size=11),
            text_color="#51657a",
        ).grid(row=0, column=3, padx=0, pady=0, sticky="e")

        fields = ctk.CTkFrame(block, fg_color="transparent")
        fields.grid(row=1, column=0, padx=10, pady=(0, 4), sticky="ew")
        fields.grid_columnconfigure(8, weight=1)

        ctk.CTkLabel(fields, text="Perfil", text_color="#16324f").grid(row=0, column=0, padx=(0, 6), pady=0, sticky="w")
        self.transmision_profile_combo = ctk.CTkComboBox(
            fields,
            values=self._transmision_profile_options() or [""],
            variable=self.transmision_profile_var,
            command=self._on_transmision_profile_selected,
            state="readonly",
            width=420,
            height=28,
        )
        self.transmision_profile_combo.grid(row=0, column=1, padx=(0, 18), pady=0, sticky="w")

        ctk.CTkLabel(fields, text="Desde", text_color="#16324f").grid(row=0, column=2, padx=(0, 6), pady=0, sticky="w")
        self.transmision_fecha_desde_entry = ctk.CTkEntry(
            fields,
            textvariable=self.transmision_fecha_desde_var,
            width=92,
            height=28,
            state="readonly",
        )
        self.transmision_fecha_desde_entry.grid(row=0, column=3, padx=(0, 4), pady=0, sticky="w")
        self.transmision_fecha_desde_entry.bind(
            "<Button-1>",
            lambda _event: self._pick_filter_date(self.transmision_fecha_desde_var),
            add="+",
        )
        self.transmision_fecha_desde_button = ctk.CTkButton(
            fields,
            text="...",
            width=30,
            height=28,
            command=lambda: self._pick_filter_date(self.transmision_fecha_desde_var),
        )
        self.transmision_fecha_desde_button.grid(row=0, column=4, padx=(0, 14), pady=0, sticky="w")

        ctk.CTkLabel(fields, text="Hasta", text_color="#16324f").grid(row=0, column=5, padx=(0, 6), pady=0, sticky="w")
        self.transmision_fecha_hasta_entry = ctk.CTkEntry(
            fields,
            textvariable=self.transmision_fecha_hasta_var,
            width=92,
            height=28,
            state="readonly",
        )
        self.transmision_fecha_hasta_entry.grid(row=0, column=6, padx=(0, 4), pady=0, sticky="w")
        self.transmision_fecha_hasta_entry.bind(
            "<Button-1>",
            lambda _event: self._pick_filter_date(self.transmision_fecha_hasta_var),
            add="+",
        )
        self.transmision_fecha_hasta_button = ctk.CTkButton(
            fields,
            text="...",
            width=30,
            height=28,
            command=lambda: self._pick_filter_date(self.transmision_fecha_hasta_var),
        )
        self.transmision_fecha_hasta_button.grid(row=0, column=7, padx=0, pady=0, sticky="w")

        actions = ctk.CTkFrame(block, fg_color="transparent")
        actions.grid(row=2, column=0, padx=10, pady=(0, 8), sticky="w")

        ctk.CTkLabel(actions, text="Validada", text_color="#16324f").grid(row=0, column=0, padx=(0, 6), pady=0, sticky="w")
        self.transmision_validada_combo = ctk.CTkComboBox(
            actions,
            values=["", "Si", "No"],
            variable=self.transmision_validada_var,
            width=80,
            height=28,
            state="readonly",
        )
        self.transmision_validada_combo.grid(row=0, column=1, padx=(0, 14), pady=0, sticky="w")

        ctk.CTkLabel(actions, text="Transmitida", text_color="#16324f").grid(row=0, column=2, padx=(0, 6), pady=0, sticky="w")
        self.transmision_transmitida_combo = ctk.CTkComboBox(
            actions,
            values=["", "No", "Si"],
            variable=self.transmision_transmitida_var,
            width=80,
            height=28,
            state="readonly",
        )
        self.transmision_transmitida_combo.grid(row=0, column=3, padx=(0, 18), pady=0, sticky="w")

        self.transmision_ver_web_check = ctk.CTkCheckBox(
            actions,
            text="Ver web",
            variable=self.transmision_ver_web_var,
            text_color="#16324f",
        )
        self.transmision_ver_web_check.grid(row=0, column=4, padx=(0, 18), pady=0, sticky="w")

        self.transmision_run_button = ctk.CTkButton(
            actions,
            text="Transmitir",
            command=lambda: self._run_action(self._run_transmision_open_and_start, allow_during_transmision=True),
            fg_color="#1f7a46",
            hover_color="#176238",
            width=108,
            height=28,
        )
        self.transmision_run_button.grid(row=0, column=5, padx=(0, 6), pady=0, sticky="w")

        self.transmision_pause_button = ctk.CTkButton(
            actions,
            text="Pausar",
            command=lambda: self._run_action(self.transmision_controller.pausar_bot, allow_during_transmision=True),
            fg_color="#bd6b2a",
            hover_color="#9d571f",
            width=82,
            height=28,
        )
        self.transmision_pause_button.grid(row=0, column=6, padx=(0, 6), pady=0, sticky="w")

        self.transmision_resume_button = ctk.CTkButton(
            actions,
            text="Reanudar",
            command=lambda: self._run_action(self.transmision_controller.reanudar_bot, allow_during_transmision=True),
            fg_color="#245b9d",
            hover_color="#1d4b82",
            width=92,
            height=28,
        )
        self.transmision_resume_button.grid(row=0, column=7, padx=(0, 6), pady=0, sticky="w")

        self.transmision_status_button = ctk.CTkButton(
            actions,
            text="Estado",
            command=lambda: self._run_action(self._show_transmision_estado, allow_during_transmision=True),
            fg_color="#66788a",
            hover_color="#536577",
            width=78,
            height=28,
        )
        self.transmision_status_button.grid(row=0, column=8, padx=(0, 6), pady=0, sticky="w")

        self.transmision_close_button = ctk.CTkButton(
            actions,
            text="Cerrar",
            command=lambda: self._run_action(self._close_transmision_session, allow_during_transmision=True),
            fg_color="#8a5a5a",
            hover_color="#734949",
            width=78,
            height=28,
        )
        self.transmision_close_button.grid(row=0, column=9, padx=0, pady=0, sticky="w")

    def _build_liberar_cupo_block(self, content) -> None:
        block = ctk.CTkFrame(content, corner_radius=8, fg_color="#f4f8fb", border_width=1, border_color="#d8e2ec")
        self.liberar_cupo_block = block
        block.grid_columnconfigure(0, weight=1)

        header = ctk.CTkFrame(block, fg_color="transparent")
        header.grid(row=0, column=0, padx=10, pady=(8, 4), sticky="ew")
        header.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            header,
            text="Liberar Cupo",
            font=ctk.CTkFont(size=15, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=(0, 10), pady=0, sticky="w")
        ctk.CTkLabel(
            header,
            textvariable=self.liberar_cupo_status_var,
            font=ctk.CTkFont(size=11),
            text_color="#51657a",
        ).grid(row=0, column=1, padx=0, pady=0, sticky="e")

        fields = ctk.CTkFrame(block, fg_color="transparent")
        fields.grid(row=1, column=0, padx=10, pady=(0, 4), sticky="ew")
        fields.grid_columnconfigure(10, weight=1)

        ctk.CTkLabel(fields, text="Perfil", text_color="#16324f").grid(row=0, column=0, padx=(0, 6), pady=0, sticky="w")
        self.liberar_cupo_profile_combo = ctk.CTkComboBox(
            fields,
            values=self._liberar_cupo_profile_options() or [""],
            variable=self.liberar_cupo_profile_var,
            command=self._on_liberar_cupo_profile_selected,
            state="readonly",
            width=420,
            height=28,
        )
        self.liberar_cupo_profile_combo.grid(row=0, column=1, padx=(0, 18), pady=0, sticky="w")

        ctk.CTkLabel(fields, text="Desde", text_color="#16324f").grid(row=0, column=2, padx=(0, 6), pady=0, sticky="w")
        self.liberar_cupo_fecha_desde_entry = ctk.CTkEntry(
            fields,
            textvariable=self.liberar_cupo_fecha_desde_var,
            width=92,
            height=28,
            state="readonly",
        )
        self.liberar_cupo_fecha_desde_entry.grid(row=0, column=3, padx=(0, 4), pady=0, sticky="w")
        self.liberar_cupo_fecha_desde_entry.bind(
            "<Button-1>",
            lambda _event: self._pick_filter_date(self.liberar_cupo_fecha_desde_var),
            add="+",
        )
        self.liberar_cupo_fecha_desde_button = ctk.CTkButton(
            fields,
            text="...",
            width=30,
            height=28,
            command=lambda: self._pick_filter_date(self.liberar_cupo_fecha_desde_var),
        )
        self.liberar_cupo_fecha_desde_button.grid(row=0, column=4, padx=(0, 14), pady=0, sticky="w")

        ctk.CTkLabel(fields, text="Hasta", text_color="#16324f").grid(row=0, column=5, padx=(0, 6), pady=0, sticky="w")
        self.liberar_cupo_fecha_hasta_entry = ctk.CTkEntry(
            fields,
            textvariable=self.liberar_cupo_fecha_hasta_var,
            width=92,
            height=28,
            state="readonly",
        )
        self.liberar_cupo_fecha_hasta_entry.grid(row=0, column=6, padx=(0, 4), pady=0, sticky="w")
        self.liberar_cupo_fecha_hasta_entry.bind(
            "<Button-1>",
            lambda _event: self._pick_filter_date(self.liberar_cupo_fecha_hasta_var),
            add="+",
        )
        self.liberar_cupo_fecha_hasta_button = ctk.CTkButton(
            fields,
            text="...",
            width=30,
            height=28,
            command=lambda: self._pick_filter_date(self.liberar_cupo_fecha_hasta_var),
        )
        self.liberar_cupo_fecha_hasta_button.grid(row=0, column=7, padx=(0, 14), pady=0, sticky="w")

        ctk.CTkLabel(fields, text="Pag.", text_color="#16324f").grid(row=0, column=8, padx=(0, 6), pady=0, sticky="w")
        self.liberar_cupo_max_pages_entry = ctk.CTkEntry(
            fields,
            textvariable=self.liberar_cupo_max_pages_var,
            width=48,
            height=28,
        )
        self.liberar_cupo_max_pages_entry.grid(row=0, column=9, padx=0, pady=0, sticky="w")

        actions = ctk.CTkFrame(block, fg_color="transparent")
        actions.grid(row=2, column=0, padx=10, pady=(0, 8), sticky="w")

        self.liberar_cupo_ver_web_check = ctk.CTkCheckBox(
            actions,
            text="Ver web",
            variable=self.liberar_cupo_ver_web_var,
            text_color="#16324f",
        )
        self.liberar_cupo_ver_web_check.grid(row=0, column=0, padx=(0, 14), pady=0, sticky="w")

        self.liberar_cupo_detect_button = ctk.CTkButton(
            actions,
            text="Detectar no validadas",
            command=lambda: self._run_action(self._run_liberar_cupo_detectar),
            width=148,
            height=28,
        )
        self.liberar_cupo_detect_button.grid(row=0, column=1, padx=(0, 6), pady=0, sticky="w")

        self.liberar_cupo_release_button = ctk.CTkButton(
            actions,
            text="Liberar detectadas",
            command=self._confirm_liberar_cupo_detectadas,
            fg_color="#8a5a5a",
            hover_color="#734949",
            width=142,
            height=28,
        )
        self.liberar_cupo_release_button.grid(row=0, column=2, padx=(0, 6), pady=0, sticky="w")

        self.liberar_cupo_report_button = ctk.CTkButton(
            actions,
            text="Reporte",
            command=self._export_liberar_cupo_report,
            fg_color="#66788a",
            hover_color="#536577",
            width=82,
            height=28,
        )
        self.liberar_cupo_report_button.grid(row=0, column=3, padx=(0, 6), pady=0, sticky="w")

        self.liberar_cupo_close_button = ctk.CTkButton(
            actions,
            text="Cerrar",
            command=lambda: self._run_action(self.liberar_cupo_controller.cerrar_navegador),
            fg_color="#8a5a5a",
            hover_color="#734949",
            width=78,
            height=28,
        )
        self.liberar_cupo_close_button.grid(row=0, column=4, padx=(0, 6), pady=0, sticky="w")

        self.open_liberar_cupo_button = ctk.CTkButton(
            actions,
            text="Abrir modulo",
            command=self._open_liberar_cupo_module,
            fg_color="#245b9d",
            hover_color="#1d4b82",
            width=118,
            height=28,
        )
        self.open_liberar_cupo_button.grid(row=0, column=5, padx=0, pady=0, sticky="w")

    def _module_frame_map(self) -> dict[str, ctk.CTkFrame]:
        return {
            "med_cabecera_sheets": self.med_cabecera_block,
            "especialista_sheets": self.especialista_block,
            "activar_ome_sheets": self.activar_block,
            "transmision": self.transmision_block,
            "liberar_cupo": self.liberar_cupo_block,
            "credenciales": self.credenciales_block,
        }

    def refresh_shared_credentials(self) -> None:
        self.saved_profiles = self._load_saved_profiles()
        self.specialist_saved_profiles = self._load_specialist_profiles()
        self.activar_saved_profiles = self._load_activate_profiles()
        self.transmision_profiles = self._load_transmision_profiles()
        self.liberar_cupo_profiles = self._load_liberar_cupo_profiles()
        for combo, options_fn in (
            (getattr(self, "profile_combo", None), self._profile_options),
            (getattr(self, "specialist_profile_combo", None), self._specialist_profile_options),
            (getattr(self, "activar_profile_combo", None), self._activate_profile_options),
            (getattr(self, "transmision_profile_combo", None), self._transmision_profile_options),
            (getattr(self, "liberar_cupo_profile_combo", None), self._liberar_cupo_profile_options),
        ):
            if combo is None:
                continue
            options = options_fn()
            combo.configure(values=options or [""])
        for var, callback in (
            (getattr(self, "profile_var", None), self._on_profile_selected),
            (getattr(self, "specialist_profile_var", None), self._on_specialist_profile_selected),
            (getattr(self, "activar_profile_var", None), self._on_activate_profile_selected),
            (getattr(self, "transmision_profile_var", None), self._on_transmision_profile_selected),
            (getattr(self, "liberar_cupo_profile_var", None), self._on_liberar_cupo_profile_selected),
        ):
            try:
                selected = str(var.get() or "").strip() if var is not None else ""
                if selected:
                    callback(selected)
            except Exception:
                pass

    def _apply_panel_layout(self) -> None:
        frame_map = self._module_frame_map()
        for frame in frame_map.values():
            frame.grid_forget()
        self.results_block.grid_forget()

        row = 0
        for module in self.panel_config.get("modules", []):
            key = str(module.get("key", "")).strip()
            if not module.get("visible", True):
                continue
            frame = frame_map.get(key)
            if frame is None:
                continue
            frame.grid(row=row, column=0, padx=3, pady=(3 if row == 0 else 0, 3), sticky="ew")
            row += 1

        self.results_block.grid(row=row, column=0, padx=3, pady=(0 if row else 3, 3), sticky="nsew")

    def _compact_panel_widgets(self) -> None:
        def walk(widget) -> None:
            for child in widget.winfo_children():
                if isinstance(child, ctk.CTkButton):
                    try:
                        text = str(child.cget("text") or "")
                        current_width = int(child.cget("width") or 0)
                        target_width = max(44, min(current_width or 82, len(text) * 6 + 16))
                        child.configure(width=target_width, height=23, corner_radius=5, font=ctk.CTkFont(size=11))
                    except Exception:
                        pass
                elif isinstance(child, ctk.CTkComboBox):
                    try:
                        current_width = int(child.cget("width") or 0)
                        if current_width > 180:
                            child.configure(width=min(current_width, 420), height=23)
                        else:
                            child.configure(height=23)
                    except Exception:
                        pass
                elif isinstance(child, ctk.CTkEntry):
                    try:
                        child.configure(height=23)
                    except Exception:
                        pass
                elif isinstance(child, ctk.CTkCheckBox):
                    try:
                        child.configure(font=ctk.CTkFont(size=11))
                    except Exception:
                        pass
                walk(child)

        walk(self)

    def _panel_text(self, value: object, limit: int = 74) -> str:
        text = re.sub(r"\s+", " ", str(value or "")).strip()
        if len(text) <= limit:
            return text
        return f"{text[: max(0, limit - 3)]}..."

    def _open_panel_config_dialog(self) -> None:
        modules = [dict(item) for item in self.panel_config.get("modules", PANEL_RAPIDO_MODULES)]
        default_labels = {item["key"]: item["label"] for item in PANEL_RAPIDO_MODULES}
        visible_vars: dict[str, ctk.BooleanVar] = {}

        dialog = ctk.CTkToplevel(self)
        dialog.title("Configurar Panel Rapido")
        dialog.geometry("460x330")
        dialog.transient(self.winfo_toplevel())
        dialog.grab_set()
        dialog.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            dialog,
            text="Orden y visibilidad",
            font=ctk.CTkFont(size=18, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=14, pady=(14, 4), sticky="w")
        ctk.CTkLabel(
            dialog,
            text="Los cambios se aplican al guardar, sin reiniciar.",
            font=ctk.CTkFont(size=12),
            text_color="#51657a",
        ).grid(row=1, column=0, padx=14, pady=(0, 10), sticky="w")

        rows_frame = ctk.CTkFrame(dialog, corner_radius=8, fg_color="#f4f8fb", border_width=1, border_color="#d8e2ec")
        rows_frame.grid(row=2, column=0, padx=14, pady=(0, 10), sticky="ew")
        rows_frame.grid_columnconfigure(1, weight=1)

        def sync_visible_values() -> None:
            for item in modules:
                key = str(item.get("key", "")).strip()
                if key in visible_vars:
                    item["visible"] = bool(visible_vars[key].get())

        def move(index: int, delta: int) -> None:
            sync_visible_values()
            new_index = index + delta
            if new_index < 0 or new_index >= len(modules):
                return
            modules[index], modules[new_index] = modules[new_index], modules[index]
            render_rows()

        def render_rows() -> None:
            for child in rows_frame.winfo_children():
                child.destroy()
            visible_vars.clear()
            for index, item in enumerate(modules):
                key = str(item.get("key", "")).strip()
                label = str(item.get("label") or default_labels.get(key) or key)
                visible_vars[key] = ctk.BooleanVar(value=bool(item.get("visible", True)))
                ctk.CTkCheckBox(
                    rows_frame,
                    text="",
                    variable=visible_vars[key],
                    width=24,
                ).grid(row=index, column=0, padx=(10, 6), pady=6, sticky="w")
                ctk.CTkLabel(rows_frame, text=label, text_color="#16324f").grid(
                    row=index, column=1, padx=4, pady=6, sticky="w"
                )
                ctk.CTkButton(
                    rows_frame,
                    text="Subir",
                    width=62,
                    height=26,
                    command=lambda i=index: move(i, -1),
                ).grid(row=index, column=2, padx=(4, 4), pady=6, sticky="e")
                ctk.CTkButton(
                    rows_frame,
                    text="Bajar",
                    width=62,
                    height=26,
                    command=lambda i=index: move(i, 1),
                ).grid(row=index, column=3, padx=(0, 10), pady=6, sticky="e")

        def save_and_apply() -> None:
            sync_visible_values()
            self.panel_config = save_panel_rapido_config(
                {
                    "ver_web_default": self.panel_config.get("ver_web_default", False),
                    "modules": modules,
                }
            )
            self._apply_panel_layout()
            dialog.destroy()

        render_rows()

        buttons = ctk.CTkFrame(dialog, fg_color="transparent")
        buttons.grid(row=3, column=0, padx=14, pady=(0, 14), sticky="e")
        ctk.CTkButton(
            buttons,
            text="Cancelar",
            width=90,
            fg_color="#9aafc3",
            hover_color="#7f95aa",
            command=dialog.destroy,
        ).grid(row=0, column=0, padx=(0, 8), sticky="e")
        ctk.CTkButton(buttons, text="Guardar", width=90, command=save_and_apply).grid(row=0, column=1, sticky="e")

    def _build_specialist_block(self, content) -> None:
        block = ctk.CTkFrame(content, corner_radius=8, fg_color="#f4f8fb", border_width=1, border_color="#d8e2ec")
        self.especialista_block = block
        for col in range(12):
            block.grid_columnconfigure(col, weight=0)
        block.grid_columnconfigure(12, weight=1)

        ctk.CTkLabel(
            block,
            text="Especialista - Sheets",
            font=ctk.CTkFont(size=15, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, columnspan=4, padx=8, pady=(8, 3), sticky="w")
        ctk.CTkLabel(
            block,
            text="Plan Salud / practicas por fila",
            font=ctk.CTkFont(size=11),
            text_color="#51657a",
        ).grid(row=0, column=8, columnspan=4, padx=8, pady=(8, 3), sticky="e")

        ctk.CTkLabel(block, text="Hoja", text_color="#16324f").grid(row=1, column=0, padx=8, pady=3, sticky="w")
        self.specialist_sheet_combo = ctk.CTkComboBox(
            block,
            values=self._specialist_sheet_profile_options() or [""],
            variable=self.specialist_sheet_profile_var,
            command=self._on_specialist_sheet_profile_selected,
            state="readonly",
            width=360,
            height=28,
        )
        self.specialist_sheet_combo.grid(row=1, column=1, columnspan=5, padx=(0, 14), pady=3, sticky="w")

        ctk.CTkLabel(block, text="PAMI", text_color="#16324f").grid(row=1, column=6, padx=(6, 6), pady=3, sticky="w")
        self.specialist_profile_combo = ctk.CTkComboBox(
            block,
            values=self._specialist_profile_options() or [""],
            variable=self.specialist_profile_var,
            command=self._on_specialist_profile_selected,
            state="readonly",
            width=300,
            height=28,
        )
        self.specialist_profile_combo.grid(row=1, column=7, columnspan=5, padx=(0, 8), pady=3, sticky="w")

        ctk.CTkLabel(block, text="Plantilla", text_color="#16324f").grid(row=2, column=0, padx=8, pady=3, sticky="w")
        self.specialist_sheet_url_entry = ctk.CTkEntry(
            block,
            textvariable=self.specialist_template_display_var,
            height=28,
            state="readonly",
        )
        self.specialist_sheet_url_entry.grid(row=2, column=1, columnspan=4, padx=(0, 14), pady=3, sticky="w")
        self.specialist_sheet_url_entry.bind("<Button-1>", lambda _event: self._open_sheet_template_dialog("especialista"), add="+")
        self.specialist_sheet_url_config_button = ctk.CTkButton(
            block,
            text="⚙",
            command=lambda: self._open_sheet_template_dialog("especialista"),
            width=32,
            height=28,
            fg_color="#66788a",
            hover_color="#536577",
        )
        self.specialist_sheet_url_config_button.grid(row=2, column=5, padx=(0, 6), pady=3, sticky="w")

        ctk.CTkLabel(block, text="Pest.", text_color="#16324f").grid(row=2, column=6, padx=(6, 6), pady=3, sticky="w")
        self.specialist_sheet_name_entry = ctk.CTkComboBox(
            block,
            values=self.specialist_sheet_tabs or [""],
            variable=self.specialist_sheet_name_var,
            width=130,
            height=28,
            state="normal",
        )
        self.specialist_sheet_name_entry.grid(row=2, column=7, padx=(0, 6), pady=3, sticky="w")

        ctk.CTkLabel(block, text="Fila", text_color="#16324f").grid(row=2, column=8, padx=(4, 4), pady=3, sticky="w")
        self.specialist_sheet_start_entry = ctk.CTkEntry(block, textvariable=self.specialist_sheet_start_row_var, width=70, height=28)
        self.specialist_sheet_start_entry.grid(row=2, column=9, padx=(0, 6), pady=3, sticky="w")

        ctk.CTkLabel(block, text="Tope", text_color="#16324f").grid(row=2, column=10, padx=(4, 4), pady=3, sticky="w")
        self.specialist_sheet_max_entry = ctk.CTkEntry(block, textvariable=self.specialist_sheet_max_rows_var, width=70, height=28)
        self.specialist_sheet_max_entry.grid(row=2, column=11, padx=(0, 8), pady=3, sticky="w")

        actions = ctk.CTkFrame(block, fg_color="transparent")
        actions.grid(row=3, column=0, columnspan=12, padx=8, pady=(2, 3), sticky="w")

        self.specialist_ver_web_check = ctk.CTkCheckBox(actions, text="Ver web", variable=self.specialist_ver_web_var, text_color="#16324f")
        self.specialist_ver_web_check.grid(row=0, column=0, padx=(0, 14), pady=0, sticky="w")

        self.specialist_connect_button = ctk.CTkButton(
            actions,
            text="Conectar",
            command=lambda: self._run_action(self._connect_specialist_sheets_account),
            width=104,
            height=28,
        )
        self.specialist_connect_button.grid(row=0, column=1, padx=(0, 6), pady=0, sticky="w")

        self.specialist_load_tabs_button = ctk.CTkButton(
            actions,
            text="Pestanas",
            command=lambda: self._run_action(self._load_specialist_sheet_tabs),
            fg_color="#66788a",
            hover_color="#536577",
            width=92,
            height=28,
        )
        self.specialist_load_tabs_button.grid(row=0, column=2, padx=(0, 6), pady=0, sticky="w")

        self.specialist_benef_button = ctk.CTkButton(
            actions,
            text="Verificar BENEF",
            command=lambda: self._run_action(self._run_specialist_complete_benef_from_sheets),
            fg_color="#1f7a46",
            hover_color="#176238",
            width=128,
            height=28,
        )
        self.specialist_benef_button.grid(row=0, column=3, padx=(0, 6), pady=0, sticky="w")

        self.specialist_dni_button = ctk.CTkButton(
            actions,
            text="Verificar DNI",
            command=lambda: self._run_action(self._run_specialist_complete_dni_from_sheets),
            fg_color="#1f7a46",
            hover_color="#176238",
            width=120,
            height=28,
        )
        self.specialist_dni_button.grid(row=0, column=4, padx=(0, 6), pady=0, sticky="w")

        self.specialist_generate_button = ctk.CTkButton(
            actions,
            text="Generar OME",
            command=lambda: self._run_action(self._run_specialist_generate_ome_from_sheets),
            fg_color="#245b9d",
            hover_color="#1d4b82",
            width=128,
            height=28,
        )
        self.specialist_generate_button.grid(row=0, column=5, padx=(0, 6), pady=0, sticky="w")

        self.specialist_refresh_button = ctk.CTkButton(
            actions,
            text="Recargar",
            command=self._refresh_sources,
            fg_color="#66788a",
            hover_color="#536577",
            width=88,
            height=28,
        )
        self.specialist_refresh_button.grid(row=0, column=6, padx=(0, 16), pady=0, sticky="w")

        ctk.CTkLabel(actions, textvariable=self.specialist_sheets_status_var, text_color="#51657a", font=ctk.CTkFont(size=11)).grid(
            row=0, column=7, padx=(0, 14), pady=0, sticky="w"
        )
        ctk.CTkLabel(actions, textvariable=self.specialist_status_var, text_color="#16324f", font=ctk.CTkFont(size=11, weight="bold")).grid(
            row=0, column=8, padx=(0, 14), pady=0, sticky="w"
        )

    def _load_sheet_settings(self) -> dict:
        try:
            if self.sheet_settings_file.exists():
                data = json.loads(self.sheet_settings_file.read_text(encoding="utf-8-sig"))
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
        return {}

    def _load_specialist_sheet_settings(self) -> dict:
        try:
            if self.specialist_sheet_settings_file.exists():
                data = json.loads(self.specialist_sheet_settings_file.read_text(encoding="utf-8-sig"))
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
        return {}

    def _merge_sheet_tabs(self, tabs: list[str] | None, current_sheet: str = "") -> list[str]:
        merged: list[str] = []
        for item in tabs or []:
            text = str(item or "").strip()
            if text and text not in merged:
                merged.append(text)
        current = str(current_sheet or "").strip()
        if current and current not in merged:
            merged.insert(0, current)
        return merged

    def _settings_sheet_tabs(self, settings: dict | None, current_sheet: str = "") -> list[str]:
        raw_tabs = settings.get("sheet_tabs") if isinstance(settings, dict) else None
        tabs: list[str] = []
        if isinstance(raw_tabs, list):
            tabs = [str(item or "").strip() for item in raw_tabs if str(item or "").strip()]
        fallback_sheet = ""
        if isinstance(settings, dict):
            fallback_sheet = str(settings.get("sheet_name", "") or "").strip()
        return self._merge_sheet_tabs(tabs, current_sheet or fallback_sheet)

    def _extract_sheet_profiles(self, data: dict) -> list[dict]:
        profiles: list[dict] = []
        profiles_by_template: dict[tuple[str, str], dict] = {}
        selected_profile_id = str(data.get("selected_profile_id", "")).strip() if isinstance(data, dict) else ""

        def add_profile(profile: dict) -> None:
            if not profile.get("spreadsheet_url"):
                return
            signature = self._sheet_template_signature(profile)
            existing = profiles_by_template.get(signature)
            if existing:
                merged_tabs = self._merge_sheet_tabs(existing.get("sheet_tabs", []), profile.get("sheet_name", ""))
                for tab in profile.get("sheet_tabs", []) or []:
                    merged_tabs = self._merge_sheet_tabs(merged_tabs, tab)
                if selected_profile_id and profile.get("profile_id") == selected_profile_id:
                    existing.update(profile)
                existing["sheet_tabs"] = merged_tabs
                return
            profiles_by_template[signature] = profile
            profiles.append(profile)

        raw_profiles = data.get("profiles") if isinstance(data, dict) else None
        if isinstance(raw_profiles, list):
            for item in raw_profiles:
                if not isinstance(item, dict):
                    continue
                profile = {
                    "profile_id": str(item.get("profile_id", "")).strip() or str(uuid4()),
                    "internal_name": str(
                        item.get("internal_name", item.get("display_name", item.get("template_name", "")))
                    ).strip(),
                    "spreadsheet_url": normalize_spreadsheet_url(str(item.get("spreadsheet_url", ""))),
                    "sheet_name": str(item.get("sheet_name", "")).strip(),
                    "start_row": str(item.get("start_row", "2")).strip() or "2",
                    "max_rows": str(item.get("max_rows", "40")).strip() or "40",
                    "limit_mode": str(item.get("limit_mode", "cantidad")).strip() or "cantidad",
                    "sheet_tabs": self._settings_sheet_tabs(item, str(item.get("sheet_name", "")).strip()),
                }
                add_profile(profile)
        legacy_url = normalize_spreadsheet_url(str(data.get("spreadsheet_url", ""))) if isinstance(data, dict) else ""
        if legacy_url:
            legacy = {
                "profile_id": str(data.get("profile_id", "")).strip() or str(uuid4()),
                "internal_name": str(
                    data.get("internal_name", data.get("display_name", data.get("template_name", "")))
                ).strip(),
                "spreadsheet_url": legacy_url,
                "sheet_name": str(data.get("sheet_name", "")).strip(),
                "start_row": str(data.get("start_row", "2")).strip() or "2",
                "max_rows": str(data.get("max_rows", "40")).strip() or "40",
                "limit_mode": str(data.get("limit_mode", "cantidad")).strip() or "cantidad",
                "sheet_tabs": self._settings_sheet_tabs(data, str(data.get("sheet_name", "")).strip()),
            }
            add_profile(legacy)
        return profiles[:25]

    def _sheet_profile_key(self, item: dict) -> str:
        return str(item.get("profile_id", "")).strip() or "|".join(
            (
                str(item.get("spreadsheet_url", "")).strip().lower(),
                str(item.get("sheet_name", "")).strip().lower(),
                str(item.get("start_row", "2")).strip() or "2",
                str(item.get("max_rows", "40")).strip() or "40",
                self._sheet_limit_mode_value(item.get("limit_mode", "cantidad")),
            )
        )

    def _sheet_template_signature(self, item: dict) -> tuple[str, str]:
        return (
            normalize_spreadsheet_url(str(item.get("spreadsheet_url", ""))).strip().lower(),
            str(item.get("internal_name", item.get("display_name", ""))).strip().lower(),
        )

    def _sheet_limit_mode_value(self, raw_value: str | None = None) -> str:
        value = raw_value
        if value is None and hasattr(self, "sheet_limit_mode_var"):
            value = self.sheet_limit_mode_var.get()
        normalized = str(value or "cantidad").strip().lower()
        if normalized in {"fila_final", "fila final", "hasta fila", "final"}:
            return "fila_final"
        return "cantidad"

    def _sheet_limit_mode_label(self, raw_value: str | None = None) -> str:
        return "Fila final" if self._sheet_limit_mode_value(raw_value) == "fila_final" else "Cantidad"

    def _sheet_template_name(self, item: dict | None) -> str:
        item = item or {}
        internal_name = str(item.get("internal_name", item.get("display_name", "")) or "").strip()
        if internal_name:
            return internal_name
        sheet_name = str(item.get("sheet_name", "") or "").strip()
        if sheet_name:
            return sheet_name
        url = normalize_spreadsheet_url(str(item.get("spreadsheet_url", "") or ""))
        if url:
            spreadsheet_id = extract_spreadsheet_id(url)
            return f"Plantilla {spreadsheet_id[-6:]}" if spreadsheet_id else "Plantilla configurada"
        return "Sin plantilla"

    def _format_sheet_profile_entry(self, item: dict) -> str:
        internal_name = self._sheet_template_name(item)
        return internal_name

    def _sheet_profile_options(self) -> list[str]:
        self.sheet_profile_lookup = {}
        options: list[str] = []
        for item in self.sheet_profiles:
            display = self._format_sheet_profile_entry(item)
            if display in self.sheet_profile_lookup:
                compact_id = self._sheet_profile_key(item)[-6:]
                display = f"{display} | {compact_id}"
            self.sheet_profile_lookup[display] = item
            options.append(display)
        return options

    def _specialist_sheet_profile_key(self, item: dict) -> str:
        return self._sheet_profile_key(item)

    def _specialist_sheet_profile_options(self) -> list[str]:
        self.specialist_sheet_profile_lookup = {}
        options: list[str] = []
        for item in self.specialist_sheet_profiles:
            display = self._format_sheet_profile_entry(item)
            if display in self.specialist_sheet_profile_lookup:
                compact_id = self._specialist_sheet_profile_key(item)[-6:]
                display = f"{display} | {compact_id}"
            self.specialist_sheet_profile_lookup[display] = item
            options.append(display)
        return options

    def _restore_sheet_profile_selection(self) -> None:
        options = self._sheet_profile_options()
        self.sheet_combo.configure(values=options or [""])
        for display, item in self.sheet_profile_lookup.items():
            if self._sheet_profile_key(item) == self.selected_sheet_profile_id:
                self.sheet_profile_var.set(display)
                return
        if options:
            self._on_sheet_profile_selected(options[0])

    def _on_sheet_profile_selected(self, selected: str) -> None:
        profile = self.sheet_profile_lookup.get(selected)
        if not profile:
            return
        self.selected_sheet_profile_id = self._sheet_profile_key(profile)
        self.sheet_url_var.set(profile.get("spreadsheet_url", ""))
        self.sheet_name_var.set(profile.get("sheet_name", ""))
        self.sheet_start_row_var.set(profile.get("start_row", "2"))
        self.sheet_max_rows_var.set(profile.get("max_rows", "40"))
        self.sheet_limit_mode_var.set(self._sheet_limit_mode_label(profile.get("limit_mode", "cantidad")))
        self._update_sheet_template_displays()
        self._update_active_config()

    def _restore_specialist_sheet_profile_selection(self) -> None:
        options = self._specialist_sheet_profile_options()
        self.specialist_sheet_combo.configure(values=options or [""])
        for display, item in self.specialist_sheet_profile_lookup.items():
            if self._specialist_sheet_profile_key(item) == self.selected_specialist_sheet_profile_id:
                self.specialist_sheet_profile_var.set(display)
                return
        if options:
            self._on_specialist_sheet_profile_selected(options[0])

    def _on_specialist_sheet_profile_selected(self, selected: str) -> None:
        profile = self.specialist_sheet_profile_lookup.get(selected)
        if not profile:
            return
        self.selected_specialist_sheet_profile_id = self._specialist_sheet_profile_key(profile)
        self.specialist_sheet_url_var.set(profile.get("spreadsheet_url", ""))
        self.specialist_sheet_name_var.set(profile.get("sheet_name", ""))
        sheet_name = (self.specialist_sheet_name_var.get() or "").strip()
        self.specialist_sheet_tabs = self._merge_sheet_tabs(profile.get("sheet_tabs", self.specialist_sheet_tabs), sheet_name)
        if hasattr(self, "specialist_sheet_name_entry"):
            self.specialist_sheet_name_entry.configure(values=self.specialist_sheet_tabs or [""])
        self.specialist_sheet_start_row_var.set(profile.get("start_row", "2"))
        self.specialist_sheet_max_rows_var.set(profile.get("max_rows", "40"))
        self._update_sheet_template_displays()
        self._save_specialist_sheet_settings()
        self._update_active_config()

    def _load_activate_sheet_settings(self) -> dict:
        try:
            if self.activar_sheet_settings_file.exists():
                data = json.loads(self.activar_sheet_settings_file.read_text(encoding="utf-8-sig"))
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
        return {}

    def _extract_activate_sheet_profiles(self, data: dict) -> list[dict]:
        profiles: list[dict] = []
        profiles_by_template: dict[tuple[str, str], dict] = {}
        selected_profile_id = str(data.get("selected_profile_id", "")).strip() if isinstance(data, dict) else ""

        def add_profile(profile: dict) -> None:
            if not profile.get("spreadsheet_url"):
                return
            signature = self._activate_sheet_template_signature(profile)
            existing = profiles_by_template.get(signature)
            if existing:
                merged_tabs = self._merge_sheet_tabs(existing.get("sheet_tabs", []), profile.get("sheet_name", ""))
                for tab in profile.get("sheet_tabs", []) or []:
                    merged_tabs = self._merge_sheet_tabs(merged_tabs, tab)
                if selected_profile_id and profile.get("profile_id") == selected_profile_id:
                    existing.update(profile)
                existing["sheet_tabs"] = merged_tabs
                return
            profiles_by_template[signature] = profile
            profiles.append(profile)

        raw_profiles = data.get("profiles") if isinstance(data, dict) else None
        if isinstance(raw_profiles, list):
            for item in raw_profiles:
                if not isinstance(item, dict):
                    continue
                profile = {
                    "profile_id": str(item.get("profile_id", "")).strip() or str(uuid4()),
                    "internal_name": str(
                        item.get("internal_name", item.get("display_name", item.get("template_name", "")))
                    ).strip(),
                    "spreadsheet_url": normalize_spreadsheet_url(str(item.get("spreadsheet_url", ""))),
                    "sheet_name": str(item.get("sheet_name", "")).strip(),
                    "start_row": str(item.get("start_row", "2")).strip() or "2",
                    "max_rows": str(item.get("max_rows", "40")).strip() or "40",
                    "browser_visible": bool(item.get("browser_visible", True)),
                    "sheet_tabs": self._settings_sheet_tabs(item, str(item.get("sheet_name", "")).strip()),
                }
                add_profile(profile)
        legacy_url = normalize_spreadsheet_url(str(data.get("spreadsheet_url", ""))) if isinstance(data, dict) else ""
        if legacy_url:
            legacy = {
                "profile_id": str(data.get("profile_id", "")).strip() or str(uuid4()),
                "internal_name": str(
                    data.get("internal_name", data.get("display_name", data.get("template_name", "")))
                ).strip(),
                "spreadsheet_url": legacy_url,
                "sheet_name": str(data.get("sheet_name", "")).strip(),
                "start_row": str(data.get("start_row", "2")).strip() or "2",
                "max_rows": str(data.get("max_rows", "40")).strip() or "40",
                "browser_visible": bool(data.get("browser_visible", True)),
                "sheet_tabs": self._settings_sheet_tabs(data, str(data.get("sheet_name", "")).strip()),
            }
            add_profile(legacy)
        return profiles[:25]

    def _activate_sheet_profile_key(self, item: dict) -> str:
        return str(item.get("profile_id", "")).strip() or "|".join(
            (
                str(item.get("spreadsheet_url", "")).strip().lower(),
                str(item.get("sheet_name", "")).strip().lower(),
                str(item.get("start_row", "2")).strip() or "2",
                str(item.get("max_rows", "40")).strip() or "40",
            )
        )

    def _activate_sheet_template_signature(self, item: dict) -> tuple[str, str]:
        return (
            normalize_spreadsheet_url(str(item.get("spreadsheet_url", ""))).strip().lower(),
            str(item.get("internal_name", item.get("display_name", ""))).strip().lower(),
        )

    def _format_activate_sheet_profile_entry(self, item: dict) -> str:
        internal_name = self._sheet_template_name(item)
        return internal_name

    def _activate_sheet_profile_options(self) -> list[str]:
        self.activar_sheet_profile_lookup = {}
        options: list[str] = []
        for item in self.activar_sheet_profiles:
            display = self._format_activate_sheet_profile_entry(item)
            if display in self.activar_sheet_profile_lookup:
                compact_id = self._activate_sheet_profile_key(item)[-6:]
                display = f"{display} | {compact_id}"
            self.activar_sheet_profile_lookup[display] = item
            options.append(display)
        return options

    def _restore_activate_sheet_profile_selection(self) -> None:
        options = self._activate_sheet_profile_options()
        self.activar_sheet_combo.configure(values=options or [""])
        current_sheet_name = (self.activar_sheet_name_var.get() or "").strip()
        if current_sheet_name:
            self.activar_sheet_tabs = self._merge_sheet_tabs(self.activar_sheet_tabs, current_sheet_name)
            self.activar_sheet_name_entry.configure(values=self.activar_sheet_tabs)
        for display, item in self.activar_sheet_profile_lookup.items():
            if self._activate_sheet_profile_key(item) == self.selected_activar_sheet_profile_id:
                self.activar_sheet_profile_var.set(display)
                return
        if options:
            self._on_activate_sheet_profile_selected(options[0])

    def _on_activate_sheet_profile_selected(self, selected: str) -> None:
        profile = self.activar_sheet_profile_lookup.get(selected)
        if not profile:
            return
        self.selected_activar_sheet_profile_id = self._activate_sheet_profile_key(profile)
        self.activar_sheet_url_var.set(profile.get("spreadsheet_url", ""))
        self.activar_sheet_name_var.set(profile.get("sheet_name", ""))
        self.activar_sheet_start_row_var.set(profile.get("start_row", "2"))
        self.activar_sheet_max_rows_var.set(profile.get("max_rows", "40"))
        current_sheet_name = (self.activar_sheet_name_var.get() or "").strip()
        self.activar_sheet_tabs = self._merge_sheet_tabs(profile.get("sheet_tabs", self.activar_sheet_tabs), current_sheet_name)
        self.activar_sheet_name_entry.configure(values=self.activar_sheet_tabs or [""])
        self.activar_ver_web_var.set(bool(profile.get("browser_visible", True)))
        self._update_sheet_template_displays()
        self._save_activate_sheet_settings()
        self._update_active_config()

    def _load_saved_profiles(self) -> list[dict]:
        try:
            if not self.profiles_file.exists():
                return []
            data = json.loads(self.profiles_file.read_text(encoding="utf-8"))
            profiles = []
            for item in data.get("usuarios", []):
                if not isinstance(item, dict):
                    continue
                usuario = str(item.get("usuario", "")).strip()
                if usuario:
                    profiles.append(
                        {
                            "usuario": usuario,
                            "nombre": str(item.get("nombre", item.get("cliente", ""))).strip(),
                            "clave": str(item.get("clave", "")).strip(),
                        }
                    )
            return sync_profile_records(profiles)
        except Exception:
            return []

    def _load_activate_profiles(self) -> list[dict]:
        try:
            if not self.activar_profiles_file.exists():
                return []
            data = json.loads(self.activar_profiles_file.read_text(encoding="utf-8"))
            profiles = []
            for item in data.get("usuarios", []):
                if not isinstance(item, dict):
                    continue
                usuario = str(item.get("usuario", "")).strip()
                if usuario:
                    profiles.append(
                        {
                            "usuario": usuario,
                            "nombre": str(item.get("nombre", item.get("cliente", ""))).strip(),
                            "clave": str(item.get("clave", "")).strip(),
                        }
                    )
            return sync_profile_records(profiles)
        except Exception:
            return []

    def _load_specialist_profiles(self) -> list[dict]:
        try:
            if not self.specialist_profiles_file.exists():
                return []
            data = json.loads(self.specialist_profiles_file.read_text(encoding="utf-8"))
            profiles = []
            for item in data.get("usuarios", []):
                if not isinstance(item, dict):
                    continue
                usuario = str(item.get("usuario", "")).strip()
                if usuario:
                    profiles.append(
                        {
                            "usuario": usuario,
                            "nombre": str(item.get("nombre", item.get("cliente", ""))).strip(),
                            "clave": str(item.get("clave", "")).strip(),
                        }
                    )
            return sync_profile_records(profiles)
        except Exception:
            return []

    def _load_transmision_profiles(self) -> list[dict]:
        try:
            if not self.transmision_profiles_file.exists():
                return []
            data = json.loads(self.transmision_profiles_file.read_text(encoding="utf-8"))
            profiles = []
            for item in data.get("usuarios", []):
                if not isinstance(item, dict):
                    continue
                usuario = str(item.get("usuario", "")).strip()
                if not usuario:
                    continue
                profiles.append(
                    {
                        "usuario": usuario,
                        "nombre": str(item.get("nombre", item.get("cliente", ""))).strip(),
                        "clave": str(item.get("clave", "")).strip(),
                        "ultima_boteada": str(item.get("ultima_boteada", item.get("last_bot_at", ""))).strip(),
                        "fecha_desde": str(item.get("fecha_desde", item.get("filtro_fecha_desde", ""))).strip(),
                        "fecha_hasta": str(item.get("fecha_hasta", item.get("filtro_fecha_hasta", ""))).strip(),
                        "validada": str(item.get("validada", item.get("filtro_validada", ""))).strip(),
                        "transmitida": str(item.get("transmitida", item.get("filtro_transmitida", ""))).strip(),
                    }
                )
            return sync_profile_records(profiles)
        except Exception:
            return []

    def _load_liberar_cupo_profiles(self) -> list[dict]:
        try:
            if not self.liberar_cupo_profiles_file.exists():
                return []
            data = json.loads(self.liberar_cupo_profiles_file.read_text(encoding="utf-8"))
            profiles = []
            for item in data.get("usuarios", []):
                if not isinstance(item, dict):
                    continue
                usuario = str(item.get("usuario", "")).strip()
                if not usuario:
                    continue
                profiles.append(
                    {
                        "usuario": usuario,
                        "nombre": str(item.get("nombre", item.get("cliente", ""))).strip(),
                        "clave": str(item.get("clave", "")).strip(),
                    }
                )
            return sync_profile_records(profiles)
        except Exception:
            return []

    def _profile_options(self) -> list[str]:
        return [self._format_profile_entry(item) for item in self.saved_profiles]

    def _activate_profile_options(self) -> list[str]:
        return [self._format_profile_entry(item) for item in self.activar_saved_profiles]

    def _specialist_profile_options(self) -> list[str]:
        return [self._format_profile_entry(item) for item in self.specialist_saved_profiles]

    def _format_profile_entry(self, item: dict) -> str:
        usuario = item.get("usuario", "").strip()
        nombre = item.get("nombre", "").strip()
        return f"{usuario} - {nombre}" if usuario and nombre else usuario

    def _format_transmision_profile_entry(self, item: dict) -> str:
        usuario = item.get("usuario", "").strip()
        nombre = item.get("nombre", "").strip()
        if usuario and nombre:
            return f"{usuario} | {nombre}"
        return usuario

    def _transmision_profile_options(self) -> list[str]:
        self.transmision_profile_lookup = {}
        options = []
        for item in self.transmision_profiles:
            display = self._format_transmision_profile_entry(item)
            self.transmision_profile_lookup[display] = item
            options.append(display)
        return options

    def _liberar_cupo_profile_options(self) -> list[str]:
        self.liberar_cupo_profile_lookup = {}
        options = []
        for item in self.liberar_cupo_profiles:
            display = self._format_transmision_profile_entry(item)
            self.liberar_cupo_profile_lookup[display] = item
            options.append(display)
        return options

    def _restore_transmision_profile_selection(self) -> None:
        options = self._transmision_profile_options()
        self.transmision_profile_combo.configure(values=options or [""])
        if options:
            self.transmision_profile_var.set(options[0])
            self._on_transmision_profile_selected(options[0])

    def _restore_liberar_cupo_profile_selection(self) -> None:
        options = self._liberar_cupo_profile_options()
        self.liberar_cupo_profile_combo.configure(values=options or [""])
        if options:
            self.liberar_cupo_profile_var.set(options[0])
            self._on_liberar_cupo_profile_selected(options[0])

    def _on_transmision_profile_selected(self, selected: str) -> None:
        profile = self.transmision_profile_lookup.get(selected)
        if not profile:
            return
        self.transmision_fecha_desde_var.set(profile.get("fecha_desde", ""))
        self.transmision_fecha_hasta_var.set(profile.get("fecha_hasta", "") or self._today_str())
        self.transmision_validada_var.set(profile.get("validada", ""))
        self.transmision_transmitida_var.set(profile.get("transmitida", ""))
        last_bot = profile.get("ultima_boteada", "") or "sin boteada"
        self.transmision_status_var.set(
            self._panel_text(f"Perfil {profile.get('usuario', '')} | ultima: {last_bot}", 58)
        )

    def _on_liberar_cupo_profile_selected(self, selected: str) -> None:
        profile = self.liberar_cupo_profile_lookup.get(selected)
        if not profile:
            return
            self.liberar_cupo_status_var.set(
                self._panel_text(f"Perfil {profile.get('usuario', '')} listo para detectar.", 58)
            )

    def _current_transmision_profile(self) -> dict:
        selected = (self.transmision_profile_var.get() or "").strip()
        profile = self.transmision_profile_lookup.get(selected)
        if profile:
            return dict(profile)
        return {"usuario": "", "nombre": "", "clave": ""}

    def _current_liberar_cupo_profile(self) -> dict:
        selected = (self.liberar_cupo_profile_var.get() or "").strip()
        profile = self.liberar_cupo_profile_lookup.get(selected)
        if profile:
            return dict(profile)
        return {"usuario": "", "nombre": "", "clave": ""}

    def _current_transmision_filters(self) -> dict:
        return {
            "fecha_desde": self.transmision_fecha_desde_var.get().strip(),
            "fecha_hasta": self.transmision_fecha_hasta_var.get().strip(),
            "validada": self.transmision_validada_var.get().strip(),
            "transmitida": self.transmision_transmitida_var.get().strip(),
        }

    def _run_transmision_open_and_start(self) -> None:
        profile = self._current_transmision_profile()
        usuario = str(profile.get("usuario", "")).strip()
        clave = str(profile.get("clave", ""))
        if not usuario or not clave:
            raise RuntimeError("Elegi un perfil de Transmision con usuario y clave.")
        self.event_queue.put(("transmision_starting", None))
        self._mark_transmision_profile_boted(usuario)
        self.transmision_controller.abrir_pami(
            usuario=usuario,
            clave=clave,
            filtros=None,
            headless=not bool(self.transmision_ver_web_var.get()),
        )
        self.transmision_controller.iniciar_bot(self._current_transmision_filters())
        self.event_queue.put(
            (
                "transmision_bot_started",
                {
                    "visible": bool(self.transmision_ver_web_var.get()),
                    "usuario": usuario,
                },
            )
        )

    def _show_transmision_estado(self) -> None:
        estado = self.transmision_controller.obtener_estado()
        self.event_queue.put(("transmision_estado", estado))

    def _close_transmision_session(self) -> None:
        self.transmision_controller.cerrar_navegador()
        self.event_queue.put(("transmision_bot_stopped", "Transmision cerrada."))

    def _set_transmision_mode(self, mode: str, status_text: str | None = None) -> None:
        mode = (mode or "inactive").strip().lower()
        if mode in {"running", "waiting_reload"}:
            self.transmision_bot_active = True
            self.transmision_badge_var.set("ACTIVA")
            self.transmision_badge_label.configure(fg_color="#1f7a46")
            self.transmision_block.configure(border_width=2, border_color="#1f7a46")
        elif mode == "paused":
            self.transmision_bot_active = True
            self.transmision_badge_var.set("PAUSADA")
            self.transmision_badge_label.configure(fg_color="#bd6b2a")
            self.transmision_block.configure(border_width=2, border_color="#bd6b2a")
        elif mode == "starting":
            self.transmision_bot_active = True
            self.transmision_badge_var.set("INICIANDO")
            self.transmision_badge_label.configure(fg_color="#245b9d")
            self.transmision_block.configure(border_width=2, border_color="#245b9d")
        elif mode == "done":
            self.transmision_bot_active = False
            self.transmision_badge_var.set("FINALIZADA")
            self.transmision_badge_label.configure(fg_color="#66788a")
            self.transmision_block.configure(border_width=1, border_color="#d8e2ec")
        else:
            self.transmision_bot_active = False
            self.transmision_badge_var.set("SIN CORRER")
            self.transmision_badge_label.configure(fg_color="#66788a")
            self.transmision_block.configure(border_width=1, border_color="#d8e2ec")
        if status_text:
            self.transmision_status_var.set(self._panel_text(status_text, 58))
        self._set_controls_enabled(not self.action_running)
        if self.transmision_bot_active:
            self._schedule_transmision_status_poll(1200)
        else:
            self._cancel_transmision_status_poll()

    def _handle_transmision_estado(self, estado: dict, *, automatic: bool = False) -> None:
        status = str((estado or {}).get("status", "-") or "-").strip().upper()
        procesados = (estado or {}).get("procesados", 0)
        errores = (estado or {}).get("errores", 0)
        step = str((estado or {}).get("step", "") or "").strip()
        message = f"Estado: {status} | proc {procesados} | err {errores}"
        if step:
            message += f" | {step}"
        if status in {"RUNNING", "WAITING_RELOAD"}:
            self._set_transmision_mode("running", message)
        elif status == "PAUSED":
            self._set_transmision_mode("paused", message)
        elif status == "DONE":
            self._set_transmision_mode("done", message)
            if automatic:
                self.result_summary_var.set(f"Transmision finalizada | procesados {procesados} | errores {errores}")
            self._notify_transmision_finished(procesados, errores)
        elif status == "ERROR":
            self._set_transmision_mode("paused", message)
        else:
            self.transmision_status_var.set(self._panel_text(message, 58))

    def _notify_transmision_finished(self, procesados: object, errores: object) -> None:
        if self.transmision_done_notified:
            return
        self.transmision_done_notified = True
        try:
            self.bell()
        except Exception:
            pass
        self.after(
            100,
            lambda procesados=procesados, errores=errores: messagebox.showinfo(
                "Transmision finalizada",
                f"La transmision termino.\n\nProcesados: {procesados}\nErrores: {errores}",
            ),
        )

    def _schedule_transmision_status_poll(self, delay_ms: int = 2500) -> None:
        if not self.transmision_bot_active or self.transmision_poll_pending or self.transmision_poll_after_id is not None:
            return
        if time.monotonic() < self.transmision_next_poll_at:
            delay_ms = max(delay_ms, int((self.transmision_next_poll_at - time.monotonic()) * 1000))
        self.transmision_poll_after_id = self.after(delay_ms, self._start_transmision_status_poll)

    def _cancel_transmision_status_poll(self) -> None:
        if self.transmision_poll_after_id is not None:
            try:
                self.after_cancel(self.transmision_poll_after_id)
            except Exception:
                pass
            self.transmision_poll_after_id = None
        self.transmision_poll_pending = False

    def _start_transmision_status_poll(self) -> None:
        self.transmision_poll_after_id = None
        if not self.transmision_bot_active or self.transmision_poll_pending:
            return
        self.transmision_poll_pending = True
        self.transmision_next_poll_at = time.monotonic() + 2.5

        def worker() -> None:
            try:
                estado = self.transmision_controller.obtener_estado()
                self.event_queue.put(("transmision_estado_auto", estado))
            except Exception as exc:
                self.event_queue.put(("transmision_poll_error", str(exc)))

        threading.Thread(target=worker, daemon=True).start()

    def _liberar_cupo_max_pages(self) -> int:
        try:
            value = int(str(self.liberar_cupo_max_pages_var.get()).strip() or "10")
        except ValueError:
            value = 10
        return max(1, min(value, 100))

    def _run_liberar_cupo_detectar(self) -> None:
        self._ensure_liberar_cupo_session()
        rows = self.liberar_cupo_controller.detectar_candidatas(
            self.liberar_cupo_fecha_desde_var.get().strip(),
            self.liberar_cupo_fecha_hasta_var.get().strip(),
            self._liberar_cupo_max_pages(),
        )
        self.event_queue.put(("liberar_cupo_detected", rows))

    def _ensure_liberar_cupo_session(self) -> None:
        profile = self._current_liberar_cupo_profile()
        usuario = str(profile.get("usuario", "")).strip()
        clave = str(profile.get("clave", ""))
        if not usuario or not clave:
            raise RuntimeError("Elegi un perfil de Liberar Cupo con usuario y clave.")
        if not self.liberar_cupo_controller.sesion_activa():
            self.liberar_cupo_controller.abrir_pami(
                usuario=usuario,
                clave=clave,
                headless=not bool(self.liberar_cupo_ver_web_var.get()),
            )

    def _confirm_liberar_cupo_detectadas(self) -> None:
        total = len(self.liberar_cupo_detected_rows)
        if not total:
            messagebox.showwarning("Liberar Cupo", "Primero detecta OMEs no validadas.")
            return
        if not messagebox.askyesno(
            "Liberar Cupo",
            f"Vas a cancelar la aceptacion de {total} OME(s) detectada(s). Continuar?",
        ):
            return
        self._run_action(self._run_liberar_cupo_liberar_detectadas)

    def _export_liberar_cupo_report(self) -> None:
        if not self.liberar_cupo_detected_rows:
            messagebox.showwarning("Liberar Cupo", "Primero detecta OMEs no validadas para exportar.")
            return
        default_name = f"reporte_liberar_cupo_no_validadas_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        destino = filedialog.asksaveasfilename(
            title="Guardar reporte de OMEs no validadas",
            defaultextension=".xlsx",
            initialdir=str(get_output_dir()),
            initialfile=default_name,
            filetypes=[("Excel", "*.xlsx")],
        )
        if not destino:
            return
        try:
            output = exportar_reporte_no_validadas(
                self.liberar_cupo_detected_rows,
                destino,
                {
                    "fecha_desde": self.liberar_cupo_fecha_desde_var.get().strip(),
                    "fecha_hasta": self.liberar_cupo_fecha_hasta_var.get().strip(),
                },
            )
            self.liberar_cupo_status_var.set(self._panel_text(f"Reporte guardado: {output}", 58))
            self.result_summary_var.set(f"Liberar Cupo reporte: {output}")
            messagebox.showinfo("Liberar Cupo", f"Reporte guardado:\n{output}")
        except Exception as exc:
            messagebox.showerror("Liberar Cupo", f"No se pudo guardar el reporte:\n{exc}")

    def _run_liberar_cupo_liberar_detectadas(self) -> None:
        rows = list(self.liberar_cupo_detected_rows)
        if not rows:
            raise RuntimeError("Primero detecta OMEs no validadas.")
        self._ensure_liberar_cupo_session()
        resumen = self.liberar_cupo_controller.liberar_omes(rows)
        self.event_queue.put(("liberar_cupo_released", resumen))

    def _mark_transmision_profile_boted(self, usuario: str) -> None:
        marca = datetime.now().strftime("%d/%m/%Y %H:%M")
        updated = False
        for profile in self.transmision_profiles:
            if profile.get("usuario", "").strip().lower() == usuario.lower():
                profile["ultima_boteada"] = marca
                profile.update(self._current_transmision_filters())
                updated = True
                break
        if not updated:
            return
        self.transmision_profiles_file.write_text(
            json.dumps({"usuarios": self.transmision_profiles[:20]}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        upsert_shared_credentials_from_records(self.transmision_profiles[:20])
        self.transmision_status_var.set(self._panel_text(f"Perfil {usuario} | ultima: {marca}", 58))

    def _pick_filter_date(self, target_var: ctk.StringVar) -> None:
        dialog = DatePickerDialog(self, target_var.get().strip())
        self.wait_window(dialog)
        if dialog.result is not None:
            target_var.set(dialog.result)

    def _today_str(self) -> str:
        return datetime.now().strftime("%d/%m/%Y")

    def _on_profile_selected(self, selected: str) -> None:
        usuario = selected.split(" - ", 1)[0].strip()
        self._select_profile_by_user(usuario)
        self._save_sheet_settings()

    def _on_activate_profile_selected(self, selected: str) -> None:
        usuario = selected.split(" - ", 1)[0].strip()
        self._select_activate_profile_by_user(usuario)
        self._save_activate_sheet_settings()

    def _on_specialist_profile_selected(self, selected: str) -> None:
        usuario = selected.split(" - ", 1)[0].strip()
        self._select_specialist_profile_by_user(usuario)
        self._save_specialist_sheet_settings()

    def _select_profile_by_user(self, usuario: str) -> bool:
        usuario = (usuario or "").strip()
        if not usuario:
            return False
        for profile in self.saved_profiles:
            if profile.get("usuario", "").strip().lower() == usuario.lower():
                self.profile_var.set(self._format_profile_entry(profile))
                self.profile_name_var.set(profile.get("nombre", ""))
                self.profile_user_var.set(profile.get("usuario", ""))
                self.profile_password_var.set(profile.get("clave", ""))
                self._update_active_config()
                return True
        return False

    def _select_activate_profile_by_user(self, usuario: str) -> bool:
        usuario = (usuario or "").strip()
        if not usuario:
            return False
        for profile in self.activar_saved_profiles:
            if profile.get("usuario", "").strip().lower() == usuario.lower():
                self.activar_profile_var.set(self._format_profile_entry(profile))
                self.activar_profile_name_var.set(profile.get("nombre", ""))
                self.activar_profile_user_var.set(profile.get("usuario", ""))
                self.activar_profile_password_var.set(profile.get("clave", ""))
                self._update_active_config()
                return True
        return False

    def _select_specialist_profile_by_user(self, usuario: str) -> bool:
        usuario = (usuario or "").strip()
        if not usuario:
            return False
        for profile in self.specialist_saved_profiles:
            if profile.get("usuario", "").strip().lower() == usuario.lower():
                self.specialist_profile_var.set(self._format_profile_entry(profile))
                self.specialist_profile_name_var.set(profile.get("nombre", ""))
                self.specialist_profile_user_var.set(profile.get("usuario", ""))
                self.specialist_profile_password_var.set(profile.get("clave", ""))
                self._update_active_config()
                return True
        return False

    def _load_initial_profile_into_form(self) -> None:
        preferred = (
            str(self.sheet_settings.get("selected_pami_usuario", "")).strip()
            or str(self.sheet_settings.get("pami_usuario", "")).strip()
        )
        if preferred and self._select_profile_by_user(preferred):
            return
        if self.saved_profiles:
            self._select_profile_by_user(self.saved_profiles[0].get("usuario", ""))

    def _load_initial_activate_profile_into_form(self) -> None:
        preferred = (
            str(self.activar_sheet_settings.get("selected_pami_usuario", "")).strip()
            or str(self.activar_sheet_settings.get("pami_usuario", "")).strip()
        )
        if preferred and self._select_activate_profile_by_user(preferred):
            return
        if self.activar_saved_profiles:
            self._select_activate_profile_by_user(self.activar_saved_profiles[0].get("usuario", ""))

    def _load_initial_specialist_profile_into_form(self) -> None:
        preferred = (
            str(self.specialist_sheet_settings.get("selected_pami_usuario", "")).strip()
            or str(self.specialist_sheet_settings.get("pami_usuario", "")).strip()
        )
        if preferred and self._select_specialist_profile_by_user(preferred):
            return
        if self.specialist_saved_profiles:
            self._select_specialist_profile_by_user(self.specialist_saved_profiles[0].get("usuario", ""))

    def _selected_sheet_template_profile(self, kind: str) -> dict:
        if kind == "especialista":
            selected = (self.specialist_sheet_profile_var.get() or "").strip()
            return dict(self.specialist_sheet_profile_lookup.get(selected) or {})
        if kind == "activar":
            selected = (self.activar_sheet_profile_var.get() or "").strip()
            return dict(self.activar_sheet_profile_lookup.get(selected) or {})
        selected = (self.sheet_profile_var.get() or "").strip()
        return dict(self.sheet_profile_lookup.get(selected) or {})

    def _current_sheet_template_name(self, kind: str) -> str:
        profile = self._selected_sheet_template_profile(kind)
        if profile:
            return self._sheet_template_name(profile)
        if kind == "especialista":
            display = self.specialist_template_display_var.get().strip() if hasattr(self, "specialist_template_display_var") else ""
            if display and display != "Sin plantilla":
                return display
            return self._sheet_template_name(
                {
                    "spreadsheet_url": self.specialist_sheet_url_var.get(),
                    "sheet_name": self.specialist_sheet_name_var.get(),
                }
            )
        if kind == "activar":
            display = self.activar_template_display_var.get().strip() if hasattr(self, "activar_template_display_var") else ""
            if display and display != "Sin plantilla":
                return display
            return self._sheet_template_name(
                {
                    "spreadsheet_url": self.activar_sheet_url_var.get(),
                    "sheet_name": self.activar_sheet_name_var.get(),
                }
            )
        display = self.sheet_template_display_var.get().strip() if hasattr(self, "sheet_template_display_var") else ""
        if display and display != "Sin plantilla":
            return display
        return self._sheet_template_name(
            {
                "spreadsheet_url": self.sheet_url_var.get(),
                "sheet_name": self.sheet_name_var.get(),
            }
        )

    def _update_sheet_template_displays(self) -> None:
        if hasattr(self, "sheet_template_display_var"):
            self.sheet_template_display_var.set(self._current_sheet_template_name("cabecera"))
        if hasattr(self, "specialist_template_display_var"):
            self.specialist_template_display_var.set(self._current_sheet_template_name("especialista"))
        if hasattr(self, "activar_template_display_var"):
            self.activar_template_display_var.set(self._current_sheet_template_name("activar"))

    def _apply_sheet_template_config(self, kind: str, *, internal_name: str, spreadsheet_url: str, sheet_name: str) -> None:
        normalized_url = normalize_spreadsheet_url(spreadsheet_url)
        if not normalized_url:
            raise RuntimeError("Ingresa una URL de Google Sheets.")
        if is_office_file_url(spreadsheet_url):
            raise RuntimeError(OFFICE_FILE_MESSAGE)
        if not sheet_name.strip():
            raise RuntimeError("Ingresa el nombre de la pestaña.")
        visible_name = internal_name.strip() or self._sheet_template_name(
            {"spreadsheet_url": normalized_url, "sheet_name": sheet_name.strip()}
        )

        if kind == "especialista":
            self.specialist_template_display_var.set(visible_name)
            self.specialist_sheet_url_var.set(normalized_url)
            self.specialist_sheet_name_var.set(sheet_name.strip())
            self.specialist_sheet_tabs = self._merge_sheet_tabs(self.specialist_sheet_tabs, sheet_name.strip())
            if hasattr(self, "specialist_sheet_name_entry"):
                self.specialist_sheet_name_entry.configure(values=self.specialist_sheet_tabs or [""])
            target_key = str(self.selected_specialist_sheet_profile_id or "").strip()
            for item in self.specialist_sheet_profiles:
                if self._specialist_sheet_profile_key(item) == target_key:
                    item["internal_name"] = internal_name.strip()
                    item["spreadsheet_url"] = normalized_url
                    item["sheet_name"] = sheet_name.strip()
                    item["sheet_tabs"] = self.specialist_sheet_tabs
                    break
            self._save_specialist_sheet_settings()
            self._restore_specialist_sheet_profile_selection()
        elif kind == "activar":
            self.activar_template_display_var.set(visible_name)
            self.activar_sheet_url_var.set(normalized_url)
            self.activar_sheet_name_var.set(sheet_name.strip())
            self.activar_sheet_tabs = self._merge_sheet_tabs(self.activar_sheet_tabs, sheet_name.strip())
            if hasattr(self, "activar_sheet_name_entry"):
                self.activar_sheet_name_entry.configure(values=self.activar_sheet_tabs)
            target_key = str(self.selected_activar_sheet_profile_id or "").strip()
            for item in self.activar_sheet_profiles:
                if self._activate_sheet_profile_key(item) == target_key:
                    item["internal_name"] = internal_name.strip()
                    item["spreadsheet_url"] = normalized_url
                    item["sheet_name"] = sheet_name.strip()
                    item["sheet_tabs"] = self.activar_sheet_tabs
                    break
            self._save_activate_sheet_settings()
            self._restore_activate_sheet_profile_selection()
        else:
            self.sheet_template_display_var.set(visible_name)
            self.sheet_url_var.set(normalized_url)
            self.sheet_name_var.set(sheet_name.strip())
            target_key = str(self.selected_sheet_profile_id or "").strip()
            for item in self.sheet_profiles:
                if self._sheet_profile_key(item) == target_key:
                    item["internal_name"] = internal_name.strip()
                    item["spreadsheet_url"] = normalized_url
                    item["sheet_name"] = sheet_name.strip()
                    break
            self._save_sheet_settings()
            self._restore_sheet_profile_selection()
        self._update_sheet_template_displays()
        self._update_active_config()

    def _open_sheet_template_dialog(self, kind: str) -> None:
        titles = {
            "cabecera": "Configurar plantilla - Med Cabecera",
            "especialista": "Configurar plantilla - Especialista",
            "activar": "Configurar plantilla - Activar OME",
        }
        if self.action_running:
            messagebox.showwarning("Plantilla", "Espera a que termine la accion actual antes de cambiar la plantilla.")
            return
        profile = self._selected_sheet_template_profile(kind)
        if kind == "especialista":
            current_url = self.specialist_sheet_url_var.get()
            current_sheet = self.specialist_sheet_name_var.get()
            known_tabs = list(getattr(self, "specialist_sheet_tabs", []) or [])
        elif kind == "activar":
            current_url = self.activar_sheet_url_var.get()
            current_sheet = self.activar_sheet_name_var.get()
            known_tabs = list(getattr(self, "activar_sheet_tabs", []) or [])
        else:
            current_url = self.sheet_url_var.get()
            current_sheet = self.sheet_name_var.get()
            known_tabs = [current_sheet] if current_sheet else []

        dialog = ctk.CTkToplevel(self)
        dialog.title(titles.get(kind, "Configurar plantilla"))
        dialog.geometry("720x265")
        dialog.transient(self.winfo_toplevel())
        dialog.grab_set()
        dialog.grid_columnconfigure(1, weight=1)

        name_var = ctk.StringVar(value=str(profile.get("internal_name", "") or self._current_sheet_template_name(kind)).strip())
        url_var = ctk.StringVar(value=normalize_spreadsheet_url(str(profile.get("spreadsheet_url", current_url) or current_url)))
        sheet_var = ctk.StringVar(value=str(profile.get("sheet_name", current_sheet) or current_sheet).strip())

        ctk.CTkLabel(dialog, text="Nombre interno", text_color="#16324f").grid(row=0, column=0, padx=(14, 8), pady=(16, 8), sticky="w")
        name_entry = ctk.CTkEntry(dialog, textvariable=name_var, height=30)
        name_entry.grid(row=0, column=1, padx=(0, 14), pady=(16, 8), sticky="ew")

        ctk.CTkLabel(dialog, text="URL", text_color="#16324f").grid(row=1, column=0, padx=(14, 8), pady=8, sticky="w")
        url_entry = ctk.CTkEntry(dialog, textvariable=url_var, height=30)
        url_entry.grid(row=1, column=1, padx=(0, 14), pady=8, sticky="ew")

        ctk.CTkLabel(dialog, text="Pestaña", text_color="#16324f").grid(row=2, column=0, padx=(14, 8), pady=8, sticky="w")
        tabs = [item for item in known_tabs if str(item or "").strip()]
        if sheet_var.get().strip() and sheet_var.get().strip() not in tabs:
            tabs.insert(0, sheet_var.get().strip())
        sheet_row = ctk.CTkFrame(dialog, fg_color="transparent")
        sheet_row.grid(row=2, column=1, padx=(0, 14), pady=8, sticky="ew")
        sheet_row.grid_columnconfigure(0, weight=1)
        sheet_entry = ctk.CTkComboBox(
            sheet_row,
            values=tabs or [""],
            variable=sheet_var,
            height=30,
            state="normal",
        )
        sheet_entry.grid(row=0, column=0, padx=(0, 8), pady=0, sticky="ew")

        def load_tabs() -> None:
            normalized_url = normalize_spreadsheet_url(url_var.get())
            if not normalized_url:
                messagebox.showwarning("Plantilla", "Ingresa una URL de Google Sheets para cargar pestañas.")
                return
            if is_office_file_url(url_var.get()):
                messagebox.showwarning("Plantilla", OFFICE_FILE_MESSAGE)
                return
            try:
                loaded_tabs = [
                    str(item or "").strip()
                    for item in list_spreadsheet_sheet_names(
                        spreadsheet_url_or_id=normalized_url,
                        credentials_path=get_gmail_credentials_path(),
                        token_path=get_sheets_token_path(),
                        interactive=False,
                    )
                    if str(item or "").strip()
                ]
            except Exception as exc:
                messagebox.showerror("Plantilla", f"No se pudieron cargar las pestañas:\n{exc}")
                return
            sheet_entry.configure(values=loaded_tabs or [""])
            if loaded_tabs:
                current_value = sheet_var.get().strip()
                if current_value not in loaded_tabs:
                    match = next((item for item in loaded_tabs if item.lower() == current_value.lower()), "")
                    sheet_var.set(match or loaded_tabs[0])
            if kind == "especialista":
                self.specialist_sheet_tabs = loaded_tabs
                if hasattr(self, "specialist_sheet_name_entry"):
                    self.specialist_sheet_name_entry.configure(values=loaded_tabs or [""])
            elif kind == "activar":
                self.activar_sheet_tabs = loaded_tabs
                if hasattr(self, "activar_sheet_name_entry"):
                    self.activar_sheet_name_entry.configure(values=loaded_tabs or [""])
            messagebox.showinfo("Plantilla", f"Pestañas cargadas: {len(loaded_tabs)}")

        ctk.CTkButton(
            sheet_row,
            text="Cargar pestañas",
            width=132,
            height=30,
            fg_color="#66788a",
            hover_color="#536577",
            command=load_tabs,
        ).grid(row=0, column=1, padx=0, pady=0, sticky="e")

        hint = ctk.CTkLabel(
            dialog,
            text="El link queda guardado en la app; en el panel solo se muestra este nombre.",
            text_color="#51657a",
            font=ctk.CTkFont(size=11),
        )
        hint.grid(row=3, column=0, columnspan=2, padx=14, pady=(2, 12), sticky="w")

        buttons = ctk.CTkFrame(dialog, fg_color="transparent")
        buttons.grid(row=4, column=0, columnspan=2, padx=14, pady=(0, 14), sticky="e")

        def save() -> None:
            try:
                self._apply_sheet_template_config(
                    kind,
                    internal_name=name_var.get(),
                    spreadsheet_url=url_var.get(),
                    sheet_name=sheet_var.get(),
                )
            except Exception as exc:
                messagebox.showerror("Plantilla", str(exc))
                return
            dialog.destroy()

        ctk.CTkButton(
            buttons,
            text="Cancelar",
            width=92,
            fg_color="#9aafc3",
            hover_color="#7f95aa",
            command=dialog.destroy,
        ).grid(row=0, column=0, padx=(0, 8), sticky="e")
        ctk.CTkButton(buttons, text="Guardar", width=92, command=save).grid(row=0, column=1, sticky="e")
        name_entry.focus_set()

    def _refresh_sources(self) -> None:
        self.sheet_settings = self._load_sheet_settings()
        self.specialist_sheet_settings = self._load_specialist_sheet_settings()
        self.activar_sheet_settings = self._load_activate_sheet_settings()
        self.credencial_settings = self._load_credencial_settings()
        self.sheet_profiles = self._extract_sheet_profiles(self.sheet_settings)
        self.specialist_sheet_profiles = self._extract_sheet_profiles(self.specialist_sheet_settings)
        self.activar_sheet_profiles = self._extract_activate_sheet_profiles(self.activar_sheet_settings)
        self.selected_sheet_profile_id = str(self.sheet_settings.get("selected_profile_id", "")).strip()
        self.selected_specialist_sheet_profile_id = str(self.specialist_sheet_settings.get("selected_profile_id", "")).strip()
        self.selected_activar_sheet_profile_id = str(self.activar_sheet_settings.get("selected_profile_id", "")).strip()
        self.saved_profiles = self._load_saved_profiles()
        self.specialist_saved_profiles = self._load_specialist_profiles()
        self.activar_saved_profiles = self._load_activate_profiles()
        self.transmision_profiles = self._load_transmision_profiles()
        self.liberar_cupo_profiles = self._load_liberar_cupo_profiles()
        self.profile_combo.configure(values=self._profile_options() or [""])
        self.specialist_profile_combo.configure(values=self._specialist_profile_options() or [""])
        self.activar_profile_combo.configure(values=self._activate_profile_options() or [""])
        self._load_credencial_settings_into_form()
        self._restore_sheet_profile_selection()
        self._load_initial_profile_into_form()
        self._restore_specialist_sheet_profile_selection()
        self._load_initial_specialist_profile_into_form()
        self._restore_activate_sheet_profile_selection()
        self._load_initial_activate_profile_into_form()
        self._restore_transmision_profile_selection()
        self._restore_liberar_cupo_profile_selection()
        self._update_active_config()
        self.status_var.set("Datos recargados.")

    def _update_active_config(self) -> None:
        if not hasattr(self, "active_config_var"):
            return
        self._update_sheet_template_displays()
        sheet = (self.sheet_name_var.get() or "").strip() or "sin pestana"
        start = (self.sheet_start_row_var.get() or "").strip() or "2"
        max_rows = (self.sheet_max_rows_var.get() or "").strip() or "40"
        limit_label = "hasta" if self._sheet_limit_mode_value() == "fila_final" else "cant"
        profile = (self.profile_user_var.get() or "").strip() or "sin perfil PAMI"
        url = normalize_spreadsheet_url((self.sheet_url_var.get() or "").strip())
        url_status = "url ok" if url else "sin URL"
        specialist_sheet = (self.specialist_sheet_name_var.get() or "").strip() or "sin pest."
        specialist_profile = (self.specialist_profile_user_var.get() or "").strip() or "sin perfil"
        self.active_config_var.set(
            self._panel_text(
                f"Cab: {sheet} fila {start} {limit_label} {max_rows} {profile} {url_status} | Esp: {specialist_sheet} {specialist_profile}",
                64,
            )
        )

    def _start_sheets_status_check(self) -> None:
        token_path = get_sheets_token_path()
        if not token_path.exists():
            self.sheets_status_var.set("Google Sheets no conectado")
            return

        def worker() -> None:
            try:
                sheet_url = normalize_spreadsheet_url((self.sheet_url_var.get() or "").strip())
                sheet_name = (self.sheet_name_var.get() or "").strip()
                email = check_sheets_connection(
                    credentials_path=get_gmail_credentials_path(),
                    token_path=token_path,
                    spreadsheet_url_or_id=sheet_url,
                    sheet_name=sheet_name,
                    interactive=False,
                )
                self.event_queue.put(("sheets_connected", email or "cuenta Google"))
            except Exception as exc:
                self.event_queue.put(("sheets_status", f"Sheets requiere reconexion o permiso: {exc}"))

        threading.Thread(target=worker, daemon=True).start()

    def _connect_sheets_account(self) -> None:
        token_path = get_sheets_token_path()
        if token_path.exists():
            token_path.unlink()
        sheet_url = normalize_spreadsheet_url((self.sheet_url_var.get() or "").strip())
        sheet_name = (self.sheet_name_var.get() or "").strip()
        email = check_sheets_connection(
            credentials_path=get_gmail_credentials_path(),
            token_path=token_path,
            spreadsheet_url_or_id=sheet_url,
            sheet_name=sheet_name,
            interactive=True,
        )
        self.event_queue.put(("sheets_connected", email or "cuenta Google"))

    def _start_specialist_sheets_status_check(self) -> None:
        token_path = get_sheets_token_path()
        if not token_path.exists():
            self.specialist_sheets_status_var.set("Google Sheets no conectado")
            return

        def worker() -> None:
            try:
                sheet_url = normalize_spreadsheet_url((self.specialist_sheet_url_var.get() or "").strip())
                sheet_name = (self.specialist_sheet_name_var.get() or "").strip()
                email = check_sheets_connection(
                    credentials_path=get_gmail_credentials_path(),
                    token_path=token_path,
                    spreadsheet_url_or_id=sheet_url,
                    sheet_name=sheet_name,
                    interactive=False,
                )
                self.event_queue.put(("specialist_sheets_connected", email or "cuenta Google"))
            except Exception as exc:
                self.event_queue.put(("specialist_sheets_status", f"Sheets requiere reconexion o permiso: {exc}"))

        threading.Thread(target=worker, daemon=True).start()

    def _connect_specialist_sheets_account(self) -> None:
        token_path = get_sheets_token_path()
        if token_path.exists():
            token_path.unlink()
        sheet_url = normalize_spreadsheet_url((self.specialist_sheet_url_var.get() or "").strip())
        sheet_name = (self.specialist_sheet_name_var.get() or "").strip()
        email = check_sheets_connection(
            credentials_path=get_gmail_credentials_path(),
            token_path=token_path,
            spreadsheet_url_or_id=sheet_url,
            sheet_name=sheet_name,
            interactive=True,
        )
        self.event_queue.put(("specialist_sheets_connected", email or "cuenta Google"))

    def _load_specialist_sheet_tabs(self) -> None:
        sheet_url = normalize_spreadsheet_url((self.specialist_sheet_url_var.get() or "").strip())
        if not sheet_url:
            raise RuntimeError("Configura la plantilla de Especialista antes de cargar pestañas.")
        if is_office_file_url(self.specialist_sheet_url_var.get() or ""):
            raise RuntimeError(OFFICE_FILE_MESSAGE)
        tabs = list_spreadsheet_sheet_names(
            spreadsheet_url_or_id=sheet_url,
            credentials_path=get_gmail_credentials_path(),
            token_path=get_sheets_token_path(),
            interactive=False,
        )
        self.event_queue.put(("specialist_tabs_loaded", tabs))

    def _load_credencial_settings(self) -> dict:
        try:
            if not self.credencial_settings_file.exists():
                return {}
            data = json.loads(self.credencial_settings_file.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _default_credencial_sheet_profile_values(self) -> dict:
        return {
            "internal_name": "",
            "spreadsheet_url": "",
            "sheet_name": "",
            "start_row": "2",
            "max_rows": "40",
            "end_row": "",
            "limit_mode": LIMIT_MODE_TOPE,
            "only_with_tramite": False,
        }

    def _build_credencial_sheet_profiles(self) -> dict[str, dict]:
        profiles = {key: self._default_credencial_sheet_profile_values() for key in SHEET_PROFILE_OPTIONS}
        raw_profiles = self.credencial_settings.get("sheet_profiles")
        if isinstance(raw_profiles, dict):
            for key in SHEET_PROFILE_OPTIONS:
                raw_profile = raw_profiles.get(key, {})
                if not isinstance(raw_profile, dict):
                    continue
                profiles[key] = {
                    "internal_name": str(raw_profile.get("internal_name", "")).strip(),
                    "spreadsheet_url": normalize_spreadsheet_url(str(raw_profile.get("spreadsheet_url", "")).strip()),
                    "sheet_name": str(raw_profile.get("sheet_name", "")).strip(),
                    "start_row": str(raw_profile.get("start_row", "2")).strip() or "2",
                    "max_rows": str(raw_profile.get("max_rows", "40")).strip(),
                    "end_row": str(raw_profile.get("end_row", "")).strip(),
                    "limit_mode": str(raw_profile.get("limit_mode", "")).strip(),
                    "only_with_tramite": bool(raw_profile.get("only_with_tramite", False)),
                }
        else:
            profiles[SHEET_PROFILE_DUBE] = {
                "internal_name": str(self.credencial_settings.get("internal_name", "")).strip(),
                "spreadsheet_url": normalize_spreadsheet_url(str(self.credencial_settings.get("spreadsheet_url", "")).strip()),
                "sheet_name": str(self.credencial_settings.get("sheet_name", "")).strip(),
                "start_row": str(self.credencial_settings.get("start_row", "2")).strip() or "2",
                "max_rows": str(self.credencial_settings.get("max_rows", "40")).strip(),
                "end_row": str(self.credencial_settings.get("end_row", "")).strip(),
                "limit_mode": str(self.credencial_settings.get("limit_mode", "")).strip(),
                "only_with_tramite": bool(self.credencial_settings.get("only_with_tramite", False)),
            }
        return profiles

    def _get_credencial_sheet_profile_values(self, profile_key: str) -> dict:
        raw = self.credencial_sheet_profiles.get(profile_key, self._default_credencial_sheet_profile_values())
        values = {
            "internal_name": str(raw.get("internal_name", "")).strip(),
            "spreadsheet_url": normalize_spreadsheet_url(str(raw.get("spreadsheet_url", "")).strip()),
            "sheet_name": str(raw.get("sheet_name", "")).strip(),
            "start_row": str(raw.get("start_row", "2")).strip() or "2",
            "max_rows": str(raw.get("max_rows", "40")).strip(),
            "end_row": str(raw.get("end_row", "")).strip(),
            "limit_mode": str(raw.get("limit_mode", "")).strip(),
            "only_with_tramite": bool(raw.get("only_with_tramite", False)),
        }
        values["limit_mode"] = normalize_limit_mode(values["limit_mode"], has_end_row=bool(values["end_row"]))
        url_key = values["spreadsheet_url"]
        saved_for_url = self.credencial_url_profiles.get(profile_key, {}).get(url_key, {}) if url_key else {}
        if saved_for_url:
            values.update(
                {
                    "sheet_name": str(saved_for_url.get("sheet_name", values["sheet_name"])).strip(),
                    "internal_name": str(saved_for_url.get("internal_name", values["internal_name"])).strip(),
                    "start_row": str(saved_for_url.get("start_row", values["start_row"])).strip() or values["start_row"],
                    "max_rows": str(saved_for_url.get("max_rows", values["max_rows"])).strip(),
                    "end_row": str(saved_for_url.get("end_row", values["end_row"])).strip(),
                    "limit_mode": str(saved_for_url.get("limit_mode", values["limit_mode"])).strip() or values["limit_mode"],
                    "only_with_tramite": bool(saved_for_url.get("only_with_tramite", values["only_with_tramite"])),
                }
            )
        values["limit_mode"] = normalize_limit_mode(values["limit_mode"], has_end_row=bool(values["end_row"]))
        return values

    def _credencial_destination_profile(self, destination: str) -> str:
        destination_value = str(destination or "").strip()
        if destination_value == DESTINO_DRIVE_CIMA and self.credencial_sheet_profile_key in {
            SHEET_PROFILE_DUBE,
            SHEET_PROFILE_PLAN_SALUD_CIMA,
        }:
            return self.credencial_sheet_profile_key
        return DESTINATION_PROFILE_MAP.get(destination_value, SHEET_PROFILE_DUBE)

    def _build_credencial_url_profiles(self) -> dict[str, dict[str, dict]]:
        profiles = {key: {} for key in SHEET_PROFILE_OPTIONS}
        raw_profiles = self.credencial_settings.get("sheet_url_profiles")
        if not isinstance(raw_profiles, dict):
            return profiles
        for profile_key in SHEET_PROFILE_OPTIONS:
            raw_entries = raw_profiles.get(profile_key, {})
            if not isinstance(raw_entries, dict):
                continue
            normalized_entries: dict[str, dict] = {}
            for url_key, raw_entry in raw_entries.items():
                if not isinstance(raw_entry, dict):
                    continue
                normalized_url = normalize_spreadsheet_url(str(url_key or "").strip())
                if not normalized_url:
                    continue
                normalized_entries[normalized_url] = {
                    "spreadsheet_url": normalized_url,
                    "internal_name": str(raw_entry.get("internal_name", "")).strip(),
                    "sheet_name": str(raw_entry.get("sheet_name", "")).strip(),
                    "start_row": str(raw_entry.get("start_row", "2")).strip() or "2",
                    "max_rows": str(raw_entry.get("max_rows", "40")).strip(),
                    "end_row": str(raw_entry.get("end_row", "")).strip(),
                    "limit_mode": str(raw_entry.get("limit_mode", "")).strip(),
                    "only_with_tramite": bool(raw_entry.get("only_with_tramite", False)),
                }
            profiles[profile_key] = normalized_entries
        return profiles

    def _current_credencial_form_values(self) -> dict:
        return {
            "internal_name": (self.credencial_internal_name_var.get() or "").strip() if hasattr(self, "credencial_internal_name_var") else "",
            "spreadsheet_url": normalize_spreadsheet_url((self.credencial_url_var.get() or "").strip()),
            "sheet_name": (self.credencial_sheet_name_var.get() or "").strip(),
            "start_row": (self.credencial_start_row_var.get() or "").strip() or "2",
            "max_rows": (self.credencial_max_rows_var.get() or "").strip(),
            "end_row": (self.credencial_end_row_var.get() or "").strip(),
            "limit_mode": (self.credencial_limit_mode_var.get() or "").strip() or LIMIT_MODE_TOPE,
            "only_with_tramite": bool(self.credencial_only_with_tramite_var.get()) if hasattr(self, "credencial_only_with_tramite_var") else False,
        }

    def _save_credencial_url_specific_values(self, destination: str, values: dict) -> None:
        profile_key = self.credencial_sheet_profile_key or self._credencial_destination_profile(destination)
        normalized_url = normalize_spreadsheet_url(str(values.get("spreadsheet_url", "")).strip())
        if not normalized_url:
            return
        if profile_key not in self.credencial_url_profiles:
            self.credencial_url_profiles[profile_key] = {}
        self.credencial_url_profiles[profile_key][normalized_url] = {
            "spreadsheet_url": normalized_url,
            "internal_name": str(values.get("internal_name", "")).strip(),
            "sheet_name": str(values.get("sheet_name", "")).strip(),
            "start_row": str(values.get("start_row", "2")).strip() or "2",
            "max_rows": str(values.get("max_rows", "40")).strip(),
            "end_row": str(values.get("end_row", "")).strip(),
            "limit_mode": normalize_limit_mode(
                str(values.get("limit_mode", LIMIT_MODE_TOPE)).strip(),
                has_end_row=bool(str(values.get("end_row", "")).strip()),
            ),
            "only_with_tramite": bool(values.get("only_with_tramite", False)),
        }

    def _load_credencial_url_specific_values(self, destination: str, url_value: str) -> bool:
        profile_key = self.credencial_sheet_profile_key or self._credencial_destination_profile(destination)
        normalized_url = normalize_spreadsheet_url(str(url_value or "").strip())
        if not normalized_url:
            return False
        saved = self.credencial_url_profiles.get(profile_key, {}).get(normalized_url)
        if not saved:
            return False
        current_internal_name = self.credencial_internal_name_var.get() if hasattr(self, "credencial_internal_name_var") else ""
        self.credencial_internal_name_var.set(str(saved.get("internal_name", current_internal_name)).strip())
        self.credencial_url_var.set(normalized_url)
        self.credencial_sheet_name_var.set(str(saved.get("sheet_name", "")).strip())
        self.credencial_start_row_var.set(str(saved.get("start_row", "2")).strip() or "2")
        self.credencial_max_rows_var.set(str(saved.get("max_rows", "40")).strip())
        self.credencial_end_row_var.set(str(saved.get("end_row", "")).strip())
        self.credencial_limit_mode_var.set(
            normalize_limit_mode(
                str(saved.get("limit_mode", "")).strip(),
                has_end_row=bool(self.credencial_end_row_var.get().strip()),
            )
        )
        self.credencial_only_with_tramite_var.set(bool(saved.get("only_with_tramite", False)))
        self._apply_credencial_limit_mode()
        return True

    def _credencial_template_name(self, item: dict | None) -> str:
        item = item or {}
        internal_name = str(item.get("internal_name", "") or "").strip()
        if internal_name:
            return internal_name
        sheet_name = str(item.get("sheet_name", "") or "").strip()
        if sheet_name:
            return sheet_name
        url = normalize_spreadsheet_url(str(item.get("spreadsheet_url", "") or ""))
        if url:
            spreadsheet_id = extract_spreadsheet_id(url)
            return f"Planilla {spreadsheet_id[-6:]}" if spreadsheet_id else "Planilla configurada"
        return "Sin hoja"

    def _current_credencial_template_name(self) -> str:
        return self._credencial_template_name(self._current_credencial_form_values())

    def _update_credencial_template_display(self) -> None:
        if hasattr(self, "credencial_template_display_var"):
            self.credencial_template_display_var.set(self._current_credencial_template_name())

    def _apply_credencial_sheet_template_config(self, *, display_name: str, spreadsheet_url: str, sheet_name: str) -> None:
        normalized_url = normalize_spreadsheet_url(spreadsheet_url)
        if not normalized_url:
            raise RuntimeError("Ingresa una URL de Google Sheets.")
        if is_office_file_url(spreadsheet_url):
            raise RuntimeError(OFFICE_FILE_MESSAGE)
        if not sheet_name.strip():
            raise RuntimeError("Ingresa el nombre de la pestaña.")

        self.credencial_internal_name_var.set(display_name.strip())
        self.credencial_url_var.set(normalized_url)
        self.credencial_sheet_name_var.set(sheet_name.strip())
        self.credencial_sheet_tabs = [sheet_name.strip()]
        if hasattr(self, "credencial_sheet_name_combo"):
            self.credencial_sheet_name_combo.configure(values=self.credencial_sheet_tabs or [""])
        self._save_credencial_settings()
        self._update_credencial_template_display()

    def _open_credencial_sheet_template_dialog(self) -> None:
        if self.action_running:
            messagebox.showwarning("Google Sheets", "Espera a que termine la accion actual antes de cambiar la hoja.")
            return

        selected = self._current_credencial_form_values()
        dialog = ctk.CTkToplevel(self)
        dialog.title("Configurar hoja de credenciales")
        dialog.geometry("680x245")
        dialog.transient(self.winfo_toplevel())
        dialog.grab_set()
        dialog.grid_columnconfigure(1, weight=1)

        name_var = ctk.StringVar(value=str(selected.get("internal_name", "") or self._current_credencial_template_name()).strip())
        url_var = ctk.StringVar(value=normalize_spreadsheet_url(str(selected.get("spreadsheet_url", "") or self.credencial_url_var.get())))
        sheet_var = ctk.StringVar(value=str(selected.get("sheet_name", "") or self.credencial_sheet_name_var.get()).strip())

        ctk.CTkLabel(dialog, text="Nombre interno", text_color="#16324f").grid(row=0, column=0, padx=(14, 8), pady=(16, 8), sticky="w")
        name_entry = ctk.CTkEntry(dialog, textvariable=name_var, height=30)
        name_entry.grid(row=0, column=1, padx=(0, 14), pady=(16, 8), sticky="ew")

        ctk.CTkLabel(dialog, text="URL", text_color="#16324f").grid(row=1, column=0, padx=(14, 8), pady=8, sticky="w")
        url_entry = ctk.CTkEntry(dialog, textvariable=url_var, height=30)
        url_entry.grid(row=1, column=1, padx=(0, 14), pady=8, sticky="ew")

        ctk.CTkLabel(dialog, text="Pestaña", text_color="#16324f").grid(row=2, column=0, padx=(14, 8), pady=8, sticky="w")
        sheet_entry = ctk.CTkEntry(dialog, textvariable=sheet_var, height=30)
        sheet_entry.grid(row=2, column=1, padx=(0, 14), pady=8, sticky="ew")

        hint = ctk.CTkLabel(
            dialog,
            text="El link queda guardado en la app; en el panel solo se muestra este nombre.",
            text_color="#51657a",
            font=ctk.CTkFont(size=11),
        )
        hint.grid(row=3, column=0, columnspan=2, padx=14, pady=(2, 12), sticky="w")

        buttons = ctk.CTkFrame(dialog, fg_color="transparent")
        buttons.grid(row=4, column=0, columnspan=2, padx=14, pady=(0, 14), sticky="e")

        def save() -> None:
            try:
                self._apply_credencial_sheet_template_config(
                    display_name=name_var.get(),
                    spreadsheet_url=url_var.get(),
                    sheet_name=sheet_var.get(),
                )
            except Exception as exc:
                messagebox.showerror("Google Sheets", str(exc))
                return
            dialog.destroy()

        ctk.CTkButton(
            buttons,
            text="Cancelar",
            width=92,
            fg_color="#9aafc3",
            hover_color="#7f95aa",
            command=dialog.destroy,
        ).grid(row=0, column=0, padx=(0, 8), sticky="e")
        ctk.CTkButton(buttons, text="Guardar", width=92, command=save).grid(row=0, column=1, sticky="e")
        name_entry.focus_set()

    def _on_credencial_url_focus_out(self, _event=None):
        self._load_credencial_url_specific_values(
            self.credencial_destination_var.get(),
            self.credencial_url_var.get(),
        )

    def _on_credencial_url_enter(self, _event=None):
        self._on_credencial_url_focus_out()
        return "break"

    def _on_credencial_profile_changed(self, selected: str | None = None) -> None:
        new_profile = (selected or self.credencial_sheet_profile_var.get() or SHEET_PROFILE_DUBE).strip()
        if new_profile not in SHEET_PROFILE_OPTIONS:
            new_profile = SHEET_PROFILE_DUBE
        current_values = self._current_credencial_form_values()
        self.credencial_sheet_profiles[self.credencial_sheet_profile_key] = current_values
        self._save_credencial_url_specific_values(self.credencial_destination_var.get(), current_values)
        self.credencial_sheet_profile_key = new_profile
        profile_values = self._get_credencial_sheet_profile_values(new_profile)
        self.credencial_sheet_profile_var.set(new_profile)
        self.credencial_internal_name_var.set(profile_values["internal_name"])
        self.credencial_url_var.set(profile_values["spreadsheet_url"])
        self.credencial_sheet_name_var.set(profile_values["sheet_name"])
        self.credencial_start_row_var.set(profile_values["start_row"])
        self.credencial_max_rows_var.set(profile_values["max_rows"])
        self.credencial_end_row_var.set(profile_values.get("end_row", ""))
        self.credencial_limit_mode_var.set(profile_values.get("limit_mode", LIMIT_MODE_TOPE))
        self.credencial_only_with_tramite_var.set(bool(profile_values.get("only_with_tramite", False)))
        self._apply_credencial_limit_mode()
        target_destination = DESTINO_DRIVE_SCHEFE if new_profile == SHEET_PROFILE_SCHEFE else DESTINO_DRIVE_CIMA
        if (
            not self._syncing_credencial_profile_destination
            and self.credencial_destination_var.get() != target_destination
        ):
            self._syncing_credencial_profile_destination = True
            try:
                self.credencial_destination_var.set(target_destination)
            finally:
                self._syncing_credencial_profile_destination = False
        self._save_credencial_settings()
        self._update_credencial_template_display()

    def _on_credencial_destination_changed(self, _selected: str | None = None) -> None:
        destination = self.credencial_destination_var.get() or DESTINO_LOCAL
        target_profile = DESTINATION_PROFILE_MAP.get(destination)
        if destination == DESTINO_DRIVE_CIMA and self.credencial_sheet_profile_key in {
            SHEET_PROFILE_DUBE,
            SHEET_PROFILE_PLAN_SALUD_CIMA,
        }:
            target_profile = None
        if target_profile and not self._syncing_credencial_profile_destination:
            self._syncing_credencial_profile_destination = True
            try:
                self._on_credencial_profile_changed(target_profile)
            finally:
                self._syncing_credencial_profile_destination = False
            return
        current_values = self._current_credencial_form_values()
        self._save_credencial_url_specific_values(destination, current_values)
        self._load_credencial_settings_into_form()
        self._load_credencial_url_specific_values(destination, self.credencial_url_var.get())
        self._save_credencial_settings()

    def _save_current_credencial_url(self) -> None:
        destination = self.credencial_destination_var.get() or DESTINO_LOCAL
        current_values = self._current_credencial_form_values()
        self._save_credencial_url_specific_values(destination, current_values)
        self._save_credencial_settings()
        self._update_credencial_template_display()
        self.credencial_status_var.set(self._panel_text(f"Configuracion guardada para {destination}.", 58))

    def _load_credencial_settings_into_form(self) -> None:
        if not hasattr(self, "credencial_url_var"):
            return
        self._suspend_credencial_settings_save = True
        try:
            active_profile = str(self.credencial_settings.get("active_sheet_profile", self.credencial_sheet_profile_key or SHEET_PROFILE_DUBE)).strip()
            if active_profile not in SHEET_PROFILE_OPTIONS:
                active_profile = SHEET_PROFILE_DUBE
            self.credencial_sheet_profile_key = active_profile
            self.credencial_sheet_profile_var.set(active_profile)
            destination = str(self.credencial_settings.get("destination_mode", DESTINO_LOCAL))
            if destination not in DESTINO_OPTIONS:
                destination = DESTINO_LOCAL
            self.credencial_destination_var.set(destination)
            profile_values = self._get_credencial_sheet_profile_values(active_profile)
            self.credencial_internal_name_var.set(profile_values["internal_name"])
            self.credencial_url_var.set(profile_values["spreadsheet_url"])
            self.credencial_sheet_name_var.set(profile_values["sheet_name"])
            current_sheet = (self.credencial_sheet_name_var.get() or "").strip()
            self.credencial_sheet_tabs = [current_sheet] if current_sheet else []
            self.credencial_sheet_name_combo.configure(values=self.credencial_sheet_tabs or [""])
            self.credencial_start_row_var.set(profile_values["start_row"])
            self.credencial_max_rows_var.set(profile_values["max_rows"])
            self.credencial_end_row_var.set(profile_values.get("end_row", ""))
            self.credencial_limit_mode_var.set(profile_values.get("limit_mode", LIMIT_MODE_TOPE))
            self.credencial_only_with_tramite_var.set(bool(profile_values.get("only_with_tramite", False)))
            self._apply_credencial_limit_mode()
            self._load_credencial_url_specific_values(destination, self.credencial_url_var.get())
            self._update_credencial_template_display()
        finally:
            self._suspend_credencial_settings_save = False

    def _save_credencial_settings(self) -> None:
        if self._suspend_credencial_settings_save:
            return
        if not hasattr(self, "credencial_url_var"):
            return
        selected_destination = (self.credencial_destination_var.get() or DESTINO_LOCAL).strip()
        if selected_destination not in DESTINO_OPTIONS:
            selected_destination = DESTINO_LOCAL
        current_local_folder = str(self.credencial_settings.get("local_folder", self.credencial_destination_dir)).strip()
        current_values = self._current_credencial_form_values()
        self.credencial_sheet_profiles[self.credencial_sheet_profile_key] = current_values
        self._save_credencial_url_specific_values(selected_destination, current_values)
        payload = {
            "active_sheet_profile": self.credencial_sheet_profile_key,
            "sheet_profiles": self.credencial_sheet_profiles,
            "internal_name": current_values["internal_name"],
            "spreadsheet_url": current_values["spreadsheet_url"],
            "sheet_name": current_values["sheet_name"],
            "start_row": current_values["start_row"],
            "max_rows": current_values["max_rows"],
            "end_row": current_values["end_row"],
            "limit_mode": current_values["limit_mode"],
            "only_with_tramite": bool(current_values.get("only_with_tramite", False)),
            "sheet_url_profiles": self.credencial_url_profiles,
            "destination_mode": selected_destination,
            "local_folder": current_local_folder or str(self.credencial_destination_dir),
        }
        self.credencial_settings = payload
        self.credencial_settings_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _start_credencial_sheets_status_check(self) -> None:
        token_path = get_sheets_token_path()
        if not token_path.exists():
            self.credencial_status_var.set("Sheets no conectado.")
            return
        sheet_url = normalize_spreadsheet_url((self.credencial_url_var.get() or "").strip())
        sheet_name = (self.credencial_sheet_name_var.get() or "").strip()
        if not sheet_url or not sheet_name:
            self.credencial_status_var.set("Credenciales listas.")
            return

        def worker() -> None:
            try:
                email = check_sheets_connection(
                    credentials_path=get_gmail_credentials_path(),
                    token_path=token_path,
                    spreadsheet_url_or_id=sheet_url,
                    sheet_name="",
                    interactive=False,
                )
                tabs = self._credencial_sheet_tabs(sheet_url)
                self.event_queue.put(("credencial_tabs_loaded", tabs))
                if sheet_name and sheet_name not in tabs:
                    self.event_queue.put(
                        (
                            "credencial_status",
                            f"Sheets conectado: {email or 'cuenta Google'}. Elegi una pestana disponible.",
                        )
                    )
                else:
                    self.event_queue.put(("credencial_status", f"Sheets conectado: {email or 'cuenta Google'}"))
            except Exception as exc:
                self.event_queue.put(("credencial_status", f"Sheets requiere reconexion: {exc}"))

        threading.Thread(target=worker, daemon=True).start()

    def _connect_credencial_sheets_account(self) -> None:
        token_path = get_sheets_token_path()
        if token_path.exists():
            token_path.unlink()
        sheet_url = self._credencial_spreadsheet_url()
        email = check_sheets_connection(
            credentials_path=get_gmail_credentials_path(),
            token_path=token_path,
            spreadsheet_url_or_id=sheet_url,
            sheet_name="",
            interactive=True,
        )
        tabs = self._credencial_sheet_tabs(sheet_url)
        self.event_queue.put(("credencial_tabs_loaded", tabs))
        self.event_queue.put(("credencial_status", f"Sheets conectado: {email or 'cuenta Google'}"))

    def _credencial_spreadsheet_url(self) -> str:
        sheet_url = normalize_spreadsheet_url((self.credencial_url_var.get() or "").strip())
        if not sheet_url:
            raise RuntimeError("Ingresa la URL de Google Sheets para credenciales.")
        if is_office_file_url(self.credencial_url_var.get() or ""):
            raise RuntimeError(OFFICE_FILE_MESSAGE)
        self.credencial_url_var.set(sheet_url)
        return sheet_url

    def _credencial_sheet_tabs(self, sheet_url: str) -> list[str]:
        tabs = list_spreadsheet_sheet_names(
            spreadsheet_url_or_id=sheet_url,
            credentials_path=get_gmail_credentials_path(),
            token_path=get_sheets_token_path(),
            interactive=False,
        )
        if not tabs:
            raise RuntimeError("No se encontraron pestanas en el Google Sheet.")
        return tabs

    def _load_credencial_sheet_tabs(self) -> None:
        sheet_url = self._credencial_spreadsheet_url()
        tabs = self._credencial_sheet_tabs(sheet_url)
        self.event_queue.put(("credencial_tabs_loaded", tabs))
        self.event_queue.put(("credencial_status", f"Pestanas cargadas: {len(tabs)}"))

    def _credencial_sheet_start_row(self) -> int:
        try:
            value = int((self.credencial_start_row_var.get() or "2").strip())
        except ValueError as exc:
            raise RuntimeError("La fila inicial de credenciales debe ser un numero entero.") from exc
        if value < 2:
            raise RuntimeError("La fila inicial de credenciales debe ser 2 o mayor.")
        return value

    def _credencial_sheet_max_rows(self) -> int | None:
        raw_value = (self.credencial_max_rows_var.get() or "").strip()
        if not raw_value:
            if (self.credencial_end_row_var.get() or "").strip():
                return None
            return 40
        try:
            value = int(raw_value)
        except ValueError as exc:
            raise RuntimeError("El tope de credenciales debe ser un numero entero.") from exc
        if value < 1:
            raise RuntimeError("El tope de credenciales debe ser 1 o mayor.")
        return value

    def _on_credencial_limit_mode_changed(self, _selected: str | None = None) -> None:
        self._apply_credencial_limit_mode()
        self._save_credencial_settings()

    def _apply_credencial_limit_mode(self) -> None:
        mode = (self.credencial_limit_mode_var.get() or LIMIT_MODE_TOPE).strip()
        if mode not in LIMIT_MODE_OPTIONS:
            mode = LIMIT_MODE_TOPE
            self.credencial_limit_mode_var.set(mode)
        if mode == LIMIT_MODE_TOPE:
            self.credencial_max_rows_entry.configure(state="normal")
            self.credencial_end_row_entry.configure(state="disabled")
            self.credencial_end_row_var.set("")
        else:
            self.credencial_end_row_entry.configure(state="normal")
            self.credencial_max_rows_entry.configure(state="disabled")
            self.credencial_max_rows_var.set("")

    def _credencial_sheet_end_row(self, start_row: int) -> int | None:
        raw_value = (self.credencial_end_row_var.get() or "").strip()
        if not raw_value:
            return None
        try:
            value = int(raw_value)
        except ValueError as exc:
            raise RuntimeError("La fila final de credenciales debe ser un numero entero.") from exc
        if value < start_row:
            raise RuntimeError("La fila final de credenciales debe ser mayor o igual a la fila inicial.")
        return value

    def _repair_credencial_sheet_missing_tramites(self) -> dict[str, object]:
        sheet_url = self._credencial_spreadsheet_url()
        sheet_name = (self.credencial_sheet_name_var.get() or "").strip()
        if not sheet_name:
            raise RuntimeError("Ingresa la pestana de credenciales.")
        start_row = self._credencial_sheet_start_row()
        max_rows = self._credencial_sheet_max_rows()
        end_row = self._credencial_sheet_end_row(start_row)
        result = repair_credencial_sheet_missing_tramites(
            spreadsheet_url_or_id=sheet_url,
            sheet_name=sheet_name,
            start_row=start_row,
            max_rows=max_rows,
            end_row=end_row,
            sheet_profile=self.credencial_sheet_profile_key,
        )
        self.credencial_recovered_tramite_rows = list(result.get("matches", []) or [])
        return result

    def _scan_credencial_sheet_missing_tramites(self, notify: bool = False) -> dict[str, object]:
        result = self._repair_credencial_sheet_missing_tramites()
        updated = int(result.get("updated") or 0)
        reviewed = int(result.get("reviewed") or 0)
        unresolved = int(result.get("unresolved") or 0)
        target_end_row = result.get("target_end_row")
        start_row = self._credencial_sheet_start_row()
        rango = f"filas {start_row} a {target_end_row}" if target_end_row else f"desde fila {start_row}"
        self.event_queue.put(
            (
                "credencial_status",
                f"Barrido tramite: recuperadas {updated} | sin resolver {unresolved}",
            )
        )
        if notify:
            self.event_queue.put(
                (
                    "credencial_scan_done",
                    {
                        "updated": updated,
                        "reviewed": reviewed,
                        "unresolved": unresolved,
                        "range_text": rango,
                    },
                )
            )
        return result

    def _credencial_sheet_request_config(self) -> tuple[str, str, int, int, int | None]:
        sheet_url = self._credencial_spreadsheet_url()
        sheet_name = (self.credencial_sheet_name_var.get() or "").strip()
        if not sheet_name:
            raise RuntimeError("Ingresa la pestana de credenciales.")
        start_row = self._credencial_sheet_start_row()
        return (
            sheet_url,
            sheet_name,
            start_row,
            self._credencial_sheet_max_rows(),
            self._credencial_sheet_end_row(start_row),
        )

    def _credencial_local_destination(self) -> Path:
        local_folder = str(self.credencial_settings.get("local_folder", self.credencial_destination_dir)).strip()
        destino = Path(local_folder or self.credencial_destination_dir)
        destino.mkdir(parents=True, exist_ok=True)
        return destino

    def _build_credencial_sheet_records(self) -> list[dict]:
        sheet_url, sheet_name, start_row, max_rows, end_row = self._credencial_sheet_request_config()
        self._save_credencial_settings()
        if bool(self.credencial_only_with_tramite_var.get()):
            self.event_queue.put(("credencial_status", "Modo activo: se ignoran filas sin N° de tramite."))
        else:
            repaired = self._scan_credencial_sheet_missing_tramites(notify=False)
            recovered_count = int(repaired.get("updated") or 0)
            if recovered_count:
                self.event_queue.put(("credencial_status", f"Se recuperaron {recovered_count} tramite(s) antes de descargar."))
        payload = read_credencial_sheet_rows(
            spreadsheet_url_or_id=sheet_url,
            sheet_name=sheet_name,
            start_row=start_row,
            max_rows=max_rows,
            end_row=end_row,
            sheet_profile=self.credencial_sheet_profile_key,
            only_with_tramite=bool(self.credencial_only_with_tramite_var.get()),
        )
        records = payload.get("records", [])
        self.credencial_missing_benef_rows = payload.get("missing_benef", [])
        self.credencial_missing_tramite_rows = payload.get("missing_tramite", [])
        if not records:
            if self.credencial_missing_benef_rows or self.credencial_missing_tramite_rows:
                partes: list[str] = []
                if self.credencial_missing_benef_rows:
                    partes.append(f"{len(self.credencial_missing_benef_rows)} sin BENEF")
                if self.credencial_missing_tramite_rows:
                    partes.append(f"{len(self.credencial_missing_tramite_rows)} sin tramite")
                raise RuntimeError(f"No hay filas procesables. Omitidas: {', '.join(partes)}.")
            raise RuntimeError(f"No hay filas pendientes de credenciales desde la fila {start_row}.")
        return records

    def _run_credenciales_from_sheets(self) -> None:
        records = self._build_credencial_sheet_records()
        destination_mode = self.credencial_destination_var.get() or DESTINO_LOCAL
        drive_mode = destination_mode in DESTINO_DRIVE_FOLDER_NAMES
        destino = Path(tempfile.mkdtemp(prefix="suite_pami_credenciales_")) if drive_mode else self._credencial_local_destination()
        try:
            self.event_queue.put(
                (
                    "started",
                    {
                        "total": len(records),
                        "action_key": "credenciales",
                        "action_label": "descargar credenciales",
                    },
                )
            )
            resultados = procesar_lote_credenciales(
                records,
                destino,
                progress_callback=lambda current, total, resultado: self.event_queue.put(
                    (
                        "credencial_progress",
                        {
                            "current": current,
                            "total": total,
                            "dni": resultado.get("dni", ""),
                            "estado": resultado.get("estado", ""),
                        },
                    )
                ),
                status_callback=lambda text: self.event_queue.put(
                    (
                        "credencial_status",
                        (
                            "Descarga temporal completa. Actualizando Drive/Sheets..."
                            if drive_mode
                            else "Descarga local completa. Actualizando Drive/Sheets..."
                        )
                        if str(text or "").strip().lower() == "finalizado"
                        else text,
                    )
                ),
                should_cancel=lambda: self.stop_requested,
            )
            drive_uploaded = 0
            drive_error = ""
            try:
                if drive_mode:
                    self.event_queue.put(("credencial_status", "Subiendo credenciales a Drive..."))
                drive_uploaded = self._upload_credenciales_to_drive(resultados, destination_mode)
            except Exception as exc:
                drive_error = str(exc)
                self.event_queue.put(("credencial_status", "Credenciales descargadas. Fallo la subida a Drive."))
            if drive_mode:
                clear_local_pdf_paths_for_drive_results(resultados)
            for source_row, result_row in zip(records, resultados):
                result_row["sheet_row"] = source_row.get("sheet_row")
            skipped_results = self._credencial_skipped_sheet_results()
            sheet_result_rows = [*resultados, *skipped_results]
            self.event_queue.put(("credencial_status", "Anotando resultados e hipervinculos en Sheets..."))
            updated_count = write_credencial_sheet_results(
                spreadsheet_url_or_id=normalize_spreadsheet_url((self.credencial_url_var.get() or "").strip()),
                sheet_name=(self.credencial_sheet_name_var.get() or "").strip(),
                result_rows=sheet_result_rows,
                sheet_profile=self.credencial_sheet_profile_key,
            )
            self._advance_credencial_start_row(sheet_result_rows)
            display_rows = [self._credencial_result_for_table(row) for row in sheet_result_rows]
            self.event_queue.put(
                (
                    "finished",
                    {
                        "rows": display_rows,
                        "updated": updated_count,
                        "action_key": "credenciales",
                        "action_label": "descargar credenciales",
                        "drive_uploaded": drive_uploaded,
                        "drive_error": drive_error,
                        "missing_benef": len(self.credencial_missing_benef_rows),
                        "missing_tramite": len(self.credencial_missing_tramite_rows),
                    },
                )
            )
        finally:
            if drive_mode:
                shutil.rmtree(destino, ignore_errors=True)

    def _upload_credenciales_to_drive(self, resultados: list[dict], destination_mode: str) -> int:
        if destination_mode not in DESTINO_DRIVE_FOLDER_NAMES:
            return 0
        folder_name = DESTINO_DRIVE_FOLDER_NAMES[destination_mode]
        email = get_connected_drive_email(
            credentials_path=get_gmail_credentials_path(),
            token_path=get_drive_token_path(),
            interactive=True,
        )
        if email:
            self.event_queue.put(("credencial_status", f"Drive conectado: {email}"))
        folder_id = resolve_child_folder_id(DRIVE_PARENT_FOLDER_URL, folder_name, interactive=False)
        uploaded_count = 0
        for result in resultados:
            if str(result.get("estado", "")).strip().upper() != "DESCARGADA":
                continue
            local_pdf = str(result.get("archivo_pdf", "")).strip()
            if not local_pdf:
                continue
            uploaded = upload_file_to_drive_folder(
                local_pdf,
                folder_id,
                target_name=Path(local_pdf).name,
                interactive=False,
            )
            result["archivo_drive_url"] = uploaded.get("webViewLink", "")
            result["archivo_drive_id"] = uploaded.get("id", "")
            result["observaciones"] = (
                f"{result.get('observaciones', '')} | Drive: {uploaded.get('webViewLink', '')}".strip(" |")
            )
            uploaded_count += 1
        return uploaded_count

    def _credencial_skipped_sheet_results(self) -> list[dict]:
        skipped = [
            {
                "sheet_row": item.get("sheet_row"),
                "benef": item.get("benef", ""),
                "dni": item.get("dni", ""),
                "nombre": item.get("nombre", ""),
                "estado": "Falta BENEF",
                "archivo_pdf": "",
                "observaciones": str(item.get("observaciones", "")).strip() or "Falta BENEF",
            }
            for item in self.credencial_missing_benef_rows
            if item.get("sheet_row")
        ]
        skipped.extend(
            [
                {
                    "sheet_row": item.get("sheet_row"),
                    "benef": item.get("benef", ""),
                    "dni": item.get("dni", ""),
                    "nombre": item.get("nombre", ""),
                    "estado": "FALTA TRAMITE",
                    "archivo_pdf": "",
                    "observaciones": str(item.get("observaciones", "")).strip() or "Falta Tramite",
                }
                for item in self.credencial_missing_tramite_rows
                if item.get("sheet_row")
            ]
        )
        return skipped

    def _credencial_result_for_table(self, row: dict) -> dict:
        return {
            "sheet_row": row.get("sheet_row", ""),
            "dni": row.get("dni", ""),
            "beneficio": row.get("benef", ""),
            "nombre": row.get("nombre", ""),
            "resultado": row.get("estado", ""),
        }

    def _advance_credencial_start_row(self, rows: list[dict]) -> None:
        processed = [
            int(row.get("sheet_row"))
            for row in rows
            if str(row.get("sheet_row", "")).strip().isdigit()
        ]
        if not processed:
            return
        self.credencial_start_row_var.set(str(max(processed) + 1))
        self._save_credencial_settings()

    def _sheet_start_row(self) -> int:
        try:
            value = int((self.sheet_start_row_var.get() or "2").strip())
        except ValueError as exc:
            raise RuntimeError("La fila inicial debe ser un numero entero.") from exc
        if value < 2:
            raise RuntimeError("La fila inicial debe ser 2 o mayor.")
        return value

    def _sheet_max_rows(self, start_row: int | None = None) -> int:
        try:
            value = int((self.sheet_max_rows_var.get() or "40").strip())
        except ValueError as exc:
            raise RuntimeError("El limite debe ser un numero entero.") from exc
        if self._sheet_limit_mode_value() == "fila_final":
            start_row = start_row if start_row is not None else self._sheet_start_row()
            if value < start_row:
                raise RuntimeError("La fila final debe ser igual o mayor que la fila inicial.")
            return value - start_row + 1
        if value < 1:
            raise RuntimeError("El tope debe ser 1 o mayor.")
        return value

    def _sheet_request_config(self) -> tuple[str, str, int, int]:
        sheet_url = normalize_spreadsheet_url((self.sheet_url_var.get() or "").strip())
        if not sheet_url:
            raise RuntimeError("Ingresa la URL de Google Sheets.")
        if is_office_file_url(self.sheet_url_var.get() or ""):
            raise RuntimeError(OFFICE_FILE_MESSAGE)
        sheet_name = (self.sheet_name_var.get() or "").strip()
        if not sheet_name:
            raise RuntimeError("Ingresa el nombre de la pestana.")
        self.sheet_url_var.set(sheet_url)
        start_row = self._sheet_start_row()
        return sheet_url, sheet_name, start_row, self._sheet_max_rows(start_row)

    def _specialist_sheet_start_row(self) -> int:
        try:
            value = int((self.specialist_sheet_start_row_var.get() or "2").strip())
        except ValueError as exc:
            raise RuntimeError("La fila inicial de especialista debe ser un numero entero.") from exc
        if value < 2:
            raise RuntimeError("La fila inicial de especialista debe ser 2 o mayor.")
        return value

    def _specialist_sheet_max_rows(self) -> int:
        try:
            value = int((self.specialist_sheet_max_rows_var.get() or "40").strip())
        except ValueError as exc:
            raise RuntimeError("El tope de especialista debe ser un numero entero.") from exc
        if value < 1:
            raise RuntimeError("El tope de especialista debe ser 1 o mayor.")
        return value

    def _specialist_sheet_request_config(self) -> tuple[str, str, int, int]:
        sheet_url = normalize_spreadsheet_url((self.specialist_sheet_url_var.get() or "").strip())
        if not sheet_url:
            raise RuntimeError("Ingresa la URL de Google Sheets para especialista.")
        if is_office_file_url(self.specialist_sheet_url_var.get() or ""):
            raise RuntimeError(OFFICE_FILE_MESSAGE)
        sheet_name = (self.specialist_sheet_name_var.get() or "").strip()
        if not sheet_name:
            raise RuntimeError("Ingresa el nombre de la pestana de especialista.")
        self.specialist_sheet_url_var.set(sheet_url)
        return sheet_url, sheet_name, self._specialist_sheet_start_row(), self._specialist_sheet_max_rows()

    def _build_complete_benef_records(self) -> list[dict]:
        sheet_url, sheet_name, start_row, max_rows = self._sheet_request_config()
        records = read_ome_sheet_rows(
            spreadsheet_url_or_id=sheet_url,
            sheet_name=sheet_name,
            fallback_diagnostico=DEFAULT_DIAGNOSTICO,
            default_practica=DEFAULT_PRACTICA,
            start_row=start_row,
            max_rows=max_rows,
            complete_benef_only=True,
        )
        prepared = []
        for row in records:
            if not (row.get("dni") or "").strip():
                continue
            prepared.append(
                {
                    "sheet_row": row.get("sheet_row"),
                    "modo": "DNI",
                    "afiliado": (row.get("dni") or "").strip(),
                    "beneficio": (row.get("beneficio") or "").strip(),
                    "dni": (row.get("dni") or "").strip(),
                    "nombre": (row.get("nombre") or "").strip(),
                    "diagnostico": DEFAULT_DIAGNOSTICO,
                    "practica": DEFAULT_PRACTICA,
                    "completar_benef": "1",
                }
            )
        if not prepared:
            raise RuntimeError(f"No hay filas con DNI para completar/verificar BENEF desde la fila {start_row}.")
        return prepared

    def _build_specialist_complete_benef_records(self) -> list[dict]:
        sheet_url, sheet_name, start_row, max_rows = self._specialist_sheet_request_config()
        records = read_ome_sheet_rows(
            spreadsheet_url_or_id=sheet_url,
            sheet_name=sheet_name,
            fallback_diagnostico=DEFAULT_DIAGNOSTICO,
            default_practica="",
            start_row=start_row,
            max_rows=max_rows,
            complete_benef_only=True,
        )
        prepared = []
        for row in records:
            if not (row.get("dni") or "").strip():
                continue
            prepared.append(
                {
                    "sheet_row": row.get("sheet_row"),
                    "modo": "DNI",
                    "afiliado": (row.get("dni") or "").strip(),
                    "beneficio": (row.get("beneficio") or "").strip(),
                    "dni": (row.get("dni") or "").strip(),
                    "nombre": (row.get("nombre") or "").strip(),
                    "diagnostico": DEFAULT_DIAGNOSTICO,
                    "practica": "",
                    "completar_benef": "1",
                }
            )
        if not prepared:
            raise RuntimeError(f"No hay filas de especialista con DNI para completar/verificar BENEF desde la fila {start_row}.")
        return prepared

    def _build_specialist_complete_dni_records(self) -> list[dict]:
        sheet_url, sheet_name, start_row, max_rows = self._specialist_sheet_request_config()
        records = read_ome_sheet_rows(
            spreadsheet_url_or_id=sheet_url,
            sheet_name=sheet_name,
            fallback_diagnostico=DEFAULT_DIAGNOSTICO,
            default_practica="",
            start_row=start_row,
            max_rows=max_rows,
            complete_dni_only=True,
        )
        prepared = []
        for row in records:
            beneficio = (row.get("beneficio") or row.get("afiliado") or "").strip()
            if not beneficio:
                continue
            prepared.append(
                {
                    "sheet_row": row.get("sheet_row"),
                    "modo": "BENEF",
                    "afiliado": beneficio,
                    "beneficio": beneficio,
                    "dni": "",
                    "nombre": (row.get("nombre") or "").strip(),
                    "diagnostico": DEFAULT_DIAGNOSTICO,
                    "practica": DEFAULT_PRACTICA,
                    "completar_benef": "",
                    "completar_dni": "1",
                }
            )
        if not prepared:
            raise RuntimeError(f"No hay filas de especialista con BENEF y DNI faltante desde la fila {start_row}.")
        return prepared

    def _build_generate_ome_records(self) -> list[dict]:
        sheet_url, sheet_name, start_row, max_rows = self._sheet_request_config()
        records = read_ome_sheet_rows(
            spreadsheet_url_or_id=sheet_url,
            sheet_name=sheet_name,
            fallback_diagnostico=DEFAULT_DIAGNOSTICO,
            default_practica=DEFAULT_PRACTICA,
            start_row=start_row,
            max_rows=max_rows,
            complete_benef_only=False,
        )
        prepared = []
        unresolved = []
        for row in records:
            modo = (row.get("modo") or ("BENEF" if row.get("beneficio") else "DNI")).strip().upper()
            afiliado = (row.get("afiliado") or row.get("beneficio") or row.get("dni") or "").strip()
            if not afiliado:
                continue
            raw_practice = (row.get("practica_origen") or row.get("practica") or "").strip()
            practice_code = resolve_plan_salud_practice(raw_practice) if raw_practice else DEFAULT_PRACTICA
            if not practice_code:
                unresolved.append(
                    f"fila {row.get('sheet_row')}: {raw_practice or 'sin practica'} "
                    f"({explain_unresolved_plan_salud_practice(raw_practice)})"
                )
                continue
            prepared.append(
                {
                    "sheet_row": row.get("sheet_row"),
                    "modo": modo,
                    "afiliado": afiliado,
                    "beneficio": (row.get("beneficio") or "").strip(),
                    "dni": (row.get("dni") or "").strip(),
                    "nombre": (row.get("nombre") or "").strip(),
                    "diagnostico": (row.get("diagnostico") or DEFAULT_DIAGNOSTICO).strip(),
                    "practica": practice_code,
                    "completar_benef": "",
                }
            )
        if unresolved:
            sample = "; ".join(unresolved[:5])
            extra = "" if len(unresolved) <= 5 else f" y {len(unresolved) - 5} mas"
            raise RuntimeError(f"Hay practicas sin codigo seguro: {sample}{extra}.")
        if not prepared:
            raise RuntimeError(f"No hay filas pendientes para generar OME desde la fila {start_row}.")
        return prepared

    def _build_specialist_generate_ome_records(self) -> list[dict]:
        sheet_url, sheet_name, start_row, max_rows = self._specialist_sheet_request_config()
        records = read_ome_sheet_rows(
            spreadsheet_url_or_id=sheet_url,
            sheet_name=sheet_name,
            fallback_diagnostico=DEFAULT_DIAGNOSTICO,
            default_practica="",
            start_row=start_row,
            max_rows=max_rows,
            complete_benef_only=False,
        )
        prepared = []
        unresolved = []
        skipped = []
        for row in records:
            modo = (row.get("modo") or ("BENEF" if row.get("beneficio") else "DNI")).strip().upper()
            afiliado = (row.get("afiliado") or row.get("beneficio") or row.get("dni") or "").strip()
            if not afiliado:
                continue
            raw_practice = (row.get("practica_origen") or row.get("practica") or "").strip()
            practice_codes = resolve_plan_salud_practices(raw_practice) if raw_practice else []
            if not practice_codes:
                single = resolve_plan_salud_practice(raw_practice) if raw_practice else ""
                practice_codes = [single] if single else []
            if not practice_codes:
                if is_skippable_plan_salud_practice(raw_practice):
                    skipped.append(f"fila {row.get('sheet_row')}: {raw_practice or 'sin practica'}")
                    continue
                unresolved.append(
                    f"fila {row.get('sheet_row')}: {raw_practice or 'sin practica'} "
                    f"({explain_unresolved_plan_salud_practice(raw_practice)})"
                )
                continue
            diagnostico = (row.get("diagnostico") or DEFAULT_DIAGNOSTICO).strip() or DEFAULT_DIAGNOSTICO
            for practice_code in practice_codes:
                prepared.append(
                    {
                        "sheet_row": row.get("sheet_row"),
                        "modo": modo,
                        "afiliado": afiliado,
                        "beneficio": (row.get("beneficio") or "").strip(),
                        "dni": (row.get("dni") or "").strip(),
                        "nombre": (row.get("nombre") or "").strip(),
                        "diagnostico": diagnostico,
                        "practica": practice_code,
                        "completar_benef": "",
                    }
                )
        if unresolved:
            sample = "; ".join(unresolved[:5])
            extra = "" if len(unresolved) <= 5 else f" y {len(unresolved) - 5} mas"
            raise RuntimeError(f"Hay practicas de especialista sin codigo seguro: {sample}{extra}.")
        if skipped:
            sample = "; ".join(skipped[:5])
            extra = "" if len(skipped) <= 5 else f" y {len(skipped) - 5} mas"
            self.event_queue.put(("status", f"Especialista: se omitieron radiografias sin codigo: {sample}{extra}."))
        if not prepared:
            raise RuntimeError(f"No hay filas pendientes de especialista para generar OME desde la fila {start_row}.")
        return prepared

    def _run_complete_benef_from_sheets(self) -> None:
        self._run_sheet_batch(
            records=self._build_complete_benef_records(),
            output_name="panel_rapido_completar_benef_resultados.csv",
            input_name="panel_rapido_completar_benef_input.csv",
            action_key="complete_benef",
            action_label="completar/verificar BENEF",
        )

    def _run_generate_ome_from_sheets(self) -> None:
        self._run_sheet_batch(
            records=self._build_generate_ome_records(),
            output_name="panel_rapido_generar_ome_resultados.csv",
            input_name="panel_rapido_generar_ome_input.csv",
            action_key="generate_ome",
            action_label="generar OME",
        )

    def _run_specialist_complete_benef_from_sheets(self) -> None:
        self._run_specialist_sheet_batch(
            records=self._build_specialist_complete_benef_records(),
            output_name="panel_rapido_especialista_completar_benef_resultados.csv",
            input_name="panel_rapido_especialista_completar_benef_input.csv",
            action_key="specialist_complete_benef",
            action_label="completar/verificar BENEF especialista",
        )

    def _run_specialist_complete_dni_from_sheets(self) -> None:
        self._run_specialist_sheet_batch(
            records=self._build_specialist_complete_dni_records(),
            output_name="panel_rapido_especialista_completar_dni_resultados.csv",
            input_name="panel_rapido_especialista_completar_dni_input.csv",
            action_key="specialist_complete_dni",
            action_label="completar/verificar DNI especialista",
        )

    def _run_specialist_generate_ome_from_sheets(self) -> None:
        self._run_specialist_sheet_batch(
            records=self._build_specialist_generate_ome_records(),
            output_name="panel_rapido_especialista_ome_resultados.csv",
            input_name="panel_rapido_especialista_ome_input.csv",
            action_key="specialist_generate_ome",
            action_label="generar OME especialista",
        )

    def _run_sheet_batch(
        self,
        *,
        records: list[dict],
        output_name: str,
        input_name: str,
        action_key: str,
        action_label: str,
    ) -> None:
        profile = {
            "usuario": (self.profile_user_var.get() or "").strip(),
            "clave": self.profile_password_var.get() or "",
        }
        if not profile["usuario"] or not profile["clave"]:
            raise RuntimeError("Elegi un perfil PAMI con usuario y clave antes de ejecutar.")

        self._save_sheet_settings()
        output_path = self._reserve_temp_output_path(get_output_dir() / output_name)
        input_path = get_output_dir() / input_name
        self.event_queue.put(
            (
                "started",
                {
                    "output_path": str(output_path),
                    "total": len(records),
                    "action_key": action_key,
                    "action_label": action_label,
                },
            )
        )
        with input_path.open("w", encoding="utf-8", newline="") as handle:
            input_fieldnames = [
                "modo",
                "afiliado",
                "beneficio",
                "dni",
                "nombre",
                "diagnostico",
                "practica",
                "completar_benef",
                "completar_dni",
            ]
            writer = csv.DictWriter(
                handle,
                fieldnames=input_fieldnames,
            )
            writer.writeheader()
            for record in records:
                writer.writerow({field: record.get(field, "") for field in input_fieldnames})

        run_batch_sync(
            input_path=input_path,
            output_path=output_path,
            user=profile["usuario"],
            password=profile["clave"],
            headless=not bool(self.ver_web_var.get()),
            log_callback=lambda message: self.event_queue.put(("log", message)),
            progress_callback=lambda payload: self.event_queue.put(("progress", payload)),
            stop_requested=lambda: self.stop_requested,
        )
        result_rows = self._read_results_csv(output_path)
        enriched_rows = []
        for source_row, result_row in zip(records, result_rows):
            merged = dict(result_row)
            merged["sheet_row"] = source_row.get("sheet_row")
            for field in ("modo", "afiliado", "beneficio", "dni", "nombre", "diagnostico", "practica"):
                if not str(merged.get(field, "") or "").strip():
                    merged[field] = source_row.get(field, "")
            enriched_rows.append(merged)
        sheet_rows = (
            [row for row in enriched_rows if row.get("resultado") == "BENEF_COMPLETADO"]
            if action_key == "complete_benef"
            else enriched_rows
        )
        updated_count = 0
        sheet_write_error = ""
        try:
            updated_count = write_ome_sheet_results(
                spreadsheet_url_or_id=normalize_spreadsheet_url((self.sheet_url_var.get() or "").strip()),
                sheet_name=(self.sheet_name_var.get() or "").strip(),
                result_rows=sheet_rows,
            )
        except Exception as exc:
            sheet_write_error = str(exc)
            self.event_queue.put(
                (
                    "log",
                    "El proceso termino, pero Google Sheets rechazo la escritura de resultados. "
                    f"Detalle: {sheet_write_error}",
                )
            )
        if not sheet_write_error and action_key != "complete_benef":
            self._advance_sheet_start_row(enriched_rows)
        elif not sheet_write_error and action_key == "complete_benef":
            self.event_queue.put(("log", "BENEF completado; se mantiene la fila inicial para generar OMEs despues."))
        self.event_queue.put(
            (
                "finished",
                {
                    "rows": enriched_rows,
                    "updated": updated_count,
                    "output_path": str(output_path),
                    "action_key": action_key,
                    "action_label": action_label,
                    "sheet_error": sheet_write_error,
                },
            )
        )

    def _run_specialist_sheet_batch(
        self,
        *,
        records: list[dict],
        output_name: str,
        input_name: str,
        action_key: str,
        action_label: str,
    ) -> None:
        profile = {
            "usuario": (self.specialist_profile_user_var.get() or "").strip(),
            "clave": self.specialist_profile_password_var.get() or "",
        }
        if not profile["usuario"] or not profile["clave"]:
            raise RuntimeError("Elegi un perfil PAMI especialista con usuario y clave antes de ejecutar.")

        self._save_specialist_sheet_settings()
        output_path = self._reserve_temp_output_path(get_output_dir() / output_name)
        input_path = get_output_dir() / input_name
        self.event_queue.put(
            (
                "started",
                {
                    "output_path": str(output_path),
                    "total": len(records),
                    "action_key": action_key,
                    "action_label": action_label,
                },
            )
        )
        with input_path.open("w", encoding="utf-8", newline="") as handle:
            input_fieldnames = [
                "modo",
                "afiliado",
                "beneficio",
                "dni",
                "nombre",
                "diagnostico",
                "practica",
                "completar_benef",
                "completar_dni",
            ]
            writer = csv.DictWriter(handle, fieldnames=input_fieldnames)
            writer.writeheader()
            for record in records:
                writer.writerow({field: record.get(field, "") for field in input_fieldnames})

        run_batch_sync(
            input_path=input_path,
            output_path=output_path,
            user=profile["usuario"],
            password=profile["clave"],
            headless=not bool(self.specialist_ver_web_var.get()),
            log_callback=lambda message: self.event_queue.put(("log", message)),
            progress_callback=lambda payload: self.event_queue.put(("progress", payload)),
            stop_requested=lambda: self.stop_requested,
        )
        result_rows = self._read_results_csv(output_path)
        enriched_rows = []
        for source_row, result_row in zip(records, result_rows):
            merged = dict(result_row)
            merged["sheet_row"] = source_row.get("sheet_row")
            for field in ("modo", "afiliado", "beneficio", "dni", "nombre", "diagnostico", "practica"):
                if not str(merged.get(field, "") or "").strip():
                    merged[field] = source_row.get(field, "")
            enriched_rows.append(merged)
        sheet_rows = (
            [row for row in enriched_rows if row.get("resultado") == "BENEF_COMPLETADO"]
            if action_key == "specialist_complete_benef"
            else [row for row in enriched_rows if row.get("resultado") == "DNI_COMPLETADO"]
            if action_key == "specialist_complete_dni"
            else enriched_rows
        )

        updated_count = 0
        sheet_write_error = ""
        try:
            updated_count = write_ome_sheet_results(
                spreadsheet_url_or_id=normalize_spreadsheet_url((self.specialist_sheet_url_var.get() or "").strip()),
                sheet_name=(self.specialist_sheet_name_var.get() or "").strip(),
                result_rows=sheet_rows,
            )
        except Exception as exc:
            sheet_write_error = str(exc)
            self.event_queue.put(
                (
                    "log",
                    "El proceso especialista termino, pero Google Sheets rechazo la escritura de resultados. "
                    f"Detalle: {sheet_write_error}",
                )
            )
        if not sheet_write_error and action_key not in {"specialist_complete_benef", "specialist_complete_dni"}:
            self._advance_specialist_sheet_start_row(enriched_rows)
        elif not sheet_write_error and action_key == "specialist_complete_benef":
            self.event_queue.put(("log", "Especialista: BENEF completado; se mantiene la fila inicial para generar OMEs despues."))
        elif not sheet_write_error and action_key == "specialist_complete_dni":
            self.event_queue.put(("log", "Especialista: DNI completado; se mantiene la fila inicial para generar OMEs despues."))
        self.event_queue.put(
            (
                "finished",
                {
                    "rows": enriched_rows,
                    "updated": updated_count,
                    "output_path": str(output_path),
                    "action_key": action_key,
                    "action_label": action_label,
                    "sheet_error": sheet_write_error,
                },
            )
        )

    def _read_results_csv(self, path: Path) -> list[dict]:
        if not path.exists():
            return []
        rows = []
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                rows.append({key: (value or "").strip() for key, value in row.items()})
        return rows

    def _advance_sheet_start_row(self, rows: list[dict]) -> None:
        processed = [
            int(row.get("sheet_row"))
            for row in rows
            if str(row.get("sheet_row", "")).strip().isdigit()
        ]
        if not processed:
            return
        next_row = str(max(processed) + 1)
        self.sheet_start_row_var.set(next_row)
        if self._sheet_limit_mode_value() == "fila_final":
            try:
                if int(next_row) > int((self.sheet_max_rows_var.get() or "0").strip()):
                    self.sheet_limit_mode_var.set("Cantidad")
                    self.sheet_max_rows_var.set("40")
            except ValueError:
                pass
        target_key = str(self.selected_sheet_profile_id or "").strip()
        for item in self.sheet_profiles:
            if self._sheet_profile_key(item) == target_key:
                item["start_row"] = next_row
                item["limit_mode"] = self._sheet_limit_mode_value()
                item["max_rows"] = (self.sheet_max_rows_var.get() or "").strip() or "40"
        self._save_sheet_settings()
        self._restore_sheet_profile_selection()

    def _advance_specialist_sheet_start_row(self, rows: list[dict]) -> None:
        processed = [
            int(row.get("sheet_row"))
            for row in rows
            if str(row.get("sheet_row", "")).strip().isdigit()
        ]
        if not processed:
            return
        next_row = str(max(processed) + 1)
        self.specialist_sheet_start_row_var.set(next_row)
        target_key = str(self.selected_specialist_sheet_profile_id or "").strip()
        for item in self.specialist_sheet_profiles:
            if self._specialist_sheet_profile_key(item) == target_key:
                item["start_row"] = next_row
        self._save_specialist_sheet_settings()
        self._restore_specialist_sheet_profile_selection()

    def _save_sheet_settings(self) -> None:
        target_key = str(self.selected_sheet_profile_id or "").strip()
        current_profile_id = target_key if target_key and "|" not in target_key else str(uuid4())
        current_profile = {
            "profile_id": current_profile_id,
            "internal_name": self._current_sheet_template_name("cabecera"),
            "spreadsheet_url": normalize_spreadsheet_url((self.sheet_url_var.get() or "").strip()),
            "sheet_name": (self.sheet_name_var.get() or "").strip(),
            "start_row": (self.sheet_start_row_var.get() or "").strip() or "2",
            "max_rows": (self.sheet_max_rows_var.get() or "").strip() or "40",
            "limit_mode": self._sheet_limit_mode_value(),
        }
        if current_profile["spreadsheet_url"]:
            updated_profile = False
            for item in self.sheet_profiles:
                if self._sheet_profile_key(item) == target_key:
                    item.update(current_profile)
                    updated_profile = True
                    break
            if not updated_profile:
                self.sheet_profiles.insert(0, current_profile)
            self.selected_sheet_profile_id = current_profile_id
            self.sheet_profiles = [
                current_profile,
                *[
                    item
                    for item in self.sheet_profiles
                    if self._sheet_profile_key(item) != current_profile_id
                ],
            ]
            self.sheet_profiles = self._extract_sheet_profiles({"profiles": self.sheet_profiles})

        payload = {
            "profile_id": str(self.selected_sheet_profile_id or "").strip(),
            "internal_name": current_profile["internal_name"],
            "spreadsheet_url": current_profile["spreadsheet_url"],
            "sheet_name": current_profile["sheet_name"],
            "start_row": current_profile["start_row"],
            "max_rows": current_profile["max_rows"],
            "limit_mode": current_profile["limit_mode"],
            "selected_pami_usuario": (self.profile_user_var.get() or "").strip(),
            "selected_pami_nombre": (self.profile_name_var.get() or "").strip(),
            "pami_usuario": (self.profile_user_var.get() or "").strip(),
            "pami_nombre": (self.profile_name_var.get() or "").strip(),
            "selected_profile_id": str(self.selected_sheet_profile_id or "").strip(),
            "profiles": self.sheet_profiles,
        }
        self.sheet_settings_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _save_specialist_sheet_settings(self) -> None:
        target_key = str(self.selected_specialist_sheet_profile_id or "").strip()
        current_profile_id = target_key if target_key and "|" not in target_key else str(uuid4())
        current_sheet_tabs = self._merge_sheet_tabs(
            self.specialist_sheet_tabs,
            (self.specialist_sheet_name_var.get() or "").strip(),
        )
        self.specialist_sheet_tabs = current_sheet_tabs
        current_profile = {
            "profile_id": current_profile_id,
            "internal_name": self._current_sheet_template_name("especialista"),
            "spreadsheet_url": normalize_spreadsheet_url((self.specialist_sheet_url_var.get() or "").strip()),
            "sheet_name": (self.specialist_sheet_name_var.get() or "").strip(),
            "start_row": (self.specialist_sheet_start_row_var.get() or "").strip() or "2",
            "max_rows": (self.specialist_sheet_max_rows_var.get() or "").strip() or "40",
            "browser_visible": bool(self.specialist_ver_web_var.get()),
            "sheet_tabs": current_sheet_tabs,
        }
        if current_profile["spreadsheet_url"]:
            updated_profile = False
            for item in self.specialist_sheet_profiles:
                if self._specialist_sheet_profile_key(item) == target_key:
                    item.update(current_profile)
                    updated_profile = True
                    break
            if not updated_profile:
                self.specialist_sheet_profiles.insert(0, current_profile)
            self.selected_specialist_sheet_profile_id = current_profile_id
            self.specialist_sheet_profiles = [
                current_profile,
                *[
                    item
                    for item in self.specialist_sheet_profiles
                    if self._specialist_sheet_profile_key(item) != current_profile_id
                ],
            ]
            self.specialist_sheet_profiles = self._extract_sheet_profiles({"profiles": self.specialist_sheet_profiles})

        payload = {
            "profile_id": str(self.selected_specialist_sheet_profile_id or "").strip(),
            "internal_name": current_profile["internal_name"],
            "spreadsheet_url": current_profile["spreadsheet_url"],
            "sheet_name": current_profile["sheet_name"],
            "start_row": current_profile["start_row"],
            "max_rows": current_profile["max_rows"],
            "selected_pami_usuario": (self.specialist_profile_user_var.get() or "").strip(),
            "selected_pami_nombre": (self.specialist_profile_name_var.get() or "").strip(),
            "pami_usuario": (self.specialist_profile_user_var.get() or "").strip(),
            "pami_nombre": (self.specialist_profile_name_var.get() or "").strip(),
            "browser_visible": current_profile["browser_visible"],
            "sheet_tabs": current_sheet_tabs,
            "selected_profile_id": str(self.selected_specialist_sheet_profile_id or "").strip(),
            "profiles": self.specialist_sheet_profiles,
        }
        self.specialist_sheet_settings_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _save_activate_sheet_settings(self) -> None:
        target_key = str(self.selected_activar_sheet_profile_id or "").strip()
        current_profile_id = target_key if target_key and "|" not in target_key else str(uuid4())
        current_sheet_tabs = self._merge_sheet_tabs(
            self.activar_sheet_tabs,
            (self.activar_sheet_name_var.get() or "").strip(),
        )
        self.activar_sheet_tabs = current_sheet_tabs
        current_profile = {
            "profile_id": current_profile_id,
            "internal_name": self._current_sheet_template_name("activar"),
            "spreadsheet_url": normalize_spreadsheet_url((self.activar_sheet_url_var.get() or "").strip()),
            "sheet_name": (self.activar_sheet_name_var.get() or "").strip(),
            "start_row": (self.activar_sheet_start_row_var.get() or "").strip() or "2",
            "max_rows": (self.activar_sheet_max_rows_var.get() or "").strip() or "40",
            "browser_visible": bool(self.activar_ver_web_var.get()),
            "sheet_tabs": current_sheet_tabs,
        }
        if current_profile["spreadsheet_url"]:
            updated_profile = False
            for item in self.activar_sheet_profiles:
                if self._activate_sheet_profile_key(item) == target_key:
                    item.update(current_profile)
                    updated_profile = True
                    break
            if not updated_profile:
                self.activar_sheet_profiles.insert(0, current_profile)
            self.selected_activar_sheet_profile_id = current_profile_id
            self.activar_sheet_profiles = [
                current_profile,
                *[
                    item
                    for item in self.activar_sheet_profiles
                    if self._activate_sheet_profile_key(item) != current_profile_id
                ],
            ]
            self.activar_sheet_profiles = self._extract_activate_sheet_profiles({"profiles": self.activar_sheet_profiles})

        payload = {
            "profile_id": str(self.selected_activar_sheet_profile_id or "").strip(),
            "internal_name": current_profile["internal_name"],
            "spreadsheet_url": current_profile["spreadsheet_url"],
            "sheet_name": current_profile["sheet_name"],
            "start_row": current_profile["start_row"],
            "max_rows": current_profile["max_rows"],
            "selected_pami_usuario": (self.activar_profile_user_var.get() or "").strip(),
            "selected_pami_nombre": (self.activar_profile_name_var.get() or "").strip(),
            "pami_usuario": (self.activar_profile_user_var.get() or "").strip(),
            "pami_nombre": (self.activar_profile_name_var.get() or "").strip(),
            "browser_visible": current_profile["browser_visible"],
            "sheet_tabs": current_sheet_tabs,
            "selected_profile_id": str(self.selected_activar_sheet_profile_id or "").strip(),
            "profiles": self.activar_sheet_profiles,
        }
        self.activar_sheet_settings_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _open_activar_module(self) -> None:
        if self.open_activar is None:
            messagebox.showwarning("Activar OME", "El acceso al modulo de activar no esta disponible.")
            return
        self._save_activate_sheet_settings()
        self.open_activar()

    def _execute_activate_sheets_request(self, request):
        try:
            return request.execute()
        except Exception as exc:
            raise RuntimeError(f"No se pudo operar con Google Sheets: {exc}") from exc

    def _normalize_activate_header(self, value: str) -> str:
        return " ".join((value or "").strip().lower().split())

    def _find_activate_header_index(self, headers: list[str], *aliases: str) -> int | None:
        normalized_headers = [self._normalize_activate_header(header) for header in headers]
        normalized_aliases = [self._normalize_activate_header(alias) for alias in aliases if alias]
        for alias in normalized_aliases:
            for index, header in enumerate(normalized_headers):
                if not header:
                    continue
                if header == alias or alias in header or header in alias:
                    return index
        return None

    def _looks_like_activate_headerless_plan_salud_row(self, values: list[str]) -> bool:
        if len(values) < 6:
            return False
        first_cell = str(values[0] or "").strip()
        if not re.match(r"^\d{1,2}/\d{1,2}(?:/\d{2,4})?$", first_cell):
            return False
        dni_value = re.sub(r"\D+", "", str(values[2] or ""))
        practice_value = str(values[5] or "").strip()
        return len(dni_value) >= 6 and bool(practice_value)

    def _detect_activate_sheet_layout(self, headers: list[str]) -> dict[str, int | None]:
        if self._looks_like_activate_headerless_plan_salud_row(headers):
            return {
                "beneficio_col": 3,
                "dni_col": 2,
                "practica_col": 5,
                "ome_col": 6,
                "nombre_col": 1,
            }
        return {
            "beneficio_col": self._find_activate_header_index(headers, "benef", "beneficio", "num benef", "nro benef", "numero benef"),
            "dni_col": self._find_activate_header_index(headers, "dni", "nro dni", "numero dni", "documento"),
            "practica_col": self._find_activate_header_index(headers, "practica", "practica general", "especialidad o practica", "especialidad practica", "especialidad", "prestacion"),
            "ome_col": self._find_activate_header_index(headers, "ome", "nro ome", "numero ome", "orden"),
            "nombre_col": self._find_activate_header_index(headers, "nombre y apellido", "apellido y nombre", "nombre", "nombre paciente"),
        }

    def _activate_sheet_cell_value(self, row: list[str], index: int | None) -> str:
        if index is None or index < 0 or index >= len(row):
            return ""
        return str(row[index] or "").strip()

    def _activate_column_letter(self, index: int) -> str:
        if index < 0:
            raise ValueError("El indice de columna no puede ser negativo.")
        result = ""
        current = index + 1
        while current:
            current, remainder = divmod(current - 1, 26)
            result = chr(65 + remainder) + result
        return result

    def _activate_sheet_marker_requires_lookup(self, value: str) -> bool:
        normalized = (value or "").strip().upper()
        if not normalized:
            return True
        if normalized in {"GENERADA", "YA TIENE", "YA TIENE OME", "ERROR", "NO ENCONTRADO", "NO ENCONTRADA"}:
            return True
        return not bool(re.fullmatch(r"\d{8,}", re.sub(r"\D+", "", normalized)))

    def _is_numeric_ome_value(self, value: str) -> bool:
        digits = re.sub(r"\D+", "", str(value or ""))
        return bool(re.fullmatch(r"\d{8,}", digits))

    def _split_activate_ome_slots(self, value: str) -> list[str]:
        text = str(value or "").strip()
        if not text:
            return []
        if "//" not in text:
            return [text]
        return [part.strip() for part in re.split(r"\s*//\s*", text)]

    def _normalize_activate_code(self, value: str) -> str:
        text = (value or "").strip()
        if not text:
            return ""
        digits = "".join(ch if ch.isdigit() else " " for ch in text)
        digit_tokens = [token for token in digits.split() if token]
        if digit_tokens:
            longest = max(digit_tokens, key=len)
            if len(longest) >= 6:
                return longest[:6].strip().upper()
        return text.split(" - ", 1)[0].split()[0].strip().upper()

    def _activate_sheet_practice_candidates(self, raw_practice: str) -> list[str]:
        text = (raw_practice or "").strip()
        if not text:
            return []
        candidates = resolve_plan_salud_practices(text)
        if not candidates:
            single = resolve_plan_salud_practice(text)
            if single:
                candidates = [single]
        deduped: list[str] = []
        seen: set[str] = set()
        for code in candidates:
            normalized = self._normalize_activate_code(code)
            if not normalized or normalized in seen:
                continue
            deduped.append(normalized)
            seen.add(normalized)
        return deduped

    def _activate_value_matches_identifier(self, value: str, *identifiers: str) -> bool:
        value_digits = re.sub(r"\D+", "", str(value or ""))
        if not value_digits:
            return False
        for identifier in identifiers:
            identifier_digits = re.sub(r"\D+", "", str(identifier or ""))
            if identifier_digits and value_digits == identifier_digits:
                return True
        return False

    def _resolve_activate_row_practice(self, row: list[str], layout: dict[str, int | None], beneficio: str, dni: str, ome_raw: str) -> tuple[str, list[str]]:
        candidate_indexes: list[int] = []
        primary_index = layout.get("practica_col")
        if isinstance(primary_index, int) and primary_index >= 0:
            candidate_indexes.append(primary_index)

        excluded_indexes = {
            index
            for index in (
                layout.get("beneficio_col"),
                layout.get("dni_col"),
                layout.get("ome_col"),
                layout.get("nombre_col"),
            )
            if isinstance(index, int) and index >= 0
        }
        for index, cell in enumerate(row):
            if index in excluded_indexes or index in candidate_indexes:
                continue
            cell_text = str(cell or "").strip()
            if not cell_text:
                continue
            candidate_indexes.append(index)

        fallback_raw = ""
        fallback_candidates: list[str] = []
        for index in candidate_indexes:
            raw_value = self._activate_sheet_cell_value(row, index)
            if not raw_value:
                continue
            if self._activate_value_matches_identifier(raw_value, beneficio, dni, ome_raw):
                continue
            candidates = self._activate_sheet_practice_candidates(raw_value)
            if not candidates:
                continue
            if index == primary_index:
                return raw_value, candidates
            if not fallback_candidates:
                fallback_raw = raw_value
                fallback_candidates = candidates

        return fallback_raw, fallback_candidates

    def _build_activate_ome_slots(self, ome_raw: str, candidate_practices: list[str]) -> list[dict]:
        raw_slots = self._split_activate_ome_slots(ome_raw)
        minimum_slots = 1 if (self._activate_sheet_marker_requires_lookup(ome_raw) or candidate_practices) else 0
        slot_count = max(len(raw_slots), len(candidate_practices), minimum_slots)
        if slot_count <= 0:
            return []
        padded_slots = list(raw_slots) + [""] * max(slot_count - len(raw_slots), 0)
        prepared: list[dict] = []
        for index in range(slot_count):
            raw_value = padded_slots[index].strip()
            practice_code = candidate_practices[index] if index < len(candidate_practices) else ""
            prepared.append(
                {
                    "slot_index": index,
                    "raw_value": raw_value,
                    "practice_code": practice_code,
                    "is_numeric": self._is_numeric_ome_value(raw_value),
                    "requires_lookup": (not self._is_numeric_ome_value(raw_value)) and self._activate_sheet_marker_requires_lookup(raw_value),
                }
            )
        return prepared

    def _activate_sheet_start_row(self) -> int:
        try:
            value = int((self.activar_sheet_start_row_var.get() or "2").strip())
        except ValueError as exc:
            raise RuntimeError("La fila inicial de activar debe ser un numero entero.") from exc
        if value < 2:
            raise RuntimeError("La fila inicial de activar debe ser 2 o mayor.")
        return value

    def _activate_sheet_max_rows(self) -> int:
        try:
            value = int((self.activar_sheet_max_rows_var.get() or "40").strip())
        except ValueError as exc:
            raise RuntimeError("El tope de activar debe ser un numero entero.") from exc
        if value < 1:
            raise RuntimeError("El tope de activar debe ser 1 o mayor.")
        return value

    def _load_activate_sheet_tabs(self) -> None:
        sheet_url = normalize_spreadsheet_url((self.activar_sheet_url_var.get() or "").strip())
        if not sheet_url:
            raise RuntimeError("Ingresa la URL de Google Sheets de Activar.")
        if is_office_file_url(self.activar_sheet_url_var.get() or ""):
            raise RuntimeError(OFFICE_FILE_MESSAGE)
        tabs = list_spreadsheet_sheet_names(
            spreadsheet_url_or_id=sheet_url,
            credentials_path=get_gmail_credentials_path(),
            token_path=get_sheets_token_path(),
            interactive=False,
        )
        self.event_queue.put(("activar_tabs_loaded", tabs))

    def _connect_activate_sheets_account(self) -> None:
        token_path = get_sheets_token_path()
        if token_path.exists():
            token_path.unlink()
        sheet_url = normalize_spreadsheet_url((self.activar_sheet_url_var.get() or "").strip())
        sheet_name = (self.activar_sheet_name_var.get() or "").strip()
        email = check_sheets_connection(
            credentials_path=get_gmail_credentials_path(),
            token_path=token_path,
            spreadsheet_url_or_id=sheet_url,
            sheet_name=sheet_name,
            interactive=True,
        )
        self.event_queue.put(("activar_sheets_connected", email or "cuenta Google"))

    def _build_activate_lookup_records(self) -> list[dict]:
        sheet_url = normalize_spreadsheet_url((self.activar_sheet_url_var.get() or "").strip())
        sheet_name = (self.activar_sheet_name_var.get() or "").strip()
        start_row = self._activate_sheet_start_row()
        max_rows = self._activate_sheet_max_rows()
        if not sheet_url:
            raise RuntimeError("Ingresa la URL de Google Sheets de Activar.")
        if is_office_file_url(self.activar_sheet_url_var.get() or ""):
            raise RuntimeError(OFFICE_FILE_MESSAGE)
        if not sheet_name:
            raise RuntimeError("Ingresa la pestana de Activar.")

        self.activar_sheet_url_var.set(sheet_url)
        self._save_activate_sheet_settings()

        spreadsheet_id = extract_spreadsheet_id(sheet_url)
        service = build_sheets_service(interactive=False)
        headers_response = self._execute_activate_sheets_request(
            service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=f"'{sheet_name}'!A1:Z1")
        )
        header_values = headers_response.get("values", [])
        headers = [str(value or "").strip() for value in (header_values[0] if header_values else [])]
        layout = self._detect_activate_sheet_layout(headers)
        if layout["ome_col"] is None:
            raise RuntimeError(f"No se encontro la columna OME en la hoja '{sheet_name}'.")
        if layout["beneficio_col"] is None and layout["dni_col"] is None:
            raise RuntimeError(f"No se encontro una columna de BENEF o DNI en la hoja '{sheet_name}'.")

        response = self._execute_activate_sheets_request(
            service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=f"'{sheet_name}'!A{start_row}:Z")
        )
        values = response.get("values", [])

        records: list[dict] = []
        processed_source_rows = 0
        for offset, row in enumerate(values, start=start_row):
            beneficio = self._activate_sheet_cell_value(row, layout["beneficio_col"])
            dni = self._activate_sheet_cell_value(row, layout["dni_col"])
            identificador = beneficio or dni
            if not identificador:
                continue
            ome_raw = self._activate_sheet_cell_value(row, layout["ome_col"])
            practica_raw, candidate_practices = self._resolve_activate_row_practice(row, layout, beneficio, dni, ome_raw)
            nombre = self._activate_sheet_cell_value(row, layout.get("nombre_col"))
            slots = self._build_activate_ome_slots(ome_raw, candidate_practices)
            for slot in slots:
                if not slot.get("requires_lookup"):
                    continue
                practice_code = str(slot.get("practice_code", "") or "").strip()
                if not practice_code:
                    continue
                records.append(
                    {
                        "sheet_row": offset,
                        "input_beneficio": beneficio,
                        "input_dni": dni,
                        "input_ome": ome_raw,
                        "n_afiliado": identificador,
                        "nombre": nombre,
                        "candidate_practices": [practice_code],
                        "practica_origen": practica_raw,
                        "slot_index": int(slot.get("slot_index", 0) or 0),
                        "slot_count": len(slots),
                        "existing_slots": [str(item.get("raw_value", "") or "").strip() for item in slots],
                    }
                )
            if any(slot.get("requires_lookup") and str(slot.get("practice_code", "") or "").strip() for slot in slots):
                processed_source_rows += 1
            if max_rows and processed_source_rows >= max_rows:
                break

        if not records:
            raise RuntimeError(f"No hay filas pendientes para completar N° OME desde la fila {start_row}.")
        return records

    def _write_activate_lookup_results(self, result_rows: list[dict]) -> int:
        sheet_url = normalize_spreadsheet_url((self.activar_sheet_url_var.get() or "").strip())
        sheet_name = (self.activar_sheet_name_var.get() or "").strip()
        spreadsheet_id = extract_spreadsheet_id(sheet_url)
        service = build_sheets_service(interactive=False)
        headers_response = self._execute_activate_sheets_request(
            service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=f"'{sheet_name}'!A1:Z1")
        )
        header_values = headers_response.get("values", [])
        headers = [str(value or "").strip() for value in (header_values[0] if header_values else [])]
        layout = self._detect_activate_sheet_layout(headers)
        if layout["ome_col"] is None:
            raise RuntimeError(f"No se encontro la columna OME en la hoja '{sheet_name}'.")
        ome_letter = self._activate_column_letter(layout["ome_col"])
        beneficio_letter = self._activate_column_letter(layout["beneficio_col"]) if layout["beneficio_col"] is not None else None

        grouped: dict[int, dict] = {}
        for row in result_rows:
            sheet_row = row.get("sheet_row")
            if not sheet_row:
                continue
            sheet_row_int = int(sheet_row)
            existing_slots = [str(value or "").strip() for value in (row.get("existing_slots") or [])]
            slot_count = max(int(row.get("slot_count", 0) or 0), len(existing_slots), 1)
            while len(existing_slots) < slot_count:
                existing_slots.append("")
            group = grouped.setdefault(
                sheet_row_int,
                {
                    "slots": list(existing_slots),
                    "input_beneficio": str(row.get("input_beneficio", "") or "").strip(),
                    "beneficio_found": "",
                },
            )
            while len(group["slots"]) < slot_count:
                group["slots"].append("")
            slot_index = int(row.get("slot_index", 0) or 0)
            located_ome = str(row.get("n_orden_encontrada", "") or "").strip()
            group["slots"][slot_index] = located_ome or "NO ENCONTRADA"
            beneficio_found = str(row.get("beneficio_encontrado", "") or "").strip()
            if beneficio_found:
                group["beneficio_found"] = beneficio_found

        data = []
        touched_rows: set[int] = set()
        for sheet_row_int, payload in grouped.items():
            visible_value = " // ".join(str(value or "").strip() for value in payload["slots"])
            data.append({"range": f"'{sheet_name}'!{ome_letter}{sheet_row_int}", "values": [[visible_value]]})
            touched_rows.add(sheet_row_int)
            beneficio_input = str(payload.get("input_beneficio", "") or "").strip()
            beneficio_found = str(payload.get("beneficio_found", "") or "").strip()
            if not beneficio_input and beneficio_found and beneficio_letter:
                data.append({"range": f"'{sheet_name}'!{beneficio_letter}{sheet_row_int}", "values": [[beneficio_found]]})

        if not data:
            return 0

        self._execute_activate_sheets_request(
            service.spreadsheets().values().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"valueInputOption": "USER_ENTERED", "data": data},
            )
        )
        return len(touched_rows)

    def _run_activate_ome_lookup_from_sheets(self) -> None:
        profile = {
            "usuario": (self.activar_profile_user_var.get() or "").strip(),
            "clave": self.activar_profile_password_var.get() or "",
        }
        if not profile["usuario"] or not profile["clave"]:
            raise RuntimeError("Elegi un perfil PAMI de Activar con usuario y clave.")

        try:
            self.activar_controller.obtener_estado()
        except Exception:
            self.activar_controller.abrir_panel(
                usuario=profile["usuario"],
                clave=profile["clave"],
                headless=not bool(self.activar_ver_web_var.get()),
            )

        records = self._build_activate_lookup_records()
        self.event_queue.put(("activar_lookup_started", {"total": len(records)}))

        lookup_lote = []
        for record in records:
            candidate_practices = list(record.get("candidate_practices") or [])
            if not candidate_practices:
                candidate_practices = [""]
            lookup_lote.append(
                {
                    "n_afiliado": record["n_afiliado"],
                    "n_orden": "",
                    "candidate_practices": candidate_practices,
                }
            )

        resultado = self.activar_controller.buscar_ome_lote(
            lote=lookup_lote,
            progress_callback=lambda payload: self.event_queue.put(("activar_progress", payload)),
        )

        merged_rows = []
        for record, detalle in zip(records, resultado.detalle):
            merged_rows.append(
                {
                    "sheet_row": record.get("sheet_row"),
                    "input_beneficio": record.get("input_beneficio", ""),
                    "input_dni": record.get("input_dni", ""),
                    "input_ome": record.get("input_ome", ""),
                    "beneficio_encontrado": getattr(detalle, "beneficio_encontrado", "") or "",
                    "n_orden_encontrada": getattr(detalle, "n_orden_encontrada", "") or "",
                    "slot_index": record.get("slot_index", 0),
                    "slot_count": record.get("slot_count", 1),
                    "existing_slots": record.get("existing_slots", []),
                    "nombre": record.get("nombre", ""),
                }
            )

        updated_count = self._write_activate_lookup_results(merged_rows)
        processed_rows = [int(row.get("sheet_row")) for row in merged_rows if str(row.get("sheet_row", "")).isdigit()]
        if processed_rows:
            self.activar_sheet_start_row_var.set(str(max(processed_rows) + 1))
            self._save_activate_sheet_settings()

        rows_for_table = []
        for row in merged_rows:
            rows_for_table.append(
                {
                    "sheet_row": row.get("sheet_row", ""),
                    "dni": row.get("input_dni", ""),
                    "beneficio": row.get("input_beneficio", "") or row.get("beneficio_encontrado", ""),
                    "nombre": row.get("nombre", ""),
                    "resultado": row.get("n_orden_encontrada", "") or "NO ENCONTRADA",
                }
            )
        found_count = sum(1 for row in merged_rows if str(row.get("n_orden_encontrada", "") or "").strip())
        self.event_queue.put(
            (
                "activar_lookup_finished",
                {
                    "rows": rows_for_table,
                    "total_rows": len({int(row.get("sheet_row")) for row in merged_rows if str(row.get("sheet_row", "")).isdigit()}),
                    "total_searches": len(merged_rows),
                    "found": found_count,
                    "not_found": max(len(merged_rows) - found_count, 0),
                    "updated": updated_count,
                },
            )
        )

    def _reserve_temp_output_path(self, preferred_path: Path) -> Path:
        preferred_path.parent.mkdir(parents=True, exist_ok=True)
        if preferred_path.exists():
            try:
                preferred_path.unlink()
            except PermissionError:
                return preferred_path.with_name(f"{preferred_path.stem}_nuevo{preferred_path.suffix}")
        return preferred_path

    def _run_action(self, action, *, allow_during_transmision: bool = False) -> None:
        if self.action_running:
            return
        if self.transmision_bot_active and not allow_during_transmision:
            messagebox.showwarning(
                "Transmision activa",
                "Hay una transmision corriendo. Pausala, espera que finalice o cerra Transmision antes de usar otro modulo.",
            )
            return
        self.stop_requested = False
        self.action_running = True
        self._set_controls_enabled(False)
        self._ensure_action_thread()
        self.action_queue.put(action)

    def _run_activar_action(self, action) -> None:
        if self.action_running:
            return
        self.stop_requested = False
        self.action_running = True
        self._set_controls_enabled(False)
        self._ensure_activar_action_thread()
        self.activar_action_queue.put(action)

    def _ensure_action_thread(self) -> None:
        if self.action_thread is not None and self.action_thread.is_alive():
            return
        self.action_thread = threading.Thread(target=self._action_loop, daemon=True)
        self.action_thread.start()

    def _ensure_activar_action_thread(self) -> None:
        if self.activar_action_thread is not None and self.activar_action_thread.is_alive():
            return
        self.activar_action_thread = threading.Thread(target=self._activar_action_loop, daemon=True)
        self.activar_action_thread.start()

    def _action_loop(self) -> None:
        while True:
            action = self.action_queue.get()
            if action is None:
                break
            try:
                action()
                self.event_queue.put(("action_done", None))
            except Exception as exc:
                self.event_queue.put(("error", str(exc)))

    def _activar_action_loop(self) -> None:
        while True:
            action = self.activar_action_queue.get()
            if action is None:
                break
            try:
                action()
                self.event_queue.put(("activar_action_done", None))
            except Exception as exc:
                self.event_queue.put(("activar_error", str(exc)))

    def _request_stop(self) -> None:
        if not self.action_running:
            return
        self.stop_requested = True
        try:
            self.activar_controller.solicitar_detencion()
        except Exception:
            pass
        try:
            self.liberar_cupo_controller.solicitar_detencion()
        except Exception:
            pass
        self.status_var.set("Detencion solicitada.")
        if hasattr(self, "liberar_cupo_status_var"):
            self.liberar_cupo_status_var.set("Detencion solicitada.")

    def _set_controls_enabled(self, enabled: bool) -> None:
        state = "normal" if enabled else "disabled"
        readonly = "readonly" if enabled else "disabled"
        for widget in (
            self.sheet_url_entry,
            self.sheet_url_config_button,
            self.sheet_name_entry,
            self.sheet_start_entry,
            self.sheet_limit_mode_combo,
            self.sheet_max_entry,
            self.ver_web_check,
            self.connect_button,
            self.run_button,
            self.generate_ome_button,
            self.refresh_button,
            self.specialist_sheet_url_entry,
            self.specialist_sheet_url_config_button,
            self.specialist_sheet_name_entry,
            self.specialist_sheet_start_entry,
            self.specialist_sheet_max_entry,
            self.specialist_ver_web_check,
            self.specialist_connect_button,
            self.specialist_load_tabs_button,
            self.specialist_benef_button,
            self.specialist_dni_button,
            self.specialist_generate_button,
            self.specialist_refresh_button,
            self.activar_sheet_url_entry,
            self.activar_sheet_url_config_button,
            self.activar_sheet_name_entry,
            self.activar_sheet_start_entry,
            self.activar_sheet_max_entry,
            self.activar_ver_web_check,
            self.activar_connect_button,
            self.activar_tabs_button,
            self.activar_lookup_button,
            self.open_activar_button,
            self.activar_refresh_button,
            self.transmision_ver_web_check,
            self.transmision_run_button,
            self.transmision_pause_button,
            self.transmision_resume_button,
            self.transmision_status_button,
            self.transmision_close_button,
            self.transmision_fecha_desde_button,
            self.transmision_fecha_hasta_button,
            self.liberar_cupo_ver_web_check,
            self.liberar_cupo_detect_button,
            self.liberar_cupo_release_button,
            self.liberar_cupo_report_button,
            self.liberar_cupo_close_button,
            self.open_liberar_cupo_button,
            self.liberar_cupo_fecha_desde_button,
            self.liberar_cupo_fecha_hasta_button,
            self.liberar_cupo_max_pages_entry,
            self.credencial_profile_combo,
            self.credencial_url_entry,
            self.credencial_url_config_button,
            self.credencial_start_row_entry,
            self.credencial_limit_mode_combo,
            self.credencial_max_rows_entry,
            self.credencial_end_row_entry,
            self.credencial_only_with_tramite_check,
            self.credencial_connect_button,
            self.credencial_save_button,
            self.credencial_scan_button,
            self.credencial_tabs_button,
            self.credencial_run_button,
            self.open_credenciales_button,
        ):
            widget.configure(state=state)
        self.sheet_combo.configure(state=readonly)
        self.profile_combo.configure(state=readonly)
        self.specialist_sheet_combo.configure(state=readonly)
        self.specialist_profile_combo.configure(state=readonly)
        self.activar_sheet_combo.configure(state=readonly)
        self.activar_profile_combo.configure(state=readonly)
        self.transmision_profile_combo.configure(state=readonly)
        self.transmision_validada_combo.configure(state=readonly)
        self.transmision_transmitida_combo.configure(state=readonly)
        self.liberar_cupo_profile_combo.configure(state=readonly)
        self.credencial_destination_combo.configure(state=readonly)
        self.credencial_sheet_name_combo.configure(state=state)
        for widget in (
            self.sheet_url_entry,
            self.specialist_sheet_url_entry,
            self.activar_sheet_url_entry,
            self.credencial_url_entry,
        ):
            widget.configure(state="readonly" if enabled else "disabled")
        self.transmision_fecha_desde_entry.configure(state=readonly)
        self.transmision_fecha_hasta_entry.configure(state=readonly)
        self.liberar_cupo_fecha_desde_entry.configure(state=readonly)
        self.liberar_cupo_fecha_hasta_entry.configure(state=readonly)
        self.stop_button.configure(state="normal" if not enabled else "disabled")
        if enabled and self.transmision_bot_active:
            self._apply_transmision_active_lock()

    def _apply_transmision_active_lock(self) -> None:
        locked_state = "disabled"
        readonly_locked = "disabled"
        for widget in (
            self.sheet_url_entry,
            self.sheet_url_config_button,
            self.sheet_name_entry,
            self.sheet_start_entry,
            self.sheet_max_entry,
            self.ver_web_check,
            self.connect_button,
            self.run_button,
            self.generate_ome_button,
            self.refresh_button,
            self.specialist_sheet_url_entry,
            self.specialist_sheet_url_config_button,
            self.specialist_sheet_name_entry,
            self.specialist_sheet_start_entry,
            self.specialist_sheet_max_entry,
            self.specialist_ver_web_check,
            self.specialist_connect_button,
            self.specialist_benef_button,
            self.specialist_dni_button,
            self.specialist_generate_button,
            self.specialist_refresh_button,
            self.activar_sheet_url_entry,
            self.activar_sheet_url_config_button,
            self.activar_sheet_name_entry,
            self.activar_sheet_start_entry,
            self.activar_sheet_max_entry,
            self.activar_ver_web_check,
            self.activar_connect_button,
            self.activar_tabs_button,
            self.activar_lookup_button,
            self.open_activar_button,
            self.activar_refresh_button,
            self.liberar_cupo_ver_web_check,
            self.liberar_cupo_detect_button,
            self.liberar_cupo_release_button,
            self.liberar_cupo_report_button,
            self.liberar_cupo_close_button,
            self.open_liberar_cupo_button,
            self.liberar_cupo_fecha_desde_button,
            self.liberar_cupo_fecha_hasta_button,
            self.liberar_cupo_max_pages_entry,
            self.credencial_profile_combo,
            self.credencial_url_entry,
            self.credencial_url_config_button,
            self.credencial_start_row_entry,
            self.credencial_limit_mode_combo,
            self.credencial_max_rows_entry,
            self.credencial_end_row_entry,
            self.credencial_connect_button,
            self.credencial_save_button,
            self.credencial_scan_button,
            self.credencial_tabs_button,
            self.credencial_run_button,
            self.open_credenciales_button,
            self.transmision_run_button,
            self.transmision_ver_web_check,
            self.transmision_fecha_desde_button,
            self.transmision_fecha_hasta_button,
        ):
            widget.configure(state=locked_state)
        self.sheet_combo.configure(state=readonly_locked)
        self.profile_combo.configure(state=readonly_locked)
        self.specialist_sheet_combo.configure(state=readonly_locked)
        self.specialist_profile_combo.configure(state=readonly_locked)
        self.activar_sheet_combo.configure(state=readonly_locked)
        self.activar_profile_combo.configure(state=readonly_locked)
        self.liberar_cupo_profile_combo.configure(state=readonly_locked)
        self.credencial_destination_combo.configure(state=readonly_locked)
        self.credencial_sheet_name_combo.configure(state=locked_state)
        self.transmision_profile_combo.configure(state=readonly_locked)
        self.transmision_validada_combo.configure(state=readonly_locked)
        self.transmision_transmitida_combo.configure(state=readonly_locked)
        self.transmision_fecha_desde_entry.configure(state=readonly_locked)
        self.transmision_fecha_hasta_entry.configure(state=readonly_locked)
        for widget in (
            self.transmision_pause_button,
            self.transmision_resume_button,
            self.transmision_status_button,
            self.transmision_close_button,
        ):
            widget.configure(state="normal")

    def _render_results(self, rows: list[dict]) -> None:
        for item in self.results_table.get_children():
            self.results_table.delete(item)
        for row in rows:
            resultado = str(row.get("resultado", "") or "").strip()
            if resultado.upper() == "YA_TIENE_OME":
                resultado = "YA TIENE OME"
            elif resultado.upper() == "LIMITE_ANUAL":
                resultado = "LIMITE ANUAL"
            self.results_table.insert(
                "",
                "end",
                values=(
                    row.get("sheet_row", ""),
                    row.get("dni", ""),
                    row.get("beneficio", ""),
                    row.get("nombre", ""),
                    resultado,
                ),
            )

    def _process_ui_queue(self) -> None:
        try:
            while True:
                event, payload = self.event_queue.get_nowait()
                if event == "sheets_connected":
                    self.sheets_status_var.set(self._panel_text(f"Sheets: {payload}", 48))
                elif event == "sheets_status":
                    self.sheets_status_var.set(self._panel_text(payload or "Sheets no conectado", 52))
                elif event == "specialist_sheets_connected":
                    self.specialist_sheets_status_var.set(self._panel_text(f"Sheets: {payload}", 48))
                elif event == "specialist_sheets_status":
                    self.specialist_sheets_status_var.set(self._panel_text(payload or "Sheets no conectado", 52))
                elif event == "specialist_tabs_loaded":
                    tabs = [str(item or "").strip() for item in (payload or []) if str(item or "").strip()]
                    self.specialist_sheet_tabs = tabs
                    self.specialist_sheet_name_entry.configure(values=tabs or [""])
                    current = (self.specialist_sheet_name_var.get() or "").strip()
                    if tabs and current not in tabs:
                        match = next((item for item in tabs if item.lower() == current.lower()), "")
                        self.specialist_sheet_name_var.set(match or tabs[0])
                    self._save_specialist_sheet_settings()
                    self.specialist_sheets_status_var.set(self._panel_text(f"Pestañas cargadas: {len(tabs)}", 48))
                elif event == "activar_sheets_connected":
                    self.activar_sheets_status_var.set(self._panel_text(f"Sheets: {payload}", 48))
                elif event == "activar_tabs_loaded":
                    tabs = [str(item or "").strip() for item in (payload or []) if str(item or "").strip()]
                    self.activar_sheet_tabs = tabs
                    self.activar_sheet_name_entry.configure(values=tabs or [""])
                    if tabs:
                        current = (self.activar_sheet_name_var.get() or "").strip()
                        if current not in tabs:
                            match = next((item for item in tabs if item.lower() == current.lower()), "")
                            self.activar_sheet_name_var.set(match or tabs[0])
                    self._save_activate_sheet_settings()
                elif event == "activar_status":
                    self.activar_status_var.set(self._panel_text(payload or "Buscador OME listo.", 54))
                elif event == "activar_log":
                    self.activar_status_var.set(self._panel_text(str(payload or "")[-180:], 54))
                elif event == "activar_lookup_started":
                    self.activar_status_var.set(f"Buscando OME en {payload.get('total', 0)} fila(s)...")
                    self.result_summary_var.set("En ejecucion.")
                    self._render_results([])
                elif event == "activar_progress":
                    self.activar_status_var.set(
                        f"{payload.get('current', 0)}/{payload.get('total', 0)} "
                        f"{payload.get('estado', '')} para {payload.get('n_afiliado', '')}"
                    )
                elif event == "activar_lookup_finished":
                    rows = payload.get("rows", []) or []
                    self._render_results(rows)
                    self.result_summary_var.set(
                        self._panel_text(
                            f"Filas {payload.get('total_rows', 0)} | busquedas {payload.get('total_searches', 0)} | "
                            f"encontradas {payload.get('found', 0)} | no encontradas {payload.get('not_found', 0)}",
                            92,
                        )
                    )
                    self.activar_status_var.set(
                        self._panel_text(
                            f"Buscador finalizado. OMEs encontradas: {payload.get('found', 0)} | Sheets: {payload.get('updated', 0)}",
                            54,
                        )
                    )
                    self.action_running = False
                    self.stop_requested = False
                    self._set_controls_enabled(True)
                    self.after(
                        100,
                        lambda payload=payload: messagebox.showinfo(
                            "Buscar N° OME",
                            "Busqueda finalizada.\n\n"
                            f"Filas revisadas: {payload.get('total_rows', 0)}\n"
                            f"Busquedas realizadas: {payload.get('total_searches', 0)}\n"
                            f"OMEs encontradas: {payload.get('found', 0)}\n"
                            f"No encontradas: {payload.get('not_found', 0)}\n"
                            f"Filas escritas en Sheets: {payload.get('updated', 0)}",
                        ),
                    )
                elif event == "transmision_starting":
                    self.transmision_done_notified = False
                    self._set_transmision_mode("starting", "Iniciando transmision...")
                    self.result_summary_var.set("Transmision en curso. Otros modulos bloqueados.")
                elif event == "transmision_bot_started":
                    visible = bool((payload or {}).get("visible"))
                    modo = "con navegador visible" if visible else "en segundo plano"
                    self._set_transmision_mode("running", f"Transmision activa {modo}. Usa Estado, Pausar o Cerrar.")
                    self.result_summary_var.set("Transmision en curso. Otros modulos bloqueados.")
                elif event == "transmision_bot_stopped":
                    self._set_transmision_mode("inactive", str(payload or "Transmision cerrada."))
                elif event == "transmision_status":
                    self.transmision_status_var.set(self._panel_text(payload or "Transmision lista.", 58))
                elif event == "transmision_log":
                    self.transmision_status_var.set(self._panel_text(str(payload or "")[-180:], 58))
                elif event == "transmision_estado":
                    self._handle_transmision_estado(payload or {}, automatic=False)
                elif event == "transmision_estado_auto":
                    self.transmision_poll_pending = False
                    self._handle_transmision_estado(payload or {}, automatic=True)
                elif event == "transmision_poll_error":
                    self.transmision_poll_pending = False
                    message = str(payload or "")
                    if "No hay navegador abierto" in message or "Target page" in message or "Browser has been closed" in message:
                        self._set_transmision_mode("inactive", "Transmision sin navegador activo.")
                    else:
                        self.transmision_status_var.set(self._panel_text(f"No se pudo leer estado: {message}", 58))
                elif event == "liberar_cupo_status":
                    self.liberar_cupo_status_var.set(self._panel_text(payload or "Liberar Cupo listo.", 58))
                elif event == "liberar_cupo_log":
                    self.liberar_cupo_status_var.set(self._panel_text(str(payload or "")[-180:], 58))
                elif event == "liberar_cupo_detected":
                    rows = payload or []
                    self.liberar_cupo_detected_rows = list(rows)
                    self.liberar_cupo_status_var.set(f"Detectadas {len(rows)} OME(s) no validadas.")
                    self.result_summary_var.set(f"Liberar Cupo: {len(rows)} OME(s) para revisar.")
                    self.after(
                        100,
                        lambda total=len(rows): messagebox.showinfo(
                            "Liberar Cupo",
                            f"Proceso terminado.\n\nDetectadas {total} OME(s) no validadas.",
                        ),
                    )
                elif event == "liberar_cupo_released":
                    resumen = payload
                    ok = getattr(resumen, "ok", 0)
                    errores = getattr(resumen, "errores", 0)
                    omitidos = getattr(resumen, "omitidos", 0)
                    self.liberar_cupo_detected_rows = []
                    self.liberar_cupo_status_var.set(f"Liberadas {ok} | errores {errores} | omitidas {omitidos}")
                    self.result_summary_var.set(
                        self._panel_text(f"Liberar Cupo finalizado: liberadas {ok}, errores {errores}, omitidas {omitidos}.", 92)
                    )
                    self.after(
                        100,
                        lambda ok=ok, errores=errores, omitidos=omitidos: messagebox.showinfo(
                            "Liberar Cupo",
                            f"Proceso terminado.\n\nLiberadas: {ok}\nErrores: {errores}\nOmitidas: {omitidos}",
                        ),
                    )
                elif event == "credencial_status":
                    self.credencial_status_var.set(self._panel_text(payload or "Credenciales listas.", 58))
                elif event == "credencial_tabs_loaded":
                    tabs = [str(item or "").strip() for item in (payload or []) if str(item or "").strip()]
                    self.credencial_sheet_tabs = tabs
                    self.credencial_sheet_name_combo.configure(values=tabs or [""])
                    current = (self.credencial_sheet_name_var.get() or "").strip()
                    if tabs and current not in tabs:
                        match = next((item for item in tabs if item.lower() == current.lower()), "")
                        self.credencial_sheet_name_var.set(match or tabs[0])
                    self._save_credencial_settings()
                elif event == "credencial_scan_done":
                    updated = int(payload.get("updated") or 0)
                    reviewed = int(payload.get("reviewed") or 0)
                    unresolved = int(payload.get("unresolved") or 0)
                    range_text = str(payload.get("range_text", "") or "").strip()
                    messagebox.showinfo(
                        "Barrido tramite",
                        f"Rango revisado: {range_text}\n\n"
                        f"Filas sin tramite revisadas: {reviewed}\n"
                        f"Tramites recuperados: {updated}\n"
                        f"Siguen sin tramite: {unresolved}",
                    )
                elif event == "credencial_progress":
                    self.status_var.set(
                        self._panel_text(
                            f"Credenciales {payload.get('current', 0)}/{payload.get('total', 0)} "
                            f"{payload.get('estado', '')} en DNI {payload.get('dni', '')}",
                            62,
                        )
                    )
                elif event == "started":
                    self.status_var.set(
                        self._panel_text(
                            f"Procesando {payload.get('total', 0)} fila(s): {payload.get('action_label', 'accion')}...",
                            62,
                        )
                    )
                    if payload.get("action_key") == "specialist_generate_ome":
                        self.specialist_status_var.set(f"Procesando {payload.get('total', 0)} OME(s)...")
                    elif payload.get("action_key") == "specialist_complete_benef":
                        self.specialist_status_var.set(f"Completando BENEF en {payload.get('total', 0)} fila(s)...")
                    elif payload.get("action_key") == "specialist_complete_dni":
                        self.specialist_status_var.set(f"Completando DNI en {payload.get('total', 0)} fila(s)...")
                    self.result_summary_var.set("En ejecucion.")
                    self._render_results([])
                elif event == "progress":
                    self.status_var.set(
                        self._panel_text(
                            f"{payload.get('current', 0)}/{payload.get('total', 0)} "
                            f"{payload.get('resultado', '')} en DNI {payload.get('afiliado', '')}",
                            62,
                        )
                    )
                elif event == "finished":
                    rows = payload.get("rows", []) or []
                    action_key = payload.get("action_key", "")
                    sheet_error = str(payload.get("sheet_error", "") or "").strip()
                    sheet_status = (
                        "Sheets sin actualizar: falta permiso de escritura"
                        if sheet_error
                        else f"Sheets actualizadas: {payload.get('updated', 0)}"
                    )
                    completados = sum(1 for row in rows if row.get("resultado") == "BENEF_COMPLETADO")
                    dni_completados = sum(1 for row in rows if row.get("resultado") == "DNI_COMPLETADO")
                    ok = sum(1 for row in rows if row.get("resultado") == "OK")
                    generadas = sum(1 for row in rows if row.get("resultado") in {"GENERADA", "YA_TIENE_OME"})
                    limite = sum(1 for row in rows if row.get("resultado") in {"LIMITE", "LIMITE_ANUAL"})
                    doble_dni = sum(1 for row in rows if row.get("resultado") == "DOBLE_DNI")
                    revisar = sum(
                        1
                        for row in rows
                        if str(row.get("resultado", "")).startswith("ERROR")
                        or row.get("resultado") in {"NO_DNI", "NO_PAMI", "BAJA"}
                    )
                    self._render_results(rows)
                    if action_key in {"generate_ome", "specialist_generate_ome"}:
                        self.result_summary_var.set(
                            self._panel_text(
                                f"Total {len(rows)} | OK {ok} | GENERADA {generadas} | LIMITE {limite} | DOBLE_DNI {doble_dni} | revisar {revisar}",
                                92,
                            )
                        )
                        self.status_var.set(
                            self._panel_text(f"Finalizado. OMEs nuevas: {ok} | ya existentes: {generadas} | {sheet_status}", 62)
                        )
                        if action_key == "specialist_generate_ome":
                            self.specialist_status_var.set(
                                self._panel_text(f"Finalizado. OMEs nuevas: {ok} | ya existentes: {generadas} | {sheet_status}", 54)
                            )
                    elif action_key == "credenciales":
                        descargadas = sum(1 for row in rows if row.get("resultado") == "DESCARGADA")
                        falta_benef = sum(1 for row in rows if row.get("resultado") == "Falta BENEF")
                        drive_error = str(payload.get("drive_error", "") or "").strip()
                        errores = sum(
                            1
                            for row in rows
                            if str(row.get("resultado", "")).upper() == "ERROR"
                            or str(row.get("resultado", "")).startswith("Falta")
                        )
                        self.result_summary_var.set(
                            self._panel_text(
                                f"Total {len(rows)} | descargadas {descargadas} | falta BENEF {falta_benef} | revisar {errores}",
                                92,
                            )
                        )
                        drive_status = (
                            f"Drive falló: {drive_error}"
                            if drive_error
                            else f"Drive: {payload.get('drive_uploaded', 0)}"
                        )
                        self.status_var.set(
                            self._panel_text(f"Finalizado. Credenciales descargadas: {descargadas} | {sheet_status} | {drive_status}", 62)
                        )
                        self.credencial_status_var.set("Credenciales listas.")
                    else:
                        self.result_summary_var.set(
                            self._panel_text(
                                f"Total {len(rows)} | BENEF {completados} | DNI {dni_completados} | DOBLE_DNI {doble_dni} | revisar {revisar}",
                                92,
                            )
                        )
                        if action_key == "specialist_complete_dni":
                            self.status_var.set(
                                self._panel_text(f"Finalizado. DNI completados: {dni_completados} | {sheet_status}", 62)
                            )
                        else:
                            self.status_var.set(
                                self._panel_text(f"Finalizado. BENEF completados: {completados} | {sheet_status}", 62)
                            )
                        if action_key == "specialist_complete_benef":
                            self.specialist_status_var.set(
                                self._panel_text(f"Finalizado. BENEF completados: {completados} | {sheet_status}", 54)
                            )
                        elif action_key == "specialist_complete_dni":
                            self.specialist_status_var.set(
                                self._panel_text(f"Finalizado. DNI completados: {dni_completados} | {sheet_status}", 54)
                            )
                    if sheet_error:
                        messagebox.showwarning(
                            "Google Sheets",
                            "El proceso termino, pero no se pudo anotar en Google Sheets. "
                            "El resultado quedo en la grilla para carga manual.",
                        )
                    self.action_running = False
                    self.stop_requested = False
                    self._set_controls_enabled(True)
                elif event == "activar_action_done":
                    if self.action_running:
                        self.action_running = False
                        self.stop_requested = False
                        self._set_controls_enabled(True)
                elif event == "action_done":
                    if self.action_running:
                        self.action_running = False
                        self.stop_requested = False
                        self._set_controls_enabled(True)
                elif event == "activar_error":
                    self.action_running = False
                    self.stop_requested = False
                    self._set_controls_enabled(True)
                    message = self._friendly_error_message(str(payload or "Error desconocido."))
                    short_message = self._panel_text(message, 90)
                    self.activar_status_var.set(f"Error: {short_message}")
                    self.result_summary_var.set("La ejecucion no finalizo.")
                    messagebox.showerror("Activar OME - Sheets", message)
                elif event == "error":
                    if (self.transmision_badge_var.get() or "").strip().upper() == "INICIANDO":
                        self._set_transmision_mode("inactive", "Transmision no iniciada.")
                    self.action_running = False
                    self.stop_requested = False
                    self._set_controls_enabled(True)
                    message = self._friendly_error_message(str(payload or "Error desconocido."))
                    short_message = self._panel_text(message, 90)
                    self.status_var.set(f"Error: {short_message}")
                    self.result_summary_var.set("La ejecucion no finalizo.")
                    messagebox.showerror("Panel Rapido", message)
        except queue.Empty:
            pass
        self._schedule_transmision_status_poll()
        self.after(150, self._process_ui_queue)

    def _friendly_error_message(self, message: str) -> str:
        raw = str(message or "")
        lowered = raw.lower()
        if "invalid_grant" in lowered or "expired" in lowered or "revoked" in lowered:
            return (
                "La conexion de Google Sheets vencio o fue revocada.\n\n"
                "Presiona Conectar Sheets para autorizar la cuenta nuevamente y despues reintenta."
            )
        if "insufficient authentication scopes" in lowered or "insufficient permission" in lowered:
            return (
                "Google no dio permisos suficientes para esta accion.\n\n"
                "Presiona Conectar Sheets nuevamente y acepta los permisos solicitados."
            )
        if (
            ("connection aborted" in lowered and "permission denied" in lowered)
            or "permissionerror(13" in lowered
            or "callback local" in lowered
        ):
            return (
                "No se pudo completar la autorizacion de Google Sheets.\n\n"
                "El navegador o Windows corto el permiso de conexion local. "
                "Presiona Conectar Sheets nuevamente, acepta los permisos de Google y espera a que la pagina confirme la conexion."
            )
        if "no hay token google sheets valido" in lowered or "token sheets encontrado" in lowered:
            return (
                "Google Sheets no esta conectado correctamente.\n\n"
                "Presiona Conectar Sheets para autorizar la cuenta."
            )
        if "playwright sync api inside the asyncio loop" in lowered:
            return (
                "El buscador de OME se estaba ejecutando en un hilo incompatible con Playwright. "
                "Ahora debe correr aislado; volve a intentar la accion."
            )
        if "target page, context or browser has been closed" in lowered:
            return "El navegador de PAMI se cerro durante el proceso. Volve a ejecutar la accion para reabrir la sesion automaticamente."
        if "primero abre pami" in lowered:
            return "No hay una sesion activa de PAMI. Ejecuta Detectar no validadas para abrir PAMI automaticamente."
        return raw

    def on_close(self) -> None:
        self.stop_requested = True
        self._cancel_transmision_status_poll()
        try:
            self.activar_controller.cerrar_navegador()
        except Exception:
            pass
        try:
            self.transmision_controller.cerrar()
        except Exception:
            pass
        try:
            self.liberar_cupo_controller.cerrar()
        except Exception:
            pass

    def refresh_panel_rapido_config(self) -> None:
        self.panel_config = load_panel_rapido_config()
        if hasattr(self, "ver_web_var"):
            self.ver_web_var.set(bool(self.panel_config.get("ver_web_default", False)))
        if hasattr(self, "specialist_ver_web_var"):
            self.specialist_ver_web_var.set(bool(self.panel_config.get("ver_web_default", False)))
        if hasattr(self, "transmision_ver_web_var"):
            self.transmision_ver_web_var.set(bool(self.panel_config.get("ver_web_default", False)))
        if hasattr(self, "liberar_cupo_ver_web_var"):
            self.liberar_cupo_ver_web_var.set(False)
        if hasattr(self, "results_block"):
            self._apply_panel_layout()

