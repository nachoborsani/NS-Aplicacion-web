"""Config por-cliente de la cadena de médicos de cabecera.

Cadena: BENEF → Credencial → Generar OME → Activar. Cada cliente tiene su
planilla de Google con su propio layout de columnas. La clave del dict es el
slug del cliente (el mismo que usa client_pami en la web).

- cred_key: la clave que usan los endpoints de credencial de la web
  (Scheffelaar usa el legacy "scheffelaar", que la web mapea a "scheffelaar-mc").
- start_row: desde qué fila trabaja la cadena (NO mira para arriba; el backlog
  viejo con DNI sin benef puede ser enorme).
- cols: índices 0-based de las columnas en la hoja.
- activacion_marca: qué se escribe en la col de activación cuando se agenda el
  turno: "ACTIVADA" (texto fijo) o "FECHA" (la fecha del turno).
"""
from __future__ import annotations

CLIENTES = {
    "scheffelaar-mc": {
        "nombre": "Scheffelaar",
        "cred_key": "scheffelaar",
        "spreadsheet": "https://docs.google.com/spreadsheets/d/1sZP1NuVzyzjc17lrFFePy6IVQNUB3epNXJIXoBJI334/edit",
        "sheet_name": "Schefelar",
        "start_row": 4718,
        "diagnostico": "Z000",
        "practicas": ["427122", "427121", "427120", "427109"],
        # A Fecha·B Nombre·C Sexo·D Benef·E Capita·F DNI·G Tramite·H OME·
        # I Credencial·J Motivo·K Datos·L GENERADA·M Validacion·N transmisión
        "cols": {"nombre": 1, "benef": 3, "dni": 5, "tramite": 6, "ome": 7, "credencial": 8,
                 "generada": 11, "activacion": 12},
        "activacion_marca": "ACTIVADA",
        # La curación NO exige trámite para reusar credencial: Scheffelaar
        # identifica al paciente por DNI/benef (su OME no usa el trámite).
        "curacion_reusa_requiere_tramite": False,
        # Horario de los turnos que se agendan: desde/hasta y cada cuántos min.
        "activacion_hora_inicio": "10:00",
        "activacion_hora_tope": "19:00",
        "activacion_intervalo_min": 15,
    },
    "dubesarky-ezequiel": {
        "nombre": "Dube",
        "cred_key": "dubesarky-ezequiel",
        "spreadsheet": "https://docs.google.com/spreadsheets/d/1CJHJz2iR32aknMKwtMsivpjhdIQ3n1T-iUaMt7iENGo/edit",
        "sheet_name": "Mc Dube",
        "start_row": 12686,
        "diagnostico": "Z000",
        "practicas": ["427122", "427121", "427120", "427109"],
        # A Benef·B DNI·C Tramite·D Nombre·E capita·F Peso·G Motivo·H DX·I OME·
        # J fecha atenciones·K ·L FECHA GENERACION·M FECHA ACTIVACION·N CREDENCIAL·O VALIDADA
        "cols": {"benef": 0, "dni": 1, "tramite": 2, "nombre": 3, "dx": 7, "ome": 8,
                 "generada": 11, "activacion": 12, "credencial": 13, "validada": 14},
        "activacion_marca": "FECHA",
        # Antes de bajar credenciales, curar la planilla: reusa la credencial del
        # paciente que ya la tiene DESCARGADA (por benef, DNI o N° de trámite) y
        # corrige el benef/DNI mal tipeado desde la fila validada. Ahorra bajadas.
        "curar_antes_de_credencial": True,
        # Dube: turnos de 08:00 a 19:00, cada 10 min.
        "activacion_hora_inicio": "08:00",
        "activacion_hora_tope": "19:00",
        "activacion_intervalo_min": 10,
    },
}


def get_cliente(slug: str) -> dict:
    if slug not in CLIENTES:
        raise KeyError(f"Cliente '{slug}' no está en la config de la cadena "
                       f"(cadena_clientes.py). Disponibles: {', '.join(CLIENTES)}.")
    return CLIENTES[slug]


def layout_ome(C: dict) -> dict:
    """layout_override para read/write_ome_sheet_rows a partir del config del
    cliente (así no depende del auto-detect por header, que falla con Dube)."""
    cols = C["cols"]
    return {
        "beneficio_col": cols.get("benef"),
        "dni_col": cols.get("dni"),
        "ome_col": cols.get("ome"),
        "fecha_col": cols.get("generada"),   # donde va la FECHA DE GENERACIÓN
        "nombre_col": cols.get("nombre"),
        "credencial_col": cols.get("credencial"),
    }
