"""Barrido diario del benef (Scheffelaar) — vía el panel autenticado de PAMI.

Completa el N° de beneficio de las filas de la planilla de Scheffelaar que tienen
DNI pero no benef. Usa el MISMO motor que el botón "Completar BENEF" del módulo
OME Med Cabecera (PamiOmeGenerator, headless): entra al CUP con la clave del
profesional, busca el afiliado por DNI en el panel autenticado (sin captcha) y
trae el benef.

Reparto: la app hace SOLO la parte de navegador (login + lookup del benef); la
lectura/escritura de la planilla va por la web (que tiene la conexión a Google y
es la fuente de verdad). La clave PAMI también se lee de la web (así se actualiza
en un solo lugar). Al terminar, dispara la descarga de credenciales en la web.

Pensado para correr programado (tarea de Windows) a las 19:00. Uso manual:
  python benef_sweep.py
"""
from __future__ import annotations

import asyncio
import sys

from cadena_clientes import get_cliente
from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config
from pami_ome_generator import PamiOmeGenerator, PatientInput

CLIENTE_SLUG_DEFAULT = "scheffelaar-mc"


def log(m: str) -> None:
    print(m, flush=True)


async def _procesar(web, cred_key: str, user: str, clave: str, faltan: list[dict], progress=None) -> dict:
    resumen = {"faltan": len(faltan), "completados": 0, "sin_benef": 0, "errores": 0, "filas_ok": []}
    total = len(faltan)
    # headless=True: sin ventana. El auto-login pasa el reCAPTCHA como navegador real.
    async with PamiOmeGenerator(user=user, password=clave, headless=True) as gen:
        for i, fila in enumerate(faltan, 1):
            dni = str(fila.get("dni", "")).strip()
            row = fila.get("sheetRow")
            nombre = str(fila.get("nombre", "")).strip()
            if not dni:
                continue
            if progress:
                progress(f"{i}/{total} · {nombre or dni}")
            log(f"[{i}/{total}] fila {row} · {nombre} · DNI {dni} …")
            try:
                res = await gen.process_patient(PatientInput(
                    modo="DNI", afiliado=dni, diagnostico="", practica="",
                    dni=dni, nombre=nombre, completar_benef=True,
                ))
                benef = str(getattr(res, "beneficio", "") or "").strip()
                if getattr(res, "resultado", "") == "BENEF_COMPLETADO" and benef:
                    try:
                        web.set_benef(cred_key, row, benef)
                        resumen["completados"] += 1
                        if row:
                            resumen["filas_ok"].append(int(row))
                        log(f"    benef {benef} → escrito en la planilla")
                    except Exception as e:  # noqa: BLE001
                        resumen["errores"] += 1
                        log(f"    encontró {benef} pero falló al escribir: {e!r}")
                else:
                    resumen["sin_benef"] += 1
                    log(f"    sin benef ({getattr(res, 'resultado', '') or 'no encontrado'})")
            except Exception as e:  # noqa: BLE001
                resumen["errores"] += 1
                log(f"    error en el panel: {e!r}")
    return resumen


def run(cliente_slug: str = CLIENTE_SLUG_DEFAULT, progress=None,
        disparar_credencial: bool = True, limite: int | None = None) -> dict:
    C = get_cliente(cliente_slug)
    cred_key = C["cred_key"]
    start_row = int(C.get("start_row") or 0)
    nombre = C.get("nombre", cliente_slug)

    cfg = load_config()
    web = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
    web.login(cfg.get("username", ""), cfg.get("password", ""))

    # Clave PAMI del cliente desde la web (fuente de verdad, admin-only).
    cred = web.client_pami(cliente_slug)
    user = str(cred.get("pamiUser", "")).strip()
    clave = str(cred.get("pamiPassword", "") or "")
    if not user or not clave:
        log(f"{nombre} no tiene usuario/clave PAMI cargados en la web.")
        return {"faltan": 0, "completados": 0, "sin_benef": 0, "errores": 0, "error": "sin clave PAMI"}

    faltan = web.faltan_benef(cred_key)
    # SOLO desde start_row para abajo: el backlog viejo con DNI sin benef puede ser
    # enorme (Dube: ~7800 filas). No miramos para arriba.
    faltan = [f for f in faltan if int(f.get("sheetRow", 0) or 0) >= start_row]
    if limite:
        faltan = faltan[:limite]
        log(f"(modo prueba: solo {len(faltan)} fila/s)")
    log(f"{nombre}: filas con DNI y sin benef (desde {start_row}): {len(faltan)}")
    if not faltan:
        web.reportar_benef_estado_cred(cred_key, 0, 0, 0)
        log("Nada para buscar.")
        return {"faltan": 0, "completados": 0, "sin_benef": 0, "errores": 0}

    resumen = asyncio.run(_procesar(web, cred_key, user, clave, faltan, progress=progress))
    log(f"=== listo: {resumen['completados']} completados · {resumen['sin_benef']} sin benef · {resumen['errores']} errores ===")

    # Reporta al tablero de la web.
    try:
        web.reportar_benef_estado_cred(cred_key, resumen["completados"], resumen["sin_benef"],
                                       resumen["errores"], revisadas=resumen["faltan"])
    except Exception as e:  # noqa: BLE001
        log(f"No pude reportar el estado del barrido: {e!r}")

    # Cierra el círculo: si completamos benef nuevos, disparamos la descarga de
    # credenciales en la web SOLO de esas filas (modo quirúrgico). Si el orquestador
    # maneja la cadena (disparar_credencial=False), NO disparamos acá.
    filas_ok = resumen.get("filas_ok") or []
    if disparar_credencial and filas_ok:
        try:
            web.correr_credenciales(cred_key, rows=filas_ok)
            log(f"→ Disparada la descarga de credenciales en la web (solo {len(filas_ok)} filas nuevas).")
        except Exception as e:  # noqa: BLE001
            log(f"→ No pude disparar la descarga de credenciales: {e!r}")

    return resumen


if __name__ == "__main__":  # pragma: no cover
    # Uso: python benef_sweep.py [cliente_slug] [limite]
    _slug = CLIENTE_SLUG_DEFAULT
    _lim = None
    for _a in sys.argv[1:]:
        if _a.isdigit():
            _lim = int(_a)
        elif _a in ("scheffelaar-mc", "dubesarky-ezequiel") or "-" in _a:
            _slug = _a
    try:
        run(cliente_slug=_slug, progress=lambda m: None, limite=_lim)
    except Exception as exc:  # noqa: BLE001
        import traceback
        log(f"FALLO: {exc!r}")
        log(traceback.format_exc())
        # Reporta el fallo al tablero del cliente si se puede.
        try:
            cfg = load_config()
            web = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
            web.login(cfg.get("username", ""), cfg.get("password", ""))
            web.reportar_benef_estado_cred(get_cliente(_slug)["cred_key"], 0, 0, 0, error=str(exc)[:200])
        except Exception:
            pass
        sys.exit(1)
