import re
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from playwright.sync_api import Browser, BrowserContext, Page, Playwright, sync_playwright

from app_logging import log_message
from pami_scraper import configurar_playwright


CUP_LOGIN_URL = "https://cup.pami.org.ar/controllers/loginController.php?redirect=https://pe.pami.org.ar"
PAMI_PANEL_ACEPTACION_URL = "https://pe.pami.org.ar/controllers/efector.php"

# Boca preferida opcional. Si esta vacia, se usa la primera opcion valida disponible.
BOCA_PREFERIDA_TEXTO = ""


@dataclass
class SesionActivar:
    playwright: Playwright
    browser: Browser
    context: BrowserContext
    page: Page


@dataclass
class ResultadoActivacion:
    n_afiliado: str
    n_orden_solicitada: str
    escenario: str          # "A", "B" o "ERROR"
    fecha: str
    hora: str
    minuto: str
    modalidad: str
    practica: str
    boca: str
    estado_final: str       # "ACEPTADA", "PENDIENTE_VALIDACION", "PENDIENTE", "ERROR"
    n_orden_encontrada: str = ""
    practica_encontrada: str = ""
    codigo_practica: str = ""
    nombre_afiliado: str = ""
    beneficio_encontrado: str = ""
    dni_encontrado: str = ""
    estado_detectado: str = ""
    mensaje: str = ""


@dataclass
class ResultadoLote:
    ok: int = 0
    errores: int = 0
    sin_icono: int = 0
    detalle: list = field(default_factory=list)


class PamiActivarController:
    """
    Controla la activacion (o modificacion) de turnos de OMEs
    en el Panel de Aceptacion de PAMI.

    Flujo por beneficiario:
      1. Ir al Panel de Aceptacion
      2. Buscar por n_afiliado (rango desde 01/01/2025)
      3. Detectar escenario A (tilde verde) o B (calendario azul)
      4. Abrir modal
      5. Setear fecha/hora/minuto/boca via JS + datepicker jQuery
      6. Force-click hidden Aplicar
      7. Click fisico en Aceptar/Guardar via page.mouse.click
      8. Verificar resultado
    """

    def __init__(
        self,
        log_callback: Optional[Callable[[str], None]] = None,
        status_callback: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.log_callback = log_callback or (lambda _: None)
        self.status_callback = status_callback or (lambda _: None)
        self._lock = threading.RLock()
        self._sesion: SesionActivar | None = None
        self._stop_requested = False

    # ------------------------------------------------------------------
    # API publica
    # ------------------------------------------------------------------

    def abrir_panel(self, usuario: str | None = None, clave: str | None = None, headless: bool = False) -> None:
        """Abre el navegador y navega al Panel de Aceptacion."""
        with self._lock:
            self._cleanup_dead_session()

            if self._sesion is not None:
                self._log("Ya habia un navegador abierto. Se cerrara para abrir uno nuevo.")
                self._dispose_session(
                    "Se cerro la sesion anterior.",
                    "Sesion anterior descartada antes de abrir nuevamente.",
                )

            configurar_playwright()
            playwright = sync_playwright().start()
            launch_args = {"headless": headless}
            if not headless:
                launch_args["args"] = ["--window-size=1280,900"]
            browser = playwright.chromium.launch(**launch_args)
            context = browser.new_context(
                ignore_https_errors=True,
                viewport={"width": 1280, "height": 900},
            )
            page = context.new_page()
            page.set_default_timeout(25000)
            page.on("console", self._on_console)
            page.on("pageerror", self._on_page_error)
            target_url = CUP_LOGIN_URL if (usuario and clave) else PAMI_PANEL_ACEPTACION_URL
            page.goto(target_url, wait_until="domcontentloaded")

            self._sesion = SesionActivar(
                playwright=playwright,
                browser=browser,
                context=context,
                page=page,
            )

            self._status("Navegador abierto. Iniciando sesion en CUP..." if not headless else "Sesion iniciada en segundo plano.")
            self._log(f"Navegador abierto en {target_url}")

            if usuario and clave:
                self._auto_login_cup(page, usuario, clave)
                page.goto(PAMI_PANEL_ACEPTACION_URL, wait_until="domcontentloaded")
                page.wait_for_timeout(1200)
                self._status(
                    "CUP abierto con sesion iniciada. Ya puedes trabajar en Activacion."
                    if not headless
                    else "CUP abierto con sesion iniciada en segundo plano."
                )
            elif usuario or clave:
                self._try_autofill_credenciales(page, usuario or "", clave or "", timeout_ms=15000)

    def cerrar_navegador(self) -> None:
        with self._lock:
            if self._sesion is None:
                self._status("No hay navegador abierto para cerrar.")
                return
            self._dispose_session("Navegador cerrado.", "Sesion de activacion cerrada manualmente.")

    def solicitar_detencion(self) -> None:
        self._stop_requested = True
        self._status("Detencion solicitada. El BOT se frenara al cerrar la accion actual.")
        self._log("Detencion solicitada por el usuario.")

    def activar_lote(
        self,
        lote: list[dict],
        progress_callback: Optional[Callable[[dict], None]] = None,
    ) -> ResultadoLote:
        """
        Procesa una lista de activaciones.

        Cada entrada del lote debe tener:
          - n_afiliado (str): numero de 14 digitos, opcional si se usa n_orden
          - n_orden (str):    numero de orden/OME, opcional si se usa n_afiliado
          - fecha (str):      DD/MM/YYYY
          - hora (str):       "08" a "23"
          - minuto (str):     "00", "10", "20", etc.
          - modalidad (str):  "P" o "T"
          - practica (str):   codigo de practica, o vacio para no filtrar
          - boca (str):       value del select de boca, o vacio para elegir cualquiera valida
        """
        with self._lock:
            self._stop_requested = False
            page = self._get_page()
            resultado_lote = ResultadoLote()
            total = len(lote)

            for idx, entrada in enumerate(lote, start=1):
                if self._stop_requested:
                    self._log("Lote detenido por el usuario antes de procesar la siguiente fila.")
                    break
                n_afiliado = str(entrada.get("n_afiliado", "")).strip()
                n_orden = str(entrada.get("n_orden", "")).strip()
                fecha = str(entrada.get("fecha", "")).strip()
                hora = str(entrada.get("hora", "")).strip().zfill(2)
                minuto = str(entrada.get("minuto", "")).strip().zfill(2)
                modalidad = str(entrada.get("modalidad", "P")).strip().upper() or "P"
                practica = str(entrada.get("practica", "")).strip()
                boca = str(entrada.get("boca", "")).strip()

                self._status(f"[{idx}/{total}] Procesando {n_afiliado} — {fecha} {hora}:{minuto} {modalidad}")
                ref = n_orden or n_afiliado or f"fila-{idx}"
                self._status(f"[{idx}/{total}] Procesando {ref} - {fecha} {hora}:{minuto} {modalidad}")
                self._log(f"--- Inicio {ref} ---")

                resultado = self._activar_uno(page, n_afiliado, n_orden, fecha, hora, minuto, modalidad, practica, boca)
                resultado_lote.detalle.append(resultado)

                if resultado.escenario == "SIN_ICONO" or resultado.estado_final == "SIN_ICONO":
                    resultado_lote.sin_icono += 1
                elif resultado.escenario == "ERROR" or resultado.estado_final in {"ERROR", "PENDIENTE", "VERIFICACION_FALLIDA"}:
                    resultado_lote.errores += 1
                else:
                    resultado_lote.ok += 1

                if progress_callback:
                    progress_callback({
                        "current": idx,
                        "total": total,
                        "n_afiliado": n_orden or n_afiliado or f"fila-{idx}",
                        "estado": resultado.estado_final,
                        "escenario": resultado.escenario,
                    })

                # Pausa entre beneficiarios para no saturar el portal
                if idx < total:
                    page.wait_for_timeout(1200)

            self._status(
                f"Lote finalizado: OK={resultado_lote.ok} | "
                f"Errores={resultado_lote.errores} | "
                f"Sin icono={resultado_lote.sin_icono}"
            )
            return resultado_lote

    def buscar_ome_lote(
        self,
        lote: list[dict],
        progress_callback: Optional[Callable[[dict], None]] = None,
    ) -> ResultadoLote:
        with self._lock:
            self._stop_requested = False
            page = self._get_page()
            resultado_lote = ResultadoLote()
            total = len(lote)

            for idx, entrada in enumerate(lote, start=1):
                if self._stop_requested:
                    self._log("Busqueda de OME detenida por el usuario antes de procesar la siguiente fila.")
                    break

                n_afiliado = str(entrada.get("n_afiliado", "")).strip()
                n_orden = str(entrada.get("n_orden", "")).strip()
                buscar_dni = bool(entrada.get("buscar_dni"))
                candidate_practices = entrada.get("candidate_practices") or []
                if not isinstance(candidate_practices, list):
                    candidate_practices = [str(candidate_practices).strip()]
                candidate_practices = [str(item or "").strip() for item in candidate_practices if str(item or "").strip()]
                if not candidate_practices:
                    candidate_practices = [str(entrada.get("practica", "") or "").strip()]
                candidate_practices = [item for item in candidate_practices if item is not None]

                ref = n_orden or n_afiliado or f"fila-{idx}"
                self._status(f"[{idx}/{total}] Buscando OME para {ref}")
                self._log(f"--- Buscar OME {ref} ---")

                resultado: ResultadoActivacion | None = None
                practicas_a_probar = candidate_practices or [""]
                for practica in practicas_a_probar:
                    intento = self._buscar_ome_uno(
                        page,
                        n_afiliado=n_afiliado,
                        n_orden=n_orden,
                        practica=practica,
                        buscar_dni=buscar_dni,
                    )
                    resultado = intento
                    if intento.n_orden_encontrada:
                        break

                if resultado is None:
                    resultado = ResultadoActivacion(
                        n_afiliado=n_afiliado,
                        n_orden_solicitada=n_orden,
                        escenario="SIN_RESULTADOS",
                        fecha="",
                        hora="",
                        minuto="",
                        modalidad="",
                        practica="",
                        boca="",
                        estado_final="NO_ENCONTRADA",
                        mensaje="No se encontro N° OME.",
                    )

                resultado_lote.detalle.append(resultado)
                if resultado.n_orden_encontrada:
                    resultado_lote.ok += 1
                else:
                    resultado_lote.errores += 1

                if progress_callback:
                    progress_callback(
                        {
                            "current": idx,
                            "total": total,
                            "n_afiliado": ref,
                            "estado": resultado.estado_final,
                            "escenario": resultado.escenario,
                        }
                    )

                if idx < total:
                    page.wait_for_timeout(900)

            self._status(
                f"Busqueda OME finalizada: OK={resultado_lote.ok} | "
                f"Errores={resultado_lote.errores}"
            )
            return resultado_lote

    def obtener_estado(self) -> dict:
        with self._lock:
            page = self._get_page()
            url = page.url or ""
            return {
                "url": url,
                "titulo": self._safe_title(page),
                "en_panel": "efector.php" in url,
                "timestamp": time.strftime("%d/%m/%Y %H:%M:%S"),
            }

    # ------------------------------------------------------------------
    # Logica interna de activacion
    # ------------------------------------------------------------------

    def _activar_uno(
        self,
        page: Page,
        n_afiliado: str,
        n_orden: str,
        fecha: str,
        hora: str,
        minuto: str,
        modalidad: str,
        practica: str,
        boca: str,
    ) -> ResultadoActivacion:
        try:
            # Paso 1: ir al panel y buscar el beneficiario/orden
            self._ir_al_panel(page)
            self._buscar_beneficiario(page, n_afiliado=n_afiliado, n_orden=n_orden, practica=practica)

            # Paso 2: detectar escenario y abrir modal
            deteccion = self._detectar_y_abrir_modal(page)
            escenario = str(deteccion.get("escenario", "SIN_ICONO"))
            n_orden_encontrada = str(deteccion.get("n_orden", "")).strip()
            practica_encontrada = str(deteccion.get("practica", "")).strip()
            codigo_practica = str(deteccion.get("codigo_practica", "")).strip()
            nombre_afiliado = str(deteccion.get("nombre_afiliado", "")).strip()
            beneficio_encontrado = str(deteccion.get("beneficio", "")).strip()
            estado_detectado = str(deteccion.get("estado", "")).strip()
            dni_encontrado = ""
            dni_encontrado = ""
            ref_log = n_orden or n_afiliado or "registro"

            if escenario == "SIN_RESULTADOS":
                self._log(f"{ref_log}: no se encontraron resultados para la busqueda aplicada.")
                return ResultadoActivacion(
                    n_afiliado=n_afiliado,
                    n_orden_solicitada=n_orden,
                    escenario="SIN_RESULTADOS",
                    fecha=fecha,
                    hora=hora,
                    minuto=minuto,
                    modalidad=modalidad,
                    practica=practica,
                    boca=boca,
                    estado_final="SIN_RESULTADOS",
                    n_orden_encontrada=n_orden_encontrada,
                    practica_encontrada=practica_encontrada,
                    codigo_practica=codigo_practica,
                    nombre_afiliado=nombre_afiliado,
                    estado_detectado=estado_detectado,
                    mensaje="No se encontraron ordenes con los filtros aplicados.",
                )

            if escenario == "NO_ACTIVABLE":
                motivo = estado_detectado or "SIN_ACCION"
                self._log(f"{ref_log}: orden no activable. Estado detectado: {motivo}")
                return ResultadoActivacion(
                    n_afiliado=n_afiliado,
                    n_orden_solicitada=n_orden,
                    escenario="NO_ACTIVABLE",
                    fecha=fecha,
                    hora=hora,
                    minuto=minuto,
                    modalidad=modalidad,
                    practica=practica,
                    boca=boca,
                    estado_final="NO_ACTIVABLE",
                    n_orden_encontrada=n_orden_encontrada,
                    practica_encontrada=practica_encontrada,
                    codigo_practica=codigo_practica,
                    nombre_afiliado=nombre_afiliado,
                    estado_detectado=motivo,
                    mensaje=f"La orden encontrada esta en estado '{motivo}' y no tiene accion de activar/modificar.",
                )

            if escenario == "SIN_ICONO":
                self._log(f"{ref_log}: sin icono disponible (ya procesado o en otro estado).")
                return ResultadoActivacion(
                    n_afiliado=n_afiliado,
                    n_orden_solicitada=n_orden,
                    escenario="SIN_ICONO",
                    fecha=fecha,
                    hora=hora,
                    minuto=minuto,
                    modalidad=modalidad,
                    practica=practica,
                    boca=boca,
                    estado_final="SIN_ICONO",
                    n_orden_encontrada=n_orden_encontrada,
                    practica_encontrada=practica_encontrada,
                    codigo_practica=codigo_practica,
                    nombre_afiliado=nombre_afiliado,
                    estado_detectado=estado_detectado,
                    mensaje="No se encontro icono de activar ni de modificar.",
                )

            if escenario == "SIN_RESULTADOS":
                self._log(f"{n_afiliado}: no se encontraron resultados para la búsqueda aplicada.")
                return ResultadoActivacion(
                    n_afiliado=n_afiliado,
                    escenario="SIN_RESULTADOS",
                    fecha=fecha, hora=hora, minuto=minuto, modalidad=modalidad, practica=practica, boca=boca,
                    estado_final="SIN_RESULTADOS",
                    mensaje="No se encontraron órdenes para el afiliado con la práctica seleccionada.",
                )

            if escenario.startswith("NO_ACTIVABLE"):
                motivo = escenario.split(":", 1)[1] if ":" in escenario else "SIN_ACCION"
                self._log(f"{n_afiliado}: orden no activable. Estado detectado: {motivo}")
                return ResultadoActivacion(
                    n_afiliado=n_afiliado,
                    escenario="NO_ACTIVABLE",
                    fecha=fecha, hora=hora, minuto=minuto, modalidad=modalidad, practica=practica, boca=boca,
                    estado_final="NO_ACTIVABLE",
                    mensaje=f"La orden encontrada está en estado '{motivo}' y no tiene acción de activar/modificar.",
                )

            if escenario == "SIN_ICONO":
                self._log(f"{n_afiliado}: sin icono disponible (ya procesado o en otro estado).")
                return ResultadoActivacion(
                    n_afiliado=n_afiliado,
                    escenario="SIN_ICONO",
                    fecha=fecha, hora=hora, minuto=minuto, modalidad=modalidad, practica=practica, boca=boca,
                    estado_final="SIN_ICONO",
                    mensaje="No se encontro icono de activar ni de modificar.",
                )

            # Paso 3: completar modal
            page.wait_for_timeout(1500)
            self._completar_modal(page, fecha, hora, minuto, modalidad, boca)

            # Paso 4: click en Aplicar (hidden, via JS)
            page.wait_for_timeout(800)
            self._click_aplicar(page)

            # Paso 5: click fisico en Aceptar o Guardar
            page.wait_for_timeout(1000)
            self._click_confirmar(page, escenario)

            # Paso 6: verificar resultado
            page.wait_for_timeout(1500)
            estado_final = self._verificar_resultado(page, n_afiliado or n_orden or "registro")

            self._log(
                f"{ref_log}: {estado_final} (escenario {escenario})"
                f"{f' | orden={n_orden_encontrada}' if n_orden_encontrada else ''}"
                f"{f' | practica={practica_encontrada}' if practica_encontrada else ''}"
            )
            return ResultadoActivacion(
                n_afiliado=n_afiliado,
                n_orden_solicitada=n_orden,
                escenario=escenario,
                fecha=fecha, hora=hora, minuto=minuto, modalidad=modalidad, practica=practica, boca=boca,
                estado_final=estado_final,
                n_orden_encontrada=n_orden_encontrada,
                practica_encontrada=practica_encontrada,
                codigo_practica=codigo_practica,
                nombre_afiliado=nombre_afiliado,
                estado_detectado=estado_detectado,
            )

        except Exception as exc:
            msg = str(exc)
            self._log(f"{n_afiliado}: ERROR — {msg}")
            ref_log = n_orden or n_afiliado or "registro"
            self._log(f"{ref_log}: ERROR - {msg}")
            # Intentar volver al panel para el siguiente
            try:
                page.goto(PAMI_PANEL_ACEPTACION_URL, wait_until="domcontentloaded")
                page.wait_for_timeout(1000)
            except Exception:
                pass
            return ResultadoActivacion(
                n_afiliado=n_afiliado,
                n_orden_solicitada=n_orden,
                escenario="ERROR",
                fecha=fecha, hora=hora, minuto=minuto, modalidad=modalidad, practica=practica, boca=boca,
                estado_final="ERROR",
                mensaje=msg,
            )

    def _ir_al_panel(self, page: Page) -> None:
        """Navega al Panel de Aceptacion si no esta ya ahi."""
        url = page.url or ""
        if "efector.php" not in url:
            page.goto(PAMI_PANEL_ACEPTACION_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(1200)

        # Si redirige a CUP, la sesion expiro
        if "cup.pami.org.ar" in (page.url or ""):
            raise RuntimeError(
                "La sesion de PAMI expiro. Inicia sesion manualmente en el navegador y vuelve a intentar."
            )

    def _session_is_active(self, page: Page) -> bool:
        try:
            response = page.goto(PAMI_PANEL_ACEPTACION_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(900)
            if "cup.pami.org.ar" in (page.url or ""):
                return False
            if response and response.status >= 400:
                return False
            return "efector.php" in (page.url or "") or page.locator("input[name='n_afiliado']").count() > 0
        except Exception:
            return False

    def _auto_login_cup(self, page: Page, usuario: str, clave: str) -> None:
        usuario = (usuario or "").strip()
        clave = clave or ""
        if not usuario or not clave:
            return

        if self._session_is_active(page):
            self._log("La sesion de CUP ya estaba activa.")
            return

        self._log("Iniciando sesion automatica en CUP PAMI para Activacion...")
        page.goto(CUP_LOGIN_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(900)

        user_input = page.locator('input[name="usuario"], input[type="text"], #usuario').first
        pass_input = page.locator('input[name="password"], input[type="password"], #password').first

        user_input.wait_for(state="visible")
        user_input.fill("")
        page.wait_for_timeout(250)
        user_input.type(usuario, delay=90)
        page.wait_for_timeout(250)

        pass_input.wait_for(state="visible")
        pass_input.fill("")
        page.wait_for_timeout(250)
        pass_input.type(clave, delay=90)
        page.wait_for_timeout(900)

        submit = page.locator(
            'button[type="submit"], input[type="submit"], button:has-text("Ingresar"), button:has-text("Entrar")'
        ).first
        submit.click()
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(2200)

        if CUP_LOGIN_URL in (page.url or "") and not self._session_is_active(page):
            raise RuntimeError("No se pudo iniciar sesion en CUP PAMI. Revisa usuario y clave.")

        self._log("Sesion iniciada automaticamente en CUP PAMI.")

    def _buscar_beneficiario(self, page: Page, n_afiliado: str = "", n_orden: str = "", practica: str = "") -> None:
        """Completa el formulario de busqueda y hace click en Buscar."""
        script = """
        ({ afiliado, orden, practica }) => {
            window.alert = function() { return true; };
            window.confirm = function() { return true; };
            function soloDigitos(valor) {
                return String(valor || '').replace(/\\D/g, '');
            }
            function inferirTipoAfiliado(valor) {
                var digitos = soloDigitos(valor);
                if (digitos.length >= 13 && digitos.length <= 15) return 'beneficio';
                if (digitos.length >= 7 && digitos.length <= 8) return 'dni';
                return 'afiliado_gp';
            }
            try {
                var fd = document.getElementById('f_emision_desde');
                if (fd && typeof $ !== 'undefined') {
                    $(fd).datepicker('setDate', '01/01/2025');
                }
            } catch(e) {}
            var inp = document.querySelector('input[name="n_afiliado"]');
            var tipoSelect =
                document.querySelector('select[name="afiliado_por"]') ||
                document.querySelector('select[name="tipo_afiliado"]') ||
                document.querySelector('select[id="afiliado_por"]') ||
                document.querySelector('select[id="tipo_afiliado"]') ||
                document.querySelector('select');
            var ordenInput =
                document.querySelector('input[name="n_orden"]') ||
                document.querySelector('input[id="n_orden"]') ||
                document.querySelector('input[placeholder*="Orden"]') ||
                document.querySelector('input[placeholder*="orden"]');

            if (!inp && !ordenInput) return 'NO_CAMPO';
            var tipoAfiliado = inferirTipoAfiliado(afiliado);
            if (tipoSelect) {
                var opciones = Array.from(tipoSelect.options || []);
                var elegida = null;
                if (tipoAfiliado === 'dni') {
                    elegida = opciones.find((opt) => {
                        var texto = String(opt.text || '').toUpperCase();
                        return texto.includes('DNI') || texto.includes('DOCUMENTO');
                    });
                } else {
                    elegida = opciones.find((opt) => {
                        var texto = String(opt.text || '').toUpperCase();
                        return texto.includes('AFILIADO') || texto.includes('GP');
                    });
                }
                if (elegida) {
                    tipoSelect.value = elegida.value;
                    tipoSelect.dispatchEvent(new Event('change', {bubbles: true}));
                }
            }
            if (inp) {
                inp.value = afiliado || '';
                inp.dispatchEvent(new Event('input', {bubbles: true}));
                inp.dispatchEvent(new Event('change', {bubbles: true}));
            }
            if (ordenInput) {
                ordenInput.value = orden || '';
                ordenInput.dispatchEvent(new Event('input', {bubbles: true}));
                ordenInput.dispatchEvent(new Event('change', {bubbles: true}));
            }

            var practicaInput =
                document.querySelector('input[name="practica"]') ||
                document.querySelector('input[name="c_practica"]') ||
                document.querySelector('input[id="practica"]') ||
                document.querySelector('input[id="c_practica"]') ||
                document.querySelector('input[placeholder*="Práctica"]') ||
                document.querySelector('input[placeholder*="Practica"]');

            if (!practicaInput) {
                var labels = Array.from(document.querySelectorAll('label, .input-group-addon, span, div'));
                var practicaLabel = labels.find((el) => {
                    var texto = String(el.textContent || '').trim().toUpperCase();
                    return texto === 'PRÁCTICA' || texto === 'PRACTICA';
                });
                if (practicaLabel) {
                    var parent = practicaLabel.parentElement;
                    if (parent) practicaInput = parent.querySelector('input');
                }
            }

            if (practicaInput) {
                practicaInput.value = practica || '';
                practicaInput.dispatchEvent(new Event('input', {bubbles: true}));
                practicaInput.dispatchEvent(new Event('change', {bubbles: true}));
            }

            var btn = document.querySelector('input[type="submit"][value="Buscar"]');
            if (!btn) return 'NO_BTN';
            btn.click();
            return 'OK:' + tipoAfiliado;
        }
        """
        result = page.evaluate(script, {"afiliado": n_afiliado, "orden": n_orden, "practica": practica})
        if not str(result).startswith("OK"):
            raise RuntimeError(f"No se pudo iniciar la busqueda del beneficiario: {result}")
        tipo_busqueda = str(result).split(":", 1)[1] if ":" in str(result) else ""

        page.wait_for_timeout(2000)
        filtros = []
        if n_afiliado:
            if tipo_busqueda == "dni":
                filtros.append(f"dni={n_afiliado}")
            elif tipo_busqueda == "beneficio":
                filtros.append(f"benef={n_afiliado}")
            else:
                filtros.append(f"afiliado={n_afiliado}")
        if n_orden:
            filtros.append(f"orden={n_orden}")
        filtros.append(f"practica={practica or 'sin filtro'}")
        self._log(f"Busqueda completada. {' | '.join(filtros)}")

    def _leer_orden_en_listado(self, page: Page, n_orden: str = "", practica: str = "") -> dict:
        script = """
        ([nOrden, practica]) => {
            function normalizar(texto) {
                return String(texto || '').replace(/\\s+/g, ' ').trim();
            }
            function canon(texto) {
                return normalizar(texto)
                    .normalize('NFD')
                    .replace(/[\\u0300-\\u036f]/g, '')
                    .toUpperCase();
            }
            function extraerCodigoPractica(texto) {
                var match = String(texto || '').match(/\\b(\\d{6})\\b/);
                return match ? match[1] : '';
            }
            function extraerNumero(texto, minLen, maxLen) {
                var tokens = String(texto || '').match(/\\d+/g) || [];
                var filtrados = tokens.filter(function(token) {
                    return token.length >= minLen && (!maxLen || token.length <= maxLen);
                });
                if (!filtrados.length) return '';
                filtrados.sort(function(a, b) { return b.length - a.length; });
                return filtrados[0];
            }
            function infoFila(tr) {
                if (!tr) return { n_orden: '', practica: '', codigo_practica: '', nombre_afiliado: '', beneficio: '', estado: '', escenario: 'SIN_RESULTADOS' };
                var tabla = tr.closest('table');
                var headers = tabla
                    ? Array.from(tabla.querySelectorAll('thead th')).map((el) => canon(el.innerText || el.textContent || ''))
                    : [];
                var celdas = Array.from(tr.querySelectorAll('td'));
                var textos = Array.from(tr.querySelectorAll('td, th'))
                    .map((el) => normalizar(el.innerText || el.textContent || ''))
                    .filter(Boolean);
                var orden = '';
                var practicaTexto = '';
                var codigoPractica = '';
                var nombreAfiliado = '';
                var beneficio = '';
                var estado = '';
                var escenario = '';
                var estadosConocidos = ['ACEPTADA', 'VALIDADA', 'TRANSMITIDA', 'PENDIENTE DE VALIDACION', 'PENDIENTE DE VALIDACIÓN', 'RECHAZADA', 'VENCIDA'];

                function valorPorHeader(fragmentos) {
                    for (var h = 0; h < headers.length; h++) {
                        var header = headers[h];
                        var coincide = fragmentos.every((frag) => header.includes(canon(frag)));
                        if (coincide && celdas[h]) {
                            return normalizar(celdas[h].innerText || celdas[h].textContent || '');
                        }
                    }
                    return '';
                }

                orden = valorPorHeader(['NRO', 'ORDEN']) || valorPorHeader(['ORDEN']) || orden;
                beneficio = valorPorHeader(['BENEFICIO']) || valorPorHeader(['AFILIADO']) || valorPorHeader(['GP']) || beneficio;
                nombreAfiliado = valorPorHeader(['APELLIDO', 'NOMBRE']) || valorPorHeader(['PACIENTE']) || nombreAfiliado;
                practicaTexto = valorPorHeader(['PRACTICA']) || practicaTexto;
                estado = valorPorHeader(['ESTADO']) || estado;
                orden = extraerNumero(orden, 8, 16) || orden;
                beneficio = extraerNumero(beneficio, 13, 15) || beneficio;
                if (practicaTexto && !codigoPractica) codigoPractica = extraerCodigoPractica(practicaTexto);
                if (!orden && celdas[0]) orden = extraerNumero(celdas[0].innerText || celdas[0].textContent || '', 8, 16) || normalizar(celdas[0].innerText || celdas[0].textContent || '');
                if (!beneficio && celdas[3]) beneficio = extraerNumero(celdas[3].innerText || celdas[3].textContent || '', 13, 15) || normalizar(celdas[3].innerText || celdas[3].textContent || '');
                if (!nombreAfiliado && celdas[4]) nombreAfiliado = normalizar(celdas[4].innerText || celdas[4].textContent || '');
                if (!estado && celdas[5]) estado = normalizar(celdas[5].innerText || celdas[5].textContent || '');
                if (!practicaTexto && celdas[6]) practicaTexto = normalizar(celdas[6].innerText || celdas[6].textContent || '');
                if (practicaTexto && !codigoPractica) codigoPractica = extraerCodigoPractica(practicaTexto);

                var aceptar = tr.querySelector('i.boton-historial[data-estado="aceptar"]');
                var modificar = tr.querySelector('i.boton-historial[data-estado="modificar"]');
                if (aceptar) escenario = 'A';
                else if (modificar) escenario = 'B';
                else escenario = 'INFO';

                for (var i = 0; i < textos.length; i++) {
                    var t = textos[i];
                    var upper = canon(t);
                    var numeroOrden = extraerNumero(t, 8, 16);
                    var numeroBeneficio = extraerNumero(t, 13, 15);
                    if (!beneficio && numeroBeneficio) beneficio = numeroBeneficio;
                    if (!orden && numeroOrden && (!beneficio || numeroOrden !== beneficio)) orden = numeroOrden;
                    if (!practicaTexto && /\\b\\d{6}\\b/.test(upper)) {
                        practicaTexto = t;
                        codigoPractica = extraerCodigoPractica(t);
                    }
                    if (!nombreAfiliado && /[A-ZÁÉÍÓÚÑ]{2,}/.test(upper) && !/^\\d+$/.test(t) && !/^\\d{6}\\s*-/.test(upper)) {
                        if (!estadosConocidos.some((estadoTexto) => upper.includes(canon(estadoTexto)))) {
                            nombreAfiliado = t;
                        }
                    }
                    if (!estado) {
                        for (var j = 0; j < estadosConocidos.length; j++) {
                            if (upper.includes(canon(estadosConocidos[j]))) {
                                estado = estadosConocidos[j];
                                break;
                            }
                        }
                    }
                }

                if (orden && beneficio && orden === beneficio) {
                    var ordenPrimeraCelda = celdas[0] ? extraerNumero(celdas[0].innerText || celdas[0].textContent || '', 8, 16) : '';
                    orden = ordenPrimeraCelda && ordenPrimeraCelda !== beneficio ? ordenPrimeraCelda : '';
                }

                return {
                    escenario: escenario,
                    n_orden: orden,
                    practica: practicaTexto,
                    codigo_practica: codigoPractica,
                    nombre_afiliado: nombreAfiliado,
                    beneficio: beneficio,
                    estado: estado
                };
            }

            var filas = Array.from(document.querySelectorAll('table tbody tr'))
                .filter((tr) => (tr.textContent || '').trim().length > 0);
            if (!filas.length) {
                var textoPantalla = canon(document.body && document.body.innerText ? document.body.innerText : '');
                if (textoPantalla.includes('SIN RESULTADOS') || textoPantalla.includes('NO SE ENCONTRARON') || textoPantalla.includes('LA BUSQUEDA NO ARROJO NINGUN RESULTADO')) {
                    return { escenario: 'SIN_RESULTADOS', n_orden: '', practica: '', codigo_practica: '', nombre_afiliado: '', beneficio: '', estado: '' };
                }
                return { escenario: 'SIN_RESULTADOS', n_orden: '', practica: '', codigo_practica: '', nombre_afiliado: '', beneficio: '', estado: '' };
            }

            var practicaCodigo = String(practica || '').trim();
            var filaObjetivo = null;
            if (nOrden) {
                filaObjetivo = filas.find((tr) => canon(tr.innerText || tr.textContent || '').includes(String(nOrden).trim()));
            }
            if (!filaObjetivo && practicaCodigo) {
                filaObjetivo = filas.find((tr) => canon(tr.innerText || tr.textContent || '').includes(practicaCodigo));
            }
            if (!filaObjetivo) {
                filaObjetivo = filas[0];
            }
            return infoFila(filaObjetivo);
        }
        """
        deteccion = page.evaluate(script, [n_orden, practica])
        return deteccion if isinstance(deteccion, dict) else {"escenario": "SIN_RESULTADOS"}

    def _buscar_ome_uno(
        self,
        page: Page,
        n_afiliado: str,
        n_orden: str = "",
        practica: str = "",
        buscar_dni: bool = False,
    ) -> ResultadoActivacion:
        ref_log = n_orden or n_afiliado or "registro"
        try:
            self._ir_al_panel(page)
            self._buscar_beneficiario(page, n_afiliado=n_afiliado, n_orden=n_orden, practica=practica)
            deteccion = self._leer_orden_en_listado(page, n_orden=n_orden, practica=practica)
            escenario = str(deteccion.get("escenario", "SIN_RESULTADOS")).strip() or "SIN_RESULTADOS"
            n_orden_encontrada = str(deteccion.get("n_orden", "")).strip()
            practica_encontrada = str(deteccion.get("practica", "")).strip()
            codigo_practica = str(deteccion.get("codigo_practica", "")).strip()
            nombre_afiliado = str(deteccion.get("nombre_afiliado", "")).strip()
            beneficio_encontrado = str(deteccion.get("beneficio", "")).strip()
            estado_detectado = str(deteccion.get("estado", "")).strip()
            dni_encontrado = ""

            if n_orden_encontrada:
                mensaje = "N° OME localizado."
                if buscar_dni:
                    try:
                        detalle = self._leer_detalle_info_orden(page, n_orden_encontrada)
                        dni_encontrado = self._normalizar_numero(detalle.get("dni", ""), 7, 8)
                        beneficio_detalle = self._normalizar_numero(detalle.get("beneficio", ""), 13, 15)
                        nombre_detalle = str(detalle.get("nombre", "") or "").strip()
                        if beneficio_detalle and not beneficio_encontrado:
                            beneficio_encontrado = beneficio_detalle
                        if nombre_detalle and not nombre_afiliado:
                            nombre_afiliado = nombre_detalle
                        if dni_encontrado:
                            self._log(f"{ref_log}: DNI detectado desde detalle {dni_encontrado}.")
                    except Exception as exc:
                        self._log(f"{ref_log}: no se pudo leer DNI desde detalle ({exc}).")
                mensaje = "Numero OME localizado."
                if estado_detectado:
                    mensaje += f" Estado actual: {estado_detectado}."
                self._log(f"{ref_log}: OME encontrada {n_orden_encontrada}{f' | practica={practica_encontrada}' if practica_encontrada else ''}")
                return ResultadoActivacion(
                    n_afiliado=n_afiliado,
                    n_orden_solicitada=n_orden,
                    escenario=escenario,
                    fecha="",
                    hora="",
                    minuto="",
                    modalidad="",
                    practica=practica,
                    boca="",
                    estado_final="ENCONTRADA",
                    n_orden_encontrada=n_orden_encontrada,
                    practica_encontrada=practica_encontrada,
                    codigo_practica=codigo_practica,
                    nombre_afiliado=nombre_afiliado,
                    beneficio_encontrado=beneficio_encontrado,
                    dni_encontrado=dni_encontrado,
                    estado_detectado=estado_detectado,
                    mensaje=mensaje,
                )

            self._log(f"{ref_log}: no se encontro N° OME en el listado.")
            return ResultadoActivacion(
                n_afiliado=n_afiliado,
                n_orden_solicitada=n_orden,
                escenario="SIN_RESULTADOS",
                fecha="",
                hora="",
                minuto="",
                modalidad="",
                practica=practica,
                boca="",
                estado_final="NO_ENCONTRADA",
                practica_encontrada=practica_encontrada,
                codigo_practica=codigo_practica,
                nombre_afiliado=nombre_afiliado,
                beneficio_encontrado=beneficio_encontrado,
                dni_encontrado=dni_encontrado,
                estado_detectado=estado_detectado,
                mensaje="No se encontro N° OME.",
            )
        except Exception as exc:
            msg = str(exc)
            self._log(f"{ref_log}: ERROR BUSCANDO OME - {msg}")
            return ResultadoActivacion(
                n_afiliado=n_afiliado,
                n_orden_solicitada=n_orden,
                escenario="ERROR",
                fecha="",
                hora="",
                minuto="",
                modalidad="",
                practica=practica,
                boca="",
                estado_final="ERROR",
                mensaje=msg,
            )

    def _normalizar_numero(self, value: str, min_len: int, max_len: int | None = None) -> str:
        digits = re.sub(r"\D+", "", str(value or ""))
        if len(digits) < min_len:
            return ""
        if max_len is not None and len(digits) > max_len:
            return ""
        return digits

    def _abrir_info_orden(self, page: Page, n_orden: str) -> bool:
        script = """
        (nOrden) => {
            function soloDigitos(texto) {
                return String(texto || '').replace(/\\D+/g, '');
            }
            const filas = Array.from(document.querySelectorAll('table tbody tr'))
                .filter((tr) => (tr.textContent || '').trim().length > 0);
            let objetivo = null;
            for (const tr of filas) {
                const celdas = Array.from(tr.querySelectorAll('td'));
                const ordenCelda = celdas.length ? soloDigitos(celdas[0].innerText || celdas[0].textContent || '') : '';
                const textoFila = soloDigitos(tr.innerText || tr.textContent || '');
                if ((ordenCelda && ordenCelda === nOrden) || textoFila.includes(nOrden)) {
                    objetivo = tr;
                    break;
                }
            }
            if (!objetivo) return false;
            const infoBtn = objetivo.querySelector(
                '.fa-info, .fa-info-circle, i.boton-historial[data-estado="info"], ' +
                '.boton-historial[data-estado="info"], [title*="Historial" i], [title*="Detalle" i]'
            );
            if (!infoBtn) return false;
            const clickable = infoBtn.closest('button, a, span, i') || infoBtn;
            clickable.click();
            return true;
        }
        """
        opened = bool(page.evaluate(script, str(n_orden or "").strip()))
        if opened:
            try:
                page.locator(".modal.show, .modal.in, .modal[style*='display: block']").last.wait_for(
                    state="visible",
                    timeout=5000,
                )
            except Exception:
                page.wait_for_timeout(900)
        return opened

    def _leer_datos_modal_info(self, page: Page) -> dict:
        script = """
        () => {
            function normalizar(texto) {
                return String(texto || '').replace(/\\s+/g, ' ').trim();
            }
            function canon(texto) {
                return normalizar(texto)
                    .normalize('NFD')
                    .replace(/[\\u0300-\\u036f]/g, '')
                    .toUpperCase();
            }
            function extraerNumero(texto, minLen, maxLen) {
                const tokens = String(texto || '').match(/\\d+/g) || [];
                const filtrados = tokens.filter((token) => token.length >= minLen && (!maxLen || token.length <= maxLen));
                if (!filtrados.length) return '';
                filtrados.sort((a, b) => b.length - a.length);
                return filtrados[0];
            }
            function valorPorHeader(modal, fragmentos) {
                const tablas = Array.from(modal.querySelectorAll('table'));
                for (const tabla of tablas) {
                    const headers = Array.from(tabla.querySelectorAll('thead th')).map((el) => canon(el.innerText || el.textContent || ''));
                    const fila = tabla.querySelector('tbody tr');
                    if (!headers.length || !fila) continue;
                    const celdas = Array.from(fila.querySelectorAll('td'));
                    for (let index = 0; index < headers.length; index += 1) {
                        const header = headers[index];
                        const coincide = fragmentos.every((frag) => header.includes(canon(frag)));
                        if (coincide && celdas[index]) {
                            return normalizar(celdas[index].innerText || celdas[index].textContent || '');
                        }
                    }
                }
                return '';
            }
            const candidatos = Array.from(document.querySelectorAll('.modal.show, .modal.in, .modal[style*="display: block"], [role="dialog"]'))
                .filter((node) => {
                    if (!node || node.id === 'modal-efector') return false;
                    const style = window.getComputedStyle(node);
                    if (!style) return false;
                    if (style.display === 'none' || style.visibility === 'hidden') return false;
                    return (node.innerText || node.textContent || '').trim().length > 0;
                });
            if (!candidatos.length) return {};
            const modal = candidatos[candidatos.length - 1];
            const rawText = String(modal.innerText || modal.textContent || '');
            let dni = valorPorHeader(modal, ['DOCUMENTO']) || valorPorHeader(modal, ['DNI']);
            let beneficio = valorPorHeader(modal, ['AFILIADO']) || valorPorHeader(modal, ['BENEFICIO']) || valorPorHeader(modal, ['GP']);
            let nombre = valorPorHeader(modal, ['APELLIDO', 'NOMBRE']) || valorPorHeader(modal, ['PACIENTE']);
            if (!dni) {
                const match = rawText.match(/(?:N[°º\\.]?\\s*DOCUMENTO|DOCUMENTO|DNI)\\s*:?\\s*([0-9][0-9.\\s]{5,20}[0-9])/i);
                if (match) dni = match[1];
            }
            if (!beneficio) {
                const match = rawText.match(/(?:N[°º\\.]?\\s*AFILIADO|AFILIADO|BENEFICIO|GP)\\s*:?\\s*([0-9][0-9.\\s]{10,20}[0-9])/i);
                if (match) beneficio = match[1];
            }
            if (!nombre) {
                const lineas = rawText.split(/\\r?\\n/).map((linea) => normalizar(linea)).filter(Boolean);
                for (const linea of lineas) {
                    const upper = canon(linea);
                    if (upper.includes('APELLIDO Y NOMBRE') || upper.includes('PACIENTE')) continue;
                    if (/^[A-ZÁÉÍÓÚÑ ]{6,}$/.test(linea) && !/\\d/.test(linea)) {
                        nombre = linea;
                        break;
                    }
                }
            }
            return {
                dni: extraerNumero(dni, 7, 8) || '',
                beneficio: extraerNumero(beneficio, 13, 15) || '',
                nombre: normalizar(nombre || ''),
            };
        }
        """
        detalle = page.evaluate(script)
        return detalle if isinstance(detalle, dict) else {}

    def _cerrar_modal_info(self, page: Page) -> None:
        try:
            modal = page.locator(".modal.show, .modal.in, .modal[style*='display: block']").last
            if modal.count() > 0:
                close_button = modal.locator(
                    "button:has-text('Cerrar'), .close, button[data-dismiss='modal'], [aria-label='Close']"
                ).first
                if close_button.count() > 0:
                    close_button.click(timeout=1000)
                    page.wait_for_timeout(300)
        except Exception:
            pass
        page.evaluate(
            """
            () => {
                document.querySelectorAll('.modal.show, .modal.in, .modal[style*="display: block"]').forEach((node) => {
                    node.style.display = 'none';
                    node.classList.remove('show', 'in');
                    node.setAttribute('aria-hidden', 'true');
                });
                document.querySelectorAll('.modal-backdrop').forEach((node) => node.remove());
                document.body.classList.remove('modal-open');
            }
            """
        )

    def _leer_detalle_info_orden(self, page: Page, n_orden: str) -> dict:
        n_orden = self._normalizar_numero(n_orden, 8)
        if not n_orden:
            return {}
        self._cerrar_modal_info(page)
        if not self._abrir_info_orden(page, n_orden):
            return {}
        page.wait_for_timeout(700)
        detalle = self._leer_datos_modal_info(page)
        self._cerrar_modal_info(page)
        return detalle

    def _detectar_y_abrir_modal(self, page: Page) -> str:
        """
        Detecta si hay icono de aceptar (A) o modificar (B) y hace click.
        Retorna: "A", "B", "SIN_RESULTADOS", "NO_ACTIVABLE:<estado>" o "SIN_ICONO".
        """
        script = """
        () => {
            window.alert = function() { return true; };
            window.confirm = function() { return true; };
            var a = document.querySelector('i.boton-historial[data-estado="aceptar"]');
            var m = document.querySelector('i.boton-historial[data-estado="modificar"]');
            if (a) { a.click(); return 'A'; }
            if (m) { m.click(); return 'B'; }

            var filas = Array.from(document.querySelectorAll('table tbody tr'))
                .filter((tr) => (tr.textContent || '').trim().length > 0);

            if (!filas.length) {
                var textoPantalla = (document.body && document.body.innerText ? document.body.innerText : '').toUpperCase();
                if (textoPantalla.includes('0 REGISTRO') || textoPantalla.includes('SIN RESULTADOS') || textoPantalla.includes('NO SE ENCONTRARON')) {
                    return 'SIN_RESULTADOS';
                }
                return 'SIN_ICONO';
            }

            var estadosConocidos = ['ACEPTADA', 'VALIDADA', 'TRANSMITIDA', 'PENDIENTE DE VALIDACIÓN', 'PENDIENTE DE VALIDACION', 'RECHAZADA', 'VENCIDA'];
            for (var i = 0; i < filas.length; i++) {
                var textoFila = String(filas[i].innerText || filas[i].textContent || '').toUpperCase();
                for (var j = 0; j < estadosConocidos.length; j++) {
                    if (textoFila.includes(estadosConocidos[j])) {
                        return 'NO_ACTIVABLE:' + estadosConocidos[j];
                    }
                }
            }

            return 'SIN_ICONO';
        }
        """
        escenario = page.evaluate(script)
        self._log(f"Escenario detectado: {escenario}")
        return escenario

    def _detectar_y_abrir_modal(self, page: Page) -> dict:
        """
        Detecta si hay icono de aceptar (A) o modificar (B) y hace click.
        Retorna dict con escenario, orden, practica y estado detectados.
        """
        script = """
        () => {
            window.alert = function() { return true; };
            window.confirm = function() { return true; };

            function normalizar(texto) {
                return String(texto || '').replace(/\\s+/g, ' ').trim();
            }

            function canon(texto) {
                return normalizar(texto)
                    .normalize('NFD')
                    .replace(/[\\u0300-\\u036f]/g, '')
                    .toUpperCase();
            }

            function infoFila(tr) {
                if (!tr) return { n_orden: '', practica: '', codigo_practica: '', nombre_afiliado: '', beneficio: '', estado: '' };
                var tabla = tr.closest('table');
                var headers = tabla
                    ? Array.from(tabla.querySelectorAll('thead th')).map((el) => canon(el.innerText || el.textContent || ''))
                    : [];
                var celdas = Array.from(tr.querySelectorAll('td'));
                var textos = Array.from(tr.querySelectorAll('td, th'))
                    .map((el) => normalizar(el.innerText || el.textContent || ''))
                    .filter(Boolean);
                var orden = '';
                var practica = '';
                var codigoPractica = '';
                var nombreAfiliado = '';
                var beneficio = '';
                var estado = '';
                var estadosConocidos = ['ACEPTADA', 'VALIDADA', 'TRANSMITIDA', 'PENDIENTE DE VALIDACION', 'PENDIENTE DE VALIDACIÓN', 'RECHAZADA', 'VENCIDA'];

                function valorPorHeader(fragmentos) {
                    for (var h = 0; h < headers.length; h++) {
                        var header = headers[h];
                        var coincide = fragmentos.every((frag) => header.includes(canon(frag)));
                        if (coincide && celdas[h]) {
                            return normalizar(celdas[h].innerText || celdas[h].textContent || '');
                        }
                    }
                    return '';
                }
                function extraerCodigoPractica(texto) {
                    var match = String(texto || '').match(/\\b(\\d{6})\\b/);
                    return match ? match[1] : '';
                }
                function extraerNumero(texto, minLen, maxLen) {
                    var tokens = String(texto || '').match(/\\d+/g) || [];
                    var filtrados = tokens.filter(function(token) {
                        return token.length >= minLen && (!maxLen || token.length <= maxLen);
                    });
                    if (!filtrados.length) return '';
                    filtrados.sort(function(a, b) { return b.length - a.length; });
                    return filtrados[0];
                }
                orden = valorPorHeader(['NRO', 'ORDEN']) || valorPorHeader(['ORDEN']) || orden;
                beneficio = valorPorHeader(['BENEFICIO']) || valorPorHeader(['AFILIADO']) || valorPorHeader(['GP']) || beneficio;
                nombreAfiliado = valorPorHeader(['APELLIDO', 'NOMBRE']) || valorPorHeader(['PACIENTE']) || nombreAfiliado;
                practica = valorPorHeader(['PRACTICA']) || practica;
                orden = extraerNumero(orden, 8, 16) || orden;
                beneficio = extraerNumero(beneficio, 13, 15) || beneficio;
                if (practica && !codigoPractica) {
                    codigoPractica = extraerCodigoPractica(practica);
                }
                estado = valorPorHeader(['ESTADO']) || estado;
                if (!orden && celdas[0]) orden = extraerNumero(celdas[0].innerText || celdas[0].textContent || '', 8, 16) || normalizar(celdas[0].innerText || celdas[0].textContent || '');
                if (!beneficio && celdas[3]) beneficio = extraerNumero(celdas[3].innerText || celdas[3].textContent || '', 13, 15) || normalizar(celdas[3].innerText || celdas[3].textContent || '');
                if (!nombreAfiliado && celdas[4]) nombreAfiliado = normalizar(celdas[4].innerText || celdas[4].textContent || '');
                if (!estado && celdas[5]) estado = normalizar(celdas[5].innerText || celdas[5].textContent || '');
                if (!practica && celdas[6]) practica = normalizar(celdas[6].innerText || celdas[6].textContent || '');
                if (practica && !codigoPractica) {
                    codigoPractica = extraerCodigoPractica(practica);
                }
                for (var i = 0; i < textos.length; i++) {
                    var t = textos[i];
                    var upper = t.toUpperCase();
                    var numeroOrden = extraerNumero(t, 8, 16);
                    var numeroBeneficio = extraerNumero(t, 13, 15);
                    if (!beneficio && numeroBeneficio) beneficio = numeroBeneficio;
                    if (!orden && numeroOrden && (!beneficio || numeroOrden !== beneficio)) orden = numeroOrden;
                    if (!practica && /\\b\\d{6}\\b/.test(upper)) {
                        practica = t;
                        codigoPractica = extraerCodigoPractica(t);
                    }
                    if (!nombreAfiliado && /[A-ZÁÉÍÓÚÑ]{2,}/.test(upper) && !/^\\d+$/.test(t) && !/^\\d{6}\\s*-/.test(upper)) {
                        if (!estadosConocidos.some((estadoTexto) => upper.includes(estadoTexto))) {
                            nombreAfiliado = t;
                        }
                    }
                    if (!estado) {
                        for (var j = 0; j < estadosConocidos.length; j++) {
                            if (upper.includes(estadosConocidos[j])) {
                                estado = estadosConocidos[j];
                                break;
                            }
                        }
                    }
                }

                if (orden && beneficio && orden === beneficio) {
                    var ordenPrimeraCelda = celdas[0] ? extraerNumero(celdas[0].innerText || celdas[0].textContent || '', 8, 16) : '';
                    orden = ordenPrimeraCelda && ordenPrimeraCelda !== beneficio ? ordenPrimeraCelda : '';
                }

                return {
                    n_orden: orden,
                    practica: practica,
                    codigo_practica: codigoPractica,
                    nombre_afiliado: nombreAfiliado,
                    beneficio: beneficio,
                    estado: estado
                };
            }

            function respuesta(escenario, tr, estadoManual) {
                var info = infoFila(tr);
                return {
                    escenario: escenario,
                    n_orden: info.n_orden || '',
                    practica: info.practica || '',
                    codigo_practica: info.codigo_practica || '',
                    nombre_afiliado: info.nombre_afiliado || '',
                    beneficio: info.beneficio || '',
                    estado: estadoManual || info.estado || ''
                };
            }

            var a = document.querySelector('i.boton-historial[data-estado="aceptar"]');
            var m = document.querySelector('i.boton-historial[data-estado="modificar"]');
            if (a) {
                var filaA = a.closest('tr');
                a.click();
                return respuesta('A', filaA, '');
            }
            if (m) {
                var filaM = m.closest('tr');
                m.click();
                return respuesta('B', filaM, '');
            }

            var filas = Array.from(document.querySelectorAll('table tbody tr'))
                .filter((tr) => (tr.textContent || '').trim().length > 0);

            if (!filas.length) {
                var textoPantalla = (document.body && document.body.innerText ? document.body.innerText : '').toUpperCase();
                if (textoPantalla.includes('0 REGISTRO') || textoPantalla.includes('SIN RESULTADOS') || textoPantalla.includes('NO SE ENCONTRARON') || textoPantalla.includes('LA BUSQUEDA NO ARROJO NINGUN RESULTADO') || textoPantalla.includes('LA BÚSQUEDA NO ARROJÓ NINGÚN RESULTADO')) {
                    return respuesta('SIN_RESULTADOS', null, '');
                }
                return respuesta('SIN_ICONO', null, '');
            }

            var textoFilas = filas.map((tr) => String(tr.innerText || tr.textContent || '').toUpperCase()).join(' || ');
            if (textoFilas.includes('LA BUSQUEDA NO ARROJO NINGUN RESULTADO') || textoFilas.includes('LA BÚSQUEDA NO ARROJÓ NINGÚN RESULTADO') || textoFilas.includes('NO ARROJO NINGUN RESULTADO') || textoFilas.includes('NO ARROJÓ NINGÚN RESULTADO')) {
                return respuesta('SIN_RESULTADOS', null, '');
            }

            var estadosConocidos = ['ACEPTADA', 'VALIDADA', 'TRANSMITIDA', 'PENDIENTE DE VALIDACIÃ“N', 'PENDIENTE DE VALIDACION', 'RECHAZADA', 'VENCIDA'];
            for (var i = 0; i < filas.length; i++) {
                var textoFila = String(filas[i].innerText || filas[i].textContent || '').toUpperCase();
                for (var j = 0; j < estadosConocidos.length; j++) {
                    if (textoFila.includes(estadosConocidos[j])) {
                        return respuesta('NO_ACTIVABLE', filas[i], estadosConocidos[j]);
                    }
                }
            }

            var hayOrdenReal = filas.some((tr) => /\\d{8,}/.test(String(tr.innerText || tr.textContent || '').replace(/\\s+/g, '')));
            if (!hayOrdenReal) {
                return respuesta('SIN_RESULTADOS', null, '');
            }

            return respuesta('SIN_ICONO', filas[0], '');
        }
        """
        deteccion = page.evaluate(script)
        if not isinstance(deteccion, dict):
            deteccion = {
                "escenario": str(deteccion or "SIN_ICONO"),
                "n_orden": "",
                "practica": "",
                "codigo_practica": "",
                "nombre_afiliado": "",
                "estado": "",
            }
        orden_log = f" | orden={deteccion.get('n_orden', '')}" if deteccion.get("n_orden") else ""
        practica_log = f" | practica={deteccion.get('practica', '')}" if deteccion.get("practica") else ""
        estado_log = f" | estado={deteccion.get('estado', '')}" if deteccion.get("estado") else ""
        self._log(
            "Escenario detectado: "
            f"{deteccion.get('escenario', 'SIN_ICONO')}"
            f"{orden_log}{practica_log}{estado_log}"
        )
        return deteccion

    def _completar_modal(self, page: Page, fecha: str, hora: str, minuto: str, modalidad: str, boca: str) -> None:
        """
        Setea fecha, hora, minuto y boca dentro del modal.

        Selector critico: input.datepicker.fecha (NO input[type="text"] que
        selecciona d_motivo como primer resultado).
        """
        try:
            page.locator("#modal-efector").wait_for(state="visible", timeout=8000)
        except Exception as exc:
            raise RuntimeError(f"Error al completar el modal: NO_MODAL_VISIBLE ({exc})") from exc

        try:
            page.wait_for_function(
                """
                () => {
                    var modal = document.getElementById('modal-efector');
                    if (!modal) return false;
                    return !!(
                        modal.querySelector('input.datepicker.fecha') ||
                        modal.querySelector('input.fecha') ||
                        modal.querySelector('input.hasDatepicker') ||
                        modal.querySelector('input[id*="fecha" i]') ||
                        modal.querySelector('input[name*="fecha" i]')
                    );
                }
                """,
                timeout=8000,
            )
        except Exception:
            pass

        script = """
        ([fecha, hora, minuto, modalidad, boca, bocaTextoPreferida]) => {
            window.alert = function() { return true; };
            window.confirm = function() { return true; };

            var modal = document.getElementById('modal-efector');
            if (!modal) return 'NO_MODAL';

            function buscarInputFecha() {
                var candidatos = [
                    'input.datepicker.fecha',
                    'input.fecha',
                    'input.hasDatepicker',
                    'input[id*="fecha" i]',
                    'input[name*="fecha" i]'
                ];
                for (var i = 0; i < candidatos.length; i++) {
                    var encontrado = modal.querySelector(candidatos[i]);
                    if (encontrado) return encontrado;
                }

                var labels = Array.from(modal.querySelectorAll('label, .control-label, .input-group-addon, span, td, th, div'));
                var fechaLabel = labels.find((el) => {
                    var texto = String(el.textContent || '').replace(/\\s+/g, ' ').trim().toUpperCase();
                    return texto === 'FECHA' || texto.startsWith('FECHA ');
                });
                if (fechaLabel) {
                    var parent = fechaLabel.parentElement;
                    if (parent) {
                        var porParent = parent.querySelector('input');
                        if (porParent) return porParent;
                    }
                    var sibling = fechaLabel.nextElementSibling;
                    if (sibling) {
                        var porSibling = sibling.querySelector ? sibling.querySelector('input') : null;
                        if (porSibling) return porSibling;
                    }
                }
                return null;
            }

            var df = buscarInputFecha();
            if (!df) return 'NO_FECHA_FIELD';
            if (typeof $ !== 'undefined') {
                $(df).datepicker('setDate', fecha);
            } else {
                df.value = fecha;
                df.dispatchEvent(new Event('input', {bubbles: true}));
                df.dispatchEvent(new Event('change', {bubbles: true}));
            }

            // Selects: [0]=motivo, [1]=hora, [2]=minuto, [3]=modalidad, [4]=boca
            var s = modal.querySelectorAll('select');
            if (s.length < 5) return 'POCOS_SELECTS:' + s.length;

            s[1].value = hora;
            s[1].dispatchEvent(new Event('change', {bubbles: true}));

            s[2].value = minuto;
            s[2].dispatchEvent(new Event('change', {bubbles: true}));

            var modalidadSelect = s[3];
            var modalidadOpciones = Array.from(modalidadSelect.options || []);
            var modalidadElegida = modalidadOpciones.find((opt) => String(opt.value || '').toUpperCase() === String(modalidad || 'P').toUpperCase());
            if (!modalidadElegida) {
                modalidadElegida = modalidadOpciones.find((opt) => String(opt.text || '').toUpperCase().startsWith(String(modalidad || 'P').toUpperCase()));
            }
            if (!modalidadElegida) return 'SIN_MODALIDAD_VALIDA';

            modalidadSelect.value = modalidadElegida.value;
            modalidadSelect.dispatchEvent(new Event('change', {bubbles: true}));

            var bocaSelect = s[4];
            var opciones = Array.from(bocaSelect.options || []);
            var elegida = null;

            if (boca) {
                elegida = opciones.find((opt) => String(opt.value || '') === String(boca));
            }

            if (!elegida && bocaTextoPreferida) {
                var textoBuscado = String(bocaTextoPreferida).toUpperCase();
                elegida = opciones.find((opt) => String(opt.text || '').toUpperCase().includes(textoBuscado));
            }

            if (!elegida) {
                elegida = opciones.find((opt) => String(opt.value || '').trim() && !opt.disabled);
            }

            if (!elegida) return 'SIN_BOCA_VALIDA';

            bocaSelect.value = elegida.value;
            bocaSelect.dispatchEvent(new Event('change', {bubbles: true}));

            return 'OK:' + modalidadElegida.value + ':' + elegida.value + ':' + String(elegida.text || '').trim();
        }
        """
        result = page.evaluate(script, [fecha, hora, minuto, modalidad, boca, BOCA_PREFERIDA_TEXTO])
        if not result.startswith("OK"):
            raise RuntimeError(f"Error al completar el modal: {result}")
        _, modalidad_resuelta, boca_resuelta, boca_texto = (result.split(":", 3) + ["", "", ""])[:4]
        boca_log = boca_texto or boca_resuelta or boca or "sin dato"
        self._log(f"Modal completado: {fecha} {hora}:{minuto} modalidad={modalidad_resuelta or modalidad} boca={boca_log}")

    def _click_aplicar(self, page: Page) -> None:
        """
        Force-click en el boton Aplicar (que suele estar oculto).
        Es obligatorio antes de Aceptar/Guardar para propagar los datos
        a todas las filas de practica del modal.
        """
        script = """
        () => {
            window.alert = function() { return true; };
            window.confirm = function() { return true; };
            var modal = document.getElementById('modal-efector');
            if (!modal) return 'NO_MODAL';
            var btn = modal.querySelector('.btn.aplicar');
            if (!btn) return 'NO_APLICAR';
            btn.click();
            return 'OK';
        }
        """
        result = page.evaluate(script)
        if result != "OK":
            raise RuntimeError(f"No se pudo hacer click en Aplicar: {result}")
        self._log("Aplicar ejecutado.")

    def _click_confirmar(self, page: Page, escenario: str) -> None:
        """
        Click fisico en el boton de confirmacion (Aceptar en escenario A,
        Guardar en escenario B).

        Se usa page.mouse.click() porque JS el.click() no dispara el handler
        del boton en PAMI v4.18.x.
        Si el click normal falla, se calcula el centro real del boton visible
        para evitar depender de una coordenada fija.
        """
        selector = ".btn-success.cambiar-estado.aceptar" if escenario == "A" else ".btn-primary.cambiar-estado.modificar"

        # Intentar primero con el locator de Playwright (hace scroll + click real)
        try:
            btn_locator = page.locator(selector).first
            btn_locator.wait_for(state="visible", timeout=3000)
            btn_locator.click()
            try:
                page.locator("#modal-efector").wait_for(state="hidden", timeout=8000)
            except Exception:
                pass
            self._log(f"Click en boton de confirmacion (escenario {escenario}) via locator.")
            return
        except Exception as exc:
            self._log(f"Locator no funciono ({exc}), intentando click fisico sobre el boton detectado.")

        # Fallback: click fisico en el centro real del boton encontrado
        try:
            btn_locator = page.locator(selector).first
            btn_locator.wait_for(state="attached", timeout=3000)
            btn_locator.scroll_into_view_if_needed(timeout=3000)
            box = btn_locator.bounding_box()
            if not box:
                raise RuntimeError("No se pudo obtener la posicion del boton de confirmacion.")
            center_x = box["x"] + (box["width"] / 2)
            center_y = box["y"] + (box["height"] / 2)
            page.mouse.click(center_x, center_y)
            try:
                page.locator("#modal-efector").wait_for(state="hidden", timeout=8000)
            except Exception:
                pass
            self._log(f"Click fisico en el centro del boton ({center_x:.1f}, {center_y:.1f}) para escenario {escenario}.")
        except Exception as exc:
            raise RuntimeError(f"No se pudo confirmar la accion del modal: {exc}") from exc

    def _verificar_resultado(self, page: Page, n_afiliado: str) -> str:
        """
        Verifica si la OME quedo ACEPTADA o sigue PENDIENTE.
        Vuelve a buscar el beneficiario para ver el estado actualizado.
        """
        try:
            self._buscar_beneficiario(page, n_afiliado)
            resultado = page.evaluate("""
            () => {
                var pendiente = document.querySelector('i.boton-historial[data-estado="aceptar"]');
                return pendiente ? 'PENDIENTE' : 'ACEPTADA';
            }
            """)
            return resultado
        except Exception:
            return "VERIFICACION_FALLIDA"

    def _verificar_resultado(self, page: Page, n_afiliado: str = "", n_orden: str = "", practica: str = "") -> str:
        """
        Verifica si la OME quedo activada y en que estado posterior visible quedo.
        """
        try:
            def leer_estado():
                return page.evaluate(
                """
                ([nOrden, practica]) => {
                    function normalizar(texto) {
                        return String(texto || '').replace(/\\s+/g, ' ').trim().toUpperCase();
                    }
                    function detectarEstado(texto) {
                        var t = normalizar(texto);
                        if (t.includes('PENDIENTE DE VALIDACION') || t.includes('PENDIENTE DE VALIDACIÓN') || t.includes('PENDIENTE DE VALIDACIÃ“N') || t.includes('PENDIENTE DE VALIDACIÃƒâ€œN')) {
                            return 'LISTA_PARA_VALIDARSE';
                        }
                        if (t.includes('VALIDADA')) return 'VALIDADA';
                        if (t.includes('ACEPTADA')) return 'ACEPTADA';
                        if (t.includes('TRANSMITIDA')) return 'TRANSMITIDA';
                        if (t.includes('RECHAZADA')) return 'RECHAZADA';
                        if (t.includes('VENCIDA')) return 'VENCIDA';
                        return '';
                    }

                    var filas = Array.from(document.querySelectorAll('table tbody tr'))
                        .filter((tr) => (tr.textContent || '').trim().length > 0);
                    var practicaCodigo = String(practica || '').trim();
                    var filaObjetivo = null;

                    if (nOrden) {
                        filaObjetivo = filas.find((tr) => normalizar(tr.innerText || tr.textContent || '').includes(String(nOrden).trim()));
                    }
                    if (!filaObjetivo && practicaCodigo) {
                        filaObjetivo = filas.find((tr) => normalizar(tr.innerText || tr.textContent || '').includes(practicaCodigo));
                    }
                    if (!filaObjetivo && filas.length) {
                        filaObjetivo = filas[0];
                    }

                    if (filaObjetivo) {
                        var estadoFila = detectarEstado(filaObjetivo.innerText || filaObjetivo.textContent || '');
                        if (estadoFila) return estadoFila;

                        var pendienteFila = filaObjetivo.querySelector('i.boton-historial[data-estado="aceptar"]');
                        var modificarFila = filaObjetivo.querySelector('i.boton-historial[data-estado="modificar"]');
                        if (pendienteFila || modificarFila) return 'PENDIENTE';
                    }

                    var texto = String(document.body && document.body.innerText ? document.body.innerText : '').toUpperCase();
                    var estadoPantalla = detectarEstado(texto);
                    if (estadoPantalla) return estadoPantalla;

                    var pendiente = document.querySelector('i.boton-historial[data-estado="aceptar"]');
                    var modificar = document.querySelector('i.boton-historial[data-estado="modificar"]');
                    return (pendiente || modificar) ? 'PENDIENTE' : 'ACEPTADA';
                }
                """,
                [n_orden, practica],
            )
            self._buscar_beneficiario(page, n_afiliado=n_afiliado, n_orden=n_orden, practica=practica)
            resultado = leer_estado()
            if resultado == "PENDIENTE":
                page.wait_for_timeout(2500)
                self._buscar_beneficiario(page, n_afiliado=n_afiliado, n_orden=n_orden, practica=practica)
                reintento = leer_estado()
                if reintento != "PENDIENTE":
                    return reintento
            return resultado
        except Exception:
            return "VERIFICACION_FALLIDA"

    def _mensaje_estado_final(self, estado_final: str) -> str:
        estado = str(estado_final or "").strip().upper()
        mensajes = {
            "LISTA_PARA_VALIDARSE": "Lista para validarse.",
            "PENDIENTE_VALIDACION": "Lista para validarse.",
            "VALIDADA": "Validada.",
            "ACEPTADA": "Aceptada.",
            "TRANSMITIDA": "Transmitida.",
            "RECHAZADA": "Rechazada.",
            "VENCIDA": "Vencida.",
            "PENDIENTE": "Revisar: PAMI mantuvo la orden con accion pendiente.",
            "VERIFICACION_FALLIDA": "No se pudo verificar el estado final.",
        }
        return mensajes.get(estado, f"Estado final: {estado_final}.")

    def _activar_uno(
        self,
        page: Page,
        n_afiliado: str,
        n_orden: str,
        fecha: str,
        hora: str,
        minuto: str,
        modalidad: str,
        practica: str,
        boca: str,
    ) -> ResultadoActivacion:
        ref_log = n_orden or n_afiliado or "registro"
        n_orden_encontrada = ""
        practica_encontrada = ""
        codigo_practica = ""
        nombre_afiliado = ""
        beneficio_encontrado = ""
        estado_detectado = ""
        try:
            self._ir_al_panel(page)
            self._buscar_beneficiario(page, n_afiliado=n_afiliado, n_orden=n_orden, practica=practica)

            deteccion = self._detectar_y_abrir_modal(page)
            escenario = str(deteccion.get("escenario", "SIN_ICONO"))
            n_orden_encontrada = str(deteccion.get("n_orden", "")).strip()
            practica_encontrada = str(deteccion.get("practica", "")).strip()
            codigo_practica = str(deteccion.get("codigo_practica", "")).strip()
            nombre_afiliado = str(deteccion.get("nombre_afiliado", "")).strip()
            beneficio_encontrado = str(deteccion.get("beneficio", "")).strip()
            estado_detectado = str(deteccion.get("estado", "")).strip()

            if escenario == "SIN_RESULTADOS":
                self._log(f"{ref_log}: no se encontraron resultados para la busqueda aplicada.")
                return ResultadoActivacion(
                    n_afiliado=n_afiliado,
                    n_orden_solicitada=n_orden,
                    escenario="SIN_RESULTADOS",
                    fecha=fecha,
                    hora=hora,
                    minuto=minuto,
                    modalidad=modalidad,
                    practica=practica,
                    boca=boca,
                    estado_final="SIN_RESULTADOS",
                    n_orden_encontrada=n_orden_encontrada,
                    practica_encontrada=practica_encontrada,
                    beneficio_encontrado=beneficio_encontrado,
                    estado_detectado=estado_detectado,
                    mensaje="No se encontraron ordenes con los filtros aplicados.",
                )

            if escenario == "NO_ACTIVABLE":
                motivo = estado_detectado or "SIN_ACCION"
                self._log(f"{ref_log}: orden no activable. Estado detectado: {motivo}")
                return ResultadoActivacion(
                    n_afiliado=n_afiliado,
                    n_orden_solicitada=n_orden,
                    escenario="NO_ACTIVABLE",
                    fecha=fecha,
                    hora=hora,
                    minuto=minuto,
                    modalidad=modalidad,
                    practica=practica,
                    boca=boca,
                    estado_final="NO_ACTIVABLE",
                    n_orden_encontrada=n_orden_encontrada,
                    practica_encontrada=practica_encontrada,
                    beneficio_encontrado=beneficio_encontrado,
                    estado_detectado=motivo,
                    mensaje=f"La orden encontrada esta en estado '{motivo}' y no tiene accion de activar/modificar.",
                )

            if escenario == "SIN_ICONO":
                self._log(f"{ref_log}: sin icono disponible (ya procesado o en otro estado).")
                return ResultadoActivacion(
                    n_afiliado=n_afiliado,
                    n_orden_solicitada=n_orden,
                    escenario="SIN_ICONO",
                    fecha=fecha,
                    hora=hora,
                    minuto=minuto,
                    modalidad=modalidad,
                    practica=practica,
                    boca=boca,
                    estado_final="SIN_ICONO",
                    n_orden_encontrada=n_orden_encontrada,
                    practica_encontrada=practica_encontrada,
                    beneficio_encontrado=beneficio_encontrado,
                    estado_detectado=estado_detectado,
                    mensaje="No se encontro icono de activar ni de modificar.",
                )

            page.wait_for_timeout(1500)
            self._completar_modal(page, fecha, hora, minuto, modalidad, boca)

            page.wait_for_timeout(800)
            self._click_aplicar(page)

            page.wait_for_timeout(1000)
            self._click_confirmar(page, escenario)

            page.wait_for_timeout(1500)
            estado_final = self._verificar_resultado(page, n_afiliado=n_afiliado, n_orden=n_orden, practica=practica)

            self._log(
                f"{ref_log}: {estado_final} (escenario {escenario})"
                f"{f' | orden={n_orden_encontrada}' if n_orden_encontrada else ''}"
                f"{f' | practica={practica_encontrada}' if practica_encontrada else ''}"
            )
            return ResultadoActivacion(
                n_afiliado=n_afiliado,
                n_orden_solicitada=n_orden,
                escenario=escenario,
                fecha=fecha,
                hora=hora,
                minuto=minuto,
                modalidad=modalidad,
                practica=practica,
                boca=boca,
                estado_final=estado_final,
                n_orden_encontrada=n_orden_encontrada,
                practica_encontrada=practica_encontrada,
                codigo_practica=codigo_practica,
                nombre_afiliado=nombre_afiliado,
                beneficio_encontrado=beneficio_encontrado,
                estado_detectado=estado_detectado,
                mensaje=self._mensaje_estado_final(estado_final),
            )

        except Exception as exc:
            msg = str(exc)
            self._log(f"{ref_log}: ERROR - {msg}")
            try:
                page.goto(PAMI_PANEL_ACEPTACION_URL, wait_until="domcontentloaded")
                page.wait_for_timeout(1000)
            except Exception:
                pass
            return ResultadoActivacion(
                n_afiliado=n_afiliado,
                n_orden_solicitada=n_orden,
                escenario="ERROR",
                fecha=fecha,
                hora=hora,
                minuto=minuto,
                modalidad=modalidad,
                practica=practica,
                boca=boca,
                estado_final="ERROR",
                mensaje=msg,
            )

    # ------------------------------------------------------------------
    # Session management
    # ------------------------------------------------------------------

    def _get_page(self) -> Page:
        self._cleanup_dead_session()
        if self._sesion is None:
            raise RuntimeError("Primero abre el panel de aceptacion desde la app.")
        return self._sesion.page

    def _cleanup_dead_session(self) -> None:
        if self._sesion is None:
            return
        try:
            if self._sesion.page.is_closed():
                self._dispose_session(
                    "El navegador fue cerrado. Podes volver a abrirlo.",
                    "Sesion limpiada porque la pagina fue cerrada manualmente.",
                )
                return
        except Exception:
            self._dispose_session(
                "La sesion del navegador no esta disponible. Podes volver a abrirlo.",
                "Sesion limpiada porque Playwright no pudo acceder a la pagina.",
            )
            return
        try:
            _ = list(self._sesion.context.pages)
        except Exception:
            self._dispose_session(
                "El contexto del navegador no esta disponible. Podes volver a abrirlo.",
                "Sesion limpiada porque el contexto estaba cerrado.",
            )

    def _dispose_session(self, status_message: str, log_message_text: str) -> None:
        sesion = self._sesion
        if sesion is None:
            return
        self._sesion = None
        for fn in (sesion.context.close, sesion.browser.close, sesion.playwright.stop):
            try:
                fn()
            except Exception:
                pass
        self._status(status_message)
        self._log(log_message_text)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _try_autofill_credenciales(self, page: Page, usuario: str, clave: str, timeout_ms: int = 12000) -> bool:
        usuario = (usuario or "").strip()
        clave = clave or ""
        if not usuario and not clave:
            return False

        estrategias_usuario = [
            ("selector", "input[name='usuario']"),
            ("selector", "input[name='username']"),
            ("selector", "input[id='usuario']"),
            ("label", "Usuario"),
            ("selector", "form input[type='text']"),
            ("selector", "input[type='text']"),
        ]
        estrategias_clave = [
            ("selector", "input[type='password']"),
            ("selector", "input[name='clave']"),
            ("selector", "input[name='password']"),
        ]

        end_time = time.time() + (timeout_ms / 1000)
        while time.time() < end_time:
            user_ok = self._fill_first_visible(page, estrategias_usuario, usuario) if usuario else False
            pass_ok = self._fill_first_visible(page, estrategias_clave, clave) if clave else False
            if (not usuario or user_ok) and (not clave or pass_ok):
                self._status(f"Login autocompletado: {usuario}")
                self._log("Credenciales aplicadas en login.")
                return True
            try:
                page.wait_for_timeout(500)
            except Exception:
                break

        self._log(f"No se pudieron autocompletar credenciales en {page.url}")
        return False

    def _fill_first_visible(self, page: Page, estrategias: list, valor: str) -> bool:
        if not valor:
            return False
        for tipo, selector in estrategias:
            try:
                locator = page.get_by_label(selector).first if tipo == "label" else page.locator(selector).first
                if locator.count() == 0:
                    continue
                locator.wait_for(state="visible", timeout=800)
                locator.fill(valor)
                return True
            except Exception:
                continue
        return False

    def _safe_title(self, page: Page) -> str:
        try:
            return page.title()
        except Exception:
            return ""

    def _on_console(self, msg) -> None:
        try:
            self._log(msg.text)
        except Exception:
            pass

    def _on_page_error(self, err) -> None:
        try:
            self._log(f"[PAGEERROR] {err}")
        except Exception:
            pass

    def _log(self, message: str) -> None:
        log_message(message)
        self.log_callback(message)

    def _status(self, message: str) -> None:
        log_message(f"[ACTIVAR] {message}")
        self.status_callback(message)
