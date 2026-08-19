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

from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config
from pami_ome_generator import PamiOmeGenerator, PatientInput

CLIENTE_SLUG = "scheffelaar-mc"


def log(m: str) -> None:
    print(m, flush=True)


async def _procesar(web, user: str, clave: str, faltan: list[dict], progress=None) -> dict:
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
                        web.set_benef_scheffelaar(row, benef)
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


def run(progress=None) -> dict:
    cfg = load_config()
    web = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
    web.login(cfg.get("username", ""), cfg.get("password", ""))

    # Clave PAMI del cliente desde la web (fuente de verdad, admin-only).
    cred = web.client_pami(CLIENTE_SLUG)
    user = str(cred.get("pamiUser", "")).strip()
    clave = str(cred.get("pamiPassword", "") or "")
    if not user or not clave:
        log("Scheffelaar no tiene usuario/clave PAMI cargados en la web.")
        return {"faltan": 0, "completados": 0, "sin_benef": 0, "errores": 0, "error": "sin clave PAMI"}

    faltan = web.faltan_benef_scheffelaar()
    # Límite opcional para pruebas: python benef_sweep.py 1  → procesa solo 1 fila.
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        faltan = faltan[: int(sys.argv[1])]
        log(f"(modo prueba: solo {len(faltan)} fila/s)")
    log(f"Filas con DNI y sin benef: {len(faltan)}")
    if not faltan:
        web.reportar_benef_estado(0, 0, 0)
        log("Nada para buscar.")
        return {"faltan": 0, "completados": 0, "sin_benef": 0, "errores": 0}

    resumen = asyncio.run(_procesar(web, user, clave, faltan, progress=progress))
    log(f"=== listo: {resumen['completados']} completados · {resumen['sin_benef']} sin benef · {resumen['errores']} errores ===")

    # Reporta al tablero de la web.
    try:
        web.reportar_benef_estado(resumen["completados"], resumen["sin_benef"], resumen["errores"],
                                  revisadas=resumen["faltan"])
    except Exception as e:  # noqa: BLE001
        log(f"No pude reportar el estado del barrido: {e!r}")

    # Cierra el círculo: si completamos benef nuevos, disparamos la descarga de
    # credenciales en la web SOLO de esas filas (modo quirúrgico: no toca el resto
    # de la planilla ni el backlog histórico).
    filas_ok = resumen.get("filas_ok") or []
    if filas_ok:
        try:
            web.correr_credenciales_scheffelaar(rows=filas_ok)
            log(f"→ Disparada la descarga de credenciales en la web (solo {len(filas_ok)} filas nuevas).")
        except Exception as e:  # noqa: BLE001
            log(f"→ No pude disparar la descarga de credenciales: {e!r}")

    return resumen


if __name__ == "__main__":  # pragma: no cover
    try:
        run(progress=lambda m: None)
    except Exception as exc:  # noqa: BLE001
        import traceback
        log(f"FALLO: {exc!r}")
        log(traceback.format_exc())
        # Reporta el fallo al tablero si se puede.
        try:
            cfg = load_config()
            web = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
            web.login(cfg.get("username", ""), cfg.get("password", ""))
            web.reportar_benef_estado(0, 0, 0, error=str(exc)[:200])
        except Exception:
            pass
        sys.exit(1)
