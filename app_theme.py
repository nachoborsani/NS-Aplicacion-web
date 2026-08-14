from __future__ import annotations

import tkinter as tk
from tkinter import ttk

import customtkinter as ctk


APP_BG = "#eef3f8"
SURFACE = "#ffffff"
SURFACE_ALT = "#f7fafc"
SECTION_BG = "#f4f8fb"
BORDER = "#d8e2ec"
TEXT = "#16324f"
TEXT_MUTED = "#51657a"
TEXT_SOFT = "#6d7f90"
PRIMARY = "#245b9d"
PRIMARY_HOVER = "#1d4b82"
SECONDARY = "#66788a"
SECONDARY_HOVER = "#536577"
BACK = "#9aafc3"
BACK_HOVER = "#7f95aa"
SUCCESS = "#1f7a46"
SUCCESS_HOVER = "#176238"
WARNING = "#bd6b2a"
WARNING_HOVER = "#9d571f"
DANGER = "#8a5a5a"
DANGER_HOVER = "#734949"

RADIUS = 8
RADIUS_SMALL = 5
BUTTON_HEIGHT = 26
FIELD_HEIGHT = 26
COMBO_MAX_WIDTH = 420
SMALL_STRETCHED_COMBO_WIDTH = 260
ENTRY_MAX_WIDTH = 360
WIDE_ENTRY_MAX_WIDTH = 560
MAX_GRID_PAD_X = 12
MAX_GRID_PAD_Y = 8


def title_font(size: int = 20) -> ctk.CTkFont:
    return ctk.CTkFont(size=size, weight="bold")


def section_title_font(size: int = 15) -> ctk.CTkFont:
    return ctk.CTkFont(size=size, weight="bold")


def small_font(size: int = 11, *, bold: bool = False) -> ctk.CTkFont:
    return ctk.CTkFont(size=size, weight="bold" if bold else "normal")


def configure_ttk_report_style(root: tk.Misc, *, ui_scale: float = 1.0) -> None:
    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except Exception:
        pass

    style.configure(
        "Report.Treeview",
        rowheight=max(int(24 * ui_scale), 22),
        font=("Segoe UI", max(int(9 * ui_scale), 9)),
        background=SURFACE,
        fieldbackground=SURFACE,
        borderwidth=0,
    )
    style.configure(
        "Report.Treeview.Heading",
        font=("Segoe UI", max(int(9 * ui_scale), 9), "bold"),
        background="#e9eff5",
        foreground=TEXT,
        relief="flat",
    )
    style.map("Report.Treeview", background=[("selected", "#2f7dbc")], foreground=[("selected", "#ffffff")])
    style.configure(
        "Report.Vertical.TScrollbar",
        arrowsize=16,
        gripcount=0,
        troughcolor="#dfe8f1",
        background="#6e8398",
        bordercolor="#dfe8f1",
        lightcolor="#6e8398",
        darkcolor="#6e8398",
        width=max(int(18 * ui_scale), 14),
    )


def compact_ctk_tree(widget: tk.Misc) -> None:
    for child in widget.winfo_children():
        if isinstance(child, (ctk.CTkFrame, ctk.CTkScrollableFrame)):
            _compact_frame(child)
        if isinstance(child, ctk.CTkButton):
            _compact_button(child)
        elif isinstance(child, (ctk.CTkEntry, ctk.CTkComboBox)):
            _compact_field(child)
        elif isinstance(child, ctk.CTkCheckBox):
            _compact_checkbox(child)
        compact_ctk_tree(child)


def _compact_frame(frame: ctk.CTkBaseClass) -> None:
    try:
        current_radius = int(frame.cget("corner_radius") or 0)
        if current_radius > RADIUS:
            frame.configure(corner_radius=RADIUS)
    except Exception:
        pass

    _compact_child_grid_padding(frame)

    try:
        fg_color = _single_color(frame.cget("fg_color"))
        if fg_color == "#eef3f8":
            frame.configure(fg_color=SECTION_BG, border_width=1, border_color=BORDER)
        elif fg_color == "#f8fafc":
            frame.configure(fg_color=SECTION_BG, border_width=1, border_color=BORDER)
        elif fg_color == "#f3f7fb":
            frame.configure(fg_color=SURFACE_ALT, border_width=1, border_color=BORDER)
    except Exception:
        pass


def _single_color(value: object) -> str:
    if isinstance(value, (tuple, list)) and value:
        return str(value[-1]).lower()
    return str(value or "").lower()


def _compact_child_grid_padding(frame: tk.Misc) -> None:
    for child in frame.winfo_children():
        try:
            info = child.grid_info()
        except Exception:
            continue
        if not info:
            continue
        updates: dict[str, object] = {}
        padx = _compact_pad_value(info.get("padx"), MAX_GRID_PAD_X)
        pady = _compact_pad_value(info.get("pady"), MAX_GRID_PAD_Y)
        if padx is not None:
            updates["padx"] = padx
        if pady is not None:
            updates["pady"] = pady
        if updates:
            try:
                child.grid_configure(**updates)
            except Exception:
                pass


def _compact_pad_value(value: object, limit: int) -> object | None:
    if isinstance(value, (tuple, list)) and len(value) == 2:
        left = _cap_pad_part(value[0], limit)
        right = _cap_pad_part(value[1], limit)
        result = (left, right)
        return result if tuple(value) != result else None
    capped = _cap_pad_part(value, limit)
    return capped if capped != value else None


def _cap_pad_part(value: object, limit: int) -> int:
    try:
        number = int(float(value or 0))
    except Exception:
        return 0
    if number < 0:
        return number
    return min(number, limit)


def _compact_button(button: ctk.CTkButton) -> None:
    try:
        current_height = int(button.cget("height") or BUTTON_HEIGHT)
        target_height = min(max(current_height, 23), 30)
        button.configure(height=target_height, corner_radius=RADIUS_SMALL, font=small_font(11, bold=True))
    except Exception:
        pass


def _compact_field(field: ctk.CTkBaseClass) -> None:
    try:
        current_height = int(field.cget("height") or FIELD_HEIGHT)
        field.configure(height=min(max(current_height, 23), 28))
    except Exception:
        pass

    try:
        current_width = int(field.cget("width") or 0)
        was_stretched = _has_horizontal_grid_stretch(field)
        if isinstance(field, ctk.CTkComboBox):
            max_width = COMBO_MAX_WIDTH
            min_width = min(current_width or 160, 160)
            stretched_width = SMALL_STRETCHED_COMBO_WIDTH
        else:
            max_width = _entry_max_width(field)
            min_width = min(current_width or 180, 180)
            stretched_width = max_width
        if current_width > max_width:
            field.configure(width=max_width)
        elif was_stretched and current_width <= 180:
            field.configure(width=stretched_width)
        elif current_width <= 180:
            field.configure(width=max(min_width, current_width or min_width))
    except Exception:
        pass

    _remove_horizontal_grid_stretch(field)


def _entry_max_width(field: ctk.CTkBaseClass) -> int:
    try:
        placeholder = str(field.cget("placeholder_text") or "").lower()
    except Exception:
        placeholder = ""
    if any(token in placeholder for token in ("url", "http", "archivo", "carpeta", "destino", "ruta")):
        return WIDE_ENTRY_MAX_WIDTH
    return ENTRY_MAX_WIDTH


def _remove_horizontal_grid_stretch(widget: tk.Misc) -> None:
    try:
        info = widget.grid_info()
    except Exception:
        return
    if not info:
        return
    sticky = str(info.get("sticky", "") or "")
    if "e" not in sticky or "w" not in sticky:
        return
    new_sticky = sticky.replace("e", "")
    if not new_sticky:
        new_sticky = "w"
    try:
        widget.grid_configure(sticky=new_sticky)
    except Exception:
        pass


def _has_horizontal_grid_stretch(widget: tk.Misc) -> bool:
    try:
        info = widget.grid_info()
    except Exception:
        return False
    sticky = str(info.get("sticky", "") or "")
    return "e" in sticky and "w" in sticky


def _compact_checkbox(checkbox: ctk.CTkCheckBox) -> None:
    try:
        checkbox.configure(font=small_font(11))
    except Exception:
        pass
