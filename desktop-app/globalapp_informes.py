"""Baja los informes de Baimed desde Global App y los deja en la cabina de NS.

Global App (gm.globalapp.ar) es el sistema de gestión del centro. Los informes de
cada estudio quedan adjuntos en la historia clínica del paciente, atados al turno.
Hasta ahora había que entrar paciente por paciente, abrir la ficha y bajar el PDF:
con 896 estudios esperando informe eso no se hace a mano.

Cómo funciona
-------------
La pantalla es una SPA que habla con una API (gmed.api.globalapp.ar). El bot entra
UNA vez con Playwright —así no hay que reproducir el login ni el manejo de sesión,
que va por cookies— y de ahí en más llama a la API desde adentro de la página, que
ya tiene la sesión puesta. Es mucho más rápido y más firme que manejar la pantalla
a clicks.

El camino, tal como lo hace la propia web:

  1. /api/pacientes/get-all-pacientes   -> encuentra al paciente (id interno)
  2. /api/historia-clinica-get-registros/{idpaciente}/{pagina}/{tamaño}
                                        -> las fichas, con fecha, tipo y médico
  3. /api/historia-clinica-get-archivo/{idregistro}
                                        -> el PDF del informe, crudo

Qué informes busca: los que NUESTRA web marca como "falta informe" en la bandeja
del mes. Así no se baja de más ni se adivina: la lista de lo que falta ya la
tenemos, con nombre, beneficio, práctica y fecha del turno.

Qué hace con lo que baja: lo sube a la cabina de Informes recibidos del cliente,
que es la misma puerta por la que entran los que llegan por mail. Desde ahí el
sistema los cruza solo contra la bandeja y quedan listos para subir a PAMI.

Config (NO va en el repo, se copia a mano al lado de ns_conexion.json):

    globalapp.json
    {
      "url": "https://gm.globalapp.ar",
      "api": "https://gmed.api.globalapp.ar",
      "usuario": "...",
      "clave": "...",
      "idcliente": 58,
      "slug_ns": "dbaime"
    }
"""

from __future__ import annotations

import base64
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import ns_web

try:
    from playwright.sync_api import sync_playwright
except Exception:  # noqa: BLE001 - el error se explica al correr
    sync_playwright = None


AQUI = Path(__file__).resolve().parent
CONFIG = AQUI / "globalapp.json"
# Tope de seguridad: si algo sale mal, que no se cuelgue una hora.
ESPERA_LOGIN_MS = 45000
PAUSA_ENTRE_PACIENTES_S = 0.4
# Tipos de ficha de la historia clinica que NO son el informe de un estudio. El
# resto (EC ecografia, EDC/EDV/EDA/EVC ecodopplers, HOL holter, MAP presurometria,
# INF, IMG...) si lo son.
#   AR = adjunto suelto del paciente. En Baimed son SIEMPRE la credencial de PAMI:
#        60 de 60 en la corrida del 12/09/2026, todas del mismo tamano (~55,9 kB) y
#        ninguna con una practica adentro. Subirlas ensucia la cabina — caen en
#        "Revisar nombre" y hay que descartarlas a mano, una por una.
#   HC = nota de historia clinica (seguimiento). NUNCA trae PDF: pedir el archivo
#        contesta 500 (23 de 23 probadas), asi que ademas inflaba el contador de
#        "ficha cargada pero sin informe" con algo que no es un informe que falte.
TIPOS_QUE_NO_SON_INFORME = {"AR", "HC"}


def _norm(texto: str) -> str:
    """Sin acentos, sin dobles espacios y en mayúsculas: los nombres vienen
    escritos distinto en cada sistema (PAMI pone 'NUÑEZ', Global App 'NUNEZ')."""
    t = unicodedata.normalize("NFD", str(texto or ""))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", t).strip().upper()


def _digitos(v) -> str:
    return "".join(c for c in str(v or "") if c.isdigit())


def cargar_config(web=None, slug: str = "") -> dict:
    """De donde salen los datos de acceso, en este orden:

    1. La WEB, en la ficha del cliente (Acceso a Global App). Es el lugar bueno:
       se carga y se corrige desde la pantalla, queda encriptado y viaja con el
       cliente.
    2. globalapp.json al lado de este archivo, como respaldo para probar a mano o
       si la web no esta disponible.
    """
    cfg = {}
    if CONFIG.exists():
        try:
            cfg = json.loads(CONFIG.read_text("utf-8")) or {}
        except Exception:  # noqa: BLE001 - un json roto no puede tumbar la corrida
            cfg = {}
    slug = slug or cfg.get("slug_ns") or "dbaime"
    if web is not None:
        try:
            dela_web = web.client_globalapp(slug) or {}
            if dela_web.get("gaUser") and dela_web.get("gaPassword"):
                cfg = {
                    "url": dela_web.get("gaUrl") or cfg.get("url") or "https://gm.globalapp.ar",
                    "api": dela_web.get("gaApi") or cfg.get("api") or "https://gmed.api.globalapp.ar",
                    "usuario": dela_web["gaUser"],
                    "clave": dela_web["gaPassword"],
                    "idcliente": int(dela_web.get("gaIdCliente") or cfg.get("idcliente") or 0),
                    "slug_ns": slug,
                    "origen": "web",
                }
        except Exception:  # noqa: BLE001 - sin la web, queda lo del archivo
            pass
    cfg.setdefault("origen", "archivo")
    cfg.setdefault("url", "https://gm.globalapp.ar")
    cfg.setdefault("api", "https://gmed.api.globalapp.ar")
    cfg.setdefault("slug_ns", slug)
    faltan = [k for k in ("usuario", "clave", "idcliente") if not cfg.get(k)]
    if faltan:
        raise SystemExit(
            "Falta el acceso a Global App (" + ", ".join(faltan) + "). Se carga en la "
            "ficha del cliente, en Acceso a Global App."
        )
    return cfg

class GlobalApp:
    """La sesión abierta en el navegador. Todas las llamadas salen de adentro de
    la página, que es la que tiene la cookie de sesión."""

    def __init__(self, cfg: dict, log=print, headless: bool = True) -> None:
        self.cfg = cfg
        self.log = log
        self._headless = headless
        self._pw = None
        self._browser = None
        self.page = None

    def abrir(self) -> None:
        if sync_playwright is None:
            raise SystemExit("Falta Playwright en este entorno.")
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=self._headless)
        ctx = self._browser.new_context(viewport={"width": 1440, "height": 900})
        self.page = ctx.new_page()
        self.page.goto(self.cfg["url"], wait_until="domcontentloaded", timeout=ESPERA_LOGIN_MS)
        self._login()

    def _login(self) -> None:
        """La pantalla de entrada es Vue: usuario (tipo email), clave y el boton
        Ingresar. Se apunta a esos tres y no al primer input que aparezca — la
        pagina tiene otros campos de clave escondidos y el primer intento le
        escribia al que no era."""
        page = self.page
        try:
            page.wait_for_selector("input[type=email]", timeout=15000)
        except Exception:  # noqa: BLE001 - no hay formulario: ya estaba adentro
            self.log("[GA] Sesion ya abierta.")
            return
        page.fill("input[type=email]", self.cfg["usuario"])
        clave = page.query_selector("input[type=password]:visible") or page.query_selector("input[type=password]")
        if not clave:
            raise RuntimeError("No encontre el campo de la clave.")
        clave.fill(self.cfg["clave"])
        boton = None
        for b in page.query_selector_all("button"):
            texto = (b.inner_text() or "").strip().lower()
            if texto.startswith("ingres") or texto.startswith("entrar"):
                boton = b
                break
        (boton or clave).click() if boton else clave.press("Enter")
        # Adentro cuando aparece el menu lateral. Esperar a que DESAPAREZCA el
        # campo no servia: la pantalla lo conserva escondido.
        try:
            page.wait_for_selector("a[href='/pacientes'], a[href='/turnos']", timeout=ESPERA_LOGIN_MS)
        except Exception as exc:  # noqa: BLE001
            if page.query_selector("input[type=email]"):
                raise RuntimeError(
                    "No pude entrar: revisa usuario y clave en globalapp.json "
                    "(o la pantalla pidio un codigo de verificacion)."
                ) from exc
            raise
        self.log("[GA] Sesion iniciada.")
    def cerrar(self) -> None:
        for cerrar in (getattr(self._browser, "close", None), getattr(self._pw, "stop", None)):
            try:
                if cerrar:
                    cerrar()
            except Exception:  # noqa: BLE001
                pass

    # ---- API ----
    def _api(self, ruta: str):
        """GET a la API con la sesión de la página. Devuelve el JSON."""
        js = """async (u) => {
          const r = await fetch(u, { credentials: 'include' });
          if (!r.ok) return { __error: r.status };
          return await r.json();
        }"""
        return self.page.evaluate(js, self.cfg["api"] + ruta)

    def _api_pdf(self, ruta: str) -> bytes:
        """El archivo vuelve como PDF crudo. Se pasa a base64 para cruzarlo por
        el puente del navegador (que solo sabe de texto) y se rearma acá."""
        js = """async (u) => {
          const r = await fetch(u, { credentials: 'include' });
          if (!r.ok) return { __error: r.status };
          const b = new Uint8Array(await r.arrayBuffer());
          let s = '';
          for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
          return { b64: btoa(s) };
        }"""
        res = self.page.evaluate(js, self.cfg["api"] + ruta)
        if not isinstance(res, dict) or res.get("__error"):
            raise RuntimeError(f"el archivo respondio {(res or {}).get('__error')}")
        return base64.b64decode(res["b64"])

    def buscar_paciente(self, nombre: str, benef: str = "") -> dict | None:
        """Busca por apellido y, si hay varios, desempata por el carnet."""
        apellido = _norm(nombre).split(" ")[0]
        if len(apellido) < 3:
            return None
        filtros = json.dumps({
            "andarr": [{"nombre": {"ilike": f"%{apellido}%"}, "idcliente": self.cfg["idcliente"]}],
            "idcliente": {"eq": self.cfg["idcliente"]},
        })
        from urllib.parse import quote
        data = self._api(f"/api/pacientes/get-all-pacientes?pageSize=50&page=1&filters={quote(filtros)}")
        # La respuesta viene envuelta dos veces: {pacientes: {count, rows}}.
        caja = (data or {}).get("pacientes") or data or {}
        filas = caja.get("rows") if isinstance(caja, dict) else (caja if isinstance(caja, list) else [])
        filas = filas or []
        if not filas:
            return None
        benef_d = _digitos(benef)
        # 1) por carnet, que es el dato duro
        if benef_d:
            for p in filas:
                if _digitos(p.get("carnet")) == benef_d:
                    return p
        # 2) por nombre completo normalizado
        objetivo = _norm(nombre)
        for p in filas:
            if _norm(p.get("nombre")) == objetivo:
                return p
        # 3) uno solo con ese apellido: se toma
        return filas[0] if len(filas) == 1 else None

    def registros(self, idpaciente: int, tope: int = 60) -> list[dict]:
        data = self._api(
            f"/api/historia-clinica-get-registros/{idpaciente}/1/{tope}"
            "?query=%7B%22medicosEspecialidades%22%3Atrue%7D"
        )
        return list(((data or {}).get("registros")) or [])

    def archivo(self, idregistro: str) -> bytes:
        return self._api_pdf(f"/api/historia-clinica-get-archivo/{idregistro}")


def _fecha_de_registro(reg: dict) -> str:
    """AAAA-MM-DD de la ficha (viene en ISO dentro de `datos`)."""
    return str(((reg or {}).get("datos") or {}).get("fecha") or "")[:10]


def _fecha_de_turno(turno: str) -> str:
    """'01/09/2026 - 16:17 - P' -> '2026-09-01'."""
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", str(turno or ""))
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else ""


def bajar(slug: str = "", solo: int = 0, headless: bool = True, log=print) -> dict:
    web = ns_web.NSWebClient.desde_config()
    cfg = cargar_config(web, slug)
    slug = slug or cfg["slug_ns"]
    log(f"Acceso a Global App tomado de {cfg['origen']}.")
    pendientes = web.informes_faltantes(slug)
    if not pendientes:
        log("No hay informes pendientes en la bandeja; nada que bajar.")
        return {"pendientes": 0, "bajados": 0}
    log(f"{len(pendientes)} prestaciones esperando informe en {slug}.")

    ga = GlobalApp(cfg, log=log, headless=headless)
    ga.abrir()
    cache_pacientes: dict[str, dict | None] = {}
    bajados, sin_paciente, sin_ficha, sin_archivo, fallados = 0, 0, 0, 0, 0
    # Fichas ya subidas en esta corrida. Un paciente con cuatro practicas
    # pendientes el mismo dia entra cuatro veces al bucle y encuentra la MISMA
    # ficha, asi que sin esto el mismo PDF se subia cuatro veces (175 repetidos
    # de 456 en la corrida del 12/09/2026). Con uno alcanza: en la cabina un
    # informe se puede tildar contra varias OMEs.
    fichas_subidas: set[str] = set()
    repetidos = 0
    no_informes = 0
    try:
        for i, fila in enumerate(pendientes, start=1):
            if solo and bajados >= solo:
                break
            nombre = str(fila.get("nombre") or "").strip()
            benef = str(fila.get("benef") or "")
            fecha = _fecha_de_turno(fila.get("turno"))
            if not nombre or not fecha:
                continue
            clave = _norm(nombre) + "|" + _digitos(benef)
            if clave not in cache_pacientes:
                try:
                    cache_pacientes[clave] = ga.buscar_paciente(nombre, benef)
                except Exception as exc:  # noqa: BLE001 - uno que falla no corta la corrida
                    log(f"  [{i}] {nombre}: no pude buscarlo ({exc})")
                    cache_pacientes[clave] = None
                time.sleep(PAUSA_ENTRE_PACIENTES_S)
            pac = cache_pacientes[clave]
            if not pac:
                sin_paciente += 1
                continue

            try:
                regs = ga.registros(int(pac.get("id")))
            except Exception as exc:  # noqa: BLE001
                log(f"  [{i}] {nombre}: no pude leer la historia ({exc})")
                fallados += 1
                continue
            # La ficha del día del turno. Si hay varias (un paciente con dos
            # estudios el mismo día), van todas: el cruce contra la bandeja lo
            # hace despues nuestra cabina, que sabe de OMEs y practicas.
            deldia = [r for r in regs if _fecha_de_registro(r) == fecha]
            if not deldia:
                sin_ficha += 1
                continue
            for reg in deldia:
                if str(reg.get("tipo") or "").strip().upper() in TIPOS_QUE_NO_SON_INFORME:
                    no_informes += 1
                    continue
                ficha_id = str(reg.get("_id") or "")
                if ficha_id and ficha_id in fichas_subidas:
                    repetidos += 1
                    continue
                try:
                    pdf = ga.archivo(ficha_id)
                except Exception as exc:  # noqa: BLE001
                    # Una ficha SIN archivo adjunto contesta 500. No es un error
                    # nuestro: el estudio esta cargado pero el informe no se subio
                    # todavia del lado del centro. Se cuenta aparte para no
                    # mezclarlo con las fallas de verdad.
                    if "500" in str(exc):
                        sin_archivo += 1
                    else:
                        log(f"  [{i}] {nombre}: no pude bajar el archivo ({exc})")
                        fallados += 1
                    continue
                tipo = str(reg.get("tipo") or "INF").strip()
                nom = re.sub(r"[^A-Za-z0-9 ._-]", "", _norm(nombre))[:40].strip() or "paciente"
                filename = f"{nom} - {tipo} - {fecha}.pdf"
                try:
                    web.subir_informe(slug, filename, pdf, origen="globalapp")
                    if ficha_id:
                        fichas_subidas.add(ficha_id)
                    bajados += 1
                    log(f"  [{i}] {nombre} · {tipo} · {fecha} -> subido")
                except Exception as exc:  # noqa: BLE001
                    fallados += 1
                    log(f"  [{i}] {nombre}: bajado pero no pude subirlo ({exc})")
    finally:
        ga.cerrar()

    resumen = {
        "pendientes": len(pendientes), "bajados": bajados,
        "sin_paciente": sin_paciente, "sin_ficha": sin_ficha,
        "sin_archivo": sin_archivo, "fallados": fallados, "repetidos": repetidos,
        "no_informes": no_informes,
    }
    log(
        f"Listo: {bajados} informes subidos a la cabina · {sin_paciente} sin paciente en Global App"
        f" · {sin_ficha} sin ficha ese dia · {sin_archivo} con la ficha cargada pero sin informe"
        f" · {fallados} con error"
        f" · {repetidos} fichas que ya habian entrado"
        f" · {no_informes} que no son informes (credencial / nota de historia clinica)."
    )
    return resumen


if __name__ == "__main__":
    args = sys.argv[1:]
    solo = 0
    for a in args:
        if a.startswith("--solo="):
            solo = int(a.split("=", 1)[1] or 0)
    bajar(solo=solo, headless=("--ver" not in args))
