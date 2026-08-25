# -*- coding: utf-8 -*-
"""
Auto-curación de la planilla de Dube (Mc Dube) usando SUS PROPIAS filas buenas.

Los pacientes de PAMI son recurrentes: el mismo paciente aparece muchas veces.
Una fila con la credencial DESCARGADA tiene datos VALIDADOS por PAMI. Con eso:
  1. Completa DNI / BENEF / N° TRAMITE faltantes desde las filas buenas del mismo
     paciente (prioriza las DESCARGADA). El trámite se normaliza a 11 dígitos.
  2. Recupera las filas "SIN CREDENCIAL" que tengan un gemelo DESCARGADA: les copia
     el trámite bueno y limpia la celda de credencial para que se reintente.

Corre sobre TODA la planilla (start_row=2) para dejarla prolija.

USO (desde desktop-app, con el venv):
    .venv\\Scripts\\python.exe curar_planilla_dube.py            # SIMULACRO (no escribe)
    .venv\\Scripts\\python.exe curar_planilla_dube.py --apply    # aplica los cambios

El simulacro escribe el detalle en curar_dube_reporte.txt.
"""
import sys
from pathlib import Path

from google_sheets_ome import (
    build_sheets_service, extract_spreadsheet_id, _execute_sheets_request, _column_letter,
)
from google_sheets_credenciales import _resolve_sheet_name
from credencial_scraper import normalizar_tramite
from cadena_clientes import get_cliente

SLUG = "dubesarky-ezequiel"
REPORTE = Path(__file__).resolve().parent / "curar_dube_reporte.txt"


def dig(s):
    return "".join(ch for ch in str(s or "") if ch.isdigit())


def norm_tram(s):
    try:
        return normalizar_tramite(s)
    except Exception:
        return ""


def main(apply: bool, todo: bool):
    cli = get_cliente(SLUG)
    C = cli["cols"]
    # Por defecto solo la zona activa (desde donde corre la cadena). Los mapas se
    # arman con TODA la planilla; solo se limitan las FILAS que se modifican.
    start_row = 2 if todo else int(cli.get("start_row", 2))
    ci_benef, ci_dni, ci_tram, ci_cred, ci_ome = (
        C["benef"], C["dni"], C["tramite"], C["credencial"], C["ome"],
    )
    spreadsheet_id = extract_spreadsheet_id(cli["spreadsheet"])
    service = build_sheets_service(interactive=False)
    sheet_name = _resolve_sheet_name(service, spreadsheet_id, cli["sheet_name"])

    resp = _execute_sheets_request(
        service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f"'{sheet_name}'!A2:O",
        )
    )
    values = resp.get("values", [])

    def cell(r, i):
        return (r[i] if i < len(r) else "") or ""

    # --- Mapas de datos buenos: primero SOLO DESCARGADA (validado), luego el resto. ---
    ok_by_dni, ok_by_benef = {}, {}       # validados (DESCARGADA)
    any_by_dni, any_by_benef = {}, {}     # cualquier fila con datos

    def feed(row, mapd, mapb):
        b, d, t = dig(cell(row, ci_benef)), dig(cell(row, ci_dni)), norm_tram(cell(row, ci_tram))
        if d:
            e = mapd.setdefault(d, {"benef": "", "tram": ""})
            if b and not e["benef"]: e["benef"] = b
            if t and not e["tram"]: e["tram"] = t
        if b:
            e = mapb.setdefault(b, {"dni": "", "tram": ""})
            if d and not e["dni"]: e["dni"] = d
            if t and not e["tram"]: e["tram"] = t

    for row in values:
        if cell(row, ci_cred).strip().upper() == "DESCARGADA":
            feed(row, ok_by_dni, ok_by_benef)
    for row in values:
        feed(row, any_by_dni, any_by_benef)

    # Mapa por N° de trámite (para rescatar benef/dni faltantes). El trámite es ~único
    # por persona; las colisiones son typos de DNI. Guardamos SOLO los trámites SIN
    # ambigüedad (apuntan a un único DNI y/o un único benef) para no arrastrar typos.
    _t_dnis, _t_bens = {}, {}
    for row in values:
        t = norm_tram(cell(row, ci_tram))
        if not t:
            continue
        d, b = dig(cell(row, ci_dni)), dig(cell(row, ci_benef))
        if d: _t_dnis.setdefault(t, set()).add(d)
        if b: _t_bens.setdefault(t, set()).add(b)
    by_tram = {}
    for t in set(_t_dnis) | set(_t_bens):
        e = {}
        if len(_t_dnis.get(t, set())) == 1: e["dni"] = next(iter(_t_dnis[t]))
        if len(_t_bens.get(t, set())) == 1: e["benef"] = next(iter(_t_bens[t]))
        if e:
            by_tram[t] = e

    def lookup(d, b, key, t="", prefer_ok=True):
        for mp_d, mp_b in ([(ok_by_dni, ok_by_benef)] if prefer_ok else []) + [(any_by_dni, any_by_benef)]:
            if d and d in mp_d and mp_d[d].get(key): return mp_d[d][key]
            if b and b in mp_b and mp_b[b].get(key): return mp_b[b][key]
        # fallback por trámite: solo para rescatar benef/dni cuando falta la otra llave
        if t and key in ("benef", "dni") and t in by_tram and by_tram[t].get(key):
            return by_tram[t][key]
        return ""

    updates = []   # {range, values}
    log = []       # (fila, col, old, new, motivo)
    n_benef = n_dni = n_tram = n_reuso = n_limpia = 0

    for idx, row in enumerate(values):
        sheet_row = idx + 2
        if sheet_row < start_row:
            continue
        benef, dni, tram = dig(cell(row, ci_benef)), dig(cell(row, ci_dni)), cell(row, ci_tram)
        cred = cell(row, ci_cred).strip().upper()
        ome = cell(row, ci_ome).strip()
        if not (benef or dni):
            continue

        def add(col_i, new, motivo):
            updates.append({"range": f"'{sheet_name}'!{_column_letter(col_i)}{sheet_row}", "values": [[new]]})
            log.append((sheet_row, _column_letter(col_i), "", new, motivo))

        # 1) completar BENEF faltante (por DNI, o por N° de trámite)
        if not benef:
            nb = lookup(dni, "", "benef", t=norm_tram(tram))
            if nb:
                add(ci_benef, nb, "BENEF desde archivo"); benef = nb; n_benef += 1
        # 2) completar DNI faltante (por benef, o por N° de trámite)
        if not dni:
            nd = lookup("", benef, "dni", t=norm_tram(tram))
            if nd:
                add(ci_dni, nd, "DNI desde archivo"); dni = nd; n_dni += 1
        # 3) completar TRAMITE faltante (normalizado a 11)
        if not norm_tram(tram):
            nt = lookup(dni, benef, "tram")
            if nt:
                add(ci_tram, nt, "TRAMITE desde archivo"); tram = nt; n_tram += 1

        # 4) credencial. El PDF se guarda por paciente ({nombre}_{dni}.pdf) en Drive,
        #    y el paso de OME solo mira la marca DESCARGADA. Entonces:
        #    - si el paciente YA tiene credencial (gemelo DESCARGADA) -> reusar la marca
        #      (NO se vuelve a bajar, NO se duplica el PDF).
        #    - si NO tiene y quedó "SIN CREDENCIAL" -> limpiar para que se baje de nuevo.
        if not ome and cred != "DESCARGADA" and benef and dni and norm_tram(tram):
            tiene_gemelo = (dni in ok_by_dni) or (benef in ok_by_benef)
            if tiene_gemelo:
                good_tram = ok_by_dni.get(dni, {}).get("tram") or ok_by_benef.get(benef, {}).get("tram")
                if good_tram and norm_tram(good_tram) != norm_tram(tram):
                    add(ci_tram, norm_tram(good_tram), "TRAMITE corregido (gemelo)")
                add(ci_cred, "DESCARGADA", "reusa credencial (gemelo en Drive)")
                n_reuso += 1
            elif cred == "SIN CREDENCIAL":
                add(ci_cred, "", "limpia SIN CREDENCIAL (se baja de nuevo)")
                n_limpia += 1

    # --- Reporte ---
    lines = []
    def W(*a): lines.append(" ".join(str(x) for x in a))
    W(f"Planilla: {cli['sheet_name']}  ({len(values)} filas)")
    W(f"Alcance: desde la fila {start_row}" + ("  (TODA la planilla)" if todo else "  (zona activa de la cadena)"))
    W(f"Fuentes validadas (DESCARGADA): {len(ok_by_dni)} por DNI, {len(ok_by_benef)} por BENEF")
    W("")
    W("=== CAMBIOS PROPUESTOS ===")
    W(f"  BENEF completados:              {n_benef}")
    W(f"  DNI completados:                {n_dni}")
    W(f"  TRAMITE completados:            {n_tram}")
    W(f"  Credencial REUSADA (gemelo):    {n_reuso}   (marca DESCARGADA, no re-baja)")
    W(f"  'SIN CREDENCIAL' limpiados:     {n_limpia}   (se bajan de nuevo)")
    W(f"  TOTAL celdas a escribir:        {len(updates)}")
    W("")
    W("=== DETALLE (primeras 60) ===")
    for f, col, old, new, mot in log[:60]:
        W(f"  {col}{f}: {old!r} -> {new!r}   [{mot}]")
    REPORTE.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    print(f"\n>>> Reporte en: {REPORTE}")

    if not apply:
        print("\n[SIMULACRO] No se escribió nada. Corré con --apply para aplicar.")
        return
    if not updates:
        print("\nNada para aplicar.")
        return
    _execute_sheets_request(
        service.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"valueInputOption": "RAW", "data": updates},
        )
    )
    print(f"\n[APLICADO] {len(updates)} celdas escritas en la planilla.")


if __name__ == "__main__":
    main(apply="--apply" in sys.argv, todo="--todo" in sys.argv)
