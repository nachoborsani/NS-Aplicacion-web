import json
import os
import queue
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox

import customtkinter as ctk

from app_credentials import sync_profile_payload, upsert_shared_credentials_from_payload
from app_logging import log_message
from app_paths import get_data_dir, get_log_file
from app_settings import VERIFICAR_OMES_COMBOS, load_verificar_omes_config, save_verificar_omes_config
from app_transmision import DatePickerDialog
from pami_verificar import (
    PamiVerificarController,
    build_default_report_path,
    generar_reporte,
    get_clientes_verificacion,
)


class VerificarFrame(ctk.CTkFrame):
    def __init__(self, master, on_back=None, on_restart=None) -> None:
        super().__init__(master, fg_color="transparent")
        self.on_back = on_back
        self.on_restart = on_restart

        self.event_queue: queue.Queue = queue.Queue()
        self.respuesta_queue: queue.Queue = queue.Queue()
        self.action_running = False
        self.password_visible = False
        self.data_dir = get_data_dir()
        self.profiles_file = Path(self.data_dir) / "usuarios_verificar.json"
        self.saved_profiles = self._load_saved_profiles()
        self.clientes_verificacion = get_clientes_verificacion()
        self.cliente_verificacion_var = ctk.StringVar(
            value=self.clientes_verificacion[0]["nombre"] if self.clientes_verificacion else ""
        )
        self.modo_verificacion_var = ctk.StringVar(value="Control futuro")
        self.ruta_excel: Path | None = None
        self.controller: PamiVerificarController | None = None
        self.omes_por_key: dict[str, list] = {}
        self.pacientes: list[dict] = []
        self.procesados = 0
        self.total_pacientes = 0
        self.reporte_guardado: Path | None = None
        self.modo_reporte_codigo = "futuro"
        self.resume_available = False
        self.started_at: float | None = None
        self.navegador_visible_var = ctk.BooleanVar(value=True)
        self.auto_guardar_var = ctk.BooleanVar(value=False)
        self.verificar_omes_config = load_verificar_omes_config()
        combo_config = self.verificar_omes_config.get("combos", {})
        self.combo_vars = {
            item["key"]: ctk.BooleanVar(value=bool(combo_config.get(item["key"], True)))
            for item in VERIFICAR_OMES_COMBOS
        }
        self.combo_lesiones_var = self.combo_vars["lesiones"]
        self.combo_checkboxes: list[ctk.CTkCheckBox] = []
        self.ruta_auto_guardado: Path | None = None

        self._build_ui()
        self._load_initial_profile_into_form()
        self.after(150, self._process_ui_queue)

    def _build_ui(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        top_bar = ctk.CTkFrame(self, corner_radius=8, fg_color="#f7fafc", border_width=1, border_color="#d8e2ec")
        top_bar.grid(row=0, column=0, padx=8, pady=(6, 4), sticky="ew")
        top_bar.grid_columnconfigure(1, weight=1)

        if self.on_back:
            ctk.CTkButton(
                top_bar,
                text="Volver",
                width=78,
                command=self._go_home,
                fg_color="#9aafc3",
                hover_color="#7f95aa",
            ).grid(row=0, column=0, rowspan=2, padx=(8, 10), pady=6, sticky="w")

        self.restart_button = ctk.CTkButton(
            top_bar,
            text="Reiniciar app",
            command=self._restart_app,
            width=120,
            fg_color="#4f6378",
            hover_color="#3d4d61",
        )
        self.restart_button.grid(row=0, column=2, rowspan=2, padx=(8, 10), pady=6, sticky="e")

        ctk.CTkLabel(
            top_bar,
            text="Verificar OMEs PAMI",
            font=ctk.CTkFont(size=20, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=1, padx=10, pady=(6, 1), sticky="w")

        ctk.CTkLabel(
            top_bar,
            text="Cruza turnos CIMA contra el panel de ordenes medicas y prepara un Excel de control.",
            font=ctk.CTkFont(size=11),
            text_color="#51657a",
        ).grid(row=1, column=1, padx=10, pady=(0, 6), sticky="w")

        content = ctk.CTkScrollableFrame(self, corner_radius=8, fg_color="#ffffff")
        content.grid(row=1, column=0, padx=8, pady=(0, 8), sticky="nsew")
        content.grid_columnconfigure(0, weight=1)

        file_frame = ctk.CTkFrame(content, corner_radius=8, fg_color="#f4f8fb", border_width=1, border_color="#d8e2ec")
        file_frame.grid(row=0, column=0, padx=8, pady=(0, 4), sticky="ew")
        file_frame.grid_columnconfigure(4, weight=1)

        ctk.CTkLabel(
            file_frame,
            text="Cliente de verificacion",
            font=ctk.CTkFont(size=13, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=12, pady=(10, 8), sticky="w")

        self.cliente_verificacion_combo = ctk.CTkComboBox(
            file_frame,
            values=[cliente["nombre"] for cliente in self.clientes_verificacion] or ["CIMA / Ceintramed"],
            variable=self.cliente_verificacion_var,
            width=220,
            command=lambda _choice: self._actualizar_cliente_verificacion(),
        )
        self.cliente_verificacion_combo.grid(row=0, column=1, padx=(0, 12), pady=(10, 8), sticky="w")

        ctk.CTkLabel(
            file_frame,
            text="Modo",
            font=ctk.CTkFont(size=13, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=2, padx=(8, 8), pady=(10, 8), sticky="w")

        self.modo_verificacion_combo = ctk.CTkComboBox(
            file_frame,
            values=["Control futuro", "Auditoria de prestaciones"],
            variable=self.modo_verificacion_var,
            width=220,
        )
        self.modo_verificacion_combo.grid(row=0, column=3, padx=(0, 12), pady=(10, 8), sticky="w")

        self.excel_title_label = ctk.CTkLabel(
            file_frame,
            text="Excel de turnos CIMA",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color="#16324f",
        )
        self.excel_title_label.grid(row=1, column=0, columnspan=2, padx=12, pady=(2, 8), sticky="w")

        self.select_file_button = ctk.CTkButton(
            file_frame,
            text="Seleccionar Excel",
            command=self._select_excel,
            width=150,
            fg_color="#4f6378",
            hover_color="#3d4d61",
        )
        self.select_file_button.grid(row=2, column=0, padx=12, pady=(0, 12), sticky="w")

        self.file_label = ctk.CTkLabel(
            file_frame,
            text="Sin archivo seleccionado",
            font=ctk.CTkFont(size=12),
            text_color="#51657a",
            wraplength=900,
        )
        self.file_label.grid(row=2, column=1, padx=(0, 12), pady=(0, 12), sticky="w")

        dates_row = ctk.CTkFrame(file_frame, fg_color="transparent")
        dates_row.grid(row=3, column=0, columnspan=2, padx=12, pady=(0, 12), sticky="w")

        ctk.CTkLabel(
            dates_row,
            text="Fecha desde",
            font=ctk.CTkFont(size=13, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=(0, 8), sticky="w")

        self.fecha_desde_var = ctk.StringVar(value="")
        self.fecha_desde_entry = ctk.CTkEntry(
            dates_row,
            textvariable=self.fecha_desde_var,
            placeholder_text="DD/MM/YYYY",
            width=130,
            state="readonly",
        )
        self.fecha_desde_entry.grid(row=0, column=1, padx=(0, 18), sticky="w")
        self.fecha_desde_entry.bind("<Button-1>", lambda _event: self._pick_filter_date(self.fecha_desde_var), add="+")

        self.fecha_desde_button = ctk.CTkButton(
            dates_row,
            text="...",
            width=36,
            height=30,
            command=lambda: self._pick_filter_date(self.fecha_desde_var),
        )
        self.fecha_desde_button.grid(row=0, column=1, padx=(136, 18), sticky="w")

        ctk.CTkLabel(
            dates_row,
            text="Fecha hasta",
            font=ctk.CTkFont(size=13, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=2, padx=(0, 8), sticky="w")

        self.fecha_hasta_var = ctk.StringVar(value="")
        self.fecha_hasta_entry = ctk.CTkEntry(
            dates_row,
            textvariable=self.fecha_hasta_var,
            placeholder_text="DD/MM/YYYY",
            width=130,
            state="readonly",
        )
        self.fecha_hasta_entry.grid(row=0, column=3, padx=(0, 12), sticky="w")
        self.fecha_hasta_entry.bind(
            "<Button-1>",
            lambda _event: self._pick_filter_date(self.fecha_hasta_var, fallback_var=self.fecha_desde_var),
            add="+",
        )

        self.fecha_hasta_button = ctk.CTkButton(
            dates_row,
            text="...",
            width=36,
            height=30,
            command=lambda: self._pick_filter_date(self.fecha_hasta_var, fallback_var=self.fecha_desde_var),
        )
        self.fecha_hasta_button.grid(row=0, column=3, padx=(136, 12), sticky="w")

        profiles_frame = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        profiles_frame.grid(row=1, column=0, padx=14, pady=(0, 6), sticky="ew")
        profiles_frame.grid_columnconfigure(1, weight=0)
        profiles_frame.grid_columnconfigure(4, weight=1)

        profile_options = self._profile_options()
        self.profile_var = ctk.StringVar(value=profile_options[0] if profile_options else "")
        self.profile_name_var = ctk.StringVar(value="")
        self.profile_user_var = ctk.StringVar(value="")
        self.profile_password_var = ctk.StringVar(value="")

        ctk.CTkLabel(
            profiles_frame,
            text="Perfil guardado",
            font=ctk.CTkFont(size=13, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=(12, 8), pady=10, sticky="w")

        self.profile_combo = ctk.CTkComboBox(
            profiles_frame,
            values=profile_options or [""],
            variable=self.profile_var,
            width=220,
            command=self._on_profile_selected,
        )
        self.profile_combo.grid(row=0, column=1, padx=8, pady=8, sticky="w")

        self.new_profile_button = ctk.CTkButton(
            profiles_frame,
            text="Agregar perfil",
            command=self._new_profile,
            width=120,
            height=32,
            fg_color="#3d84c6",
            hover_color="#2d6ca6",
        )
        self.new_profile_button.grid(row=0, column=2, padx=8, pady=8, sticky="w")

        self.delete_profile_button = ctk.CTkButton(
            profiles_frame,
            text="Eliminar perfil",
            command=self._delete_current_profile,
            width=120,
            height=32,
            fg_color="#9aafc3",
            hover_color="#7f95aa",
        )
        self.delete_profile_button.grid(row=0, column=3, padx=(8, 12), pady=8, sticky="w")

        ctk.CTkLabel(
            profiles_frame,
            text="Cliente",
            font=ctk.CTkFont(size=13, weight="bold"),
            text_color="#16324f",
        ).grid(row=1, column=0, padx=(12, 8), pady=(0, 8), sticky="w")

        self.client_entry = ctk.CTkEntry(
            profiles_frame,
            textvariable=self.profile_name_var,
            placeholder_text="Nombre del cliente o centro",
            width=360,
        )
        self.client_entry.grid(row=1, column=1, padx=8, pady=(0, 8), sticky="w")

        self.save_profile_button = ctk.CTkButton(
            profiles_frame,
            text="Guardar perfil",
            command=self._save_current_profile,
            width=120,
            height=32,
            fg_color="#4f6378",
            hover_color="#3d4d61",
        )
        self.save_profile_button.grid(row=1, column=2, padx=8, pady=(0, 8), sticky="w")

        credentials_row = ctk.CTkFrame(profiles_frame, fg_color="transparent")
        credentials_row.grid(row=2, column=1, columnspan=3, padx=8, pady=(0, 10), sticky="ew")

        ctk.CTkLabel(
            credentials_row,
            text="Usuario",
            font=ctk.CTkFont(size=13, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=(0, 8), sticky="w")

        self.user_entry = ctk.CTkEntry(
            credentials_row,
            textvariable=self.profile_user_var,
            placeholder_text="Usuario PAMI",
            width=190,
        )
        self.user_entry.grid(row=0, column=1, padx=(0, 10), sticky="w")

        ctk.CTkLabel(
            credentials_row,
            text="Clave",
            font=ctk.CTkFont(size=13, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=2, padx=(0, 8), sticky="w")

        self.password_entry = ctk.CTkEntry(
            credentials_row,
            textvariable=self.profile_password_var,
            placeholder_text="Clave PAMI",
            show="*",
            width=190,
        )
        self.password_entry.grid(row=0, column=3, padx=(0, 10), sticky="w")

        self.toggle_password_button = ctk.CTkButton(
            credentials_row,
            text="Ver / Ocultar",
            command=self._toggle_password,
            width=120,
            height=32,
            fg_color="#6d7f90",
            hover_color="#58697a",
        )
        self.toggle_password_button.grid(row=0, column=4, sticky="w")

        actions_frame = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        actions_frame.grid(row=2, column=0, padx=14, pady=(0, 6), sticky="ew")
        actions_frame.grid_columnconfigure(6, weight=0)
        actions_frame.grid_columnconfigure(7, weight=1)

        self.start_button = ctk.CTkButton(
            actions_frame,
            text="Iniciar verificacion",
            command=self._start_verification,
            width=170,
            height=38,
            fg_color="#2f9e44",
            hover_color="#25833a",
            font=ctk.CTkFont(size=14, weight="bold"),
            state="disabled",
        )
        self.start_button.grid(row=0, column=0, padx=(12, 8), pady=12, sticky="w")

        self.stop_button = ctk.CTkButton(
            actions_frame,
            text="Detener",
            command=self._stop_verification,
            width=110,
            height=38,
            fg_color="#c92a2a",
            hover_color="#a61e1e",
            state="disabled",
        )
        self.stop_button.grid(row=0, column=1, padx=8, pady=12, sticky="w")

        self.resume_button = ctk.CTkButton(
            actions_frame,
            text="Reanudar",
            command=self._resume_verification,
            width=120,
            height=38,
            fg_color="#3d84c6",
            hover_color="#2d6ca6",
            state="disabled",
        )
        self.resume_button.grid(row=0, column=2, padx=8, pady=12, sticky="w")

        self.save_report_button = ctk.CTkButton(
            actions_frame,
            text="Guardar Excel",
            command=self._save_report,
            width=140,
            height=38,
            fg_color="#4f6378",
            hover_color="#3d4d61",
            state="disabled",
        )
        self.save_report_button.grid(row=0, column=3, padx=8, pady=12, sticky="w")

        self.open_report_button = ctk.CTkButton(
            actions_frame,
            text="Abrir Excel",
            command=self._open_saved_report,
            width=130,
            height=38,
            fg_color="#4f6378",
            hover_color="#3d4d61",
            state="disabled",
        )
        self.open_report_button.grid(row=0, column=4, padx=8, pady=12, sticky="w")

        self.browser_visible_checkbox = ctk.CTkCheckBox(
            actions_frame,
            text="Ver navegador",
            variable=self.navegador_visible_var,
            onvalue=True,
            offvalue=False,
            text_color="#16324f",
        )
        self.browser_visible_checkbox.grid(row=0, column=5, padx=8, pady=12, sticky="w")

        self.auto_save_checkbox = ctk.CTkCheckBox(
            actions_frame,
            text="Guardar automaticamente al finalizar",
            variable=self.auto_guardar_var,
            command=self._toggle_auto_guardado,
            onvalue=True,
            offvalue=False,
            text_color="#16324f",
        )
        self.auto_save_checkbox.grid(row=1, column=0, columnspan=2, padx=(12, 8), pady=(0, 12), sticky="w")

        self.auto_save_destination_button = ctk.CTkButton(
            actions_frame,
            text="Elegir destino",
            command=self._select_auto_save_destination,
            width=120,
            height=30,
            fg_color="#4f6378",
            hover_color="#3d4d61",
        )
        self.auto_save_destination_button.grid(row=1, column=2, padx=8, pady=(0, 12), sticky="w")

        self.auto_save_path_label = ctk.CTkLabel(
            actions_frame,
            text="Sin destino seleccionado",
            font=ctk.CTkFont(size=12),
            text_color="#51657a",
            anchor="w",
        )
        self.auto_save_path_label.grid(
            row=1,
            column=3,
            columnspan=4,
            padx=(8, 12),
            pady=(0, 12),
            sticky="ew",
        )

        self.combos_frame = ctk.CTkFrame(actions_frame, fg_color="transparent")
        self.combos_frame.grid(row=2, column=0, columnspan=7, padx=(12, 12), pady=(0, 12), sticky="ew")
        for col in range(4):
            self.combos_frame.grid_columnconfigure(col, weight=1)

        for idx, item in enumerate(VERIFICAR_OMES_COMBOS):
            checkbox = ctk.CTkCheckBox(
                self.combos_frame,
                text=item["label"],
                variable=self.combo_vars[item["key"]],
                command=self._save_verificar_omes_options,
                onvalue=True,
                offvalue=False,
                text_color="#16324f",
            )
            checkbox.grid(row=idx // 4, column=idx % 4, padx=(0, 12), pady=(0, 6), sticky="w")
            self.combo_checkboxes.append(checkbox)

        self.combo_lesiones_checkbox = self.combo_checkboxes[0]

        self.status_label = ctk.CTkLabel(
            actions_frame,
            text=f"Log en: {get_log_file()}",
            font=ctk.CTkFont(size=12),
            text_color="#51657a",
        )
        self.status_label.grid(row=0, column=6, padx=(8, 12), pady=12, sticky="w")

        progress_frame = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        progress_frame.grid(row=3, column=0, padx=14, pady=(0, 6), sticky="ew")
        progress_frame.grid_columnconfigure(0, weight=1)

        self.progress_bar = ctk.CTkProgressBar(progress_frame)
        self.progress_bar.grid(row=0, column=0, padx=12, pady=(12, 6), sticky="ew")
        self.progress_bar.set(0)

        self.progress_label = ctk.CTkLabel(
            progress_frame,
            text="Pacientes procesados: 0/0",
            font=ctk.CTkFont(size=12),
            text_color="#51657a",
        )
        self.progress_label.grid(row=1, column=0, padx=12, pady=(0, 12), sticky="w")

        log_frame = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        log_frame.grid(row=4, column=0, padx=14, pady=(0, 12), sticky="nsew")
        log_frame.grid_columnconfigure(0, weight=1)
        log_frame.grid_rowconfigure(1, weight=1)

        ctk.CTkLabel(
            log_frame,
            text="Log de verificacion",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=12, pady=(10, 8), sticky="w")

        self.log_text = ctk.CTkTextbox(log_frame, height=260, wrap="word")
        self.log_text.grid(row=1, column=0, padx=12, pady=(0, 12), sticky="nsew")
        self.log_text.configure(state="disabled")

    def _cliente_verificacion_codigo(self) -> str:
        nombre = self.cliente_verificacion_var.get()
        for cliente in self.clientes_verificacion:
            if cliente.get("nombre") == nombre:
                return cliente.get("codigo", "cima")
        return "cima"

    def _cliente_verificacion_actual(self) -> dict:
        codigo = self._cliente_verificacion_codigo()
        for cliente in self.clientes_verificacion:
            if cliente.get("codigo") == codigo:
                return cliente
        return {"codigo": "cima", "nombre": "CIMA / Ceintramed", "excel_label": "Excel de turnos CIMA"}

    def _actualizar_cliente_verificacion(self) -> None:
        cliente = self._cliente_verificacion_actual()
        self.excel_title_label.configure(text=cliente.get("excel_label", "Excel de turnos"))
        self._seleccionar_perfil_para_cliente(cliente.get("codigo", "cima"))

    def _select_excel(self) -> None:
        cliente = self._cliente_verificacion_actual()
        ruta = filedialog.askopenfilename(
            title=f"Seleccionar {cliente.get('excel_label', 'Excel de turnos')}",
            filetypes=[("Excel", "*.xlsx *.xlsm *.xls"), ("Todos los archivos", "*.*")],
        )
        if not ruta:
            return
        self.ruta_excel = Path(ruta)
        self.file_label.configure(text=str(self.ruta_excel))
        self._refresh_start_button_state()

    def _start_verification(self, resume: bool = False) -> None:
        if self.action_running:
            return
        if not self.ruta_excel:
            messagebox.showwarning("Verificar OMEs", "Selecciona el Excel de turnos CIMA antes de iniciar.")
            return
        if not self.ruta_excel.exists():
            messagebox.showerror("Verificar OMEs", "El archivo seleccionado no existe.")
            return
        if not self._validar_rango_fechas():
            return
        if self.auto_guardar_var.get() and not self.ruta_auto_guardado:
            if not self._select_auto_save_destination():
                messagebox.showwarning(
                    "Guardado automatico",
                    "Selecciona donde guardar el Excel o desactiva el guardado automatico.",
                )
                return

        self._save_verificar_omes_options()
        self._save_current_profile(show_message=False)
        self.omes_por_key = {}
        self.pacientes = []
        self.procesados = 0
        self.total_pacientes = 0
        self.reporte_guardado = None
        self.modo_reporte_codigo = self._modo_verificacion_codigo()
        self.resume_available = False
        self.started_at = time.monotonic()
        self._set_progress(0, 0)
        self._set_report_enabled(False)
        self._set_open_report_enabled(False)
        if not resume:
            self._clear_log()

        self.controller = PamiVerificarController(
            usuario=self.profile_user_var.get().strip(),
            clave=self.profile_password_var.get(),
            log_callback=self._push_log,
            resultado_callback=self._push_result,
            progreso_callback=self._push_progress_event,
            respuesta_queue=self.respuesta_queue,
            navegador_visible=self.navegador_visible_var.get(),
        )

        fecha_hoy = datetime.now().strftime("%Y-%m-%d")
        self.action_running = True
        self._set_controls_running(True)
        self.status_label.configure(text="Verificacion en curso.")
        self.controller.iniciar(
            self.ruta_excel,
            fecha_hoy,
            fecha_desde=self.fecha_desde_var.get().strip() or None,
            fecha_hasta=self.fecha_hasta_var.get().strip() or None,
            retomar_progreso=True if resume else None,
            cliente_codigo=self._cliente_verificacion_codigo(),
            modo_verificacion=self._modo_verificacion_codigo(),
        )

    def _resume_verification(self) -> None:
        self._start_verification(resume=True)

    def _modo_verificacion_codigo(self) -> str:
        modo = self.modo_verificacion_var.get().strip().lower()
        if "auditoria" in modo:
            return "auditoria"
        return "futuro"

    def _stop_verification(self) -> None:
        if self.controller:
            self.controller.detener()
        self.stop_button.configure(state="disabled")

    def _save_report(self) -> None:
        if not self.controller:
            return
        cliente_codigo = self._cliente_verificacion_codigo()
        default_path = build_default_report_path(cliente_codigo)
        ruta = filedialog.asksaveasfilename(
            title="Guardar reporte de verificacion",
            initialdir=str(default_path.parent),
            initialfile=default_path.name,
            defaultextension=".xlsx",
            filetypes=[("Excel", "*.xlsx")],
        )
        if not ruta:
            return
        self._generate_report(Path(ruta), show_message=True)

    def _generate_report(self, ruta: Path, show_message: bool = False) -> Path | None:
        try:
            ruta.parent.mkdir(parents=True, exist_ok=True)
            salida = generar_reporte(
                self.pacientes,
                self.omes_por_key,
                ruta,
                cliente_codigo=self._cliente_verificacion_codigo(),
                modo_verificacion=self.modo_reporte_codigo,
            )
            self.reporte_guardado = salida
            self._push_log(f"Reporte guardado en {salida}")
            self._set_open_report_enabled(True)
            if show_message:
                messagebox.showinfo("Reporte guardado", f"Excel generado:\n{salida}")
            return salida
        except Exception as exc:
            log_message(f"Error generando reporte de verificacion: {exc}")
            messagebox.showerror("Guardar Excel", str(exc))
            return None

    def _toggle_auto_guardado(self) -> None:
        if self.auto_guardar_var.get() and not self.ruta_auto_guardado:
            if not self._select_auto_save_destination():
                self.auto_guardar_var.set(False)

    def _save_verificar_omes_options(self) -> None:
        combos = {key: bool(var.get()) for key, var in self.combo_vars.items()}
        self.verificar_omes_config = save_verificar_omes_config(
            {"combos": combos}
        )
        combo_config = self.verificar_omes_config.get("combos", {})
        for key, var in self.combo_vars.items():
            var.set(bool(combo_config.get(key, True)))

    def _select_auto_save_destination(self) -> bool:
        if self.action_running:
            return False
        default_path = build_default_report_path(self._cliente_verificacion_codigo())
        ruta = filedialog.asksaveasfilename(
            title="Destino del guardado automatico",
            initialdir=str(
                self.ruta_auto_guardado.parent if self.ruta_auto_guardado else default_path.parent
            ),
            initialfile=(self.ruta_auto_guardado.name if self.ruta_auto_guardado else default_path.name),
            defaultextension=".xlsx",
            filetypes=[("Excel", "*.xlsx")],
        )
        if not ruta:
            return False
        self.ruta_auto_guardado = Path(ruta)
        self.auto_guardar_var.set(True)
        self.auto_save_path_label.configure(text=str(self.ruta_auto_guardado))
        return True

    def _open_saved_report(self) -> None:
        if not self.reporte_guardado or not self.reporte_guardado.exists():
            messagebox.showwarning("Abrir Excel", "Todavia no hay un reporte guardado para abrir.")
            self._set_open_report_enabled(False)
            return
        try:
            os.startfile(str(self.reporte_guardado))
        except Exception as exc:
            log_message(f"Error abriendo reporte de verificacion: {exc}")
            messagebox.showerror("Abrir Excel", f"No se pudo abrir el Excel:\n{exc}")

    def _push_log(self, message: str) -> None:
        self.event_queue.put(("log", message))

    def _push_result(self, key: str, omes: list) -> None:
        self.event_queue.put(("result", {"key": key, "omes": omes}))

    def _push_progress_event(self, payload: dict) -> None:
        self.event_queue.put(("progress_event", payload))

    def _process_ui_queue(self) -> None:
        had_events = False
        try:
            while True:
                event, payload = self.event_queue.get_nowait()
                had_events = True
                if event == "log":
                    self._append_log(payload)
                    if str(payload).startswith("Pacientes PAMI encontrados:"):
                        try:
                            total = int(str(payload).split(":", 1)[1].strip())
                            self.total_pacientes = total
                            self._set_progress(self.procesados, self.total_pacientes)
                        except Exception:
                            pass
                elif event == "result":
                    key = payload["key"]
                    self.omes_por_key[key] = payload["omes"]
                    self.procesados += 1
                    self._set_progress(self.procesados, self.total_pacientes)
                elif event == "progress_event":
                    if payload.get("type") == "resume_prompt":
                        self._show_resume_dialog(payload)
        except queue.Empty:
            pass

        if self.action_running and self.controller:
            if self.controller.pacientes and not self.pacientes:
                self.pacientes = self.controller.pacientes
                self.total_pacientes = len(self.pacientes)
                self._set_progress(self.procesados, self.total_pacientes)

            if self.controller.completed or self.controller.error:
                self.action_running = False
                self._set_controls_running(False)
                if self.controller.error:
                    self.status_label.configure(text="Ocurrio un error.")
                    messagebox.showerror("Verificar OMEs", self.controller.error)
                elif self.controller.stopped:
                    self.pacientes = self.controller.pacientes
                    self.status_label.configure(text="Verificacion detenida. Puedes reanudar.")
                    self.resume_available = True
                    self._set_report_enabled(bool(self.pacientes))
                    self.resume_button.configure(state="normal" if self._excel_ready() else "disabled")
                else:
                    self.pacientes = self.controller.pacientes
                    self.resume_available = False
                    self.resume_button.configure(state="disabled")
                    self._set_report_enabled(bool(self.pacientes))
                    if self.auto_guardar_var.get() and self.ruta_auto_guardado and self.pacientes:
                        salida = self._generate_report(self.ruta_auto_guardado)
                        if salida:
                            self.status_label.configure(text=f"Verificacion finalizada. Excel guardado en {salida}")
                            messagebox.showinfo(
                                "Verificacion finalizada",
                                f"El cruce termino y el Excel se guardo automaticamente en:\n{salida}",
                            )
                        else:
                            self.status_label.configure(text="Verificacion finalizada. Fallo el guardado automatico.")
                    else:
                        self.status_label.configure(text=f"Verificacion finalizada. Log en: {get_log_file()}")
                        messagebox.showinfo(
                            "Verificacion finalizada",
                            "El cruce termino. Ya puedes guardar el Excel.",
                        )

        delay = 120 if (self.action_running or had_events) else 350
        self.after(delay, self._process_ui_queue)

    def _append_log(self, message: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", str(message) + "\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _clear_log(self) -> None:
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.configure(state="disabled")

    def _set_progress(self, current: int, total: int) -> None:
        detalle_tiempo = self._format_time_progress(current, total)
        suffix = f" | {detalle_tiempo}" if detalle_tiempo else ""
        self.progress_label.configure(text=f"Pacientes procesados: {current}/{total}{suffix}")
        self.progress_bar.set(0 if total <= 0 else min(current / total, 1))

    def _format_time_progress(self, current: int, total: int) -> str:
        if not self.started_at or current <= 0:
            return ""
        elapsed = max(time.monotonic() - self.started_at, 0)
        avg = elapsed / current
        remaining = max(total - current, 0) * avg if total else 0
        return f"Transcurrido: {self._format_duration(elapsed)} | Estimado restante: {self._format_duration(remaining)}"

    def _format_duration(self, seconds: float) -> str:
        seconds = max(int(seconds), 0)
        hours, rem = divmod(seconds, 3600)
        minutes, secs = divmod(rem, 60)
        if hours:
            return f"{hours}h {minutes:02d}m"
        if minutes:
            return f"{minutes}m {secs:02d}s"
        return f"{secs}s"

    def _set_controls_running(self, running: bool) -> None:
        state = "disabled" if running else "normal"
        self.select_file_button.configure(state=state)
        self.start_button.configure(state="disabled" if running or not self._excel_ready() else "normal")
        self.resume_button.configure(state="disabled" if running or not self.resume_available or not self._excel_ready() else "normal")
        self.profile_combo.configure(state=state)
        self.cliente_verificacion_combo.configure(state=state)
        self.modo_verificacion_combo.configure(state=state)
        self.new_profile_button.configure(state=state)
        self.delete_profile_button.configure(state=state)
        self.save_profile_button.configure(state=state)
        self.client_entry.configure(state=state)
        self.user_entry.configure(state=state)
        self.password_entry.configure(state=state)
        self.toggle_password_button.configure(state=state)
        self.browser_visible_checkbox.configure(state=state)
        self.auto_save_checkbox.configure(state=state)
        self.auto_save_destination_button.configure(state=state)
        for checkbox in self.combo_checkboxes:
            checkbox.configure(state=state)
        self.restart_button.configure(state=state)
        self.fecha_desde_entry.configure(state="disabled" if running else "readonly")
        self.fecha_hasta_entry.configure(state="disabled" if running else "readonly")
        self.fecha_desde_button.configure(state=state)
        self.fecha_hasta_button.configure(state=state)
        self.stop_button.configure(state="normal" if running else "disabled")
        self._set_open_report_enabled(not running and bool(self.reporte_guardado and self.reporte_guardado.exists()))

    def _set_report_enabled(self, enabled: bool) -> None:
        self.save_report_button.configure(state="normal" if enabled else "disabled")

    def _set_open_report_enabled(self, enabled: bool) -> None:
        self.open_report_button.configure(state="normal" if enabled else "disabled")

    def _excel_ready(self) -> bool:
        return bool(self.ruta_excel and self.ruta_excel.exists())

    def _refresh_start_button_state(self) -> None:
        if self.action_running:
            self.start_button.configure(state="disabled")
        else:
            self.start_button.configure(state="normal" if self._excel_ready() else "disabled")

    def _profile_options(self) -> list[str]:
        return [p.get("cliente", p.get("nombre", "")) for p in self.saved_profiles.get("usuarios", [])]

    def _load_saved_profiles(self) -> dict:
        try:
            if self.profiles_file.exists():
                data = json.loads(self.profiles_file.read_text(encoding="utf-8"))
                if isinstance(data, dict) and isinstance(data.get("usuarios"), list):
                    return sync_profile_payload(data)
        except Exception:
            pass
        return {"usuarios": []}

    def _save_profiles_to_disk(self) -> None:
        try:
            self.profiles_file.write_text(
                json.dumps(self.saved_profiles, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            upsert_shared_credentials_from_payload(self.saved_profiles)
        except Exception as exc:
            log_message(f"Error guardando perfiles de verificacion: {exc}")

    def _current_profile_from_form(self) -> dict:
        return {
            "cliente": self.profile_name_var.get().strip(),
            "usuario": self.profile_user_var.get().strip(),
            "clave": self.profile_password_var.get(),
        }

    def _save_current_profile(self, show_message: bool = True) -> None:
        profile = self._current_profile_from_form()
        if not profile["cliente"]:
            if show_message:
                messagebox.showwarning("Perfil", "Ingresa un nombre de cliente antes de guardar.")
            return

        usuarios = self.saved_profiles.setdefault("usuarios", [])
        for saved in usuarios:
            if saved.get("cliente", saved.get("nombre", "")) == profile["cliente"]:
                saved.update(profile)
                self._save_profiles_to_disk()
                self._refresh_profile_combo(profile["cliente"])
                if show_message:
                    messagebox.showinfo("Perfil", f"Perfil '{profile['cliente']}' guardado.")
                return

        usuarios.append(profile)
        self._save_profiles_to_disk()
        self._refresh_profile_combo(profile["cliente"])
        if show_message:
            messagebox.showinfo("Perfil", f"Perfil '{profile['cliente']}' guardado.")

    def _new_profile(self) -> None:
        self.profile_var.set("")
        self.profile_name_var.set("")
        self.profile_user_var.set("")
        self.profile_password_var.set("")

    def _delete_current_profile(self) -> None:
        nombre = self.profile_var.get().strip()
        if not nombre:
            return
        usuarios = self.saved_profiles.get("usuarios", [])
        self.saved_profiles["usuarios"] = [
            p for p in usuarios if p.get("cliente", p.get("nombre", "")) != nombre
        ]
        self._save_profiles_to_disk()
        self._refresh_profile_combo()
        self._new_profile()

    def _on_profile_selected(self, choice: str) -> None:
        for profile in self.saved_profiles.get("usuarios", []):
            nombre = profile.get("cliente", profile.get("nombre", ""))
            if nombre == choice:
                self.profile_name_var.set(nombre)
                self.profile_user_var.set(profile.get("usuario", ""))
                self.profile_password_var.set(profile.get("clave", ""))
                return

    def _load_initial_profile_into_form(self) -> None:
        if not self._seleccionar_perfil_para_cliente(self._cliente_verificacion_codigo()):
            self._new_profile()

    def _refresh_profile_combo(self, selected: str = "") -> None:
        options = self._profile_options()
        self.profile_combo.configure(values=options or [""])
        value = selected or (options[0] if options else "")
        self.profile_var.set(value)
        if value:
            self._on_profile_selected(value)

    def _seleccionar_perfil_para_cliente(self, cliente_codigo: str) -> bool:
        perfiles = self.saved_profiles.get("usuarios", [])
        if not perfiles:
            return False

        preferidos = {
            "gjs": ("grupo justo", "justo salud", "salud grupo justo", "gjs"),
            "cima": ("ceintramed", "cima", "ceintra", "srl ceintramed"),
        }.get(cliente_codigo, ())

        def nombre_perfil(profile: dict) -> str:
            return profile.get("cliente", profile.get("nombre", ""))

        for profile in perfiles:
            nombre = nombre_perfil(profile)
            nombre_key = nombre.lower()
            if any(token in nombre_key for token in preferidos):
                self.profile_var.set(nombre)
                self._on_profile_selected(nombre)
                return True

        if len(perfiles) == 1:
            nombre = nombre_perfil(perfiles[0])
            self.profile_var.set(nombre)
            self._on_profile_selected(nombre)
            return True

        return False

    def _toggle_password(self) -> None:
        self.password_visible = not self.password_visible
        self.password_entry.configure(show="" if self.password_visible else "*")

    def _pick_filter_date(self, variable: ctk.StringVar, fallback_var: ctk.StringVar | None = None) -> None:
        if self.action_running:
            return
        initial_value = variable.get().strip()
        if not initial_value and fallback_var is not None:
            initial_value = fallback_var.get().strip()
        dialog = DatePickerDialog(self, initial_value)
        self.wait_window(dialog)
        if dialog.result is not None:
            variable.set(dialog.result)

    def _validar_rango_fechas(self) -> bool:
        desde = self.fecha_desde_var.get().strip()
        hasta = self.fecha_hasta_var.get().strip()
        try:
            fecha_desde = datetime.strptime(desde, "%d/%m/%Y") if desde else None
            fecha_hasta = datetime.strptime(hasta, "%d/%m/%Y") if hasta else None
        except ValueError:
            messagebox.showwarning("Fechas", "Usa el formato DD/MM/YYYY en el rango de fechas.")
            return False
        if fecha_desde and fecha_hasta and fecha_desde > fecha_hasta:
            messagebox.showwarning("Fechas", "La fecha desde no puede ser posterior a la fecha hasta.")
            return False
        if self._modo_verificacion_codigo() == "futuro":
            fecha_referencia = fecha_hasta or fecha_desde
            hoy = datetime.now().date()
            if fecha_referencia and fecha_referencia.date() < hoy:
                return messagebox.askyesno(
                    "Confirmar modo",
                    "El rango de fechas seleccionado queda antes de la fecha de hoy.\n\n"
                    "El modo actual es 'Control futuro'. Para revisar prestaciones ya realizadas, "
                    "normalmente corresponde usar 'Auditoria de prestaciones'.\n\n"
                    "¿Quieres iniciar igual en Control futuro?",
                )
        return True

    def _show_resume_dialog(self, payload: dict) -> None:
        dialog = ctk.CTkToplevel(self)
        dialog.title("Progreso encontrado")
        dialog.geometry("460x180")
        dialog.resizable(False, False)
        dialog.transient(self.winfo_toplevel())
        dialog.grab_set()
        dialog.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            dialog,
            text="Hay una verificacion anterior sin finalizar.",
            font=ctk.CTkFont(size=18, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=18, pady=(18, 6), sticky="w")

        ctk.CTkLabel(
            dialog,
            text=f"Archivo de progreso: {payload.get('ruta', '')}",
            font=ctk.CTkFont(size=12),
            text_color="#51657a",
            wraplength=420,
            justify="left",
        ).grid(row=1, column=0, padx=18, pady=(0, 14), sticky="w")

        buttons = ctk.CTkFrame(dialog, fg_color="transparent")
        buttons.grid(row=2, column=0, padx=18, pady=(0, 18), sticky="e")

        respuesta_enviada = {"ok": False}

        def responder(valor: str = "retomar") -> None:
            if respuesta_enviada["ok"]:
                return
            respuesta_enviada["ok"] = True
            self.respuesta_queue.put(valor)
            try:
                dialog.grab_release()
            except Exception:
                pass
            dialog.destroy()

        ctk.CTkButton(
            buttons,
            text="Empezar de cero",
            command=lambda: responder("cero"),
            width=140,
            fg_color="#9aafc3",
            hover_color="#7f95aa",
        ).grid(row=0, column=0, padx=(0, 10), sticky="e")

        ctk.CTkButton(
            buttons,
            text="Retomar",
            command=lambda: responder("retomar"),
            width=120,
            fg_color="#2f9e44",
            hover_color="#25833a",
        ).grid(row=0, column=1, sticky="e")

        dialog.protocol("WM_DELETE_WINDOW", responder)
        dialog.bind("<Escape>", lambda _event: responder())
        self.wait_window(dialog)

    def _go_home(self) -> None:
        if self.action_running:
            messagebox.showwarning("Atencion", "Espera a que termine la verificacion antes de volver.")
            return
        if self.on_back:
            self.on_back()

    def _restart_app(self) -> None:
        if self.action_running:
            messagebox.showwarning("Atencion", "Espera a que termine la verificacion antes de reiniciar.")
            return
        if self.on_restart:
            self.on_restart()
            return

        preserved_args = [arg for arg in sys.argv[1:] if not arg.startswith("--module=")]
        if getattr(sys, "frozen", False):
            cmd = [sys.executable, *preserved_args, "--module=verificar"]
        else:
            script_path = Path(sys.argv[0]).resolve()
            cmd = [sys.executable, str(script_path), *preserved_args, "--module=verificar"]
        subprocess.Popen(cmd, cwd=str(Path.cwd()))
        self.winfo_toplevel().destroy()

    def on_close(self) -> None:
        try:
            if self.controller:
                self.controller.detener()
        except Exception:
            pass
        finally:
            self.destroy()
