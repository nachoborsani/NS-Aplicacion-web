from __future__ import annotations

import calendar
import urllib.parse
from dataclasses import dataclass
from datetime import date

from playwright.sync_api import Browser, BrowserContext, Page, Playwright, sync_playwright

from ns_web import DEFAULT_BASE_URL, NSWebClient, load_config
from pami_liberar_cupo import CUP_LOGIN_URL, PAMI_TRANSMISION_URL
from pami_scraper import configurar_playwright


DEFAULT_CLIENT_SLUG = "scheffelaar-mc"


@dataclass(frozen=True)
class InformeCabeceraClient:
    slug: str
    name: str


def current_period() -> str:
    today = date.today()
    return f"{today.year:04d}-{today.month:02d}"


def recent_periods(count: int = 8) -> list[str]:
    today = date.today()
    year = today.year
    month = today.month
    periods: list[str] = []
    for _ in range(max(1, count)):
        periods.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    return periods


def period_label(period: str) -> str:
    months = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
    ]
    try:
        year, month = [int(part) for part in str(period).split("-", 1)]
        if 1 <= month <= 12:
            return f"{months[month - 1]} {year}"
    except Exception:
        pass
    return str(period or "").strip()


def normalize_period(value: str) -> str:
    text = str(value or "").strip()
    if len(text) >= 7 and text[4] == "-":
        year = text[:4]
        month = text[5:7]
        if year.isdigit() and month.isdigit() and 1 <= int(month) <= 12:
            return f"{int(year):04d}-{int(month):02d}"
    raise ValueError("Elegí un mes válido.")


def period_bounds(period: str) -> tuple[str, str]:
    period = normalize_period(period)
    year, month = [int(part) for part in period.split("-")]
    last = calendar.monthrange(year, month)[1]
    return f"01/{month:02d}/{year:04d}", f"{last:02d}/{month:02d}/{year:04d}"


def _client() -> NSWebClient:
    cfg = load_config()
    client = NSWebClient(cfg.get("base_url") or DEFAULT_BASE_URL)
    client.login(cfg.get("username", ""), cfg.get("password", ""))
    return client


def load_pami_credentials(slug: str) -> dict:
    return _client().client_pami(slug)


def load_clients() -> list[InformeCabeceraClient]:
    client = _client()
    raw = client.list_clients()
    items: list[InformeCabeceraClient] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        is_medcab = item.get("tipo") == "med_cabecera" or bool(item.get("bandejaCup"))
        if not is_medcab:
            continue
        slug = str(item.get("slug") or "").strip()
        name = str(item.get("name") or item.get("businessName") or slug).strip()
        if slug and name:
            items.append(InformeCabeceraClient(slug=slug, name=name))
    return sorted(items, key=lambda x: (x.slug != DEFAULT_CLIENT_SLUG, x.name.lower()))


def fetch_missing_reports(slug: str, period: str) -> dict:
    slug = str(slug or "").strip()
    if not slug:
        raise ValueError("Elegí un cliente.")
    period = normalize_period(period)
    client = _client()
    path = f"/api/clientes/{urllib.parse.quote(slug)}/pendientes-detalle"
    data = client._request("GET", path, params={"tipo": "cup-informe", "month": period})
    rows = data.get("filas") or []
    if not isinstance(rows, list):
        rows = []
    return {
        "slug": slug,
        "period": period,
        "label": period_label(period),
        "total": int(data.get("total") or len(rows)),
        "rows": rows,
        "desde": period_bounds(period)[0],
        "hasta": period_bounds(period)[1],
        "clientName": data.get("nombre") or slug,
    }


@dataclass
class SesionInformesCabecera:
    playwright: Playwright
    browser: Browser
    context: BrowserContext
    page: Page


class PamiInformesCabeceraController:
    def __init__(self, log_callback=None, status_callback=None, headless: bool = False) -> None:
        self.log_callback = log_callback or (lambda _message: None)
        self.status_callback = status_callback or (lambda _message: None)
        self._sesion: SesionInformesCabecera | None = None
        self._accepting_save_dialog = False
        self.headless = bool(headless)

    def abrir_y_preparar_informe(self, *, usuario: str, clave: str, item: dict, plantilla: dict) -> dict:
        orden = _digits(item.get("ome") or item.get("n_orden"))
        if not orden:
            raise RuntimeError("La fila no tiene número de OME.")
        if not usuario or not clave:
            raise RuntimeError("El cliente no tiene usuario y clave PAMI cargados.")

        page = self._ensure_session(usuario, clave)
        self._status(f"Buscando OME {orden} en Panel de prestaciones...")
        self._buscar_orden(page, orden)
        self._click_informe(page, orden)
        self._completar_formulario(page, plantilla)
        self._status("Guardando informe en PAMI...")
        self._guardar_formulario(page)
        self._status("Informe guardado en PAMI.")
        return {"ome": orden, "paciente": item.get("nombre", ""), "estado": "guardado"}

    def cerrar(self) -> None:
        sesion = self._sesion
        self._sesion = None
        if not sesion:
            return
        for fn in (sesion.context.close, sesion.browser.close, sesion.playwright.stop):
            try:
                fn()
            except Exception:
                pass
        self._status("Navegador cerrado.")

    def _ensure_session(self, usuario: str, clave: str) -> Page:
        if self._sesion:
            try:
                if self._sesion.browser.is_connected() and not self._sesion.page.is_closed():
                    return self._sesion.page
            except Exception:
                self.cerrar()

        configurar_playwright()
        playwright = sync_playwright().start()
        browser = playwright.chromium.launch(headless=self.headless, args=["--window-size=1440,920"])
        context = browser.new_context(ignore_https_errors=True, viewport={"width": 1440, "height": 920})
        page = context.new_page()
        page.set_default_timeout(25000)
        page.on("console", lambda msg: self._log(f"[PAMI] {msg.text}") if str(getattr(msg, "text", "") or "").strip() else None)
        page.on("dialog", self._handle_dialog)
        self._sesion = SesionInformesCabecera(playwright=playwright, browser=browser, context=context, page=page)
        self._login(page, usuario, clave)
        return page

    def _login(self, page: Page, usuario: str, clave: str) -> None:
        self._status("Iniciando sesión en CUP PAMI...")
        page.goto(CUP_LOGIN_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(800)
        user_input = page.locator('input[name="usuario"], input[type="text"], #usuario').first
        pass_input = page.locator('input[name="password"], input[type="password"], #password').first
        user_input.wait_for(state="visible")
        user_input.fill("")
        user_input.type(usuario, delay=95)
        page.wait_for_timeout(250)
        pass_input.wait_for(state="visible")
        pass_input.fill("")
        pass_input.type(clave, delay=95)
        page.wait_for_timeout(250)
        page.locator('button[type="submit"], input[type="submit"], button:has-text("Ingresar"), button:has-text("Entrar")').first.click()
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(1500)
        if "cup.pami.org.ar" in (page.url or ""):
            raise RuntimeError("No se pudo iniciar sesión en CUP PAMI. Revisá usuario y clave.")
        self._log("Sesión iniciada en CUP PAMI.")

    def _buscar_orden(self, page: Page, orden: str) -> None:
        page.goto(PAMI_TRANSMISION_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(900)
        if "cup.pami.org.ar" in (page.url or ""):
            raise RuntimeError("PAMI pidió login nuevamente.")
        result = page.evaluate(_BUSCAR_ORDEN_SCRIPT, orden)
        if result != "OK":
            raise RuntimeError(f"No pude buscar la OME en Panel de prestaciones: {result}")
        page.wait_for_timeout(1500)
        for _ in range(8):
            if page.evaluate(_ORDEN_VISIBLE_SCRIPT, orden):
                return
            page.wait_for_timeout(500)
        raise RuntimeError(f"No apareció la OME {orden} en el panel.")

    def _click_informe(self, page: Page, orden: str) -> None:
        result = page.evaluate(_CLICK_INFORME_SCRIPT, orden)
        if result != "OK":
            raise RuntimeError(f"No encontré claro el botón de informe de la OME {orden}: {result}")
        page.wait_for_timeout(1200)
        for _ in range(10):
            if page.evaluate(_FORM_INFORME_VISIBLE_SCRIPT):
                return
            page.wait_for_timeout(500)
        raise RuntimeError("Se hizo click, pero no apareció el formulario de informe.")

    def _completar_formulario(self, page: Page, plantilla: dict) -> None:
        result = page.evaluate(_COMPLETAR_INFORME_SCRIPT, plantilla)
        if not isinstance(result, dict) or not result.get("ok"):
            raise RuntimeError((result or {}).get("error") or "No pude completar el formulario de informe.")
        self._log("Formulario completado.")

    def _guardar_formulario(self, page: Page) -> None:
        page.bring_to_front()
        page.wait_for_timeout(300)

        target = page.evaluate(_GUARDAR_INFORME_TARGET_SCRIPT)
        if not isinstance(target, dict) or not target.get("ok"):
            raise RuntimeError(f"No pude guardar el informe: {(target or {}).get('error') or 'NO_GUARDAR'}")

        clicked = False
        x = float(target.get("x") or 0)
        y = float(target.get("y") or 0)
        selector = str(target.get("selector") or "").strip()
        self._accepting_save_dialog = True
        try:
            if selector:
                try:
                    page.locator(selector).last.click(timeout=5000, force=True)
                    clicked = True
                except Exception as exc:
                    self._log(f"No pude presionar Guardar con selector directo: {exc}")
            for intento in range(3):
                if clicked:
                    break
                try:
                    page.mouse.move(x, y)
                    page.mouse.down()
                    page.wait_for_timeout(120)
                    page.mouse.up()
                    page.wait_for_timeout(250)
                    page.mouse.click(x, y)
                    clicked = True
                    break
                except Exception as exc:
                    self._log(f"No pude presionar Guardar por coordenadas ({intento + 1}/3): {exc}")
                    page.wait_for_timeout(300)
            if clicked:
                page.wait_for_timeout(900)
            if clicked and page.evaluate(_FORM_INFORME_VISIBLE_SCRIPT):
                try:
                    page.keyboard.press("Enter")
                    page.wait_for_timeout(900)
                except Exception as exc:
                    self._log(f"No pude confirmar Guardar con Enter: {exc}")
            if page.evaluate(_FORM_INFORME_VISIBLE_SCRIPT):
                result = page.evaluate(_GUARDAR_INFORME_SCRIPT)
                if result != "OK":
                    raise RuntimeError(f"No pude guardar el informe: {result}")
            for _ in range(16):
                state = page.evaluate(_INFORME_GUARDADO_STATE_SCRIPT)
                if isinstance(state, dict) and state.get("ok"):
                    self._log(f"Informe guardado en PAMI: {state.get('status') or 'OK'}")
                    return
                if not page.evaluate(_FORM_INFORME_VISIBLE_SCRIPT):
                    self._log("Se presionó Guardar en el formulario de informe.")
                    return
                page.wait_for_timeout(500)
            state = page.evaluate(_INFORME_GUARDADO_STATE_SCRIPT)
            detail = state.get("status") if isinstance(state, dict) else ""
            raise RuntimeError(f"Se intentó presionar Guardar, pero PAMI dejó el formulario abierto{': ' + detail if detail else '.'}")
        finally:
            self._accepting_save_dialog = False

    def _handle_dialog(self, dialog) -> None:
        message = str(getattr(dialog, "message", "") or "").strip()
        if message:
            self._log(f"PAMI mostró aviso: {message}")
        try:
            if self._accepting_save_dialog:
                dialog.accept()
                self._log("Aviso de guardado aceptado.")
            else:
                dialog.dismiss()
                self._log("Aviso de PAMI cerrado.")
        except Exception as exc:
            self._log(f"No pude responder el aviso de PAMI: {exc}")

    def _status(self, message: str) -> None:
        self.status_callback(message)

    def _log(self, message: str) -> None:
        self.log_callback(message)


def _digits(value: object) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


_BUSCAR_ORDEN_SCRIPT = r"""
(nroOrden) => {
  const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  const setValue = (el, value) => {
    if (!el) return false;
    el.value = value || '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    return true;
  };
  const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="number"], input:not([type])')).filter(visible);
  let ordenInput = document.querySelector('input[name="n_orden"], #n_orden') ||
    inputs.find((el) => /orden|nro|numero/i.test(`${el.name || ''} ${el.id || ''} ${el.placeholder || ''}`));
  if (!ordenInput) {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const lbl = Array.from(document.querySelectorAll('label, span, div, td, th'))
      .filter(visible)
      .find((el) => /nro\.?\s*de\s*orden/.test(norm(el.textContent)) && norm(el.textContent).length < 30);
    if (lbl) {
      const lb = lbl.getBoundingClientRect();
      ordenInput = inputs.find((el) => {
        const b = el.getBoundingClientRect();
        return b.top >= lb.top - 20 && b.top <= lb.bottom + 70 && b.left >= lb.left - 20;
      });
    }
  }
  if (!ordenInput) return 'NO_ORDEN_INPUT';
  setValue(ordenInput, nroOrden);
  setValue(document.querySelector('#f_turno_desde, input[name="f_turno_desde"]'), '01/01/2025');
  setValue(document.querySelector('#f_turno_hasta, input[name="f_turno_hasta"]'), '');
  setValue(document.querySelector('#f_emision_desde, input[name="f_emision_desde"]'), '01/01/2025');
  setValue(document.querySelector('#f_emision_hasta, input[name="f_emision_hasta"]'), '');
  const buscar = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a'))
    .find((el) => visible(el) && (el.textContent || el.value || '').trim().toLowerCase() === 'buscar');
  if (!buscar) return 'NO_BUSCAR';
  buscar.click();
  return 'OK';
}
"""


_ORDEN_VISIBLE_SCRIPT = r"""
(nroOrden) => Array.from(document.querySelectorAll('table tbody tr'))
  .some((row) => (row.querySelectorAll('td')[0]?.textContent || '').replace(/\s+/g, ' ').trim() === nroOrden)
"""


_CLICK_INFORME_SCRIPT = r"""
(nroOrden) => {
  const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const control = (el) => el?.closest('button,a,span.btn,.btn,[role="button"]') || el;
  for (const row of document.querySelectorAll('table tbody tr')) {
    const tds = Array.from(row.querySelectorAll('td'));
    if ((tds[0]?.textContent || '').replace(/\s+/g, ' ').trim() !== nroOrden) continue;
    const acciones = tds[tds.length - 1] || row;
    const candidates = Array.from(acciones.querySelectorAll('a, button, span, i, .btn')).filter(visible);
    const scored = candidates.map((el, index) => {
      const target = control(el);
      const text = norm(`${target.textContent || ''} ${el.textContent || ''} ${target.title || ''} ${el.title || ''} ${target.getAttribute('data-original-title') || ''} ${target.getAttribute('aria-label') || ''}`);
      const cls = norm(`${target.className || ''} ${el.className || ''}`);
      let score = 0;
      if (/informe|consulta adultos|fclin|ficha clinica|historia|evolucion/.test(text + ' ' + cls)) score += 8;
      if (/file|document|clipboard|list-alt|fa-file|fa-file-text|glyphicon-list/.test(cls)) score += 5;
      if (/btn-success|green/.test(cls)) score += 2;
      if (/check|upload|cloud|arrow|right|transmit|ban|times|remove|cancel/.test(text + ' ' + cls)) score -= 9;
      return { el: target, score, index };
    }).filter((item, pos, arr) => item.el && arr.findIndex((x) => x.el === item.el) === pos)
      .sort((a, b) => (b.score - a.score) || (a.index - b.index));
    const best = scored[0];
    if (!best || best.score < 5) return 'NO_INFORME_BUTTON';
    best.el.click();
    return 'OK';
  }
  return 'NO_ROW';
}
"""


_FORM_INFORME_VISIBLE_SCRIPT = r"""
() => {
  const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const dialogs = Array.from(document.querySelectorAll('.modal.show, .modal.in, .modal, [role="dialog"]')).filter(visible);
  return dialogs.some((el) => {
    const txt = norm(el.textContent || '');
    return txt.includes('consulta adultos') && txt.includes('motivo de consulta') && txt.includes('tratamiento');
  });
}
"""


_COMPLETAR_INFORME_SCRIPT = r"""
(plantilla) => {
  const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const setValue = (el, value) => {
    if (!el) return false;
    el.focus();
    if (el.isContentEditable) {
      el.textContent = value || '';
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value || '');
      else el.value = value || '';
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    el.blur();
    return true;
  };
  const root = Array.from(document.querySelectorAll('.modal.show, .modal.in, .modal, [role="dialog"]')).find((el) => visible(el) && norm(el.textContent).includes('consulta adultos')) || document;
  const fields = Array.from(root.querySelectorAll('textarea, input, [contenteditable="true"]'))
    .filter((el) => visible(el) && !/hidden|button|submit|checkbox|radio|file/i.test(el.type || ''));
  const labels = Array.from(root.querySelectorAll('label, span, div, td, th')).filter(visible);
  const byNearbyLabel = (pattern) => {
    const label = labels.find((el) => pattern.test(norm(el.textContent || '')) && norm(el.textContent || '').length < 90);
    if (!label) return null;
    const lb = label.getBoundingClientRect();
    return fields.find((el) => {
      const b = el.getBoundingClientRect();
      const sameRow = b.top >= lb.top - 30 && b.top <= lb.bottom + 95;
      const below = b.top >= lb.top && b.top <= lb.bottom + 170;
      return (sameRow || below) && b.left >= lb.left - 20;
    }) || null;
  };
  const peso = byNearbyLabel(/^peso\b/);
  const taLabel = labels.find((el) => /(^|\W)ta(\W|$)/.test(norm(el.textContent || '')) && norm(el.textContent || '').length < 25);
  let okTaMax = false;
  let okTaMin = false;
  if (taLabel) {
    const lb = taLabel.getBoundingClientRect();
    const pesoLeft = peso ? peso.getBoundingClientRect().left : Number.POSITIVE_INFINITY;
    const taFields = fields.filter((el) => {
      const b = el.getBoundingClientRect();
      return b.top >= lb.top - 25 && b.top <= lb.bottom + 75 && b.left >= lb.right - 10 && b.left < pesoLeft - 8;
    }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    okTaMax = setValue(taFields[0], plantilla.taMax || '140');
    okTaMin = setValue(taFields[1], plantilla.taMin || '90');
  }
  if ((!okTaMax || !okTaMin) && peso) {
    const pb = peso.getBoundingClientRect();
    const sameRowBeforePeso = fields.filter((el) => {
      if (el === peso) return false;
      const b = el.getBoundingClientRect();
      return Math.abs(b.top - pb.top) <= 12 && b.left < pb.left - 8;
    }).sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
    const taMin = sameRowBeforePeso[0];
    const taMax = sameRowBeforePeso[1];
    okTaMax = setValue(taMax, plantilla.taMax || '140');
    okTaMin = setValue(taMin, plantilla.taMin || '90');
  }
  setValue(peso, plantilla.peso || '86');
  const motivo = byNearbyLabel(/motivo de consulta/);
  const examen = byNearbyLabel(/datos relevantes|examen fisico/);
  const diagnostico = byNearbyLabel(/diagnostico/);
  const tratamiento = byNearbyLabel(/tratamiento|indicaciones/);
  const okMotivo = setValue(motivo, plantilla.motivo || '');
  const okExamen = setValue(examen, plantilla.examen || '');
  const okDiagnostico = setValue(diagnostico, plantilla.diagnostico || '');
  const okTratamiento = setValue(tratamiento, plantilla.tratamiento || '');
  if (!okMotivo || !okExamen || !okDiagnostico || !okTratamiento) {
    return { ok: false, error: 'No encontré todos los campos grandes del informe.' };
  }
  return { ok: true };
}
"""


_GUARDAR_INFORME_TARGET_SCRIPT = r"""
() => {
  const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const cssEscape = (s) => {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  };
  const dialogs = Array.from(document.querySelectorAll('.modal.show, .modal.in, .modal, [role="dialog"]')).filter(visible);
  const root = dialogs.find((el) => norm(el.textContent).includes('consulta adultos')) || document;
  const buttons = Array.from(root.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, .btn'))
    .filter((el) => visible(el) && !el.disabled && !el.classList.contains('disabled'));
  const guardar = buttons.find((el) => norm(el.textContent || el.value || el.title || el.getAttribute('aria-label')).trim() === 'guardar');
  if (!guardar) return { ok: false, error: 'NO_GUARDAR' };
  guardar.scrollIntoView({ block: 'center', inline: 'center' });
  guardar.focus();
  const b = guardar.getBoundingClientRect();
  if (!b.width || !b.height) return { ok: false, error: 'GUARDAR_SIN_POSICION' };
  let selector = '';
  if (guardar.id) selector = '#' + cssEscape(guardar.id);
  else if (guardar.name) selector = `${guardar.tagName.toLowerCase()}[name="${String(guardar.name).replace(/"/g, '\\"')}"]`;
  return { ok: true, x: b.left + b.width / 2, y: b.top + b.height / 2, selector };
}
"""


_GUARDAR_INFORME_SCRIPT = r"""
() => {
  const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const root = Array.from(document.querySelectorAll('.modal.show, .modal.in, .modal, [role="dialog"]'))
    .find((el) => visible(el) && norm(el.textContent).includes('consulta adultos')) || document;
  const buttons = Array.from(root.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, .btn'))
    .filter((el) => visible(el) && !el.disabled && !el.classList.contains('disabled'));
  const guardar = buttons.find((el) => norm(el.textContent || el.value || el.title || el.getAttribute('aria-label')).trim() === 'guardar');
  if (!guardar) return 'NO_GUARDAR';
  guardar.focus();
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    guardar.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  if (window.jQuery) {
    try { window.jQuery(guardar).trigger('click'); } catch {}
  }
  const form = guardar.closest('form');
  if (form && typeof form.requestSubmit === 'function') {
    try { form.requestSubmit(guardar); } catch {}
  }
  return 'OK';
}
"""


_INFORME_GUARDADO_STATE_SCRIPT = r"""
() => {
  const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visibleText = Array.from(document.querySelectorAll('.alert, .toast, .bootbox, .modal, [role="alert"], .swal2-container'))
    .filter(visible)
    .map((el) => norm(el.textContent || ''))
    .join(' | ');
  if (/guardad|grabado|registrad|actualizad|correctamente|exitos/.test(visibleText)) {
    return { ok: true, status: visibleText.slice(0, 180) };
  }
  if (/error|obligatorio|requerido|debe|falt/.test(visibleText)) {
    return { ok: false, status: visibleText.slice(0, 180) };
  }
  return { ok: false, status: '' };
}
"""
