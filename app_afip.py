import calendar
import json
import queue
import threading
from datetime import datetime, timedelta
from pathlib import Path
from tkinter import messagebox

import customtkinter as ctk

from afip_facturacion import AfipFacturacionController, PamiLiquidacionController
from app_paths import get_data_dir
from app_transmision import DatePickerDialog


DEFAULT_RECEPTOR_CUIT = "30522763922"
DEFAULT_RECEPTOR_IVA = "IVA Sujeto Exento"
DEFAULT_CONDICION_VENTA = "Cuenta Corriente"


class AfipFacturacionFrame(ctk.CTkFrame):
    def __init__(self, master, on_back=None) -> None:
        super().__init__(master, fg_color="transparent")
        self.on_back = on_back
        self.event_queue: queue.Queue = queue.Queue()
        self.controller_queue: queue.Queue = queue.Queue()
        self.action_running = False
        self.password_visible = False
        self.pami_password_visible = False
        self.data_dir = get_data_dir()
        self.profiles_file = Path(self.data_dir) / "usuarios_afip.json"
        self.saved_profiles = self._load_saved_profiles()
        self.controller = AfipFacturacionController(
            log_callback=self._push_log,
            status_callback=self._push_status,
        )
        self.pami_controller = PamiLiquidacionController(
            log_callback=self._push_log,
            status_callback=self._push_status,
        )
        self.controller_thread: threading.Thread | None = None

        self._build_ui()
        self._load_initial_profile_into_form()
        self._set_default_invoice_dates()
        self.after(150, self._process_ui_queue)

    def _build_ui(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(self, corner_radius=16, fg_color="#f3f7fb")
        header.grid(row=0, column=0, padx=14, pady=(10, 6), sticky="ew")
        header.grid_columnconfigure(1, weight=1)
        if self.on_back:
            ctk.CTkButton(
                header,
                text="Volver",
                width=100,
                command=self._go_home,
                fg_color="#9aafc3",
                hover_color="#7f95aa",
            ).grid(row=0, column=0, rowspan=2, padx=(12, 10), pady=10, sticky="w")
        ctk.CTkLabel(
            header,
            text="Facturacion AFIP para PAMI",
            font=ctk.CTkFont(size=25, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=1, padx=14, pady=(10, 2), sticky="w")
        ctk.CTkLabel(
            header,
            text="Genera Factura C en Comprobantes en linea y guarda PDF, ZIPs y datos de emision.",
            font=ctk.CTkFont(size=13),
            text_color="#51657a",
        ).grid(row=1, column=1, padx=14, pady=(0, 10), sticky="w")

        content = ctk.CTkScrollableFrame(self, corner_radius=16, fg_color="#ffffff")
        content.grid(row=1, column=0, padx=14, pady=(0, 14), sticky="nsew")
        content.grid_columnconfigure(0, weight=1)

        self.profile_var = ctk.StringVar(value="")
        self.nombre_var = ctk.StringVar(value="")
        self.usuario_var = ctk.StringVar(value="")
        self.clave_var = ctk.StringVar(value="")
        self.representado_var = ctk.StringVar(value="")
        self.punto_venta_var = ctk.StringVar(value="00002")
        self.tipo_comprobante_var = ctk.StringVar(value="Factura C")
        self.actividad_var = ctk.StringVar(value="869090 - SERVICIOS RELACIONADOS CON LA SALUD")
        self.receptor_cuit_var = ctk.StringVar(value=DEFAULT_RECEPTOR_CUIT)
        self.receptor_iva_var = ctk.StringVar(value=DEFAULT_RECEPTOR_IVA)
        self.condicion_venta_var = ctk.StringVar(value=DEFAULT_CONDICION_VENTA)
        self.fecha_comprobante_var = ctk.StringVar(value="")
        self.periodo_desde_var = ctk.StringVar(value="")
        self.periodo_hasta_var = ctk.StringVar(value="")
        self.vencimiento_pago_var = ctk.StringVar(value="")
        self.descripcion_var = ctk.StringVar(value="")
        self.importe_var = ctk.StringVar(value="")
        self.pami_usuario_var = ctk.StringVar(value="")
        self.pami_clave_var = ctk.StringVar(value="")
        self.pami_periodo_var = ctk.StringVar(value="")
        self.pami_concepto_var = ctk.StringVar(value="Todos los Conceptos")
        self.pami_detalle_var = ctk.StringVar(value="Errores de Transmision")
        self.status_var = ctk.StringVar(value="Listo.")

        profiles = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        profiles.grid(row=0, column=0, padx=14, pady=(0, 8), sticky="ew")
        profiles.grid_columnconfigure(1, weight=0)
        profiles.grid_columnconfigure(3, weight=0)
        profiles.grid_columnconfigure(5, weight=1)

        ctk.CTkLabel(profiles, text="Perfil AFIP", font=ctk.CTkFont(size=14, weight="bold"), text_color="#16324f").grid(row=0, column=0, padx=12, pady=10, sticky="w")
        self.profile_combo = ctk.CTkComboBox(
            profiles,
            values=self._profile_options() or [""],
            variable=self.profile_var,
            command=self._on_profile_selected,
        )
        self.profile_combo.grid(row=0, column=1, padx=8, pady=8, sticky="w")
        ctk.CTkButton(profiles, text="Nuevo", width=90, command=self._new_profile).grid(row=0, column=2, padx=8, pady=8)
        ctk.CTkButton(profiles, text="Borrar", width=90, fg_color="#9aafc3", hover_color="#7f95aa", command=self._delete_current_profile).grid(row=0, column=3, padx=(8, 12), pady=8, sticky="w")

        self._entry(profiles, "Nombre", self.nombre_var, 1, 0, "Sabrina / cliente").grid(row=1, column=1, padx=8, pady=(0, 8), sticky="w")
        self._entry(profiles, "CUIT/CUIL", self.usuario_var, 2, 0, "CUIT de acceso").grid(row=2, column=1, padx=8, pady=(0, 8), sticky="w")
        self.password_entry = self._entry(profiles, "Clave", self.clave_var, 2, 2, "Clave fiscal", show="*")
        self.password_entry.grid(row=2, column=3, padx=8, pady=(0, 8), sticky="w")
        ctk.CTkButton(profiles, text="Ver", width=58, command=self._toggle_password_visibility).grid(row=2, column=4, padx=(0, 12), pady=(0, 8))
        self._entry(profiles, "Representado", self.representado_var, 3, 0, "Texto de la empresa a representar").grid(row=3, column=1, columnspan=3, padx=8, pady=(0, 8), sticky="w")
        self._entry(profiles, "Punto venta", self.punto_venta_var, 4, 0, "00002 o texto completo").grid(row=4, column=1, padx=8, pady=(0, 8), sticky="w")
        self._entry(profiles, "Actividad", self.actividad_var, 4, 2, "869090...").grid(row=4, column=3, padx=8, pady=(0, 8), sticky="w")
        ctk.CTkButton(profiles, text="Guardar perfil", command=self._save_current_profile, width=130, fg_color="#4f6378", hover_color="#3d4d61").grid(row=5, column=3, padx=8, pady=(0, 12), sticky="e")

        pami = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        pami.grid(row=1, column=0, padx=14, pady=8, sticky="ew")
        pami.grid_columnconfigure((1, 3), weight=0)
        pami.grid_columnconfigure(5, weight=1)
        ctk.CTkLabel(pami, text="PAMI - liquidacion a facturar", font=ctk.CTkFont(size=16, weight="bold"), text_color="#16324f").grid(row=0, column=0, columnspan=4, padx=12, pady=(12, 8), sticky="w")
        self._entry(pami, "Usuario", self.pami_usuario_var, 1, 0, "Usuario PAMI").grid(row=1, column=1, padx=8, pady=6, sticky="w")
        self.pami_password_entry = self._entry(pami, "Clave", self.pami_clave_var, 1, 2, "Clave PAMI", show="*")
        self.pami_password_entry.grid(row=1, column=3, padx=8, pady=6, sticky="w")
        ctk.CTkButton(pami, text="Ver", width=58, command=self._toggle_pami_password_visibility).grid(row=1, column=4, padx=(0, 12), pady=6)
        self._entry(pami, "Periodo", self.pami_periodo_var, 2, 0, "06/2026").grid(row=2, column=1, padx=8, pady=6, sticky="w")
        self._entry(pami, "Concepto", self.pami_concepto_var, 2, 2, "Todos los Conceptos").grid(row=2, column=3, padx=8, pady=6, sticky="w")
        self._entry(pami, "Detalle", self.pami_detalle_var, 3, 0, "Errores de Transmision").grid(row=3, column=1, columnspan=3, padx=8, pady=6, sticky="w")
        pami_buttons = ctk.CTkFrame(pami, fg_color="transparent")
        pami_buttons.grid(row=4, column=1, columnspan=3, padx=8, pady=(6, 12), sticky="w")

        invoice = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        invoice.grid(row=2, column=0, padx=14, pady=8, sticky="ew")
        invoice.grid_columnconfigure((1, 3), weight=0)
        invoice.grid_columnconfigure(5, weight=1)
        ctk.CTkLabel(invoice, text="Datos de factura", font=ctk.CTkFont(size=16, weight="bold"), text_color="#16324f").grid(row=0, column=0, columnspan=4, padx=12, pady=(12, 8), sticky="w")
        self._date_entry(invoice, "Fecha comprobante", self.fecha_comprobante_var, 1, 0).grid(row=1, column=1, padx=8, pady=6, sticky="w")
        self._date_entry(invoice, "Desde", self.periodo_desde_var, 1, 2).grid(row=1, column=3, padx=8, pady=6, sticky="w")
        self._date_entry(invoice, "Hasta", self.periodo_hasta_var, 2, 0).grid(row=2, column=1, padx=8, pady=6, sticky="w")
        self._date_entry(invoice, "Vto. pago", self.vencimiento_pago_var, 2, 2).grid(row=2, column=3, padx=8, pady=6, sticky="w")
        self._entry(invoice, "Descripcion", self.descripcion_var, 3, 0, "CONSULTAS DC 04-26").grid(row=3, column=1, padx=8, pady=6, sticky="w")
        self._entry(invoice, "Importe", self.importe_var, 3, 2, "$1.892.100,00").grid(row=3, column=3, padx=8, pady=6, sticky="w")
        ctk.CTkButton(invoice, text="Autocompletar periodo", width=160, command=self._set_default_invoice_dates).grid(row=4, column=1, padx=8, pady=(6, 12), sticky="w")

        receptor = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        receptor.grid(row=3, column=0, padx=14, pady=8, sticky="ew")
        receptor.grid_columnconfigure((1, 3), weight=0)
        receptor.grid_columnconfigure(5, weight=1)
        ctk.CTkLabel(receptor, text="Receptor", font=ctk.CTkFont(size=16, weight="bold"), text_color="#16324f").grid(row=0, column=0, columnspan=4, padx=12, pady=(12, 8), sticky="w")
        self._entry(receptor, "CUIT", self.receptor_cuit_var, 1, 0, "CUIT PAMI").grid(row=1, column=1, padx=8, pady=(0, 8), sticky="w")
        self._entry(receptor, "IVA", self.receptor_iva_var, 1, 2, "IVA Sujeto Exento").grid(row=1, column=3, padx=8, pady=(0, 8), sticky="w")
        self._entry(receptor, "Venta", self.condicion_venta_var, 2, 0, "Cuenta Corriente").grid(row=2, column=1, padx=8, pady=(0, 12), sticky="w")

        actions = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        actions.grid(row=4, column=0, padx=14, pady=8, sticky="ew")
        actions.grid_columnconfigure(0, weight=1)
        buttons = ctk.CTkFrame(actions, fg_color="transparent")
        buttons.grid(row=0, column=0, padx=12, pady=12, sticky="w")
        self.buttons = []
        for text, command, color in (
            ("Abrir PAMI", self._open_pami_liquidacion, "#3d84c6"),
            ("Buscar liquidacion", self._buscar_liquidacion_pami, "#2d6ca6"),
            ("Exportar detalle errores", self._exportar_detalle_pami, "#4f6378"),
            ("Cerrar PAMI", self._close_pami_liquidacion, "#9aafc3"),
        ):
            button = ctk.CTkButton(pami_buttons, text=text, command=command, fg_color=color, hover_color=color, width=150)
            button.pack(side="left", padx=5)
            self.buttons.append(button)
        for text, command, color in (
            ("Abrir AFIP", self._open_afip, "#3d84c6"),
            ("Autocompletar login", self._apply_login, "#3d84c6"),
            ("Abrir comprobantes", self._open_rccel, "#3d84c6"),
            ("Preparar hasta resumen", self._prepare_invoice, "#2d6ca6"),
            ("Confirmar y descargar", self._confirm_invoice, "#b64b4b"),
            ("Cerrar navegador", self._close_browser, "#9aafc3"),
        ):
            button = ctk.CTkButton(buttons, text=text, command=command, fg_color=color, hover_color=color, width=150)
            button.pack(side="left", padx=5)
            self.buttons.append(button)
        ctk.CTkLabel(actions, textvariable=self.status_var, text_color="#43576b").grid(row=1, column=0, padx=14, pady=(0, 10), sticky="w")

        self.log_text = ctk.CTkTextbox(content, height=180)
        self.log_text.grid(row=5, column=0, padx=14, pady=(8, 14), sticky="ew")
        self.log_text.configure(state="disabled")

    def _entry(self, parent, label: str, variable, row: int, column: int, placeholder: str, show: str | None = None):
        ctk.CTkLabel(parent, text=label, font=ctk.CTkFont(size=13, weight="bold"), text_color="#16324f").grid(row=row, column=column, padx=(12, 8), pady=6, sticky="w")
        return ctk.CTkEntry(parent, textvariable=variable, placeholder_text=placeholder, show=show, width=300)

    def _date_entry(self, parent, label: str, variable, row: int, column: int):
        ctk.CTkLabel(parent, text=label, font=ctk.CTkFont(size=13, weight="bold"), text_color="#16324f").grid(row=row, column=column, padx=(12, 8), pady=6, sticky="w")
        frame = ctk.CTkFrame(parent, fg_color="transparent")
        frame.grid_columnconfigure(0, weight=0)
        ctk.CTkEntry(frame, textvariable=variable, placeholder_text="DD/MM/AAAA", width=130).grid(row=0, column=0, sticky="w")
        ctk.CTkButton(frame, text="...", width=42, command=lambda: self._open_date_picker(variable)).grid(row=0, column=1, padx=(6, 0))
        return frame

    def _open_date_picker(self, variable) -> None:
        dialog = DatePickerDialog(self, variable.get())
        self.wait_window(dialog)
        if dialog.result is not None:
            variable.set(dialog.result)

    def _open_afip(self) -> None:
        profile = self._current_profile_from_form()
        self._run_action(lambda: self.controller.abrir_afip(profile["usuario"], profile["clave"]))

    def _open_pami_liquidacion(self) -> None:
        pami = self._current_pami_from_form()
        self._run_action(lambda: self.pami_controller.abrir_pami(pami["usuario"], pami["clave"]))

    def _buscar_liquidacion_pami(self) -> None:
        pami = self._current_pami_from_form()
        self._run_action(lambda: self._buscar_liquidacion_worker(pami))

    def _buscar_liquidacion_worker(self, pami: dict) -> None:
        result = self.pami_controller.buscar_liquidacion(pami["periodo"], pami["concepto"])
        self.event_queue.put(("pami_liquidacion_done", result))

    def _exportar_detalle_pami(self) -> None:
        pami = self._current_pami_from_form()
        self._run_action(lambda: self._exportar_detalle_worker(pami))

    def _exportar_detalle_worker(self, pami: dict) -> None:
        result = self.pami_controller.descargar_detalle_liquidacion(pami["periodo"], pami["detalle"])
        self.event_queue.put(("pami_detalle_done", result))

    def _close_pami_liquidacion(self) -> None:
        self._run_action(self.pami_controller.cerrar_navegador)

    def _apply_login(self) -> None:
        profile = self._current_profile_from_form()
        self._run_action(lambda: self.controller.autocompletar_login(profile["usuario"], profile["clave"]))

    def _open_rccel(self) -> None:
        profile = self._current_profile_from_form()
        self._run_action(lambda: self.controller.abrir_comprobantes_en_linea(profile["representado"]))

    def _prepare_invoice(self) -> None:
        self._run_action(lambda: self.controller.preparar_factura(self._current_profile_from_form(), self._current_invoice_from_form()))

    def _confirm_invoice(self) -> None:
        if not messagebox.askyesno("Confirmar factura", "Esto confirma la operacion en AFIP y genera el comprobante.\n\n¿Continuar?"):
            return
        self._run_action(lambda: self._confirm_invoice_worker())

    def _confirm_invoice_worker(self) -> None:
        result = self.controller.confirmar_y_descargar(self._current_profile_from_form(), self._current_invoice_from_form())
        self.event_queue.put(("invoice_done", result))

    def _close_browser(self) -> None:
        self._run_action(self.controller.cerrar_navegador)

    def _run_action(self, action) -> None:
        if self.action_running:
            return
        self._ensure_controller_thread()
        self.action_running = True
        self._set_controls_enabled(False)
        self.controller_queue.put(action)

    def _ensure_controller_thread(self) -> None:
        if self.controller_thread is None or not self.controller_thread.is_alive():
            self.controller_thread = threading.Thread(target=self._controller_loop, daemon=True)
            self.controller_thread.start()

    def _controller_loop(self) -> None:
        while True:
            action = self.controller_queue.get()
            if action is None:
                break
            try:
                action()
                self.event_queue.put(("action_finished", None))
            except Exception as exc:
                self.event_queue.put(("action_error", str(exc)))

    def _process_ui_queue(self) -> None:
        had_events = False
        try:
            while True:
                event, payload = self.event_queue.get_nowait()
                had_events = True
                if event == "log":
                    self.log_text.configure(state="normal")
                    self.log_text.insert("end", payload + "\n")
                    self.log_text.see("end")
                    self.log_text.configure(state="disabled")
                elif event == "status":
                    self.status_var.set(payload)
                elif event == "invoice_done":
                    self.status_var.set(f"Factura generada. Carpeta: {payload.get('output_dir', '')}")
                    messagebox.showinfo("Factura generada", f"Archivos guardados en:\n{payload.get('output_dir', '')}")
                elif event == "pami_liquidacion_done":
                    total = str(payload.get("total", "") or "").strip()
                    if total:
                        self.importe_var.set(total)
                    self.status_var.set(f"Liquidacion PAMI exportada: {payload.get('excel', '')}")
                    messagebox.showinfo("PAMI", f"Liquidacion exportada en:\n{payload.get('excel', '')}\n\nTotal detectado: {total or 'no detectado'}")
                elif event == "pami_detalle_done":
                    self.status_var.set(f"Detalle PAMI exportado: {payload.get('excel', '')}")
                    messagebox.showinfo("PAMI", f"Detalle exportado en:\n{payload.get('excel', '')}")
                elif event == "action_finished":
                    self.action_running = False
                    self._set_controls_enabled(True)
                elif event == "action_error":
                    self.action_running = False
                    self._set_controls_enabled(True)
                    self.status_var.set("Ocurrio un error.")
                    self._push_log(f"ERROR: {payload}")
                    messagebox.showerror("AFIP", payload)
        except queue.Empty:
            pass
        delay = 120 if (self.action_running or had_events) else 350
        self.after(delay, self._process_ui_queue)

    def _set_controls_enabled(self, enabled: bool) -> None:
        state = "normal" if enabled else "disabled"
        for button in self.buttons:
            button.configure(state=state)

    def _push_log(self, message: str) -> None:
        self.event_queue.put(("log", message))

    def _push_status(self, message: str) -> None:
        self.event_queue.put(("status", message))

    def _current_profile_from_form(self) -> dict:
        return {
            "nombre": self.nombre_var.get().strip(),
            "usuario": self.usuario_var.get().strip(),
            "clave": self.clave_var.get(),
            "representado": self.representado_var.get().strip(),
            "punto_venta": self.punto_venta_var.get().strip(),
            "tipo_comprobante": self.tipo_comprobante_var.get().strip() or "Factura C",
            "actividad": self.actividad_var.get().strip(),
            "receptor_cuit": self.receptor_cuit_var.get().strip(),
            "receptor_iva": self.receptor_iva_var.get().strip(),
            "receptor_tipo_doc": "CUIT",
            "condicion_venta": self.condicion_venta_var.get().strip(),
        }

    def _current_invoice_from_form(self) -> dict:
        return {
            "fecha_comprobante": self.fecha_comprobante_var.get().strip(),
            "concepto": "Productos y Servicios",
            "periodo_desde": self.periodo_desde_var.get().strip(),
            "periodo_hasta": self.periodo_hasta_var.get().strip(),
            "vencimiento_pago": self.vencimiento_pago_var.get().strip(),
            "descripcion": self.descripcion_var.get().strip(),
            "importe": self.importe_var.get().strip(),
        }

    def _current_pami_from_form(self) -> dict:
        return {
            "usuario": self.pami_usuario_var.get().strip(),
            "clave": self.pami_clave_var.get(),
            "periodo": self.pami_periodo_var.get().strip(),
            "concepto": self.pami_concepto_var.get().strip() or "Todos los Conceptos",
            "detalle": self.pami_detalle_var.get().strip() or "Errores de Transmision",
        }

    def _set_default_invoice_dates(self) -> None:
        today = datetime.now()
        prev_month = today.month - 1 or 12
        year = today.year if today.month != 1 else today.year - 1
        last_day = calendar.monthrange(year, prev_month)[1]
        fecha_comprobante = today
        if fecha_comprobante.day <= 2:
            fecha_comprobante = fecha_comprobante + timedelta(days=1)
        self.fecha_comprobante_var.set(fecha_comprobante.strftime("%d/%m/%Y"))
        self.periodo_desde_var.set(f"01/{prev_month:02d}/{year}")
        self.periodo_hasta_var.set(f"{last_day:02d}/{prev_month:02d}/{year}")
        self.descripcion_var.set(f"CONSULTAS DC {prev_month:02d}-{str(year)[-2:]}")
        self.pami_periodo_var.set(f"{prev_month:02d}/{year}")

    def _load_saved_profiles(self) -> list[dict]:
        try:
            if not self.profiles_file.exists():
                return []
            data = json.loads(self.profiles_file.read_text(encoding="utf-8"))
            return [item for item in data.get("usuarios", []) if isinstance(item, dict) and item.get("usuario")]
        except Exception:
            return []

    def _save_saved_profiles(self) -> None:
        self.profiles_file.write_text(json.dumps({"usuarios": self.saved_profiles[:30]}, ensure_ascii=False, indent=2), encoding="utf-8")

    def _save_current_profile(self) -> None:
        profile = self._current_profile_from_form()
        if not profile["usuario"]:
            messagebox.showwarning("Perfil", "Ingresa el CUIT/CUIL para guardar el perfil.")
            return
        self.saved_profiles = [item for item in self.saved_profiles if item.get("usuario", "").lower() != profile["usuario"].lower()]
        self.saved_profiles.insert(0, profile)
        self._save_saved_profiles()
        self.profile_combo.configure(values=self._profile_options() or [""])
        self.profile_var.set(self._format_profile_entry(profile))
        self._push_log(f"Perfil AFIP guardado: {profile['usuario']}")

    def _delete_current_profile(self) -> None:
        usuario = self.usuario_var.get().strip()
        if not usuario:
            return
        self.saved_profiles = [item for item in self.saved_profiles if item.get("usuario", "").lower() != usuario.lower()]
        self._save_saved_profiles()
        self.profile_combo.configure(values=self._profile_options() or [""])
        self._new_profile()

    def _profile_options(self) -> list[str]:
        return [self._format_profile_entry(item) for item in self.saved_profiles]

    def _format_profile_entry(self, item: dict) -> str:
        usuario = item.get("usuario", "").strip()
        nombre = item.get("nombre", "").strip()
        return f"{usuario} - {nombre}" if usuario and nombre else usuario

    def _on_profile_selected(self, selected: str) -> None:
        usuario = selected.split(" - ", 1)[0].strip()
        for profile in self.saved_profiles:
            if profile.get("usuario", "").lower() == usuario.lower():
                self.nombre_var.set(profile.get("nombre", ""))
                self.usuario_var.set(profile.get("usuario", ""))
                self.clave_var.set(profile.get("clave", ""))
                self.representado_var.set(profile.get("representado", ""))
                self.punto_venta_var.set(profile.get("punto_venta", "00002"))
                self.actividad_var.set(profile.get("actividad", "869090 - SERVICIOS RELACIONADOS CON LA SALUD"))
                self.receptor_cuit_var.set(profile.get("receptor_cuit", DEFAULT_RECEPTOR_CUIT))
                self.receptor_iva_var.set(profile.get("receptor_iva", DEFAULT_RECEPTOR_IVA))
                self.condicion_venta_var.set(profile.get("condicion_venta", DEFAULT_CONDICION_VENTA))
                break

    def _load_initial_profile_into_form(self) -> None:
        if self.saved_profiles:
            self._on_profile_selected(self._format_profile_entry(self.saved_profiles[0]))
            self.profile_var.set(self._format_profile_entry(self.saved_profiles[0]))
        else:
            self._new_profile()

    def _new_profile(self) -> None:
        self.profile_var.set("")
        self.nombre_var.set("")
        self.usuario_var.set("")
        self.clave_var.set("")
        self.representado_var.set("")
        self.punto_venta_var.set("00002")
        self.actividad_var.set("869090 - SERVICIOS RELACIONADOS CON LA SALUD")
        self.receptor_cuit_var.set(DEFAULT_RECEPTOR_CUIT)
        self.receptor_iva_var.set(DEFAULT_RECEPTOR_IVA)
        self.condicion_venta_var.set(DEFAULT_CONDICION_VENTA)

    def _toggle_password_visibility(self) -> None:
        self.password_visible = not self.password_visible
        self.password_entry.configure(show="" if self.password_visible else "*")

    def _toggle_pami_password_visibility(self) -> None:
        self.pami_password_visible = not self.pami_password_visible
        self.pami_password_entry.configure(show="" if self.pami_password_visible else "*")

    def _go_home(self) -> None:
        if self.on_back:
            self.on_back()

    def on_close(self) -> None:
        try:
            if self.controller_thread is not None and self.controller_thread.is_alive():
                self.controller_queue.put(self.controller.cerrar)
                self.controller_queue.put(self.pami_controller.cerrar)
                self.controller_queue.put(None)
        except Exception:
            pass
        finally:
            self.destroy()
