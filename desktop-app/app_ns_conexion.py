"""Pantalla 'Conexion con NS' para la app de escritorio.

Deja configurar el acceso a la web NS, elegir con que mes trabajar y bajar el
nomenclador de ese periodo (que despues consumen los modulos OME/Activar). Toda
la parte de red vive en ns_web.py; aca es solo la UI (con hilos para no congelar
la ventana).
"""

from __future__ import annotations

import queue
import threading

import customtkinter as ctk

from app_theme import (
    BACK, BACK_HOVER, BORDER, DANGER, PRIMARY, PRIMARY_HOVER, SECONDARY,
    SECONDARY_HOVER, SECTION_BG, SUCCESS, SURFACE, SURFACE_ALT, TEXT,
    TEXT_MUTED, TEXT_SOFT, small_font, title_font,
)
import ns_catalog
from ns_web import DEFAULT_BASE_URL, NSWebClient, NSWebError, load_config, save_config


class NSConexionFrame(ctk.CTkFrame):
    def __init__(self, master, on_back=None) -> None:
        super().__init__(master, fg_color="transparent")
        self.on_back = on_back
        self.client: NSWebClient | None = None
        self.busy = False
        self.periodos: list[dict] = []
        self._work_label_to_period: dict = {}
        self.cfg = load_config()

        # Los hilos de red no pueden tocar Tk directamente: dejan la actualizacion
        # en esta cola y un poller del hilo principal la aplica.
        self._q: queue.Queue = queue.Queue()

        self.pass_visible = False
        self._build_ui()
        self._refresh_cached_label()
        self.after(120, self._poll_queue)

    # ------------------------------------------------------------------ UI --
    def _build_ui(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        # --- barra superior ---
        top = ctk.CTkFrame(self, corner_radius=8, fg_color=SURFACE_ALT, border_width=1, border_color=BORDER)
        top.grid(row=0, column=0, padx=8, pady=(6, 4), sticky="ew")
        top.grid_columnconfigure(1, weight=1)
        if self.on_back:
            ctk.CTkButton(
                top, text="Volver", width=78, command=self._go_home,
                fg_color=BACK, hover_color=BACK_HOVER,
            ).grid(row=0, column=0, rowspan=2, padx=(8, 10), pady=6, sticky="w")
        ctk.CTkLabel(top, text="Conexión con NS", font=title_font(20), text_color=TEXT).grid(
            row=0, column=1, padx=10, pady=(6, 1), sticky="w"
        )
        ctk.CTkLabel(
            top,
            text="Traé los nomencladores desde la web, sin copiar el Excel a mano en cada PC.",
            font=small_font(11), text_color=TEXT_MUTED,
        ).grid(row=1, column=1, padx=10, pady=(0, 6), sticky="w")

        content = ctk.CTkScrollableFrame(self, corner_radius=8, fg_color=SURFACE)
        content.grid(row=1, column=0, padx=8, pady=(0, 8), sticky="nsew")
        content.grid_columnconfigure(0, weight=1)

        self._build_acceso_card(content)
        self._build_nomenclador_card(content)

    def _card(self, parent, row: int, titulo: str) -> ctk.CTkFrame:
        card = ctk.CTkFrame(parent, corner_radius=8, fg_color=SECTION_BG, border_width=1, border_color=BORDER)
        card.grid(row=row, column=0, padx=8, pady=(8, 4), sticky="ew")
        card.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(card, text=titulo, font=small_font(13, bold=True), text_color=TEXT).grid(
            row=0, column=0, columnspan=3, padx=12, pady=(10, 6), sticky="w"
        )
        return card

    def _field_label(self, card, row: int, texto: str) -> None:
        ctk.CTkLabel(card, text=texto, font=small_font(11), text_color=TEXT_MUTED).grid(
            row=row, column=0, padx=(12, 8), pady=4, sticky="w"
        )

    def _build_acceso_card(self, parent) -> None:
        card = self._card(parent, 0, "Acceso")

        self._field_label(card, 1, "Dirección")
        self.url_var = ctk.StringVar(value=self.cfg.get("base_url") or DEFAULT_BASE_URL)
        ctk.CTkEntry(card, textvariable=self.url_var, height=28, placeholder_text="https://...").grid(
            row=1, column=1, columnspan=2, padx=(0, 12), pady=4, sticky="ew"
        )

        self._field_label(card, 2, "Usuario")
        self.user_var = ctk.StringVar(value=self.cfg.get("username") or "")
        ctk.CTkEntry(card, textvariable=self.user_var, height=28).grid(
            row=2, column=1, columnspan=2, padx=(0, 12), pady=4, sticky="ew"
        )

        self._field_label(card, 3, "Contraseña")
        self.pass_var = ctk.StringVar(value=self.cfg.get("password") or "")
        self.pass_entry = ctk.CTkEntry(card, textvariable=self.pass_var, height=28, show="●")
        self.pass_entry.grid(row=3, column=1, padx=(0, 6), pady=4, sticky="ew")
        self.pass_toggle = ctk.CTkButton(
            card, text="Ver", width=52, height=28, fg_color=SECONDARY, hover_color=SECONDARY_HOVER,
            font=small_font(11, bold=True), command=self._toggle_pass,
        )
        self.pass_toggle.grid(row=3, column=2, padx=(0, 12), pady=4, sticky="e")

        self.remember_var = ctk.BooleanVar(value=bool(self.cfg.get("password")))
        ctk.CTkCheckBox(
            card, text="Recordar la clave en esta PC", variable=self.remember_var, font=small_font(11),
        ).grid(row=4, column=1, columnspan=2, padx=(0, 12), pady=(2, 6), sticky="w")

        self.connect_btn = ctk.CTkButton(
            card, text="Probar conexión", height=30, width=150,
            fg_color=PRIMARY, hover_color=PRIMARY_HOVER, font=small_font(12, bold=True),
            command=self._on_connect,
        )
        self.connect_btn.grid(row=5, column=0, padx=(12, 8), pady=(6, 12), sticky="w")
        self.acceso_status = ctk.CTkLabel(card, text="Sin conectar.", font=small_font(11), text_color=TEXT_SOFT)
        self.acceso_status.grid(row=5, column=1, columnspan=2, padx=(0, 12), pady=(6, 12), sticky="w")

    def _build_nomenclador_card(self, parent) -> None:
        card = self._card(parent, 1, "Nomenclador")

        # Traer un mes desde la web (descarga a esta PC)
        self._field_label(card, 1, "Traer de la web")
        self.period_var = ctk.StringVar(value="")
        self.period_combo = ctk.CTkComboBox(
            card, variable=self.period_var, values=["(conectate primero)"], state="disabled", height=28, width=210,
        )
        self.period_combo.grid(row=1, column=1, padx=(0, 8), pady=4, sticky="w")
        self.download_btn = ctk.CTkButton(
            card, text="Descargar este mes", height=28, width=170,
            fg_color=SECONDARY, hover_color=SECONDARY_HOVER, font=small_font(11, bold=True),
            state="disabled", command=self._on_download,
        )
        self.download_btn.grid(row=1, column=2, padx=(0, 12), pady=4, sticky="e")

        self.nom_status = ctk.CTkLabel(card, text="", font=small_font(11), text_color=TEXT_SOFT)
        self.nom_status.grid(row=2, column=0, columnspan=3, padx=12, pady=(2, 6), sticky="w")

        # Mes de trabajo: lo que usan OME y Activar (por defecto, el último)
        self._field_label(card, 3, "Mes de trabajo")
        self.work_var = ctk.StringVar(value="")
        self.work_combo = ctk.CTkComboBox(
            card, variable=self.work_var, values=["(ninguno descargado)"], state="disabled", height=28, width=210,
            command=self._on_work_change,
        )
        self.work_combo.grid(row=3, column=1, padx=(0, 8), pady=4, sticky="w")
        ctk.CTkLabel(card, text="lo usan OME y Activar", font=small_font(11), text_color=TEXT_SOFT).grid(
            row=3, column=2, padx=(0, 12), pady=4, sticky="w"
        )

        self.cached_label = ctk.CTkLabel(card, text="", font=small_font(11), text_color=TEXT_MUTED)
        self.cached_label.grid(row=4, column=0, columnspan=3, padx=12, pady=(4, 12), sticky="w")

        self._refresh_work_combo()

    # -------------------------------------------------------------- helpers --
    def _ui(self, fn) -> None:
        """Encola `fn` para que el poller la corra en el hilo de la UI."""
        self._q.put(fn)

    def _poll_queue(self) -> None:
        try:
            while True:
                fn = self._q.get_nowait()
                try:
                    fn()
                except Exception:
                    pass
        except queue.Empty:
            pass
        try:
            self.after(120, self._poll_queue)
        except Exception:
            pass

    def _toggle_pass(self) -> None:
        self.pass_visible = not self.pass_visible
        self.pass_entry.configure(show="" if self.pass_visible else "●")
        self.pass_toggle.configure(text="Ocultar" if self.pass_visible else "Ver")

    def _set_busy(self, busy: bool) -> None:
        self.busy = busy
        state = "disabled" if busy else "normal"
        self.connect_btn.configure(state=state)
        # el boton de descarga solo se habilita si ya hay periodos
        if not busy and self.periodos:
            self.download_btn.configure(state="normal")
        else:
            self.download_btn.configure(state="disabled")

    def _refresh_cached_label(self) -> None:
        meses = ns_catalog.available_periods()
        wp = ns_catalog.working_period()
        if meses:
            self.cached_label.configure(text=f"En esta PC: {', '.join(meses)}  ·  mes de trabajo: {wp or '—'}")
        else:
            self.cached_label.configure(text="En esta PC todavía no hay ningún mes descargado.")

    def _refresh_work_combo(self) -> None:
        periods = ns_catalog.available_periods()
        labelmap = {p.get("period"): self._period_label(p) for p in self.periodos}
        self._work_label_to_period = {}
        if periods:
            values = []
            for per in periods:
                label = labelmap.get(per, per)
                self._work_label_to_period[label] = per
                values.append(label)
            self.work_combo.configure(values=values, state="readonly")
            wp = ns_catalog.working_period()
            self.work_var.set(labelmap.get(wp, wp) if wp else values[-1])
        else:
            self.work_combo.configure(values=["(ninguno descargado)"], state="disabled")
            self.work_var.set("")

    def _on_work_change(self, _value=None) -> None:
        period = self._work_label_to_period.get(self.work_var.get(), "")
        if not period:
            return
        periods = ns_catalog.available_periods()
        # Si elige el último, lo dejo en "auto-último" (no lo fija); si elige otro
        # mes, lo fija hasta que lo cambie. Así el default siempre es el último.
        ns_catalog.set_working_period("" if periods and period == periods[-1] else period)
        self._refresh_cached_label()

    def _go_home(self) -> None:
        if self.on_back:
            self.on_back()

    # -------------------------------------------------------------- acciones --
    def _on_connect(self) -> None:
        if self.busy:
            return
        url = self.url_var.get().strip() or DEFAULT_BASE_URL
        user = self.user_var.get().strip()
        pwd = self.pass_var.get()
        if not user or not pwd:
            self.acceso_status.configure(text="Completá usuario y contraseña.", text_color=DANGER)
            return
        self._set_busy(True)
        self.acceso_status.configure(text="Conectando…", text_color=TEXT_SOFT)

        def work():
            try:
                client = NSWebClient(url)
                info = client.login(user, pwd)
                periodos, activo = client.list_nomencladores()
            except NSWebError as exc:
                self._ui(lambda: self._connect_failed(str(exc)))
                return
            except Exception as exc:  # pragma: no cover
                self._ui(lambda: self._connect_failed(f"Error inesperado: {exc}"))
                return
            self._ui(lambda: self._connect_ok(client, info, periodos, activo, url, user, pwd))

        threading.Thread(target=work, daemon=True).start()

    def _connect_failed(self, msg: str) -> None:
        self._set_busy(False)
        self.acceso_status.configure(text=msg, text_color=DANGER)

    def _connect_ok(self, client, info, periodos, activo, url, user, pwd) -> None:
        self.client = client
        self.periodos = periodos or []
        nombre = (info or {}).get("name") or user
        self.acceso_status.configure(text=f"Conectado como {nombre}.", text_color=SUCCESS)

        # guardar config (clave solo si se pidió recordarla)
        cfg = {"base_url": url, "username": user, "password": pwd if self.remember_var.get() else ""}
        try:
            save_config(cfg)
        except Exception:
            pass

        # cargar el combo de meses
        labels = [self._period_label(p) for p in self.periodos]
        if labels:
            self.period_combo.configure(values=labels, state="readonly")
            # dejar seleccionado el activo, o el primero
            activo_label = next((self._period_label(p) for p in self.periodos if p.get("period") == activo), labels[0])
            self.period_var.set(activo_label)
            self.nom_status.configure(text=f"{len(labels)} mes(es) disponible(s) en la web.", text_color=TEXT_SOFT)
        else:
            self.period_combo.configure(values=["(no hay nomencladores en la web)"], state="disabled")
            self.nom_status.configure(text="La web todavía no tiene ningún nomenclador cargado.", text_color=TEXT_MUTED)
        self._refresh_work_combo()
        self._set_busy(False)

    @staticmethod
    def _period_label(p: dict) -> str:
        label = p.get("label") or p.get("period") or ""
        period = p.get("period") or ""
        return f"{label}  ({period})" if label and period and label != period else (label or period)

    def _selected_period(self) -> str | None:
        chosen = self.period_var.get()
        for p in self.periodos:
            if self._period_label(p) == chosen:
                return p.get("period")
        return None

    def _on_download(self) -> None:
        if self.busy or not self.client:
            return
        period = self._selected_period()
        if not period:
            self.nom_status.configure(text="Elegí un mes primero.", text_color=DANGER)
            return
        self._set_busy(True)
        self.nom_status.configure(text="Descargando nomenclador…", text_color=TEXT_SOFT)

        def progress(done, total):
            if total:
                self._ui(lambda: self.nom_status.configure(text=f"Descargando… {done}/{total}"))

        def work():
            try:
                cat = self.client.download_catalog(period, progress=progress)
            except NSWebError as exc:
                self._ui(lambda: self._download_failed(str(exc)))
                return
            except Exception as exc:  # pragma: no cover
                self._ui(lambda: self._download_failed(f"Error inesperado: {exc}"))
                return
            self._ui(lambda: self._download_ok(cat))

        threading.Thread(target=work, daemon=True).start()

    def _download_failed(self, msg: str) -> None:
        self._set_busy(False)
        self.nom_status.configure(text=msg, text_color=DANGER)

    def _download_ok(self, cat: dict) -> None:
        self._set_busy(False)
        estado = "" if cat.get("complete") else f" (parcial: faltan {cat.get('rowCount', 0) - cat.get('count', 0)})"
        color = SUCCESS if cat.get("complete") else DANGER
        self.nom_status.configure(
            text=f"Listo: {cat.get('count', 0)} prácticas de {cat.get('label') or cat.get('period')}{estado}.",
            text_color=color,
        )
        self._refresh_work_combo()
        self._refresh_cached_label()


# --- prueba visual suelta: python app_ns_conexion.py -----------------------
if __name__ == "__main__":  # pragma: no cover
    ctk.set_appearance_mode("light")
    root = ctk.CTk()
    root.title("Conexión NS — preview")
    root.geometry("760x560")
    root.configure(fg_color="#eef3f8")
    frame = NSConexionFrame(root, on_back=lambda: print("volver"))
    frame.pack(fill="both", expand=True, padx=10, pady=10)
    root.mainloop()
