from __future__ import annotations

import argparse
import csv
import io
import re
import ssl
from datetime import datetime
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from openpyxl import Workbook

from app_paths import get_output_dir
from google_sheets_ome import extract_spreadsheet_id
from pami_documentacion import PamiDocumentacionController


DEFAULT_SHEET_URL = (
    "https://docs.google.com/spreadsheets/d/"
    "1IjWo_ohxDS6LU-Drft0F1ZESyiosApc7yFUXlZmTAV8/edit?gid=995667022#gid=995667022"
)
DEFAULT_GID = "995667022"


def _norm_header(value: str) -> str:
    value = str(value or "").strip().lower()
    replacements = {
        "á": "a",
        "é": "e",
        "í": "i",
        "ó": "o",
        "ú": "u",
        "ñ": "n",
    }
    for src, dst in replacements.items():
        value = value.replace(src, dst)
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def _digits(value: str) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def _csv_export_url(sheet_url: str, gid: str) -> str:
    spreadsheet_id = extract_spreadsheet_id(sheet_url)
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=csv&gid={gid}"


def _download_csv_text(sheet_url: str, gid: str) -> str:
    url = _csv_export_url(sheet_url, gid)
    try:
        with urlopen(url, timeout=30) as response:
            return response.read().decode("utf-8-sig")
    except URLError as exc:
        if "CERTIFICATE_VERIFY_FAILED" not in str(exc):
            raise
        context = ssl._create_unverified_context()
        with urlopen(url, timeout=30, context=context) as response:
            return response.read().decode("utf-8-sig")


def _field(row: dict[str, str], *names: str) -> str:
    normalized = {_norm_header(key): value for key, value in row.items()}
    for name in names:
        value = normalized.get(_norm_header(name), "")
        if str(value or "").strip():
            return str(value).strip()
    return ""


def _estado_enviado(value: str) -> bool:
    text = str(value or "").strip().lower()
    if "enviado" not in text:
        return False
    return "no enviado" not in text


def leer_filas_enviadas(
    *,
    sheet_url: str,
    gid: str,
    desde_fila: int = 2,
    hasta_fila: int | None = None,
) -> list[dict]:
    csv_text = _download_csv_text(sheet_url, gid)
    reader = csv.DictReader(io.StringIO(csv_text))
    filas: list[dict] = []
    for sheet_row, row in enumerate(reader, start=2):
        if sheet_row < desde_fila:
            continue
        if hasta_fila is not None and sheet_row > hasta_fila:
            break
        estado_sheet = _field(row, "Estado")
        if not _estado_enviado(estado_sheet):
            continue
        beneficio = _digits(_field(row, "NRO. BENEFICIO/GP", "Benef", "Beneficio"))
        if not beneficio:
            continue
        filas.append(
            {
                "sheet_row": sheet_row,
                "beneficio": beneficio,
                "dni": _digits(_field(row, "DNI")),
                "tramite_dni": _field(row, "Numero de tramite DNI", "TRAMITE"),
                "paciente": _field(row, "APELLIDO Y NOMBRE", "NOMBRE"),
                "practica": _field(row, "PRÁCTICA", "PRACTICA", "INFORME"),
                "turno": _field(row, "TURNO", "FECHA"),
                "informe": _field(row, "Informe"),
                "estado_sheet": estado_sheet,
                "ome_sheet": _field(row, "OME"),
            }
        )
    return filas


def _item_pami(fila: dict) -> dict:
    return {
        "archivo": "",
        "pdf_paciente": fila.get("paciente", ""),
        "beneficio_pdf": fila.get("beneficio", ""),
        "dni_pdf": fila.get("dni", ""),
        "estado": "para_verificar_pami",
        "prestacion": {
            "beneficio": fila.get("beneficio", ""),
            "nombre": fila.get("paciente", ""),
            "practica": fila.get("practica", ""),
            "turno": fila.get("turno", ""),
        },
    }


def auditar_filas(
    filas: list[dict],
    *,
    usuario: str,
    clave: str,
    headless: bool = True,
) -> list[dict]:
    controller = PamiDocumentacionController(
        usuario=usuario,
        clave=clave,
        log_callback=lambda message: print(message),
        status_callback=lambda message: print(message),
        headless=headless,
    )
    try:
        items = [_item_pami(fila) for fila in filas]
        resultados = controller.verificar_lote_en_pami(items)
    finally:
        controller.cerrar()

    auditados: list[dict] = []
    for fila, resultado in zip(filas, resultados):
        prestacion = resultado.get("prestacion") or {}
        auditados.append(
            {
                **fila,
                "estado_pami": resultado.get("estado", ""),
                "motivo_pami": resultado.get("motivo", ""),
                "n_orden": prestacion.get("n_orden", ""),
                "pami_nombre": prestacion.get("nombre", ""),
                "pami_practica": prestacion.get("practica", ""),
                "pami_turno": prestacion.get("turno", ""),
                "validada": "SI" if prestacion.get("validada") else "NO",
                "transmitida": "SI" if prestacion.get("transmitida") else "NO",
                "documentacion_pendiente": "SI" if prestacion.get("documentacion_pendiente") else "NO",
                "documentacion_cargada": "SI" if prestacion.get("documentacion_cargada") else "NO",
            }
        )
    return auditados


def exportar_reporte(rows: list[dict], destino: Path | None = None) -> Path:
    if destino is None:
        destino = get_output_dir() / f"auditoria_informes_enviados_pami_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    destino.parent.mkdir(parents=True, exist_ok=True)

    headers = [
        "sheet_row",
        "beneficio",
        "paciente",
        "practica",
        "turno",
        "estado_sheet",
        "ome_sheet",
        "estado_pami",
        "motivo_pami",
        "n_orden",
        "validada",
        "transmitida",
        "documentacion_pendiente",
        "documentacion_cargada",
        "pami_nombre",
        "pami_practica",
        "pami_turno",
    ]
    wb = Workbook()
    ws = wb.active
    ws.title = "Auditoria"
    ws.append(headers)
    for row in rows:
        ws.append([row.get(header, "") for header in headers])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for column_cells in ws.columns:
        values = [str(cell.value or "") for cell in column_cells]
        width = min(max(len(value) for value in values) + 2, 60)
        ws.column_dimensions[column_cells[0].column_letter].width = width
    wb.save(destino)
    return destino


def main() -> int:
    parser = argparse.ArgumentParser(description="Audita en PAMI las filas del Drive cuyo Estado dice enviado.")
    parser.add_argument("--sheet-url", default=DEFAULT_SHEET_URL)
    parser.add_argument("--gid", default=DEFAULT_GID)
    parser.add_argument("--usuario", required=True)
    parser.add_argument("--clave", required=True)
    parser.add_argument("--desde-fila", type=int, default=2)
    parser.add_argument("--hasta-fila", type=int)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--output")
    parser.add_argument("--visible", action="store_true", help="Abre el navegador visible en vez de headless.")
    args = parser.parse_args()

    filas = leer_filas_enviadas(
        sheet_url=args.sheet_url,
        gid=args.gid,
        desde_fila=args.desde_fila,
        hasta_fila=args.hasta_fila,
    )
    if args.limit and args.limit > 0:
        filas = filas[: args.limit]
    print(f"Filas con Estado enviado y beneficio: {len(filas)}")
    if not filas:
        return 0

    resultados = auditar_filas(
        filas,
        usuario=args.usuario,
        clave=args.clave,
        headless=not args.visible,
    )
    destino = exportar_reporte(resultados, Path(args.output) if args.output else None)
    print(f"Reporte generado: {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
