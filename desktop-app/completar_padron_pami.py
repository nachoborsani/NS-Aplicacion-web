# -*- coding: utf-8 -*-
"""Completa el beneficio en el PADRÓN buscándolo en PAMI por DNI.

Barrido reutilizable: agarra los DNIs a los que les falta el beneficio (afiliados
del padrón sin benef + informes sin resolver que traen DNI), los busca en el panel
autenticado de PAMI y carga los beneficios al padrón por la web. De ahí en más, los
informes de esos pacientes matchean solos por DNI -> beneficio.

Reusa el MISMO motor que benef_sweep (PamiOmeGenerator, modo DNI, completar_benef):
entra al CUP con la clave del cliente, busca el afiliado por documento (sin
captcha) y trae el beneficio. Es agnóstico a la credencial: por defecto usa la del
propio cliente; con --cred se puede usar la de otro (Dube/Scheffelaar ya probados),
porque el panel busca por DNI en todo el padrón de PAMI, no solo los del prestador.

USO (desde desktop-app, con el venv):
    python completar_padron_pami.py                              # caballito-pediatrico
    python completar_padron_pami.py <slug> [limite]
    python completar_padron_pami.py caballito-pediatrico 3 --cred scheffelaar-mc
"""
from __future__ import annotations

import asyncio
import sys

from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config
from pami_ome_generator import PamiOmeGenerator, PatientInput

SLUG_DEFAULT = "caballito-pediatrico"


def log(m: str) -> None:
    print(m, flush=True)


async def _buscar(user: str, clave: str, faltan: list[dict], progress=None):
    resueltos: list[dict] = []
    sin = err = 0
    total = len(faltan)
    # headless=True: sin ventana. El auto-login pasa el reCAPTCHA como navegador real.
    async with PamiOmeGenerator(user=user, password=clave, headless=True) as gen:
        for i, f in enumerate(faltan, 1):
            dni = str(f.get("dni", "")).strip()
            nombre = str(f.get("nombre", "")).strip()
            if not dni:
                continue
            if progress:
                progress(f"{i}/{total} · {nombre or dni}")
            log(f"[{i}/{total}] DNI {dni} · {nombre} …")
            try:
                res = await gen.process_patient(PatientInput(
                    modo="DNI", afiliado=dni, diagnostico="", practica="",
                    dni=dni, nombre=nombre, completar_benef=True,
                ))
                benef = str(getattr(res, "beneficio", "") or "").strip()
                if getattr(res, "resultado", "") == "BENEF_COMPLETADO" and benef:
                    resueltos.append({"dni": dni, "beneficio": benef, "nombre": nombre})
                    log(f"    benef {benef}")
                else:
                    sin += 1
                    log(f"    sin benef ({getattr(res, 'resultado', '') or 'no encontrado'})")
            except Exception as e:  # noqa: BLE001
                err += 1
                log(f"    error en el panel: {e!r}")
    return resueltos, sin, err


def run(slug: str = SLUG_DEFAULT, cred_slug: str | None = None, limite: int | None = None, progress=None) -> dict:
    cfg = load_config()
    web = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
    web.login(cfg.get("username", ""), cfg.get("password", ""))

    # Credencial PAMI: por defecto la del propio cliente; con --cred, la de otro.
    cred = web.client_pami(cred_slug or slug)
    user = str(cred.get("pamiUser", "")).strip()
    clave = str(cred.get("pamiPassword", "") or "")
    if not user or not clave:
        log(f"{cred_slug or slug} no tiene usuario/clave PAMI cargados en la web.")
        return {"error": "sin clave PAMI"}

    data = web._request("GET", f"/api/clientes/{slug}/padron/faltan-beneficio")
    faltan = data.get("items", []) if isinstance(data, dict) else []
    if limite:
        faltan = faltan[:limite]
        log(f"(modo prueba: solo {len(faltan)})")
    log(f"{slug}: DNIs a buscarles el beneficio: {len(faltan)}")
    if not faltan:
        log("Nada para buscar.")
        return {"faltan": 0, "completados": 0}

    resueltos, sin, err = asyncio.run(_buscar(user, clave, faltan, progress=progress))
    log(f"=== encontrados: {len(resueltos)} · sin benef: {sin} · errores: {err} ===")

    if resueltos:
        r = web._request("POST", f"/api/clientes/{slug}/padron/completar", body={"items": resueltos})
        log(f"→ Padrón: {r.get('creados', 0)} creados, {r.get('actualizados', 0)} actualizados.")
    return {"faltan": len(faltan), "completados": len(resueltos), "sin_benef": sin, "errores": err}


if __name__ == "__main__":  # pragma: no cover
    _slug, _cred, _lim = SLUG_DEFAULT, None, None
    _args = sys.argv[1:]
    _i = 0
    while _i < len(_args):
        a = _args[_i]
        if a == "--cred" and _i + 1 < len(_args):
            _cred = _args[_i + 1]; _i += 2; continue
        if a.isdigit():
            _lim = int(a)
        elif "-" in a:
            _slug = a
        _i += 1
    try:
        run(slug=_slug, cred_slug=_cred, limite=_lim, progress=lambda m: None)
    except Exception as exc:  # noqa: BLE001
        import traceback
        log(f"FALLO: {exc!r}")
        log(traceback.format_exc())
        sys.exit(1)
