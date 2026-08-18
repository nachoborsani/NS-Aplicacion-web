"""Pantalla 'Refresco automático' para la app de escritorio.

Deja programar (sin tocar el Programador de tareas de Windows) el sync de la
bandeja del mes en curso hacia la web NS: horarios + on/off, ver el estado de la
última corrida y disparar un refresco manual. La lógica de la tarea vive en
bandeja_schedule.py; el sync en bandeja_sync.py. Acá es solo la UI (con hilos
para no congelar la ventana).
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
import bandeja_schedule as sched


class RefrescoAutomaticoFrame(ctk.CTkFrame):
    def __init__(self, master, on_back=None) -> None:
        super().__init__(master, fg_color="transparent")
        self.on_back = on_back
        self.busy = False
        self.cfg = sched.load_config()
        self._q: queue.Queue = queue.Queue()
        self._build_ui()
        self.after(120, self._poll_queue)
        self.after(200, self._refresh_estado_async)

    # ------------------------------------------------------------------ UI --
    def _build_ui(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        top = ctk.CTkFrame(self, corner_radius=8, fg_color=SURFACE_ALT, border_width=1, border_color=BORDER)
        top.grid(row=0, column=0, padx=8, pady=(6, 4), sticky="ew")
        top.grid_columnconfigure(1, weight=1)
        if self.on_back:
            ctk.CTkButton(
                top, text="Volver", width=78, command=self._go_home,
                fg_color=BACK, hover_color=BACK_HOVER,
            ).grid(row=0, column=0, rowspan=2, padx=(8, 10), pady=6, sticky="w")
        ctk.CTkLabel(top, text="Refresco automático", font=title_font(20), text_color=TEXT).grid(
            row=0, column=1, padx=10, pady=(6, 1), sticky="w"
        )
        ctk.CTkLabel(
            top,
            text="Programá cuándo la app baja la bandeja del mes en curso y la sube a la web.",
            font=small_font(11), text_color=TEXT_MUTED,
        ).grid(row=1, column=1, padx=10, pady=(0, 6), sticky="w")

        content = ctk.CTkScrollableFrame(self, corner_radius=8, fg_color=SURFACE)
        content.grid(row=1, column=0, padx=8, pady=(0, 8), sticky="nsew")
        content.grid_columnconfigure(0, weight=1)

        self._build_programacion_card(content)
        self._build_estado_card(content)

    def _card(self, parent, row: int, titulo: str) -> ctk.CTkFrame:
        card = ctk.CTkFrame(parent, corner_radius=8, fg_color=SECTION_BG, border_width=1, border_color=BORDER)
        card.grid(row=row, column=0, padx=8, pady=(8, 4), sticky="ew")
        card.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(card, text=titulo, font=small_font(13, bold=True), text_color=TEXT).grid(
            row=0, column=0, columnspan=4, padx=12, pady=(10, 6), sticky="w"
        )
        return card

    def _field_label(self, card, row: int, texto: str) -> None:
        ctk.CTkLabel(card, text=texto, font=small_font(11), text_color=TEXT_MUTED).grid(
            row=row, column=0, padx=(12, 8), pady=4, sticky="w"
        )

    def _build_programacion_card(self, parent) -> None:
        card = self._card(parent, 0, "Programación automática")

        self.enabled_var = ctk.BooleanVar(value=bool(self.cfg.get("enabled")))
        ctk.CTkCheckBox(
            card, text="Activar refresco automático", variable=self.enabled_var, font=small_font(11),
        ).grid(row=1, column=0, columnspan=4, padx=12, pady=(2, 6), sticky="w")

        self._field_label(card, 2, "Horarios (HH:MM)")
        horarios = list(self.cfg.get("horarios") or [])
        horarios += [""] * (3 - len(horarios))
        self.hora_vars = []
        row_horas = ctk.CTkFrame(card, fg_color="transparent")
        row_horas.grid(row=2, column=1, columnspan=3, padx=(0, 12), pady=4, sticky="w")
        for i in range(3):
            var = ctk.StringVar(value=horarios[i] if i < len(horarios) else "")
            self.hora_vars.append(var)
            ctk.CTkEntry(row_horas, textvariable=var, width=76, height=28, placeholder_text="09:30").grid(
                row=0, column=i, padx=(0, 8)
            )

        ctk.CTkLabel(
            card,
            text="Si la PC estaba apagada a esa hora, corre apenas prende. Tiene que estar prendida y con sesión iniciada.",
            font=small_font(11), text_color=TEXT_SOFT, wraplength=520, justify="left",
        ).grid(row=3, column=0, columnspan=4, padx=12, pady=(2, 6), sticky="w")

        self.guardar_btn = ctk.CTkButton(
            card, text="Guardar programación", height=30, width=180,
            fg_color=PRIMARY, hover_color=PRIMARY_HOVER, font=small_font(12, bold=True),
            command=self._on_guardar,
        )
        self.guardar_btn.grid(row=4, column=0, padx=(12, 8), pady=(6, 12), sticky="w")
        self.guardar_status = ctk.CTkLabel(card, text="", font=small_font(11), text_color=TEXT_SOFT)
        self.guardar_status.grid(row=4, column=1, columnspan=3, padx=(0, 12), pady=(6, 12), sticky="w")

    def _build_estado_card(self, parent) -> None:
        card = self._card(parent, 1, "Estado y prueba")

        self.estado_label = ctk.CTkLabel(
            card, text="Consultando estado…", font=small_font(11), text_color=TEXT_MUTED,
            justify="left", wraplength=560,
        )
        self.estado_label.grid(row=1, column=0, columnspan=4, padx=12, pady=(2, 8), sticky="w")

        botones = ctk.CTkFrame(card, fg_color="transparent")
        botones.grid(row=2, column=0, columnspan=4, padx=12, pady=(0, 8), sticky="w")
        ctk.CTkButton(
            botones, text="Actualizar estado", height=28, width=150,
            fg_color=SECONDARY, hover_color=SECONDARY_HOVER, font=small_font(11, bold=True),
            command=self._refresh_estado_async,
        ).grid(row=0, column=0, padx=(0, 8))
        self.refrescar_btn = ctk.CTkButton(
            botones, text="Refrescar ahora", height=28, width=150,
            fg_color=PRIMARY, hover_color=PRIMARY_HOVER, font=small_font(11, bold=True),
            command=self._on_refrescar_ahora,
        )
        self.refrescar_btn.grid(row=0, column=1, padx=(0, 8))

        self.run_status = ctk.CTkLabel(
            card, text="", font=small_font(11), text_color=TEXT_SOFT, justify="left", wraplength=560,
        )
        self.run_status.grid(row=3, column=0, columnspan=4, padx=12, pady=(2, 12), sticky="w")

    # -------------------------------------------------------------- helpers --
    def _ui(self, fn) -> None:
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

    def _go_home(self) -> None:
        if self.on_back:
            self.on_back()

    def _set_busy(self, busy: bool) -> None:
        self.busy = busy
        state = "disabled" if busy else "normal"
        self.guardar_btn.configure(state=state)
        self.refrescar_btn.configure(state=state)

    # ------------------------------------------------------------- acciones --
    def _on_guardar(self) -> None:
        horarios = [v.get().strip() for v in self.hora_vars if v.get().strip()]
        enabled = bool(self.enabled_var.get())
        self.guardar_status.configure(text="Guardando…", text_color=TEXT_SOFT)
        self._set_busy(True)

        def work():
            ok, msg = sched.apply_schedule(horarios, enabled)
            def done():
                self._set_busy(False)
                self.guardar_status.configure(text=msg, text_color=SUCCESS if ok else DANGER)
                self._refresh_estado_async()
            self._ui(done)

        threading.Thread(target=work, daemon=True).start()

    def _refresh_estado_async(self) -> None:
        def work():
            st = sched.get_status()
            def done():
                self.estado_label.configure(text=self._estado_texto(st), text_color=TEXT_MUTED)
            self._ui(done)
        threading.Thread(target=work, daemon=True).start()

    def _estado_texto(self, st: dict) -> str:
        if not st or not st.get("exists"):
            return "El refresco automático no está programado. Activá y guardá para crearlo."
        estado = st.get("state") or "?"
        ultima = st.get("lastRun") or "—"
        prox = st.get("nextRun") or "—"
        res = st.get("lastResult")
        res_txt = "OK" if res == 0 else (f"código {res}" if res is not None else "—")
        return (
            f"Programado ({estado}).\n"
            f"Última corrida: {ultima}  ·  resultado: {res_txt}\n"
            f"Próxima corrida: {prox}"
        )

    def _on_refrescar_ahora(self) -> None:
        self.run_status.configure(text="Refrescando la bandeja… (abre PAMI en segundo plano, puede tardar unos minutos)", text_color=TEXT_SOFT)
        self._set_busy(True)

        def prog(m):
            self._ui(lambda: self.run_status.configure(text=str(m), text_color=TEXT_SOFT))

        def work():
            try:
                from bandeja_sync import sync_all
                resultados = sync_all(progress=prog)
                oks = [r for r in resultados if r.get("ok")]
                fallos = [r for r in resultados if not r.get("ok")]
                total = sum(int(r.get("count") or 0) for r in oks)
                resumen = f"Listo: {len(oks)} clientes ({total} filas)."
                if fallos:
                    resumen += " Sin sincronizar: " + ", ".join(r.get("name", "?") for r in fallos) + "."
                color = SUCCESS if oks else DANGER
            except Exception as exc:  # noqa: BLE001
                resumen = f"No se pudo refrescar: {exc}"
                color = DANGER

            def done():
                self._set_busy(False)
                self.run_status.configure(text=resumen, text_color=color)
                self._refresh_estado_async()
            self._ui(done)

        threading.Thread(target=work, daemon=True).start()


# Preview aislado: python app_refresco.py
if __name__ == "__main__":  # pragma: no cover
    ctk.set_appearance_mode("light")
    root = ctk.CTk()
    root.title("Refresco automático — preview")
    root.geometry("760x620")
    frame = RefrescoAutomaticoFrame(root, on_back=lambda: print("volver"))
    frame.pack(fill="both", expand=True)
    root.mainloop()
