# -*- coding: utf-8 -*-
"""Corrige las filas de Dube que quedaron con "DESCARGADA" en texto plano
(sin el link) copiándoles la fórmula del gemelo. Correr con el venv."""
import credencial_pendientes
from cadena_clientes import get_cliente
r = credencial_pendientes.corregir_links_planos(get_cliente("dubesarky-ezequiel"))
print(f"Filas con link corregido: {r['corregidas']}")
