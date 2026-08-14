import json
import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time
import unicodedata
import webbrowser
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox

import customtkinter as ctk
from openpyxl import Workbook

from app_dialogs import center_toplevel_on_parent
from app_logging import log_message
from app_paths import get_data_dir, get_log_file
from gmail_informes import get_gmail_credentials_path
from google_sheets_validacion import inspect_validation_sheet_rows, mark_validation_sheet_row, read_validation_sheet_rows
from google_sheets_credenciales import OFFICE_FILE_MESSAGE, is_office_file_url, normalize_spreadsheet_url
from google_sheets_ome import get_connected_google_email, get_sheets_token_path, list_spreadsheet_sheet_names
from pami_validacion import ValidacionOmeController


PAMI_PRESTADORES_PACKAGE = "ar.org.pami.prestadores"
DEFAULT_VALIDACION_SHEET_URL = ""


class ValidacionOmeBetaFrame(ctk.CTkFrame):
    """
    Modulo BETA para preparar la futura validacion de OMEs
    mediante app Android de PAMI.
    """

    def __init__(self, master, on_back=None) -> None:
        super().__init__(master, fg_color="transparent")
        self.on_back = on_back

        self.data_dir = get_data_dir()
        self.config_file = Path(self.data_dir) / "validacion_ome_beta.json"
        self.report_file = Path(self.data_dir) / "salidas" / "validacion_ome_beta.xlsx"
        self.config = self._load_config()
        self.event_queue: queue.Queue = queue.Queue()
        self.validation_rows: list[dict] = []
        self.sheet_records: list[dict] = []
        self.current_record_index = -1
        self.sheets_connected = False
        self.qr_window = None
        self.qr_ctk_image = None
        self.validation_watch_running = False
        self.controller = ValidacionOmeController(
            log_callback=self._append_log,
            status_callback=self._set_status,
        )

        self._build_ui()
        self._load_config_into_form()
        self.after(300, self._start_sheets_status_check)
        self.after(150, self._process_ui_queue)

    def _build_ui(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        top_bar = ctk.CTkFrame(self, corner_radius=16, fg_color="#f3f7fb")
        top_bar.grid(row=0, column=0, padx=14, pady=(10, 6), sticky="ew")
        top_bar.grid_columnconfigure(1, weight=1)

        if self.on_back:
            ctk.CTkButton(
                top_bar,
                text="Volver",
                width=100,
                command=self._go_home,
                fg_color="#9aafc3",
                hover_color="#7f95aa",
            ).grid(row=0, column=0, rowspan=2, padx=(12, 10), pady=10, sticky="w")

        ctk.CTkLabel(
            top_bar,
            text="Validacion OME (BETA)",
            font=ctk.CTkFont(size=25, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=1, padx=14, pady=(10, 2), sticky="w")

        ctk.CTkLabel(
            top_bar,
            text="Preparacion del flujo para validar pacientes con la app Android de PAMI y el QR de credencial.",
            font=ctk.CTkFont(size=13),
            text_color="#51657a",
        ).grid(row=1, column=1, padx=14, pady=(0, 10), sticky="w")

        content = ctk.CTkScrollableFrame(self, corner_radius=16, fg_color="#ffffff")
        content.grid(row=1, column=0, padx=14, pady=(0, 14), sticky="nsew")
        content.grid_columnconfigure(0, weight=1)

        status_frame = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        status_frame.grid(row=0, column=0, padx=14, pady=(0, 8), sticky="ew")
        status_frame.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            status_frame,
            text="Estado del modulo",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=12, pady=(12, 4), sticky="w")

        self.status_label = ctk.CTkLabel(
            status_frame,
            text="BETA sin conexion Android todavia.",
            font=ctk.CTkFont(size=13),
            text_color="#51657a",
            wraplength=980,
        )
        self.status_label.grid(row=1, column=0, padx=12, pady=(0, 12), sticky="w")

        setup_frame = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        setup_frame.grid(row=1, column=0, padx=14, pady=(0, 8), sticky="ew")
        setup_frame.grid_columnconfigure(1, weight=0)
        setup_frame.grid_columnconfigure(3, weight=0)
        setup_frame.grid_columnconfigure(5, weight=1)

        ctk.CTkLabel(
            setup_frame,
            text="Conexion Android",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, columnspan=4, padx=12, pady=(12, 8), sticky="w")

        self.mode_var = ctk.StringVar(value="Telefono fisico por USB")
        ctk.CTkLabel(setup_frame, text="Modo", font=ctk.CTkFont(size=13, weight="bold"), text_color="#16324f").grid(
            row=1, column=0, padx=12, pady=(0, 8), sticky="w"
        )
        self.mode_combo = ctk.CTkOptionMenu(
            setup_frame,
            variable=self.mode_var,
            values=["Telefono fisico por USB", "Emulador Android"],
            width=210,
        )
        self.mode_combo.grid(row=1, column=1, padx=(0, 18), pady=(0, 8), sticky="w")

        self.device_var = ctk.StringVar(value="")
        ctk.CTkLabel(setup_frame, text="Dispositivo", font=ctk.CTkFont(size=13, weight="bold"), text_color="#16324f").grid(
            row=1, column=2, padx=(0, 8), pady=(0, 8), sticky="w"
        )
        ctk.CTkEntry(
            setup_frame,
            textvariable=self.device_var,
            placeholder_text="serial ADB o nombre del emulador",
            width=260,
        ).grid(row=1, column=3, padx=(0, 12), pady=(0, 8), sticky="w")

        self.package_var = ctk.StringVar(value=PAMI_PRESTADORES_PACKAGE)
        ctk.CTkLabel(setup_frame, text="Paquete app", font=ctk.CTkFont(size=13, weight="bold"), text_color="#16324f").grid(
            row=2, column=0, padx=12, pady=(0, 12), sticky="w"
        )
        ctk.CTkEntry(
            setup_frame,
            textvariable=self.package_var,
            placeholder_text=PAMI_PRESTADORES_PACKAGE,
            width=260,
        ).grid(row=2, column=1, padx=(0, 18), pady=(0, 12), sticky="w")

        self.activity_var = ctk.StringVar(value="")
        ctk.CTkLabel(setup_frame, text="Activity", font=ctk.CTkFont(size=13, weight="bold"), text_color="#16324f").grid(
            row=2, column=2, padx=(0, 8), pady=(0, 12), sticky="w"
        )
        ctk.CTkEntry(
            setup_frame,
            textvariable=self.activity_var,
            placeholder_text="opcional si Appium la detecta",
            width=260,
        ).grid(row=2, column=3, padx=(0, 12), pady=(0, 12), sticky="w")

        qr_frame = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        qr_frame.grid(row=2, column=0, padx=14, pady=(0, 8), sticky="ew")
        qr_frame.grid_columnconfigure(1, weight=0)
        qr_frame.grid_columnconfigure(2, weight=1)

        ctk.CTkLabel(
            qr_frame,
            text="Datos para validar",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, columnspan=2, padx=12, pady=(12, 8), sticky="w")

        self.beneficio_var = ctk.StringVar(value="")
        ctk.CTkLabel(qr_frame, text="Beneficio", font=ctk.CTkFont(size=13, weight="bold"), text_color="#16324f").grid(
            row=1, column=0, padx=12, pady=(0, 8), sticky="w"
        )
        ctk.CTkEntry(qr_frame, textvariable=self.beneficio_var, placeholder_text="numero de beneficio", width=260).grid(
            row=1, column=1, padx=(0, 12), pady=(0, 8), sticky="w"
        )

        self.ome_var = ctk.StringVar(value="")
        ctk.CTkLabel(qr_frame, text="OME", font=ctk.CTkFont(size=13, weight="bold"), text_color="#16324f").grid(
            row=2, column=0, padx=12, pady=(0, 12), sticky="w"
        )
        ctk.CTkEntry(qr_frame, textvariable=self.ome_var, placeholder_text="numero de orden medica", width=260).grid(
            row=2, column=1, padx=(0, 12), pady=(0, 12), sticky="w"
        )

        self.paciente_var = ctk.StringVar(value="")
        ctk.CTkLabel(qr_frame, text="Paciente", font=ctk.CTkFont(size=13, weight="bold"), text_color="#16324f").grid(
            row=3, column=0, padx=12, pady=(0, 8), sticky="w"
        )
        ctk.CTkEntry(qr_frame, textvariable=self.paciente_var, placeholder_text="apellido y nombre", width=360).grid(
            row=3, column=1, padx=(0, 12), pady=(0, 8), sticky="w"
        )

        self.pdf_path_var = ctk.StringVar(value="")
        ctk.CTkLabel(qr_frame, text="PDF credencial", font=ctk.CTkFont(size=13, weight="bold"), text_color="#16324f").grid(
            row=4, column=0, padx=12, pady=(0, 12), sticky="w"
        )
        ctk.CTkEntry(qr_frame, textvariable=self.pdf_path_var, placeholder_text="ruta del PDF generado por Credencial", width=520).grid(
            row=4, column=1, padx=(0, 12), pady=(0, 12), sticky="w"
        )

        sheets_frame = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        sheets_frame.grid(row=3, column=0, padx=14, pady=(0, 8), sticky="ew")
        sheets_frame.grid_columnconfigure(1, weight=0)
        sheets_frame.grid_columnconfigure(5, weight=1)

        ctk.CTkLabel(
            sheets_frame,
            text="Lote desde Google Sheets",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, columnspan=4, padx=12, pady=(12, 8), sticky="w")

        self.sheet_url_var = ctk.StringVar(value=DEFAULT_VALIDACION_SHEET_URL)
        self.sheet_name_var = ctk.StringVar(value="")
        self.sheet_start_row_var = ctk.StringVar(value="2")
        self.sheet_max_rows_var = ctk.StringVar(value="25")
        self.sheet_validation_col_var = ctk.StringVar(value="O")
        self.sheets_status_var = ctk.StringVar(value="Google Sheets no conectado")
        self.sheet_tabs: list[str] = []

        ctk.CTkLabel(sheets_frame, text="URL", font=ctk.CTkFont(size=13, weight="bold"), text_color="#16324f").grid(
            row=1, column=0, padx=12, pady=(0, 8), sticky="w"
        )
        ctk.CTkEntry(sheets_frame, textvariable=self.sheet_url_var, width=520).grid(
            row=1, column=1, columnspan=3, padx=(0, 12), pady=(0, 8), sticky="w"
        )

        ctk.CTkLabel(sheets_frame, text="Pestana", font=ctk.CTkFont(size=13, weight="bold"), text_color="#16324f").grid(
            row=2, column=0, padx=12, pady=(0, 12), sticky="w"
        )
        self.sheet_name_combo = ctk.CTkComboBox(
            sheets_frame,
            values=[""],
            variable=self.sheet_name_var,
            width=210,
        )
        self.sheet_name_combo.grid(
            row=2, column=1, padx=(0, 12), pady=(0, 12), sticky="w"
        )
        range_controls = ctk.CTkFrame(sheets_frame, fg_color="transparent")
        range_controls.grid(row=2, column=2, columnspan=2, padx=(0, 12), pady=(0, 12), sticky="w")
        ctk.CTkLabel(range_controls, text="Fila", font=ctk.CTkFont(size=12), text_color="#16324f").grid(
            row=0, column=0, padx=(0, 4), sticky="w"
        )
        ctk.CTkEntry(range_controls, textvariable=self.sheet_start_row_var, width=80).grid(
            row=0, column=1, padx=(0, 12), sticky="w"
        )
        ctk.CTkLabel(range_controls, text="Tope", font=ctk.CTkFont(size=12), text_color="#16324f").grid(
            row=0, column=2, padx=(0, 4), sticky="w"
        )
        ctk.CTkEntry(range_controls, textvariable=self.sheet_max_rows_var, width=80).grid(
            row=0, column=3, sticky="w"
        )
        ctk.CTkLabel(range_controls, text="Valida", font=ctk.CTkFont(size=12), text_color="#16324f").grid(
            row=0, column=4, padx=(12, 4), sticky="w"
        )
        ctk.CTkEntry(range_controls, textvariable=self.sheet_validation_col_var, width=70).grid(
            row=0, column=5, sticky="w"
        )

        ctk.CTkButton(sheets_frame, text="Pestanas", command=self._load_sheet_tabs, width=100).grid(
            row=3, column=0, padx=12, pady=(0, 12), sticky="w"
        )
        ctk.CTkButton(sheets_frame, text="Conectar Sheets", command=self._connect_sheets_account, width=140).grid(
            row=3, column=1, padx=(0, 12), pady=(0, 12), sticky="w"
        )
        ctk.CTkButton(sheets_frame, text="Cargar planilla", command=self._load_sheet_records, width=150).grid(
            row=3, column=2, padx=(0, 12), pady=(0, 12), sticky="w"
        )
        ctk.CTkButton(sheets_frame, text="Siguiente paciente", command=self._load_next_record, width=160).grid(
            row=3, column=3, padx=(0, 12), pady=(0, 12), sticky="w"
        )
        ctk.CTkButton(sheets_frame, text="Diagnosticar N", command=self._inspect_sheet_records, width=140).grid(
            row=3, column=4, padx=(0, 12), pady=(0, 12), sticky="w"
        )
        ctk.CTkLabel(
            sheets_frame,
            textvariable=self.sheets_status_var,
            font=ctk.CTkFont(size=12),
            text_color="#51657a",
        ).grid(row=4, column=0, columnspan=2, padx=12, pady=(0, 12), sticky="w")
        self.sheet_status_label = ctk.CTkLabel(
            sheets_frame,
            text="Sin lote cargado.",
            font=ctk.CTkFont(size=12),
            text_color="#51657a",
        )
        self.sheet_status_label.grid(row=4, column=2, columnspan=2, padx=(0, 12), pady=(0, 12), sticky="w")

        actions = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        actions.grid(row=4, column=0, padx=14, pady=(0, 8), sticky="ew")

        ctk.CTkButton(
            actions,
            text="Guardar configuracion",
            command=self._save_config_from_form,
            width=170,
            fg_color="#4f6378",
            hover_color="#3d4d61",
        ).grid(row=0, column=0, padx=12, pady=12, sticky="w")

        ctk.CTkButton(actions, text="Probar conexion Android", command=self._show_beta_pending, width=180).grid(
            row=0, column=1, padx=(0, 12), pady=12, sticky="w"
        )
        ctk.CTkButton(actions, text="Abrir app PAMI", command=self._open_android_app, width=140).grid(
            row=0, column=2, padx=(0, 12), pady=12, sticky="w"
        )
        ctk.CTkButton(actions, text="Seleccionar PDF", command=self._select_pdf, width=140).grid(
            row=0, column=3, padx=(0, 12), pady=12, sticky="w"
        )
        ctk.CTkButton(actions, text="Abrir PDF QR", command=self._open_pdf, width=120).grid(
            row=0, column=4, padx=(0, 12), pady=12, sticky="w"
        )
        ctk.CTkButton(
            actions,
            text="Leer celular",
            command=self._read_phone_screen,
            width=120,
            fg_color="#2d7d59",
            hover_color="#236346",
        ).grid(row=0, column=5, padx=(0, 12), pady=12, sticky="w")
        ctk.CTkButton(actions, text="Preparar escaneo", command=self._prepare_scan_on_phone, width=150).grid(
            row=0, column=6, padx=(0, 12), pady=12, sticky="w"
        )
        ctk.CTkButton(actions, text="Aceptar celular", command=self._tap_accept_on_phone, width=130).grid(
            row=0, column=7, padx=(0, 12), pady=12, sticky="w"
        )
        ctk.CTkButton(actions, text="Abrir orden celular", command=self._open_current_order_on_phone, width=150).grid(
            row=1, column=1, padx=(0, 12), pady=(0, 12), sticky="w"
        )
        ctk.CTkButton(actions, text="Mostrar QR app", command=self._show_qr_for_current_record, width=140).grid(
            row=1, column=2, padx=(0, 12), pady=(0, 12), sticky="w"
        )
        ctk.CTkButton(
            actions,
            text="Auto paciente actual",
            command=self._auto_prepare_current_record,
            width=170,
            fg_color="#2d7d59",
            hover_color="#236346",
        ).grid(row=1, column=3, padx=(0, 12), pady=(0, 12), sticky="w")

        result_actions = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        result_actions.grid(row=5, column=0, padx=14, pady=(0, 8), sticky="ew")

        ctk.CTkButton(
            result_actions,
            text="Marcar validado",
            command=lambda: self._register_validation_result("VALIDADO"),
            width=150,
            fg_color="#2d7d59",
            hover_color="#236346",
        ).grid(row=0, column=0, padx=12, pady=12, sticky="w")
        ctk.CTkButton(
            result_actions,
            text="Marcar error",
            command=lambda: self._register_validation_result("ERROR"),
            width=130,
            fg_color="#b54848",
            hover_color="#943838",
        ).grid(row=0, column=1, padx=(0, 12), pady=12, sticky="w")
        ctk.CTkButton(
            result_actions,
            text="Exportar reporte",
            command=self._export_report,
            width=150,
            fg_color="#4f6378",
            hover_color="#3d4d61",
        ).grid(row=0, column=2, padx=(0, 12), pady=12, sticky="w")

        log_frame = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        log_frame.grid(row=6, column=0, padx=14, pady=(0, 14), sticky="ew")
        log_frame.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            log_frame,
            text="Bitacora",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=12, pady=(12, 8), sticky="w")

        self.log_text = ctk.CTkTextbox(log_frame, height=140, font=ctk.CTkFont(size=13))
        self.log_text.grid(row=1, column=0, padx=12, pady=(0, 12), sticky="ew")
        self.log_text.insert("1.0", f"Modulo BETA creado. Log general: {get_log_file()}\n")
        self.log_text.configure(state="disabled")

    def _load_config(self) -> dict:
        if not self.config_file.exists():
            return {}
        try:
            with self.config_file.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _load_config_into_form(self) -> None:
        self.mode_var.set(self.config.get("modo", "Telefono fisico por USB"))
        self.device_var.set(self.config.get("dispositivo", ""))
        self.package_var.set(self.config.get("paquete", PAMI_PRESTADORES_PACKAGE))
        self.activity_var.set(self.config.get("activity", ""))
        self.beneficio_var.set(self.config.get("beneficio", ""))
        self.ome_var.set(self.config.get("ome", ""))
        self.paciente_var.set(self.config.get("paciente", ""))
        self.pdf_path_var.set(self.config.get("pdf_path", ""))
        self.sheet_url_var.set(self.config.get("sheet_url", DEFAULT_VALIDACION_SHEET_URL))
        self.sheet_name_var.set(self.config.get("sheet_name", ""))
        self.sheet_start_row_var.set(self.config.get("sheet_start_row", "2"))
        self.sheet_max_rows_var.set(self.config.get("sheet_max_rows", "25"))
        self.sheet_validation_col_var.set(self.config.get("sheet_validation_col", "O"))

    def _current_config_from_form(self) -> dict:
        sheet_url = normalize_spreadsheet_url(self.sheet_url_var.get().strip())
        return {
            "modo": self.mode_var.get().strip(),
            "dispositivo": self.device_var.get().strip(),
            "paquete": self.package_var.get().strip() or PAMI_PRESTADORES_PACKAGE,
            "activity": self.activity_var.get().strip(),
            "beneficio": self.beneficio_var.get().strip(),
            "ome": self.ome_var.get().strip(),
            "paciente": self.paciente_var.get().strip(),
            "pdf_path": self.pdf_path_var.get().strip(),
            "sheet_url": sheet_url,
            "sheet_name": self.sheet_name_var.get().strip(),
            "sheet_start_row": self.sheet_start_row_var.get().strip() or "2",
            "sheet_max_rows": self.sheet_max_rows_var.get().strip() or "25",
            "sheet_validation_col": self.sheet_validation_col_var.get().strip().upper() or "O",
        }

    def _save_config_from_form(self) -> None:
        self.config = self._current_config_from_form()
        self.package_var.set(self.config["paquete"])
        self.sheet_url_var.set(self.config["sheet_url"])
        self.sheet_validation_col_var.set(self.config["sheet_validation_col"])
        with self.config_file.open("w", encoding="utf-8") as fh:
            json.dump(self.config, fh, ensure_ascii=False, indent=2)
        self.status_label.configure(text=f"Configuracion guardada en {self.config_file}")
        self._append_log("Configuracion BETA guardada.")
        log_message("[VALIDACION OME BETA] Configuracion guardada.")

    def _show_beta_pending(self) -> None:
        self._save_config_from_form()
        try:
            devices = self.controller.list_devices()
            if devices:
                detalle = "\n".join(f"- {item.serial} ({item.state})" for item in devices)
                messagebox.showinfo("Validacion OME (BETA)", f"ADB respondio correctamente.\n\n{detalle}")
            else:
                messagebox.showwarning("Validacion OME (BETA)", "ADB respondio, pero no encontro dispositivos conectados.")
        except Exception as exc:
            messagebox.showerror("Validacion OME (BETA)", str(exc))
            self._append_log(f"Error probando Android: {exc}")

    def _open_android_app(self) -> None:
        self._save_config_from_form()
        try:
            self.controller.open_app(
                package=self.package_var.get().strip() or PAMI_PRESTADORES_PACKAGE,
                activity=self.activity_var.get(),
                device_serial=self.device_var.get(),
            )
            messagebox.showinfo("Validacion OME (BETA)", "Se envio la orden para abrir la app Android.")
        except Exception as exc:
            messagebox.showerror("Validacion OME (BETA)", str(exc))
            self._append_log(f"Error abriendo app Android: {exc}")

    def _select_pdf(self) -> None:
        path = filedialog.askopenfilename(
            title="Seleccionar PDF de credencial provisoria",
            initialdir=str(Path(self.data_dir) / "CREDENCIALES"),
            filetypes=[("PDF", "*.pdf"), ("Todos los archivos", "*.*")],
        )
        if not path:
            return
        self.pdf_path_var.set(str(Path(path).resolve()))
        self._save_config_from_form()
        self._append_log(f"PDF seleccionado: {path}")

    def _open_pdf(self) -> None:
        raw = (self.pdf_path_var.get() or "").strip()
        if raw.startswith(("http://", "https://")):
            webbrowser.open(raw)
            self._append_log(f"Link de credencial abierto para escaneo: {raw}")
            return
        path = Path(raw)
        if not path.exists():
            messagebox.showwarning("PDF credencial", "Selecciona un PDF de credencial existente.")
            return
        os.startfile(str(path.resolve()))
        self._append_log(f"PDF abierto para escaneo: {path.resolve()}")

    def _open_current_order_on_phone(self) -> None:
        self._save_config_from_form()
        patient = self.paciente_var.get().strip()
        if not patient:
            messagebox.showwarning("Orden celular", "Carga un paciente antes de abrir la orden.")
            return
        try:
            opened = self.controller.tap_order_for_patient(patient, device_serial=self.device_var.get())
            if opened:
                self._append_log(f"Orden abierta en celular para: {patient}")
            else:
                messagebox.showwarning(
                    "Orden celular",
                    "No encontre esa orden visible en la pantalla actual del celular.\n\n"
                    "Deja visible el listado de ordenes de PAMI donde aparezca el paciente.",
                )
        except Exception as exc:
            messagebox.showerror("Orden celular", str(exc))
            self._append_log(f"Error abriendo orden en celular: {exc}")

    def _auto_prepare_current_record(self) -> None:
        self._save_config_from_form()
        patient = self.paciente_var.get().strip()
        if not patient:
            messagebox.showwarning("Auto paciente", "Carga un paciente antes de iniciar.")
            return
        try:
            self._show_qr_for_current_record()
            opened = self.controller.tap_order_for_patient(patient, device_serial=self.device_var.get())
            if not opened:
                raise RuntimeError("No encontre la orden visible del paciente en el celular.")
            time.sleep(1)
            self.controller.prepare_scanner(device_serial=self.device_var.get())
            self._append_log(f"Auto paciente preparado: {patient}")
            self.status_label.configure(
                text="Escaner QR abierto. Monitoreando el celular para detectar la validacion automaticamente."
            )
            self._start_validation_watch()
        except Exception as exc:
            messagebox.showerror("Auto paciente actual", str(exc))
            self._append_log(f"Error en auto paciente actual: {exc}")

    def _start_validation_watch(self, timeout_seconds: int = 70) -> None:
        if self.validation_watch_running:
            return
        self.validation_watch_running = True
        device_serial = self.device_var.get().strip()
        self._append_log("Monitoreo automatico iniciado: esperando 'Orden validada con exito'.")

        def worker() -> None:
            deadline = time.time() + timeout_seconds
            last_text = ""
            while time.time() < deadline and self.validation_watch_running:
                try:
                    screen_text = self.controller.read_screen_text(device_serial=device_serial)
                    last_text = screen_text
                    if self.controller.validation_success_visible(screen_text=screen_text):
                        self.event_queue.put(("auto_validation_success", screen_text))
                        return
                except Exception as exc:
                    self.event_queue.put(("auto_validation_error", str(exc)))
                    return
                time.sleep(1.5)
            if self.validation_watch_running:
                detail = "No se detecto validacion exitosa automaticamente."
                if last_text:
                    detail += " Usa Leer celular si el mensaje sigue visible."
                self.event_queue.put(("auto_validation_timeout", detail))

        threading.Thread(target=worker, daemon=True).start()

    def _handle_auto_validation_success(self, screen_text: str) -> None:
        try:
            details = self.controller.read_order_details(screen_text=screen_text)
            self._apply_order_details(details)
            self._register_validation_result("VALIDADO", observaciones="Detectado automaticamente por pantalla Android")
            self.controller.tap_text("Aceptar", device_serial=self.device_var.get())
            self.status_label.configure(text="Validacion detectada, registrada y aceptada en el celular.")
            self._append_log("Validacion automatica completada y Aceptar enviado al celular.")
        except Exception as exc:
            messagebox.showerror("Validacion automatica", str(exc))
            self._append_log(f"Error registrando validacion automatica: {exc}")

    def _show_qr_for_current_record(self) -> None:
        try:
            pdf_path = self._resolve_current_pdf_path()
            qr_image = self._build_qr_display_image(pdf_path)
            self._show_qr_window(qr_image, pdf_path)
            self._append_log(f"QR mostrado en app desde: {pdf_path}")
        except Exception as exc:
            messagebox.showerror("Mostrar QR app", str(exc))
            self._append_log(f"Error mostrando QR en app: {exc}")

    def _resolve_current_pdf_path(self) -> Path:
        raw = self.pdf_path_var.get().strip()
        if raw and not raw.startswith(("http://", "https://")):
            path = Path(raw)
            if path.exists():
                return path.resolve()

        patient = self.paciente_var.get().strip()
        credentials_dir = Path(self.data_dir) / "CREDENCIALES"
        if not credentials_dir.exists():
            raise RuntimeError(f"No existe la carpeta local de credenciales: {credentials_dir}")
        patient_norm = self._normalize_filename_text(patient)
        matches = []
        for path in credentials_dir.glob("*.pdf"):
            file_norm = self._normalize_filename_text(path.stem)
            if patient_norm and all(part in file_norm for part in patient_norm.split()[:2]):
                matches.append(path)
        if len(matches) == 1:
            return matches[0].resolve()
        if len(matches) > 1:
            matches.sort(key=lambda item: item.stat().st_mtime, reverse=True)
            return matches[0].resolve()
        raise RuntimeError(
            "No encontre el PDF local de la credencial.\n\n"
            "Si el campo tiene link de Drive, primero tiene que existir una copia en CREDENCIALES "
            "o selecciona el PDF manualmente."
        )

    def _build_qr_display_image(self, pdf_path: Path):
        from PIL import Image, ImageOps

        pdftoppm = self._pdftoppm_path()
        cache_dir = Path(tempfile.gettempdir()) / "validacion_ome_qr"
        cache_dir.mkdir(parents=True, exist_ok=True)
        output_base = cache_dir / f"qr_{int(time.time() * 1000)}"
        startupinfo = None
        creationflags = 0
        if hasattr(subprocess, "STARTUPINFO"):
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.run(
            [str(pdftoppm), "-png", "-r", "300", "-f", "1", "-singlefile", str(pdf_path), str(output_base)],
            capture_output=True,
            text=True,
            timeout=25,
            check=True,
            startupinfo=startupinfo,
            creationflags=creationflags,
        )
        page_image_path = output_base.with_suffix(".png")
        if not page_image_path.exists():
            raise RuntimeError("No se pudo renderizar el PDF de credencial.")

        image = Image.open(page_image_path).convert("RGB")
        crop_box = self._detect_qr_crop_box(page_image_path, image.size)
        if crop_box:
            image = image.crop(crop_box)
        image = ImageOps.expand(image, border=40, fill="white")
        image = image.resize((620, 620), Image.Resampling.NEAREST)
        return image

    def _detect_qr_crop_box(self, image_path: Path, image_size: tuple[int, int]) -> tuple[int, int, int, int] | None:
        try:
            import cv2
        except Exception:
            return None
        img = cv2.imread(str(image_path))
        if img is None:
            return None
        detector = cv2.QRCodeDetector()
        _data, points, _straight = detector.detectAndDecode(img)
        if points is None:
            return None
        coords = points.reshape(-1, 2)
        xs = [int(point[0]) for point in coords]
        ys = [int(point[1]) for point in coords]
        margin = 45
        left = max(min(xs) - margin, 0)
        top = max(min(ys) - margin, 0)
        right = min(max(xs) + margin, image_size[0])
        bottom = min(max(ys) + margin, image_size[1])
        if right <= left or bottom <= top:
            return None
        return left, top, right, bottom

    def _show_qr_window(self, image, pdf_path: Path) -> None:
        if self.qr_window is None or not self.qr_window.winfo_exists():
            self.qr_window = ctk.CTkToplevel(self)
            self.qr_window.title("QR credencial - Validacion OME")
            center_toplevel_on_parent(self.qr_window, self.winfo_toplevel(), 760, 760)
            self.qr_window.configure(fg_color="#000000")
            self.qr_window.attributes("-topmost", True)
            self.qr_window.transient(self.winfo_toplevel())
            self.qr_window.grid_columnconfigure(0, weight=1)
            self.qr_window.grid_rowconfigure(1, weight=1)
            self.qr_title_label = ctk.CTkLabel(
                self.qr_window,
                text="QR credencial",
                text_color="#ffffff",
                font=ctk.CTkFont(size=22, weight="bold"),
            )
            self.qr_title_label.grid(row=0, column=0, padx=20, pady=(18, 6), sticky="ew")
            self.qr_image_label = ctk.CTkLabel(self.qr_window, text="")
            self.qr_image_label.grid(row=1, column=0, padx=40, pady=20, sticky="nsew")
        self.qr_ctk_image = ctk.CTkImage(light_image=image, dark_image=image, size=(620, 620))
        self.qr_title_label.configure(text=f"QR credencial | {self.paciente_var.get().strip() or pdf_path.name}")
        self.qr_image_label.configure(image=self.qr_ctk_image, text="")
        center_toplevel_on_parent(self.qr_window, self.winfo_toplevel(), 760, 760)
        self.qr_window.lift()
        self.qr_window.focus_force()

    def _pdftoppm_path(self) -> Path:
        bundled = (
            Path.home()
            / ".cache"
            / "codex-runtimes"
            / "codex-primary-runtime"
            / "dependencies"
            / "native"
            / "poppler"
            / "Library"
            / "bin"
            / "pdftoppm.exe"
        )
        if bundled.exists():
            return bundled
        detected = shutil.which("pdftoppm")
        if detected:
            return Path(detected)
        raise RuntimeError("No encontre pdftoppm para renderizar el PDF.")

    def _normalize_filename_text(self, value: str) -> str:
        normalized = unicodedata.normalize("NFD", str(value or ""))
        without_accents = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
        cleaned = re.sub(r"[^a-zA-Z0-9]+", " ", without_accents).lower()
        return " ".join(cleaned.split())

    def _read_phone_screen(self) -> None:
        self._save_config_from_form()
        try:
            screen_text = self.controller.read_screen_text(device_serial=self.device_var.get())
            self._append_log("Texto Android:")
            self._append_log(screen_text or "(sin texto)")
            if self.controller.validation_success_visible(device_serial=self.device_var.get(), screen_text=screen_text):
                details = self.controller.read_order_details(screen_text=screen_text)
                self._apply_order_details(details)
                self._register_validation_result("VALIDADO", observaciones="Detectado por pantalla Android")
                messagebox.showinfo("Leer celular", "Se detecto 'Orden validada con exito' y se registro como VALIDADO.")
            else:
                self.status_label.configure(text="No se detecto texto de validacion exitosa en la pantalla actual.")
                messagebox.showwarning(
                    "Leer celular",
                    "No se detecto 'Orden validada con exito' en la pantalla actual.\n\n"
                    "Si ya aceptaste el mensaje en el celular, usa Marcar validado.",
                )
        except Exception as exc:
            messagebox.showerror("Leer celular", str(exc))
            self._append_log(f"Error leyendo pantalla Android: {exc}")

    def _load_sheet_records(self) -> None:
        self._save_config_from_form()
        try:
            if is_office_file_url(self.sheet_url_var.get()):
                raise RuntimeError(OFFICE_FILE_MESSAGE)
            start_row = int(self.sheet_start_row_var.get() or "2")
            max_rows = int(self.sheet_max_rows_var.get() or "25")
            self.sheet_records = read_validation_sheet_rows(
                spreadsheet_url_or_id=self.sheet_url_var.get(),
                sheet_name=self.sheet_name_var.get(),
                start_row=start_row,
                max_rows=max_rows,
                credential_column_index=13,
            )
            self.current_record_index = -1
            self.sheet_status_label.configure(text=f"{len(self.sheet_records)} fila(s) con credencial descargada.")
            self._append_log(f"Planilla cargada: {len(self.sheet_records)} fila(s).")
            if self.sheet_records:
                self._load_next_record()
        except Exception as exc:
            messagebox.showerror("Google Sheets", str(exc))
            self._append_log(f"Error cargando planilla: {exc}")

    def _inspect_sheet_records(self) -> None:
        self._save_config_from_form()
        try:
            start_row = int(self.sheet_start_row_var.get() or "2")
            max_rows = int(self.sheet_max_rows_var.get() or "25")
            payload = inspect_validation_sheet_rows(
                spreadsheet_url_or_id=self.sheet_url_var.get(),
                sheet_name=self.sheet_name_var.get(),
                start_row=start_row,
                max_rows=max_rows,
                credential_column_index=13,
            )
            self._append_log(
                f"Diagnostico columna {payload['credential_column']} | "
                f"{payload['sheet_name']} filas {payload['start_row']}-{payload['end_row']} | "
                f"leidas={payload['rows_seen']} | descargadas/link={payload['matches']}"
            )
            for sample in payload["samples"]:
                self._append_log(
                    f"Fila {sample['sheet_row']}: N='{sample['credencial_estado']}' "
                    f"link={'SI' if sample['credencial_link'] else 'NO'} | "
                    f"paciente='{sample['paciente']}' OME='{sample['ome']}'"
                )
            messagebox.showinfo(
                "Diagnostico columna N",
                f"Filas leidas: {payload['rows_seen']}\n"
                f"Con DESCARGADA/link en N: {payload['matches']}\n\n"
                "Revisa la bitacora para ver las primeras filas leidas.",
            )
        except Exception as exc:
            messagebox.showerror("Diagnostico columna N", str(exc))
            self._append_log(f"Error diagnosticando columna N: {exc}")

    def _start_sheets_status_check(self) -> None:
        token_path = get_sheets_token_path()
        if not token_path.exists():
            self.sheets_connected = False
            self.sheets_status_var.set("Google Sheets no conectado")
            return

        def worker() -> None:
            try:
                email = get_connected_google_email(
                    credentials_path=get_gmail_credentials_path(),
                    token_path=token_path,
                    interactive=False,
                )
                self.event_queue.put(("sheets_connected", email or "cuenta Google"))
            except Exception:
                self.event_queue.put(("sheets_status", "Token Sheets encontrado, pero hay que reconectar."))

        threading.Thread(target=worker, daemon=True).start()

    def _connect_sheets_account(self) -> None:
        self._save_config_from_form()
        self.sheets_status_var.set("Conectando Google Sheets...")

        def worker() -> None:
            try:
                email = get_connected_google_email(
                    credentials_path=get_gmail_credentials_path(),
                    token_path=get_sheets_token_path(),
                    interactive=True,
                )
                self.event_queue.put(("sheets_connected", email or "cuenta Google"))
                try:
                    tabs = self._sheet_tabs()
                    self.event_queue.put(("sheet_tabs_loaded", tabs))
                except Exception:
                    pass
            except Exception as exc:
                self.event_queue.put(("sheets_error", str(exc)))

        threading.Thread(target=worker, daemon=True).start()

    def _sheet_tabs(self) -> list[str]:
        sheet_url = normalize_spreadsheet_url(self.sheet_url_var.get().strip())
        if not sheet_url:
            raise RuntimeError("Ingresa la URL de Google Sheets.")
        if is_office_file_url(sheet_url):
            raise RuntimeError(OFFICE_FILE_MESSAGE)
        self.sheet_url_var.set(sheet_url)
        return list_spreadsheet_sheet_names(
            spreadsheet_url_or_id=sheet_url,
            credentials_path=get_gmail_credentials_path(),
            token_path=get_sheets_token_path(),
            interactive=False,
        )

    def _load_sheet_tabs(self) -> None:
        self._save_config_from_form()
        try:
            tabs = self._sheet_tabs()
            self.event_queue.put(("sheet_tabs_loaded", tabs))
        except Exception as exc:
            messagebox.showwarning("Google Sheets", str(exc))

    def _process_ui_queue(self) -> None:
        try:
            while True:
                event, payload = self.event_queue.get_nowait()
                if event == "sheets_connected":
                    self.sheets_connected = True
                    self.sheets_status_var.set(f"Google Sheets conectado: {payload}")
                    self._append_log(f"Google Sheets conectado: {payload}")
                elif event == "sheets_status":
                    self.sheets_connected = False
                    self.sheets_status_var.set(str(payload))
                elif event == "sheets_error":
                    self.sheets_connected = False
                    self.sheets_status_var.set("Google Sheets no conectado")
                    messagebox.showerror("Google Sheets", str(payload))
                    self._append_log(f"Error Sheets: {payload}")
                elif event == "sheet_tabs_loaded":
                    tabs = [str(item).strip() for item in payload if str(item).strip()]
                    self.sheet_tabs = tabs
                    self.sheet_name_combo.configure(values=tabs or [""])
                    current = self.sheet_name_var.get().strip()
                    if tabs and current not in tabs:
                        self.sheet_name_var.set(tabs[0])
                    self._save_config_from_form()
                    self.sheets_status_var.set(f"Pestanas cargadas: {len(tabs)}")
                elif event == "auto_validation_success":
                    self.validation_watch_running = False
                    self._handle_auto_validation_success(str(payload or ""))
                elif event == "auto_validation_timeout":
                    self.validation_watch_running = False
                    self.status_label.configure(text=str(payload))
                    self._append_log(str(payload))
                elif event == "auto_validation_error":
                    self.validation_watch_running = False
                    self.status_label.configure(text=f"Error monitoreando celular: {payload}")
                    self._append_log(f"Error monitoreando celular: {payload}")
        except queue.Empty:
            pass
        self.after(150, self._process_ui_queue)

    def _load_next_record(self) -> None:
        if not self.sheet_records:
            messagebox.showwarning("Lote", "Primero carga la planilla.")
            return
        self.current_record_index += 1
        if self.current_record_index >= len(self.sheet_records):
            self.current_record_index = len(self.sheet_records) - 1
            messagebox.showinfo("Lote", "No quedan mas registros cargados.")
            return
        record = self.sheet_records[self.current_record_index]
        self.paciente_var.set(record.get("paciente", ""))
        self.beneficio_var.set(record.get("beneficio", ""))
        self.ome_var.set(record.get("ome", ""))
        self.pdf_path_var.set(record.get("credencial_url", ""))
        self.sheet_status_label.configure(
            text=f"Fila {record.get('sheet_row')} ({self.current_record_index + 1}/{len(self.sheet_records)})"
        )
        self._save_config_from_form()
        self._append_log(
            f"Registro cargado: fila {record.get('sheet_row')} | "
            f"{record.get('paciente') or '-'} | OME={record.get('ome') or '-'}"
        )

    def _prepare_scan_on_phone(self) -> None:
        try:
            if self.controller.tap_text("Validar prestación", device_serial=self.device_var.get()) or self.controller.tap_text(
                "Validar prestacion", device_serial=self.device_var.get()
            ):
                time.sleep(0.8)
            self.controller.tap_text("Escanear QR", device_serial=self.device_var.get())
            self._append_log("Se intento preparar la pantalla de escaneo en el celular.")
        except Exception as exc:
            messagebox.showerror("Preparar escaneo", str(exc))
            self._append_log(f"Error preparando escaneo: {exc}")

    def _tap_accept_on_phone(self) -> None:
        try:
            if self.controller.tap_text("Aceptar", device_serial=self.device_var.get()):
                self._append_log("Aceptar enviado al celular.")
            else:
                self._append_log("No se encontro boton Aceptar en el celular.")
        except Exception as exc:
            messagebox.showerror("Aceptar celular", str(exc))
            self._append_log(f"Error tocando Aceptar: {exc}")

    def _apply_order_details(self, details: dict) -> None:
        paciente = str(details.get("paciente") or "").strip()
        beneficio = str(details.get("beneficio") or "").strip()
        ome = str(details.get("ome") or "").strip()
        if paciente:
            self.paciente_var.set(paciente)
        if beneficio:
            self.beneficio_var.set(beneficio)
        if ome:
            self.ome_var.set(ome)
        if any((paciente, beneficio, ome)):
            self._append_log(
                f"Datos leidos de orden: paciente={paciente or '-'} | "
                f"OME={ome or '-'} | BENEF={beneficio or '-'}"
            )

    def _mark_sheet_validated(self, estado: str) -> str:
        if estado != "VALIDADO":
            return ""
        sheet_url = normalize_spreadsheet_url(self.sheet_url_var.get().strip())
        sheet_name = self.sheet_name_var.get().strip()
        if not sheet_url or not sheet_name:
            return "Sheets no actualizado: falta URL o pestana."
        payload = mark_validation_sheet_row(
            spreadsheet_url_or_id=sheet_url,
            sheet_name=sheet_name,
            ome=self.ome_var.get().strip(),
            beneficio=self.beneficio_var.get().strip(),
            value="SI",
            validation_column=self.sheet_validation_col_var.get().strip() or "O",
        )
        return (
            f"Sheets actualizado: {payload['sheet_name']} "
            f"{payload['validation_column']}{payload['sheet_row']}={payload['value']}"
        )

    def _register_validation_result(self, estado: str, observaciones: str = "") -> None:
        sheet_observacion = ""
        try:
            if estado == "VALIDADO":
                try:
                    details = self.controller.read_order_details(device_serial=self.device_var.get())
                    self._apply_order_details(details)
                except Exception as exc:
                    self._append_log(f"No se pudieron refrescar datos desde Android antes de marcar: {exc}")
                sheet_observacion = self._mark_sheet_validated(estado)
                if sheet_observacion:
                    self._append_log(sheet_observacion)
        except Exception as exc:
            sheet_observacion = f"Sheets no actualizado: {exc}"
            self._append_log(sheet_observacion)

        combined_observaciones = observaciones
        if sheet_observacion:
            combined_observaciones = f"{observaciones} | {sheet_observacion}".strip(" |")
        row = {
            "fecha_hora": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
            "paciente": self.paciente_var.get().strip(),
            "beneficio": self.beneficio_var.get().strip(),
            "ome": self.ome_var.get().strip(),
            "estado": estado,
            "pdf_credencial": self.pdf_path_var.get().strip(),
            "observaciones": combined_observaciones,
        }
        if 0 <= self.current_record_index < len(self.sheet_records):
            record = self.sheet_records[self.current_record_index]
            row["sheet_row"] = record.get("sheet_row", "")
            row["sheet_name"] = record.get("sheet_name", "")
        self.validation_rows.append(row)
        self._append_log(f"Resultado registrado: {estado} | OME={row['ome'] or '-'} | BENEF={row['beneficio'] or '-'}")
        self._export_report(silent=True)

    def _export_report(self, silent: bool = False) -> None:
        self.report_file.parent.mkdir(parents=True, exist_ok=True)
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Validaciones"
        headers = ["fecha_hora", "sheet_name", "sheet_row", "paciente", "beneficio", "ome", "estado", "pdf_credencial", "observaciones"]
        sheet.append(headers)
        for row in self.validation_rows:
            sheet.append([row.get(header, "") for header in headers])
        workbook.save(self.report_file)
        self.status_label.configure(text=f"Reporte actualizado: {self.report_file}")
        if not silent:
            messagebox.showinfo("Reporte", f"Reporte guardado en:\n{self.report_file}")
        self._append_log(f"Reporte actualizado: {self.report_file}")

    def _set_status(self, text: str) -> None:
        self.status_label.configure(text=text)

    def _append_log(self, text: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", text + "\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _go_home(self) -> None:
        if self.on_back:
            self.on_back()

    def on_close(self) -> None:
        self._save_config_from_form()
