import json
import queue
import threading
import time
from calendar import Calendar, month_name
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox

import customtkinter as ctk

from ui_kit import apply_button_icon, attach_tooltip, button_icon

from app_credentials import sync_profile_records, upsert_shared_credentials_from_records
from app_paths import get_data_dir, get_log_file, get_output_dir
from pami_transmision import PamiTransmisionController


class DatePickerDialog(ctk.CTkToplevel):
    def __init__(self, master, initial_value: str = "") -> None:
        super().__init__(master)
        self.title("Seleccionar fecha")
        self.geometry("360x360")
        self.resizable(False, False)
        self.transient(master.winfo_toplevel())
        self.grab_set()

        self.result = None
        self._calendar = Calendar(firstweekday=0)
        self._selected_date = self._parse_initial(initial_value)
        self._current_year = self._selected_date.year
        self._current_month = self._selected_date.month

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(self, fg_color="transparent")
        header.grid(row=0, column=0, padx=14, pady=(14, 8), sticky="ew")
        header.grid_columnconfigure(1, weight=1)

        ctk.CTkButton(header, text="<", width=34, command=self._prev_month).grid(row=0, column=0, padx=(0, 8), sticky="w")
        self.month_label = ctk.CTkLabel(header, text="", font=ctk.CTkFont(size=16, weight="bold"), text_color="#16324f")
        self.month_label.grid(row=0, column=1, sticky="ew")
        ctk.CTkButton(header, text=">", width=34, command=self._next_month).grid(row=0, column=2, padx=(8, 0), sticky="e")

        self.days_frame = ctk.CTkFrame(self, corner_radius=12, fg_color="#eef3f8")
        self.days_frame.grid(row=1, column=0, padx=14, pady=(0, 10), sticky="nsew")
        for column in range(7):
            self.days_frame.grid_columnconfigure(column, weight=1)

        footer = ctk.CTkFrame(self, fg_color="transparent")
        footer.grid(row=2, column=0, padx=14, pady=(0, 14), sticky="ew")
        footer.grid_columnconfigure(0, weight=1)

        ctk.CTkButton(footer, text="Limpiar", width=80, fg_color="#9aafc3", hover_color="#7f95aa", command=self._clear).grid(row=0, column=0, padx=(0, 8), sticky="w")
        ctk.CTkButton(footer, text="Hoy", width=80, fg_color="#66788a", hover_color="#536577", command=self._today).grid(row=0, column=1, padx=8, sticky="w")
        ctk.CTkButton(footer, text="Cancelar", width=90, fg_color="#9aafc3", hover_color="#7f95aa", command=self._cancel).grid(row=0, column=2, padx=8, sticky="e")

        self._render_days()
        self.protocol("WM_DELETE_WINDOW", self._cancel)

    def _parse_initial(self, value: str) -> datetime:
        try:
            return datetime.strptime(value.strip(), "%d/%m/%Y")
        except Exception:
            return datetime.now()

    def _render_days(self) -> None:
        for child in self.days_frame.winfo_children():
            child.destroy()

        self.month_label.configure(text=f"{month_name[self._current_month]} {self._current_year}")

        week_names = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"]
        for idx, name in enumerate(week_names):
            ctk.CTkLabel(
                self.days_frame,
                text=name,
                font=ctk.CTkFont(size=12, weight="bold"),
                text_color="#51657a",
                width=30,
            ).grid(row=0, column=idx, padx=3, pady=(10, 4))

        month_weeks = self._calendar.monthdayscalendar(self._current_year, self._current_month)
        for row_index, week in enumerate(month_weeks, start=1):
            for col_index, day in enumerate(week):
                if day == 0:
                    ctk.CTkLabel(self.days_frame, text="", width=30).grid(row=row_index, column=col_index, padx=3, pady=4)
                    continue

                is_selected = (
                    self._selected_date.day == day
                    and self._selected_date.month == self._current_month
                    and self._selected_date.year == self._current_year
                )
                ctk.CTkButton(
                    self.days_frame,
                    text=str(day),
                    width=30,
                    height=28,
                    font=ctk.CTkFont(size=12),
                    fg_color="#245b9d" if is_selected else "#ffffff",
                    hover_color="#1d4b82" if is_selected else "#dbe7f2",
                    text_color="#ffffff" if is_selected else "#16324f",
                    command=lambda d=day: self._select_day(d),
                ).grid(row=row_index, column=col_index, padx=3, pady=4)

    def _select_day(self, day: int) -> None:
        self._selected_date = datetime(self._current_year, self._current_month, day)
        self.result = self._selected_date.strftime("%d/%m/%Y")
        self.destroy()

    def _prev_month(self) -> None:
        if self._current_month == 1:
            self._current_month = 12
            self._current_year -= 1
        else:
            self._current_month -= 1
        self._render_days()

    def _next_month(self) -> None:
        if self._current_month == 12:
            self._current_month = 1
            self._current_year += 1
        else:
            self._current_month += 1
        self._render_days()

    def _today(self) -> None:
        today = datetime.now()
        self._current_year = today.year
        self._current_month = today.month
        self._selected_date = today
        self.result = today.strftime("%d/%m/%Y")
        self.destroy()

    def _clear(self) -> None:
        self.result = ""
        self.destroy()

    def _cancel(self) -> None:
        self.result = None
        self.destroy()


class PamiTransmisionModuleFrame(ctk.CTkFrame):
    def __init__(self, master, on_back=None) -> None:
        super().__init__(master, fg_color="#eef3f8")
        self.on_back = on_back

        self.event_queue: queue.Queue = queue.Queue()
        self.controller_queue: queue.Queue = queue.Queue()
        self.action_running = False
        self.done_alert_shown = False
        self.final_summary_running = False
        self.password_visible = False
        self.live_status_enabled = False
        self.status_poll_pending = False
        self.last_status_poll_at = 0.0
        self.visible_log_lines: list[str] = []
        self.max_visible_log_lines = 5
        self.data_dir = get_data_dir()
        self.profiles_file = Path(self.data_dir) / "usuarios_transmision.json"
        self.saved_profiles = self._load_saved_profiles()

        self.controller = PamiTransmisionController(
            log_callback=self._push_log,
            status_callback=self._push_status,
        )
        self.controller_thread: threading.Thread | None = None

        self._build_ui()
        self.after(150, self._process_ui_queue)

    def _build_ui(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(self, corner_radius=12, fg_color="#ffffff", border_width=1, border_color="#d8e2ec")
        header.grid(row=0, column=0, padx=8, pady=(6, 4), sticky="ew")
        header.grid_columnconfigure(1, weight=1)

        if self.on_back:
            ctk.CTkButton(
                header,
                text="Volver",
                width=78,
                command=self._go_home,
                fg_color="#9aafc3",
                hover_color="#7f95aa",
            ).grid(row=0, column=0, padx=(8, 10), pady=(8, 3), sticky="w")

        ctk.CTkLabel(
            header,
            text="Transmisión automática PAMI",
            font=ctk.CTkFont(size=20, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=1, padx=10, pady=(8, 2), sticky="w")

        ctk.CTkLabel(
            header,
            text=(
                "Gestiona perfiles con cliente, usuario y clave. "
                "Abre PAMI, autocompleta el login y controla el bot desde esta app."
            ),
            font=ctk.CTkFont(size=11),
            text_color="#51657a",
        ).grid(row=1, column=1, padx=10, pady=(0, 3), sticky="w")

        ctk.CTkLabel(
            header,
            text=f"Carpeta de trabajo: {self.data_dir}",
            font=ctk.CTkFont(size=11),
            text_color="#6d7f90",
        ).grid(row=2, column=1, padx=10, pady=(0, 8), sticky="w")

        content = ctk.CTkScrollableFrame(self, corner_radius=8, fg_color="#ffffff")
        content.grid(row=1, column=0, padx=8, pady=(0, 8), sticky="nsew")
        content.grid_columnconfigure(0, weight=1)
        content.grid_rowconfigure(4, weight=1)
        self.content_scroll = content

        pasos = ctk.CTkFrame(content, corner_radius=12, fg_color="#ffffff", border_width=1, border_color="#d8e2ec")
        pasos.grid(row=0, column=0, padx=8, pady=(6, 6), sticky="ew")
        pasos.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            pasos,
            text="Instrucciones paso a paso",
            font=ctk.CTkFont(size=18, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=14, pady=(14, 8), sticky="w")

        ctk.CTkLabel(
            pasos,
            text=(
                "1. Elegir un perfil guardado o crear uno nuevo\n"
                "2. Revisar que cliente, usuario y clave esten bien\n"
                "3. Elegir las fechas o filtros automaticos si los quieres usar\n"
                "4. Revisar si quieres ocultar el navegador\n"
                "5. Usar Correr transmision automatica"
            ),
            justify="left",
            font=ctk.CTkFont(size=14),
            text_color="#43576b",
        ).grid(row=1, column=0, padx=14, pady=(0, 14), sticky="w")

        profiles_frame = ctk.CTkFrame(content, corner_radius=12, fg_color="#ffffff", border_width=1, border_color="#d8e2ec")
        profiles_frame.grid(row=1, column=0, padx=18, pady=(0, 12), sticky="ew")
        profiles_frame.grid_columnconfigure(1, weight=0)
        profiles_frame.grid_columnconfigure(4, weight=1)

        profile_options = self._profile_options()
        self.profile_var = ctk.StringVar(value=profile_options[0] if profile_options else "")
        self.profile_name_var = ctk.StringVar(value="")
        self.profile_user_var = ctk.StringVar(value="")
        self.profile_password_var = ctk.StringVar(value="")
        self.profile_last_bot_var = ctk.StringVar(value="Sin registro")
        self.filter_fecha_desde_var = ctk.StringVar(value="")
        self.filter_fecha_hasta_var = ctk.StringVar(value=self._today_str())
        self.filter_validada_var = ctk.StringVar(value="")
        self.filter_transmitida_var = ctk.StringVar(value="")
        self.last_estado: dict = {}
        self.hide_browser_var = ctk.BooleanVar(value=False)

        ctk.CTkLabel(
            profiles_frame,
            text="Perfil guardado",
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=(14, 10), pady=14, sticky="w")

        self.profile_combo = ctk.CTkComboBox(
            profiles_frame,
            values=profile_options or [""],
            variable=self.profile_var,
            width=340,
            command=self._on_profile_selected,
        )
        self.profile_combo.grid(row=0, column=1, padx=10, pady=14, sticky="w")

        self.new_profile_button = ctk.CTkButton(
            profiles_frame,
            text="+",
            command=self._new_profile,
            width=42,
            height=38,
            font=ctk.CTkFont(size=18, weight="bold"),
            fg_color="#245b9d",
            hover_color="#1d4b82",
        )
        self.new_profile_button.grid(row=0, column=2, padx=(10, 6), pady=14, sticky="w")
        attach_tooltip(self.new_profile_button, "Nuevo perfil")

        self.delete_profile_button = ctk.CTkButton(
            profiles_frame,
            text="Borrar perfil",
            command=self._delete_current_profile,
            width=42,
            height=38,
            fg_color="#8a5a5a",
            hover_color="#734949",
        )
        self.delete_profile_button.grid(row=0, column=3, padx=(0, 14), pady=14, sticky="w")
        apply_button_icon(self.delete_profile_button, "trash.png", "Borrar perfil", size=(16, 16), width=42)

        ctk.CTkLabel(
            profiles_frame,
            text="Cliente",
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color="#16324f",
        ).grid(row=1, column=0, padx=(14, 10), pady=(0, 10), sticky="w")

        self.client_entry = ctk.CTkEntry(
            profiles_frame,
            textvariable=self.profile_name_var,
            placeholder_text="Nombre del cliente o centro",
        )
        self.client_entry.grid(row=1, column=1, padx=10, pady=(0, 10), sticky="w")

        self.save_profile_button = ctk.CTkButton(
            profiles_frame,
            text="Guardar perfil",
            command=self._save_current_profile,
            width=42,
            height=38,
            fg_color="#66788a",
            hover_color="#536577",
        )
        self.save_profile_button.grid(row=1, column=2, padx=(10, 6), pady=(0, 10), sticky="w")
        apply_button_icon(self.save_profile_button, "save.png", "Guardar perfil", size=(18, 18), width=42)

        self.apply_login_button = ctk.CTkButton(
            profiles_frame,
            text="Autocompletar login",
            command=lambda: self._run_action(self._apply_credentials_to_login),
            width=130,
            height=38,
        )
        self.apply_login_button.grid(row=1, column=3, padx=10, pady=(0, 10), sticky="w")

        credentials_row = ctk.CTkFrame(profiles_frame, fg_color="transparent")
        credentials_row.grid(row=2, column=0, columnspan=4, padx=(14, 14), pady=(0, 10), sticky="ew")
        credentials_row.grid_columnconfigure(1, weight=0)
        credentials_row.grid_columnconfigure(4, weight=0)

        ctk.CTkLabel(
            credentials_row,
            text="Usuario",
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, padx=(0, 10), pady=0, sticky="w")

        self.user_entry = ctk.CTkEntry(
            credentials_row,
            textvariable=self.profile_user_var,
            placeholder_text="UP...",
            width=260,
        )
        self.user_entry.grid(row=0, column=1, padx=(0, 28), pady=0, sticky="w")

        ctk.CTkLabel(
            credentials_row,
            text="Clave",
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=2, padx=(0, 10), pady=0, sticky="w")

        self.password_entry = ctk.CTkEntry(
            credentials_row,
            textvariable=self.profile_password_var,
            placeholder_text="Clave PAMI",
            show="*",
            width=260,
        )
        self.password_entry.grid(row=0, column=3, padx=(0, 10), pady=0, sticky="w")

        self.toggle_password_button = ctk.CTkButton(
            credentials_row,
            text="Ver",
            command=self._toggle_password_visibility,
            width=42,
            height=38,
            fg_color="#66788a",
            hover_color="#536577",
        )
        self.toggle_password_button.grid(row=0, column=4, padx=0, pady=0, sticky="w")
        apply_button_icon(self.toggle_password_button, "eye.png", "Ver / ocultar clave", size=(18, 18), width=42)

        ctk.CTkLabel(
            profiles_frame,
            text="Última boteada",
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color="#16324f",
        ).grid(row=3, column=0, padx=(14, 10), pady=(0, 14), sticky="w")

        self.last_bot_label = ctk.CTkLabel(
            profiles_frame,
            textvariable=self.profile_last_bot_var,
            font=ctk.CTkFont(size=14),
            text_color="#51657a",
        )
        self.last_bot_label.grid(row=3, column=1, padx=10, pady=(0, 14), sticky="w")

        filters_frame = ctk.CTkFrame(content, corner_radius=12, fg_color="#ffffff", border_width=1, border_color="#d8e2ec")
        filters_frame.grid(row=2, column=0, padx=18, pady=(0, 12), sticky="ew")
        for idx in range(8):
            filters_frame.grid_columnconfigure(idx, weight=0)
        filters_frame.grid_columnconfigure(8, weight=1)

        ctk.CTkLabel(
            filters_frame,
            text="Filtros automáticos de Transmisión",
            font=ctk.CTkFont(size=18, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=0, columnspan=8, padx=14, pady=(14, 10), sticky="w")

        ctk.CTkLabel(
            filters_frame,
            text="Fecha desde",
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color="#16324f",
        ).grid(row=1, column=0, padx=(14, 8), pady=(0, 12), sticky="w")

        fecha_desde_box = ctk.CTkFrame(filters_frame, fg_color="transparent")
        fecha_desde_box.grid(row=1, column=1, padx=(0, 14), pady=(0, 12), sticky="w")
        self.filter_fecha_desde_entry = ctk.CTkEntry(
            fecha_desde_box,
            textvariable=self.filter_fecha_desde_var,
            placeholder_text="Seleccionar fecha",
            width=120,
            state="readonly",
        )
        self.filter_fecha_desde_entry.grid(row=0, column=0, padx=(0, 6), pady=0, sticky="w")
        self.filter_fecha_desde_entry.bind("<Button-1>", lambda _event: self._pick_filter_date(self.filter_fecha_desde_var), add="+")
        self.filter_fecha_desde_button = ctk.CTkButton(
            fecha_desde_box,
            text="...",
            width=34,
            height=32,
            command=lambda: self._pick_filter_date(self.filter_fecha_desde_var),
        )
        self.filter_fecha_desde_button.grid(row=0, column=1, pady=0, sticky="w")

        ctk.CTkLabel(
            filters_frame,
            text="Fecha hasta",
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color="#16324f",
        ).grid(row=1, column=2, padx=(0, 8), pady=(0, 12), sticky="w")

        fecha_hasta_box = ctk.CTkFrame(filters_frame, fg_color="transparent")
        fecha_hasta_box.grid(row=1, column=3, padx=(0, 14), pady=(0, 12), sticky="w")
        self.filter_fecha_hasta_entry = ctk.CTkEntry(
            fecha_hasta_box,
            textvariable=self.filter_fecha_hasta_var,
            placeholder_text="Seleccionar fecha",
            width=120,
            state="readonly",
        )
        self.filter_fecha_hasta_entry.grid(row=0, column=0, padx=(0, 6), pady=0, sticky="w")
        self.filter_fecha_hasta_entry.bind("<Button-1>", lambda _event: self._pick_filter_date(self.filter_fecha_hasta_var), add="+")
        self.filter_fecha_hasta_button = ctk.CTkButton(
            fecha_hasta_box,
            text="...",
            width=34,
            height=32,
            command=lambda: self._pick_filter_date(self.filter_fecha_hasta_var),
        )
        self.filter_fecha_hasta_button.grid(row=0, column=1, pady=0, sticky="w")

        ctk.CTkLabel(
            filters_frame,
            text="Validada",
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color="#16324f",
        ).grid(row=1, column=4, padx=(0, 8), pady=(0, 12), sticky="w")

        self.filter_validada_combo = ctk.CTkComboBox(
            filters_frame,
            values=["", "Si", "No"],
            variable=self.filter_validada_var,
            width=100,
            state="readonly",
        )
        self.filter_validada_combo.grid(row=1, column=5, padx=(0, 14), pady=(0, 12), sticky="w")

        ctk.CTkLabel(
            filters_frame,
            text="Transmitida",
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color="#16324f",
        ).grid(row=1, column=6, padx=(0, 8), pady=(0, 12), sticky="w")

        self.filter_transmitida_combo = ctk.CTkComboBox(
            filters_frame,
            values=["", "No", "Si"],
            variable=self.filter_transmitida_var,
            width=100,
            state="readonly",
        )
        self.filter_transmitida_combo.grid(row=1, column=7, padx=(0, 14), pady=(0, 12), sticky="w")

        controls = ctk.CTkFrame(content, corner_radius=12, fg_color="#ffffff", border_width=1, border_color="#d8e2ec")
        controls.grid(row=3, column=0, padx=18, pady=(0, 12), sticky="ew")
        controls.grid_columnconfigure(6, weight=1)

        self.open_and_start_button = ctk.CTkButton(
            controls,
            text="Correr transmisión automática",
            command=self._handle_open_and_start_bot,
            width=240,
            height=40,
            font=ctk.CTkFont(size=15, weight="bold"),
            fg_color="#1f7a46",
            hover_color="#176238",
        )
        self.open_and_start_button.grid(row=0, column=0, padx=(14, 10), pady=14, sticky="w")

        self.close_button = ctk.CTkButton(
            controls,
            text="Cerrar navegador",
            command=self._handle_close_browser,
            width=150,
            height=40,
            fg_color="#8a5a5a",
            hover_color="#734949",
        )
        self.close_button.grid(row=0, column=1, padx=10, pady=14, sticky="w")

        self.export_button = ctk.CTkButton(
            controls,
            text="Exportar Excel",
            command=self._handle_export_excel,
            width=150,
            height=40,
            fg_color="#66788a",
            hover_color="#536577",
        )
        self.export_button.grid(row=0, column=2, padx=10, pady=14, sticky="w")

        self.pause_button = ctk.CTkButton(
            controls,
            text="Detener",
            command=self._handle_pause_bot,
            width=120,
            height=40,
            fg_color="#bd6b2a",
            hover_color="#9d571f",
        )
        self.pause_button.grid(row=0, column=3, padx=10, pady=14, sticky="w")

        self.resume_button = ctk.CTkButton(
            controls,
            text="Reanudar",
            command=self._handle_resume_bot,
            width=120,
            height=40,
            fg_color="#245b9d",
            hover_color="#1d4b82",
        )
        self.resume_button.grid(row=0, column=4, padx=10, pady=14, sticky="w")

        self.hide_browser_checkbox = ctk.CTkCheckBox(
            controls,
            text="No ver navegador",
            variable=self.hide_browser_var,
            onvalue=True,
            offvalue=False,
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color="#16324f",
        )
        self.hide_browser_checkbox.grid(row=0, column=5, padx=(10, 14), pady=14, sticky="w")
        status_frame = ctk.CTkFrame(content, corner_radius=12, fg_color="#ffffff", border_width=1, border_color="#d8e2ec")
        status_frame.grid(row=4, column=0, padx=18, pady=(0, 18), sticky="nsew")
        status_frame.grid_columnconfigure(0, weight=1)
        status_frame.grid_rowconfigure(2, weight=1)

        self.status_label = ctk.CTkLabel(
            status_frame,
            text="Estado: Sin iniciar | Proceso: Esperando | Procesados: 0",
            font=ctk.CTkFont(size=15, weight="bold"),
            text_color="#16324f",
        )
        self.status_label.grid(row=0, column=0, padx=16, pady=(14, 8), sticky="w")

        self.summary_label = ctk.CTkLabel(
            status_frame,
            text=f"Pagina: - | Errores: 0 | Ultimo: - | Log: {get_log_file()}",
            font=ctk.CTkFont(size=13),
            text_color="#66788a",
        )
        self.summary_label.grid(row=1, column=0, padx=16, pady=(0, 8), sticky="w")

        self.log_text = ctk.CTkTextbox(status_frame, font=ctk.CTkFont(size=13))
        self.log_text.grid(row=2, column=0, padx=16, pady=(0, 16), sticky="nsew")
        self.log_text.insert("1.0", "Esperando acciones.\n")
        self.log_text.configure(state="disabled")

        self._load_initial_profile_into_form()
        self.after(50, self._scroll_content_to_top)

    def _run_action(self, action) -> None:
        if self.action_running:
            return
        self._ensure_controller_thread()
        self.action_running = True
        self._set_controls_enabled(False)
        self.controller_queue.put((action, True))

    def _run_background_action(self, action) -> None:
        self._ensure_controller_thread()
        self.controller_queue.put((action, False))

    def _ensure_controller_thread(self) -> None:
        if self.controller_thread is None or not self.controller_thread.is_alive():
            self.controller_thread = threading.Thread(target=self._controller_loop, daemon=True)
            self.controller_thread.start()

    def _controller_loop(self) -> None:
        while True:
            item = self.controller_queue.get()
            if item is None:
                break
            if isinstance(item, tuple):
                action, managed = item
            else:
                action, managed = item, True
            try:
                action()
                self.event_queue.put(("action_finished" if managed else "background_finished", None))
            except Exception as exc:
                self.event_queue.put(("action_error" if managed else "background_error", str(exc)))

    def _handle_open_pami(self) -> None:
        self.live_status_enabled = False
        self.status_poll_pending = False
        self.done_alert_shown = False
        self.final_summary_running = False
        self._run_action(self._open_pami_with_profile)

    def _handle_open_and_start_bot(self) -> None:
        self.done_alert_shown = False
        self.final_summary_running = False
        self.live_status_enabled = True
        self.status_poll_pending = False
        self._mark_current_profile_boted()
        self._run_action(self._open_and_start_with_profile)

    def _handle_close_browser(self) -> None:
        self.live_status_enabled = False
        self.status_poll_pending = False
        self.done_alert_shown = False
        self.final_summary_running = False
        self._run_action(self.controller.cerrar_navegador)

    def _handle_export_excel(self) -> None:
        default_name = f"transmision_panel_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        destino = filedialog.asksaveasfilename(
            title="Guardar Excel exportado",
            defaultextension=".xlsx",
            initialdir=str(get_output_dir()),
            initialfile=default_name,
            filetypes=[
                ("Excel moderno", "*.xlsx"),
                ("Excel 97-2003 / HTML de PAMI", "*.xls"),
                ("Todos los archivos", "*.*"),
            ],
        )
        if not destino:
            return
        self._run_action(lambda: self.controller.exportar_excel_panel(destino, self._current_filters_from_form()))

    def _handle_start_bot(self) -> None:
        self.done_alert_shown = False
        self.final_summary_running = False
        self.live_status_enabled = True
        self.status_poll_pending = False
        self._mark_current_profile_boted()
        self._run_action(lambda: self.controller.iniciar_bot(self._current_filters_from_form()))

    def _handle_pause_bot(self) -> None:
        self.live_status_enabled = True
        self._run_action(self.controller.pausar_bot)

    def _handle_resume_bot(self) -> None:
        self.live_status_enabled = True
        self.status_poll_pending = False
        self._run_action(self.controller.reanudar_bot)

    def _apply_credentials_to_login(self) -> None:
        profile = self._current_profile_from_form()
        if not profile["usuario"]:
            raise RuntimeError("Ingresa un usuario para autocompletar.")
        self._upsert_profile(profile)
        self.controller.autocompletar_credenciales(profile["usuario"], profile["clave"])

    def _open_pami_with_profile(self) -> None:
        self.done_alert_shown = False
        profile = self._current_profile_from_form()
        if self.hide_browser_var.get() and (not profile["usuario"] or not profile["clave"]):
            raise RuntimeError("Para usar 'No ver navegador' debes guardar usuario y clave.")
        if profile["usuario"]:
            self._upsert_profile(profile)
        self.controller.abrir_pami(
            usuario=profile["usuario"] or None,
            clave=profile["clave"] or None,
            filtros=self._current_filters_from_form(),
            headless=self.hide_browser_var.get(),
        )

    def _open_and_start_with_profile(self) -> None:
        profile = self._current_profile_from_form()
        if not profile["usuario"] or not profile["clave"]:
            raise RuntimeError("Completa usuario y clave para usar Correr transmision automatica.")
        self._upsert_profile(profile)
        filtros = self._current_filters_from_form()
        self.controller.abrir_pami(
            usuario=profile["usuario"],
            clave=profile["clave"],
            filtros=None,
            headless=self.hide_browser_var.get(),
        )
        self.controller.iniciar_bot(filtros)

    def _show_estado(self) -> None:
        estado = self.controller.obtener_estado()
        self.event_queue.put(("estado_detalle", estado))

    def _finalize_after_done(self) -> None:
        pendientes = self.controller.contar_pendientes(self._current_filters_from_form())
        self.event_queue.put(("final_summary", {"pendientes": pendientes, "procesados": self.last_estado.get("procesados", "-")}))


    def _push_log(self, message: str) -> None:
        self.event_queue.put(("log", message))

    def _push_status(self, message: str) -> None:
        self.event_queue.put(("status", message))

    def _summarize_log_message(self, message: str) -> str | None:
        text = " ".join(str(message or "").strip().split())
        if not text:
            return None

        hidden_fragments = [
            "Paginas detectadas en el contexto",
            "Pagina de transmision encontrada por URL",
            "Pagina de transmision encontrada por DOM",
            "Probando pagina por DOM",
            "No se encontro coincidencia automatica",
            "Motor del bot verificado en la pagina",
            "Credenciales aplicadas en login",
            "Pantalla validada por DOM",
            "Reintentando lectura/inyeccion tras navegacion en curso",
            "Tabla lista:",
            "Escaneando ",
            "Abriendo modal:",
            "Modal visible.",
            "Confirmando:",
            "ALERT bloqueado:",
            "Se ha transmitido la informacion correctamente.",
            "{status:",
            "timestamp:",
        ]
        normalized = text.lower()
        if any(fragment.lower() in normalized for fragment in hidden_fragments):
            return None

        if "ÉXITO: [" in text or "EXITO: [" in text:
            return "Transmision confirmada."
        if "Elegible:" in text:
            return None
        if "Confirmacion enviada." in text or "Confirmación enviada." in text:
            return None
        if "No hay mas paginas disponibles." in text or "No hay más páginas disponibles." in text:
            return "Fin del barrido."
        if "Pendientes sin transmitir detectados tras el barrido:" in text:
            return text
        if text.startswith("[PAGEERROR]"):
            return "Error de pagina detectado."
        if text.startswith("ERROR"):
            return text

        replacements = {
            "Bot iniciado. Revisa el navegador y el log.": "Bot iniciado.",
            "Bot reanudado.": "Bot reanudado.",
            "Bot detenido.": "Bot detenido.",
            "Sesion iniciada en segundo plano.": "Sesion iniciada.",
            "Navegador abierto. Inicia sesion en PAMI y deja lista la pantalla de transmision.": None,
            "CUP abierto con sesion iniciada. Ya puedes trabajar en Transmision.": "Sesion iniciada y Transmision lista.",
            "Sesion iniciada y pantalla de transmision preparada en segundo plano.": "Sesion iniciada y Transmision lista.",
            "La sesion de CUP ya estaba activa.": "Sesion ya iniciada.",
            "Registros por página ajustado a 50.": None,
            "Registros por página ajustado a 50.": None,
            "Navegador cerrado desde la app.": "Navegador cerrado.",
            "Sesion cerrada manualmente desde la app.": None,
        }
        if text in replacements:
            return replacements[text]
        if text.startswith("Filtros aplicados desde la app ->"):
            return text.replace("Filtros aplicados desde la app ->", "Filtros:")
        if text.startswith("Aplicando filtros:"):
            return text.replace("Aplicando filtros:", "Filtros:")

        return text

    def _append_visible_log(self, message: str) -> None:
        resumen = self._summarize_log_message(message)
        if not resumen:
            return
        if self.visible_log_lines and self.visible_log_lines[-1] == resumen:
            return
        self.visible_log_lines.append(resumen)
        self.visible_log_lines = self.visible_log_lines[-self.max_visible_log_lines :]
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.insert("1.0", "\n".join(self.visible_log_lines) + "\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _schedule_live_status_poll(self) -> None:
        if not self.live_status_enabled or self.action_running or self.status_poll_pending:
            return
        now = time.monotonic()
        if now - self.last_status_poll_at < 2.5:
            return
        self.last_status_poll_at = now
        self.status_poll_pending = True
        self._run_background_action(self._show_estado)

    def _process_ui_queue(self) -> None:
        had_events = False
        try:
            while True:
                event, payload = self.event_queue.get_nowait()
                had_events = True

                if event == "log":
                    self._append_visible_log(payload)
                elif event == "status":
                    self.status_label.configure(text=payload)
                elif event == "estado_detalle":
                    self._render_estado(payload)
                elif event == "final_summary":
                    self.final_summary_running = False
                    pendientes = payload.get("pendientes", -1)
                    procesados = payload.get("procesados", "-")
                    self.status_label.configure(text=f"Estado: Finalizado | Proceso: Completo | Procesados: {procesados}")
                    self.summary_label.configure(text=f"Pendientes: {pendientes} | Log: {get_log_file()}")
                    self._append_visible_log(f"Pendientes sin transmitir detectados tras el barrido: {pendientes}")
                    if not self.done_alert_shown:
                        self.done_alert_shown = True
                        messagebox.showinfo("Transmision finalizada", f"El bot termino de recorrer la lista.\n\nPendientes sin transmitir: {pendientes}")
                elif event == "action_finished":
                    self.action_running = False
                    self._set_controls_enabled(True)
                elif event == "background_finished":
                    self.status_poll_pending = False
                elif event == "action_error":
                    self.action_running = False
                    self._set_controls_enabled(True)
                    self.live_status_enabled = False
                    self.status_poll_pending = False
                    self.final_summary_running = False
                    self.status_label.configure(text="Ocurrió un error.")
                    self._append_visible_log(f"ERROR: {payload}")
                    messagebox.showerror("Error", payload)
                elif event == "background_error":
                    self.status_poll_pending = False
                    texto = str(payload or "")
                    if (
                        "Execution context was destroyed" in texto
                        or "most likely because of a navigation" in texto
                    ):
                        self._append_visible_log("Aviso: la pagina se estaba recargando.")
                    else:
                        self.live_status_enabled = False
                        self.final_summary_running = False
                        self._append_visible_log(f"ERROR: {texto}")
        except queue.Empty:
            pass

        self._schedule_live_status_poll()
        delay = 120 if (self.action_running or self.live_status_enabled or self.status_poll_pending or self.final_summary_running or had_events) else 350
        self.after(delay, self._process_ui_queue)

    def _set_controls_enabled(self, enabled: bool) -> None:
        state = "normal" if enabled else "disabled"
        for button in (
            self.open_and_start_button,
            self.close_button,
            self.export_button,
            self.pause_button,
            self.resume_button,
            self.apply_login_button,
            self.save_profile_button,
            self.new_profile_button,
            self.delete_profile_button,
            self.toggle_password_button,
        ):
            button.configure(state=state)
        self.profile_combo.configure(state=state)
        self.client_entry.configure(state=state)
        self.user_entry.configure(state=state)
        self.password_entry.configure(state=state)
        self.filter_fecha_desde_entry.configure(state=state)
        self.filter_fecha_hasta_entry.configure(state=state)
        self.filter_validada_combo.configure(state=state)
        self.filter_transmitida_combo.configure(state=state)
        self.filter_fecha_desde_button.configure(state=state)
        self.filter_fecha_hasta_button.configure(state=state)
        self.hide_browser_checkbox.configure(state=state)

    def _go_home(self) -> None:
        if self.action_running:
            messagebox.showwarning("Atención", "Espera a que termine la acción actual antes de volver.")
            return
        if self.on_back:
            self.on_back()

    def on_close(self) -> None:
        try:
            if self.controller_thread is not None and self.controller_thread.is_alive():
                self.controller_queue.put((self.controller.cerrar, False))
                self.controller_queue.put(None)
        except Exception:
            pass
        finally:
            self.destroy()

    def _load_saved_profiles(self) -> list[dict]:
        try:
            if not self.profiles_file.exists():
                return []
            data = json.loads(self.profiles_file.read_text(encoding="utf-8"))
            profiles = data.get("usuarios", [])
            normalizados = []
            for item in profiles:
                if isinstance(item, dict):
                    usuario = str(item.get("usuario", "")).strip()
                    nombre = str(item.get("nombre", item.get("cliente", ""))).strip()
                    clave = str(item.get("clave", "")).strip()
                    ultima_boteada = str(item.get("ultima_boteada", item.get("last_bot_at", ""))).strip()
                    fecha_desde = str(item.get("fecha_desde", item.get("filtro_fecha_desde", ""))).strip()
                    fecha_hasta = str(item.get("fecha_hasta", item.get("filtro_fecha_hasta", ""))).strip()
                    validada = str(item.get("validada", item.get("filtro_validada", ""))).strip()
                    transmitida = str(item.get("transmitida", item.get("filtro_transmitida", ""))).strip()
                else:
                    usuario = str(item).strip()
                    nombre = ""
                    clave = ""
                    ultima_boteada = ""
                    fecha_desde = ""
                    fecha_hasta = self._today_str()
                    validada = ""
                    transmitida = ""
                if usuario:
                    normalizados.append(
                        {
                            "usuario": usuario,
                            "nombre": nombre,
                            "clave": clave,
                            "ultima_boteada": ultima_boteada,
                            "fecha_desde": fecha_desde,
                            "fecha_hasta": fecha_hasta,
                            "validada": validada,
                            "transmitida": transmitida,
                        }
                    )
            return sync_profile_records(normalizados)
        except Exception:
            return []

    def _save_saved_profiles(self) -> None:
        payload = {"usuarios": self.saved_profiles[:20]}
        self.profiles_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        upsert_shared_credentials_from_records(self.saved_profiles[:20])

    def _upsert_profile(self, profile: dict) -> None:
        usuario = profile["usuario"].strip()
        if not usuario:
            return
        self.saved_profiles = [p for p in self.saved_profiles if p["usuario"].lower() != usuario.lower()]
        self.saved_profiles.insert(
            0,
            {
                "usuario": usuario,
                "nombre": profile["nombre"].strip(),
                "clave": profile["clave"],
                "ultima_boteada": profile.get("ultima_boteada", ""),
                "fecha_desde": profile.get("fecha_desde", ""),
                "fecha_hasta": profile.get("fecha_hasta", ""),
                "validada": profile.get("validada", ""),
                "transmitida": profile.get("transmitida", ""),
            },
        )
        self.saved_profiles = self.saved_profiles[:20]
        self._save_saved_profiles()
        self.profile_combo.configure(values=self._profile_options() or [""])
        self.profile_var.set(self._format_profile_entry(self.saved_profiles[0]))

    def _save_current_profile(self) -> None:
        profile = self._current_profile_from_form()
        if not profile["usuario"]:
            messagebox.showwarning("Perfil", "Ingresa un usuario para guardar el perfil.")
            return
        self._upsert_profile(profile)
        self._push_log(f"Perfil guardado: {profile['usuario']} ({profile['nombre'] or 'sin nombre'})")

    def _delete_current_profile(self) -> None:
        profile = self._current_profile_from_form()
        usuario = profile["usuario"].strip()
        if not usuario:
            messagebox.showwarning("Perfil", "No hay un perfil seleccionado para borrar.")
            return
        if not messagebox.askyesno("Borrar perfil", f"¿Quieres borrar el perfil {usuario}?"):
            return

        remaining = [p for p in self.saved_profiles if p["usuario"].lower() != usuario.lower()]
        if len(remaining) == len(self.saved_profiles):
            messagebox.showwarning("Perfil", "Ese perfil no estaba guardado.")
            return

        self.saved_profiles = remaining
        self._save_saved_profiles()
        opciones = self._profile_options() or [""]
        self.profile_combo.configure(values=opciones)
        if self.saved_profiles:
            primero = self._format_profile_entry(self.saved_profiles[0])
            self.profile_var.set(primero)
            self._on_profile_selected(primero)
        else:
            self._new_profile()
        self._push_log(f"Perfil borrado: {usuario}")

    def _profile_options(self) -> list[str]:
        return [self._format_profile_entry(item) for item in self.saved_profiles]

    def _format_profile_entry(self, item: dict) -> str:
        usuario = item.get("usuario", "").strip()
        nombre = item.get("nombre", "").strip()
        if usuario and nombre:
            return f"{usuario} - {nombre}"
        return usuario

    def _extract_user_code(self, value: str) -> str:
        return value.split(" - ", 1)[0].strip()

    def _on_profile_selected(self, selected: str) -> None:
        profile = self._find_profile_by_display(selected)
        if not profile:
            return
        self.profile_name_var.set(profile.get("nombre", ""))
        self.profile_user_var.set(profile.get("usuario", ""))
        self.profile_password_var.set(profile.get("clave", ""))
        self.profile_last_bot_var.set(profile.get("ultima_boteada") or "Sin registro")
        self.filter_fecha_desde_var.set(profile.get("fecha_desde", ""))
        self.filter_fecha_hasta_var.set(profile.get("fecha_hasta", "") or self._today_str())
        self.filter_validada_var.set(profile.get("validada", ""))
        self.filter_transmitida_var.set(profile.get("transmitida", ""))

    def _find_profile_by_display(self, selected: str) -> dict | None:
        usuario = self._extract_user_code(selected)
        for profile in self.saved_profiles:
            if profile["usuario"].lower() == usuario.lower():
                return profile
        return None

    def _current_profile_from_form(self) -> dict:
        return {
            "nombre": self.profile_name_var.get().strip(),
            "usuario": self.profile_user_var.get().strip(),
            "clave": self.profile_password_var.get(),
            "ultima_boteada": self.profile_last_bot_var.get() if self.profile_last_bot_var.get() != "Sin registro" else "",
            "fecha_desde": self.filter_fecha_desde_var.get().strip(),
            "fecha_hasta": self.filter_fecha_hasta_var.get().strip(),
            "validada": self.filter_validada_var.get().strip(),
            "transmitida": self.filter_transmitida_var.get().strip(),
        }

    def _current_filters_from_form(self) -> dict:
        return {
            "fecha_desde": self.filter_fecha_desde_var.get().strip(),
            "fecha_hasta": self.filter_fecha_hasta_var.get().strip(),
            "validada": self.filter_validada_var.get().strip(),
            "transmitida": self.filter_transmitida_var.get().strip(),
        }

    def _new_profile(self) -> None:
        self.profile_var.set("")
        self.profile_name_var.set("")
        self.profile_user_var.set("")
        self.profile_password_var.set("")
        self.profile_last_bot_var.set("Sin registro")
        self.filter_fecha_desde_var.set("")
        self.filter_fecha_hasta_var.set(self._today_str())
        self.filter_validada_var.set("")
        self.filter_transmitida_var.set("")
        self._set_password_visibility(False)

    def _pick_filter_date(self, target_var: ctk.StringVar) -> None:
        dialog = DatePickerDialog(self, target_var.get().strip())
        self.wait_window(dialog)
        if dialog.result is not None:
            target_var.set(dialog.result)

    def _mark_current_profile_boted(self) -> None:
        profile = self._current_profile_from_form()
        if not profile["usuario"]:
            return
        marca = datetime.now().strftime("%d/%m/%Y %H:%M")
        self.profile_last_bot_var.set(marca)
        profile["ultima_boteada"] = marca
        self._upsert_profile(profile)

    def _load_initial_profile_into_form(self) -> None:
        if self.saved_profiles:
            self._on_profile_selected(self._format_profile_entry(self.saved_profiles[0]))
        else:
            self._new_profile()

    def _today_str(self) -> str:
        return datetime.now().strftime("%d/%m/%Y")

    def _toggle_password_visibility(self) -> None:
        self._set_password_visibility(not self.password_visible)

    def _set_password_visibility(self, visible: bool) -> None:
        self.password_visible = visible
        self.password_entry.configure(show="" if visible else "*")
        _eye = button_icon("eye_off.png" if visible else "eye.png", (18, 18))
        if _eye is not None:
            self.toggle_password_button.configure(image=_eye, text="")
        else:
            self.toggle_password_button.configure(text="Ocultar" if visible else "Ver")

    def _scroll_content_to_top(self) -> None:
        try:
            self.content_scroll._parent_canvas.yview_moveto(0)
        except Exception:
            pass

    def _human_status(self, value: str) -> str:
        mapping = {
            "PAUSED": "Detenido",
            "RUNNING": "Trabajando",
            "WAITING_RELOAD": "Trabajando",
            "DONE": "Finalizado",
            "ERROR": "Con error",
            "SIN DATOS": "Sin datos",
        }
        return mapping.get(value, value.replace("_", " ").title())

    def _human_step(self, value: str) -> str:
        mapping = {
            "INICIO": "Inicio",
            "MODAL_ABIERTO": "Modal abierto",
            "PENDIENTE_VALIDACION": "Pendiente de validación",
        }
        return mapping.get(value, value.replace("_", " ").title())

    def _render_estado(self, estado: dict) -> None:
        self.last_estado = dict(estado or {})
        status = str(estado.get("status", "SIN DATOS"))
        page = estado.get("paginaDetectada") or "-"
        procesados = estado.get("procesados", 0)
        errores = estado.get("errores", 0)
        ultimo = estado.get("ultimoExitoso") or "-"
        step = estado.get("step") or "-"
        status_humano = self._human_status(status)
        if status in {"RUNNING", "WAITING_RELOAD"}:
            step_humano = "Procesando"
        else:
            step_humano = self._human_step(step)

        self.status_label.configure(
            text=f"Estado: {status_humano} | Proceso: {step_humano} | Procesados: {procesados}"
        )
        resumen = f"Pagina: {page} | Errores: {errores} | Ultimo: {ultimo} | Log: {get_log_file()}"
        self.summary_label.configure(text=resumen)

        if status == "DONE" and self.live_status_enabled and not self.final_summary_running and not self.action_running:
            self.final_summary_running = True
            self.status_label.configure(text=f"Estado: Finalizado | Proceso: Cerrando | Procesados: {procesados}")
            self.live_status_enabled = False
            self.status_poll_pending = False
            self._run_background_action(self._finalize_after_done)



class PamiTransmisionApp(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()

        ctk.set_appearance_mode("light")
        ctk.set_default_color_theme("blue")

        self.title("Transmisión PAMI")
        self.geometry("1280x840")
        self.minsize(1040, 720)
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self.module_frame = PamiTransmisionModuleFrame(self)
        self.module_frame.grid(row=0, column=0, sticky="nsew")
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def _on_close(self) -> None:
        self.module_frame.on_close()
        self.destroy()


if __name__ == "__main__":
    app = PamiTransmisionApp()
    app.mainloop()
