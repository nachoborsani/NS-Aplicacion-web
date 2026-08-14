import random
import re
import threading
import time
import unicodedata
from dataclasses import dataclass
from typing import Callable, Optional

from playwright.sync_api import Browser, BrowserContext, Page, Playwright, sync_playwright

from app_logging import log_message
from pami_scraper import configurar_playwright


PAMI_LOGIN_URL = "https://cup.pami.org.ar"
PAMI_GENERAR_OME_URL = "https://pe.pami.org.ar/controllers/generar_orden.php"
PAMI_OME_LOGIN_REDIRECT_URL = "https://cup.pami.org.ar/controllers/loginController.php?redirect=https://pe.pami.org.ar"
PAMI_PANEL_ACEPTACION_URL = "https://pe.pami.org.ar/controllers/efector.php"

EXTRAER_OMES_EXISTENTES_SCRIPT = r"""
async (fechaHoy) => {
  if (!window.bandeja || window.bandeja.length === 0) return [];
  const domInfo = {};
  document.querySelectorAll('table tbody tr').forEach(tr => {
    const calBtn = tr.querySelector('.fa-calendar');
    const aceptarBtn = tr.querySelector(
      'i.boton-historial[data-estado="aceptar"], .boton-historial[data-estado="aceptar"], .fa-check'
    );
    const modificarBtn = tr.querySelector('i.boton-historial[data-estado="modificar"], .boton-historial[data-estado="modificar"]');
    const cancelarBtn = tr.querySelector(
      'i.boton-historial[data-estado="cancelar"], .boton-historial[data-estado="cancelar"], ' +
      'i.boton-historial[data-estado="anular"], .boton-historial[data-estado="anular"], .fa-ban, .fa-times, .fa-remove'
    );
    const infoBtn = tr.querySelector('.fa-info, .fa-info-circle');
    const accionBtn = aceptarBtn || modificarBtn || cancelarBtn || calBtn || infoBtn;
    if (!accionBtn) return;
    const celdas = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim());
    const orden = accionBtn.getAttribute('data-orden') || celdas[0] || '';
    if (!orden) return;
    let estadoAccion = 'activada_info';
    let mismoEfector = true;
    if (aceptarBtn) {
      estadoAccion = 'disponible_activar';
      mismoEfector = true;
    } else if (calBtn && cancelarBtn) {
      estadoAccion = 'activada_modificable';
      mismoEfector = true;
    } else if (calBtn && infoBtn) {
      estadoAccion = 'activada_otro_prestador';
      mismoEfector = false;
    } else if (modificarBtn || calBtn) {
      estadoAccion = 'activada_modificable';
      mismoEfector = true;
    } else if (infoBtn) {
      estadoAccion = 'transmitida';
      mismoEfector = true;
    }
    domInfo[orden] = { mismo_efector: mismoEfector, estado_accion: estadoAccion };
  });
  const hoy = new Date(fechaHoy);
  const parseFecha = (valor) => {
    if (!valor) return null;
    const sf = String(valor).split(' ')[0];
    const p = sf.split('/');
    if (p.length !== 3) return null;
    const ft = new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
    return isNaN(ft) ? null : ft;
  };
  const omes = [];
  for (const ome of window.bandeja) {
    const domData = domInfo[ome.n_orden];
    if (domData?.estado_accion === 'disponible_activar') {
      const fv = parseFecha(ome.f_vencimiento);
      if (fv && fv < hoy) continue;
      omes.push({
        n_orden: ome.n_orden,
        n_beneficio: ome.n_beneficio,
        practica: ome.d_practica,
        f_vencimiento: ome.f_vencimiento,
        f_agenda: '',
        mismo_efector: true,
        estado_accion: domData.estado_accion || '',
        turno_asignado: false,
        ya_transmitida: false,
        transmitida: false
      });
      continue;
    }
    if (ome.id_estado_efector !== '2' || !domData) continue;
    const resp = await fetch('ajax/efectores_detalle.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `orden=${ome.n_orden}&estado=info&bene=${ome.n_beneficio}&gp=${ome.c_grado_paren}`
    });
    const det = await resp.json();
    const agenda = det.prescripcion?.[0]?.agenda?.[0];
    if (!agenda?.f_agenda) continue;
    const sf = agenda.f_agenda.split(' ')[0];
    const ft = parseFecha(sf);
    const fv = parseFecha(ome.f_vencimiento);
    if (!ft) continue;
    if (ft < hoy && (!fv || fv < hoy)) continue;
    omes.push({
      n_orden: ome.n_orden,
      n_beneficio: ome.n_beneficio,
      practica: ome.d_practica,
      f_vencimiento: ome.f_vencimiento,
      f_agenda: sf,
      mismo_efector: domData.mismo_efector,
      estado_accion: domData.estado_accion || '',
      turno_asignado: domData.mismo_efector && domData.estado_accion !== 'transmitida',
      ya_transmitida: domData.estado_accion === 'transmitida',
      transmitida: domData.estado_accion === 'transmitida'
    });
  }
  return omes;
}
"""


@dataclass
class SesionOme:
    playwright: Playwright
    browser: Browser
    context: BrowserContext
    page: Page


class PamiOmeController:
    def __init__(
        self,
        log_callback: Optional[Callable[[str], None]] = None,
        status_callback: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.log_callback = log_callback or (lambda _: None)
        self.status_callback = status_callback or (lambda _: None)
        self._lock = threading.RLock()
        self._sesion: SesionOme | None = None
        self._stop_requested = False

    def request_stop(self) -> None:
        self._stop_requested = True

    def clear_stop_request(self) -> None:
        self._stop_requested = False

    def abrir_pami(self, usuario: str | None = None, clave: str | None = None) -> None:
        with self._lock:
            self._cleanup_dead_session()

            if self._sesion is not None:
                self._log("Ya habia un navegador abierto. Se cerrara para iniciar una sesion nueva de OME.")
                self._dispose_session(
                    "Se cerro la sesion anterior para abrir una nueva.",
                    "Sesion anterior de OME descartada antes de abrir nuevamente.",
                )

            configurar_playwright()
            playwright = sync_playwright().start()
            browser = playwright.chromium.launch(
                headless=False,
                args=["--window-size=1280,900"],
            )
            context = browser.new_context(
                ignore_https_errors=True,
                viewport={"width": 1280, "height": 900},
            )
            context.on("page", self._on_context_page)
            page = context.new_page()
            page.set_default_timeout(20000)
            page.on("console", self._on_console)
            page.on("pageerror", self._on_page_error)
            page.goto(PAMI_OME_LOGIN_REDIRECT_URL, wait_until="domcontentloaded")

            self._sesion = SesionOme(
                playwright=playwright,
                browser=browser,
                context=context,
                page=page,
            )
            self._status("Navegador abierto. Inicia sesion en CUP y deja lista la pantalla para generar OME.")
            self._log(f"Navegador abierto en {PAMI_OME_LOGIN_REDIRECT_URL}")
            if usuario or clave:
                self._try_autofill_credenciales(page, usuario or "", clave or "", timeout_ms=15000)

    def cerrar_navegador(self) -> None:
        with self._lock:
            if self._sesion is None:
                self._status("No hay navegador abierto para cerrar.")
                self._log("Cerrar navegador solicitado, pero no habia sesion activa de OME.")
                return
            self._dispose_session("Navegador cerrado desde la app.", "Sesion de OME cerrada manualmente desde la app.")

    def descartar_sesion_rota(self) -> None:
        with self._lock:
            if self._sesion is None:
                return
            self._dispose_session(
                "La conexion con el navegador se corto. Volve a ejecutar para abrir una sesion limpia.",
                "Sesion de OME descartada porque Playwright cerro la conexion con el driver.",
            )

    def autocompletar_credenciales(self, usuario: str, clave: str | None = None) -> None:
        with self._lock:
            usuario = (usuario or "").strip()
            clave = clave or ""
            if not usuario and not clave:
                raise RuntimeError("Ingresa usuario o clave antes de autocompletar.")

            page = self._get_page()
            if not self._try_autofill_credenciales(page, usuario, clave, timeout_ms=12000):
                raise RuntimeError(
                    "No encontre los campos de login en la pantalla actual. "
                    "Abre CUP y deja visible el login antes de usar esta funcion."
                )

    def ir_a_generar_ome(self) -> None:
        with self._lock:
            self._cleanup_dead_session()
            self._navigate_to_ome_if_needed()
            page = self._get_ome_page()
            self._status("Pantalla Generar OME lista para definir el flujo.")
            self._log(f"Pantalla Generar OME detectada en {page.url}")

    def obtener_estado(self) -> dict:
        with self._lock:
            self._cleanup_dead_session()
            page = self._get_best_available_page()
            url = page.url or ""
            estado = {
                "url": url,
                "titulo": self._safe_page_title(page),
                "login_detectado": self._page_looks_like_login(page),
                "ome_detectado": self._page_looks_like_ome(page),
                "timestamp": time.strftime("%d/%m/%Y %H:%M:%S"),
            }
            self._status(
                "Estado actualizado: "
                f"login={'si' if estado['login_detectado'] else 'no'} | "
                f"ome={'si' if estado['ome_detectado'] else 'no'}"
            )
            return estado

    def sesion_activa(self) -> bool:
        with self._lock:
            self._cleanup_dead_session()
            if self._sesion is None:
                return False
            try:
                page = self._get_best_available_page()
                return not page.is_closed()
            except Exception:
                return False

    def ejecutar_lote_en_pagina_actual(
        self,
        records: list[dict],
        progress_callback: Optional[Callable[[dict], None]] = None,
    ) -> list[dict]:
        with self._lock:
            if not records:
                raise RuntimeError("No hay filas para ejecutar.")

            self.clear_stop_request()
            self._cleanup_dead_session()
            self._navigate_to_ome_if_needed()
            results: list[dict] = []
            total = len(records)
            stopped = False
            try:
                for index, record in enumerate(records, start=1):
                    if self._stop_requested:
                        self._log("Lote OME detenido por el usuario antes de iniciar la siguiente fila.")
                        self._status("Lote OME detenido por el usuario.")
                        stopped = True
                        break
                    page = self._get_ome_page()
                    self._status(f"OME {index}/{total}: preparando {record.get('modo', 'BENEF')} {record.get('afiliado', '')}")
                    result = self._procesar_registro_ome(page, record)
                    results.append(result)
                    if progress_callback:
                        progress_callback(
                            {
                                "current": index,
                                "total": total,
                                "modo": result["modo"],
                                "afiliado": result["afiliado"],
                                "nombre": result["nombre"],
                                "resultado": result["resultado"],
                                "nro_ome": result["nro_ome"],
                            }
                        )
                    if (result.get("resultado") or "").upper() == "ERROR_DNI_MODAL":
                        self._log(
                            f"Lote OME interrumpido: no se pudo abrir el modal de DNI para {result.get('afiliado', '')}."
                        )
                        self._status("Lote OME interrumpido por falla al abrir el modal de DNI.")
                        stopped = True
                        break

                if not stopped:
                    self._status("Bot OME finalizado sobre la pantalla visible.")
                return results
            finally:
                self.clear_stop_request()

    def cerrar(self) -> None:
        with self._lock:
            if self._sesion is None:
                return
            self._dispose_session("Navegador cerrado.", "Sesion de OME cerrada.")

    def _get_page(self) -> Page:
        self._cleanup_dead_session()
        if self._sesion is None:
            raise RuntimeError("Primero abre CUP desde la app.")
        return self._sesion.page

    def _get_best_available_page(self) -> Page:
        page = self._get_page()
        if self._sesion is None:
            return page

        candidatas = list(self._sesion.context.pages)
        if page not in candidatas:
            candidatas.append(page)

        for candidata in reversed(candidatas):
            try:
                if candidata.is_closed():
                    continue
                url = (candidata.url or "").strip()
            except Exception:
                continue

            if url and url != "about:blank":
                self._sesion.page = candidata
                return candidata

        return page

    def _get_ome_page(self) -> Page:
        self._cleanup_dead_session()
        if self._sesion is None:
            raise RuntimeError("Primero abre CUP desde la app.")

        candidatas = list(self._sesion.context.pages)
        if self._sesion.page not in candidatas:
            candidatas.append(self._sesion.page)

        self._log(f"Paginas detectadas en el contexto OME: {len(candidatas)}")

        for candidata in reversed(candidatas):
            try:
                url = candidata.url or ""
            except Exception:
                url = ""

            if "generar_orden.php" in url:
                self._sesion.page = candidata
                self._log(f"Pagina OME encontrada por URL: {url}")
                self._ensure_ome_page(candidata)
                return candidata

        for candidata in reversed(candidatas):
            try:
                self._log(f"Probando pagina OME por DOM: {candidata.url}")
                self._ensure_ome_page(candidata)
                self._sesion.page = candidata
                self._log(f"Pagina OME encontrada por DOM: {candidata.url}")
                return candidata
            except Exception:
                continue

        page = self._get_best_available_page()
        self._log(f"No se encontro coincidencia automatica para OME. Ultima URL conocida: {page.url}")
        self._ensure_ome_page(page)
        return page

    def _ensure_ome_page(self, page: Page) -> None:
        url = page.url or ""
        if "generar_orden.php" in url:
            return
        try:
            if self._page_looks_like_ome(page):
                self._log(f"Pantalla OME validada por DOM aunque la URL no coincidia: {url}")
                return
        except Exception:
            pass

        raise RuntimeError(
            "La pestaña actual no esta en la pantalla de Generar OME. "
            "Inicia sesion y verifica que el acceso siga habilitado."
        )

    def _navigate_to_ome_if_needed(self) -> None:
        if self._sesion is None:
            raise RuntimeError("Primero abre CUP desde la app.")

        try:
            page = self._get_ome_page()
            self._ensure_ome_page(page)
            return
        except Exception:
            pass

        page = self._get_best_available_page()
        self._log(f"Intentando navegar automaticamente a OME desde: {page.url}")

        try:
            page.goto(PAMI_GENERAR_OME_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(1200)
            self._ensure_ome_page(page)
            self._sesion.page = page
            self._log(f"Navegacion automatica exitosa a OME: {page.url}")
            return
        except Exception as exc:
            self._log(f"No se pudo navegar automaticamente a OME en la pagina actual: {exc}")

        try:
            nueva = self._sesion.context.new_page()
            nueva.set_default_timeout(20000)
            nueva.on("console", self._on_console)
            nueva.on("pageerror", self._on_page_error)
            nueva.goto(PAMI_GENERAR_OME_URL, wait_until="domcontentloaded")
            nueva.wait_for_timeout(1200)
            self._ensure_ome_page(nueva)
            self._sesion.page = nueva
            self._log(f"Navegacion automatica exitosa a OME en nueva pagina: {nueva.url}")
        except Exception as exc:
            self._log(f"No se pudo abrir OME en una nueva pagina: {exc}")
            raise RuntimeError(
                "No pude abrir la pantalla Generar OME desde la sesion actual. "
                "Revisa si CUP sigue logueado y si el acceso a OME esta habilitado."
            ) from exc

    def _procesar_registro_ome(self, page: Page, record: dict) -> dict:
        modo = (record.get("modo") or "BENEF").strip().upper()
        afiliado = (record.get("afiliado") or "").strip()
        expected_beneficio = (record.get("beneficio") or "").strip()
        expected_dni = (record.get("dni") or "").strip()
        diagnostico = (record.get("diagnostico") or "").strip().upper()
        practica = (record.get("practica") or "").strip().upper()
        nombre = ""
        effective_record = dict(record)
        completar_benef_rapido = str(record.get("completar_benef", "")).strip().lower() in {
            "1",
            "si",
            "sí",
            "sÃ­",
            "true",
            "x",
            "yes",
            "y",
        }

        completar_dni_rapido = str(record.get("completar_dni", "")).strip().lower() in {
            "1",
            "si",
            "true",
            "x",
            "yes",
            "y",
        }

        if completar_benef_rapido:
            return self._procesar_completar_benef_desde_modal(page, record)
        if completar_dni_rapido:
            return self._procesar_completar_dni_desde_benef(page, record)

        try:
            self._prepare_clean_form(page)
            self._human_pause(0.8, 1.2)

            completar_benef = str(record.get("completar_benef", "")).strip().lower() in {"1", "si", "sÃ­", "true", "x", "yes", "y"}
            lookup_mode = modo
            lookup_value = afiliado
            if expected_beneficio and not completar_benef:
                lookup_mode = "BENEF"
                lookup_value = expected_beneficio
                effective_record["modo"] = "BENEF"
                effective_record["afiliado"] = expected_beneficio
            elif lookup_mode == "DNI" and expected_dni:
                lookup_value = expected_dni
            n_afiliado_busqueda = lookup_value
            if lookup_mode == "DNI":
                completar_benef = str(record.get("completar_benef", "")).strip().lower() in {"1", "si", "sí", "true", "x", "yes", "y"}
                lookup = self._load_patient_by_dni(
                    page,
                    lookup_value,
                    expected_name=(record.get("nombre") or "").strip(),
                    allow_name_match_on_multiple=completar_benef,
                )
                if lookup == "BAJA":
                    return self._build_result_row(record, "", "BAJA", "")
                if lookup == "__ERROR__DNI_MULTIPLE":
                    return self._build_result_row(record, "", "DOBLE_DNI", "")
                if lookup == "__ERROR__DNI_SIN_RESULTADOS":
                    return self._build_result_row(record, "", "NO_DNI", "")
                if lookup.startswith("__ERROR__"):
                    return self._build_result_row(record, "", lookup.replace("__ERROR__", "ERROR_", 1), "")
                nombre = lookup
                n_afiliado_busqueda = self._read_benefit_value(page) or lookup_value
            else:
                nombre = self._load_patient_by_benefit(page, lookup_value)

            if not nombre:
                self._log(f"No se encontro afiliado para {lookup_mode} {lookup_value}")
                fallback_result = "NO_DNI" if lookup_mode == "DNI" else "NO_PAMI"
                return self._build_result_row(record, "", fallback_result, "")

            effective_record["beneficio"] = self._read_benefit_value(page) or (
                lookup_value if lookup_mode != "DNI" else ""
            )
            effective_record["dni"] = self._read_document_value(page) or (
                lookup_value if lookup_mode == "DNI" else expected_dni
            )

            if (
                lookup_mode == "DNI"
                and expected_beneficio
                and effective_record["beneficio"]
                and not completar_benef
                and not self._same_numeric_identifier(effective_record["beneficio"], expected_beneficio)
            ):
                self._log(
                    f"{modo} {afiliado}: BENEF distinto al esperado por DNI. "
                    f"esperado='{expected_beneficio}' obtenido='{effective_record['beneficio']}'. Reintentando por BENEF."
                )
                self._prepare_clean_form(page)
                nombre = self._load_patient_by_benefit(page, expected_beneficio)
                if not nombre:
                    return self._build_result_row(record, "", "NO_PAMI", "")
                effective_record["modo"] = "BENEF"
                effective_record["afiliado"] = expected_beneficio
                effective_record["beneficio"] = self._read_benefit_value(page) or expected_beneficio
                effective_record["dni"] = self._read_document_value(page) or expected_dni
                n_afiliado_busqueda = effective_record["beneficio"] or expected_beneficio

            if str(record.get("completar_benef", "")).strip().lower() in {"1", "si", "sí", "true", "x", "yes", "y"}:
                self._log(
                    f"{modo} {afiliado}: BENEF_COMPLETADO beneficio='{effective_record.get('beneficio', '')}' "
                    f"dni='{effective_record.get('dni', '')}'."
                )
                return self._build_result_row(effective_record, nombre, "BENEF_COMPLETADO", "")

            self._fill_code_with_events(page, "#pe-diagnostico_cod", diagnostico)
            page.wait_for_timeout(1500)
            self._click_first_dropdown(page, diagnostico, starts_with=True)

            self._cleanup_modals(page)
            retry_capita_done = bool(record.get("_capita_retry_done"))
            while True:
                current_practice = (effective_record.get("practica") or "").strip().upper()
                self._log(f"{modo} {afiliado}: intentando practica {current_practice}.")
                rows_before_clear = self._count_prescribed_practice_rows(page)
                self._log(f"{modo} {afiliado}: filas de practica antes de limpiar={rows_before_clear}.")
                self._clear_prescribed_practices(page)
                rows_after_clear = self._count_prescribed_practice_rows(page)
                input_after_clear = self._read_input_value(page, "#pe-practica")
                self._log(
                    f"{modo} {afiliado}: despues de limpiar filas={rows_after_clear} input_practica='{input_after_clear}'."
                )
                self._cleanup_modals(page)
                self._set_practice_code(page, current_practice)
                practice_input_after_set = self._read_input_value(page, "#pe-practica")
                practice_rows_after_set = self._count_prescribed_practice_rows(page)
                self._log(
                    f"{modo} {afiliado}: despues de cargar practica input_practica='{practice_input_after_set}' filas={practice_rows_after_set}."
                )
                practice_input_before_generate = self._read_input_value(page, "#pe-practica")
                practice_rows_before_generate = self._count_prescribed_practice_rows(page)
                self._log(
                    f"{modo} {afiliado}: antes de generar input_practica='{practice_input_before_generate}' filas={practice_rows_before_generate}."
                )
                self._human_pause()
                page.locator("#pe-btn-generar-orden").first.click()
                outcome = self._wait_for_generation_outcome(page, current_practice, timeout_ms=5000)
                self._log(f"{modo} {afiliado}: outcome detectado={outcome}.")
                if outcome == "confirm":
                    self._human_pause(0.4, 0.8)
                    self._click_confirm_in_modal(page)
                    page.wait_for_timeout(5000)
                elif outcome == "capita":
                    page.wait_for_timeout(300)
                else:
                    page.wait_for_timeout(5000)

                feedback_text = self._read_visible_feedback_text(page)
                if feedback_text:
                    self._log(f"{modo} {afiliado}: feedback visible='{self._summarize_text(feedback_text)}'.")
                body_text = (page.locator("body").inner_text() or "").lower()
                retry_feedback = "\n".join(part for part in [feedback_text, body_text] if part)
                if retry_feedback and self._should_retry_with_capita(retry_feedback, current_practice):
                    self._close_capita_alert(page)
                    self._cleanup_modals(page)
                    if retry_capita_done:
                        self._log(f"{modo} {afiliado}: el aviso de capita persiste despues del reintento con 427109.")
                        return self._build_result_row(effective_record, nombre, "ERROR_RESULTADO_NO_CONFIRMADO", "")
                    self._log(f"{modo} {afiliado}: practica {current_practice} no corresponde por capita. Reintentando con 427109 sobre el mismo paciente.")
                    effective_record["practica"] = "427109"
                    retry_capita_done = True
                    continue
                break
            combined_feedback = "\n".join(part for part in [feedback_text, body_text] if part)
            if self._contains_annual_limit_message(combined_feedback):
                self._log(f"{modo} {afiliado}: clasificado como LIMITE_ANUAL.")
                return self._build_result_row(effective_record, nombre, "LIMITE_ANUAL", "")
            if self._contains_limit_message(combined_feedback):
                self._log(f"{modo} {afiliado}: clasificado como LIMITE.")
                return self._build_result_row(effective_record, nombre, "LIMITE", "")
            if self._contains_existing_ome_message(combined_feedback):
                nro_ome_existente = ""
                try:
                    nro_ome_existente = self._obtener_nro_ome_desde_detalle(page)
                except Exception as exc:
                    self._log(
                        f"{modo} {afiliado}: no se pudo extraer nro_ome directo "
                        f"desde modal GENERADA: {exc}"
                    )
                if not nro_ome_existente:
                    try:
                        self._close_feedback_modal(page)
                    except Exception as exc:
                        self._log(f"{modo} {afiliado}: no se pudo cerrar el modal de OME existente: {exc}")
                try:
                    if not nro_ome_existente:
                        nro_ome_existente = self._buscar_nro_ome_existente_generada(
                            page, n_afiliado_busqueda, effective_record["practica"]
                        )
                except Exception as exc:
                    self._log(
                        f"{modo} {afiliado}: no se pudo recuperar el Nro OME existente, "
                        f"pero el caso queda como YA_TIENE_OME: {exc}"
                    )
                self._log(
                    f"{modo} {afiliado}: clasificado como YA_TIENE_OME. nro_ome_existente='{nro_ome_existente}'."
                )
                return self._build_result_row(effective_record, nombre, "YA_TIENE_OME", nro_ome_existente)
            if self._contains_success_message(combined_feedback):
                nro_ome = self._obtener_nro_ome_desde_detalle(page)
                self._log(f"{modo} {afiliado}: clasificado como OK. nro_ome='{nro_ome}'.")
                return self._build_result_row(effective_record, nombre, "OK", nro_ome)

            nro_ome = self._obtener_nro_ome_desde_detalle(page)
            if nro_ome:
                self._log(f"{modo} {afiliado}: clasificado como OK por nro_ome visible. nro_ome='{nro_ome}'.")
                return self._build_result_row(effective_record, nombre, "OK", nro_ome)

            self._log(f"No se pudo confirmar resultado para {modo} {afiliado}")
            return self._build_result_row(effective_record, nombre, "ERROR_RESULTADO_NO_CONFIRMADO", "")
        except Exception as exc:
            self._log(f"Error procesando {modo} {afiliado}: {exc}")
            return self._build_result_row(effective_record, nombre, "ERROR_PROCESO", "")

    def _build_result_row(self, record: dict, nombre: str, resultado: str, nro_ome: str) -> dict:
        modo = (record.get("modo") or "BENEF").strip().upper()
        afiliado = (record.get("afiliado") or "").strip()
        beneficio = (record.get("beneficio") or "").strip()
        dni = (record.get("dni") or "").strip()
        if modo == "DNI" and not dni:
            dni = afiliado
        if modo != "DNI" and not beneficio:
            beneficio = afiliado
        return {
            "modo": modo,
            "afiliado": afiliado,
            "beneficio": beneficio,
            "dni": dni,
            "nombre": nombre.strip(),
            "diagnostico": (record.get("diagnostico") or "").strip().upper(),
            "practica": (record.get("practica") or "").strip().upper(),
            "resultado": resultado,
            "nro_ome": nro_ome.strip(),
        }

    def _same_numeric_identifier(self, left: str, right: str) -> bool:
        left_digits = re.sub(r"\D+", "", left or "")
        right_digits = re.sub(r"\D+", "", right or "")
        return bool(left_digits and right_digits) and left_digits == right_digits

    def _load_patient_by_benefit(self, page: Page, afiliado: str) -> str:
        previous_name = self._read_patient_name(page)
        locator = page.locator("#pe-n_afiliado").first
        locator.click()
        locator.fill("")
        locator.type(afiliado, delay=70)
        self._human_pause()
        page.locator("#pe-btn-bsq-afiliado").first.click()
        return self._wait_for_patient_name(page, timeout_ms=6000, previous_value=previous_name)

    def _open_patient_search_modal(self, page: Page) -> Locator | None:
        button = page.locator("#pe-btn-bsq-afiliado").first
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                self._cleanup_modals(page)
                page.wait_for_timeout(200)
                button.scroll_into_view_if_needed()
                if attempt == 0:
                    button.click(timeout=2500)
                elif attempt == 1:
                    button.click(timeout=2500, force=True)
                else:
                    page.evaluate(
                        """
                        () => {
                          const btn = document.querySelector('#pe-btn-bsq-afiliado');
                          if (!btn) return false;
                          btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                          btn.click?.();
                          return true;
                        }
                        """
                    )
                page.wait_for_timeout(650)
                modal = page.locator(".modal.show, .modal.in, .modal[style*='display: block']").last
                modal.wait_for(state="visible", timeout=4000)
                return modal
            except Exception as exc:
                last_error = exc
                self._cleanup_modals(page)
                page.wait_for_timeout(300)
        self._log(f"No se pudo abrir el modal de busqueda: {last_error}")
        return None

    def _load_patient_by_dni(
        self,
        page: Page,
        dni: str,
        expected_name: str = "",
        *,
        allow_name_match_on_multiple: bool = False,
    ) -> str:
        previous_name = self._read_patient_name(page)
        modal = self._open_patient_search_modal(page)
        if modal is None:
            self._log(f"No se pudo abrir el modal de busqueda por DNI {dni}.")
            return "__ERROR__DNI_MODAL"

        select = modal.locator("select").first
        select.select_option("n_documento")
        page.wait_for_timeout(350)

        primary_input = modal.locator("#bsq_avz_afiliado_valor").first
        filled = False
        try:
            primary_input.wait_for(state="visible", timeout=2000)
            filled = self._force_fill_visible_input(page, primary_input, dni)
        except Exception:
            filled = False

        if not filled:
            filled = self._force_fill_exact_dni_input(page, dni)

        if not filled:
            filled = self._force_fill_dni_modal_inputs(page, modal, dni)

        if not filled:
            self._log(f"No se pudo cargar el DNI {dni} en el modal de busqueda.")
            return "__ERROR__DNI_CARGA"
        self._log(f"DNI modal cargado con valor final: {self._read_dni_modal_value(page)!r}")
        self._human_pause()
        modal.locator("button:has-text('Buscar')").first.click()
        page.wait_for_timeout(1200)

        rows = modal.locator("table tbody tr")
        count = rows.count()
        if count == 0:
            return "__ERROR__DNI_SIN_RESULTADOS"

        active_rows = []
        active_candidates: list[tuple[int, str, object]] = []
        for idx in range(count):
            row = rows.nth(idx)
            cells = row.locator("td")
            baja = ""
            if cells.count() >= 7:
                baja = (cells.nth(6).inner_text() or "").strip()
            if not baja:
                active_rows.append(row)
                candidate_name = ""
                if cells.count() >= 3:
                    candidate_name = (cells.nth(2).inner_text() or "").strip()
                active_candidates.append((idx, candidate_name, row))

        if not active_rows:
            return "BAJA"
        if len(active_rows) > 1:
            if allow_name_match_on_multiple and expected_name:
                scored = [
                    (self._name_match_score(expected_name, candidate_name), idx, candidate_name, row)
                    for idx, candidate_name, row in active_candidates
                ]
                scored.sort(reverse=True)
                if scored and scored[0][0] >= 0.5:
                    top_score = scored[0][0]
                    top_matches = [item for item in scored if item[0] == top_score]
                    if len(top_matches) == 1:
                        self._log(
                            "DNI multiple resuelto solo para completar BENEF por nombre de hoja: "
                            f"'{expected_name}' -> '{top_matches[0][2]}'."
                        )
                        top_matches[0][3].click()
                        patient_name = self._wait_for_patient_name(page, timeout_ms=6000, previous_value=previous_name)
                        return patient_name or "__ERROR__DNI_SELECCION"
            return "__ERROR__DNI_MULTIPLE"

        active_rows[0].click()
        patient_name = self._wait_for_patient_name(page, timeout_ms=6000, previous_value=previous_name)
        return patient_name or "__ERROR__DNI_SELECCION"

    def _procesar_completar_benef_desde_modal(self, page: Page, record: dict) -> dict:
        lookup_value = (record.get("dni") or record.get("afiliado") or "").strip()
        if not lookup_value:
            return self._build_result_row(record, "", "NO_DNI", "")

        modal = self._benef_lookup_modal(page)
        if modal is None:
            result = self._build_result_row(record, "", "ERROR_DNI_MODAL", "")
            result["dni"] = lookup_value
            return result

        lookup = self._lookup_benefit_in_modal(
            page,
            modal,
            lookup_value,
            expected_name=(record.get("nombre") or "").strip(),
            allow_name_match_on_multiple=True,
        )
        status = lookup.get("status", "")
        if status == "OK":
            effective_record = dict(record)
            effective_record["beneficio"] = (lookup.get("beneficio") or "").strip()
            effective_record["dni"] = (lookup.get("dni") or "").strip() or lookup_value
            self._log(
                f"DNI {lookup_value}: BENEF_COMPLETADO desde modal "
                f"beneficio='{effective_record['beneficio']}' nombre='{lookup.get('nombre', '')}'."
            )
            return self._build_result_row(
                effective_record,
                (lookup.get("nombre") or "").strip(),
                "BENEF_COMPLETADO",
                "",
            )
        if status == "BAJA":
            result = "BAJA"
        elif status == "__ERROR__DNI_MULTIPLE":
            result = "DOBLE_DNI"
        elif status == "__ERROR__DNI_MODAL":
            result = "ERROR_DNI_MODAL"
        else:
            result = "NO_DNI"
        output = self._build_result_row(record, "", result, "")
        output["dni"] = lookup_value
        output["beneficio"] = ""
        return output

    def _procesar_completar_dni_desde_benef(self, page: Page, record: dict) -> dict:
        lookup_value = (record.get("beneficio") or record.get("afiliado") or "").strip()
        if not lookup_value:
            return self._build_result_row(record, "", "ERROR_SIN_BENEF", "")

        effective_record = dict(record)
        effective_record["modo"] = "BENEF"
        effective_record["afiliado"] = lookup_value
        effective_record["beneficio"] = lookup_value
        try:
            self._prepare_clean_form(page)
            self._human_pause(0.8, 1.2)
            nombre = self._load_patient_by_benefit(page, lookup_value)
            if not nombre:
                self._log(f"BENEF {lookup_value}: no se encontro afiliado para completar DNI.")
                return self._build_result_row(effective_record, "", "NO_PAMI", "")
            effective_record["beneficio"] = self._read_benefit_value(page) or lookup_value
            effective_record["dni"] = self._read_document_value(page)
            if not effective_record["dni"]:
                return self._build_result_row(effective_record, nombre, "ERROR_DNI_VACIO", "")
            self._log(
                f"BENEF {lookup_value}: DNI_COMPLETADO dni='{effective_record['dni']}' nombre='{nombre}'."
            )
            return self._build_result_row(effective_record, nombre, "DNI_COMPLETADO", "")
        except Exception as exc:
            self._log(f"Error completando DNI para BENEF {lookup_value}: {exc}")
            return self._build_result_row(effective_record, "", "ERROR_PROCESO", "")

    def _benef_lookup_modal(self, page: Page) -> Locator | None:
        modal = page.locator(".modal.show, .modal.in, .modal[style*='display: block']").last
        try:
            if modal.count() > 0 and modal.is_visible(timeout=500):
                return modal
        except Exception:
            pass
        try:
            page.wait_for_selector("#pe-btn-bsq-afiliado", timeout=3000)
        except Exception:
            self._navigate_to_ome_if_needed()
            page = self._get_ome_page()
        return self._open_patient_search_modal(page)

    def _lookup_benefit_in_modal(
        self,
        page: Page,
        modal: Locator,
        dni: str,
        *,
        expected_name: str = "",
        allow_name_match_on_multiple: bool = False,
    ) -> dict[str, str]:
        dni = (dni or "").strip()
        if not dni:
            return {"status": "__ERROR__DNI_SIN_RESULTADOS"}
        try:
            select = modal.locator("select").first
            select.wait_for(state="visible", timeout=3000)
            select.select_option("n_documento")
            page.wait_for_timeout(200)
        except Exception:
            return {"status": "__ERROR__DNI_MODAL"}

        primary_input = modal.locator("#bsq_avz_afiliado_valor").first
        filled = False
        try:
            primary_input.wait_for(state="visible", timeout=2000)
            filled = self._force_fill_visible_input(page, primary_input, dni)
        except Exception:
            filled = False
        if not filled:
            filled = self._force_fill_exact_dni_input(page, dni)
        if not filled:
            filled = self._force_fill_dni_modal_inputs(page, modal, dni)
        if not filled:
            return {"status": "__ERROR__DNI_CARGA"}

        button = modal.locator("button:has-text('Buscar'), input[value='Buscar']").first
        button.click()
        expected_digits = re.sub(r"\D+", "", dni)
        for _ in range(12):
            page.wait_for_timeout(250)
            result = self._read_benefit_modal_result(
                modal,
                expected_digits,
                expected_name=expected_name,
                allow_name_match_on_multiple=allow_name_match_on_multiple,
            )
            if result.get("status") != "__WAIT__":
                return result
        return {"status": "__ERROR__DNI_SIN_RESULTADOS"}

    def _read_benefit_modal_result(
        self,
        modal: Locator,
        expected_digits: str,
        *,
        expected_name: str = "",
        allow_name_match_on_multiple: bool = False,
    ) -> dict[str, str]:
        rows = modal.locator("table tbody tr")
        count = rows.count()
        if count == 0:
            return {"status": "__WAIT__"}

        active: list[dict[str, str]] = []
        saw_matching_inactive = False
        for idx in range(count):
            row = rows.nth(idx)
            cells = row.locator("td")
            cell_count = cells.count()
            if cell_count < 4:
                continue
            beneficio = (cells.nth(0).inner_text() or "").strip()
            nombre = (cells.nth(2).inner_text() or "").strip()
            documento = (cells.nth(3).inner_text() or "").strip()
            doc_digits = re.sub(r"\D+", "", documento)
            if expected_digits and doc_digits != expected_digits:
                continue
            fecha_baja = (cells.nth(cell_count - 1).inner_text() or "").strip()
            item = {
                "status": "OK",
                "beneficio": beneficio,
                "dni": documento,
                "nombre": nombre,
            }
            if fecha_baja:
                saw_matching_inactive = True
            else:
                active.append(item)

        if not active:
            return {"status": "BAJA"} if saw_matching_inactive else {"status": "__WAIT__"}
        if len(active) == 1:
            return active[0]
        if allow_name_match_on_multiple and expected_name:
            scored = [
                (self._name_match_score(expected_name, item.get("nombre", "")), item)
                for item in active
            ]
            scored.sort(key=lambda item: item[0], reverse=True)
            if scored and scored[0][0] >= 0.5:
                top_score = scored[0][0]
                top_matches = [item for score, item in scored if score == top_score]
                if len(top_matches) == 1:
                    self._log(
                        "DNI multiple resuelto solo para completar BENEF por nombre de hoja: "
                        f"'{expected_name}' -> '{top_matches[0].get('nombre', '')}'."
                    )
                    return top_matches[0]
        return {"status": "__ERROR__DNI_MULTIPLE"}

    def _prepare_clean_form(self, page: Page) -> None:
        page.goto("about:blank", wait_until="domcontentloaded")
        page.goto(PAMI_GENERAR_OME_URL, wait_until="domcontentloaded")
        page.wait_for_selector("#pe-btn-bsq-afiliado")
        self._cleanup_modals(page)
        self._hard_reset_generate_form(page)

    def _read_benefit_value(self, page: Page) -> str:
        try:
            return (page.locator("#pe-n_afiliado").first.input_value() or "").strip()
        except Exception:
            return ""

    def _hard_reset_generate_form(self, page: Page) -> None:
        try:
            page.evaluate(
                """
                () => {
                  const clearValue = (selector) => {
                    const el = document.querySelector(selector);
                    if (!el) return;
                    try {
                      el.value = '';
                      el.setAttribute('value', '');
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                    } catch (e) {}
                  };

                  ['#pe-n_afiliado', '#pe-nomyap_afiliado', '#pe-n_doc', '#pe-nrodoc_afiliado', '#pe-diagnostico_cod', '#pe-practica']
                    .forEach(clearValue);

                  document.querySelectorAll('.modal.show, .modal.in, .modal[style*="display: block"], .modal-backdrop, .swal2-container').forEach((node) => {
                    try { node.remove(); } catch (e) {}
                  });
                  document.body.classList.remove('modal-open');
                  document.body.style.removeProperty('padding-right');

                  document.querySelectorAll('tr .fa-trash, tr .fa-remove, tr .fa-times').forEach((icon) => {
                    const action = icon.closest('button, a, span');
                    try { action?.click(); } catch (e) {}
                  });
                }
                """
            )
            page.wait_for_timeout(350)
        except Exception:
            pass

    def _read_document_value(self, page: Page) -> str:
        selectors = [
            "#pe-n_doc",
            "#pe-nrodoc_afiliado",
            "#pe-n_doc_afiliado",
            "#pe-n_documento",
            "input[id*='doc']",
            "input[name*='doc']",
        ]
        for selector in selectors:
            try:
                locator = page.locator(selector).first
                if locator.count() == 0:
                    continue
                value = (locator.input_value() or "").strip()
                if value:
                    return value
            except Exception:
                continue
        return ""

    def _buscar_nro_ome_existente_generada(self, page: Page, n_afiliado: str, practica: str) -> str:
        n_afiliado = (n_afiliado or "").strip()
        practica = (practica or "").strip()
        if not n_afiliado:
            return ""
        try:
            self._log(f"Buscando OME existente para {n_afiliado} con practica='{practica}'.")
            nro_visible = self._obtener_nro_ome_desde_detalle(page)
            if nro_visible:
                self._log(f"OME existente recuperada desde pantalla actual para {n_afiliado}: {nro_visible}")
                return nro_visible
            page.goto(PAMI_PANEL_ACEPTACION_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(1200)
            omes = self._buscar_ome_existente_con_fallback(page, n_afiliado=n_afiliado, practica=practica)
            nro_ome = self._seleccionar_mejor_ome_existente(omes, practica)
            if nro_ome:
                self._log(f"OME existente recuperada para {n_afiliado}: {nro_ome}")
            else:
                self._log(f"No se encontro Nro OME existente para {n_afiliado}, pero el caso queda como YA_TIENE_OME.")
            return nro_ome
        except Exception as exc:
            self._log(f"No se pudo recuperar OME existente para {n_afiliado}: {exc}")
            return ""

    def _buscar_ome_existente_con_fallback(self, page: Page, n_afiliado: str, practica: str) -> list[dict]:
        attempts = [practica]
        if practica and not self._extract_practice_code(practica):
            attempts.append("")
        last_error = ""
        for current_practice in attempts:
            try:
                self._buscar_ome_existente_en_panel(page, n_afiliado=n_afiliado, practica=current_practice)
                page.wait_for_function("window.bandeja !== undefined", timeout=8000)
                omes = page.evaluate(EXTRAER_OMES_EXISTENTES_SCRIPT, time.strftime("%d/%m/%Y")) or []
                if omes:
                    self._log(
                        f"Panel de aceptacion devolvio {len(omes)} OME(s) para {n_afiliado} "
                        f"con practica='{current_practice}'."
                    )
                    return omes
                self._log(
                    f"Panel de aceptacion sin resultados para {n_afiliado} "
                    f"con practica='{current_practice}'."
                )
            except Exception as exc:
                last_error = str(exc)
                self._log(
                    f"Fallo buscando OME existente para {n_afiliado} "
                    f"con practica='{current_practice}': {exc}"
                )
        if last_error:
            self._log(f"Se agotaron los intentos de busqueda de OME existente para {n_afiliado}: {last_error}")
        return []

    def _buscar_ome_existente_en_panel(self, page: Page, n_afiliado: str, practica: str) -> None:
        result = page.evaluate(
            """
            ({ afiliado, practica }) => {
              try {
                window.bandeja = undefined;
                var fd = document.getElementById('f_emision_desde');
                if (fd && typeof $ !== 'undefined') {
                  $(fd).datepicker('setDate', '01/01/2025');
                }
              } catch (e) {}
              var inp = document.querySelector('input[name="n_afiliado"]');
              var practicaInput =
                document.querySelector('input[name="practica"]') ||
                document.querySelector('input[name="c_practica"]') ||
                document.querySelector('input[id="practica"]') ||
                document.querySelector('input[id="c_practica"]') ||
                document.querySelector('input[placeholder*="Práctica"]') ||
                document.querySelector('input[placeholder*="Practica"]');
              if (!inp) return 'NO_CAMPO';
              inp.value = afiliado || '';
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              if (practicaInput) {
                practicaInput.value = practica || '';
                practicaInput.dispatchEvent(new Event('input', { bubbles: true }));
                practicaInput.dispatchEvent(new Event('change', { bubbles: true }));
              }
              var btn = document.querySelector('input[type="submit"][value="Buscar"]');
              if (!btn) return 'NO_BTN';
              btn.click();
              return 'OK';
            }
            """,
            {"afiliado": n_afiliado, "practica": practica},
        )
        if result != "OK":
            raise RuntimeError(f"No se pudo buscar OME existente en panel: {result}")
        page.wait_for_timeout(2000)

    def _seleccionar_mejor_ome_existente(self, omes: list[dict], practica: str) -> str:
        practica_codigo = self._extract_practice_code(practica)
        candidatos = []
        for ome in omes or []:
            if pratica := (ome.get("practica") or "").strip():
                if practica_codigo:
                    if self._extract_practice_code(pratica) != practica_codigo:
                        continue
                elif practica and practica.upper() not in pratica.upper():
                    continue
            candidatos.append(ome)
        if not candidatos:
            if not practica_codigo:
                # Algunas bandejas de PAMI muestran solo la descripcion de la practica.
                # Este fallback es seguro solo cuando la practica pedida no era un codigo concreto.
                candidatos = [ome for ome in (omes or []) if str(ome.get("n_orden", "") or "").strip()]
        if not candidatos:
            return ""

        def prioridad(ome: dict) -> tuple[int, int, int, str]:
            estado = str(ome.get("estado_accion", "") or "").strip().lower()
            turno_asignado = bool(ome.get("turno_asignado"))
            transmitida = bool(ome.get("ya_transmitida")) or bool(ome.get("transmitida"))
            mismo_efector = bool(ome.get("mismo_efector"))
            if estado == "disponible_activar" and not transmitida:
                base = 0
            elif turno_asignado and not transmitida:
                base = 1
            elif not transmitida:
                base = 2
            else:
                base = 3
            return (base, 0 if mismo_efector else 1, 0 if turno_asignado else 1, str(ome.get("n_orden", "")))

        candidatos.sort(key=prioridad)
        return str((candidatos[0] if candidatos else {}).get("n_orden", "") or "").strip()

    def _extract_practice_code(self, practice: str) -> str:
        digits = "".join(ch for ch in str(practice or "") if ch.isdigit())
        return digits[:6] if len(digits) >= 6 else ""

    def _normalize_modal_text(self, value: str) -> str:
        normalized = unicodedata.normalize("NFD", str(value or ""))
        normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
        return " ".join(normalized.lower().split())

    def _name_match_score(self, expected_name: str, candidate_name: str) -> float:
        expected = self._normalize_modal_text(expected_name)
        candidate = self._normalize_modal_text(candidate_name)
        if not expected or not candidate:
            return 0.0
        expected_parts = [part for part in expected.split() if len(part) > 1]
        candidate_parts = set(part for part in candidate.split() if len(part) > 1)
        if not expected_parts or not candidate_parts:
            return 0.0
        hits = sum(1 for part in expected_parts if part in candidate_parts)
        return hits / len(expected_parts)

    def _contains_existing_ome_message(self, text: str) -> bool:
        normalized = self._normalize_modal_text(text)
        return "ya cuenta con una orden medica electronica" in normalized

    def _contains_limit_message(self, text: str) -> bool:
        normalized = self._normalize_modal_text(text)
        return "alcanzo la cantidad mensual" in normalized or (
            "cantidad mensual" in normalized and "prestaciones realizadas" in normalized
        )

    def _contains_annual_limit_message(self, text: str) -> bool:
        normalized = self._normalize_modal_text(text)
        return "alcanzo la cantidad anual" in normalized or (
            "cantidad anual" in normalized and "prestaciones realizadas" in normalized
        )

    def _contains_success_message(self, text: str) -> bool:
        normalized = self._normalize_modal_text(text)
        return "se ha generado una orden" in normalized

    def _should_retry_with_capita(self, body_text: str, practica: str) -> bool:
        practice_code = self._extract_practice_code(practica)
        normalized = self._normalize_modal_text(body_text)
        return (
            practice_code == "427122"
            and f"no se puede prescribir la practica {practice_code}" in normalized
            and "forma parte de su capita" in normalized
        )

    def _read_patient_name(self, page: Page) -> str:
        selectors = [
            "#pe-nomyap_afiliado",
            "#pe-nombre-afiliado",
            "#pe-afiliado-nombre",
            "#pe_nombre_afiliado",
        ]
        for selector in selectors:
            locator = page.locator(selector).first
            if locator.count() == 0:
                continue
            try:
                tag_name = locator.evaluate("el => el.tagName.toLowerCase()")
                if tag_name == "input":
                    return (locator.input_value() or "").strip()
                return (locator.inner_text() or "").strip()
            except Exception:
                continue
        return ""

    def _read_visible_feedback_text(self, page: Page) -> str:
        try:
            alert = page.locator(".alert.rin-alert.alert-danger").last
            if alert.count() > 0 and alert.is_visible():
                return (alert.inner_text() or "").strip()
            text = page.evaluate(
                """
                () => {
                  const normalizedVisible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 40 && rect.height > 20;
                  };
                  const selectors = [
                    '.modal.show',
                    '.modal.in',
                    '.modal[style*="display: block"]',
                    '.sweet-alert',
                    '.swal2-popup',
                    '.swal2-container',
                    '.alert',
                    '[role="dialog"]'
                  ];
                  const candidates = Array.from(document.querySelectorAll(selectors.join(',')))
                    .filter(normalizedVisible)
                    .map((node) => String(node.innerText || node.textContent || '').trim())
                    .filter(Boolean)
                    .sort((a, b) => b.length - a.length);
                  for (const text of candidates) {
                    if (text) return text;
                  }
                  return '';
                }
                """
            )
            return (text or "").strip()
        except Exception:
            pass
        return ""

    def _force_fill_visible_input(self, page: Page, locator: Locator, value: str) -> bool:
        desired = (value or "").strip()
        try:
            locator.click()
            page.wait_for_timeout(80)
        except Exception:
            pass
        try:
            locator.fill("")
        except Exception:
            pass
        page.wait_for_timeout(120)
        try:
            locator.type(desired, delay=75)
        except Exception:
            pass
        page.wait_for_timeout(120)
        try:
            current_value = (locator.input_value() or "").strip()
        except Exception:
            current_value = ""
        if current_value == desired:
            return True
        try:
            handle = locator.element_handle()
            if handle is not None:
                page.evaluate(
                    """
                    ([el, val]) => {
                      if (!el) return;
                      el.focus();
                      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
                      if (setter) {
                        setter.call(el, val);
                      } else {
                        el.value = val;
                      }
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '0' }));
                      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    """,
                    [handle, desired],
                )
                page.wait_for_timeout(180)
        except Exception:
            pass
        try:
            current_value = (locator.input_value() or "").strip()
        except Exception:
            current_value = ""
        return current_value == desired

    def _force_fill_exact_dni_input(self, page: Page, value: str) -> bool:
        desired = (value or "").strip()
        try:
            result = page.evaluate(
                """
                (dni) => {
                  const el = document.getElementById('bsq_avz_afiliado_valor');
                  if (!el || el.disabled || el.readOnly) {
                    return { ok: false, value: el ? (el.value || '') : '' };
                  }
                  el.focus();
                  el.click();
                  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
                  if (setter) {
                    setter.call(el, '');
                    setter.call(el, dni);
                  } else {
                    el.value = '';
                    el.value = dni;
                  }
                  el.setAttribute('value', dni);
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '0' }));
                  el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: '0' }));
                  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  el.dispatchEvent(new Event('blur', { bubbles: true }));
                  return { ok: String((el.value || '').trim()) === String(dni).trim(), value: el.value || '' };
                }
                """,
                desired,
            )
            page.wait_for_timeout(220)
            return bool(result and result.get("ok"))
        except Exception:
            return False

    def _read_dni_modal_value(self, page: Page) -> str:
        try:
            return (
                page.evaluate(
                    """
                    () => {
                      const el = document.getElementById('bsq_avz_afiliado_valor');
                      return el ? (el.value || '') : '';
                    }
                    """
                )
                or ""
            ).strip()
        except Exception:
            return ""

    def _force_fill_dni_modal_inputs(self, page: Page, modal: Locator, value: str) -> bool:
        desired = (value or "").strip()
        try:
            handle = modal.element_handle()
            if handle is None:
                return False
            result = page.evaluate(
                """
                ([modalEl, dni]) => {
                  if (!modalEl) return { ok: false, values: [] };
                  const visibleInputs = Array.from(
                    modalEl.querySelectorAll("input[type='text'], input[type='type'], input:not([type]), input#bsq_avz_afiliado_valor")
                  ).filter((el) => {
                    if (!el || el.disabled || el.readOnly) return false;
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 40 && rect.height > 10;
                  });
                  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
                  const values = [];
                  for (const el of visibleInputs) {
                    el.focus();
                    el.click();
                    if (setter) {
                      setter.call(el, dni);
                    } else {
                      el.value = dni;
                    }
                    el.setAttribute('value', dni);
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '0' }));
                    el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: '0' }));
                    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('blur', { bubbles: true }));
                    values.push((el.value || '').trim());
                  }
                  return { ok: values.includes(String(dni).trim()), values };
                }
                """,
                [handle, desired],
            )
            page.wait_for_timeout(220)
            return bool(result and result.get("ok"))
        except Exception:
            return False

    def _fill_code_with_events(self, page: Page, selector: str, value: str) -> None:
        locator = page.locator(selector).first
        locator.wait_for(state="visible", timeout=5000)
        locator.click()
        locator.fill("")
        locator.type(value, delay=70)
        page.evaluate(
            """
            ({ selector }) => {
              const el = document.querySelector(selector);
              if (!el) return;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
            }
            """,
            {"selector": selector},
        )

    def _force_fill_text_input(self, page: Page, selector: str, value: str) -> bool:
        desired = (value or "").strip()
        try:
            result = page.evaluate(
                """
                ({ selector, value }) => {
                  const el = document.querySelector(selector);
                  if (!el) return { ok: false, value: '' };
                  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
                  el.focus();
                  el.click();
                  if (setter) {
                    setter.call(el, '');
                    setter.call(el, value);
                  } else {
                    el.value = '';
                    el.value = value;
                  }
                  el.setAttribute('value', value);
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value.slice(-1) || '0' }));
                  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) || '0' }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  return { ok: String(el.value || '').trim() === String(value || '').trim(), value: String(el.value || '').trim() };
                }
                """,
                {"selector": selector, "value": desired},
            )
            page.wait_for_timeout(250)
            return bool(result and result.get("ok"))
        except Exception:
            return False

    def _set_practice_code(self, page: Page, code: str) -> None:
        try:
            page.locator(
                "button:has-text('Prácticas'), button:has-text('Practicas'), a:has-text('Prácticas'), a:has-text('Practicas')"
            ).first.click()
            page.wait_for_timeout(150)
        except Exception:
            pass
        locator = page.locator("#pe-practica").first
        locator.wait_for(state="visible", timeout=5000)
        try:
            locator.click()
            page.wait_for_timeout(80)
            locator.fill("")
            page.wait_for_timeout(80)
            locator.type(code, delay=70)
        except Exception:
            pass
        current_value = self._read_input_value(page, "#pe-practica")
        if current_value != code and not self._force_fill_text_input(page, "#pe-practica", code):
            raise RuntimeError(f"No se pudo cargar el codigo de practica {code} en el input.")
        current_value = self._read_input_value(page, "#pe-practica")
        if current_value != code:
            raise RuntimeError(
                f"No se pudo verificar el codigo de practica {code} en el input. Valor actual='{current_value}'."
            )
        page.wait_for_timeout(1200)
        try:
            self._click_first_dropdown(page, code, starts_with=True)
        except Exception:
            self._click_first_dropdown(page, code, starts_with=False)

    def _click_first_dropdown(self, page: Page, code: str, *, starts_with: bool) -> None:
        items = page.locator("a.dropdown-item")
        count = items.count()
        for idx in range(count):
            item = items.nth(idx)
            try:
                text = (item.inner_text() or "").strip().upper()
            except Exception:
                continue
            if not text:
                continue
            if (starts_with and text.startswith(code)) or (not starts_with and code in text):
                item.click()
                return
        raise RuntimeError(f"No pude seleccionar el item del dropdown para {code}.")

    def _read_input_value(self, page: Page, selector: str) -> str:
        try:
            value = page.locator(selector).first.input_value(timeout=1000)
            return (value or "").strip()
        except Exception:
            try:
                value = page.evaluate(
                    """
                    (sel) => {
                      const el = document.querySelector(sel);
                      return el ? String(el.value || '').trim() : '';
                    }
                    """,
                    selector,
                )
                return (value or "").strip()
            except Exception:
                return ""

    def _count_prescribed_practice_rows(self, page: Page) -> int:
        try:
            count = page.evaluate(
                """
                () => {
                  const normalized = (value) => String(value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
                  const tables = Array.from(document.querySelectorAll('table'));
                  const targetTable = tables.find((table) => {
                    const text = normalized(table.textContent || '');
                    return text.includes('cód. práctica') && text.includes('acciones');
                  });
                  if (!targetTable) return 0;
                  const rows = Array.from(targetTable.querySelectorAll('tbody tr, tr')).filter((row) => {
                    const cells = row.querySelectorAll('td');
                    if (!cells.length) return false;
                    const text = normalized(row.textContent || '');
                    return text && !text.includes('cód. práctica');
                  });
                  return rows.length;
                }
                """
            )
            return int(count or 0)
        except Exception:
            return -1

    def _clear_prescribed_practices(self, page: Page) -> None:
        try:
            page.evaluate(
                """
                () => {
                  const normalized = (value) => String(value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
                  const tables = Array.from(document.querySelectorAll('table'));
                  const targetTable = tables.find((table) => {
                    const text = normalized(table.textContent || '');
                    return text.includes('cód. práctica') && text.includes('acciones');
                  });
                  const practiceRows = targetTable
                    ? Array.from(targetTable.querySelectorAll('tbody tr, tr')).filter((row) => {
                        const cells = row.querySelectorAll('td');
                        if (!cells.length) return false;
                        const text = normalized(row.textContent || '');
                        return text && !text.includes('cód. práctica');
                      })
                    : [];
                  for (const row of practiceRows) {
                    const actionCell = row.querySelector('td:last-child');
                    const candidates = actionCell
                      ? Array.from(actionCell.querySelectorAll('button, a, span, i'))
                      : [];
                    const deleteCandidate =
                      candidates.find((el) => /trash|remove|times|eliminar|borrar|anular/i.test(String(el.className || '') + ' ' + String(el.getAttribute?.('title') || ''))) ||
                      candidates[candidates.length - 1];
                    const button = deleteCandidate?.closest?.('button, a, span') || deleteCandidate;
                    try { button?.click(); } catch (e) {}
                  }
                  const practicaInput = document.querySelector('#pe-practica');
                  if (practicaInput) {
                    practicaInput.value = '';
                    practicaInput.dispatchEvent(new Event('input', { bubbles: true }));
                    practicaInput.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }
                """
            )
            page.wait_for_timeout(800)
        except Exception:
            pass

    def _summarize_text(self, text: str, limit: int = 180) -> str:
        normalized = " ".join(str(text or "").split())
        if len(normalized) <= limit:
            return normalized
        return normalized[: limit - 3] + "..."

    def _wait_for_patient_name(self, page: Page, timeout_ms: int = 5000, previous_value: str = "") -> str:
        deadline = time.time() + (timeout_ms / 1000)
        previous_normalized = (previous_value or "").strip()
        while time.time() < deadline:
            current_value = self._read_patient_name(page)
            if current_value and current_value != previous_normalized:
                return current_value
            page.wait_for_timeout(250)
        return ""

    def _cleanup_modals(self, page: Page) -> None:
        page.evaluate(
            """
            () => {
              document.querySelectorAll('.modal.show, .modal.in, .modal[style*="display: block"]').forEach((m) => {
                m.style.display = 'none';
                m.classList.remove('show');
                m.setAttribute('aria-hidden', 'true');
              });
              document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
              document.body.classList.remove('modal-open');
              document.body.style.removeProperty('padding-right');
            }
            """
        )

    def _click_confirm_in_modal(self, page: Page) -> None:
        modal = page.locator("#modal-generar-orden").first
        modal.locator("button:has-text('Confirmar')").first.click()

    def _close_feedback_modal(self, page: Page) -> None:
        try:
            modal = page.locator(".modal.show, .modal.in, .modal[style*='display: block']").last
            if modal.count() == 0:
                return
            close_button = modal.locator("button:has-text('Cerrar'), .close, button[data-dismiss='modal'], [aria-label='Close']").first
            if close_button.count() > 0:
                close_button.click()
                page.wait_for_timeout(400)
        except Exception:
            pass
        self._cleanup_modals(page)

    def _close_capita_alert(self, page: Page) -> None:
        try:
            alert = page.locator(".alert.rin-alert.alert-danger").last
            if alert.count() > 0 and alert.is_visible():
                for selector in (".close", "[data-dismiss='modal']", "[aria-label='Close']", "button", "a", "span", "i"):
                    try:
                        button = alert.locator(selector).first
                        if button.count() > 0 and button.is_visible():
                            button.click()
                            page.wait_for_timeout(250)
                            break
                    except Exception:
                        continue
            modal = page.locator(".modal.show, .modal.in, .modal[style*='display: block']").filter(
                has_text="No se puede prescribir la práctica"
            ).filter(has_text="forma parte de su capita").last
            if modal.count() > 0:
                for selector in (".close", "[data-dismiss='modal']", "[aria-label='Close']", "button", "a", "span", "i"):
                    try:
                        button = modal.locator(selector).first
                        if button.count() > 0 and button.is_visible():
                            button.click()
                            page.wait_for_timeout(250)
                            break
                    except Exception:
                        continue
            page.evaluate(
                """
                () => {
                  const normalized = (value) =>
                    String(value || '')
                      .normalize('NFD')
                      .replace(/[\\u0300-\\u036f]/g, '')
                      .toLowerCase()
                      .replace(/\\s+/g, ' ')
                      .trim();
                  const matchesText = (el) => {
                    const text = normalized(el?.innerText || el?.textContent || '');
                    return text.includes('no se puede prescribir la practica') && text.includes('forma parte de su capita');
                  };
                  const candidates = Array.from(document.querySelectorAll('.modal, .alert, .ui-pnotify, .sweet-alert, .swal2-container, .swal2-popup, div'));
                  for (const node of candidates) {
                    if (!matchesText(node)) continue;
                    const closer = node.querySelector(
                      "button, .close, [data-dismiss='modal'], [aria-label='Close'], .ui-pnotify-closer, .swal2-close, a"
                    );
                    if (closer) {
                      closer.click();
                    }
                    node.remove();
                  }
                  document.querySelectorAll('.modal-backdrop, .swal2-container').forEach((node) => node.remove());
                  document.body.classList.remove('modal-open');
                  document.body.style.removeProperty('padding-right');
                }
                """
            )
            page.wait_for_timeout(300)
        except Exception:
            pass
        self._cleanup_modals(page)

    def _wait_for_generation_outcome(self, page: Page, practica: str = "427122", timeout_ms: int = 5000) -> str:
        deadline = time.time() + (timeout_ms / 1000)
        while time.time() < deadline:
            try:
                alert = page.locator(".alert.rin-alert.alert-danger").last
                if alert.count() > 0 and alert.is_visible():
                    text = (alert.inner_text() or "").strip()
                    if text and self._should_retry_with_capita(text, practica):
                        return "capita"
                feedback_text = self._read_visible_feedback_text(page)
                if feedback_text and self._should_retry_with_capita(feedback_text, practica):
                    return "capita"
            except Exception:
                pass

            try:
                confirm_button = page.locator(
                    "#modal-generar-orden button:has-text('Confirmar'), .modal.show button:has-text('Confirmar')"
                ).first
                if confirm_button.count() > 0 and confirm_button.is_visible():
                    return "confirm"
            except Exception:
                pass

            try:
                detail_button = page.locator(
                    "button:has-text('Detalle'), a:has-text('Detalle'), button[data-n_orden]"
                ).first
                if detail_button.count() > 0 and detail_button.is_visible():
                    return "detail"
            except Exception:
                pass

            try:
                body_text = (page.locator("body").inner_text() or "").lower()
                if (
                    "ya cuenta con una orden" in body_text
                    or "se ha generado una orden" in body_text
                    or ("alcanz" in body_text and "cantidad mensual" in body_text)
                    or ("alcanz" in body_text and "cantidad anual" in body_text)
                ):
                    return "body"
            except Exception:
                pass

            page.wait_for_timeout(250)

        raise RuntimeError("No se pudo confirmar el resultado luego de pulsar Generar.")

    def _obtener_nro_ome_desde_detalle(self, page: Page) -> str:
        fallback = ""
        try:
            fallback = (page.locator("button[data-n_orden]").first.get_attribute("data-n_orden") or "").strip()
        except Exception:
            fallback = ""

        try:
            detail_button = page.locator(
                "button:has-text('Detalle'), a:has-text('Detalle'), button[data-n_orden]"
            ).first
            if detail_button.count() == 0:
                return (fallback or self._extract_order_number_from_visible_content(page)).strip()

            detail_button.click()
            page.wait_for_timeout(1200)

            page.wait_for_timeout(400)
            nro_ome = self._extract_order_number_from_visible_content(page)

            try:
                modal = page.locator(".modal.show, .modal.in, .modal[style*='display: block']").last
                close_button = modal.locator("button:has-text('Cerrar'), .close, button[data-dismiss='modal']").first
                if close_button.count() > 0:
                    close_button.click()
                    page.wait_for_timeout(300)
            except Exception:
                pass

            return (nro_ome or fallback).strip()
        except Exception:
            return (fallback or self._extract_order_number_from_visible_content(page)).strip()

    def _extract_order_number_from_visible_content(self, page: Page) -> str:
        try:
            return (
                page.evaluate(
                    """
                    () => {
                      const clean = (value) => String(value || '').trim();
                      const visible = (el) => {
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 10 && rect.height > 10;
                      };
                      const pickNumber = (text) => {
                        const match = clean(text).match(/\\b\\d{8,}\\b/);
                        return match ? match[0] : '';
                      };

                      for (const node of document.querySelectorAll('[data-n_orden], [data-orden]')) {
                        const value = clean(node.getAttribute('data-n_orden') || node.getAttribute('data-orden'));
                        if (/^\\d{8,}$/.test(value)) return value;
                      }

                      const scopes = Array.from(
                        document.querySelectorAll('.modal.show, .modal.in, .modal[style*="display: block"], .alert, [role="dialog"], .swal2-popup, .sweet-alert')
                      ).filter(visible);

                      for (const scope of scopes) {
                        for (const node of scope.querySelectorAll('input, textarea, [title], [data-original-title], [data-n_orden], [data-orden], button, a, span, div, td, strong, b')) {
                          const value =
                            clean(node.value) ||
                            clean(node.getAttribute('data-n_orden')) ||
                            clean(node.getAttribute('data-orden')) ||
                            clean(node.getAttribute('title')) ||
                            clean(node.getAttribute('data-original-title')) ||
                            clean(node.textContent);
                          const picked = pickNumber(value);
                          if (picked) return picked;
                        }
                        const picked = pickNumber(scope.textContent);
                        if (picked) return picked;
                      }

                      return pickNumber(document.body ? document.body.innerText : '');
                    }
                    """
                )
                or ""
            ).strip()
        except Exception:
            return ""

    def _human_pause(self, min_seconds: float = 0.4, max_seconds: float = 1.0) -> None:
        time.sleep(random.uniform(min_seconds, max_seconds))

    def _page_looks_like_login(self, page: Page) -> bool:
        try:
            return bool(
                page.locator("input[type='password']").count() > 0
                and (
                    page.locator("input[name='usuario']").count() > 0
                    or page.locator("input[name='username']").count() > 0
                    or page.locator("input[id='usuario']").count() > 0
                    or page.locator("input[type='text']").count() > 0
                )
            )
        except Exception:
            return False

    def _page_looks_like_ome(self, page: Page) -> bool:
        try:
            url = page.url or ""
            if "generar_orden.php" in url:
                return True
            return bool(
                page.locator("#pe-n_afiliado").count() > 0
                or page.locator("#pe-btn-generar-orden").count() > 0
                or page.locator("#pe-practica").count() > 0
            )
        except Exception:
            return False

    def _safe_page_title(self, page: Page) -> str:
        try:
            return page.title()
        except Exception:
            return ""

    def _on_context_page(self, page: Page) -> None:
        try:
            page.set_default_timeout(20000)
            page.on("console", self._on_console)
            page.on("pageerror", self._on_page_error)
            page.wait_for_timeout(300)
            url = (page.url or "").strip()
        except Exception:
            url = ""

        self._log(f"Nueva pestaña detectada en OME: {url or 'about:blank'}")

        with self._lock:
            if self._sesion is None:
                return

            actual = self._sesion.page
            actual_url = ""
            try:
                actual_url = (actual.url or "").strip()
            except Exception:
                pass

            if url and url != "about:blank":
                self._sesion.page = page
                self._log(f"Pestaña activa de OME actualizada a: {url}")
                return

            if not actual_url or actual_url == "about:blank":
                self._sesion.page = page
                self._log("La sesion OME quedo asociada temporalmente a una nueva pestaña en blanco.")

    def _fill_first_visible(self, page: Page, estrategias: list[tuple[str, str]], valor: str) -> bool:
        if not valor:
            return False

        for tipo, selector in estrategias:
            try:
                if tipo == "label":
                    locator = page.get_by_label(selector).first
                else:
                    locator = page.locator(selector).first
                if locator.count() == 0:
                    continue
                locator.wait_for(state="visible", timeout=800)
                locator.fill(valor)
                self._log(f"Campo completado con {tipo}: {selector}")
                return True
            except Exception:
                continue
        return False

    def _try_autofill_credenciales(self, page: Page, usuario: str, clave: str, timeout_ms: int = 12000) -> bool:
        usuario = (usuario or "").strip()
        clave = clave or ""
        if not usuario and not clave:
            return False

        estrategias_usuario = [
            ("selector", "input[name='usuario']"),
            ("selector", "input[name='username']"),
            ("selector", "input[name='user']"),
            ("selector", "input[name='login']"),
            ("selector", "input[id='usuario']"),
            ("selector", "input[id='username']"),
            ("selector", "input[id='user']"),
            ("label", "Usuario"),
            ("selector", "form input[type='text']"),
            ("selector", "form input:not([type='password'])"),
            ("selector", "input[type='text']"),
            ("selector", "input[type='email']"),
        ]

        estrategias_clave = [
            ("selector", "input[type='password']"),
            ("selector", "input[name='clave']"),
            ("selector", "input[name='password']"),
            ("selector", "input[name='pass']"),
            ("selector", "input[id='clave']"),
            ("selector", "input[id='password']"),
            ("selector", "input[id='pass']"),
            ("label", "Contrasena"),
            ("label", "Clave"),
        ]

        end_time = time.time() + (timeout_ms / 1000)

        while time.time() < end_time:
            user_ok = self._fill_first_visible(page, estrategias_usuario, usuario) if usuario else False
            pass_ok = self._fill_first_visible(page, estrategias_clave, clave) if clave else False

            if (not usuario or user_ok) and (not clave or pass_ok):
                partes = []
                if usuario:
                    partes.append(f"usuario {usuario}")
                if clave:
                    partes.append("clave cargada")
                self._status(f"Login autocompletado: {', '.join(partes)}")
                self._log("Credenciales aplicadas en login.")
                return True

            try:
                filled = page.evaluate(
                    """
                    ({ usuario, clave }) => {
                      const visibles = Array.from(document.querySelectorAll('input'))
                        .filter((el) => {
                          const style = window.getComputedStyle(el);
                          const rect = el.getBoundingClientRect();
                          return style.display !== 'none'
                            && style.visibility !== 'hidden'
                            && rect.width > 0
                            && rect.height > 0
                            && !el.disabled;
                        });

                      const visiblesUsuario = visibles.filter((el) =>
                        el.type === 'text' || el.type === 'email' || el.type === ''
                      );

                      const usuarioTarget = visiblesUsuario[0] || null;
                      const claveTarget = visibles.find((el) => el.type === 'password') || null;
                      let aplicado = false;

                      if (usuario && usuarioTarget) {
                        usuarioTarget.focus();
                        usuarioTarget.value = usuario;
                        usuarioTarget.dispatchEvent(new Event('input', { bubbles: true }));
                        usuarioTarget.dispatchEvent(new Event('change', { bubbles: true }));
                        aplicado = true;
                      }

                      if (clave && claveTarget) {
                        claveTarget.focus();
                        claveTarget.value = clave;
                        claveTarget.dispatchEvent(new Event('input', { bubbles: true }));
                        claveTarget.dispatchEvent(new Event('change', { bubbles: true }));
                        aplicado = true;
                      }

                      return aplicado;
                    }
                    """,
                    {"usuario": usuario, "clave": clave},
                )
                if filled:
                    partes = []
                    if usuario:
                        partes.append(f"usuario {usuario}")
                    if clave:
                        partes.append("clave cargada")
                    self._status(f"Login autocompletado: {', '.join(partes)}")
                    self._log("Credenciales aplicadas en login con evaluacion DOM directa.")
                    return True
            except Exception:
                pass

            try:
                page.wait_for_timeout(500)
            except Exception:
                break

        self._log(f"No se pudieron autocompletar las credenciales en {page.url}")
        return False

    def _on_console(self, msg) -> None:
        try:
            texto = msg.text
        except Exception:
            texto = str(msg)
        self._log(texto)

    def _on_page_error(self, err) -> None:
        try:
            texto = str(err)
        except Exception:
            texto = "pageerror sin detalle"
        self._log(f"[PAGEERROR] {texto}")

    def _log(self, message: str) -> None:
        log_message(message)
        self.log_callback(message)

    def _status(self, message: str) -> None:
        log_message(f"[OME] {message}")
        self.status_callback(message)

    def _cleanup_dead_session(self) -> None:
        if self._sesion is None:
            return

        try:
            if self._sesion.page.is_closed():
                self._dispose_session(
                    "El navegador fue cerrado. Ya puedes volver a abrir CUP.",
                    "Sesion limpiada porque la pagina fue cerrada manualmente.",
                )
                return
        except Exception:
            self._dispose_session(
                "La sesion del navegador dejo de estar disponible. Ya puedes volver a abrir CUP.",
                "Sesion limpiada porque Playwright no pudo acceder a la pagina actual.",
            )
            return

        try:
            _ = list(self._sesion.context.pages)
        except Exception:
            self._dispose_session(
                "El contexto del navegador ya no esta disponible. Ya puedes volver a abrir CUP.",
                "Sesion limpiada porque el contexto del navegador estaba cerrado.",
            )

    def _dispose_session(self, status_message: str, log_message_text: str) -> None:
        sesion = self._sesion
        if sesion is None:
            return

        self._sesion = None

        try:
            sesion.context.close()
        except Exception:
            pass

        try:
            sesion.browser.close()
        except Exception:
            pass

        try:
            sesion.playwright.stop()
        except Exception:
            pass

        self._status(status_message)
        self._log(log_message_text)
