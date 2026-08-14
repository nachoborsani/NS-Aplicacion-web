"""Helpers de UI compartidos entre modulos (tooltips e iconos de botones)."""
from __future__ import annotations

import tkinter as tk

import customtkinter as ctk

from app_paths import get_resource_path


class _Tooltip:
    """Tooltip simple para botones-icono (CustomTkinter no trae uno)."""

    def __init__(self, widget, text: str) -> None:
        self.widget = widget
        self.text = text
        self.tip = None
        widget.bind("<Enter>", self._show, add="+")
        widget.bind("<Leave>", self._hide, add="+")
        widget.bind("<Destroy>", self._hide, add="+")

    def _show(self, _event=None) -> None:
        if self.tip is not None or not self.text:
            return
        try:
            x = self.widget.winfo_rootx() + 12
            y = self.widget.winfo_rooty() + self.widget.winfo_height() + 6
            self.tip = tk.Toplevel(self.widget)
            self.tip.wm_overrideredirect(True)
            self.tip.wm_geometry(f"+{x}+{y}")
            tk.Label(
                self.tip, text=self.text, background="#16324f", foreground="#ffffff",
                font=("Segoe UI", 9), padx=8, pady=3, bd=0,
            ).pack()
        except Exception:
            self.tip = None

    def _hide(self, _event=None) -> None:
        if self.tip is not None:
            try:
                self.tip.destroy()
            except Exception:
                pass
            self.tip = None


def attach_tooltip(widget, text: str) -> None:
    _Tooltip(widget, text)


_ICON_CACHE: dict = {}


def button_icon(filename: str, size: tuple[int, int] = (18, 18)):
    """Devuelve un CTkImage del icono, o None si falta (fallback a texto)."""
    key = (filename, size)
    if key in _ICON_CACHE:
        return _ICON_CACHE[key]
    icon = None
    try:
        from PIL import Image

        icon = ctk.CTkImage(Image.open(get_resource_path(f"assets/icons/{filename}")), size=size)
    except Exception:
        icon = None
    _ICON_CACHE[key] = icon
    return icon


def apply_button_icon(button, filename: str, tooltip: str, size: tuple[int, int] = (18, 18), width: int = 40) -> None:
    """Convierte un boton a icono (con tooltip). Si el icono falta, deja el texto."""
    icon = button_icon(filename, size)
    attach_tooltip(button, tooltip)
    if icon is not None:
        try:
            button.configure(image=icon, text="", width=width)
        except Exception:
            pass
