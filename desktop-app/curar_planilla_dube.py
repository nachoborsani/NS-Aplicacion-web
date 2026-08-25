# -*- coding: utf-8 -*-
"""Atajo de la curación para Dube. La lógica vive en curar_planilla.py (genérica).

USO:  .venv\\Scripts\\python.exe curar_planilla_dube.py [--apply] [--todo]
"""
import sys
from curar_planilla import curar

if __name__ == "__main__":
    curar(slug="dubesarky-ezequiel", apply="--apply" in sys.argv, todo="--todo" in sys.argv)
