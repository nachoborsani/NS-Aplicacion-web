import json
import queue
import threading
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import customtkinter as ctk

from app_credentials import sync_profile_records, upsert_shared_credentials_from_records
from app_paths import get_data_dir, get_log_file, get_output_dir
from app_transmision import DatePickerDialog
from pami_liberar_cupo import PamiLiberarCupoController, ResumenLiberacion, exportar_reporte_no_validadas


class PamiLiberarCupoModuleFrame(ctk.CTkFrame):
    def __init__(self, master, on_back=None) -> None:
        super().__init__(master, fg_color="#eef3f8")
        self.on_back = on_back
        self.event_queue: queue.Queue = queue.Queue()
        self.controller_queue: queue.Queue = queue.Queue()
        self.action_running = False
        self.password_visible = False
        self.detected_rows: list[dict] = []
        self.data_dir = get_data_dir()
        self.profiles_file = Path(self.data_dir) / "usuarios_liberar_cupo.json"
        self.saved_profiles = self._load_saved_profiles()
        self.controller = PamiLiberarCupoController(
            log_callback=self._push_log,
            status_callback=self._push_status,
        )
        self.controller_thread: threading.Thread | None = None

        self._build_ui()
        self.after(150, self._process_ui_queue)

    def _build_ui(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(self, corner_radius=8, fg_color="#f7fafc", border_width=1, border_color="#d8e2ec")
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
            text="Liberar Cupo PAMI",
            font=ctk.CTkFont(size=20, weight="bold"),
            text_color="#16324f",
        ).grid(row=0, column=1, padx=10, pady=(8, 2), sticky="w")
        ctk.CTkLabel(
            header,
            text="Detecta OMEs no validadas en Panel de prestaciones y cancela su aceptacion para liberar cupo.",
            font=ctk.CTkFont(size=11),
            text_color="#51657a",
        ).grid(row=1, column=1, padx=10, pady=(0, 8), sticky="w")

        content = ctk.CTkScrollableFrame(self, corner_radius=8, fg_color="#ffffff")
        content.grid(row=1, column=0, padx=8, pady=(0, 8), sticky="nsew")
        content.grid_columnconfigure(0, weight=1)
        content.grid_rowconfigure(3, weight=1)

        profile_frame = ctk.CTkFrame(content, corner_radius=8, fg_color="#f4f8fb", border_width=1, border_color="#d8e2ec")
        profile_frame.grid(row=0, column=0, padx=8, pady=(6, 5), sticky="ew")
        profile_frame.grid_columnconfigure(1, weight=0)
        profile_frame.grid_columnconfigure(3, weight=0)
        profile_frame.grid_columnconfigure(4, weight=1)

        self.profile_var = ctk.StringVar(value="")
        self.profile_name_var = ctk.StringVar(value="")
        self.profile_user_var = ctk.StringVar(value="")
        self.profile_password_var = ctk.StringVar(value="")
        self.hide_browser_var = ctk.BooleanVar(value=True)

        ctk.CTkLabel(profile_frame, text="Perfil", text_color="#16324f", font=ctk.CTkFont(size=14, weight="bold")).grid(row=0, column=0, padx=(12, 8), pady=(8, 4), sticky="w")
        self.profile_combo = ctk.CTkComboBox(
            profile_frame,
            values=self._profile_options() or [""],
            variable=self.profile_var,
            command=self._on_profile_selected,
            width=360,
            height=28,
        )
        self.profile_combo.grid(row=0, column=1, padx=(0, 12), pady=(8, 4), sticky="w")
        self.new_profile_button = ctk.CTkButton(profile_frame, text="Nuevo", width=86, height=28, command=self._new_profile)
        self.new_profile_button.grid(row=0, column=2, padx=(0, 8), pady=(8, 4))
        self.delete_profile_button = ctk.CTkButton(profile_frame, text="Borrar", width=86, height=28, fg_color="#9aafc3", hover_color="#7f95aa", command=self._delete_current_profile)
        self.delete_profile_button.grid(row=0, column=3, padx=(0, 12), pady=(8, 4), sticky="w")

        ctk.CTkLabel(profile_frame, text="Cliente").grid(row=1, column=0, padx=(12, 8), pady=4, sticky="e")
        self.client_entry = ctk.CTkEntry(profile_frame, textvariable=self.profile_name_var, width=360, height=28)
        self.client_entry.grid(row=1, column=1, padx=(0, 12), pady=4, sticky="w")
        ctk.CTkLabel(profile_frame, text="Usuario").grid(row=1, column=2, padx=(0, 8), pady=4, sticky="e")
        self.user_entry = ctk.CTkEntry(profile_frame, textvariable=self.profile_user_var, width=250, height=28)
        self.user_entry.grid(row=1, column=3, padx=(0, 12), pady=4, sticky="w")

        ctk.CTkLabel(profile_frame, text="Clave").grid(row=2, column=0, padx=(12, 8), pady=(4, 8), sticky="e")
        self.password_entry = ctk.CTkEntry(profile_frame, textvariable=self.profile_password_var, show="*", width=360, height=28)
        self.password_entry.grid(row=2, column=1, padx=(0, 12), pady=(4, 8), sticky="w")
        self.toggle_password_button = ctk.CTkButton(profile_frame, text="Ver", width=70, height=28, command=self._toggle_password_visibility)
        self.toggle_password_button.grid(row=2, column=2, padx=(0, 8), pady=(4, 8))
        self.save_profile_button = ctk.CTkButton(profile_frame, text="Guardar perfil", width=130, height=28, command=self._save_current_profile, fg_color="#4f6378", hover_color="#3d4d61")
        self.save_profile_button.grid(row=2, column=3, padx=(0, 12), pady=(4, 8), sticky="w")

        filter_frame = ctk.CTkFrame(content, corner_radius=12, fg_color="#f8fafc")
        filter_frame.grid(row=1, column=0, padx=14, pady=(0, 8), sticky="ew")
        filter_frame.grid_columnconfigure(8, weight=1)

        self.fecha_desde_var = ctk.StringVar(value=self._today_str())
        self.fecha_hasta_var = ctk.StringVar(value=self._today_str())
        self.max_pages_var = ctk.StringVar(value="10")

        ctk.CTkLabel(filter_frame, text="Turno desde").grid(row=0, column=0, padx=(12, 6), pady=8, sticky="w")
        self.fecha_desde_entry = ctk.CTkEntry(filter_frame, textvariable=self.fecha_desde_var, width=118, height=28)
        self.fecha_desde_entry.grid(row=0, column=1, padx=(0, 4), pady=8, sticky="w")
        self.fecha_desde_button = ctk.CTkButton(filter_frame, text="...", width=34, height=28, command=lambda: self._open_date_picker(self.fecha_desde_var))
        self.fecha_desde_button.grid(row=0, column=2, padx=(0, 18), pady=8, sticky="w")

        ctk.CTkLabel(filter_frame, text="Turno hasta").grid(row=0, column=3, padx=(0, 6), pady=8, sticky="w")
        self.fecha_hasta_entry = ctk.CTkEntry(filter_frame, textvariable=self.fecha_hasta_var, width=118, height=28)
        self.fecha_hasta_entry.grid(row=0, column=4, padx=(0, 4), pady=8, sticky="w")
        self.fecha_hasta_button = ctk.CTkButton(filter_frame, text="...", width=34, height=28, command=lambda: self._open_date_picker(self.fecha_hasta_var))
        self.fecha_hasta_button.grid(row=0, column=5, padx=(0, 18), pady=8, sticky="w")

        ctk.CTkLabel(filter_frame, text="Max. paginas").grid(row=0, column=6, padx=(0, 6), pady=8, sticky="w")
        self.max_pages_entry = ctk.CTkEntry(filter_frame, textvariable=self.max_pages_var, width=70, height=28)
        self.max_pages_entry.grid(row=0, column=7, padx=(0, 12), pady=8, sticky="w")

        buttons = ctk.CTkFrame(content, corner_radius=12, fg_color="#eef3f8")
        buttons.grid(row=2, column=0, padx=14, pady=(0, 10), sticky="ew")
        buttons.grid_columnconfigure(8, weight=1)

        self.detect_button = ctk.CTkButton(buttons, text="Detectar no validadas", width=170, command=self._detect_candidates)
        self.detect_button.grid(row=0, column=0, padx=(12, 6), pady=12)
        self.release_selected_button = ctk.CTkButton(buttons, text="Liberar seleccionadas", width=170, fg_color="#c56c6c", hover_color="#a95555", command=self._release_selected)
        self.release_selected_button.grid(row=0, column=1, padx=6, pady=12)
        self.release_all_button = ctk.CTkButton(buttons, text="Liberar todas", width=130, fg_color="#b45b5b", hover_color="#944848", command=self._release_all)
        self.release_all_button.grid(row=0, column=2, padx=6, pady=12)
        self.export_report_button = ctk.CTkButton(buttons, text="Descargar reporte", width=150, fg_color="#4f6378", hover_color="#3d4d61", command=self._export_detected_report)
        self.export_report_button.grid(row=0, column=3, padx=6, pady=12)
        self.stop_button = ctk.CTkButton(buttons, text="Detener", width=100, fg_color="#9aafc3", hover_color="#7f95aa", command=self.controller.solicitar_detencion)
        self.stop_button.grid(row=0, column=4, padx=6, pady=12)
        self.close_button = ctk.CTkButton(buttons, text="Cerrar navegador", width=140, fg_color="#4f6378", hover_color="#3d4d61", command=lambda: self._run_action(self.controller.cerrar_navegador))
        self.close_button.grid(row=0, column=5, padx=6, pady=12)
        self.hide_browser_checkbox = ctk.CTkCheckBox(buttons, text="No ver navegador", variable=self.hide_browser_var)
        self.hide_browser_checkbox.grid(row=0, column=6, padx=(10, 12), pady=12)

        status_frame = ctk.CTkFrame(content, corner_radius=12, fg_color="#f8fafc")
        status_frame.grid(row=3, column=0, padx=14, pady=(0, 10), sticky="nsew")
        status_frame.grid_columnconfigure(0, weight=1)
        status_frame.grid_rowconfigure(2, weight=1)
        self.status_label = ctk.CTkLabel(status_frame, text="Preparado para detectar cupos ocupados por OMEs no validadas.", font=ctk.CTkFont(size=14, weight="bold"), text_color="#16324f")
        self.status_label.grid(row=0, column=0, padx=12, pady=(10, 4), sticky="w")
        self.summary_label = ctk.CTkLabel(status_frame, text=f"Log en: {get_log_file()}", text_color="#4f6378")
        self.summary_label.grid(row=1, column=0, padx=12, pady=(0, 8), sticky="w")

        table_container = ctk.CTkFrame(status_frame, corner_radius=10, fg_color="#ffffff")
        table_container.grid(row=2, column=0, padx=12, pady=(0, 10), sticky="nsew")
        table_container.grid_columnconfigure(0, weight=1)
        table_container.grid_rowconfigure(0, weight=1)

        columns = ("orden", "turno", "beneficio", "nombre", "practica", "estado")
        self.tree = ttk.Treeview(table_container, columns=columns, show="headings", height=12)
        headings = {
            "orden": "Nro. OME",
            "turno": "Turno",
            "beneficio": "Beneficio/GP",
            "nombre": "Paciente",
            "practica": "Practica",
            "estado": "Estado",
        }
        widths = {"orden": 120, "turno": 155, "beneficio": 120, "nombre": 210, "practica": 420, "estado": 160}
        for col in columns:
            self.tree.heading(col, text=headings[col])
            self.tree.column(col, width=widths[col], anchor="w", stretch=col in {"nombre", "practica"})
        self.tree.grid(row=0, column=0, sticky="nsew")
        scrollbar = ttk.Scrollbar(table_container, orient="vertical", command=self.tree.yview)
        scrollbar.grid(row=0, column=1, sticky="ns")
        self.tree.configure(yscrollcommand=scrollbar.set)

        self.log_text = ctk.CTkTextbox(content, height=130)
        self.log_text.grid(row=4, column=0, padx=14, pady=(0, 14), sticky="ew")
        self.log_text.configure(state="disabled")

        self._load_initial_profile_into_form()

    def _detect_candidates(self) -> None:
        self._run_action(
            self._open_if_needed_and_detect,
            result_event="detected",
        )

    def _release_selected(self) -> None:
        selected = list(self.tree.selection())
        if not selected:
            messagebox.showwarning("Liberar Cupo", "Selecciona una o mas OMEs de la tabla.")
            return
        rows = [self.detected_rows[int(iid)] for iid in selected if iid.isdigit() and int(iid) < len(self.detected_rows)]
        self._confirm_and_release(rows)

    def _release_all(self) -> None:
        self._confirm_and_release(list(self.detected_rows))

    def _export_detected_report(self) -> None:
        if not self.detected_rows:
            messagebox.showwarning("Reporte", "Primero detecta OMEs no validadas para exportar.")
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
                self.detected_rows,
                destino,
                {
                    "fecha_desde": self.fecha_desde_var.get().strip(),
                    "fecha_hasta": self.fecha_hasta_var.get().strip(),
                },
            )
            self.summary_label.configure(text=f"Reporte guardado en: {output}")
            self._push_log(f"Reporte de no validadas exportado: {output}")
            messagebox.showinfo("Reporte", f"Reporte guardado:\n{output}")
        except Exception as exc:
            messagebox.showerror("Reporte", f"No se pudo guardar el reporte:\n{exc}")

    def _confirm_and_release(self, rows: list[dict]) -> None:
        if not rows:
            messagebox.showwarning("Liberar Cupo", "No hay OMEs detectadas para liberar.")
            return
        if not messagebox.askyesno(
            "Confirmar liberacion",
            f"Se cancelara la aceptacion de {len(rows)} OME(s) en PAMI.\n\nEsto libera el cupo del turno. Continuar?",
        ):
            return
        self._run_action(lambda: self._open_if_needed_and_release(rows), result_event="released")

    def _open_pami_with_profile(self) -> None:
        profile = self._current_profile_from_form()
        if self.hide_browser_var.get() and (not profile["usuario"] or not profile["clave"]):
            raise RuntimeError("Para usar 'No ver navegador' debes completar usuario y clave.")
        if profile["usuario"]:
            self._upsert_profile(profile)
        self.controller.abrir_pami(
            usuario=profile["usuario"] or None,
            clave=profile["clave"] or None,
            headless=self.hide_browser_var.get(),
        )

    def _open_if_needed_and_detect(self) -> list[dict]:
        if not self.controller.sesion_activa():
            self._open_pami_with_profile()
        return self.controller.detectar_candidatas(
            self.fecha_desde_var.get().strip(),
            self.fecha_hasta_var.get().strip(),
            self._max_pages(),
        )

    def _open_if_needed_and_release(self, rows: list[dict]) -> ResumenLiberacion:
        if not self.controller.sesion_activa():
            self._open_pami_with_profile()
        return self.controller.liberar_omes(rows)

    def _run_action(self, action, *, result_event: str | None = None) -> None:
        if self.action_running:
            return
        self._ensure_controller_thread()
        self.action_running = True
        self._set_controls_enabled(False)
        self.controller_queue.put((action, result_event))

    def _ensure_controller_thread(self) -> None:
        if self.controller_thread is None or not self.controller_thread.is_alive():
            self.controller_thread = threading.Thread(target=self._controller_loop, daemon=True)
            self.controller_thread.start()

    def _controller_loop(self) -> None:
        while True:
            item = self.controller_queue.get()
            if item is None:
                break
            action, result_event = item
            try:
                result = action()
                if result_event:
                    self.event_queue.put((result_event, result))
                self.event_queue.put(("action_finished", None))
            except Exception as exc:
                self.event_queue.put(("action_error", str(exc)))

    def _process_ui_queue(self) -> None:
        try:
            while True:
                event, payload = self.event_queue.get_nowait()
                if event == "log":
                    self.log_text.configure(state="normal")
                    self.log_text.insert("end", str(payload) + "\n")
                    self.log_text.see("end")
                    self.log_text.configure(state="disabled")
                elif event == "status":
                    self.status_label.configure(text=str(payload))
                elif event == "detected":
                    rows = payload or []
                    self._render_detected(rows)
                    self.after(
                        100,
                        lambda total=len(rows): messagebox.showinfo(
                            "Liberar Cupo",
                            f"Proceso terminado.\n\nDetectadas {total} OME(s) no validadas.",
                        ),
                    )
                elif event == "released":
                    self._render_release_summary(payload)
                    ok = getattr(payload, "ok", 0)
                    errores = getattr(payload, "errores", 0)
                    omitidos = getattr(payload, "omitidos", 0)
                    self.after(
                        100,
                        lambda ok=ok, errores=errores, omitidos=omitidos: messagebox.showinfo(
                            "Liberar Cupo",
                            f"Proceso terminado.\n\nLiberadas: {ok}\nErrores: {errores}\nOmitidas: {omitidos}",
                        ),
                    )
                elif event == "action_finished":
                    self.action_running = False
                    self._set_controls_enabled(True)
                elif event == "action_error":
                    self.action_running = False
                    self._set_controls_enabled(True)
                    self.status_label.configure(text="Ocurrio un error.")
                    message = self._friendly_error_message(str(payload))
                    self._push_log(f"ERROR: {message}")
                    messagebox.showerror("Error", message)
        except queue.Empty:
            pass
        self.after(150 if self.action_running else 350, self._process_ui_queue)

    def _friendly_error_message(self, message: str) -> str:
        raw = str(message or "")
        lowered = raw.lower()
        if "target page, context or browser has been closed" in lowered:
            return "El navegador de PAMI se cerro durante el proceso. Volve a ejecutar la deteccion o la liberacion para reabrir la sesion."
        if "primero abre pami" in lowered:
            return "No hay una sesion activa de PAMI. Ejecuta Detectar no validadas para abrir PAMI automaticamente."
        return raw

    def _render_detected(self, rows: list[dict]) -> None:
        self.detected_rows = list(rows)
        for item in self.tree.get_children():
            self.tree.delete(item)
        for idx, row in enumerate(self.detected_rows):
            self.tree.insert(
                "",
                "end",
                iid=str(idx),
                values=(
                    row.get("n_orden", ""),
                    row.get("turno", ""),
                    row.get("beneficio", ""),
                    row.get("nombre", ""),
                    row.get("practica", ""),
                    "No validada / pendiente de liberar",
                ),
            )
        self.summary_label.configure(text=f"Detectadas: {len(self.detected_rows)} | Selecciona filas para liberar cupo.")

    def _render_release_summary(self, resumen: ResumenLiberacion | None) -> None:
        if resumen is None:
            return
        self.summary_label.configure(text=f"Liberadas: {resumen.ok} | Errores: {resumen.errores} | Omitidas: {resumen.omitidos}")
        for item in resumen.detalle:
            self._push_log(self._format_release_log_item(item))

    def _format_release_log_item(self, item) -> str:
        orden = getattr(item, "n_orden", "") or "-"
        vencimiento = getattr(item, "f_vencimiento", "") or ""
        estado = getattr(item, "estado", "") or ""
        mensaje = getattr(item, "mensaje", "") or ""
        if estado == "LIBERADA":
            suffix = f" | venc. {vencimiento}" if vencimiento else ""
            return f"OME {orden}{suffix}: cupo liberado OK."
        if estado == "OMITIDA":
            suffix = f" | venc. {vencimiento}" if vencimiento else ""
            return f"OME {orden}{suffix}: omitida - {mensaje}"
        return f"OME {orden}: ERROR - {mensaje}"

    def _set_controls_enabled(self, enabled: bool) -> None:
        state = "normal" if enabled else "disabled"
        for button in (
            self.detect_button,
            self.release_selected_button,
            self.release_all_button,
            self.export_report_button,
            self.close_button,
            self.save_profile_button,
            self.new_profile_button,
            self.delete_profile_button,
            self.toggle_password_button,
            self.fecha_desde_button,
            self.fecha_hasta_button,
        ):
            button.configure(state=state)
        self.profile_combo.configure(state=state)
        self.client_entry.configure(state=state)
        self.user_entry.configure(state=state)
        self.password_entry.configure(state=state)
        self.fecha_desde_entry.configure(state=state)
        self.fecha_hasta_entry.configure(state=state)
        self.max_pages_entry.configure(state=state)
        self.hide_browser_checkbox.configure(state=state)

    def _push_log(self, message: str) -> None:
        self.event_queue.put(("log", message))

    def _push_status(self, message: str) -> None:
        self.event_queue.put(("status", message))

    def _max_pages(self) -> int:
        try:
            return max(1, min(50, int(self.max_pages_var.get().strip() or "10")))
        except ValueError:
            return 10

    def _open_date_picker(self, target_var: ctk.StringVar) -> None:
        dialog = DatePickerDialog(self, target_var.get().strip())
        self.wait_window(dialog)
        if dialog.result is not None:
            target_var.set(dialog.result)

    def _today_str(self) -> str:
        return datetime.now().strftime("%d/%m/%Y")

    def _toggle_password_visibility(self) -> None:
        self.password_visible = not self.password_visible
        self.password_entry.configure(show="" if self.password_visible else "*")
        self.toggle_password_button.configure(text="Ocultar" if self.password_visible else "Ver")

    def _current_profile_from_form(self) -> dict:
        return {
            "nombre": self.profile_name_var.get().strip(),
            "usuario": self.profile_user_var.get().strip(),
            "clave": self.profile_password_var.get(),
        }

    def _load_saved_profiles(self) -> list[dict]:
        try:
            if not self.profiles_file.exists():
                return []
            data = json.loads(self.profiles_file.read_text(encoding="utf-8"))
            profiles = data.get("usuarios", [])
            normalizados = []
            for item in profiles:
                if not isinstance(item, dict):
                    continue
                usuario = str(item.get("usuario", "")).strip()
                if usuario:
                    normalizados.append(
                        {
                            "nombre": str(item.get("nombre", "")).strip(),
                            "usuario": usuario,
                            "clave": str(item.get("clave", "")),
                        }
                    )
            return sync_profile_records(normalizados)
        except Exception:
            return []

    def _save_saved_profiles(self) -> None:
        self.profiles_file.write_text(json.dumps({"usuarios": self.saved_profiles[:20]}, ensure_ascii=False, indent=2), encoding="utf-8")
        upsert_shared_credentials_from_records(self.saved_profiles[:20])

    def _profile_options(self) -> list[str]:
        return [self._format_profile_entry(item) for item in self.saved_profiles]

    def _format_profile_entry(self, item: dict) -> str:
        nombre = str(item.get("nombre", "")).strip()
        usuario = str(item.get("usuario", "")).strip()
        return f"{nombre} - {usuario}" if nombre else usuario

    def _on_profile_selected(self, selected: str | None = None) -> None:
        usuario = (selected or self.profile_var.get() or "").split(" - ")[-1].strip()
        for profile in self.saved_profiles:
            if profile.get("usuario", "").lower() == usuario.lower():
                self.profile_name_var.set(profile.get("nombre", ""))
                self.profile_user_var.set(profile.get("usuario", ""))
                self.profile_password_var.set(profile.get("clave", ""))
                return

    def _load_initial_profile_into_form(self) -> None:
        if self.saved_profiles:
            first = self._format_profile_entry(self.saved_profiles[0])
            self.profile_var.set(first)
            self._on_profile_selected(first)
        else:
            self._new_profile()

    def _new_profile(self) -> None:
        self.profile_var.set("")
        self.profile_name_var.set("")
        self.profile_user_var.set("")
        self.profile_password_var.set("")

    def _upsert_profile(self, profile: dict) -> None:
        usuario = profile["usuario"].strip()
        if not usuario:
            return
        self.saved_profiles = [p for p in self.saved_profiles if p["usuario"].lower() != usuario.lower()]
        self.saved_profiles.insert(0, {"nombre": profile["nombre"], "usuario": usuario, "clave": profile["clave"]})
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
        self._push_log(f"Perfil guardado: {profile['usuario']}")

    def _delete_current_profile(self) -> None:
        profile = self._current_profile_from_form()
        usuario = profile["usuario"].strip()
        if not usuario:
            messagebox.showwarning("Perfil", "No hay un perfil seleccionado para borrar.")
            return
        if not messagebox.askyesno("Borrar perfil", f"Borrar perfil {usuario}?"):
            return
        self.saved_profiles = [p for p in self.saved_profiles if p["usuario"].lower() != usuario.lower()]
        self._save_saved_profiles()
        self.profile_combo.configure(values=self._profile_options() or [""])
        self._load_initial_profile_into_form()

    def _go_home(self) -> None:
        if self.action_running:
            messagebox.showwarning("Atencion", "Espera a que termine la accion actual antes de volver.")
            return
        if self.on_back:
            self.on_back()

    def on_close(self) -> None:
        try:
            self.controller_queue.put((self.controller.cerrar, None))
            self.controller_queue.put(None)
        except Exception:
            pass
