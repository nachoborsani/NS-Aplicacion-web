from __future__ import annotations

import functools
import re
from tkinter import filedialog, messagebox


def _safe_toplevel(widget):
    try:
        if widget is not None and widget.winfo_exists():
            return widget.winfo_toplevel()
    except Exception:
        return None
    return None


def _current_parent(root):
    try:
        focused = root.focus_get()
        parent = _safe_toplevel(focused)
        if parent is not None:
            return parent
    except Exception:
        pass
    try:
        if root.winfo_exists():
            return root
    except Exception:
        pass
    return None


def install_dialog_parenting(root) -> None:
    if getattr(messagebox, "_suite_pami_parenting_installed", False):
        return

    def wrap_dialog(func):
        @functools.wraps(func)
        def wrapped(*args, **kwargs):
            if "parent" not in kwargs:
                parent = _current_parent(root)
                if parent is not None:
                    kwargs["parent"] = parent
            return func(*args, **kwargs)

        return wrapped

    for name in (
        "showinfo",
        "showwarning",
        "showerror",
        "askyesno",
        "askokcancel",
        "askquestion",
        "askretrycancel",
        "askyesnocancel",
    ):
        if hasattr(messagebox, name):
            setattr(messagebox, name, wrap_dialog(getattr(messagebox, name)))

    for name in (
        "askopenfilename",
        "askopenfilenames",
        "asksaveasfilename",
        "askdirectory",
    ):
        if hasattr(filedialog, name):
            setattr(filedialog, name, wrap_dialog(getattr(filedialog, name)))

    messagebox._suite_pami_parenting_installed = True


def center_toplevel_on_parent(window, parent, width: int, height: int) -> None:
    try:
        parent.update_idletasks()
        window.update_idletasks()
        parent_x = parent.winfo_rootx()
        parent_y = parent.winfo_rooty()
        parent_w = parent.winfo_width()
        parent_h = parent.winfo_height()
        if parent_w <= 1 or parent_h <= 1:
            geometry = parent.geometry()
            match = re.match(r"^(\d+)x(\d+)([+-]\d+)([+-]\d+)$", geometry or "")
            if match:
                parent_w = int(match.group(1))
                parent_h = int(match.group(2))
                parent_x = int(match.group(3))
                parent_y = int(match.group(4))
        x = parent_x + max((parent_w - width) // 2, 0)
        y = parent_y + max((parent_h - height) // 2, 0)
        window.geometry(f"{width}x{height}+{x}+{y}")
    except Exception:
        window.geometry(f"{width}x{height}")
