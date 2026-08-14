import tkinter as tk
from tkinter import messagebox

import customtkinter as ctk

from app_settings import (
    DEFAULT_PANEL_RAPIDO_CONFIG,
    build_record_display,
    get_profile_sections,
    load_medicos_config,
    load_panel_rapido_config,
    load_profile_records,
    save_medicos_config,
    save_panel_rapido_config,
    save_profile_records,
)
from app_theme import (
    BACK,
    BACK_HOVER,
    BORDER,
    RADIUS,
    SECTION_BG,
    SURFACE,
    SURFACE_ALT,
    TEXT,
    TEXT_MUTED,
    title_font,
    section_title_font,
    small_font,
)


class SettingsFrame(ctk.CTkFrame):
    def __init__(self, master, on_back, on_settings_saved) -> None:
        super().__init__(master, fg_color="transparent")
        self.on_back = on_back
        self.on_settings_saved = on_settings_saved
        self.profile_sections = get_profile_sections()
        self.medicos = load_medicos_config()
        self.panel_rapido_config = load_panel_rapido_config()
        self.active_section = "medicos"
        self.profile_records = {key: load_profile_records(key) for key in self.profile_sections}
        self.field_vars: dict[str, ctk.StringVar] = {}
        self.field_entries: dict[str, ctk.CTkEntry] = {}
        self.password_visible = False
        self.section_buttons: dict[str, ctk.CTkButton] = {}

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)
        self._build_ui()
        self._set_section("medicos")

    def _build_ui(self) -> None:
        top = ctk.CTkFrame(self, corner_radius=RADIUS, fg_color=SURFACE_ALT, border_width=1, border_color=BORDER)
        top.grid(row=0, column=0, padx=8, pady=(6, 6), sticky="ew")
        top.grid_columnconfigure(1, weight=1)

        ctk.CTkButton(top, text="Volver", width=78, command=self.on_back, fg_color=BACK, hover_color=BACK_HOVER).grid(
            row=0, column=0, padx=(8, 10), pady=6, sticky="w"
        )
        ctk.CTkLabel(top, text="Configuracion", font=title_font(20), text_color=TEXT).grid(
            row=0, column=1, padx=(0, 12), pady=(6, 1), sticky="w"
        )
        ctk.CTkLabel(
            top,
            text="Administra medicos, usuarios y claves desde un solo panel. Los cambios se guardan en el momento.",
            font=small_font(11),
            text_color=TEXT_MUTED,
        ).grid(row=1, column=1, padx=(0, 12), pady=(0, 7), sticky="w")

        body = ctk.CTkFrame(self, corner_radius=RADIUS, fg_color=SURFACE, border_width=1, border_color=BORDER)
        body.grid(row=1, column=0, padx=8, pady=(0, 8), sticky="nsew")
        body.grid_columnconfigure(1, weight=1)
        body.grid_rowconfigure(1, weight=1)

        sidebar = ctk.CTkFrame(body, corner_radius=RADIUS, fg_color=SECTION_BG, border_width=1, border_color=BORDER)
        sidebar.grid(row=0, column=0, rowspan=2, padx=(10, 8), pady=10, sticky="ns")
        sidebar.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(sidebar, text="Secciones", font=section_title_font(15), text_color=TEXT).grid(
            row=0, column=0, padx=10, pady=(10, 6), sticky="w"
        )

        sections = [("medicos", "Medicos"), ("panel_rapido", "Panel Rapido")] + [
            (key, data["title"]) for key, data in self.profile_sections.items()
        ]
        for row_index, (section_key, label) in enumerate(sections, start=1):
            button = ctk.CTkButton(
                sidebar,
                text=label,
                command=lambda value=section_key: self._set_section(value),
                anchor="w",
                fg_color="#d7e2ee",
                hover_color="#b9cada",
                text_color=TEXT,
            )
            button.grid(row=row_index, column=0, padx=10, pady=3, sticky="ew")
            self.section_buttons[section_key] = button

        self.title_label = ctk.CTkLabel(body, text="", font=section_title_font(16), text_color=TEXT)
        self.title_label.grid(row=0, column=1, padx=12, pady=(12, 4), sticky="w")

        self.subtitle_label = ctk.CTkLabel(
            body,
            text="",
            font=small_font(11),
            text_color=TEXT_MUTED,
            wraplength=920,
            justify="left",
        )
        self.subtitle_label.grid(row=0, column=1, padx=12, pady=(0, 8), sticky="w")

        content = ctk.CTkFrame(body, corner_radius=RADIUS, fg_color=SURFACE)
        content.grid(row=1, column=1, padx=(0, 10), pady=(0, 10), sticky="nsew")
        content.grid_columnconfigure(0, weight=1)
        content.grid_columnconfigure(1, weight=1)
        content.grid_rowconfigure(1, weight=1)

        ctk.CTkLabel(content, text="Registros", font=section_title_font(15), text_color=TEXT).grid(
            row=0, column=0, padx=10, pady=(10, 6), sticky="w"
        )
        ctk.CTkLabel(content, text="Editor", font=section_title_font(15), text_color=TEXT).grid(
            row=0, column=1, padx=10, pady=(10, 6), sticky="w"
        )

        list_frame = ctk.CTkFrame(content, corner_radius=RADIUS, fg_color=SECTION_BG, border_width=1, border_color=BORDER)
        list_frame.grid(row=1, column=0, padx=(10, 6), pady=(0, 10), sticky="nsew")
        list_frame.grid_columnconfigure(0, weight=1)
        list_frame.grid_rowconfigure(0, weight=1)

        self.listbox = tk.Listbox(
            list_frame,
            font=("Segoe UI", 11),
            activestyle="none",
            exportselection=False,
            selectmode=tk.SINGLE,
            bd=0,
            highlightthickness=0,
        )
        self.listbox.grid(row=0, column=0, padx=(12, 0), pady=12, sticky="nsew")
        self.listbox.bind("<<ListboxSelect>>", self._on_select)

        scrollbar = tk.Scrollbar(list_frame, orient="vertical", command=self.listbox.yview, width=18)
        scrollbar.grid(row=0, column=1, padx=(0, 12), pady=12, sticky="ns")
        self.listbox.configure(yscrollcommand=scrollbar.set)

        editor = ctk.CTkScrollableFrame(content, corner_radius=RADIUS, fg_color=SECTION_BG)
        editor.grid(row=1, column=1, padx=(6, 10), pady=(0, 10), sticky="nsew")
        editor.grid_columnconfigure(0, weight=1)
        self.editor_frame = editor

        self.info_label = ctk.CTkLabel(
            editor,
            text="",
            font=small_font(11),
            text_color=TEXT_MUTED,
            wraplength=420,
            justify="left",
        )

        self._build_editor_buttons()

    def _build_editor_buttons(self) -> None:
        buttons = ctk.CTkFrame(self.editor_frame, corner_radius=RADIUS, fg_color=SECTION_BG, border_width=1, border_color=BORDER)
        buttons.grid(row=999, column=0, padx=10, pady=(8, 10), sticky="ew")
        buttons.grid_columnconfigure((0, 1), weight=1)

        self.add_button = ctk.CTkButton(buttons, text="Agregar", command=self._add_record)
        self.add_button.grid(row=0, column=0, padx=8, pady=(8, 6), sticky="ew")

        self.update_button = ctk.CTkButton(buttons, text="Actualizar seleccionado", command=self._update_selected)
        self.update_button.grid(row=0, column=1, padx=8, pady=(8, 6), sticky="ew")

        self.delete_button = ctk.CTkButton(
            buttons,
            text="Eliminar seleccionado",
            fg_color="#c56c6c",
            hover_color="#a95555",
            command=self._delete_selected,
        )
        self.delete_button.grid(row=1, column=0, columnspan=2, padx=10, pady=(0, 8), sticky="ew")

        self.clear_button = ctk.CTkButton(
            buttons,
            text="Limpiar formulario",
            fg_color=BACK,
            hover_color=BACK_HOVER,
            command=self._clear_form,
        )
        self.clear_button.grid(row=2, column=0, columnspan=2, padx=8, pady=(0, 8), sticky="ew")

    def refresh_shared_credentials(self) -> None:
        self.profile_records = {key: load_profile_records(key) for key in self.profile_sections}
        if self.active_section not in {"medicos", "panel_rapido"}:
            self._reload_listbox()
            self._clear_form()

    def _set_section(self, section_key: str) -> None:
        self.active_section = section_key
        self.password_visible = False

        titles = {
            "medicos": (
                "Medicos para clasificacion",
                "Impactan en el modulo de padron y en cualquier selector que use medico objetivo.",
            ),
            "panel_rapido": (
                "Panel Rapido",
                "Preferencias generales del acceso rapido.",
            )
        }
        if section_key in titles:
            title_text, subtitle_text = titles[section_key]
        else:
            config = self.profile_sections[section_key]
            title_text = config["title"]
            subtitle_text = f"Edita los perfiles guardados del modulo {config['title']}."

        self.title_label.configure(text=title_text)
        self.subtitle_label.configure(text=subtitle_text)

        for key, button in self.section_buttons.items():
            is_active = key == section_key
            button.configure(
                fg_color="#2f7dbc" if is_active else "#d7e2ee",
                hover_color="#256898" if is_active else "#b9cada",
                text_color="#ffffff" if is_active else "#16324f",
            )

        if section_key == "panel_rapido":
            self.add_button.configure(text="Guardar")
            self.update_button.configure(text="Guardar cambios")
            self.delete_button.configure(text="Restablecer")
        else:
            self.add_button.configure(text="Agregar")
            self.update_button.configure(text="Actualizar seleccionado")
            self.delete_button.configure(text="Eliminar seleccionado")

        self._rebuild_editor_fields()
        self._reload_listbox()
        self._clear_form()

    def _rebuild_editor_fields(self) -> None:
        self.field_vars = {}
        self.field_entries = {}
        for widget in self.editor_frame.winfo_children():
            if widget not in {self.info_label, self.add_button.master}:
                widget.destroy()

        fields = self._current_fields()
        for index, field in enumerate(fields):
            key = field["key"]
            label = field["label"]
            is_bool = field.get("type") == "bool"
            self.field_vars[key] = ctk.BooleanVar() if is_bool else ctk.StringVar()
            ctk.CTkLabel(
                self.editor_frame,
                text=label,
                font=ctk.CTkFont(size=13, weight="bold"),
                text_color="#16324f",
            ).grid(row=index * 2, column=0, padx=16, pady=(16 if index == 0 else 8, 6), sticky="w")

            entry_row = ctk.CTkFrame(self.editor_frame, fg_color="transparent")
            entry_row.grid(row=index * 2 + 1, column=0, padx=16, pady=(0, 2), sticky="ew")
            entry_row.grid_columnconfigure(0, weight=1)

            if is_bool:
                checkbox = ctk.CTkCheckBox(
                    entry_row,
                    text=field.get("checkbox_label", "Activado"),
                    variable=self.field_vars[key],
                    text_color="#16324f",
                )
                checkbox.grid(row=0, column=0, sticky="w")
                self.field_entries[key] = checkbox
                continue

            is_password = key == "clave"
            entry = ctk.CTkEntry(
                entry_row,
                textvariable=self.field_vars[key],
                show="*" if is_password and not self.password_visible else "",
            )
            entry.grid(row=0, column=0, sticky="ew")
            self.field_entries[key] = entry

            if is_password:
                ctk.CTkButton(
                    entry_row,
                    text="Ver" if not self.password_visible else "Ocultar",
                    width=90,
                    command=self._toggle_password_visibility,
                    fg_color="#6d7f90",
                    hover_color="#58697a",
                ).grid(row=0, column=1, padx=(8, 0), sticky="e")

        info_row = len(fields) * 2
        self.info_label.grid(row=info_row, column=0, padx=16, pady=(12, 6), sticky="w")
        self.add_button.master.grid(row=info_row + 1, column=0, padx=16, pady=(6, 16), sticky="ew")

    def _current_fields(self) -> list[dict]:
        if self.active_section == "medicos":
            return [{"key": "nombre", "label": "Nombre del medico", "required": True}]
        if self.active_section == "panel_rapido":
            return [
                {
                    "key": "ver_web_default",
                    "label": "Ver WEB",
                    "checkbox_label": "Tildar Ver WEB por defecto en Panel Rapido",
                    "type": "bool",
                    "required": False,
                }
            ]
        return list(self.profile_sections[self.active_section]["fields"])

    def _current_records(self) -> list:
        if self.active_section == "medicos":
            return self.medicos
        if self.active_section == "panel_rapido":
            return [self.panel_rapido_config]
        return self.profile_records[self.active_section]

    def _reload_listbox(self) -> None:
        self.listbox.delete(0, tk.END)
        if self.active_section == "medicos":
            for medico in self.medicos:
                self.listbox.insert(tk.END, medico)
        elif self.active_section == "panel_rapido":
            estado = "Ver WEB por defecto: Si" if self.panel_rapido_config.get("ver_web_default") else "Ver WEB por defecto: No"
            self.listbox.insert(tk.END, estado)
        else:
            for record in self.profile_records[self.active_section]:
                self.listbox.insert(tk.END, build_record_display(self.active_section, record))

    def _selected_index(self) -> int | None:
        selection = self.listbox.curselection()
        return selection[0] if selection else None

    def _on_select(self, _event=None) -> None:
        selected = self._selected_index()
        if selected is None:
            return
        if self.active_section == "medicos":
            self.field_vars["nombre"].set(self.medicos[selected])
            return
        if self.active_section == "panel_rapido":
            for key, var in self.field_vars.items():
                var.set(bool(self.panel_rapido_config.get(key)))
            return
        record = self.profile_records[self.active_section][selected]
        for key, var in self.field_vars.items():
            var.set(str(record.get(key, "") or ""))

    def _clear_form(self) -> None:
        if self.active_section == "medicos":
            self.field_vars["nombre"].set("")
        elif self.active_section == "panel_rapido":
            for key, var in self.field_vars.items():
                var.set(bool(self.panel_rapido_config.get(key)))
        else:
            defaults = self.profile_sections[self.active_section].get("defaults", {})
            for key, var in self.field_vars.items():
                var.set(str(defaults.get(key, "") or ""))
        self.listbox.selection_clear(0, tk.END)
        self.info_label.configure(text="Formulario listo para editar.")

    def _toggle_password_visibility(self) -> None:
        self.password_visible = not self.password_visible
        self._rebuild_editor_fields()
        selected = self._selected_index()
        if selected is not None:
            self.listbox.selection_set(selected)
            self._on_select()

    def _normalize_current_form(self) -> dict | str | None:
        if self.active_section == "medicos":
            value = " ".join(self.field_vars["nombre"].get().strip().split())
            return value or None
        if self.active_section == "panel_rapido":
            return {key: bool(var.get()) for key, var in self.field_vars.items()}

        config = self.profile_sections[self.active_section]
        record = {}
        for field in config["fields"]:
            key = field["key"]
            record[key] = str(self.field_vars[key].get() or "").strip()
            if field.get("required") and not record[key]:
                messagebox.showwarning("Atencion", f"Completa el campo obligatorio: {field['label']}.")
                return None
        return record

    def _add_record(self) -> None:
        data = self._normalize_current_form()
        if not data:
            return
        if self.active_section == "panel_rapido":
            self._persist_panel_rapido(data, "Configuracion actualizada.", 0)
            return
        if self.active_section == "medicos":
            nuevo = str(data)
            if any(item.upper() == nuevo.upper() for item in self.medicos):
                messagebox.showwarning("Atencion", "Ese medico ya esta cargado.")
                return
            self.medicos.append(nuevo)
            self._persist_medicos("Medico agregado.")
            return

        config = self.profile_sections[self.active_section]
        identity_field = config["identity_field"]
        identity = str(data.get(identity_field, "")).strip()
        if any(str(item.get(identity_field, "")).strip().lower() == identity.lower() for item in self.profile_records[self.active_section]):
            messagebox.showwarning("Atencion", "Ya existe un registro con ese identificador.")
            return
        self.profile_records[self.active_section].append(data)
        self._persist_profiles("Registro agregado.")

    def _update_selected(self) -> None:
        if self.active_section == "panel_rapido":
            data = self._normalize_current_form()
            if data is not None:
                self._persist_panel_rapido(data, "Configuracion actualizada.", 0)
            return

        selected = self._selected_index()
        if selected is None:
            messagebox.showwarning("Atencion", "Selecciona un registro para actualizar.")
            return
        data = self._normalize_current_form()
        if not data:
            return

        if self.active_section == "medicos":
            nuevo = str(data)
            if any(index != selected and item.upper() == nuevo.upper() for index, item in enumerate(self.medicos)):
                messagebox.showwarning("Atencion", "Ya existe otro medico con ese nombre.")
                return
            self.medicos[selected] = nuevo
            self._persist_medicos("Medico actualizado.", selected)
            return

        config = self.profile_sections[self.active_section]
        identity_field = config["identity_field"]
        identity = str(data.get(identity_field, "")).strip().lower()
        for index, item in enumerate(self.profile_records[self.active_section]):
            if index != selected and str(item.get(identity_field, "")).strip().lower() == identity:
                messagebox.showwarning("Atencion", "Ya existe otro registro con ese identificador.")
                return
        self.profile_records[self.active_section][selected] = data
        self._persist_profiles("Registro actualizado.", selected)

    def _delete_selected(self) -> None:
        if self.active_section == "panel_rapido":
            self._persist_panel_rapido(dict(DEFAULT_PANEL_RAPIDO_CONFIG), "Configuracion restablecida.", 0)
            return

        selected = self._selected_index()
        if selected is None:
            messagebox.showwarning("Atencion", "Selecciona un registro para eliminar.")
            return

        if self.active_section == "medicos":
            if len(self.medicos) <= 1:
                messagebox.showwarning("Atencion", "Debe quedar al menos un medico cargado.")
                return
            eliminado = self.medicos.pop(selected)
            self._persist_medicos(f"Medico eliminado: {eliminado}")
            return

        eliminado = self.profile_records[self.active_section].pop(selected)
        self._persist_profiles(f"Registro eliminado: {build_record_display(self.active_section, eliminado)}")

    def _persist_medicos(self, status_text: str, reselect: int | None = None) -> None:
        self.medicos = save_medicos_config(self.medicos)
        self._reload_listbox()
        self.info_label.configure(text=status_text)
        self.on_settings_saved({"section": "medicos", "medicos": list(self.medicos)})
        self._post_persist_selection(reselect)

    def _persist_profiles(self, status_text: str, reselect: int | None = None) -> None:
        section_key = self.active_section
        self.profile_records[section_key] = save_profile_records(section_key, self.profile_records[section_key])
        self._reload_listbox()
        self.info_label.configure(text=status_text)
        self.on_settings_saved({"section": section_key, "records": list(self.profile_records[section_key])})
        self._post_persist_selection(reselect)

    def _persist_panel_rapido(self, data: dict, status_text: str, reselect: int | None = None) -> None:
        self.panel_rapido_config = save_panel_rapido_config(data)
        self._reload_listbox()
        self.info_label.configure(text=status_text)
        self.on_settings_saved({"section": "panel_rapido", "config": dict(self.panel_rapido_config)})
        self._post_persist_selection(reselect)

    def _post_persist_selection(self, reselect: int | None) -> None:
        total = self.listbox.size()
        if reselect is not None and total:
            selected = min(reselect, total - 1)
            self.listbox.selection_set(selected)
            self._on_select()
        else:
            self._clear_form()
