import threading
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable, Optional

from openpyxl import Workbook
from playwright.sync_api import Browser, BrowserContext, Page, Playwright, sync_playwright

from app_logging import log_message
from pami_scraper import configurar_playwright


CUP_LOGIN_URL = "https://cup.pami.org.ar/controllers/loginController.php?redirect=https://pe.pami.org.ar"
PAMI_TRANSMISION_URL = "https://pe.pami.org.ar/controllers/transmision.php"


class _HtmlExcelTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_table = False
        self.current_row: list[str] | None = None
        self.current_cell: list[str] | None = None
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        if tag == "table" and not self.in_table:
            self.in_table = True
            return
        if not self.in_table:
            return
        if tag == "tr":
            self.current_row = []
        elif tag in {"th", "td"} and self.current_row is not None:
            self.current_cell = []
        elif tag == "br" and self.current_cell is not None:
            self.current_cell.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "table" and self.in_table:
            self.in_table = False
            return
        if not self.in_table:
            return
        if tag in {"th", "td"} and self.current_row is not None and self.current_cell is not None:
            value = unescape("".join(self.current_cell)).replace("\xa0", " ").strip()
            self.current_row.append(value)
            self.current_cell = None
        elif tag == "tr" and self.current_row is not None:
            if any(cell != "" for cell in self.current_row):
                self.rows.append(self.current_row)
            self.current_row = None

    def handle_data(self, data: str) -> None:
        if self.in_table and self.current_cell is not None:
            self.current_cell.append(data)


BOT_SCRIPT = r"""
(() => {
  if (window.__PAMI_BOT_V5_APP__) return;
  window.__PAMI_BOT_V5_APP__ = true;

  function uiToDomSelectValue(valor) {
    const normalizado = (valor || '').toString().trim().toLowerCase();
    if (!normalizado) return '';
    if (['si', 'sí', 's', 'true'].includes(normalizado)) return 'S';
    if (['no', 'n', 'false'].includes(normalizado)) return 'N';
    return valor;
  }

  function domToUiSelectValue(valor) {
    const normalizado = (valor || '').toString().trim().toUpperCase();
    if (normalizado === 'S') return 'Si';
    if (normalizado === 'N') return 'No';
    return valor || '';
  }

  const KEY = 'pami_bot_v5_app';
  const MAX_RETRIES = 3;
  const RELOAD_DELAY_MS = 900;
  let pendingReloadId = null;
  const ts = () => new Date().toLocaleTimeString();
  const LOG = (msg) => console.log(`[PAMI BOT] ${ts()} | ${msg}`);
  const WARN = (msg) => console.warn(`[PAMI BOT] ${ts()} | ${msg}`);
  const ERR = (msg) => console.error(`[PAMI BOT] ${ts()} | ${msg}`);

  const ESTADO_INICIAL = {
    status: 'PAUSED',
    step: 'INICIO',
    barridoActual: 1,
    transmitidosEnBarrido: 0,
    pendienteNroOrden: null,
    intentosPendiente: 0,
    ultimoExitoso: null,
    procesados: 0,
    errores: 0,
    omitidos: [],
    omitidosDetalle: [],
    lastError: '',
    timestamp: null,
    paginaObjetivo: 1,
    paginaDetectada: 1,
    filtros: {
      fechaDesde: '',
      fechaHasta: '',
      validada: '',
      transmitida: ''
    }
  };

  try {
    window.alert = function(msg) {
      LOG(`ALERT bloqueado: ${msg}`);
      const texto = (msg || '').toString().trim();
      if (texto && !/INFORMACI[?O]N TRANSMITIDA/i.test(texto)) {
        setLastError(texto);
      }
      if (/INFORMACI[?O]N TRANSMITIDA/i.test(texto)) {
        clearLastError();
      }
    };
  } catch (e) {
    LOG(`No se pudo overridear alert: ${e}`);
  }

  window.addEventListener('error', (event) => {
    const motivo = `window.error: ${event.message || event.error || 'sin detalle'}`;
    setLastError(motivo);
    ERR(motivo);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || event.reason || 'sin detalle';
    const motivo = `unhandledrejection: ${reason}`;
    setLastError(motivo);
    ERR(motivo);
  });

  function cargarEstado() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { ...ESTADO_INICIAL };
      const e = JSON.parse(raw);
      e.omitidos = Array.isArray(e.omitidos) ? e.omitidos : [];
      e.omitidosDetalle = Array.isArray(e.omitidosDetalle) ? e.omitidosDetalle : [];
      e.paginaObjetivo = Number(e.paginaObjetivo || 1);
      e.paginaDetectada = Number(e.paginaDetectada || 1);
      e.filtros = {
        fechaDesde: e.filtros?.fechaDesde || '',
        fechaHasta: e.filtros?.fechaHasta || '',
        validada: e.filtros?.validada || '',
        transmitida: e.filtros?.transmitida || ''
      };
      e.lastError = e.lastError || '';
      return e;
    } catch (err) {
      ERR(`Error al cargar estado: ${err.message}`);
      return { ...ESTADO_INICIAL };
    }
  }

  function guardarEstado(e) {
    e.timestamp = new Date().toISOString();
    localStorage.setItem(KEY, JSON.stringify(e));
  }

  function setLastError(message) {
    try {
      const e = cargarEstado();
      e.lastError = (message || '').toString().trim();
      guardarEstado(e);
    } catch (err) {
    }
  }

  function clearLastError() {
    setLastError('');
  }

  // Registra una OME que no se pudo transmitir junto con el motivo (la leyenda
  // que tiró PAMI, ej. "afiliado inactivo"). El motivo sale del último error
  // capturado por la alerta; si no hay, usa el fallback del punto de falla.
  function registrarOmitido(estado, nro, motivoFallback) {
    if (!estado.omitidos.includes(nro)) estado.omitidos.push(nro);
    estado.omitidosDetalle = Array.isArray(estado.omitidosDetalle) ? estado.omitidosDetalle : [];
    const motivo = (estado.lastError || motivoFallback || '').toString().trim();
    const yaEsta = estado.omitidosDetalle.find((d) => d && d.nroOrden === nro);
    if (yaEsta) yaEsta.motivo = motivo || yaEsta.motivo;
    else estado.omitidosDetalle.push({ nroOrden: nro, motivo: motivo });
    estado.errores++;
  }

  function estaPausado() {
    try {
      return cargarEstado().status === 'PAUSED';
    } catch (err) {
      return false;
    }
  }

  function programarRecarga() {
    if (pendingReloadId) clearTimeout(pendingReloadId);
    pendingReloadId = setTimeout(() => {
      pendingReloadId = null;
      location.reload();
    }, RELOAD_DELAY_MS);
  }

  function cancelarRecargaPendiente() {
    if (pendingReloadId) {
      clearTimeout(pendingReloadId);
      pendingReloadId = null;
      LOG('Recarga pendiente cancelada por pausa.');
    }
  }

  function navegarAPrimeraPagina() {
    const url = new URL(window.location.href);
    url.searchParams.delete('pagina');
    url.searchParams.set('registros_por_pagina', '50');
    location.href = url.toString();
  }

  function waitFor(condicion, timeout = 8000, intervalo = 150) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const id = setInterval(() => {
        try {
          if (condicion()) {
            clearInterval(id);
            resolve(true);
          } else if (Date.now() - t0 > timeout) {
            clearInterval(id);
            reject(new Error(`timeout ${timeout}ms`));
          }
        } catch (e) {
          clearInterval(id);
          reject(e);
        }
      }, intervalo);
    });
  }

  async function waitForRowsLoaded(timeout = 10000) {
    try {
      await waitFor(() => {
        const rows = document.querySelectorAll('table tbody tr');
        return rows.length > 0 && rows[0].textContent.trim().length > 0;
      }, timeout);
      LOG(`Tabla lista: ${document.querySelectorAll('table tbody tr').length} filas.`);
      return true;
    } catch {
      WARN('Timeout esperando filas.');
      return false;
    }
  }

  async function waitForTableReady(timeout = 8000) {
    try {
      await waitFor(() => {
        const tb = document.querySelector('table tbody');
        return tb !== null && tb.offsetParent !== null;
      }, timeout);
      return true;
    } catch {
      WARN('Timeout esperando tabla.');
      return false;
    }
  }

  async function waitForModalVisible(timeout = 6000) {
    try {
      await waitFor(() =>
        Array.from(document.querySelectorAll('button'))
          .some(b => b.textContent.trim() === 'Confirmar' && b.offsetParent !== null),
        timeout
      );
      LOG('Modal visible.');
      return true;
    } catch {
      WARN('Timeout esperando modal.');
      return false;
    }
  }

  async function waitForConfirmButton(timeout = 5000) {
    try {
      await waitFor(() =>
        Array.from(document.querySelectorAll('button'))
          .some(b => b.textContent.trim() === 'Confirmar' && b.offsetParent !== null && !b.disabled),
        timeout
      );
      return true;
    } catch {
      WARN('Timeout esperando Confirmar.');
      return false;
    }
  }

  function getBuscarTrigger() {
    const candidatos = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a'));
    return candidatos.find((el) => {
      const texto = (el.textContent || el.value || '').trim().toLowerCase();
      if (texto !== 'buscar') return false;
      return el.offsetParent !== null || el.getClientRects().length > 0;
    }) || null;
  }

  function getRppSelect() {
    return (
      document.querySelector('select[name="registros_por_pagina"]') ||
      document.querySelector('select[name="rpp"]') ||
      document.querySelector('select[name="per_page"]') ||
      Array.from(document.querySelectorAll('select'))
        .find(s => [...s.options].some(o => o.value === '50' || (o.textContent || '').includes('50')))
    );
  }

  async function asegurar50PorPagina() {
    const sel = getRppSelect();
    if (!sel) {
      WARN('No se encontró selector de registros por página.');
      return true;
    }

    if (sel.value === '50') return true;

    LOG(`Selector DOM en "${sel.value}". Forzando a 50...`);
    sel.value = '50';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    return false;
  }

  function getPaginaActiva() {
    const activa = Array.from(document.querySelectorAll('a, button, span'))
      .find(el => {
        const txt = el.textContent.trim();
        if (!/^\d+$/.test(txt)) return false;
        const cls = el.className || '';
        return /active|btn-primary|current|selected/.test(cls) || el.getAttribute('aria-current') === 'page';
      });

    if (activa) return Number(activa.textContent.trim());

    const url = new URL(window.location.href);
    const pagina = Number(url.searchParams.get('pagina') || '1');
    return Number.isFinite(pagina) && pagina > 0 ? pagina : 1;
  }

  function getBotonMasResultados() {
    return Array.from(document.querySelectorAll('a, button'))
      .find(el => el.textContent.trim() === 'Más resultados' && el.offsetParent !== null);
  }

  function getBotonPaginaSiguiente() {
    const paginaActual = getPaginaActiva();
    return Array.from(document.querySelectorAll('a, button'))
      .find(el => {
        if (el.offsetParent === null) return false;
        const txt = (el.textContent || '').trim();
        if (!/^\d+$/.test(txt)) return false;
        if (Number(txt) !== (paginaActual + 1)) return false;
        if (el.disabled) return false;
        if ((el.getAttribute('aria-current') || '') === 'page') return false;
        const cls = el.className || '';
        return !/active|selected|current/.test(cls);
      }) || null;
  }

  function getControlAvancePagina() {
    return getBotonMasResultados() || getBotonPaginaSiguiente();
  }

  function hayMasResultados() {
    return !!getControlAvancePagina();
  }

  async function avanzarPagina() {
    const btn = getControlAvancePagina();
    if (!btn) {
      LOG('No hay control para avanzar de página.');
      return false;
    }

    const paginaAntes = getPaginaActiva();
    LOG(`Avanzando desde página ${paginaAntes}...`);
    btn.click();

    try {
      await waitFor(() => getPaginaActiva() > paginaAntes, 8000, 150);
      await waitForRowsLoaded(8000);
      LOG(`Ahora en página ${getPaginaActiva()}.`);
      return true;
    } catch {
      WARN('No se detectó avance de página tras intentar avanzar.');
      return false;
    }
  }

  function snapshotFiltros() {
    const leerValor = (selector) => document.querySelector(selector)?.value?.trim() || '';
    return {
      fechaDesde: leerValor('input[name="f_turno_desde"]'),
      fechaHasta: leerValor('input[name="f_turno_hasta"]'),
      validada: domToUiSelectValue(leerValor('select[name="c_validada"]')),
      transmitida: domToUiSelectValue(leerValor('select[name="transmitida"]'))
    };
  }

  function filtrosCoinciden(filtros) {
    const actuales = snapshotFiltros();
    return (
      (!(filtros?.fechaDesde) || filtros.fechaDesde === actuales.fechaDesde) &&
      (!(filtros?.fechaHasta) || filtros.fechaHasta === actuales.fechaHasta) &&
      (!(filtros?.validada) || filtros.validada === actuales.validada) &&
      (!(filtros?.transmitida) || filtros.transmitida === actuales.transmitida)
    );
  }

  async function aplicarFiltrosGuardados(filtros) {
    if (!filtros) return true;
    if (filtrosCoinciden(filtros)) {
      LOG('Filtros ya aplicados.');
      return true;
    }

    const setValor = (selector, valor) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      el.value = valor;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };

    let huboCambios = false;
    if (filtros.fechaDesde) huboCambios = setValor('input[name="f_turno_desde"]', filtros.fechaDesde) || huboCambios;
    if (filtros.fechaHasta) huboCambios = setValor('input[name="f_turno_hasta"]', filtros.fechaHasta) || huboCambios;
    if (filtros.validada) huboCambios = setValor('select[name="c_validada"]', uiToDomSelectValue(filtros.validada)) || huboCambios;
    if (filtros.transmitida) huboCambios = setValor('select[name="transmitida"]', uiToDomSelectValue(filtros.transmitida)) || huboCambios;

    if (!huboCambios) {
      LOG('No hay filtros configurados para aplicar automáticamente.');
      return true;
    }

    const buscar = getBuscarTrigger();

    if (!buscar) {
      WARN('No se encontró el disparador de Buscar. Se continuará con los filtros ya visibles en pantalla.');
      await new Promise(r => setTimeout(r, 600));
      return true;
    }

    LOG(
      `Aplicando filtros: desde=${filtros.fechaDesde || '-'} | hasta=${filtros.fechaHasta || '-'} | ` +
      `validada=${filtros.validada || '-'} | transmitida=${filtros.transmitida || '-'}`
    );
    buscar.click();
    await waitForRowsLoaded(10000);
    return true;
  }

  async function irHastaPaginaObjetivo(estado) {
    let paginaActual = getPaginaActiva();
    estado.paginaDetectada = paginaActual;
    guardarEstado(estado);

    if (estado.paginaObjetivo <= 1) {
      LOG('Página objetivo = 1.');
      return true;
    }

    if (paginaActual > estado.paginaObjetivo) {
      LOG(`Ya estamos en una página más avanzada (${paginaActual}) que la objetivo (${estado.paginaObjetivo}). Se continuará desde aquí.`);
      estado.paginaObjetivo = paginaActual;
      estado.paginaDetectada = paginaActual;
      guardarEstado(estado);
      return true;
    }

    LOG(`Reubicando hasta página ${estado.paginaObjetivo}...`);
    let guard = 0;

    while (paginaActual < estado.paginaObjetivo && guard < 20) {
      const ok = await avanzarPagina();
      if (!ok) {
        ERR(`No se pudo alcanzar página objetivo ${estado.paginaObjetivo}. Quedó en ${paginaActual}.`);
        return false;
      }
      paginaActual = getPaginaActiva();
      estado.paginaDetectada = paginaActual;
      guardarEstado(estado);
      guard++;
    }

    LOG(`Página recuperada: ${paginaActual}.`);
    return paginaActual === estado.paginaObjetivo;
  }

  async function reconstruirVista(estado) {
    if (!(await waitForTableReady(8000))) return false;

    const cambioRpp = !(await asegurar50PorPagina());
    if (cambioRpp) {
      LOG('Esperando estabilización tras cambiar a 50...');
      const ok = await waitForRowsLoaded(8000);
      if (!ok) return false;
      await new Promise(r => setTimeout(r, 250));
    } else {
      await waitForRowsLoaded(8000);
    }

    const okFiltros = await aplicarFiltrosGuardados(estado.filtros || ESTADO_INICIAL.filtros);
    if (!okFiltros) return false;

    const okPagina = await irHastaPaginaObjetivo(estado);
    if (!okPagina) return false;

      await waitForRowsLoaded(8000);
    return true;
  }

  function buscarPrimerElegible(omitidos = []) {
    const rows = document.querySelectorAll('table tbody tr');
    LOG(`Escaneando ${rows.length} filas en página ${getPaginaActiva()}...`);

    for (const row of rows) {
      const tds = row.querySelectorAll('td');
      const nroOrden = tds[0]?.textContent.trim();
      const nombre = tds[3]?.textContent.trim();

      if (!nroOrden) continue;
      if (omitidos.includes(nroOrden)) {
        LOG(`Saltando omitido: ${nroOrden}`);
        continue;
      }

      const checkEl = row.querySelector('i.fa-check');
      const docEl = row.querySelector('i.fa-upload');
      const btn = row.querySelector('i.transmitir');

      const checkAzul =
        checkEl?.closest('button,a,span')?.classList.contains('btn-primary') ||
        checkEl?.classList.contains('btn-primary');

      const docAzul =
        docEl?.closest('button,a,span')?.classList.contains('btn-primary') ||
        docEl?.classList.contains('btn-primary');

      if (btn && checkAzul && docAzul) {
        LOG(`Elegible: [${nroOrden}] ${nombre}`);
        return { btn, nroOrden, nombre, pagina: getPaginaActiva() };
      }
    }

    LOG('Sin elegibles visibles en esta página.');
    return null;
  }

  function ordenAunEnTabla(nroOrden) {
    for (const row of document.querySelectorAll('table tbody tr')) {
      if (row.querySelectorAll('td')[0]?.textContent.trim() === nroOrden) return true;
    }
    return false;
  }

  async function abrirModal(fila, estado) {
    window.confirm = () => true;

    LOG(`Abriendo modal: [${fila.nroOrden}] ${fila.nombre} | página ${fila.pagina}`);
    estado.step = 'MODAL_ABIERTO';
    estado.paginaObjetivo = fila.pagina;
    estado.lastError = '';
    guardarEstado(estado);

    fila.btn.click();
    return await waitForModalVisible(6000);
  }

  async function confirmarTransmision(fila, estado) {
    if (!(await waitForConfirmButton(5000))) {
      ERR(`Confirmar no disponible para [${fila.nroOrden}]`);
      return false;
    }

    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent.trim() === 'Confirmar' && b.offsetParent !== null && !b.disabled);

    if (!btn) {
      ERR('Botón Confirmar no encontrado.');
      return false;
    }

    LOG(`Confirmando: [${fila.nroOrden}] ${fila.nombre}`);
    estado.status = 'WAITING_RELOAD';
    estado.step = 'PENDIENTE_VALIDACION';
    estado.pendienteNroOrden = fila.nroOrden;
    estado.paginaObjetivo = fila.pagina;
    estado.lastError = '';
    guardarEstado(estado);

    btn.click();
    return true;
  }

  async function buscarElegibleEnTodasLasPaginas(estado) {
    let guard = 0;

    while (guard < 50) {
      if (estaPausado()) {
        LOG('Pausa detectada durante el barrido.');
        return { paused: true };
      }
      estado.paginaDetectada = getPaginaActiva();
      guardarEstado(estado);

      const fila = buscarPrimerElegible(estado.omitidos);
      if (fila) {
        estado.paginaObjetivo = fila.pagina;
        guardarEstado(estado);
        return fila;
      }

      if (!hayMasResultados()) {
        LOG('No hay más páginas disponibles.');
        return null;
      }

      const ok = await avanzarPagina();
      if (!ok) return null;

      estado.paginaObjetivo = getPaginaActiva();
      estado.paginaDetectada = estado.paginaObjetivo;
      guardarEstado(estado);

      guard++;
    }

    ERR('Guard de paginación alcanzado.');
    return null;
  }

  async function main() {
    LOG('════════ Ciclo iniciado ════════');
    const estado = cargarEstado();

    if (estado.status === 'PAUSED') {
      LOG('PAUSADO. Ejecutá pami_bot_start() para activar.');
      return;
    }

    if (estado.status === 'DONE') {
      LOG(`TERMINADO | Procesados: ${estado.procesados} | Errores: ${estado.errores}`);
      return;
    }

    if (estado.status === 'ERROR') {
      LOG('ERROR. Revisá pami_bot_status() antes de continuar.');
      return;
    }

    let vistaOk = await reconstruirVista(estado);
    if (estaPausado()) {
      LOG('Pausa detectada tras reconstruir la vista.');
      return;
    }
    if (!vistaOk) {
      WARN(`Primer intento de reconstrucci?n fall?. Reintentando una vez m?s desde p?gina ${getPaginaActiva()}...`);
      await new Promise(r => setTimeout(r, 600));
      vistaOk = await reconstruirVista(estado);
      if (estaPausado()) {
        LOG('Pausa detectada durante el reintento de reconstrucci?n.');
        return;
      }
      if (!vistaOk) {
        ERR(`No se pudo reconstruir la vista. Qued? en p?gina ${getPaginaActiva()} con objetivo ${estado.paginaObjetivo}.`);
        estado.status = 'ERROR';
        estado.lastError = estado.lastError || 'No se pudo reconstruir la vista tras la recarga.';
        guardarEstado(estado);
        return;
      }
    }
    estado.paginaDetectada = getPaginaActiva();
    guardarEstado(estado);

    if (estado.status === 'WAITING_RELOAD') {
      LOG('Post-recarga. Validando ciclo anterior...');
      estado.status = 'RUNNING';

      if (estado.pendienteNroOrden) {
        const nro = estado.pendienteNroOrden;

        if (!ordenAunEnTabla(nro)) {
          LOG(`ÉXITO: [${nro}] ya no está en la tabla.`);
          estado.ultimoExitoso = nro;
          estado.procesados++;
          estado.transmitidosEnBarrido = (estado.transmitidosEnBarrido || 0) + 1;
          estado.pendienteNroOrden = null;
          estado.intentosPendiente = 0;
          estado.lastError = '';
        } else {
          estado.intentosPendiente = (estado.intentosPendiente || 0) + 1;
          WARN(`[${nro}] sigue en tabla. Intento ${estado.intentosPendiente}/${MAX_RETRIES}.`);

          if (estado.intentosPendiente >= MAX_RETRIES) {
            ERR(`[${nro}] agotó retries. Omitiendo. Motivo: ${estado.lastError || 'sin detalle'}`);
            registrarOmitido(estado, nro, `No se pudo transmitir [${nro}] tras ${MAX_RETRIES} intentos`);
            estado.pendienteNroOrden = null;
            estado.intentosPendiente = 0;
          }
        }

        guardarEstado(estado);
      }
    }

    const fila = await buscarElegibleEnTodasLasPaginas(estado);

    if (fila && fila.paused) {
      LOG('Bot en pausa. Se detiene antes de continuar con otra fila.');
      return;
    }

    if (!fila) {
      if ((estado.transmitidosEnBarrido || 0) > 0) {
        const barridoSiguiente = (estado.barridoActual || 1) + 1;
        LOG(`Fin de barrido ${estado.barridoActual || 1} con ${estado.transmitidosEnBarrido || 0} transmisiones. Reiniciando desde página 1 para revalidar movimientos de filas...`);
        estado.status = 'RUNNING';
        estado.step = 'REINICIO_BARRIDO';
        estado.barridoActual = barridoSiguiente;
        estado.transmitidosEnBarrido = 0;
        estado.paginaObjetivo = 1;
        estado.paginaDetectada = 1;
        guardarEstado(estado);
        navegarAPrimeraPagina();
        return;
      }

      LOG(`DONE. Procesados: ${estado.procesados} | Errores: ${estado.errores}`);
      estado.status = 'DONE';
      guardarEstado(estado);
      return;
    }

    if (estaPausado()) {
      LOG('Pausa detectada antes de abrir el modal.');
      return;
    }

    const modalOk = await abrirModal(fila, estado);

    if (estaPausado()) {
      LOG('Pausa detectada despu?s de abrir el modal.');
      return;
    }
    if (!modalOk) {
      estado.intentosPendiente = (estado.intentosPendiente || 0) + 1;
      if (estado.intentosPendiente >= MAX_RETRIES) {
        estado.lastError = estado.lastError || `No se pudo abrir el modal para [${fila.nroOrden}]`;
        registrarOmitido(estado, fila.nroOrden, `No se pudo abrir el modal para [${fila.nroOrden}]`);
        estado.intentosPendiente = 0;
      }
      guardarEstado(estado);
      programarRecarga();
      return;
    }

    const confirmOk = await confirmarTransmision(fila, estado);
    if (!confirmOk) {
      estado.intentosPendiente = (estado.intentosPendiente || 0) + 1;
      if (estado.intentosPendiente >= MAX_RETRIES) {
        estado.lastError = estado.lastError || `No se pudo confirmar la transmisi?n para [${fila.nroOrden}]`;
        registrarOmitido(estado, fila.nroOrden, `No se pudo confirmar la transmisi?n para [${fila.nroOrden}]`);
        estado.intentosPendiente = 0;
      }
      estado.pendienteNroOrden = null;
      estado.lastError = estado.lastError || `No se pudo confirmar la transmisi?n para [${fila.nroOrden}]`;
      guardarEstado(estado);
      programarRecarga();
      return;
    }

    LOG('Confirmación enviada. Esperando recarga de PAMI...');
  }

  function scheduleMainRun() {
    setTimeout(() => {
      main().catch((err) => ERR(`main() manual fall??: ${err?.message || err}`));
    }, 120);
  }

  function autoBootMainIfNeeded() {
    const estado = cargarEstado();
    if (!['RUNNING', 'WAITING_RELOAD'].includes(estado.status)) {
      return;
    }
    setTimeout(() => {
      main().catch((err) => ERR(`main() auto fall??: ${err?.message || err}`));
    }, 900);
  }

  window.pami_bot_start = function() {
    const previo = cargarEstado();
    const filtrosActuales = previo.filtros || snapshotFiltros() || ESTADO_INICIAL.filtros;
    guardarEstado({
      ...ESTADO_INICIAL,
      lastError: '',
      status: 'RUNNING',
      barridoActual: 1,
      transmitidosEnBarrido: 0,
      omitidos: previo.omitidos || [],
      omitidosDetalle: previo.omitidosDetalle || [],
      filtros: filtrosActuales,
      paginaObjetivo: 1,
      paginaDetectada: 1
    });
    LOG('Bot INICIADO. Siempre arranca desde página 1 para recorrer toda la lista.');
  };

  window.pami_bot_set_filters = function(filtros) {
    const estado = cargarEstado();
    estado.filtros = {
      fechaDesde: filtros?.fechaDesde || '',
      fechaHasta: filtros?.fechaHasta || '',
      validada: filtros?.validada || '',
      transmitida: filtros?.transmitida || ''
    };
    guardarEstado(estado);
    LOG(
      `Filtros configurados desde la app: desde=${estado.filtros.fechaDesde || '-'} | ` +
      `hasta=${estado.filtros.fechaHasta || '-'} | validada=${estado.filtros.validada || '-'} | ` +
      `transmitida=${estado.filtros.transmitida || '-'}`
    );
    return estado.filtros;
  };

  window.pami_bot_pause = function() {
    const e = cargarEstado();
    e.status = 'PAUSED';
    guardarEstado(e);
    cancelarRecargaPendiente();
    LOG('Bot PAUSADO. Esperar? al pr?ximo punto seguro del ciclo.');
  };

  window.pami_bot_resume = function() {
    const e = cargarEstado();
    if (e.status === 'DONE') {
      WARN('Ya terminó. Usá pami_bot_start() para reiniciar.');
      return;
    }
    e.status = 'RUNNING';
    guardarEstado(e);
    LOG('Bot RESUMIDO.');
    scheduleMainRun();
  };

  window.pami_bot_status = function() {
    const e = cargarEstado();
    const salida = {
      status: e.status,
      step: e.step,
      procesados: e.procesados,
      errores: e.errores,
      pendienteNroOrden: e.pendienteNroOrden ?? '—',
      intentosPendiente: e.intentosPendiente ?? 0,
      ultimoExitoso: e.ultimoExitoso ?? '—',
      omitidos: e.omitidos.join(', ') || '—',
      omitidosDetalle: Array.isArray(e.omitidosDetalle) ? e.omitidosDetalle : [],
      paginaObjetivo: e.paginaObjetivo ?? 1,
      paginaDetectada: e.paginaDetectada ?? 1,
      lastError: e.lastError || '',
      timestamp: e.timestamp
    };
    console.table(salida);
    return salida;
  };

  window.pami_bot_reset = function() {
    localStorage.removeItem(KEY);
    LOG('Estado reseteado.');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        main().catch((err) => ERR(`main() DOMContentLoaded falló: ${err?.message || err}`));
      }, 900);
    });
  } else {
    setTimeout(() => {
      main().catch((err) => ERR(`main() auto falló: ${err?.message || err}`));
    }, 900);
  }
})();
"""


@dataclass
class SesionTransmision:
    playwright: Playwright
    browser: Browser
    context: BrowserContext
    page: Page


class PamiTransmisionController:
    def __init__(
        self,
        log_callback: Optional[Callable[[str], None]] = None,
        status_callback: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.log_callback = log_callback or (lambda _: None)
        self.status_callback = status_callback or (lambda _: None)
        self._lock = threading.RLock()
        self._sesion: SesionTransmision | None = None

    def abrir_pami(
        self,
        usuario: str | None = None,
        clave: str | None = None,
        filtros: dict | None = None,
        headless: bool = False,
    ) -> None:
        with self._lock:
            self._cleanup_dead_session()

            if self._sesion is not None:
                self._log("Ya había un navegador abierto. Se cerrará para abrir una nueva sesión.")
                self._dispose_session(
                    "Se cerró la sesión anterior para abrir una nueva.",
                    "Sesión anterior descartada antes de abrir PAMI nuevamente.",
                )

            if headless and (not usuario or not clave):
                raise RuntimeError("Para usar el modo sin navegador visible debes cargar usuario y clave.")

            configurar_playwright()
            playwright = sync_playwright().start()
            browser = playwright.chromium.launch(
                headless=headless,
                args=[] if headless else ["--window-size=1280,900"],
            )
            context = browser.new_context(
                accept_downloads=True,
                ignore_https_errors=True,
                viewport={"width": 1280, "height": 900},
            )
            page = context.new_page()
            page.set_default_timeout(20000)
            page.on("console", self._on_console)
            page.on("pageerror", self._on_page_error)
            target_url = CUP_LOGIN_URL if (usuario and clave) else PAMI_TRANSMISION_URL
            page.goto(target_url, wait_until="domcontentloaded")

            self._sesion = SesionTransmision(
                playwright=playwright,
                browser=browser,
                context=context,
                page=page,
            )
            self._status("Sesion iniciada en segundo plano." if headless else "Navegador abierto. Inicia sesion en PAMI y deja lista la pantalla de transmision.")
            self._log(f"Navegador abierto en {target_url}")
            if usuario and clave:
                self._auto_login_cup(page, usuario, clave)
                page.goto(PAMI_TRANSMISION_URL, wait_until="domcontentloaded")
                page.wait_for_timeout(700)
                if filtros:
                    self._apply_transmision_filters(page, filtros)
                self._status("Sesion iniciada y pantalla de transmision preparada en segundo plano." if headless else "CUP abierto con sesion iniciada. Ya puedes trabajar en Transmision.")
            elif usuario or clave:
                self._try_autofill_credenciales(page, usuario or "", clave or "", timeout_ms=15000)

    def cerrar_navegador(self) -> None:
        with self._lock:
            if self._sesion is None:
                self._status("No hay navegador abierto para cerrar.")
                self._log("Cerrar navegador solicitado, pero no había sesión activa.")
                return
            self._dispose_session("Navegador cerrado desde la app.", "Sesión cerrada manualmente desde la app.")

    def autocompletar_credenciales(self, usuario: str, clave: str | None = None) -> None:
        with self._lock:
            usuario = (usuario or "").strip()
            clave = clave or ""
            if not usuario and not clave:
                raise RuntimeError("Ingresa usuario o clave antes de autocompletar.")

            page = self._get_page()
            if not self._try_autofill_credenciales(page, usuario, clave, timeout_ms=12000):
                raise RuntimeError(
                    "No encontré los campos de login en la pantalla actual. "
                    "Abre PAMI y deja visible el login antes de usar esta función."
                )

    def autocompletar_usuario(self, usuario: str) -> None:
        self.autocompletar_credenciales(usuario=usuario, clave="")

    def iniciar_bot(self, filtros: dict | None = None) -> None:
        with self._lock:
            self._cleanup_dead_session()
            self._navigate_to_transmision_if_needed()
            page = self._get_transmision_page()
            page.goto(f"{PAMI_TRANSMISION_URL}?registros_por_pagina=50", wait_until="domcontentloaded")
            page.wait_for_timeout(700)
            if filtros:
                self._apply_transmision_filters(page, filtros)
            self._inject_bot(page)
            if filtros:
                page.evaluate(
                    """(filtros) => window.pami_bot_set_filters && window.pami_bot_set_filters(filtros)""",
                    {
                        "fechaDesde": str(filtros.get("fecha_desde", "") or "").strip(),
                        "fechaHasta": str(filtros.get("fecha_hasta", "") or "").strip(),
                        "validada": str(filtros.get("validada", "") or "").strip(),
                        "transmitida": str(filtros.get("transmitida", "") or "").strip(),
                    },
                )
            page.evaluate("window.pami_bot_start()")
            self._status("Bot iniciado. Revisa el navegador y el log.")

    def pausar_bot(self) -> None:
        with self._lock:
            self._cleanup_dead_session()
            page = self._get_page()
            self._inject_bot(page)
            page.evaluate("window.pami_bot_pause()")
            self._status("Bot detenido.")

    def reanudar_bot(self) -> None:
        with self._lock:
            self._cleanup_dead_session()
            page = self._get_page()
            self._inject_bot(page)
            page.evaluate("window.pami_bot_resume()")
            self._status("Bot reanudado.")

    def resetear_bot(self) -> None:
        with self._lock:
            self._cleanup_dead_session()
            page = self._get_page()
            self._inject_bot(page)
            page.evaluate("window.pami_bot_reset()")
            self._status("Estado del bot reseteado.")

    def obtener_estado(self) -> dict:
        with self._lock:
            self._cleanup_dead_session()
            self._navigate_to_transmision_if_needed()
            page = self._get_transmision_page()
            self._inject_bot(page)
            estado = self._evaluate_with_navigation_retry(page, "window.pami_bot_status()")
            self._status(
                f"Estado: {estado.get('status', 'desconocido')} | "
                f"Procesados: {estado.get('procesados', 0)} | "
                f"Errores: {estado.get('errores', 0)}"
            )
            return estado

    def contar_pendientes(self, filtros: dict | None = None) -> int:
        with self._lock:
            self._cleanup_dead_session()
            self._navigate_to_transmision_if_needed()
            page = self._get_transmision_page()
            page.goto(f"{PAMI_TRANSMISION_URL}?registros_por_pagina=50", wait_until="domcontentloaded")
            page.wait_for_timeout(700)
            if filtros:
                self._apply_transmision_filters(page, filtros)
            self._ensure_transmision_registros_por_pagina(page, "50")
            page.wait_for_timeout(700)

            total = 0
            guard = 0
            while guard < 100:
                page.wait_for_timeout(250)
                total += page.locator("table tbody tr").count()
                advanced = page.evaluate(
                    """() => {
                      const getPaginaActiva = () => {
                        const activa = Array.from(document.querySelectorAll('a, button, span'))
                          .find((el) => {
                            const txt = (el.textContent || '').trim();
                            if (!/^\\d+$/.test(txt)) return false;
                            const cls = el.className || '';
                            return /active|btn-primary|current|selected/.test(cls) || el.getAttribute('aria-current') === 'page';
                          });
                        if (activa) return Number((activa.textContent || '').trim());
                        const url = new URL(window.location.href);
                        const pagina = Number(url.searchParams.get('pagina') || '1');
                        return Number.isFinite(pagina) && pagina > 0 ? pagina : 1;
                      };

                      const paginaActual = getPaginaActiva();
                      const btnMas = Array.from(document.querySelectorAll('a, button'))
                        .find((el) => ((el.textContent || '').trim() === 'Más resultados') && (el.offsetParent !== null || el.getClientRects().length > 0));
                      if (btnMas) {
                        btnMas.click();
                        return true;
                      }

                      const btnSiguiente = Array.from(document.querySelectorAll('a, button'))
                        .find((el) => {
                          if (!(el.offsetParent !== null || el.getClientRects().length > 0)) return false;
                          const txt = (el.textContent || '').trim();
                          if (!/^\\d+$/.test(txt)) return false;
                          if (Number(txt) !== (paginaActual + 1)) return false;
                          if (el.disabled) return false;
                          if ((el.getAttribute('aria-current') || '') === 'page') return false;
                          const cls = el.className || '';
                          return !/active|selected|current/.test(cls);
                        });
                      if (!btnSiguiente) return false;
                      btnSiguiente.click();
                      return true;
                    }"""
                )
                if not advanced:
                    break
                page.wait_for_timeout(600)
                guard += 1

            self._log(f"Pendientes sin transmitir detectados tras el barrido: {total}")
            return int(total)

    def exportar_excel_panel(self, destino: str, filtros: dict | None = None) -> str:
        with self._lock:
            self._cleanup_dead_session()
            self._navigate_to_transmision_if_needed()
            page = self._get_transmision_page()

            # El botón Exportar aparece junto al panel de resultados, que PAMI
            # renderiza de forma asíncrona tras la búsqueda (y más lento en
            # headless). En un barrido de varios clientes, a veces la grilla no
            # termina de renderizar en la 1ra pasada -> reintentamos recargando la
            # pantalla y re-aplicando los filtros antes de darlo por fallado.
            exportar = None
            for intento in range(2):
                page.goto(f"{PAMI_TRANSMISION_URL}?registros_por_pagina=50", wait_until="domcontentloaded")
                page.wait_for_timeout(700 if intento == 0 else 1500)
                if filtros:
                    self._apply_transmision_filters(page, filtros)
                cand = page.locator("input[value='Exportar'], button:has-text('Exportar'), a:has-text('Exportar')").first
                try:
                    cand.wait_for(state="visible", timeout=25000)
                    exportar = cand
                    break
                except Exception:
                    if intento == 0:
                        self._log("Exportar no apareció; recargo y reintento una vez…")
                        continue
            if exportar is None:
                # Diagnóstico: dejar rastro de en qué pantalla quedó (URL, texto,
                # captura) para entender por qué no aparece el Exportar.
                try:
                    diag_dir = Path(__file__).resolve().parent / "logs" / "diag"
                    diag_dir.mkdir(parents=True, exist_ok=True)
                    url = page.url
                    cuerpo = ""
                    try:
                        cuerpo = (page.locator("body").inner_text(timeout=3000) or "")[:1500]
                    except Exception:
                        pass
                    shot = diag_dir / "exportar_no_encontrado.png"
                    try:
                        page.screenshot(path=str(shot), full_page=True)
                    except Exception:
                        shot = None
                    self._log(f"[DIAG] Exportar no visible. URL: {url}")
                    self._log(f"[DIAG] Texto de la pantalla (recorte):\n{cuerpo}")
                    if shot:
                        self._log(f"[DIAG] Captura guardada en: {shot}")
                except Exception as diag_exc:  # noqa: BLE001
                    self._log(f"[DIAG] No pude capturar el diagnóstico: {diag_exc!r}")
                raise RuntimeError("No encontré el botón Exportar en la pantalla actual.")

            # PAMI genera el Excel del mes en el momento y tarda: para una bandeja
            # entera puede pasar del minuto (medido ~42s en un mes chico). El
            # timeout viejo de 30s cortaba antes de que largara la descarga.
            with page.expect_download(timeout=240000) as download_info:
                exportar.click()
            download = download_info.value
            temp_path = Path(download.path())
            sample = temp_path.read_bytes()[:4096]
            sample_lc = sample.lower()
            suggested_name = (download.suggested_filename or "").strip()

            if sample.startswith(b"PK\x03\x04"):
                detected_suffix = ".xlsx"
                detected_kind = "xlsx"
            elif b"<html" in sample_lc or b"xmlns:x=\"urn:schemas-microsoft-com:office:excel\"" in sample_lc:
                detected_suffix = ".xlsx"
                detected_kind = "html-excel"
            else:
                suggested_suffix = Path(suggested_name).suffix.lower()
                detected_suffix = suggested_suffix or Path(str(destino)).suffix.lower() or ".xls"
                detected_kind = "desconocido"

            requested_path = Path(str(destino))
            requested_suffix = requested_path.suffix.lower()
            final_path = requested_path if requested_suffix == detected_suffix else requested_path.with_suffix(detected_suffix)

            if detected_kind == "html-excel":
                html_text = temp_path.read_text(encoding="utf-8", errors="replace")
                parser = _HtmlExcelTableParser()
                parser.feed(html_text)
                if not parser.rows:
                    raise RuntimeError("PAMI devolvió un HTML, pero no pude extraer la tabla para generar el Excel.")
                workbook = Workbook()
                worksheet = workbook.active
                worksheet.title = "Transmision"
                for row in parser.rows:
                    worksheet.append(row)
                workbook.save(final_path)
            else:
                final_path.write_bytes(temp_path.read_bytes())

            if final_path != requested_path:
                self._status(
                    f"Exportación ajustada: PAMI devolvió un archivo {detected_kind}. Guardado como: {final_path}"
                )
                self._log(
                    f"Exportación ajustada por formato real ({detected_kind}). Ruta final: {final_path}"
                )
            else:
                self._status(f"Excel exportado en: {final_path}")
                self._log(f"Excel exportado desde Transmisión: {final_path}")
            return str(final_path)

    def cerrar(self) -> None:
        with self._lock:
            if self._sesion is None:
                return
            self._dispose_session("Navegador cerrado.", "Sesión de transmisión cerrada.")

    def _get_page(self) -> Page:
        self._cleanup_dead_session()
        if self._sesion is None:
            raise RuntimeError("Primero abre PAMI desde la app.")
        return self._sesion.page

    def _get_transmision_page(self) -> Page:
        self._cleanup_dead_session()
        if self._sesion is None:
            raise RuntimeError("Primero abre PAMI desde la app.")

        candidatas = list(self._sesion.context.pages)
        if self._sesion.page not in candidatas:
            candidatas.append(self._sesion.page)

        self._log(f"Paginas detectadas en el contexto: {len(candidatas)}")

        for candidata in reversed(candidatas):
            try:
                url = candidata.url or ""
            except Exception:
                url = ""

            if "transmision.php" in url:
                self._sesion.page = candidata
                self._log(f"Pagina de transmision encontrada por URL: {url}")
                self._ensure_transmision_page(candidata)
                return candidata

        for candidata in reversed(candidatas):
            try:
                self._log(f"Probando pagina por DOM: {candidata.url}")
                self._ensure_transmision_page(candidata)
                self._sesion.page = candidata
                self._log(f"Pagina de transmision encontrada por DOM: {candidata.url}")
                return candidata
            except Exception:
                continue

        page = self._sesion.page
        self._log(f"No se encontro coincidencia automatica. Ultima URL conocida: {page.url}")
        self._ensure_transmision_page(page)
        return page

    def _ensure_transmision_page(self, page: Page) -> None:
        url = page.url or ""
        if "transmision.php" in url:
            return

        try:
            visible = page.locator("button:has-text('Buscar')").count() > 0
            tabla = page.locator("table tbody").count() > 0
            if visible and tabla:
                self._log(f"Pantalla validada por DOM aunque la URL no coincidia: {url}")
                return
        except Exception:
            pass

        raise RuntimeError(
            "La pestaña actual no está en la pantalla de transmisión. "
            "Inicia sesión y navega manualmente hasta Transmisión."
        )

    def _navigate_to_transmision_if_needed(self) -> None:
        if self._sesion is None:
            raise RuntimeError("Primero abre PAMI desde la app.")

        try:
            page = self._get_transmision_page()
            self._ensure_transmision_page(page)
            return
        except Exception:
            pass

        page = self._get_page()
        self._log(f"Intentando navegar automáticamente a transmisión desde: {page.url}")

        try:
            page.goto(PAMI_TRANSMISION_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(1200)
            self._ensure_transmision_page(page)
            self._log(f"Navegación automática exitosa a: {page.url}")
        except Exception as exc:
            self._log(f"No se pudo navegar automáticamente a transmisión: {exc}")

    def _inject_bot(self, page: Page) -> None:
        page.add_init_script(BOT_SCRIPT)
        self._evaluate_with_navigation_retry(page, BOT_SCRIPT)
        self._log("Motor del bot verificado en la página.")

    def _is_transient_navigation_error(self, exc: Exception) -> bool:
        texto = str(exc or "")
        return (
            "Execution context was destroyed" in texto
            or "most likely because of a navigation" in texto
            or "Cannot find context with specified id" in texto
        )

    def _evaluate_with_navigation_retry(self, page: Page, script: str, arg=None, attempts: int = 3):
        ultimo_error = None
        for intento in range(1, attempts + 1):
            try:
                if arg is None:
                    return page.evaluate(script)
                return page.evaluate(script, arg)
            except Exception as exc:
                ultimo_error = exc
                if not self._is_transient_navigation_error(exc) or intento >= attempts:
                    raise
                self._log(
                    f"Reintentando lectura/inyección tras navegación en curso ({intento}/{attempts - 1})."
                )
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=3000)
                except Exception:
                    pass
                try:
                    page.wait_for_timeout(350)
                except Exception:
                    pass
        raise ultimo_error

    def _apply_transmision_filters(self, page: Page, filtros: dict | None) -> None:
        filtros = filtros or {}
        fecha_desde = str(filtros.get("fecha_desde", "") or "").strip()
        fecha_hasta = str(filtros.get("fecha_hasta", "") or "").strip()
        validada = str(filtros.get("validada", "") or "").strip()
        transmitida = str(filtros.get("transmitida", "") or "").strip()

        page.evaluate(
            """
            (filtros) => {
              const uiToDomSelectValue = (valor) => {
                const normalizado = (valor || '').toString().trim().toLowerCase();
                if (!normalizado) return '';
                if (['si', 'sí', 's', 'true'].includes(normalizado)) return 'S';
                if (['no', 'n', 'false'].includes(normalizado)) return 'N';
                return valor;
              };

              const setValor = (selector, valor) => {
                const el = document.querySelector(selector);
                if (!el || valor === undefined || valor === null) return false;
                el.value = valor;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              };

              // Combos (validada/transmitida): vacío = "todas" (1ra opción "---").
              // Siempre se setean, así el export NO arrastra un filtro que dejó una
              // corrida anterior (ej. la transmisión con validada=S, transmitida=N).
              const setSelect = (selector, valor) => {
                const el = document.querySelector(selector);
                if (!el) return false;
                if (valor === '' || valor === undefined || valor === null) el.selectedIndex = 0;
                else el.value = valor;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              };

              const getBuscarTrigger = () => {
                const candidatos = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a'));
                return candidatos.find((el) => {
                  const texto = (el.textContent || el.value || '').trim().toLowerCase();
                  if (texto !== 'buscar') return false;
                  return el.offsetParent !== null || el.getClientRects().length > 0;
                }) || null;
              };

              let huboCambios = false;
              if (filtros.fecha_desde) huboCambios = setValor('input[name="f_turno_desde"]', filtros.fecha_desde) || huboCambios;
              if (filtros.fecha_hasta) huboCambios = setValor('input[name="f_turno_hasta"]', filtros.fecha_hasta) || huboCambios;
              huboCambios = setSelect('select[name="c_validada"]', uiToDomSelectValue(filtros.validada || '')) || huboCambios;
              huboCambios = setSelect('select[name="transmitida"]', uiToDomSelectValue(filtros.transmitida || '')) || huboCambios;

              if (huboCambios) {
                const buscar = getBuscarTrigger();
                if (buscar) buscar.click();
              }
            }
            """,
            {
                "fecha_desde": fecha_desde,
                "fecha_hasta": fecha_hasta,
                "validada": validada,
                "transmitida": transmitida,
            },
        )
        # Esperar a que la búsqueda REALMENTE termine de recargar la grilla antes de
        # exportar. Sin esto, en centros grandes (muchas filas, ej. CIMA con 3.500+)
        # el export salía antes de que PAMI recargara → exportaba datos parciales o
        # viejos (rango de fechas y cantidad equivocados). networkidle + estabilización.
        try:
            page.wait_for_load_state("networkidle", timeout=20000)
        except Exception:
            pass
        page.wait_for_timeout(1600)
        self._log(
            "Filtros aplicados desde la app -> "
            f"desde={fecha_desde or '-'} | hasta={fecha_hasta or '-'} | "
            f"validada={validada or '-'} | transmitida={transmitida or '-'}"
        )
        # Verificación: cuando pedimos "todas" (validada/transmitida vacías) para el
        # export, PAMI a veces re-aplica el filtro de la SESIÓN (el que dejó la
        # transmisión: validada=S, transmitida=N) al recargar la grilla, y el export
        # sale filtrado (subconjunto en vez de la bandeja completa). Si detectamos
        # que el combo sigue con un valor cuando lo pedimos vacío, re-aplicamos.
        if not validada and not transmitida:
            for _ in range(2):
                actual = page.evaluate(
                    """() => ({
                      v: (document.querySelector('select[name="c_validada"]')?.value || '').trim(),
                      t: (document.querySelector('select[name="transmitida"]')?.value || '').trim()
                    })"""
                ) or {}
                if not actual.get("v") and not actual.get("t"):
                    break  # ya está en "todas"
                self._log(
                    f"[FILTRO] El combo quedó filtrado (v={actual.get('v')!r} t={actual.get('t')!r}) "
                    "cuando pedí TODAS; reseteo de nuevo."
                )
                page.evaluate(
                    """() => {
                      const reset = (sel) => { const el=document.querySelector(sel); if(el){ el.selectedIndex=0; el.dispatchEvent(new Event('change',{bubbles:true})); } };
                      reset('select[name="c_validada"]'); reset('select[name="transmitida"]');
                      const cand = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a'))
                        .find(el => ((el.textContent||el.value||'').trim().toLowerCase()==='buscar') && (el.offsetParent!==null || el.getClientRects().length>0));
                      if (cand) cand.click();
                    }"""
                )
                try:
                    page.wait_for_load_state("networkidle", timeout=20000)
                except Exception:
                    pass
                page.wait_for_timeout(1600)

    def _ensure_transmision_registros_por_pagina(self, page: Page, valor: str = "50") -> None:
        actualizado = page.evaluate(
            """
            (valor) => {
              const candidatos = [
                document.querySelector('select[name="registros_por_pagina"]'),
                document.querySelector('select[name="rpp"]'),
                document.querySelector('select[name="per_page"]'),
              ].filter(Boolean);

              let sel = candidatos[0] || null;
              if (!sel) {
                sel = Array.from(document.querySelectorAll('select')).find((item) =>
                  Array.from(item.options || []).some((opt) => (opt.value || '').trim() === valor || (opt.textContent || '').includes(valor))
                ) || null;
              }

              if (!sel) return 'missing';
              if ((sel.value || '').trim() === valor) return 'ok';

              sel.value = valor;
              sel.dispatchEvent(new Event('input', { bubbles: true }));
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              return 'changed';
            }
            """,
            valor,
        )
        if actualizado == "changed":
            self._log(f"Registros por página ajustado a {valor}.")
        elif actualizado == "missing":
            self._log("No se encontró selector de registros por página para ajustar el conteo.")

    def _session_is_active(self, page: Page) -> bool:
        try:
            response = page.goto(PAMI_TRANSMISION_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(600)
            if "cup.pami.org.ar" in (page.url or ""):
                return False
            if response and response.status >= 400:
                return False
            return page.locator("table tbody, button:has-text('Buscar')").count() > 0
        except Exception:
            return False

    def _is_cup_login_page(self, page: Page) -> bool:
        try:
            url = (page.url or "").lower()
            if "logincontroller.php" not in url and "cup.pami.org.ar" not in url:
                return False
            return page.locator('input[name="usuario"], input[type="text"], #usuario').count() > 0
        except Exception:
            return False

    def _auto_login_cup(self, page: Page, usuario: str, clave: str) -> None:
        usuario = (usuario or "").strip()
        clave = clave or ""
        if not usuario or not clave:
            return

        if self._session_is_active(page):
            self._log("La sesión de CUP ya estaba activa.")
            return

        self._log("Iniciando sesión automática en CUP PAMI...")
        page.goto(CUP_LOGIN_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(600)

        user_input = page.locator('input[name="usuario"], input[type="text"], #usuario').first
        pass_input = page.locator('input[name="password"], input[type="password"], #password').first

        user_input.wait_for(state="visible")
        user_input.fill("")
        page.wait_for_timeout(250)
        user_input.type(usuario, delay=45)
        page.wait_for_timeout(250)

        pass_input.wait_for(state="visible")
        pass_input.fill("")
        page.wait_for_timeout(250)
        pass_input.type(clave, delay=45)
        page.wait_for_timeout(500)

        submit = page.locator(
            'button[type="submit"], input[type="submit"], button:has-text("Ingresar"), button:has-text("Entrar")'
        ).first
        submit.click()
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(1200)

        if self._is_cup_login_page(page):
            raise RuntimeError("No se pudo iniciar sesión en CUP PAMI. Revisa usuario y clave.")

        self._log("Sesión iniciada automáticamente en CUP PAMI.")

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
            ("xpath", "xpath=//label[contains(normalize-space(),'Usuario')]/following::input[1]"),
            ("xpath", "xpath=//*[contains(normalize-space(),'Usuario')]/following::input[1]"),
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
            ("label", "Contraseña"),
            ("label", "Clave"),
            ("xpath", "xpath=//label[contains(normalize-space(),'Contraseña')]/following::input[1]"),
            ("xpath", "xpath=//label[contains(normalize-space(),'Clave')]/following::input[1]"),
        ]

        import time

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
                self._log("Credenciales aplicadas en login con selectores visibles.")
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

                      const porLabel = visiblesUsuario.find((el) => {
                        const id = el.id || '';
                        const label = id ? document.querySelector(`label[for="${id}"]`) : null;
                        const texto = ((label && label.textContent) || '').toLowerCase();
                        return texto.includes('usuario');
                      });

                      const porTexto = visiblesUsuario.find((el) => {
                        const bloque = (el.parentElement?.textContent || '').toLowerCase();
                        return bloque.includes('usuario');
                      });

                      const usuarioTarget = porLabel || porTexto || visiblesUsuario[0] || null;
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
                    self._log("Credenciales aplicadas en login con evaluación DOM directa.")
                    return True
            except Exception:
                pass

            try:
                page.wait_for_timeout(500)
            except Exception:
                break

        self._log(f"No se pudieron autocompletar las credenciales en {page.url}")
        return False

    def _try_autofill_usuario(self, page: Page, usuario: str, timeout_ms: int = 12000) -> bool:
        return self._try_autofill_credenciales(page, usuario, "", timeout_ms=timeout_ms)

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
        log_message(f"[TRANSMISION] {message}")
        self.status_callback(message)

    def _cleanup_dead_session(self) -> None:
        if self._sesion is None:
            return

        try:
            if self._sesion.page.is_closed():
                self._dispose_session(
                    "El navegador fue cerrado. Ya puedes volver a abrir PAMI.",
                    "Sesión limpiada porque la página fue cerrada manualmente.",
                )
                return
        except Exception:
            self._dispose_session(
                "La sesión del navegador dejó de estar disponible. Ya puedes volver a abrir PAMI.",
                "Sesión limpiada porque Playwright no pudo acceder a la página actual.",
            )
            return

        try:
            _ = list(self._sesion.context.pages)
        except Exception:
            self._dispose_session(
                "El contexto del navegador ya no está disponible. Ya puedes volver a abrir PAMI.",
                "Sesión limpiada porque el contexto del navegador estaba cerrado.",
            )

    def _clear_session(self, status_message: str, log_message_text: str) -> None:
        if self._sesion is None:
            return
        self._sesion = None
        self._status(status_message)
        self._log(log_message_text)

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
