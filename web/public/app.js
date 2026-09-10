// El tema vive en <html> para que el fondo del body y el texto heredado
// también cambien (si se pone en #root, el body queda con el tema claro).
var root = document.documentElement;
var TH_MOON = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
var TH_SUN  = '<circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
function applyThemeIcon(){
  var el = document.getElementById('thIco');
  if (el) el.innerHTML = (root.getAttribute('data-theme') === 'dark') ? TH_SUN : TH_MOON;
}
function toggleTheme(){
  var d = root.getAttribute('data-theme') === 'dark';
  var next = d ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('ns-theme', next); } catch (e) {}
  applyThemeIcon();
}
(function(){
  try { var t = localStorage.getItem('ns-theme'); if (t === 'dark' || t === 'light') root.setAttribute('data-theme', t); } catch (e) {}
  applyThemeIcon();
})();

// --- Menú colapsable (solo íconos), recordado en el navegador ---
function setSidebarCollapseIcon(){
  var b = document.getElementById('sideCollapseBtn');
  if (b) b.textContent = document.body.classList.contains('sidebar-collapsed') ? '›' : '‹';
}
function toggleSidebar(){
  var collapsed = document.body.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem('ns-sidebar-collapsed', collapsed ? '1' : '0'); } catch (e) {}
  setSidebarCollapseIcon();
}
// Click en el padre "Clientes": si ya estás en Clientes con el submenú abierto,
// lo cierra (colapsa la lista); si no, entra a Clientes y lo abre.
function toggleClientGroup(tipo, el){
  var group = document.getElementById(tipo === 'medcab' ? 'navGroupMedCab' : (tipo === 'potenciales' ? 'navGroupPotenciales' : 'navGroupConsultorios'));
  // Tocar el grupo SOLO despliega/pliega la lista; NO abre ningún cliente.
  // Recién se entra a un consultorio al hacer clic en uno puntual de la lista.
  var eraColapsada = document.body.classList.contains('sidebar-collapsed');
  expandSidebar();                                          // si estaba colapsada, mostrarla
  if (!CLIENTS.length) loadClients({ detail: false });      // garantizar la lista cargada
  if (group){
    if (eraColapsada) group.classList.add('open');          // al expandir, mostrar la lista
    else group.classList.toggle('open');
  }
}
// La lista de clientes vive en la barra: si está colapsada no se ve. Al entrar
// a Clientes la expandimos para poder elegir un cliente.
function expandSidebar(){
  if (!document.body.classList.contains('sidebar-collapsed')) return;
  document.body.classList.remove('sidebar-collapsed');
  try { localStorage.setItem('ns-sidebar-collapsed', '0'); } catch (e) {}
  setSidebarCollapseIcon();
}
(function(){
  try { if (localStorage.getItem('ns-sidebar-collapsed') === '1') document.body.classList.add('sidebar-collapsed'); } catch (e) {}
  // Tooltips nativos para cuando está colapsado (los labels quedan ocultos).
  document.querySelectorAll('.nav a, .nav-parent, .side-config a').forEach(function(el){
    if (!el.getAttribute('title')){ var t = (el.textContent || '').trim(); if (t) el.setAttribute('title', t); }
  });
  setSidebarCollapseIcon();
})();

var titles = { dash:'Inicio', users:'Usuarios', clientes:'Clientes', nomencladores:'Nomencladores', informes:'Informes', omeweb:'Generar OME', credencial:'Credencial provisoria', resumen:'Resumen de cuenta', facturas:'Facturas', gastos:'Gastos', padron:'Afiliados', cabina:'Informes recibidos', liberarcupo:'Liberar cupo', cruzas:'Cruzas', lab:'Laboratorio', soon:'Configuración general' };
// En Inicio, el título de la barra ES el saludo (no "Inicio", que es redundante).
// Devuelve HTML: el "Buenas tardes, " va en un span que se esconde en celular
// (queda solo "Ignacio 👋") para que no se parta en dos líneas al lado de los íconos.
function saludoHTML(u){
  var h = new Date().getHours();
  var s = h < 6 ? 'Buenas noches' : (h < 13 ? 'Buen día' : (h < 20 ? 'Buenas tardes' : 'Buenas noches'));
  var n = (u && u.name ? u.name.split(' ')[0] : '');
  return '<span class="hi-pre">' + s + ', </span>' + esc(n) + ' 👋';
}
// Grupo "Pagos" del menú: si estás en el sidebar colapsado o fuera de la vista,
// entra a Facturas; si ya estás, solo colapsa/expande el desplegable.
// ¿El menú está en modo cajón (celular/tablet)? Lo decide el mismo media query que
// muestra la hamburguesa, así no depende del ancho exacto ni del viewport.
function esMenuMovil(){
  var h = document.querySelector('.hamb');
  return !!(h && getComputedStyle(h).display !== 'none');
}
function togglePagosGroup(el){
  // "Administración" SOLO despliega/cierra el submenú; no abre ninguna pantalla
  // por su cuenta. El usuario elige después Resumen de cuenta o Facturas.
  var group = document.getElementById('navGroupPagos');
  if (group) group.classList.toggle('open');
}
// Módulos que ESTE operador_clinica puntual tiene habilitados (afiliados/
// informes/liberar cupo) - a diferencia del resto de los roles, esto es por
// usuario, no por rol (ver server.js, publicUser/OPERADOR_CLINICA_MODULOS).
function opClinicaModulos(){ return (ME && ME.role === 'operador_clinica' && Array.isArray(ME.modulos)) ? ME.modulos : []; }
function go(v, el){
  // Credencial provisoria se fusionó dentro de Afiliados (Padrón). Cualquier link viejo
  // a 'credencial' abre Afiliados.
  if (v === 'credencial') v = 'padron';
  // El rol clínica solo entra a su centro: cualquier vista interna de NS lo redirige.
  // Excepción: "Informes" (crear informes) y "Liberar cupo" - herramientas
  // propias del centro que el admin habilita por capacidad. El backend scopea
  // todo a su centro y corta si la capacidad está apagada. "dash" (Inicio)
  // también es excepción: TODOS los roles arrancan en Inicio (con su cartel de
  // "en desarrollo" si todavía no tiene paneles propios, ver cargarInicio) en
  // vez de saltar directo al centro.
  if (ME && ME.role === 'clinica' && v !== 'dash' && NS_ONLY_VIEWS.indexOf(v) >= 0
      && !(v === 'informes' && clinicaTieneCap('omes'))
      && !(v === 'liberarcupo' && clinicaTieneCap('liberarcupo'))){
    if (ME.centro){ go('clientes'); selectClientWhenReady(ME.centro, 'mescurso'); }
    return;
  }
  // Operador Clínica (empleado del centro, no el dueño): mismo encierro que
  // clínica (nunca dashboards/honorarios/reportes/plata), salvo los módulos
  // puntuales que se le hayan habilitado (afiliados/informes/liberar cupo) -
  // esos SÍ pueden abrirse, y siguen de largo a los chequeos de más abajo.
  if (ME && ME.role === 'operador_clinica' && v !== 'dash' && NS_ONLY_VIEWS.indexOf(v) >= 0 && opClinicaModulos().indexOf(v) < 0){
    if (ME.centro){ go('clientes'); selectClientWhenReady(ME.centro, 'pendientes'); }
    return;
  }
  // Colaborador (solo lectura): por ahora solo Inicio y los dashboards de sus
  // clientes. Cualquier otra vista lo devuelve al Inicio.
  if (ME && ME.role === 'colaborador' && ['dash', 'clientes'].indexOf(v) < 0){ go('dash'); return; }
  // Informes recibidos (cabina): admin y operador (que la trabaja). El resto, afuera.
  if (v === 'cabina' && !(ME && (ME.role === 'admin' || ME.role === 'operador'))){ go('dash'); return; }
  if (v === 'liberarcupo' && !(ME && (ME.role === 'admin' || ME.role === 'operador' || opClinicaModulos().indexOf('liberarcupo') >= 0 || (ME.role === 'clinica' && clinicaTieneCap('liberarcupo'))))){ go('dash'); return; }
  if (v === 'omeweb' && !(ME && (ME.role === 'admin' || ME.role === 'operador'))){ go('dash'); return; }
  // Afiliados: admin y operador la USAN; el usuario de demostración la VE (solo lectura,
  // el backend le bloquea las acciones). El resto, afuera (salvo operador_clinica habilitado).
  if (v === 'padron' && !(ME && (ME.role === 'admin' || ME.role === 'operador' || ME.role === 'demo' || opClinicaModulos().indexOf('padron') >= 0))){ go('dash'); return; }
  // Cruzas: solo admin (herramienta nueva, maneja montos y datos de pacientes).
  if (v === 'cruzas' && !(ME && ME.role === 'admin')){ go('dash'); return; }
  // Nomencladores: por ahora un operador no lo necesita.
  if (v === 'nomencladores' && ME && ME.role === 'operador'){ go('dash'); return; }
  // Laboratorio (sistema paralelo en desarrollo): solo admin por ahora.
  if (v === 'lab' && !(ME && ME.role === 'admin')){ go('dash'); return; }
  // Configuración general: un operador con clientes restringidos no debe entrar
  // (usuarios, débitos, etc.) - un operador sin restringir sí, como siempre.
  if (v === 'soon' && tieneClientesRestringidos(ME)){ go('dash'); return; }
  ['dash','clientes','nomencladores','informes','omeweb','resumen','facturas','padron','cabina','liberarcupo','cruzas','lab','soon'].forEach(function(x){ document.getElementById('view-'+x).style.display = x===v ? 'block' : 'none'; });
  var _pt = document.getElementById('pageTitle');
  if (v === 'dash' && ME) _pt.innerHTML = saludoHTML(ME); else _pt.textContent = titles[v];
  document.querySelector('.topbar').classList.toggle('client-mode', v === 'clientes');
  document.body.classList.toggle('client-view', v === 'clientes');
  document.body.classList.toggle('dash-view', v === 'dash');
  // Laboratorio: menú mínimo (logo + Inicio + pie), se esconde el resto del nav.
  document.body.classList.toggle('lab-mode', v === 'lab');
  if (v === 'lab' && window.labInit) window.labInit();
  if (v === 'clientes'){ expandSidebar(); loadClients(); }
  if (v === 'dash'){ updateDashClientsTile(); cargarInicio(true); }
  if (v === 'resumen') setResSection('resumen');  // Resumen · Ingresos · Gastos
  if (v === 'nomencladores') loadNomencladorSummary();
  if (v === 'informes'){ setInformesTab('generar'); loadInformesConfig(); }
  if (v === 'omeweb') loadOmeWebView();
  if (v === 'padron') loadPadronView();
  if (v === 'cabina') loadCabinaView();
  if (v === 'liberarcupo') loadLiberarCupoView();
  if (v === 'soon'){ renderUsers(); loadGeneralDebitos(); }
  if (v === 'facturas') loadFacturas();
  if (v === 'cruzas') loadCruzasClientes();
  document.querySelectorAll('.nav a, .side-config a, .nav-parent, .client-nav-item').forEach(function(a){ a.classList.remove('active'); });
  ['navGroupConsultorios', 'navGroupMedCab', 'navGroupPotenciales'].forEach(function(id){
    var g = document.getElementById(id);
    if (!g) return;
    g.classList.toggle('active', v === 'clientes');
    // Al SALIR de Clientes se pliegan los tres. Al entrar NO abrimos los tres (antes
    // sí, y por eso tocar un potencial desplegaba también Med. Cabecera): renderClientList
    // abre solo el grupo del cliente activo.
    if (v !== 'clientes') g.classList.remove('open');
  });
  var gPagos = document.getElementById('navGroupPagos');
  var enAdmin = (v === 'resumen' || v === 'facturas');
  if (gPagos){ gPagos.classList.toggle('open', enAdmin); gPagos.classList.toggle('active', enAdmin); }
  if (el) el.classList.add('active');
  document.body.classList.remove('nav-open');
  if (v !== 'informes') pushHash(v);  // en informes el hash lo pone setInformesTab (con la sub-pestaña)
}

// Que el menú permita "abrir en pestaña nueva" (click derecho / rueda / Ctrl+click):
// le damos a cada ítem el href de su hash. El left-click sigue navegando por go()
// (que pone el mismo hash), así que el href queda como no-op y no duplica.
function ponerHrefsNav(){
  document.querySelectorAll("a[onclick*=\"go('\"]").forEach(function(a){
    if (a.getAttribute('href')) return;
    var m = /go\('([a-z]+)'/i.exec(a.getAttribute('onclick') || '');
    if (m) a.setAttribute('href', '#' + m[1]);
  });
}
// Secciones colapsables del menú (como B2B/Ecom en Gauss): el header abre/cierra
// su bloque; el estado se recuerda por sección. En modo icon-only no colapsa.
function wireNavSecciones(){
  document.querySelectorAll('.nav-section-collapsible[data-section]').forEach(function(header){
    if (header._wired) return; header._wired = true;
    var key = header.getAttribute('data-section');
    var items = document.querySelector('.nav-section-items[data-section-items="'+key+'"]');
    var guardado = null;
    try{ guardado = localStorage.getItem('ns-nav-sec-'+key); }catch(e){}
    if (guardado === '0'){ header.classList.add('collapsed'); if(items) items.classList.add('collapsed'); }
    header.addEventListener('click', function(){
      if (document.body.classList.contains('sidebar-collapsed')) return;  // icon-only: no colapsa
      var col = header.classList.toggle('collapsed');
      if (items) items.classList.toggle('collapsed', col);
      try{ localStorage.setItem('ns-nav-sec-'+key, col ? '0' : '1'); }catch(e){}
    });
  });
}
function initNav(){ ponerHrefsNav(); wireNavSecciones(); }
if (document.readyState !== 'loading') initNav();
else document.addEventListener('DOMContentLoaded', initNav);

// ---------- Credencial provisoria: consulta en vivo a PAMI ----------
async function descargarCredencial(pfx){
  pfx = pfx || '';   // '' = vista interna NS; 'cli' = sección Credencial del cliente
  var btn = document.getElementById(pfx + 'credBtn');
  var err = document.getElementById(pfx + 'credError');
  var result = document.getElementById(pfx + 'credResult');
  err.style.display = 'none'; result.style.display = 'none'; result.innerHTML = '';
  var payload = {
    benef: (document.getElementById(pfx + 'credBenef').value || '').trim(),
    dni: (document.getElementById(pfx + 'credDni').value || '').trim(),
    tramite: (document.getElementById(pfx + 'credTramite').value || '').trim(),
    genero: (document.getElementById(pfx + 'credGenero').value || '').trim()
  };
  if (!payload.benef || !payload.dni || !payload.tramite){
    err.textContent = 'Completá BENEF, DNI y N° trámite.'; err.style.display = 'block'; return;
  }
  btn.disabled = true; var textoOrig = btn.textContent; btn.textContent = 'Consultando PAMI…';
  try {
    var resp = await fetch('/api/credencial-provisoria', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    var ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (resp.ok && ct.indexOf('application/pdf') >= 0){
      var blob = await resp.blob();
      var urlpdf = URL.createObjectURL(blob);
      var nombre = 'credencial_' + payload.dni + '.pdf';
      result.innerHTML = '<div class="cred-ok">✅ Credencial encontrada.</div>'
        + '<div class="cred-buttons"><a class="btn btn-primary" href="' + urlpdf + '" download="' + nombre + '">Guardar PDF</a>'
        + '<a class="btn btn-ghost" href="' + urlpdf + '" target="_blank" rel="noopener">Abrir en pestaña</a></div>'
        // #view=FitH → el visor ajusta al ANCHO (no a la hoja entera): la
        // credencial (arriba de un A4 casi vacío) se ve al doble de grande.
        + '<iframe class="cred-preview" src="' + urlpdf + '#view=FitH"></iframe>';
      result.style.display = 'block';
    } else {
      var data = {}; try { data = await resp.json(); } catch (e){}
      err.textContent = (data && data.error) || 'No se pudo traer la credencial.';
      if (data && data.detalle) err.textContent += ' — ' + data.detalle;
      err.style.display = 'block';
    }
  } catch (e){
    err.textContent = 'Error de conexión: ' + ((e && e.message) || e);
    err.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = textoOrig;
  }
}
// ===== Lote de credenciales (planilla de Google) — por cliente Médico de cabecera =====
// Clientes con módulo de credenciales; la tarjeta aparece en Configuración.
var CRED_CLIENTES = ['scheffelaar-mc', 'dubesarky-ezequiel'];
// Planilla de Google de cada cliente (para el botón "Ir a la planilla").
var CRED_PLANILLA = {
  'scheffelaar-mc': '1sZP1NuVzyzjc17lrFFePy6IVQNUB3epNXJIXoBJI334',
  'dubesarky-ezequiel': '1CJHJz2iR32aknMKwtMsivpjhdIQ3n1T-iUaMt7iENGo',
};
function credBase(){ return '/api/credenciales/' + (ACTIVE_CLIENT ? ACTIVE_CLIENT.slug : 'scheffelaar-mc'); }
var CRED_LOTE_ROWS = [], CRED_LOTE_STOP = false, CRED_LOTE_RUNNING = false;
async function credLoteCargar(){
  var err = document.getElementById('credLoteError'); err.style.display = 'none'; err.textContent = '';
  var desde = parseInt(document.getElementById('credLoteDesde').value, 10) || 2;
  var btn = document.getElementById('credLoteCargarBtn'); btn.disabled = true; var t = btn.textContent; btn.textContent = 'Cargando…';
  var res = await req('GET', credBase() + '/pendientes');
  btn.disabled = false; btn.textContent = t;
  if (!res.ok){ err.style.display = 'block'; err.textContent = (res.data && res.data.error) || 'No se pudo leer la planilla.'; return; }
  var all = res.data.pendientes || [];
  CRED_LOTE_ROWS = all.filter(function(x){ return x.sheetRow >= desde; }).map(function(x){ return Object.assign({ estado: 'pendiente' }, x); });
  document.getElementById('credLoteResumen').innerHTML = 'Planilla: <b>' + (res.data.hechas || 0) + '</b> ya hechas · <b>' + (res.data.faltanDatos || 0) + '</b> incompletas · <b>' + all.length + '</b> pendientes en total. Desde la fila ' + desde + ': <b>' + CRED_LOTE_ROWS.length + '</b> para procesar.';
  credLoteRender();
  document.getElementById('credLoteProcBtn').style.display = CRED_LOTE_ROWS.length ? '' : 'none';
}
function credLoteRender(){
  var tb = document.getElementById('credLoteBody'), tbl = document.getElementById('credLoteTable');
  if (!CRED_LOTE_ROWS.length){ tbl.style.display = 'none'; tb.innerHTML = ''; return; }
  tbl.style.display = '';
  tb.innerHTML = CRED_LOTE_ROWS.map(function(x){
    var est = x.estado === 'ok' ? '<span style="color:#0f9d63;font-weight:600">✓ ' + esc(x.archivo || 'subida') + '</span>'
      : x.estado === 'error' ? '<span style="color:' + (x.definitivo ? '#b7791f' : 'var(--error)') + '">' + (x.definitivo ? '⚠' : '✕') + ' ' + esc(x.error || 'error') + '</span>'
      : x.estado === 'procesando' ? '⏳…' : '<span class="nom-muted">pendiente</span>';
    return '<tr><td>' + x.sheetRow + '</td><td>' + esc(x.nombre || '') + '</td><td>' + esc(x.dni || '') + '</td><td>' + esc(x.tramite || '') + '</td><td>' + est + '</td></tr>';
  }).join('');
}
function credLoteStop(){ CRED_LOTE_STOP = true; }
async function credLoteProcesar(){
  if (CRED_LOTE_RUNNING) return;
  CRED_LOTE_RUNNING = true; CRED_LOTE_STOP = false;
  var proc = document.getElementById('credLoteProcBtn'), stop = document.getElementById('credLoteStopBtn'), cargar = document.getElementById('credLoteCargarBtn');
  proc.style.display = 'none'; stop.style.display = ''; cargar.disabled = true;
  document.getElementById('credLoteProgress').style.display = '';
  var total = CRED_LOTE_ROWS.length, done = 0, okN = 0, sinCredN = 0, errN = 0;
  for (var i = 0; i < CRED_LOTE_ROWS.length; i++){
    if (CRED_LOTE_STOP) break;
    var row = CRED_LOTE_ROWS[i];
    if (row.estado === 'ok'){ done++; continue; }
    row.estado = 'procesando'; credLoteRender();
    var res = await req('POST', credBase() + '/procesar-fila',
      { sheetRow: row.sheetRow, benef: row.benef, dni: row.dni, tramite: row.tramite, sexo: row.sexo, nombre: row.nombre });
    if (res.ok && res.data && res.data.ok){ row.estado = 'ok'; row.archivo = res.data.archivo; okN++; }
    else { row.estado = 'error'; row.error = (res.data && res.data.error) || 'falló'; row.definitivo = !!(res.data && res.data.definitivo); if (row.definitivo) sinCredN++; else errN++; }
    done++;
    var pct = Math.round(done / total * 100);
    document.getElementById('credLoteBarFill').style.width = pct + '%';
    document.getElementById('credLoteBarTxt').textContent = done + '/' + total + ' · ' + okN + ' ok · ' + sinCredN + ' sin credencial · ' + errN + ' error';
    credLoteRender();
    await new Promise(function(r){ setTimeout(r, 400); }); // no martillar PAMI
  }
  CRED_LOTE_RUNNING = false;
  stop.style.display = 'none'; cargar.disabled = false;
  proc.style.display = CRED_LOTE_STOP ? '' : 'none';  // si se detuvo, permitir reanudar
  document.getElementById('credLoteBarTxt').textContent += CRED_LOTE_STOP ? ' — detenido' : ' — listo ✅';
}
// ===== Corrida automática diaria (server-side) =====
var CRED_SCHED_POLL = null;
async function credSchedCargar(){
  var r = await req('GET', credBase() + '/schedule');
  if (!r.ok) return;
  var d = r.data || {};
  var chk = document.getElementById('credSchedEnabled'); if (chk) chk.checked = !!d.enabled;
  var hora = document.getElementById('credSchedHora'); if (hora && d.hora) hora.value = d.hora;
  var desde = document.getElementById('credLoteDesde'); if (desde && d.desdeFila) desde.value = d.desdeFila;
  credSchedInfoRender(d);
  credSaludRender(d);
  if (d.corriendo) credSchedPoll();
}
// Tablero de salud: benef (barrido app) + credenciales (web), con estado ✓/⚠/✕.
function credFechaHora(iso){ if (!iso) return ''; try { var d = new Date(iso); return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
function credHorasDesde(iso){ if (!iso) return 999; try { return (Date.now() - new Date(iso).getTime()) / 3600000; } catch (e) { return 999; } }
function credSaludFila(icon, titulo, txt, color, estado){
  var b = color === 'muted' ? '<b class="nom-muted">' + txt + '</b>' : '<b style="color:' + color + '">' + (estado ? estado + ' ' : '') + txt + '</b>';
  return '<div class="cred-salud-fila"><span>' + icon + ' ' + titulo + '</span>' + b + '</div>';
}
function credSaludRender(d){
  var el = document.getElementById('credSalud'); if (!el) return;
  var html = '';
  // 🔎 Benef (barrido de la app)
  var b = d.benefRun;
  if (!b || !b.at) html += credSaludFila('🔎', 'Benef (barrido app)', 'sin corridas aún', 'muted');
  else {
    var recB = credHorasDesde(b.at) < 26, eB = (b.errores || 0), okB = recB && !eB;
    if (b.error) html += credSaludFila('🔎', 'Benef (barrido app)', esc(b.error) + ' · ' + credFechaHora(b.at), 'var(--error)', '✕');
    else if ((b.completados || 0) > 0) html += credSaludFila('🔎', 'Benef (barrido app)', b.completados + ' completados' + (eB ? ' · ' + eB + ' error' : '') + ' · ' + credFechaHora(b.at), okB ? '#0f9d63' : 'var(--warning)', okB ? '✓' : '⚠');
    else html += credSaludFila('🔎', 'Benef (barrido app)', 'recorrió ' + (b.revisadas || 0) + ' · sin benef nuevos' + (eB ? ' · ' + eB + ' error' : '') + ' · ' + credFechaHora(b.at), okB ? '#0f9d63' : 'var(--warning)', okB ? '✓' : '⚠');
  }
  // 🪪 Credenciales (web)
  var c = d.lastRun;
  if (!c || !c.at) html += credSaludFila('🪪', 'Credenciales (web)', 'sin corridas aún', 'muted');
  else {
    var recC = credHorasDesde(c.at) < 26, eC = (c.err || 0), okC = recC && !eC;
    if (c.error) html += credSaludFila('🪪', 'Credenciales (web)', esc(c.error) + ' · ' + credFechaHora(c.at), 'var(--error)', '✕');
    else html += credSaludFila('🪪', 'Credenciales (web)', (c.ok || 0) + ' descargadas' + (eC ? ' · ' + eC + ' error' : '') + ' · ' + credFechaHora(c.at), okC ? '#0f9d63' : 'var(--warning)', okC ? '✓' : '⚠');
  }
  el.innerHTML = html;
}
function credSchedInfoRender(d){
  var el = document.getElementById('credSchedInfo'); if (!el || !d) return;
  if (d.corriendo && d.progreso){
    var pr = d.progreso;
    el.innerHTML = '⏳ Corriendo… <b>' + pr.hechas + '/' + pr.total + '</b> · ' + pr.ok + ' ok · ' + pr.sinCred + ' sin cred · ' + pr.err + ' error';
    return;
  }
  var partes = [];
  partes.push((d.enabled && d.hora) ? ('🕒 Programada todos los días a las <b>' + esc(d.hora) + '</b> (hora Argentina)') : 'Corrida automática apagada');
  if (d.lastRun){
    var lr = d.lastRun, cuando = lr.at ? new Date(lr.at).toLocaleString('es-AR') : '';
    if (lr.error) partes.push('última: ' + esc(cuando) + ' — <span style="color:var(--error)">' + esc(lr.error) + '</span>');
    else partes.push('última: ' + esc(cuando) + ' — <b>' + (lr.ok || 0) + '</b> ok · ' + (lr.sinCred || 0) + ' sin cred · ' + (lr.err || 0) + ' error');
  }
  el.innerHTML = partes.join(' · ');
}
async function credSchedGuardar(){
  var payload = {
    enabled: document.getElementById('credSchedEnabled').checked,
    hora: document.getElementById('credSchedHora').value,
    desdeFila: parseInt(document.getElementById('credLoteDesde').value, 10) || 2
  };
  await req('PUT', credBase() + '/schedule', payload);
  credSchedCargar();
}
async function credCorrerAhora(){
  var btn = document.getElementById('credCorrerBtn'); btn.disabled = true;
  var r = await req('POST', credBase() + '/correr-ahora', {});
  btn.disabled = false;
  if (r.ok && r.data && r.data.ok === false){ nsAlert(r.data.error || 'No se pudo iniciar.'); return; }
  credSchedPoll();
}
function credSchedPoll(){
  if (CRED_SCHED_POLL) clearInterval(CRED_SCHED_POLL);
  CRED_SCHED_POLL = setInterval(async function(){
    var r = await req('GET', credBase() + '/schedule');
    if (!r.ok) return;
    credSchedInfoRender(r.data);
    if (!r.data.corriendo){ clearInterval(CRED_SCHED_POLL); CRED_SCHED_POLL = null; }
  }, 3000);
}
// ---------- ruteo por URL (hash): que F5 recargue la misma sección ----------
// Cada sección refleja su estado en la URL (#nomencladores, #clientes/<slug>).
// Al recargar (F5) se restaura desde el hash, y el botón "atrás" vuelve a andar.
var APPLYING_ROUTE = false;
var SELF_HASH = false;
function pushHash(h){
  if (APPLYING_ROUTE) return;
  if (('#' + h) !== location.hash){ SELF_HASH = true; try { location.hash = h; } catch (e) { SELF_HASH = false; } }
}
function navElFor(v){
  try { return document.querySelector("[onclick*=\"go('" + v + "'\"]"); } catch (e) { return null; }
}
function applyRoute(){
  var parts = (location.hash || '').replace(/^#/, '').split('/').filter(Boolean);
  var v = parts[0] || 'dash';
  if (v === 'gastos') v = 'resumen';  // Gastos ahora es sub-pestaña de Resumen de cuenta
  if (['dash', 'clientes', 'nomencladores', 'informes', 'omeweb', 'credencial', 'resumen', 'facturas', 'padron', 'cabina', 'liberarcupo', 'cruzas', 'soon'].indexOf(v) < 0) v = 'dash';
  APPLYING_ROUTE = true;
  go(v, navElFor(v));
  APPLYING_ROUTE = false;
  if (v === 'informes'){ var t = parts[1]; setInformesTab(['generar', 'lote', 'config'].indexOf(t) >= 0 ? t : 'generar'); }
  if (v === 'clientes' && parts[1]) selectClientWhenReady(parts[1], parts[2]);
}
// Solapas del cliente + herramientas de NS que el operador abre adentro del
// cliente (cabina/padron/…): las dos cosas viajan igual en el hash.
var CLIENT_SECCIONES_HASH = ['mescurso', 'basica', 'dashboard', 'reportes', 'medicos', 'general', 'pendientes',
  'plansalud', 'honorarios', 'credencialcli', 'usuarioscli', 'cabina', 'padron', 'informes', 'omeweb', 'liberarcupo'];
function selectClientWhenReady(slug, section, tries){
  tries = tries || 0;
  if (typeof CLIENTS !== 'undefined' && CLIENTS && CLIENTS.length){
    if (CLIENTS.filter(function(c){ return c.slug === slug; })[0]){
      APPLYING_ROUTE = true;
      selectClient(slug);
      if (section && CLIENT_SECCIONES_HASH.indexOf(section) >= 0) setClientSection(section);
      APPLYING_ROUTE = false;
    }
    return;
  }
  if (tries < 40) setTimeout(function(){ selectClientWhenReady(slug, section, tries + 1); }, 100);
}
window.addEventListener('hashchange', function(){
  if (SELF_HASH){ SELF_HASH = false; return; }  // cambio que ya aplicamos nosotros
  if (document.body.classList.contains('authed')) applyRoute();  // back/forward
});

function openDrawer(){
  document.getElementById('drawer').classList.add('show'); document.getElementById('scrim').classList.add('show'); iniRenderDrawer();
  var refrescar = (ME && ME.role === 'operador_clinica') ? opClinicaRefrescarBell : iniRefrescarBell;
  if (typeof refrescar === 'function') refrescar().then(function(){ iniRenderDrawer(); });
}
function closeDrawer(){ document.getElementById('drawer').classList.remove('show'); document.getElementById('scrim').classList.remove('show'); }

// ---------- Informes: generar PDF de un paciente y descargarlo ----------
var INF_BLOB = null; // { url, filename } del último informe generado
// Núcleo compartido: valida, pide el PDF y devuelve { blob, fname } o null.
async function pedirInformePdf(){
  var err = document.getElementById('infError'); err.textContent = '';
  var nombre = document.getElementById('infNombre').value.trim();
  var benef = document.getElementById('infBenef').value.trim();
  var fecha = document.getElementById('infFecha').value.trim();
  var faltan = [];
  if (!nombre) faltan.push('el nombre');
  if (!benef) faltan.push('el N° de beneficiario');
  if (!fecha) faltan.push('la fecha');
  faltan = faltan.concat(camposObligatoriosFaltantes());
  if (faltan.length){ err.textContent = 'Falta completar ' + faltan.join(', ') + '.'; return null; }
  var b2 = document.getElementById('infDescargarDirecto');
  if (b2) b2.disabled = true;
  try {
    var r = await fetch('/api/informes/generar', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(construirPayloadInforme()) });
    if (!r.ok){ var d = {}; try { d = await r.json(); } catch (e) {} err.textContent = (d && d.error) || 'No se pudo generar el informe.'; return null; }
    var blob = await r.blob();
    var cd = r.headers.get('content-disposition') || '';
    var m = cd.match(/filename="([^"]+)"/);
    return { blob: blob, fname: m ? m[1] : 'informe.pdf' };
  } catch (e) {
    err.textContent = 'No se pudo generar el informe (error de conexión).';
    return null;
  } finally { if (b2) b2.disabled = false; }
}
function construirPayloadInforme(){
  return {
    modelo: document.getElementById('infPractica').value,
    clienteSlug: document.getElementById('infCentro').value,
    paciente: {
      nombre: document.getElementById('infNombre').value.trim(),
      benef: document.getElementById('infBenef').value.trim(),
      fecha: document.getElementById('infFecha').value.trim(),
      documento: document.getElementById('infDoc').value.trim(),
      sexo: ((document.getElementById('infSexoPac') || {}).value || '').trim(),
      cobertura: ((document.getElementById('infCobertura') || {}).value || '').trim(),
    },
    textoInforme: (document.getElementById('infTexto') || {}).value || '',
    estudio: ((document.getElementById('infEstudio') || {}).value || '').trim(),
    valores: recolectarCampos(),
    medicoId: document.getElementById('infMedico').value,
  };
}
// ---- Vista previa en vivo (mientras se completa el formulario) ----
var PREVIEW_TIMER = null, PREVIEW_SEQ = 0;
function programarPreviewVivo(){ try { renderAvisosUro(); } catch(e){} clearTimeout(PREVIEW_TIMER); PREVIEW_TIMER = setTimeout(actualizarPreviewVivo, 500); }
// Aplica los defaults que dependen del sexo (posición, diagnóstico) según el preset
// elegido. Los valores numéricos NO cambian con el sexo. Se llama al aplicar un
// preset y cada vez que se cambia el sexo. Solo pisa los campos que el preset
// define por sexo, respetando el resto.
function aplicarDefaultsPorSexo(){
  var preset = presetById((document.getElementById('infDescripcion') || {}).value);
  if (!preset) return;
  var sexoEl = document.querySelector('#infCampos [data-key="sexo"]');
  var sx = String(sexoEl && sexoEl.value || '').trim().toLowerCase(); // masculino/femenino/otro
  if (!sx) return;
  // Texto del informe por sexo (la posición: Pte parado / Pte sentada).
  var txt = document.getElementById('infTexto');
  if (txt && preset.textoPorSexo && preset.textoPorSexo[sx]){ txt.value = preset.textoPorSexo[sx]; autoGrow(txt); }
  // Campos por sexo (el diagnóstico clínico).
  var over = (preset.valoresPorSexo && preset.valoresPorSexo[sx]) || null;
  if (over) Object.keys(over).forEach(function(k){
    var inp = document.querySelector('#infCampos [data-key="' + k + '"]');
    if (inp) inp.value = over[k];
  });
}
// Cambió el sexo: recargar posición/diagnóstico del preset y refrescar la vista.
function onInformeSexoChange(){ poblarPresetsInforme(); aplicarDefaultsPorSexo(); programarPreviewVivo(); }
// Sexo elegido en el form (normalizado), leído del campo dinámico de #infCampos.
function _sexoInformeActual(){
  var el = document.querySelector('#infCampos [data-key="sexo"]');
  var s = el ? String(el.value || '').toLowerCase() : '';
  return s.indexOf('masc') === 0 ? 'masculino' : s.indexOf('fem') === 0 ? 'femenino' : '';
}
// Puebla el desplegable de presets del modelo actual, y —si los presets traen
// valores.sexo (urodinamia M1-M8 / F1-F8)— filtra por el sexo elegido.
function poblarPresetsInforme(){
  var key = modeloActualKey();
  var desc = document.getElementById('infDescripcion');
  if (!desc) return;
  var prevD = desc.value;
  // Acotado al centro elegido arriba en el form: hay prácticas con una redacción
  // por centro (el venoso de MMII). Sin centros asignados = sirve para todos.
  var cliSel = (document.getElementById('infCentro') || {}).value || '';
  var todos = (INFORMES_CFG.descripciones || []).filter(function(d){ return scopeAplica(d.modelos, key) && scopeAplica(d.clientes, cliSel); });
  var tienenSexo = todos.some(function(d){ return d.valores && d.valores.sexo; });
  var sx = _sexoInformeActual();
  var nsx = function(s){ s = String(s || '').toLowerCase(); return s.indexOf('masc') === 0 ? 'masculino' : s.indexOf('fem') === 0 ? 'femenino' : ''; };
  var rs = (tienenSexo && sx) ? todos.filter(function(d){ var ps = nsx(d.valores && d.valores.sexo); return !ps || ps === sx; }) : todos;
  desc.innerHTML = rs.map(function(d){ return opt(d.id, presetLabel(d)); }).join('') + opt('__custom__', 'Texto personalizado');
  if (prevD && rs.some(function(d){ return d.id === prevD; })) desc.value = prevD;
}
async function actualizarPreviewVivo(){
  var frame = document.getElementById('infLiveFrame'), ph = document.getElementById('infLivePlaceholder');
  if (!frame) return;
  var panel = document.getElementById('infPreviewLive');
  if (panel && panel.offsetParent === null) return; // panel oculto (mobile / otra pestaña): no generamos
  var nombre = document.getElementById('infNombre').value.trim();
  var benef = document.getElementById('infBenef').value.trim();
  var fecha = document.getElementById('infFecha').value.trim();
  // Sin datos base o con obligatorios vacíos (ej. Sexo), no mostramos vista previa.
  if (!nombre || !benef || !fecha || camposObligatoriosFaltantes().length){ frame.style.display = 'none'; if (ph) ph.style.display = ''; return; }
  var seq = ++PREVIEW_SEQ;
  try {
    var r = await fetch('/api/informes/generar', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(construirPayloadInforme()) });
    if (seq !== PREVIEW_SEQ) return;          // respuesta vieja: la ignoramos
    if (!r.ok) return;
    var blob = await r.blob();
    if (seq !== PREVIEW_SEQ) return;
    if (INF_BLOB && INF_BLOB.url) URL.revokeObjectURL(INF_BLOB.url);
    var url = URL.createObjectURL(blob);
    var cd = r.headers.get('content-disposition') || ''; var m = cd.match(/filename="([^"]+)"/);
    INF_BLOB = { url: url, filename: m ? m[1] : 'informe.pdf' };
    frame.src = url + '#toolbar=0&navpanes=0&view=FitH';
    frame.style.display = 'block'; if (ph) ph.style.display = 'none';
  } catch (e) { /* en preview no molestamos con errores */ }
}
function bajarBlob(blob, fname){
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
}
// "Descargar PDF": genera y baja el informe.
async function descargarInformeDirecto(){
  // Urodinamia: pantalla de revisión final obligatoria antes de generar/firmar.
  if (modeloActualKey() === 'urodinamia'){ if (!await revisarUrodinamia()) return; }
  var r = await pedirInformePdf(); if (!r) return;
  bajarBlob(r.blob, r.fname);
}
// ---------- Informes: cascada Centro → Especialidad → Práctica + config ----------
var INFORMES_CFG = { modelos: [], medicos: [], descripciones: [] };
function uniq(arr){ var out = [], seen = {}; (arr || []).forEach(function(x){ if (x && !seen[x]){ seen[x] = 1; out.push(x); } }); return out; }
function opt(v, txt, sel){ return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(txt) + '</option>'; }
async function loadInformesConfig(){
  var res = await api('/api/informes/config');
  if (res.ok && res.data) INFORMES_CFG = res.data;
  llenarCentros();
  renderInformesConfigLists();
}
// El primer desplegable es el CLIENTE (antes era un "Centro" fijo por
// modelo). Los modelos ya no son por cliente — cualquier práctica sirve para
// cualquier cliente — así que Especialidad/Práctica ya no se filtran por acá:
// lo único que cambia con el cliente elegido es qué médicos aparecen
// (filtrarPorModelo) y el membrete del PDF (logo/dirección/teléfono).
function llenarCentros(){
  var sel = document.getElementById('infCentro'); if (!sel) return;
  var prev = sel.value;
  var clientes = INFORMES_CFG.clientes || [];
  sel.innerHTML = clientes.map(function(c){ return opt(c.slug, c.name); }).join('') || '<option value="">(sin clientes)</option>';
  if (prev && clientes.some(function(c){ return c.slug === prev; })) sel.value = prev;
  onCentroChange(true);
}
// Un médico de cabecera (Scheffelaar/Dubesarky) no es una clínica: la cascada
// Especialidad/Práctica de abajo (pensada para consultorios con varias
// especialidades) no le corresponde. Todavía no hay un flujo propio para
// generarle informes, así que por ahora se avisa en vez de mostrar el
// formulario armado para otro tipo de cliente.
function infClienteEsMedCab(slug){
  var c = (INFORMES_CFG.clientes || []).find(function(x){ return x.slug === slug; });
  return !!(c && c.tipo === 'med_cabecera');
}
function onCentroChange(keep){
  var slug = (document.getElementById('infCentro') || {}).value || '';
  var esMedCab = infClienteEsMedCab(slug);
  var aviso = document.getElementById('infMedCabAviso');
  var resto = document.getElementById('infFormResto');
  var preview = document.getElementById('infPreviewLive');
  if (aviso) aviso.style.display = esMedCab ? '' : 'none';
  // El Cliente vive dentro del form (arriba de Especialidad). Para médico de
  // cabecera escondemos SOLO el resto del form y la vista previa, no el layout,
  // así el selector Cliente sigue visible para poder cambiarlo.
  if (resto) resto.style.display = esMedCab ? 'none' : '';
  // preview: '' limpia el inline y deja que la media query (oculto en mobile) mande.
  if (preview) preview.style.display = esMedCab ? 'none' : '';
  if (esMedCab) return;
  // El Cliente ahora vive fuera de #infFormCard (queda visible siempre), así
  // que cambiarlo ya no dispara programarPreviewVivo() por burbujeo - se llama
  // a mano acá (afecta el membrete/logo de la vista previa).
  programarPreviewVivo();
  var sel = document.getElementById('infEspecialidad'); if (!sel) return;
  var prev = keep === true ? sel.value : '';
  var esps = uniq((INFORMES_CFG.modelos || []).map(function(m){ return m.especialidad; }));
  sel.innerHTML = esps.map(function(e){ return opt(e, e); }).join('') || '<option value="">(sin especialidades)</option>';
  if (prev && esps.indexOf(prev) >= 0) sel.value = prev;
  onEspecialidadChange(keep);
}
function onEspecialidadChange(keep){
  var esp = (document.getElementById('infEspecialidad') || {}).value || '';
  var sel = document.getElementById('infPractica'); if (!sel) return;
  var prev = keep === true ? sel.value : '';
  var ms = (INFORMES_CFG.modelos || []).filter(function(m){ return m.especialidad === esp; });
  sel.innerHTML = ms.map(function(m){ return opt(m.key, m.practica); }).join('') || '<option value="">(sin prácticas)</option>';
  if (prev && ms.some(function(m){ return m.key === prev; })) sel.value = prev;
  filtrarPorModelo();
}
function modeloActualKey(){ return (document.getElementById('infPractica') || {}).value || ''; }
// Un scope vacío = disponible para cualquier informe.
function scopeAplica(arr, key){ return !arr || arr.length === 0 || (key && arr.indexOf(key) >= 0); }
function modeloCampos(key){
  var m = (INFORMES_CFG.modelos || []).find(function(x){ return x.key === key; });
  return (m && m.campos) || [];
}
function modeloRequiereLado(key){
  var m = (INFORMES_CFG.modelos || []).find(function(x){ return x.key === key; });
  return !!(m && m.requiereLado);
}
// Campo Sexo del modelo (desplegable), si lo tiene. Para el lote.
function modeloSexoCampo(key){
  return modeloCampos(key).find(function(c){ return c.key === 'sexo' && c.tipo === 'select'; }) || null;
}
function modeloRequiereSexo(key){ var c = modeloSexoCampo(key); return !!(c && c.requerido); }
function presetById(id){ return (INFORMES_CFG.descripciones || []).find(function(d){ return d.id === id; }); }
function presetLabel(d){ if (d.nombre) return d.nombre; var t = String(d.texto || ''); return t.length > 60 ? t.slice(0, 58) + '…' : t; }
// HTML de un campo suelto (label + input/select). Reusado por el render plano
// y por el agrupado del Holter.
function _campoInputHTML(c){
  var req = c.requerido ? ' data-req="1"' : '';
  var control;
  if (c.tipo === 'select' && Array.isArray(c.opciones)){
    var opts = '';
    // Obligatorio sin default: arranca vacío ("Elegí…") para forzar la elección.
    if (c.requerido && !(c.default || '')) opts += '<option value="">Elegí…</option>';
    opts += c.opciones.map(function(o){ return opt(o, o, o === (c.default || '')); }).join('');
    // El sexo dispara la recarga de posición/diagnóstico por sexo.
    var hook = c.key === 'sexo' ? ' onchange="onInformeSexoChange()"' : '';
    control = '<select class="inp" data-key="' + esc(c.key) + '"' + req + hook + '>' + opts + '</select>';
  } else {
    control = '<input class="inp" data-key="' + esc(c.key) + '"' + req + ' value="' + esc(c.default || '') + '" spellcheck="false">';
  }
  return '<label class="inf-campo' + (c.wide ? ' inf-wide' : '') + '"><span>' + esc(c.label) + (c.requerido ? ' <b style="color:var(--error)">*</b>' : '') + '</span>' + control + '</label>';
}
// Secciones plegables del Holter (orden + título + si abre por defecto).
// "Resumen" y "Conclusión" abren; el detalle arranca colapsado (se abre solo
// cuando hay ectopia cargada, ver ajustarSeccionesHolter).
var HOLTER_GRUPOS_META = [
  { id: 'resumen', titulo: 'Resumen', open: true },
  { id: 'general', titulo: 'Datos generales', open: false },
  { id: 'ventricular', titulo: 'Detalle ventricular', open: false },
  { id: 'supraventricular', titulo: 'Detalle supraventricular', open: false },
  { id: 'st', titulo: 'ST / QT', open: false },
  { id: 'vfc', titulo: 'VFC (avanzado)', open: false },
  { id: 'conclusion', titulo: 'Conclusión / observaciones', open: true },
];
// Títulos de las secciones de TODOS los modelos con campos agrupados (no solo
// Holter). El ecodoppler venoso de MMII se carga por lado, así que abre las dos
// secciones: hay que completar las dos piernas, esconder una invita a olvidarla.
var CAMPOS_GRUPOS_META = HOLTER_GRUPOS_META.concat([
  { id: 'ladoDer', titulo: 'Miembro inferior derecho', open: true },
  { id: 'ladoIzq', titulo: 'Miembro inferior izquierdo', open: true },
  { id: 'obs', titulo: 'Observaciones', open: true },
  { id: 'vejiga', titulo: 'Vejiga', open: true },
  { id: 'prostata', titulo: 'Próstata', open: true },
]);
// Secciones a dibujar, EN EL ORDEN EN QUE APARECEN LOS CAMPOS del modelo (antes
// se recorría la lista fija del Holter, así que los grupos de cualquier otro
// modelo caían todos juntos en un "Otros"). El título sale de la meta; lo que no
// esté declarado arranca abierto.
function gruposDeCampos(campos){
  var ids = [];
  campos.forEach(function(c){ var g = c.grupo || ''; if (g && ids.indexOf(g) < 0) ids.push(g); });
  return ids.map(function(id){
    var m = CAMPOS_GRUPOS_META.find(function(x){ return x.id === id; }) || {};
    return { id: id, titulo: m.titulo || id, open: m.open !== false };
  });
}
// Renderiza los campos técnicos del modelo (ej. Holter) con sus defaults.
// Si los campos traen `grupo` (Holter), se arma en secciones plegables; si no,
// va la grilla plana de siempre (resto de los modelos).
function renderCampos(key){
  var wrap = document.getElementById('infCamposWrap'), box = document.getElementById('infCampos');
  if (!wrap || !box) return;
  var campos = modeloCampos(key);
  if (!campos.length){ wrap.style.display = 'none'; box.innerHTML = ''; box.className = 'inf-campos'; return; }
  var agrupado = campos.some(function(c){ return c.grupo; });
  if (agrupado){
    box.className = 'inf-grupos';
    var html = '';
    var grupos = gruposDeCampos(campos);
    grupos.forEach(function(g){
      var items = campos.filter(function(c){ return (c.grupo || '') === g.id; });
      if (!items.length) return;
      html += '<details class="inf-grupo"' + (g.open ? ' open' : '') + ' data-grupo="' + esc(g.id) + '">'
        + '<summary>' + esc(g.titulo) + '</summary>'
        + '<div class="inf-campos">' + items.map(_campoInputHTML).join('') + '</div>'
        + '</details>';
    });
    // Defensivo: los campos SIN grupo (en un modelo que sí agrupa) van al final.
    var restantes = campos.filter(function(c){ return !grupos.some(function(g){ return g.id === (c.grupo || ''); }); });
    if (restantes.length) html += '<details class="inf-grupo" open><summary>Otros</summary><div class="inf-campos">' + restantes.map(_campoInputHTML).join('') + '</div></details>';
    box.innerHTML = html;
  } else {
    box.className = 'inf-campos';
    box.innerHTML = campos.map(_campoInputHTML).join('');
  }
  wrap.style.display = '';
}
// Abre las secciones de detalle cuando el preset/valores indican actividad
// (EV>0 → ventricular; ESV o TSV>0 → supraventricular). No cierra nada que el
// operador haya dejado abierto: solo abre.
function ajustarSeccionesHolter(){
  if (modeloActualKey() !== 'holter') return;
  var v = recolectarCampos();
  var abrir = function(gid){ var d = document.querySelector('#infCampos details[data-grupo="' + gid + '"]'); if (d) d.open = true; };
  if (_holterNum(v.ev) > 0) abrir('ventricular');
  if (_holterNum(v.esv) > 0 || _holterNum(v.tsv) > 0) abrir('supraventricular');
}
// Al elegir un preset: llena el texto del informe y pisa los valores estándar.
function aplicarPreset(){
  var key = modeloActualKey();
  renderCampos(key);
  var preset = presetById((document.getElementById('infDescripcion') || {}).value);
  var txt = document.getElementById('infTexto');
  if (txt && preset){
    var texto = preset.texto || '';
    // Prácticas con lado (ORL): el preset trae variantes por lado.
    if (modeloRequiereLado(key) && preset.ladoTextos){
      var lado = (document.getElementById('infLado') || {}).value || 'noesp';
      if (preset.ladoTextos[lado]) texto = preset.ladoTextos[lado];
    }
    txt.value = texto;
    autoGrow(txt);
  }
  // El preset puede fijar el "Estudio solicitado" y el médico que firma.
  if (preset){
    var estEl = document.getElementById('infEstudio');
    if (estEl && preset.estudio) estEl.value = preset.estudio;
    var medEl = document.getElementById('infMedico');
    if (medEl && preset.medicoId){
      var existe = Array.prototype.some.call(medEl.options, function(o){ return o.value === preset.medicoId; });
      if (existe) medEl.value = preset.medicoId;
    }
  }
  var valores = (preset && preset.valores) || {};
  document.querySelectorAll('#infCampos [data-key]').forEach(function(inp){
    var k = inp.getAttribute('data-key');
    if (valores[k] != null && String(valores[k]).trim() !== '') inp.value = valores[k];
  });
  aplicarDefaultsPorSexo();   // posición/diagnóstico según el sexo elegido
  ajustarSeccionesHolter();   // abre el detalle si el preset trae ectopia
  programarPreviewVivo();
}
// El textarea del informe crece solo con el contenido (arranca chico).
function autoGrow(el){ if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
function recolectarCampos(){
  var v = {};
  document.querySelectorAll('#infCampos [data-key]').forEach(function(inp){
    var val = String(inp.value || '').trim();
    if (val) v[inp.getAttribute('data-key')] = val;
  });
  return v;
}
// ===== Urodinamia: validaciones de coherencia (AVISOS, no cambian el diagnóstico) =====
function _numUro(v){ var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : null; }
function avisosUrodinamia(v){
  v = v || {}; var a = [];
  var qmax = _numUro(v.qmax); if (qmax != null && qmax < 15) a.push('Qmax por debajo del valor de referencia (> 15 ml/s).');
  var rpm = _numUro(v.rpm); if (rpm != null && rpm >= 50) a.push('Residuo postmiccional elevado (RPM ≥ 50 ml).');
  var cap = _numUro(v.capacidad);
  if (cap != null && cap < 350) a.push('Capacidad cistométrica disminuida (< 350 ml).');
  if (cap != null && cap > 600) a.push('Capacidad cistométrica aumentada (> 600 ml).');
  var pd = _numUro(v.primerDeseo);
  if (pd != null && pd < 150) a.push('Primer deseo miccional precoz (< 150 ml).');
  if (pd != null && pd > 250) a.push('Primer deseo tardío / sensibilidad disminuida (> 250 ml).');
  var pdet = _numUro(v.pdetMax); if (pdet != null && pdet > 60) a.push('Presión detrusoral elevada durante el vaciado (> 60 cm H2O).');
  var vlpp = _numUro(v.vlpp); if (vlpp != null && vlpp > 0 && vlpp < 60) a.push('VLPP disminuido (< 60 cm H2O).');
  return a;
}
// ===== Holter: avisos de coherencia (NO cambian valores ni texto) =====
// Parser tolerante: "1.284"→1284, "0,11%"→0.11, "<0,01%"→0.01, "6"→6, ""→null.
function _holterNum(v){
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  var d = s.replace(/[^0-9.,]/g, '').replace(/\./g, '').replace(',', '.');
  var n = parseFloat(d);
  return isFinite(n) ? n : null;
}
// ¿La conclusión afirma (en positivo, sin negación) algo que matchea `re`?
// Parte por oraciones para no confundir "NO SE OBSERVARON…" con una afirmación.
function _holterAfirma(texto, re){
  return String(texto || '').split(/[.\n]+/).some(function(s){
    return re.test(s) && !/\bno\b|\bsin\b/i.test(s);
  });
}
function avisosHolter(v, texto){
  v = v || {}; var a = [];
  var ev = _holterNum(v.ev), esv = _holterNum(v.esv), tsv = _holterNum(v.tsv), pausas = _holterNum(v.pausas);
  if (ev === 0 && _holterAfirma(texto, /extras[íi]stole\w*\s+ventricular|\bEV\b/i))
    a.push('EV en 0, pero la conclusión menciona extrasístoles ventriculares.');
  if (esv === 0 && _holterAfirma(texto, /extras[íi]stole\w*\s+supraventricular|supraventricular|\bESV\b/i))
    a.push('ESV en 0, pero la conclusión menciona extrasístoles supraventriculares.');
  if (pausas === 0 && _holterAfirma(texto, /pausas?\s+significativ/i))
    a.push('Pausas en 0, pero la conclusión menciona pausas significativas.');
  var salva = String(v.salvaLatidos || '').trim() || String(v.salvaFcMax || '').trim();
  if (tsv === 0 && salva)
    a.push('Hay una salva cargada (latidos/FC), pero TSV/salvas figura en 0.');
  return a;
}
// ===== Vesicoprostática: avisos de coherencia (NO cambian nada) =====
// Comparan lo cargado en los campos contra lo que dice el texto del informe y la
// conclusión. Solo avisan: el que firma decide. La idea es agarrar el copiar y
// pegar de un preset que quedó diciendo algo que los valores no respaldan.
function avisosVesicoprostatica(v, texto){
  v = v || {}; var a = [];
  var todo = String(texto || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  var dice = function(re){ return re.test(todo); };
  var rpm = String(v.vejRpm || '').trim().toLowerCase();
  if ((rpm === 'no evaluado' || rpm === '') && dice(/RESIDUO POSTMICCIONAL\s*:?\s*\d|RPM\s*:?\s*\d|RESIDUO (NORMAL|AUMENTADO)/))
    a.push('El residuo postmiccional figura sin evaluar, pero el informe habla de un residuo.');
  if (String(v.vejEndoluminales || '') === 'No' && dice(/IMAGEN(ES)? ENDOLUMINAL|LESION(ES)? ENDOLUMINAL/) && !dice(/SIN (EVIDENCIA DE )?(LESIONES|IMAGENES)[^.]*ENDOLUMINAL|NO SE (IDENTIFICAN|OBSERVAN)[^.]*ENDOLUMINAL/))
    a.push('Imágenes endoluminales en "No", pero el informe menciona una lesión endoluminal.');
  if (String(v.proTamano || '') === 'Normal' && dice(/PROSTATOMEGALIA|AUMENTADA DE TAMANO|MARCADAMENTE AUMENTAD/))
    a.push('La próstata figura de tamaño conservado, pero el informe habla de prostatomegalia o de aumento de tamaño.');
  if (String(v.proImpronta || '') === 'No' && dice(/IMPRONTA/))
    a.push('Impronta sobre piso vesical en "No", pero el informe la menciona.');
  if (String(v.proCalcificaciones || '') === 'No' && dice(/CALCIFICACION/))
    a.push('Calcificaciones en "No", pero el informe las menciona.');
  if (String(v.vejReplecion || '') === 'Escasa' && !dice(/ESCASA REPLECION|LIMITA|LIMITAD/))
    a.push('La repleción es escasa: conviene aclarar que la valoración vesical queda parcialmente limitada.');
  return a;
}
// Panel de avisos en vivo bajo los campos (urodinamia y holter comparten el
// contenedor #infAvisosUro; el resto de los modelos no muestra nada).
function renderAvisosUro(){
  var wrap = document.getElementById('infAvisosUro'); if (!wrap) return;
  var key = modeloActualKey(), a = [];
  if (key === 'urodinamia') a = avisosUrodinamia(recolectarCampos());
  else if (key === 'holter') a = avisosHolter(recolectarCampos(), (document.getElementById('infTexto') || {}).value || '');
  else if (key === 'eco-vesicoprostatica'){
    // Mira el informe Y la conclusión: la incoherencia suele quedar en la conclusión.
    var vv = recolectarCampos();
    a = avisosVesicoprostatica(vv, ((document.getElementById('infTexto') || {}).value || '') + ' ' + (vv.conclusion || ''));
  }
  if (!a.length){ wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
  wrap.style.display = '';
  wrap.innerHTML = '<div class="inf-avisos-tit">⚠ Revisá la coherencia (son avisos, no cambian el diagnóstico):</div><ul class="inf-avisos-list">'
    + a.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
}
// Pantalla de revisión final: muestra todos los valores + conclusión + avisos y
// exige confirmar antes de generar/firmar. Resuelve true/false.
function revisarUrodinamia(){
  return new Promise(function(resolve){
    var campos = (INFORMES_CFG.modelos || []).find(function(m){ return m.key === 'urodinamia'; });
    var defs = (campos && campos.campos) || [];
    var v = recolectarCampos();
    var pac = {
      nombre: (document.getElementById('infNombre') || {}).value || '',
      doc: (document.getElementById('infDoc') || {}).value || '',
      benef: (document.getElementById('infBenef') || {}).value || '',
      fecha: (document.getElementById('infFecha') || {}).value || '',
    };
    var texto = (document.getElementById('infTexto') || {}).value || '';
    var filas = defs.filter(function(d){ return String(v[d.key] || '').trim() !== ''; })
      .map(function(d){ return '<div class="rev-kv"><span>' + esc(d.label) + '</span><b>' + esc(v[d.key]) + '</b></div>'; }).join('');
    var av = avisosUrodinamia(v);
    var avHtml = av.length ? '<div class="rev-avisos"><b>⚠ Avisos de coherencia</b><ul>' + av.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '';
    var scrim = document.createElement('div'); scrim.className = 'mc-inf-scrim';
    scrim.innerHTML =
      '<div class="mc-inf-box" style="max-width:640px;max-height:86vh;display:flex;flex-direction:column">'
      + '<div class="mc-inf-head"><b>Revisión final del informe</b><span class="mc-inf-sub">' + esc(pac.nombre || '—') + (pac.fecha ? ' · ' + esc(pac.fecha) : '') + ' · Estudio urodinámico completo</span></div>'
      + '<div class="mc-inf-body" style="overflow:auto">'
      + avHtml
      + '<div class="rev-sec">Datos del estudio</div>'
      + '<div class="rev-grid">' + (filas || '<span class="nom-muted">Sin valores cargados.</span>') + '</div>'
      + '<div class="rev-sec">Conclusión / resumen</div><div class="rev-texto">' + (texto ? esc(texto).replace(/\n/g, '<br>') : '<span class="nom-muted">—</span>') + '</div>'
      + '<div class="rev-nota">Revisá que los valores y la conclusión sean correctos. El informe lo firma el médico responsable.</div>'
      + '</div>'
      + '<div class="mc-inf-foot"><button class="mc-inf-btn" id="rev-cancel">Volver a editar</button>'
      + '<button class="mc-inf-btn primary" id="rev-ok">✓ Confirmar y generar</button></div></div>';
    document.body.appendChild(scrim);
    var done = function(val){ scrim.remove(); resolve(val); };
    scrim.addEventListener('click', function(e){ if (e.target === scrim) done(false); });
    scrim.querySelector('#rev-cancel').onclick = function(){ done(false); };
    scrim.querySelector('#rev-ok').onclick = function(){ done(true); };
  });
}
// Campos obligatorios del modelo (data-req) que quedaron vacíos → sus etiquetas.
function camposObligatoriosFaltantes(){
  var faltan = [];
  document.querySelectorAll('#infCampos [data-req="1"]').forEach(function(inp){
    if (!String(inp.value || '').trim()){
      var lbl = inp.closest('.inf-campo');
      var span = lbl && lbl.querySelector('span');
      faltan.push(span ? span.textContent.replace('*', '').trim() : inp.getAttribute('data-key'));
    }
  });
  return faltan;
}
function filtrarPorModelo(){
  var key = modeloActualKey();
  poblarPresetsInforme();
  var med = document.getElementById('infMedico');
  if (med){
    var prevM = med.value;
    var clienteSel = (document.getElementById('infCentro') || {}).value || '';
    // Solo médicos que firman esta práctica Y que están cargados para este cliente
    // (vacío en cualquiera de las dos listas = disponible para todos).
    var ms = (INFORMES_CFG.medicos || []).filter(function(m){ return scopeAplica(m.modelos, key) && scopeAplica(m.clientes, clienteSel); });
    med.innerHTML = ms.map(function(m){ return opt(m.id, m.nombre + (m.hasFirma ? '' : ' (sin firma)')); }).join('')
      + opt('', 'Sin firma (deja el espacio)');
    if (prevM) med.value = prevM;
  }
  var ladoWrap = document.getElementById('infLadoWrap');
  if (ladoWrap) ladoWrap.style.display = modeloRequiereLado(key) ? '' : 'none';
  var m = (INFORMES_CFG.modelos || []).find(function(x){ return x.key === key; }) || {};
  // Sexo del paciente: se oculta si el modelo ya tiene su propio campo de sexo
  // (ej. urodinamia lo usa para filtrar presets); para el resto (Holter, etc.) va.
  var sexWrap = document.getElementById('infSexoPacWrap');
  if (sexWrap) sexWrap.style.display = (m.campos || []).some(function(c){ return c.key === 'sexo'; }) ? 'none' : '';
  // Cobertura (default PAMI) solo en modelos que la piden.
  var cobWrap = document.getElementById('infCoberturaWrap');
  if (cobWrap){
    cobWrap.style.display = m.mostrarCobertura ? '' : 'none';
    var cob = document.getElementById('infCobertura');
    if (m.mostrarCobertura && cob && !cob.value.trim()) cob.value = 'PAMI';
  }
  // Estudio solicitado editable (lo pisa el preset) solo donde corresponde.
  var estWrap = document.getElementById('infEstudioWrap');
  if (estWrap){
    estWrap.style.display = m.estudioEditable ? '' : 'none';
    var estLbl = document.getElementById('infEstudioLabel');
    if (estLbl) estLbl.textContent = (m.estudioLabel || 'Estudio solicitado:').replace(/:$/, '');
    var est = document.getElementById('infEstudio');
    if (m.estudioEditable && est && !est.value.trim()) est.value = m.estudio || '';
  }
  aplicarPreset();
}
function setInformesTab(tab){
  var secc = { generar: 'inf-tab-generar', lote: 'inf-tab-lote', config: 'inf-tab-config' };
  var btns = { generar: 'infTabGenerar', lote: 'infTabLote', config: 'infTabConfig' };
  Object.keys(secc).forEach(function(k){
    var s = document.getElementById(secc[k]); if (s) s.style.display = (k === tab) ? '' : 'none';
    var b = document.getElementById(btns[k]); if (b) b.classList.toggle('active', k === tab);
  });
  if (tab === 'lote') loteInit();
  if (tab === 'generar') programarPreviewVivo();
  pushHash('informes/' + tab);
}
function renderInformesConfigLists(){
  var isAdmin = ME && ME.role === 'admin';
  var tabBtn = document.getElementById('infTabConfig');
  if (tabBtn) tabBtn.style.display = isAdmin ? '' : 'none';
  if (!isAdmin){ setInformesTab('generar'); return; }
  var modelos = INFORMES_CFG.modelos || [];
  var clientesList = INFORMES_CFG.clientes || [];
  // Lo usan las dos listas (médicos y resultados), así que va acá y no adentro
  // del bloque de médicos.
  var cliNombre = {}; clientesList.forEach(function(c){ cliNombre[c.slug] = c.name; });
  var cm = document.getElementById('infMedicosCount'); if (cm) cm.textContent = '(' + (INFORMES_CFG.medicos || []).length + ')';
  var cd = document.getElementById('infDescripcionesCount'); if (cd) cd.textContent = '(' + (INFORMES_CFG.descripciones || []).length + ')';
  var ml = document.getElementById('infMedicosList');
  if (ml){
    var meds = INFORMES_CFG.medicos || [];
    var modeloDeMed = {}; modelos.forEach(function(mm){ modeloDeMed[mm.key] = mm; });
    var espsDe = function(m){ return uniq((m.modelos || []).map(function(k){ return (modeloDeMed[k] || {}).especialidad; }).filter(Boolean)); };
    // HTML de UN médico (mismos controles: firma, informes que firma, clientes, borrar).
    function medItemHtml(m){
      var tag = m.hasFirma ? '<span class="cfg-tag on">firma ✓</span>' : '<span class="cfg-tag off">sin firma</span>';
      var fila = '<div class="cfg-row"><span class="cfg-name">' + esc(m.nombre) + '</span>' + tag
        + '<label class="cfg-upload">' + (m.hasFirma ? 'Cambiar' : 'Subir') + ' firma<input type="file" accept="image/png" onchange="uploadFirmaMedico(\'' + esc(m.id) + '\',this)"></label>'
        + '<button class="rowbtn danger" title="Eliminar" onclick="deleteMedico(\'' + esc(m.id) + '\')">' + SVG_TRASH + '</button></div>';
      var subInformes = modelos.length ? cfgSub('Informes que firma', cfgMetaInformes(m.modelos), '<div class="cfg-scope">' + scopeChips('med', m.id, modelos, m.modelos) + '</div>') : '';
      var subClientes = clientesList.length ? cfgSub('Clientes', cfgMetaInformes(m.clientes), '<div class="cfg-scope">' + clienteChips('med-cliente', m.id, clientesList, m.clientes) + '</div>') : '';
      var search = [m.nombre, (m.clientes || []).map(function(s){ return cliNombre[s] || s; }).join(' '), espsDe(m).join(' ')].join(' ').toLowerCase();
      return '<div class="cfg-item" data-search="' + esc(search) + '">' + fila + subInformes + subClientes + '</div>';
    }
    if (!meds.length){ ml.innerHTML = '<div class="cfg-empty">Todavía no hay médicos.</div>'; }
    else {
      // Agrupar por CENTRO -> ESPECIALIDAD. Un médico que trabaja en varios
      // centros aparece en CADA uno (los centros son reales); dentro del centro va
      // una sola vez, bajo su primera especialidad (según los informes que firma).
      // Sin centro asignado -> "Todos los centros".
      var grupos = {};
      function put(centro, esp, m){ grupos[centro] = grupos[centro] || {}; grupos[centro][esp] = grupos[centro][esp] || []; grupos[centro][esp].push(m); }
      meds.forEach(function(m){
        var esp = (espsDe(m)[0]) || 'Sin especialidad';
        var centros = (m.clientes || []).filter(Boolean);
        if (!centros.length){ put('Todos los centros', esp, m); return; }
        centros.forEach(function(slug){ put(cliNombre[slug] || slug, esp, m); });
      });
      var centrosOrden = Object.keys(grupos).sort(function(a, b){ return a.localeCompare(b); });
      var html = '<div style="margin-bottom:6px"><input class="inp" id="infMedFiltro" placeholder="Buscar médico, centro o especialidad…" oninput="filtrarMedicosInforme()"></div>';
      html += '<div id="infMedGrupos">';
      centrosOrden.forEach(function(centro){
        var esps = Object.keys(grupos[centro]).sort(function(a, b){ return a.localeCompare(b); });
        var total = esps.reduce(function(s, e){ return s + grupos[centro][e].length; }, 0);
        html += '<details class="desc-esp"><summary class="desc-esp-head" style="cursor:pointer;font-weight:800;font-size:12.5px;color:var(--petrol);text-transform:uppercase;letter-spacing:.04em;margin:14px 0 4px;border-bottom:1px solid var(--border);padding-bottom:3px">' + esc(centro) + ' <span class="nom-muted" style="text-transform:none;font-weight:600">· ' + total + '</span></summary>';
        esps.forEach(function(esp){
          html += '<div class="desc-est"><div class="desc-est-head" style="font-weight:700;font-size:12px;color:var(--text-2);margin:8px 0 3px 2px">' + esc(esp) + ' <span class="nom-muted">· ' + grupos[centro][esp].length + '</span></div>';
          html += grupos[centro][esp].map(medItemHtml).join('');
          html += '</div>';
        });
        html += '</details>';
      });
      html += '</div>';
      ml.innerHTML = html;
    }
  }
  var dl = document.getElementById('infDescripcionesList');
  if (dl){
    var descs = INFORMES_CFG.descripciones || [];
    var modeloDe = {}; modelos.forEach(function(m){ modeloDe[m.key] = m; });
    // HTML de UN resultado (mismos controles que antes: borrar, chips de informes,
    // valores estándar). Suma data-search para el buscador.
    function descItemHtml(d){
      var titulo = d.nombre || presetLabel(d);
      var prev = d.texto ? '<div class="cfg-textoprev">' + esc(d.texto.length > 220 ? d.texto.slice(0, 218) + '…' : d.texto) + '</div>' : '';
      var fila = '<div class="cfg-row"><span class="cfg-name">' + esc(titulo) + '</span>'
        + '<button class="rowbtn danger" title="Eliminar" onclick="deleteDescripcion(\'' + esc(d.id) + '\')">' + SVG_TRASH + '</button></div>';
      var chips = modelos.length ? '<div class="cfg-scope">' + scopeChips('desc', d.id, modelos, d.modelos) + '</div>' : '';
      var campos = presetCampos(d), valEditor = '';
      if (campos.length){
        var val = d.valores || {};
        valEditor = '<div class="cfg-valores" data-preset="' + esc(d.id) + '">'
          + '<div class="cfg-scope-lbl">Valores estándar</div>'
          + '<div class="inf-campos">' + campos.map(function(c){
              var v = (val[c.key] != null && String(val[c.key]).trim() !== '') ? val[c.key] : (c.default || '');
              return '<label class="inf-campo' + (c.wide ? ' inf-wide' : '') + '"><span>' + esc(c.label) + '</span><input class="inp" data-vk="' + esc(c.key) + '" value="' + esc(v) + '" spellcheck="false"></label>';
            }).join('') + '</div>'
          + '<button class="btn btn-ghost" style="margin-top:8px" onclick="guardarValoresPreset(\'' + esc(d.id) + '\',this)">Guardar valores</button></div>';
      }
      var sub = (chips || valEditor) ? cfgSub('Informes y valores', cfgMetaInformes(d.modelos), chips + valEditor) : '';
      // Centros: vacío = lo ve cualquiera. Sirve cuando la misma práctica se
      // redacta distinto según el centro (el venoso de MMII: CIMA describe la
      // técnica del equipo y Baimed no).
      var subCli = clientesList.length ? cfgSub('Clientes', cfgMetaInformes(d.clientes), '<div class="cfg-scope">' + clienteChips('desc-cliente', d.id, clientesList, d.clientes) + '</div>') : '';
      var ests = (d.modelos || []).map(function(k){ return modeloDe[k]; }).filter(Boolean);
      var searchTxt = [titulo, d.texto || '', ests.map(function(m){ return m.practica; }).join(' '), ests.map(function(m){ return m.especialidad; }).join(' '), (d.clientes || []).map(function(s){ return cliNombre[s] || s; }).join(' ')].join(' ').toLowerCase();
      return '<div class="cfg-item" data-search="' + esc(searchTxt) + '">' + fila + prev + sub + subCli + '</div>';
    }
    if (!descs.length){ dl.innerHTML = '<div class="cfg-empty">Todavía no hay resultados.</div>'; }
    else {
      // Agrupar por ESPECIALIDAD -> ESTUDIO. Un resultado sin modelos asignados
      // va a "General · Todos los estudios"; uno asignado a varios estudios
      // aparece bajo cada uno (así se lo encuentra por cualquiera de ellos).
      var grupos = {};
      function put(esp, estKey, practica, d){
        esp = esp || 'General';
        if (!grupos[esp]) grupos[esp] = {};
        if (!grupos[esp][estKey]) grupos[esp][estKey] = { practica: practica, items: [] };
        grupos[esp][estKey].items.push(d);
      }
      descs.forEach(function(d){
        var ests = (d.modelos || []).map(function(k){ return modeloDe[k]; }).filter(Boolean);
        if (!ests.length){ put('General', '__all__', 'Todos los estudios', d); return; }
        // Cada resultado se muestra UNA sola vez, bajo su primer estudio (ordenado
        // por nombre). Si aplica a varios estudios, esos se ven en los chips
        // "Informes y valores" del propio resultado (antes se repetía bajo cada uno).
        ests.sort(function(a, b){ return (a.practica || '').localeCompare(b.practica || ''); });
        var m = ests[0];
        put(m.especialidad || 'General', m.key, m.practica || m.key, d);
      });
      var esps = Object.keys(grupos).sort(function(a, b){ return a.localeCompare(b); });
      var html = '<div style="margin-bottom:6px"><input class="inp" id="infDescFiltro" placeholder="Buscar por nombre, estudio o especialidad… (ej: electro)" oninput="filtrarResultadosInforme()"></div>';
      html += '<div id="infDescGrupos">';
      esps.forEach(function(esp){
        var estKeys = Object.keys(grupos[esp]).sort(function(a, b){ return (grupos[esp][a].practica || '').localeCompare(grupos[esp][b].practica || ''); });
        var totalEsp = estKeys.reduce(function(s, ek){ return s + grupos[esp][ek].items.length; }, 0);
        html += '<details class="desc-esp"><summary class="desc-esp-head" style="cursor:pointer;font-weight:800;font-size:12.5px;color:var(--petrol);text-transform:uppercase;letter-spacing:.04em;margin:14px 0 4px;border-bottom:1px solid var(--border);padding-bottom:3px">' + esc(esp) + ' <span class="nom-muted" style="text-transform:none;font-weight:600">· ' + totalEsp + '</span></summary>';
        estKeys.forEach(function(ek){
          var g = grupos[esp][ek];
          html += '<div class="desc-est"><div class="desc-est-head" style="font-weight:700;font-size:12px;color:var(--text-2);margin:8px 0 3px 2px">' + esc(g.practica) + ' <span class="nom-muted">· ' + g.items.length + '</span></div>';
          html += g.items.map(descItemHtml).join('');
          html += '</div>';
        });
        html += '</details>';
      });
      html += '</div>';
      dl.innerHTML = html;
    }
  }
}
// Filtra la lista de "Resultados del informe" (agrupada por especialidad/estudio)
// por texto: nombre, contenido, estudio o especialidad. Oculta los sub-grupos y
// grupos que quedan sin resultados visibles.
function filtrarResultadosInforme(){
  var q = ((document.getElementById('infDescFiltro') || {}).value || '').trim().toLowerCase();
  var cont = document.getElementById('infDescGrupos'); if (!cont) return;
  [].slice.call(cont.querySelectorAll('.desc-esp')).forEach(function(esp){
    var espVis = 0;
    [].slice.call(esp.querySelectorAll('.desc-est')).forEach(function(est){
      var estVis = 0;
      [].slice.call(est.querySelectorAll('.cfg-item')).forEach(function(it){
        var show = !q || (it.getAttribute('data-search') || '').indexOf(q) >= 0;
        it.style.display = show ? '' : 'none';
        if (show) estVis++;
      });
      est.style.display = estVis ? '' : 'none';
      if (estVis) espVis++;
    });
    esp.style.display = espVis ? '' : 'none';
    // Al buscar, abrir las especialidades con coincidencias (si están plegadas,
    // no se verían). Sin búsqueda, arrancan/quedan plegadas (el user las abre).
    if (q && esp.tagName === 'DETAILS') esp.open = espVis > 0;
  });
}
// Filtra la lista de médicos (agrupada por centro/especialidad) por texto:
// nombre, centro o especialidad. Oculta sub-grupos y centros sin coincidencias.
function filtrarMedicosInforme(){
  var q = ((document.getElementById('infMedFiltro') || {}).value || '').trim().toLowerCase();
  var cont = document.getElementById('infMedGrupos'); if (!cont) return;
  [].slice.call(cont.querySelectorAll('.desc-esp')).forEach(function(centro){
    var centroVis = 0;
    [].slice.call(centro.querySelectorAll('.desc-est')).forEach(function(est){
      var estVis = 0;
      [].slice.call(est.querySelectorAll('.cfg-item')).forEach(function(it){
        var show = !q || (it.getAttribute('data-search') || '').indexOf(q) >= 0;
        it.style.display = show ? '' : 'none';
        if (show) estVis++;
      });
      est.style.display = estVis ? '' : 'none';
      if (estVis) centroVis++;
    });
    centro.style.display = centroVis ? '' : 'none';
    if (q && centro.tagName === 'DETAILS') centro.open = centroVis > 0;
  });
}
// Bloque desplegable con las opciones seleccionables (chips / valores) del ítem.
function cfgSub(titulo, meta, contenido){
  return '<details class="cfg-sub"><summary class="cfg-sub-head">' + esc(titulo)
    + ' <span class="cfg-item-meta">' + esc(meta) + '</span></summary>' + contenido + '</details>';
}
// Resumen de a cuántos informes está asignado (vacío = todos).
function cfgMetaInformes(modelos){
  var n = (modelos || []).length;
  return n ? (n + ' informe' + (n > 1 ? 's' : '')) : 'todos';
}
// Resumen de a cuántos informes está asignado (vacío = todos).
function cfgMetaInformes(modelos){
  var n = (modelos || []).length;
  return n ? (n + ' informe' + (n > 1 ? 's' : '')) : 'todos';
}
// Chips = informes (modelos). seleccionadas = array de keys de modelo.
function scopeChips(kind, id, modelos, seleccionadas){
  return (modelos || []).map(function(m){
    var on = (seleccionadas || []).indexOf(m.key) >= 0;
    return '<button type="button" class="scope-chip' + (on ? ' on' : '') + '" title="' + esc(m.label) + '" onclick="toggleScope(\'' + kind + '\',\'' + esc(id) + '\',\'' + esc(m.key) + '\')">' + esc(m.short) + '</button>';
  }).join('');
}
// Chips = clientes. seleccionados = array de slugs. Vacío = disponible para todos.
function clienteChips(kind, id, clientes, seleccionados){
  return (clientes || []).map(function(c){
    var on = (seleccionados || []).indexOf(c.slug) >= 0;
    return '<button type="button" class="scope-chip' + (on ? ' on' : '') + '" title="' + esc(c.name) + '" onclick="toggleScope(\'' + kind + '\',\'' + esc(id) + '\',\'' + esc(c.slug) + '\')">' + esc(c.name) + '</button>';
  }).join('');
}
async function toggleScope(kind, id, key){
  function toggle(arr){ arr = (arr || []).slice(); var i = arr.indexOf(key); if (i >= 0) arr.splice(i, 1); else arr.push(key); return arr; }
  var r;
  if (kind === 'med'){
    var m = (INFORMES_CFG.medicos || []).find(function(x){ return x.id === id; }); if (!m) return;
    r = await req('POST', '/api/informes/medicos/' + encodeURIComponent(id) + '/scope', { modelos: toggle(m.modelos) });
  } else if (kind === 'med-cliente'){
    var mc = (INFORMES_CFG.medicos || []).find(function(x){ return x.id === id; }); if (!mc) return;
    r = await req('POST', '/api/informes/medicos/' + encodeURIComponent(id) + '/clientes', { clientes: toggle(mc.clientes) });
  } else if (kind === 'desc'){
    var d = (INFORMES_CFG.descripciones || []).find(function(x){ return x.id === id; }); if (!d) return;
    r = await req('POST', '/api/informes/descripciones/' + encodeURIComponent(id) + '/scope', { modelos: toggle(d.modelos) });
  } else if (kind === 'desc-cliente'){
    var dc = (INFORMES_CFG.descripciones || []).find(function(x){ return x.id === id; }); if (!dc) return;
    r = await req('POST', '/api/informes/descripciones/' + encodeURIComponent(id) + '/clientes', { clientes: toggle(dc.clientes) });
  }
  if (r && r.ok) await loadInformesConfig();
}
async function addMedico(){
  var msg = document.getElementById('infConfigMsg'); msg.textContent = '';
  var inp = document.getElementById('infMedicoNombre'); var nombre = inp.value.trim();
  if (!nombre){ msg.textContent = 'Escribí el nombre del médico.'; return; }
  var r = await req('POST', '/api/informes/medicos', { nombre: nombre });
  if (!r.ok){ msg.textContent = (r.data && r.data.error) || 'No se pudo agregar.'; return; }
  inp.value = ''; await loadInformesConfig();
}
async function uploadFirmaMedico(id, fileInput){
  var msg = document.getElementById('infConfigMsg'); msg.textContent = '';
  var f = fileInput.files[0]; if (!f) return;
  var form = new FormData(); form.append('file', f);
  var r = await fetch('/api/informes/medicos/' + encodeURIComponent(id) + '/firma', { method:'POST', body: form });
  if (!r.ok){ var d = {}; try { d = await r.json(); } catch (e) {} msg.textContent = (d && d.error) || 'No se pudo subir la firma.'; return; }
  await loadInformesConfig();
}
async function deleteMedico(id){
  if (!await nsConfirm('Se elimina este médico.', { titulo:'Eliminar médico', okLabel:'Eliminar', peligro:true })) return;
  var r = await req('DELETE', '/api/informes/medicos/' + encodeURIComponent(id));
  if (r.ok) await loadInformesConfig();
}
async function addDescripcion(){
  var msg = document.getElementById('infConfigMsg'); msg.textContent = '';
  var inp = document.getElementById('infDescripcionTexto'); var texto = inp.value.trim();
  var nomInp = document.getElementById('infDescripcionNombre'); var nombre = nomInp ? nomInp.value.trim() : '';
  if (!texto){ msg.textContent = 'Escribí el texto del resultado.'; return; }
  var r = await req('POST', '/api/informes/descripciones', { nombre: nombre, texto: texto });
  if (!r.ok){ msg.textContent = (r.data && r.data.error) || 'No se pudo agregar.'; return; }
  inp.value = ''; if (nomInp) nomInp.value = ''; await loadInformesConfig();
}
async function deleteDescripcion(id){
  if (!await nsConfirm('Se elimina esta descripción.', { titulo:'Eliminar descripción', okLabel:'Eliminar', peligro:true })) return;
  var r = await req('DELETE', '/api/informes/descripciones/' + encodeURIComponent(id));
  if (r.ok) await loadInformesConfig();
}
// Campos a editar para un resultado = los del primer informe asignado que tenga campos.
function presetCampos(d){
  var modelos = INFORMES_CFG.modelos || [];
  var keys = d.modelos || [];
  for (var i = 0; i < keys.length; i++){
    var m = modelos.find(function(x){ return x.key === keys[i]; });
    if (m && m.campos && m.campos.length) return m.campos;
  }
  return [];
}
async function guardarValoresPreset(id, btn){
  var box = btn.closest('.cfg-valores'); if (!box) return;
  var valores = {};
  box.querySelectorAll('input[data-vk]').forEach(function(inp){
    var val = inp.value.trim(); if (val) valores[inp.getAttribute('data-vk')] = val;
  });
  btn.disabled = true;
  var r = await req('PUT', '/api/informes/descripciones/' + encodeURIComponent(id), { valores: valores });
  btn.disabled = false;
  var msg = document.getElementById('infConfigMsg');
  if (!r.ok){ if (msg) msg.textContent = (r.data && r.data.error) || 'No se pudieron guardar los valores.'; return; }
  if (msg){ msg.className = 'msg ok'; msg.textContent = 'Valores guardados ✓'; setTimeout(function(){ msg.textContent = ''; msg.className = 'msg err'; }, 2500); }
  await loadInformesConfig();
}

// ---------- ojo ver/ocultar ----------
var EYE_ON  = '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>';
var EYE_OFF = '<path d="M17.94 17.94A10 10 0 0112 20c-7 0-11-8-11-8a18 18 0 015.06-5.94M9.9 4.24A9 9 0 0112 4c7 0 11 8 11 8a18 18 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
function eyeToggle(inputId, icoId){
  var inp = document.getElementById(inputId), ic = document.getElementById(icoId);
  var show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  ic.innerHTML = show ? EYE_OFF : EYE_ON;
}
function togglePwd(){ eyeToggle('pwd', 'pwdEyeIco'); }

// ---------- auth ----------
function initials(name){
  return (name || '?').split(' ').filter(Boolean).slice(0,2).map(function(w){ return w[0]; }).join('').toUpperCase();
}
function roleLabel(r){
  return { admin:'Administrador', operador:'Operador', medico:'Médico', clinica:'Clínica', demo:'Demostración', colaborador:'Colaborador', operador_clinica:'Operador Clínica' }[r] || r;
}
var ROLE = {
  admin:    { chip:'admin', label:'Admin',    bg:'linear-gradient(135deg,#3a3f8f,#5a60c0)' },
  operador: { chip:'oper',  label:'Operador', bg:'linear-gradient(135deg,#18B7B2,#0f7f7c)' },
  medico:   { chip:'med',   label:'Médico',   bg:'linear-gradient(135deg,#3B82C4,#2a5f96)' },
  clinica:  { chip:'clin',  label:'Clínica',  bg:'linear-gradient(135deg,#7a4fd0,#5a37a0)' },
  demo:     { chip:'demo',  label:'Demo',     bg:'linear-gradient(135deg,#667085,#475467)' },
  colaborador: { chip:'colab', label:'Colaborador', bg:'linear-gradient(135deg,#C77D3A,#9a5c26)' },
  operador_clinica: { chip:'opcli', label:'Op. Clínica', bg:'linear-gradient(135deg,#4f8a5a,#356240)' },
};
// Roles de SOLO LECTURA: ven datos reales pero no escriben nada (el backend se los
// bloquea, no alcanza con esconder botones). Mismo criterio que server.js.
var SOLO_LECTURA = ['demo', 'colaborador'];
function esSoloLectura(u){ return !!(u && SOLO_LECTURA.indexOf(u.role) >= 0); }
// Visibilidad de clientes restringida - mismo criterio que el servidor
// (permissions.js: tieneClientesRestringidos/clientesPermitidosSet/
// clientesVisiblesPara). Hace falta esta copia en JS por el modo espejo: la
// sesión real sigue siendo la del admin (el server ya le manda TODOS los
// clientes), así que cualquier pantalla que liste clientes tiene que
// re-filtrar ACÁ con el usuario efectivo (ME, espejado) para que la vista
// previa muestre lo mismo que vería ese usuario en una sesión real.
function tieneClientesRestringidos(u){
  if (!u) return false;
  if (esSoloLectura(u)) return true;
  if (u.role === 'operador') return Array.isArray(u.clientes) && u.clientes.length > 0;
  if (u.role === 'operador_clinica' || u.role === 'clinica') return true;
  return false;
}
function clientesPermitidosSet(u){
  if (u.role === 'operador_clinica' || u.role === 'clinica') return new Set(u.centro ? [u.centro] : []);
  return new Set(Array.isArray(u.clientes) ? u.clientes : []);
}
function clientesVisiblesPara(u, clientes){
  if (!tieneClientesRestringidos(u)) return clientes;
  var permitidos = clientesPermitidosSet(u);
  return (clientes || []).filter(function(c){ return permitidos.has(c.slug); });
}
// Trae la lista de clientes para poblar un selector (Padrón/Cabina/Cruzas/OME/
// Liberar cupo), ya re-filtrada por el usuario EFECTIVO (ME) - así el modo
// espejo muestra exactamente lo que ese usuario vería, no la lista completa
// que le llega a la sesión real del admin.
async function clientesParaSelector(){
  try {
    var r = await fetch('/api/clientes');
    var raw = await r.json();
    var list = Array.isArray(raw) ? raw : (raw && raw.clients) || [];
    return clientesVisiblesPara(ME, list);
  } catch (e) { return []; }
}
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
var USERS = [];
var SVG_EDIT  = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var SVG_KEY   = '<svg viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M10.85 12.15L20 3M17 6l2.5 2.5M14 9l2.5 2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var SVG_POWER = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v9M6.4 6.4a8 8 0 1011.2 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var SVG_TRASH = '<svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// Ícono de "Actividad" (reloj): solo aparece en la fila de un operador, y lleva
// al detalle de sus horas conectado + log de ingresos. Ni se muestra para los
// demás roles ni el operador tiene manera de llegar a esa pantalla.
var SVG_CLOCK = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

async function renderUsers(){
  var body = document.getElementById('usersBody');
  if (!body) return;
  var res = await api('/api/users');
  if (!res.ok){ body.innerHTML = '<tr><td colspan="4" style="color:var(--text-2);padding:16px">No se pudo cargar la lista.</td></tr>'; return; }
  var users = res.data.users || [];
  USERS = users;
  var meU = (ME && ME.username) || '';
  body.innerHTML = users.map(function(u){
    var r = ROLE[u.role] || { chip:'admin', label:u.role, bg:'linear-gradient(135deg,#66788a,#4f6378)' };
    var st = !u.active ? '<span class="st off">Inactivo</span>'
           : u.mustChange ? '<span class="st off">Debe cambiar clave</span>'
           : '<span class="st on">Activo</span>';
    var self = u.username === meU;
    var un = esc(u.username);
    var acts = '<button class="rowbtn" title="Editar" onclick="openUserModal(\'edit\',\'' + un + '\')">' + SVG_EDIT + '</button>'
             + '<button class="rowbtn" title="Clave" onclick="openReset(\'' + un + '\')">' + SVG_KEY + '</button>';
    if (u.role === 'operador'){
      acts += '<button class="rowbtn" title="Ver actividad" onclick="abrirActividadModal(\'' + un + '\')">' + SVG_CLOCK + '</button>';
    }
    if (!self){
      acts += '<button class="rowbtn" title="' + (u.active ? 'Desactivar' : 'Activar') + '" onclick="toggleActive(\'' + un + '\',' + (u.active ? 'false' : 'true') + ')">' + SVG_POWER + '</button>'
            + '<button class="rowbtn danger" title="Eliminar" onclick="openDel(\'' + un + '\')">' + SVG_TRASH + '</button>';
    }
    return '<tr>'
      + '<td><div class="u"><div class="av" style="background:' + r.bg + '">' + esc(initials(u.name)) + '</div><div><div class="nm">' + esc(u.name) + '</div><div class="em">@' + un + (u.email ? ' · ' + esc(u.email) : '') + '</div></div></div></td>'
      + '<td><span class="role ' + r.chip + '">' + esc(r.label) + '</span></td>'
      + '<td>' + st + '</td>'
      + '<td><div class="row-actions">' + acts + '</div></td>'
      + '</tr>';
  }).join('');
  var dc = document.getElementById('dashUsersCount'), ds = document.getElementById('dashUsersSub');
  if (dc) dc.textContent = users.length;
  if (ds){ var pend = users.filter(function(u){ return u.mustChange || !u.active; }).length; ds.textContent = (users.length - pend) + ' activos · ' + pend + ' pendientes'; }
}

// ============ Actividad de operadores (solo admin) ============
// "Horas de hoy" que suma en vivo (se repolla cada 60s mientras Inicio está
// abierto) + un ícono por operador para ver el detalle (log de ingresos y
// horas por día). El operador nunca ve esto: la tarjeta vive en el Inicio del
// admin (ver cargarInicio) y el detalle sale de /api/admin/actividad, que el
// backend le devuelve 403 a cualquiera que no sea admin.
var ACTIVIDAD_OP_TIMER = null;
function actHorasFmt(seg){
  seg = Math.max(0, Math.round(seg || 0));
  var h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60);
  if (!h && !m) return '0 min';
  return (h ? h + 'h ' : '') + (m ? m + 'min' : (h ? '' : '0min'));
}
async function cargarActividadOperadores(){
  var card = document.getElementById('actividadOpCard');
  var list = document.getElementById('actividadOpList');
  if (!card || !list) return;
  var res = await api('/api/admin/actividad');
  if (!res.ok){ list.innerHTML = '<li class="ini-empty">No se pudo cargar.</li>'; return; }
  var operadores = res.data.operadores || [];
  if (!operadores.length){ list.innerHTML = '<li class="ini-empty">No hay operadores cargados.</li>'; return; }
  list.innerHTML = operadores.map(function(o){
    var un = esc(o.username);
    return '<li class="acted-row">'
      + '<span class="acted-dot' + (o.conectadoAhora ? ' on' : '') + '" title="' + (o.conectadoAhora ? 'Conectado ahora' : 'Sin conexión') + '"></span>'
      + '<span class="acted-nombre">' + esc(o.name) + '</span>'
      + '<span class="acted-horas">' + esc(actHorasFmt(o.hoySegundos)) + ' hoy</span>'
      + '<button class="rowbtn" title="Ver detalle" onclick="abrirActividadModal(\'' + un + '\')">' + SVG_CLOCK + '</button>'
      + '</li>';
  }).join('');
}
// Se llama una sola vez (desde cargarInicio, rama admin) para dejar el
// repollo de "Horas de hoy" andando mientras la pestaña esté visible.
function actividadOpArrancarPolling(){
  if (ACTIVIDAD_OP_TIMER) return;
  ACTIVIDAD_OP_TIMER = setInterval(function(){
    if (document.visibilityState !== 'hidden' && iniEsAdmin()) cargarActividadOperadores();
  }, 60000);
}
async function abrirActividadModal(username){
  var res = await api('/api/admin/actividad/' + encodeURIComponent(username));
  if (!res.ok){ nsAlert((res.data && res.data.error) || 'No se pudo cargar la actividad.'); return; }
  var u = findUser(username);
  document.getElementById('actModalTitle').textContent = 'Actividad de ' + (u ? u.name : username);
  var dias = res.data.dias || [];
  var diasBox = document.getElementById('actModalDias');
  var maxSeg = Math.max.apply(null, dias.map(function(d){ return d.segundos; }).concat([1]));
  diasBox.innerHTML = dias.length
    ? dias.map(function(d){
        var pct = Math.max(2, Math.round((d.segundos / maxSeg) * 100));
        return '<div class="act-dia-row"><span class="act-dia-fecha">' + esc(diaFmtCorto(d.dia)) + '</span>'
          + '<span class="act-dia-barwrap"><span class="act-dia-bar" style="width:' + pct + '%"></span></span>'
          + '<span class="act-dia-val">' + esc(actHorasFmt(d.segundos)) + '</span></div>';
      }).join('')
    : '<div class="ini-empty">Todavía no hay horas registradas.</div>';
  var sesiones = res.data.sesiones || [];
  var body = document.getElementById('actModalSesiones');
  body.innerHTML = sesiones.length
    ? sesiones.map(function(s){
        var d = new Date(s.loginAt);
        var fecha = isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-AR');
        var hora = isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
        return '<tr><td>' + esc(fecha) + '</td><td>' + esc(hora) + '</td><td>' + esc(s.ip || '—') + '</td></tr>';
      }).join('')
    : '<tr><td colspan="3" class="muted-cell">Sin ingresos registrados todavía.</td></tr>';
  showModal('actModal', 'actScrim');
}
function closeActividadModal(){ hideModal('actModal', 'actScrim'); }
// "2026-09-05" -> "05/09". Evita el corrimiento de un día que da new
// Date("2026-09-05") al interpretarse como UTC medianoche.
function diaFmtCorto(yyyyMmDd){
  var p = String(yyyyMmDd || '').split('-');
  return p.length === 3 ? (p[2] + '/' + p[1]) : String(yyyyMmDd || '');
}

// Tile de "Clientes activos" en Inicio.
async function updateDashClientsTile(){
  var el = document.getElementById('dashClientsCount'); if (!el) return;
  if (!CLIENTS || !CLIENTS.length){ var res = await api('/api/clientes'); if (res.ok) CLIENTS = res.data.clients || []; }
  el.textContent = (CLIENTS || []).length;
}

// ============ INICIO: mensajes internos + tareas compartidas (solo admin) ============
var INICIO = { yo:'', admins:[], mensajes:[], tareas:[], unread:0, noLeidos:{}, canal:'', canales:[], adjunto:null, adjuntoOp:null, assign:[], wired:false, wiredOperador:false, pollTimer:null };
function iniEsAdmin(){ return !!(ME && ME.role === 'admin'); }
// Canal por defecto y etiqueta. "seba" = Nacho↔Seba (admins); "operadores" = con los operadores.
function iniCanalDefault(){ return (ME && ME.role === 'operador') ? 'operadores' : 'seba'; }
function iniCanalLabel(c){ return c === 'operadores' ? 'Operadores' : 'Admin'; }
function iniTotalNoLeidos(){ var t=0, nl=INICIO.noLeidos||{}; Object.keys(nl).forEach(function(k){ t += nl[k]||0; }); return t; }
function iniFmtHora(iso){
  try{
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    var hoy = new Date();
    var hm = ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
    if (d.toDateString() === hoy.toDateString()) return hm;
    var ayer = new Date(hoy); ayer.setDate(hoy.getDate()-1);
    if (d.toDateString() === ayer.toDateString()) return 'ayer '+hm;
    return ('0'+d.getDate()).slice(-2)+'/'+('0'+(d.getMonth()+1)).slice(-2)+' '+hm;
  }catch(e){ return ''; }
}
function iniIniciales(nombre){
  var p = String(nombre||'').trim().split(/\s+/);
  return (((p[0]||'')[0]||'') + ((p[1]||'')[0]||'')).toUpperCase() || '?';
}
function iniNombreDe(username){
  var a = (INICIO.admins||[]).find(function(x){return x.username===username;});
  return a ? a.nombre : username;
}
function iniPuedeVerInicio(){ return !!(ME && (ME.role === 'admin' || ME.role === 'operador')); }
// Inicio de cualquier rol sin paneles propios todavía (colaborador, clínica,
// operador_clinica, médico, demo…): el mismo cartel de "en desarrollo" para
// todos — entran a sus clientes por el menú. Antes esto quedaba en blanco para
// todos salvo colaborador; el resto de los roles ni siquiera pasaba por acá
// (go() los mandaba derecho al centro, saltándose Inicio). Los módulos se van
// sumando a este panel a medida que cada rol tenga algo propio para mostrar.
function cargarInicioColaborador(){
  var cont = document.getElementById('colabPaneles');
  if (cont) cont.style.display = '';
}
async function cargarInicio(marcarLeido){
  var pl = document.getElementById('inicioPaneles');
  var op = document.getElementById('operadorPaneles');
  var colab = document.getElementById('colabPaneles');
  var actCard0 = document.getElementById('actividadOpCard');
  if (!iniPuedeVerInicio()){
    if (pl) pl.style.display = 'none';
    if (op) op.style.display = 'none';
    if (actCard0) actCard0.style.display = 'none';
    return cargarInicioColaborador();
  }
  if (colab) colab.style.display = 'none';
  if (!INICIO.canal) INICIO.canal = iniCanalDefault();
  var res = await api('/api/inicio?canal=' + encodeURIComponent(INICIO.canal));
  if (!res.ok){
    if (INICIO.canal !== iniCanalDefault()){ INICIO.canal = iniCanalDefault(); return cargarInicio(marcarLeido); }
    return;
  }
  INICIO.yo = res.data.yo || ''; INICIO.admins = res.data.admins || [];
  INICIO.mensajes = res.data.mensajes || []; INICIO.tareas = res.data.tareas || [];
  INICIO.canal = res.data.canal || INICIO.canal;
  INICIO.canales = res.data.canales || [INICIO.canal];
  INICIO.noLeidos = res.data.noLeidos || {};
  INICIO.unread = INICIO.noLeidos[INICIO.canal] || 0;
  if (marcarLeido && INICIO.unread > 0){ await api('/api/inicio/mensajes/leidos', { canal: INICIO.canal }); INICIO.noLeidos[INICIO.canal] = 0; INICIO.unread = 0; }

  if (iniEsAdmin()){
    if (op) op.style.display = 'none';
    if (pl) pl.style.display = '';
    if (!INICIO.wired){ INICIO.wired = true; iniWireComposer('iniMsg', iniEnviarMsg, iniSetAdjunto); }
    iniRenderCanales(); iniRenderAssign(); iniRenderMensajesEn('iniFeed'); iniRenderTareas();
    iniRenderAdjunto('iniAdjPreview', INICIO.adjunto, 'iniQuitarAdjunto');
    iniCargarPendientesOperador();
    iniAccesosRender();
    iniPanelesAplicar('admin'); iniPanelesWireDrag('admin');
    var actCard = document.getElementById('actividadOpCard');
    if (actCard) actCard.style.display = '';
    cargarActividadOperadores();
    actividadOpArrancarPolling();
  } else {
    if (pl) pl.style.display = 'none';
    if (op) op.style.display = '';
    var actCard2 = document.getElementById('actividadOpCard');
    if (actCard2) actCard2.style.display = 'none';
    if (!INICIO.wiredOperador){ INICIO.wiredOperador = true; iniWireComposer('opMsg', opEnviarMsg, opSetAdjunto); }
    iniRenderMensajesEn('opFeed');
    iniRenderAdjunto('opAdjPreview', INICIO.adjuntoOp, 'opQuitarAdjunto');
    iniCargarMisPendientes();
    iniAccesosRender('op');
    opRenderTareas();
    iniPanelesAplicar('op'); iniPanelesWireDrag('op');
  }
  iniActualizarBell();
}
// Engancha un composer (Enter para enviar, autosize, pegar imagen del portapapeles).
function iniWireComposer(id, sendFn, setAdjFn){
  var mi = document.getElementById(id); if(!mi) return;
  mi.addEventListener('keydown', function(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendFn(); } });
  mi.addEventListener('input', function(){ this.style.height='auto'; this.style.height=Math.min(120,this.scrollHeight)+'px'; });
  mi.addEventListener('paste', function(e){
    var items = (e.clipboardData || {}).items || [];
    for (var i=0;i<items.length;i++){ if(items[i].kind==='file'){ var f=items[i].getAsFile(); if(f){ setAdjFn(f); e.preventDefault(); break; } } }
  });
}
// Selector de canales (solo admin, que ve los dos). El operador ve un solo canal.
function iniRenderCanales(){
  var box = document.getElementById('iniCanales'); if(!box) return;
  var cs = INICIO.canales || [];
  if (cs.length < 2){ box.style.display = 'none'; return; }
  box.style.display = '';
  box.innerHTML = cs.map(function(c){
    var n = (INICIO.noLeidos && INICIO.noLeidos[c]) || 0;
    var punto = (n>0 && c!==INICIO.canal) ? '<span class="ini-cdot"></span>' : '';
    return '<button type="button" class="'+(c===INICIO.canal?'on':'')+'" onclick="iniSetCanal(\''+c+'\')">'+esc(iniCanalLabel(c))+punto+'</button>';
  }).join('');
}
function iniSetCanal(c){ if (c === INICIO.canal) return; INICIO.canal = c; cargarInicio(true); }
// Multi-asignado: se puede tildar a Ignacio y/o Sebastian a la vez - una tarea
// nunca puede quedar sin nadie tildado (por eso no hay opción "Sin asignar").
function iniRenderAssign(){
  var box = document.getElementById('iniAssign'); if(!box) return;
  var opts = (INICIO.admins||[]).map(function(a){
    var corto = String(a.nombre||a.username).split(' ')[0];
    return { v:a.username, t: a.username===INICIO.yo ? (corto+' (yo)') : corto };
  });
  box.innerHTML = opts.map(function(o){
    return '<button type="button" class="'+((INICIO.assign||[]).indexOf(o.v)>=0?'on':'')+'" onclick="iniSetAssign(\''+esc(o.v)+'\')">'+esc(o.t)+'</button>';
  }).join('');
}
function iniSetAssign(v){
  var i = (INICIO.assign||[]).indexOf(v);
  if (i>=0) INICIO.assign.splice(i,1); else (INICIO.assign = INICIO.assign||[]).push(v);
  iniRenderAssign();
  var err = document.getElementById('iniTaskErr'); if (err) err.style.display='none';
}
// feedId: 'iniFeed' (panel admin) u 'opFeed' (panel operador) - mismo feed de
// mensajes (INICIO.mensajes ya viene filtrado por el servidor según quién
// pregunta), solo cambia dónde se pinta. Un admin ve, junto a cada mensaje,
// si los operadores lo pueden ver o no (👁/🔒) - un operador no ve ese badge.
function iniRenderMensajesEn(feedId){
  var feed = document.getElementById(feedId); if(!feed) return;
  var ms = INICIO.mensajes || [];
  if (!ms.length){ feed.innerHTML = '<div class="ini-empty">Todavía no hay mensajes. Dejá el primero 👇</div>'; return; }
  var prevAutor = null;
  feed.innerHTML = ms.map(function(m){
    var mine = m.autor === INICIO.yo;
    var agr = m.autor === prevAutor;   // mismo autor que el anterior → tanda: no repetir avatar/nombre
    prevAutor = m.autor;
    var adj = m.adjunto ? iniAdjuntoHtml(m.adjunto) : '';
    var txt = m.texto ? '<div class="ini-txt">'+esc(m.texto)+'</div>' : '';
    // El nombre va solo en el PRIMERO de una tanda y solo en los ajenos (los tuyos
    // no llevan "Vos": ya están a la derecha con tu avatar).
    var who = (!agr && !mine) ? '<div class="ini-who">'+esc(m.autorNombre)+'</div>' : '';
    // Avatar solo en el primero de la tanda; si sigue el mismo autor, un espaciador.
    var av = agr ? '<span class="ini-av-sp"></span>'
                 : '<span class="ini-av'+(mine?' me':'')+'">'+esc(iniIniciales(m.autorNombre))+'</span>';
    return '<div class="ini-msg'+(mine?' me':'')+(agr?' agr':'')+'">'
      + av + '<div class="ini-bub">'+ who + adj + txt
      + '<div class="ini-tm">'+esc(iniFmtHora(m.at))+'</div></div></div>';
  }).join('');
  feed.scrollTop = feed.scrollHeight;
}
function iniRenderMensajes(){ iniRenderMensajesEn('iniFeed'); }
function iniFmtSize(n){ n=Number(n)||0; if(n<1024) return n+' B'; if(n<1048576) return (n/1024).toFixed(0)+' KB'; return (n/1048576).toFixed(1)+' MB'; }
function iniAdjuntoHtml(a){
  var url = '/api/inicio/adjuntos/' + encodeURIComponent(a.id);
  if (String(a.tipo||'').indexOf('image/') === 0){
    return '<a class="ini-adj-img" href="'+url+'" target="_blank" rel="noopener"><img src="'+url+'" alt="'+esc(a.filename)+'" loading="lazy"></a>';
  }
  return '<a class="ini-adj-file" href="'+url+'" target="_blank" rel="noopener" download="'+esc(a.filename)+'">'
    + '<span class="ini-adj-ic">📎</span><span class="ini-adj-nm">'+esc(a.filename)+'</span>'
    + '<span class="ini-adj-sz">'+iniFmtSize(a.size)+'</span></a>';
}
// Envío unificado (admin u operador): texto + canal actual + adjunto opcional (FormData).
async function iniSend(textareaId, adjKey, feedId, previewId, quitarName){
  var inp = document.getElementById(textareaId); if(!inp) return;
  var t = inp.value.trim(); var f = INICIO[adjKey];
  if (!t && !f) return;
  var fd = new FormData();
  fd.append('texto', t);
  fd.append('canal', INICIO.canal || iniCanalDefault());
  if (f) fd.append('archivo', f, f.name || 'archivo');
  var r = await fetch('/api/inicio/mensajes', { method:'POST', body: fd });
  var data = await r.json().catch(function(){ return {}; });
  if (!r.ok){ nsAlert((data && data.error) || 'No se pudo enviar el mensaje.'); return; }
  inp.value=''; inp.style.height=''; INICIO[adjKey]=null; iniRenderAdjunto(previewId, null, quitarName);
  INICIO.mensajes.push(data.mensaje);
  if (INICIO.noLeidos) INICIO.noLeidos[INICIO.canal] = 0;
  INICIO.unread = 0;
  iniRenderMensajesEn(feedId); iniActualizarBell();
}
function iniEnviarMsg(){ iniSend('iniMsg','adjunto','iniFeed','iniAdjPreview','iniQuitarAdjunto'); }
function opEnviarMsg(){ iniSend('opMsg','adjuntoOp','opFeed','opAdjPreview','opQuitarAdjunto'); }
// Adjuntos del composer (admin usa INICIO.adjunto; operador INICIO.adjuntoOp).
function iniPickAdjunto(){ var i=document.getElementById('iniFileInput'); if(i) i.click(); }
function iniOnFileInput(input){ if(input.files && input.files[0]){ iniSetAdjunto(input.files[0]); input.value=''; } }
function iniSetAdjunto(f){ if(f.size>30*1024*1024){ nsAlert('El archivo es muy grande (máx 30 MB).'); return; } INICIO.adjunto=f; iniRenderAdjunto('iniAdjPreview', f, 'iniQuitarAdjunto'); }
function iniQuitarAdjunto(){ INICIO.adjunto=null; iniRenderAdjunto('iniAdjPreview', null, 'iniQuitarAdjunto'); }
function opPickAdjunto(){ var i=document.getElementById('opFileInput'); if(i) i.click(); }
function opOnFileInput(input){ if(input.files && input.files[0]){ opSetAdjunto(input.files[0]); input.value=''; } }
function opSetAdjunto(f){ if(f.size>30*1024*1024){ nsAlert('El archivo es muy grande (máx 30 MB).'); return; } INICIO.adjuntoOp=f; iniRenderAdjunto('opAdjPreview', f, 'opQuitarAdjunto'); }
function opQuitarAdjunto(){ INICIO.adjuntoOp=null; iniRenderAdjunto('opAdjPreview', null, 'opQuitarAdjunto'); }
function iniRenderAdjunto(boxId, f, quitarName){
  var box = document.getElementById(boxId); if(!box) return;
  if (!f){ box.style.display='none'; box.innerHTML=''; return; }
  box.style.display='';
  var esImg = String(f.type||'').indexOf('image/')===0;
  box.innerHTML = (esImg ? '🖼️ ' : '📎 ') + '<span class="ini-adjp-nm">'+esc(f.name||'archivo')+'</span> <span class="ini-adjp-sz">('+iniFmtSize(f.size)+')</span>'
    + '<button type="button" class="ini-adjp-x" title="Quitar" onclick="'+quitarName+'()">✕</button>';
}
function iniHoyISO(){
  var d = new Date();
  return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
}
// El <input type="date"> de los chips de vencimiento cubre todo el chip de forma
// invisible, pero varios navegadores (Firefox, Safari) solo abren el calendario
// nativo si el click cae justo en su ícono interno, no en cualquier punto del
// control - con el chip estirado, ese ícono queda escondido y tocar no hace nada.
// showPicker() lo abre igual sin importar dónde se hizo click (soportado en
// Chrome/Edge/Firefox/Safari recientes; en un navegador viejo simplemente no hace nada).
function iniAbrirPicker(el){ try{ el.showPicker && el.showPicker(); }catch(e){} }
// Estado de vencimiento de una tarea NO hecha: '' | 'futuro' | 'proxima' | 'hoy' | 'vencida'.
// 'proxima': le quedan pocos días (PROXIMA_DIAS) para vencer - todavía no es
// urgente como 'hoy'/'vencida', pero conviene que se note antes de que sea tarde.
var PROXIMA_DIAS = 3;
function iniVenceEstado(t){
  if (!t || t.hecha || !t.vence) return '';
  var hoy = iniHoyISO();
  if (t.vence < hoy) return 'vencida';
  if (t.vence === hoy) return 'hoy';
  var diffDias = Math.round((new Date(t.vence+'T00:00:00') - new Date(hoy+'T00:00:00')) / 86400000);
  if (diffDias <= PROXIMA_DIAS) return 'proxima';
  return 'futuro';
}
function iniVenceLabel(v){ var p=String(v||'').split('-'); return p.length===3 ? p[2]+'/'+p[1] : ''; }
function iniRenderTareas(){
  var open = document.getElementById('iniOpen'), done = document.getElementById('iniDone');
  if(!open||!done) return;
  var abiertas = (INICIO.tareas||[]).filter(function(t){return !t.hecha;});
  var hechas = (INICIO.tareas||[]).filter(function(t){return t.hecha;});
  // Las vencidas primero, después por fecha de vencimiento (las sin fecha al final).
  abiertas.sort(function(a,b){
    var av=a.vence||'9999', bv=b.vence||'9999';
    return av<bv?-1:(av>bv?1:0);
  });
  open.innerHTML = abiertas.length ? abiertas.map(iniTareaHTML).join('') : '<div class="ini-empty">No hay tareas pendientes 🎉</div>';
  done.innerHTML = hechas.map(iniTareaHTML).join('');
  var oc=document.getElementById('iniOpenCnt'); if(oc) oc.textContent = abiertas.length;
  var dc=document.getElementById('iniDoneCnt'); if(dc) dc.textContent = hechas.length;
  var vencidas = abiertas.filter(function(t){ return iniVenceEstado(t)==='vencida'; }).length;
  var vc=document.getElementById('iniVencCnt');
  if (vc) vc.innerHTML = vencidas ? ' · <b class="ini-venc-cnt">'+vencidas+' vencida'+(vencidas>1?'s':'')+'</b>' : '';
}
function iniTareaHTML(t, opts){
  opts = opts || {};
  var paraArr = Array.isArray(t.para) ? t.para : (t.para ? [t.para] : []);
  var paraNombres = paraArr.map(function(u){ return String(iniNombreDe(u)||'').split(' ')[0]; }).join(' y ');
  // En la lista propia del operador no hace falta decir "para Javier" en cada
  // tarea - son todas suyas, sería ruido repetido.
  var chip = (!opts.sinPara && paraNombres) ? '<span class="ini-chip">para '+esc(paraNombres)+'</span>' : '';
  var meta = t.hecha ? 'hecha' : ('creada por '+esc(String(t.creadaPorNombre||'').split(' ')[0]));
  var est = iniVenceEstado(t);
  var txt = t.vence
    ? (est==='vencida' ? 'venció '+iniVenceLabel(t.vence) : (est==='hoy' ? 'vence hoy' : 'vence '+iniVenceLabel(t.vence)))
    : 'fecha';
  var cal = '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4.5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  // Reprogramar una tarea vencida es cosa de un admin - un operador puede
  // resolverla pero no correrle la fecha (mismo criterio que aplica el server
  // en POST .../vence). Una tarea sin vencer todavía se puede reprogramar igual.
  var esAdmin = iniEsAdmin();
  var puedeCambiarFecha = esAdmin || est !== 'vencida';
  // Chip de vencimiento: un <input type="date"> transparente encima abre el calendario
  // nativo al tocarlo y guarda al cambiar. En las hechas, o vencidas sin permiso, se
  // muestra fijo, sin editar.
  var due = t.hecha
    ? (t.vence ? '<span class="ini-due set done">'+cal+'<span>'+esc(iniVenceLabel(t.vence))+'</span></span>' : '')
    : (puedeCambiarFecha
      ? '<label class="ini-due '+(t.vence?(est||'futuro'):'none')+'">'+cal+'<span>'+esc(txt)+'</span>'
        + '<input type="date" value="'+esc(t.vence||'')+'" onclick="iniAbrirPicker(this)" onchange="iniSetVence(\''+esc(t.id)+'\', this.value)"></label>'
      : '<span class="ini-due '+(t.vence?(est||'futuro'):'none')+'">'+cal+'<span>'+esc(txt)+'</span></span>');
  // Vencida: no se la deja en rojo pasivo - pide explícitamente resolverla o
  // (solo un admin) pasarla a otra fecha (no alcanza con el chip de fecha, poco visible).
  var urgente = est==='vencida'
    ? '<div class="ini-task-urgent"><span>Venció — ¿la resolvés'+(esAdmin?' o la pasás para otra fecha':'')+'?</span>'
      + '<button type="button" class="btn btn-primary btn-sm" onclick="iniToggleTarea(\''+esc(t.id)+'\')">✓ Resuelta</button>'
      + (esAdmin ? '<label class="ini-due-btn">📅 Nueva fecha<input type="date" value="'+esc(t.vence||'')+'" onclick="iniAbrirPicker(this)" onchange="iniSetVence(\''+esc(t.id)+'\', this.value)"></label>' : '')
      + '</div>'
    : '';
  return '<li class="ini-task'+(t.hecha?' done':'')+(est==='vencida'?' venc':'')+(est==='proxima'?' proxima':'')+'">'
    + '<button class="ini-ck" onclick="iniToggleTarea(\''+esc(t.id)+'\')" title="'+(t.hecha?'Reabrir':'Marcar hecha')+'"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5 9-10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
    + '<div class="ini-tbody"><div class="ini-ttitle">'+esc(t.titulo)+'</div>'
    + '<div class="ini-tmeta">'+chip+due+'<span>'+meta+'</span>'
    + (t.hecha?'<button class="ini-link" onclick="iniToggleTarea(\''+esc(t.id)+'\')">reabrir</button>':'')
    + '</div>'+urgente+'</div>'
    + (opts.sinBorrar ? '' : '<button class="ini-del" onclick="iniBorrarTarea(\''+esc(t.id)+'\')" title="Borrar">🗑</button>')
    + '</li>';
}
async function iniAgregarTarea(){
  var inp = document.getElementById('iniTask'); if(!inp) return;
  var v = inp.value.trim(); if(!v) return;
  var err = document.getElementById('iniTaskErr');
  if (!(INICIO.assign||[]).length){
    if (err){ err.textContent = 'Asigná la tarea a Ignacio y/o Sebastian antes de agregarla.'; err.style.display=''; }
    return;
  }
  if (err) err.style.display='none';
  var vi = document.getElementById('iniTaskVence');
  var res = await api('/api/inicio/tareas', { titulo:v, para: INICIO.assign||[], vence: (vi&&vi.value)||'' });
  if (!res.ok){ nsAlert(res.data.error || 'No se pudo agregar la tarea.'); return; }
  inp.value=''; if(vi) vi.value=''; INICIO.assign=[]; iniRenderAssign();
  INICIO.tareas.unshift(res.data.tarea); iniRenderTareas();
}
// Repinta la lista de tareas que corresponda: la del admin o la propia del
// operador (comparten INICIO.tareas, cada uno la ve con su propia pinta).
function iniRenderTareasSegunRol(){ iniEsAdmin() ? iniRenderTareas() : opRenderTareas(); }
async function iniSetVence(id, val){
  var res = await api('/api/inicio/tareas/'+encodeURIComponent(id)+'/vence', { vence: val||'' });
  if (!res.ok){ nsAlert(res.data.error || 'No se pudo guardar la fecha.'); return; }
  var t = (INICIO.tareas||[]).find(function(x){return x.id===id;});
  if(t) t.vence = res.data.tarea.vence;
  iniRenderTareasSegunRol();
}
async function iniToggleTarea(id){
  var res = await api('/api/inicio/tareas/'+encodeURIComponent(id)+'/toggle', {});
  if (!res.ok){ nsAlert(res.data.error || 'No se pudo actualizar la tarea.'); return; }
  var t = (INICIO.tareas||[]).find(function(x){return x.id===id;});
  if(t){ t.hecha=res.data.tarea.hecha; t.hechaAt=res.data.tarea.hechaAt; }
  iniRenderTareasSegunRol();
}
async function iniBorrarTarea(id){
  if (!await nsConfirm('Se borra esta tarea.', { titulo:'Borrar tarea', okLabel:'Borrar', peligro:true })) return;
  var res = await req('DELETE', '/api/inicio/tareas/'+encodeURIComponent(id));
  if (!res.ok){ nsAlert(res.data.error || 'No se pudo borrar la tarea.'); return; }
  INICIO.tareas = (INICIO.tareas||[]).filter(function(x){return x.id!==id;}); iniRenderTareas();
}

// ===== Pendientes por cliente: informes sin resolver y sin transmitir.
// Mismo endpoint y mismo render para las 2 vistas - el admin ve el agregado
// de todos los operadores ("Pendientes de Javi"), un operador ve solo lo
// suyo (así se entera él mismo, no solo el admin que lo mira). =====
async function iniRenderPendientesEn(listId, metaId){
  var list = document.getElementById(listId), meta = document.getElementById(metaId);
  if (!list) return;
  var res = await api('/api/inicio/pendientes-operador');
  if (!res.ok){ list.innerHTML = '<li class="ini-empty">No se pudo cargar.</li>'; return; }
  var d = res.data || {};
  var clientes = d.clientes || [];
  var metaTxt = (d.totalPendientes||0) + ' pendientes · ' + (d.totalSinTransmitir||0) + ' sin transmitir';
  if (d.totalCup) metaTxt += ' · ' + d.totalCup + ' del CUP';
  // Lo que se vence va primero en el texto: es lo único con fecha de caducidad.
  if (d.totalPorVencer) metaTxt = '⏳ ' + d.totalPorVencer + ' por vencer · ' + metaTxt;
  if (meta) meta.textContent = metaTxt;
  list.innerHTML = clientes.length ? clientes.map(function(c){
    // "Por vencer": OMEs validadas sin transmitir a las que les quedan pocos
    // días del plazo de PAMI. Se puede tocar para ver cuáles son.
    var venc = '';
    if (c.porVencer){
      var dr = c.diasRestantesMin;
      var t = c.porVencer + ' OME(s) por vencer' + (dr != null ? ' — la más urgente vence en ' + dr + (dr === 1 ? ' día' : ' días') : '') + '. Tocá para ver cuáles.';
      venc += '<button type="button" class="ini-pendop-badge vence" title="' + esc(t) + '" onclick="event.stopPropagation();abrirOmesPorVencer(\'' + esc(c.slug) + '\')">⏳ ' + c.porVencer + (dr != null ? ' · ' + dr + 'd' : '') + '</button>';
    }
    if (c.vencidas){
      venc += '<button type="button" class="ini-pendop-badge vencida" title="' + esc(c.vencidas + ' OME(s) que ya pasaron los 60 días sin transmitir: no se pueden transmitir más. Tocá para verlas.') + '" onclick="event.stopPropagation();abrirOmesPorVencer(\'' + esc(c.slug) + '\')">✖ ' + c.vencidas + '</button>';
    }
    // Toda la fila (nombre y números) lleva a donde se trabaja ese pendiente.
    // Los chips de vencimiento son la excepción: abren su propio detalle y
    // cortan la propagación para no disparar también la navegación.
    // Un consultorio con bandejaCup (ej. Caballito) también se trabaja en SU
    // dashboard, igual que un médico de cabecera - no en la Cabina.
    var esMC = c.tipo === 'med_cabecera' || !!c.bandejaCup;
    var destino = esMC ? 'Abre el dashboard de ' + c.nombre + ' para trabajar las bandejas del CUP.'
                       : 'Abre Informes recibidos de ' + c.nombre + '.';
    return '<li class="ini-pendop-row is-link" role="button" tabindex="0" title="' + esc(destino) + '"'
      + ' onclick="iniPendOpIr(\'' + esc(c.slug) + '\',' + (esMC ? 'true' : 'false') + ')"'
      + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();iniPendOpIr(\'' + esc(c.slug) + '\',' + (esMC ? 'true' : 'false') + ');}">'
      + '<span class="ini-pendop-nombre">'+esc(c.nombre)+'</span>'
      + '<span class="ini-pendop-badges">'
      + venc
      // Cada número abre el detalle de PACIENTES (sin valores: informes y bandeja
      // del CUP nunca los tuvieron) — mismo patrón que los chips de "por vencer".
      + (c.pendientes ? '<button type="button" class="ini-pendop-badge pend" title="Informes pendientes — tocá para ver cuáles" onclick="event.stopPropagation();abrirPendientesDetalle(\''+escJs(c.slug)+'\',\'pendientes\',\''+escJs(c.nombre)+'\')">'+c.pendientes+'</button>' : '')
      + (c.sinTransmitir ? '<button type="button" class="ini-pendop-badge transm" title="Sin transmitir — tocá para ver cuáles" onclick="event.stopPropagation();abrirPendientesDetalle(\''+escJs(c.slug)+'\',\'sinTransmitir\',\''+escJs(c.nombre)+'\')">'+c.sinTransmitir+'</button>' : '')
      + (c.cup ? '<button type="button" class="ini-pendop-badge cup" title="Del informe del CUP: falta validar o transmitir — tocá para ver cuáles" onclick="event.stopPropagation();abrirPendientesDetalle(\''+escJs(c.slug)+'\',\'cup\',\''+escJs(c.nombre)+'\')">'+c.cup+'</button>' : '')
      + '</span></li>';
  }).join('') : '<li class="ini-empty">Sin pendientes 🎉</li>';
}
// Desde el panel de pendientes, ir a donde ESE pendiente se trabaja: el médico
// de cabecera tiene su propio dashboard (bandejas del CUP, faltan validar /
// faltan informe); un consultorio se trabaja en la Cabina de informes, que
// además queda filtrada por ese cliente.
function iniPendOpIr(slug, esMC){
  if (esMC){ go('clientes'); selectClientWhenReady(slug, 'mescurso'); return; }
  go('cabina');
  cabinaElegirCliente(slug);
}
// La Cabina arma su lista de clientes recién al entrar (async): esperamos a que
// exista la opción antes de seleccionarla, igual que selectClientWhenReady.
function cabinaElegirCliente(slug, tries){
  tries = tries || 0;
  var sel = document.getElementById('cabCliente');
  if (sel && [].slice.call(sel.options).some(function(o){ return o.value === slug; })){
    if (sel.value !== slug){ sel.value = slug; loadCabinaView(); }
    return;
  }
  if (tries < 40) setTimeout(function(){ cabinaElegirCliente(slug, tries + 1); }, 100);
}
// Detalle de las OMEs por vencer de un cliente: el contador solo sirve si se
// puede ver qué hay atrás para ir a buscarlas.
async function abrirOmesPorVencer(slug){
  var body = document.getElementById('omesVencerBody');
  var meta = document.getElementById('omesVencerMeta');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="5" class="muted-cell">Cargando…</td></tr>';
  if (meta) meta.textContent = '';
  showModal('omesVencerModal', 'omesVencerScrim');
  var res = await api('/api/clientes/' + encodeURIComponent(slug) + '/omes-por-vencer');
  if (!res.ok){
    body.innerHTML = '<tr><td colspan="5" class="muted-cell">' + esc((res.data && res.data.error) || 'No se pudo cargar.') + '</td></tr>';
    return;
  }
  var d = res.data || {}, filas = d.filas || [];
  if (meta) meta.textContent = (d.nombre || slug) + ' · ' + (d.porVencer || 0) + ' por vencer'
    + (d.vencidas ? ' · ' + d.vencidas + ' ya vencida(s)' : '')
    + ' · PAMI da ' + (d.diasLimite || 60) + ' días desde la validación para transmitir';
  body.innerHTML = filas.length ? filas.map(function(f){
    var estado = f.vencida
      ? '<span class="ov-estado vencida" title="Pasaron los ' + (d.diasLimite || 60) + ' días: ya no se puede transmitir">Vencida</span>'
      : '<span class="ov-estado" title="Días que quedan para transmitirla">Quedan ' + f.diasRestantes + (f.diasRestantes === 1 ? ' día' : ' días') + '</span>';
    return '<tr>'
      + '<td class="wrap">' + esc(f.nombre || '-') + (f.benef ? '<div class="nom-muted">' + esc(f.benef) + '</div>' : '') + '</td>'
      + '<td class="num">' + estado + '</td>'
      + '<td class="wrap">' + esc(f.practica || '-') + '</td>'
      + '<td class="num">' + esc(f.ome || '-') + '</td>'
      + '<td class="num">' + esc(f.validada || '-') + '</td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="5" class="muted-cell">No hay OMEs por vencer en este cliente.</td></tr>';
}
function cerrarOmesPorVencer(){ hideModal('omesVencerModal', 'omesVencerScrim'); }
// Detalle de pacientes detrás de un número del panel de Pendientes (pendientes
// / sin transmitir / CUP): nunca muestra valores — informes y bandeja del CUP
// no los tienen. Genérico por cliente y tipo: sirve para cualquier cliente
// nuevo que se le asigne a un operador, sin tocar código.
// Texto que va DENTRO de comillas simples en un onclick: esc() solo cubre &<>"
// (HTML), así que la comilla simple hay que escaparla aparte o un cliente tipo
// "Sanatorio D'Or" rompe el botón.
function escJs(s){ return esc(String(s == null ? '' : s)).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
var PEND_DETALLE_LABEL = {
  pendientes: 'Informes pendientes', sinTransmitir: 'Sin transmitir',
  cup: 'Del informe del CUP (falta validar o transmitir)',
  'cup-validar': 'Faltan validar', 'cup-informe': 'Faltan informe',
  'cup-transmitidas': 'Transmitidas', 'cup-total': 'Total en bandeja'
};
async function abrirPendientesDetalle(slug, tipo, nombreCliente, month){
  var body = document.getElementById('pendDetalleBody');
  var meta = document.getElementById('pendDetalleMeta');
  var tit = document.getElementById('pendDetalleTitulo');
  var colFecha = document.getElementById('pendDetalleColFecha');
  if (!body) return;
  if (tit) tit.textContent = (PEND_DETALLE_LABEL[tipo] || 'Pendientes') + ' — ' + (nombreCliente || '');
  if (colFecha) colFecha.textContent = tipo.indexOf('cup') === 0 ? 'Turno' : 'Recibido';
  body.innerHTML = '<tr><td colspan="6" class="muted-cell">Cargando…</td></tr>';
  if (meta) meta.textContent = '';
  showModal('pendDetalleModal', 'pendDetalleScrim');
  var res = await api('/api/clientes/' + encodeURIComponent(slug) + '/pendientes-detalle?tipo=' + encodeURIComponent(tipo)
    + (month ? '&month=' + encodeURIComponent(month) : ''));
  if (!res.ok){
    body.innerHTML = '<tr><td colspan="6" class="muted-cell">' + esc((res.data && res.data.error) || 'No se pudo cargar.') + '</td></tr>';
    return;
  }
  var filas = (res.data && res.data.filas) || [];
  var total = (res.data && res.data.total) || filas.length;
  if (meta) meta.textContent = total > filas.length
    ? ('mostrando ' + filas.length + ' de ' + total)
    : (filas.length + (filas.length === 1 ? ' paciente' : ' pacientes'));
  body.innerHTML = filas.length ? filas.map(function(f){
    return '<tr>'
      + '<td class="wrap">' + esc(f.nombre || '-') + '</td>'
      + '<td class="num">' + esc(f.benef || '-') + '</td>'
      + '<td class="wrap">' + esc(f.practica || '-') + '</td>'
      + '<td class="numw">' + esc(f.ome || '-') + '</td>'
      + '<td class="num">' + esc(f.estado || '-') + '</td>'
      + '<td class="num">' + esc(f.turno || f.recibido || '-') + '</td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="6" class="muted-cell">Sin pacientes en esta categoría.</td></tr>';
}
function cerrarPendientesDetalle(){ hideModal('pendDetalleModal', 'pendDetalleScrim'); }
function iniCargarPendientesOperador(){ return iniRenderPendientesEn('iniPendOpList', 'iniPendOpMeta'); }
function iniCargarMisPendientes(){ return iniRenderPendientesEn('opPendList', 'opPendMeta'); }

// ===== Tareas propias del operador (Inicio de Javi) - mismo mecanismo que
// las de los admins (INICIO.tareas ya viene filtrada por el servidor a solo
// las suyas), pero sin elegir asignado (se las crea a sí mismo) y sin poder
// borrarlas (eso sigue siendo cosa de un admin). =====
function opRenderTareas(){
  var open = document.getElementById('opTasksOpen'), done = document.getElementById('opTasksDone');
  if(!open||!done) return;
  var abiertas = (INICIO.tareas||[]).filter(function(t){return !t.hecha;});
  var hechas = (INICIO.tareas||[]).filter(function(t){return t.hecha;});
  abiertas.sort(function(a,b){ var av=a.vence||'9999', bv=b.vence||'9999'; return av<bv?-1:(av>bv?1:0); });
  var opts = { sinBorrar:true, sinPara:true };
  open.innerHTML = abiertas.length ? abiertas.map(function(t){ return iniTareaHTML(t, opts); }).join('') : '<div class="ini-empty">No tenés tareas pendientes 🎉</div>';
  done.innerHTML = hechas.map(function(t){ return iniTareaHTML(t, opts); }).join('');
  var oc=document.getElementById('opTasksOpenCnt'); if(oc) oc.textContent = abiertas.length;
  var dc=document.getElementById('opTasksDoneCnt'); if(dc) dc.textContent = hechas.length;
}
async function opAgregarTarea(){
  var inp = document.getElementById('opTask'); if(!inp) return;
  var v = inp.value.trim(); if(!v) return;
  var vi = document.getElementById('opTaskVence');
  var res = await api('/api/inicio/tareas', { titulo:v, vence: (vi&&vi.value)||'' });
  if (!res.ok){ nsAlert(res.data.error || 'No se pudo agregar la tarea.'); return; }
  inp.value=''; if(vi) vi.value='';
  INICIO.tareas.unshift(res.data.tarea); opRenderTareas();
}

// ===== Inicio (admin): "Accesos rápidos" - catálogo configurable de atajos.
// Guardado en localStorage por usuario (conveniencia de este dispositivo, no
// dato compartido). Catálogo = vistas generales + un acceso directo por cliente. =====
// El catálogo respeta EXACTAMENTE los mismos permisos que ya gatean el
// sidebar/go() (aplicarUsuario, más arriba) - nada aparece acá que el rol no
// pueda realmente abrir. Solo los admin ven todo; el resto ve según su rol
// y, en clientes, según su lista restringida si la tiene.
function iniAccesosCatalogo(){
  var role = ME && ME.role;
  var esAdmin = role === 'admin';
  // Afiliados/Informes recibidos: mismo criterio que navPadron/navCabina (admin, operador, demo).
  var verHerramientas = esAdmin || role === 'operador' || role === 'demo';
  var restringido = tieneClientesRestringidos(ME);
  var items = [];
  if (esAdmin || role === 'operador') {
    items.push({ id:'v:informes', ic:'📋', tx:'Informes', run:function(){ go('informes'); } });
  }
  if (verHerramientas) {
    items.push({ id:'v:padron', ic:'👥', tx:'Afiliados', run:function(){ go('padron'); } });
    items.push({ id:'v:cabina', ic:'📥', tx:'Informes recibidos', run:function(){ go('cabina'); } });
  }
  // Cruzas, Nomencladores, Resumen de cuenta y Facturas: por ahora, solo admin
  // (Nomencladores todavía no le hace falta a un operador; el resto es de NS).
  if (esAdmin) {
    items.push({ id:'v:nomencladores', ic:'📑', tx:'Nomencladores', run:function(){ go('nomencladores'); } });
    items.push({ id:'v:cruzas', ic:'🔀', tx:'Cruzas', run:function(){ go('cruzas'); } });
    items.push({ id:'v:resumen', ic:'💰', tx:'Resumen de cuenta', run:function(){ go('resumen'); } });
    items.push({ id:'v:facturas', ic:'🧾', tx:'Facturas', run:function(){ go('facturas'); } });
    items.push({ id:'a:bandejas', ic:'🔄', tx:'Actualizar bandejas', run:function(){ abrirActualizarBandejas(); } });
  }
  // Plan Salud: entra derecho a la solapa del centro que lo tiene, sin pasar
  // por la lista de clientes. Solo aparece si ese centro está entre los suyos.
  if (puedeVerPlanSalud()) {
    var clientesPS = (typeof CLIENTS !== 'undefined' && CLIENTS ? CLIENTS : []).filter(function(c){ return slugTienePlanSalud(c.slug); });
    if (restringido) clientesPS = clientesPS.filter(function(c){ return ((ME && ME.clientes) || []).indexOf(c.slug) >= 0; });
    clientesPS.forEach(function(c){
      items.push({ id:'ps:' + c.slug, ic:'🩺', tx:'Plan Salud', run:function(){ go('clientes'); selectClientWhenReady(c.slug, 'plansalud'); } });
    });
  }
  // Configuración general: mismo criterio que navGeneral (oculto si tiene clientes restringidos).
  if (esAdmin || (role === 'operador' && !restringido)) {
    items.push({ id:'v:soon', ic:'⚙️', tx:'Configuración general', run:function(){ go('soon'); } });
  }
  var clientes = (typeof CLIENTS !== 'undefined' && CLIENTS) || [];
  var clientesVisibles = restringido ? clientes.filter(function(c){ return (ME.clientes||[]).indexOf(c.slug) >= 0; }) : clientes;
  clientesVisibles.forEach(function(c){
    items.push({ id:'c:'+c.slug, ic:'🏥', tx:c.name || c.slug, grupo:'clientes', run:function(){ go('clientes'); selectClientWhenReady(c.slug); } });
  });
  return items;
}
// Los ids de DOM cambian según de qué Inicio se trate (admin u operador) -
// las 2 vistas conviven siempre en el DOM (una queda oculta, no se destruye),
// así que no pueden compartir id. El resto de la lógica (catálogo, guardado,
// render) es exactamente la misma para las 2.
function iniAccesosIds(scope){
  // El editor ya no vive adentro de la tarjeta (ver #accesosModal, compartido
  // por las 2 vistas) - acá solo queda la grilla, que sigue siendo propia de
  // cada una (admin y operador conviven en el DOM, no pueden compartir id).
  return { grid: scope === 'op' ? 'opAccesosGrid' : 'iniAccesosGrid' };
}
function iniAccesosKey(){ return 'ns_accesos_rapidos_' + (ME && ME.username || ''); }
function iniAccesosElegidos(){
  try{ var v = JSON.parse(localStorage.getItem(iniAccesosKey())||'[]'); return Array.isArray(v)?v:[]; }catch(e){ return []; }
}
function iniAccesosGuardar(ids){
  try{ localStorage.setItem(iniAccesosKey(), JSON.stringify(ids)); }catch(e){}
}
async function iniAccesosRender(scope){
  var ids = iniAccesosIds(scope);
  var grid = document.getElementById(ids.grid); if (!grid) return;
  // El catálogo incluye un acceso por cliente - si todavía no se cargó la
  // lista (recién entrando a Inicio, sin haber abierto nunca "Clientes"), la
  // traemos acá para que los accesos elegidos aparezcan desde el principio.
  if (!CLIENTS || !CLIENTS.length){ var r = await api('/api/clientes'); if (r.ok) CLIENTS = r.data.clients || []; }
  var catalogo = iniAccesosCatalogo();
  var elegidos = iniAccesosElegidos();
  // Si algo elegido antes ya no está en el catálogo (por ejemplo, cambió el
  // rol o se restringió a clientes), se descarta acá - así el contador "X/9"
  // no queda atado a un acceso que ya ni se puede mostrar.
  var catIds = catalogo.map(function(it){ return it.id; });
  var elegidosValidos = elegidos.filter(function(id){ return catIds.indexOf(id) >= 0; });
  if (elegidosValidos.length !== elegidos.length){ elegidos = elegidosValidos; iniAccesosGuardar(elegidos); }
  var tiles = elegidos.map(function(id){ return catalogo.find(function(it){ return it.id===id; }); }).filter(Boolean);
  grid.innerHTML = tiles.length ? tiles.map(function(it, i){
    return '<button type="button" class="ini-acceso-tile" onclick="iniAccesosIr('+i+')"><span class="ic">'+it.ic+'</span><span class="tx">'+esc(it.tx)+'</span></button>';
  }).join('') : '<div class="ini-empty">Elegí hasta 9 accesos con "Editar".</div>';
  window.__iniAccesosTiles = tiles; // un solo usuario ve un solo Inicio por sesión, alcanza compartido
  iniAccesosRenderEditor(scope);
}
function iniAccesosIr(i){ var t = (window.__iniAccesosTiles||[])[i]; if (t) t.run(); }
// El editor vive en un modal compartido (#accesosModal): así el catálogo
// entero (puede ser largo - un ítem por cliente) queda siempre visible con
// scroll propio acotado al viewport, sin depender del alto fijo de la
// tarjeta ni de en qué resolución esté mirando la pantalla.
function iniAccesosAbrirModal(scope){
  iniAccesosRenderEditor(scope);
  showModal('accesosModal', 'accesosScrim');
}
function iniAccesosCerrarModal(){ hideModal('accesosModal', 'accesosScrim'); }
function iniAccesosRenderEditor(scope){
  var cont = document.getElementById('accesosModalCatalogo'); if (!cont) return;
  var catalogo = iniAccesosCatalogo();
  var elegidos = iniAccesosElegidos();
  var cnt = document.getElementById('accesosModalContador'); if (cnt) cnt.textContent = elegidos.length + ' / 9 elegidos';
  var lleno = elegidos.length >= 9;
  var htmlGeneral = catalogo.filter(function(it){ return it.grupo!=='clientes'; }).map(function(it){
    return iniAccesoOptHtml(it, elegidos, lleno, scope);
  }).join('');
  var clientesCat = catalogo.filter(function(it){ return it.grupo==='clientes'; });
  var htmlClientes = clientesCat.length ? '<div class="ini-acceso-grupo">Clientes</div>' + clientesCat.map(function(it){
    return iniAccesoOptHtml(it, elegidos, lleno, scope);
  }).join('') : '';
  cont.innerHTML = htmlGeneral + htmlClientes;
}
function iniAccesoOptHtml(it, elegidos, lleno, scope){
  var on = elegidos.indexOf(it.id) >= 0;
  var disabled = (!on && lleno) ? ' disabled' : '';
  return '<label class="ini-acceso-opt'+(!on&&lleno?' disabled':'')+'"><input type="checkbox"'+(on?' checked':'')+disabled+' onchange="iniAccesosToggle(\''+esc(it.id)+'\', this.checked, \''+(scope||'')+'\')">'+it.ic+' '+esc(it.tx)+'</label>';
}
function iniAccesosToggle(id, on, scope){
  var elegidos = iniAccesosElegidos();
  var i = elegidos.indexOf(id);
  if (on && i<0){ if (elegidos.length>=9) return; elegidos.push(id); }
  else if (!on && i>=0){ elegidos.splice(i,1); }
  iniAccesosGuardar(elegidos);
  iniAccesosRender(scope);
}
// Acceso rápido "Actualizar bandejas": pregunta qué grupos refrescar y deja el
// pedido de refresco on-demand (el server del VPS lo levanta en su próximo sondeo).
// El transmitir/no-transmitir va pegado al grupo: los "en análisis" (Potenciales)
// nunca transmiten aunque se fuerce; Consultorios y Med. Cabecera sí.
async function abrirActualizarBandejas(){
  var html = ''
    + '<div style="display:flex;flex-direction:column;gap:12px;text-align:left">'
    + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="actbCons" checked style="width:18px;height:18px"> <span><b>Consultorios</b> <span class="nom-muted">· incluye transmisión</span></span></label>'
    + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="actbMc" checked style="width:18px;height:18px"> <span><b>Med. Cabecera</b> <span class="nom-muted">· incluye transmisión</span></span></label>'
    + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="actbPot" checked style="width:18px;height:18px"> <span><b>Potenciales</b> <span class="nom-muted">· sin transmisión</span></span></label>'
    + '<div class="nom-muted" style="margin-top:2px;font-size:12px">Se transmite al toque (a cualquier hora) en los grupos que corresponde. El refresco arranca en unos minutos.</div>'
    + '</div>';
  var ok = await nsConfirm(null, { cuerpoHtml: html, titulo:'Actualizar bandejas', okLabel:'Actualizar' });
  if (!ok) return;
  var cons = !!(document.getElementById('actbCons')||{}).checked;
  var mc = !!(document.getElementById('actbMc')||{}).checked;
  var pot = !!(document.getElementById('actbPot')||{}).checked;
  if (!cons && !mc && !pot){ nsAlert('Elegí al menos un grupo para actualizar.'); return; }
  if (!CLIENTS || !CLIENTS.length){ var r0 = await api('/api/clientes'); if (r0.ok) CLIENTS = r0.data.clients || []; }
  var slugs = (CLIENTS||[]).filter(function(c){
    if (c.enAnalisis) return pot;             // Potenciales (en análisis)
    if (c.tipo === 'med_cabecera') return mc; // Med. Cabecera
    return cons;                               // Consultorios (el resto)
  }).map(function(c){ return c.slug; });
  if (!slugs.length){ nsAlert('No hay clientes en los grupos elegidos.'); return; }
  var res = await api('/api/bandeja/refresco/pedir', { slugs: slugs, forzarTransmision: true });
  if (!res.ok){ nsAlert((res.data && res.data.error) || 'No se pudo pedir el refresco.'); return; }
  nsAlert('Refresco pedido para ' + slugs.length + ' cliente(s). Arranca en unos minutos.', { titulo:'Actualizar bandejas' });
}

// ===== Reordenar las tarjetas del Inicio arrastrando una encima de otra.
// Cada tarjeta conserva su forma (una tarjeta angosta sigue siendo angosta
// donde caiga) - lo que se intercambia es el SLOT de la grilla, no el tamaño;
// un auto-acomodo tipo masonry sería de más para 4 tarjetas de tamaño fijo.
// Guardado por usuario en localStorage, mismo criterio que Accesos rápidos. =====
// ===== Paneles del Inicio: orden (arrastrar) + tamaño (botón ⤢) =====
// El layout es CSS Grid con grid-auto-flow:dense y una altura de fila FIJA
// (ver .ini-grid/.op-grid en styles.css) - el propio navegador acomoda las
// tarjetas sin pisarse ni dejar huecos según en qué ORDEN aparecen en el DOM
// y qué TAMAÑO (.ini-size-s/m/w/l) tiene cada una. No hay que calcular
// colisiones a mano: por eso es la opción de menor costo que igual resuelve
// "todos los módulos movibles y redimensionables".
// "actividad" (Actividad de operadores) solo la ve el admin y siempre está en
// su lista de paneles - la tarjeta misma se esconde con display:none si no
// aplica (ver cargarInicio), el grid ni se entera.
function iniPanelesDefault(scope){ return scope === 'op' ? ['chat','pendientes','tareas','accesos'] : ['msg','tareas','pendop','actividad','accesos']; }
// Tamaño de arranque de cada panel (el usuario lo cambia después con el
// botón ⤢, y desde ahí queda guardado). "m" = 1 columna alta (2 filas),
// "w" = ancho completo (2 columnas, 1 fila) - mismo alto que ya tenía el
// chat/Accesos rápidos por defecto, para no correr el piso a nadie.
function iniPanelesTamDefault(scope){
  // "pendientes" y "tareas" del operador son tarjetas simples (como pendop/
  // tareas del admin) desde que se separaron - antes "pendientes" traía la
  // sección de Tareas adentro y por eso necesitaba el doble de alto.
  return scope === 'op' ? { chat:'m', pendientes:'s', tareas:'s', accesos:'w' } : { msg:'m', tareas:'m', pendop:'s', actividad:'s', accesos:'s' };
}
var INI_TAMANOS = ['s', 'm', 'w', 'l'];
var INI_TAMANOS_LABEL = { s:'Chico', m:'Alto', w:'Ancho', l:'Grande' };
function iniPanelesKey(scope){ return 'ns_paneles_' + (scope || 'admin') + '_' + (ME && ME.username || ''); }
// Formato guardado: { orden:[...], tamanos:{panelId:'s'|'m'|'w'|'l'} }. Sigue
// leyendo el formato viejo (un array plano = solo orden) para no perder lo
// que cada usuario ya tenía guardado. Migra sola cuando se suma o se saca un
// panel (ej. "Actividad de operadores" el día que se agregó): conserva el
// orden de los que siguen existiendo, agrega al final los nuevos y descarta
// los que ya no están - así CUALQUIER panel nuevo que se sume a Inicio a
// futuro entra solo, sin romper el layout guardado de nadie.
function iniPanelesEstado(scope){
  var def = iniPanelesDefault(scope), estado = { orden: def.slice(), tamanos: iniPanelesTamDefault(scope) };
  try {
    var v = JSON.parse(localStorage.getItem(iniPanelesKey(scope)) || 'null');
    var ordenGuardado = Array.isArray(v) ? v : (v && v.orden);
    if (Array.isArray(ordenGuardado)) {
      var conocidos = ordenGuardado.filter(function(p){ return def.indexOf(p) >= 0; });
      var faltantes = def.filter(function(p){ return conocidos.indexOf(p) < 0; });
      if (conocidos.length) estado.orden = conocidos.concat(faltantes);
    }
    if (v && !Array.isArray(v) && v.tamanos) {
      def.forEach(function(p){ if (INI_TAMANOS.indexOf(v.tamanos[p]) >= 0) estado.tamanos[p] = v.tamanos[p]; });
    }
  } catch(e){}
  return estado;
}
function iniPanelesGuardar(scope, estado){ try{ localStorage.setItem(iniPanelesKey(scope), JSON.stringify(estado)); }catch(e){} }
function iniPanelesContenedor(scope){ return document.getElementById(scope === 'op' ? 'operadorPaneles' : 'inicioPaneles'); }
function iniPanelesAplicar(scope){
  var cont = iniPanelesContenedor(scope); if (!cont) return;
  var estado = iniPanelesEstado(scope);
  // El ORDEN es la posición real en el DOM - grid-auto-flow:dense las va
  // acomodando solas a partir de acá, sin que nada se pise.
  estado.orden.forEach(function(panelId){
    var el = cont.querySelector('[data-panel="' + panelId + '"]');
    if (el) cont.appendChild(el);
  });
  cont.querySelectorAll('[data-panel]').forEach(function(el){
    var id = el.getAttribute('data-panel');
    INI_TAMANOS.forEach(function(t){ el.classList.remove('ini-size-' + t); });
    el.classList.add('ini-size-' + (estado.tamanos[id] || 's'));
  });
}
function iniPanelesCambiarTamano(scope, panelId){
  var estado = iniPanelesEstado(scope);
  var actual = INI_TAMANOS.indexOf(estado.tamanos[panelId] || 's');
  estado.tamanos[panelId] = INI_TAMANOS[(actual + 1) % INI_TAMANOS.length];
  iniPanelesGuardar(scope, estado);
  iniPanelesAplicar(scope);
}
// Un botón (⤢) por tarjeta para cambiar el tamaño, inyectado una sola vez en
// el header. Es un <button> real: un click no dispara el arrastre del header
// (los navegadores ya evitan que un elemento interactivo anidado lo inicie).
function iniPanelesInyectarBotonesTamano(scope){
  var cont = iniPanelesContenedor(scope); if (!cont) return;
  cont.querySelectorAll('[data-panel]').forEach(function(el){
    var head = el.querySelector('.ini-head'); if (!head || head.querySelector('.ini-size-btn')) return;
    var panelId = el.getAttribute('data-panel');
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'ini-size-btn'; btn.title = 'Cambiar tamaño'; btn.textContent = '⤢';
    btn.addEventListener('click', function(e){ e.stopPropagation(); iniPanelesCambiarTamano(scope, panelId); });
    head.appendChild(btn);
  });
}
function iniPanelesWireDrag(scope){
  var cont = iniPanelesContenedor(scope); if (!cont || cont._dragWired) return;
  cont._dragWired = true;
  iniPanelesInyectarBotonesTamano(scope);
  var dragged = null;
  cont.querySelectorAll('[data-panel]').forEach(function(el){
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', function(e){ dragged = el; el.classList.add('ini-dragging'); try{ e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', el.getAttribute('data-panel')); }catch(ex){} });
    el.addEventListener('dragend', function(){ el.classList.remove('ini-dragging'); dragged = null; cont.querySelectorAll('.ini-drop-target').forEach(function(x){ x.classList.remove('ini-drop-target'); }); });
    el.addEventListener('dragover', function(e){ if (!dragged || dragged === el) return; e.preventDefault(); el.classList.add('ini-drop-target'); });
    el.addEventListener('dragleave', function(){ el.classList.remove('ini-drop-target'); });
    el.addEventListener('drop', function(e){
      e.preventDefault();
      el.classList.remove('ini-drop-target');
      if (!dragged || dragged === el) return;
      var a = dragged.getAttribute('data-panel'), b = el.getAttribute('data-panel');
      var estado = iniPanelesEstado(scope);
      var ia = estado.orden.indexOf(a), ib = estado.orden.indexOf(b);
      if (ia < 0 || ib < 0) return;
      estado.orden[ia] = b; estado.orden[ib] = a;
      iniPanelesGuardar(scope, estado);
      iniPanelesAplicar(scope);
    });
  });
}
function iniActualizarBell(){
  var dot = document.getElementById('bellDot');
  var total = iniTotalNoLeidos();   // campana = todos los canales
  var n = INICIO.unread || 0;        // badge del panel = canal actual
  if (dot) dot.style.display = total>0 ? '' : 'none';
  ['iniUnread','opUnread'].forEach(function(id){
    var badge = document.getElementById(id);
    if (!badge) return;
    if (n>0){ badge.style.display=''; badge.textContent = n>9?'9+':String(n); } else badge.style.display='none';
  });
}
async function iniRefrescarBell(){
  if (!iniPuedeVerInicio()){ var d=document.getElementById('bellDot'); if(d) d.style.display='none'; return; }
  var res = await api('/api/inicio/no-leidos');
  if (res.ok){
    INICIO.noLeidos = res.data.porCanal || {};
    INICIO.unread = INICIO.noLeidos[INICIO.canal || iniCanalDefault()] || 0;
    iniActualizarBell();
    iniRenderCanales();
  }
}
function iniRenderDrawer(){
  var body = document.getElementById('drawerBody'); if(!body) return;
  // Operador Clínica: la campana no avisa de mensajes del Inicio (no los ve),
  // avisa de lo que el centro tiene pendiente - mismo número que la pantalla
  // "Pendientes" del menú izquierdo. Sin nombre de NS: de cara al centro,
  // quién de nuestro equipo lo resuelve es un detalle interno, no algo que
  // tenga que verse acá.
  if (ME && ME.role === 'operador_clinica'){
    var np = OPCLI_PEND_TOTAL || 0;
    body.innerHTML = np>0
      ? '<div class="drawer-item" onclick="closeDrawer();go(\'clientes\');selectClientWhenReady(ME.centro,\'pendientes\')">'
        + '<div class="di-ic">🔔</div><div class="di-tx"><b>' + np + ' pendiente' + (np>1?'s':'') + '</b>'
        + '<span>Tocá para ver el detalle.</span></div></div>'
      : '<div class="empty"><div class="ico"><svg viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></div><b>No hay notificaciones</b><span>Cuando tengas algo pendiente, te va a aparecer acá.</span></div>';
    return;
  }
  var n = iniTotalNoLeidos();
  if (iniPuedeVerInicio() && n>0){
    body.innerHTML = '<div class="drawer-item" onclick="closeDrawer();go(\'dash\',navElFor(\'dash\'))">'
      + '<div class="di-ic">💬</div><div class="di-tx"><b>'+n+' mensaje'+(n>1?'s':'')+' nuevo'+(n>1?'s':'')+' en el Inicio</b>'
      + '<span>Tocá para leerlos.</span></div></div>';
  } else {
    body.innerHTML = '<div class="empty"><div class="ico"><svg viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></div><b>No hay notificaciones</b><span>Cuando Seba o Nacho dejen un mensaje en el Inicio, te va a aparecer acá.</span></div>';
  }
}
// Campana del Operador Clínica: mismo número que la pantalla "Pendientes"
// (ver loadClientPendientesCentro), consultado aparte porque esta campana
// puede sonar sin haber entrado nunca a esa pantalla.
var OPCLI_PEND_TOTAL = 0;
async function opClinicaRefrescarBell(){
  if (!(ME && ME.role === 'operador_clinica' && ME.centro)) return;
  var dot = document.getElementById('bellDot');
  var res = await api('/api/clientes/' + encodeURIComponent(ME.centro) + '/pendientes-centro');
  if (!res.ok || !res.data){ OPCLI_PEND_TOTAL = 0; if (dot) dot.style.display = 'none'; return; }
  var d = res.data;
  OPCLI_PEND_TOTAL = (d.pendientes||0) + (d.sinTransmitir||0) + (d.cup||0);
  if (dot) dot.style.display = OPCLI_PEND_TOTAL>0 ? '' : 'none';
}
function iniArrancar(){
  if (ME && ME.role === 'operador_clinica'){
    opClinicaRefrescarBell();
    if (!INICIO.pollTimer) INICIO.pollTimer = setInterval(function(){ if(document.visibilityState!=='hidden') opClinicaRefrescarBell(); }, 60000);
    return;
  }
  if (!iniPuedeVerInicio()){ iniActualizarBell(); return; }
  iniRefrescarBell();
  if (!INICIO.pollTimer){
    INICIO.pollTimer = setInterval(function(){ if(document.visibilityState!=='hidden') iniRefrescarBell(); }, 60000);
  }
}
// ---------- nomencladores ----------
var NOM_READY = false;
var NOM_TIMER = null;
var NOM_ACTIVE_PERIOD = '';
var NOM_MODULES = [];
var NOM_SELECTED_MODULES = [];
var CLIENTS = [];
var ACTIVE_CLIENT = null;
var CLIENT_NOM_TIMER = null;
// Última solapa de cliente usada: se recuerda entre clientes y entre recargas.
var CLIENT_SECTION = (function(){ try { return localStorage.getItem('ns_client_section') || 'dashboard'; } catch (e){ return 'dashboard'; } })();
var DASH_SECTION = 'resumen'; // hoja activa dentro de "Dashboard de reportes"
var CLIENT_REPORT_ROWS = [];
var CLIENT_REPORT_SHOW_ALL = false;  // true = renderizar todas las filas (reportes grandes) aunque tarde
var CLIENT_REPORT_QUERY = '';
var CLIENT_REPORT_PRACTICE_QUERY = '';
var CLIENT_REPORT_MODULE = '';
var CLIENT_REPORT_STATUS = '';
var CLIENT_REPORT_TRANS_FROM = '';
var CLIENT_REPORT_TRANS_TO = '';
var CLIENT_REPORT_QUICK_FILTER = '';
var CLIENT_REPORT_EXPECTED_AMOUNT = '';
var CLIENT_REPORT_SORT = '';
var CLIENT_REPORT_MODE = '';
var CLIENT_REPORT_ID = '';
var CLIENT_REPORT_DEBIT_STATUS = '';   // '' = no tocar (backend mantiene/defaultea), 'confirmado' al pegar validación PAMI
var CLIENT_REPORT_COTEJO_HECHO = false; // si el reporte tiene umbrales, queda pendiente hasta cotejar por módulo
var CLIENT_REPORT_SOURCE = null;
var CLIENT_REPORT_FILE = null;
var CLIENT_REPORT_OBSERVATIONS = '';
var CLIENT_SAVED_REPORTS = [];
function clientReportDraftKey(){
  return ACTIVE_CLIENT && ACTIVE_CLIENT.slug ? 'ns-client-report-draft:' + ACTIVE_CLIENT.slug : '';
}
function getClientReportTitleValue(){
  var title = document.getElementById('clientReportTitle');
  return title ? title.value : '';
}
function getClientReportObservationsValue(){
  var notes = document.getElementById('clientReportObservations');
  return notes ? notes.value : CLIENT_REPORT_OBSERVATIONS;
}
function saveClientReportDraft(){
  if (!ACTIVE_CLIENT || (CLIENT_REPORT_MODE !== 'draft' && CLIENT_REPORT_MODE !== 'edit') || !CLIENT_REPORT_ROWS.length) return;
  var key = clientReportDraftKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      savedAt:new Date().toISOString(),
      mode:CLIENT_REPORT_MODE,
      reportId:CLIENT_REPORT_ID,
      title:getClientReportTitleValue(),
      expectedAmount:CLIENT_REPORT_EXPECTED_AMOUNT,
      observations:getClientReportObservationsValue(),
      source:CLIENT_REPORT_SOURCE,
      rows:CLIENT_REPORT_ROWS
    }));
  } catch (e) {}
}
function removeClientReportDraft(){
  var key = clientReportDraftKey();
  if (!key) return;
  try { localStorage.removeItem(key); } catch (e) {}
}
// Recepción del centro (operador_clinica) no ve montos: ve quién falta, quién faltó,
// qué informe falta subir — pero no la facturación. Blanquear acá (y no en cada
// llamada) es la red de seguridad: cualquier pantalla que use moneyFmt para mostrar
// texto queda cubierta sola, sin tener que acordarse de tocarla una por una.
function veValoresCliente(){ return !(ME && ME.role === 'operador_clinica'); }
function moneyFmt(n){
  if (!veValoresCliente()) return '';
  var value = Number(n || 0);
  try { return value.toLocaleString('es-AR', { style:'currency', currency:'ARS', maximumFractionDigits:2 }); }
  catch (e) { return '$ ' + value.toFixed(2); }
}
function numberFmt(n){
  var value = Number(n || 0);
  try { return value.toLocaleString('es-AR', { maximumFractionDigits:0 }); }
  catch (e) { return String(Math.round(value)); }
}
// Monto compacto para las barras de tendencia: $1,2M / $980k / $540
function moneyCompact(n){
  var v = Math.abs(Number(n || 0));
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace('.', ',') + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
  return '$' + Math.round(v);
}
function shortMonth(label){ return String(label || '').trim().slice(0, 3); }
function pickDashPeriod(period){
  var sel = document.getElementById('clientDashPeriod');
  if (sel) { sel.value = period; loadClientDashboard(); }
}
function pctArrow(p){ var up = Number(p) >= 0; return (up ? '▲' : '▼') + ' ' + percentFmt(Math.abs(Number(p || 0))); }
// #1 Observacion: si el nomenclador vario entre los dos meses comparados, avisar
// que parte de la variacion de facturacion es por precio y no por volumen.
async function loadDashboardNomNote(period, against){
  var box = document.getElementById('clientDashboardNomNote');
  if (!box) return;
  if (!period || !against){ box.style.display = 'none'; box.innerHTML = ''; return; }
  var res = await api('/api/nomencladores/comparar?period=' + encodeURIComponent(period) + '&against=' + encodeURIComponent(against));
  if (!res.ok || !res.data || !res.data.hasPrevious){ box.style.display = 'none'; box.innerHTML = ''; return; }
  var d = res.data, g = d.general && d.general.avgPct;
  if (g === null || g === undefined){ box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  if (Math.abs(g) < 0.005){
    box.className = 'dashboard-nomnote flat';
    box.innerHTML = '<span class="nn-ic">✓</span><span>El nomenclador no varió entre ' + esc(d.previousLabel) + ' y ' + esc(d.label) + ': el cambio de facturación es por volumen (más/menos prácticas), no por precios.</span>';
  } else {
    var parts = [];
    if (d.general && d.general.avgPct != null) parts.push('general ' + pctArrow(d.general.avgPct));
    if (d.consultas && d.consultas.avgPct != null) parts.push('consultas ' + pctArrow(d.consultas.avgPct));
    if (d.nivel1 && d.nivel1.avgPct != null) parts.push('nivel 1 ' + pctArrow(d.nivel1.avgPct));
    box.className = 'dashboard-nomnote warn';
    box.innerHTML = '<span class="nn-ic">⚠️</span><span>El nomenclador cambió entre <b>' + esc(d.previousLabel) + '</b> y <b>' + esc(d.label) + '</b> (' + esc(parts.join(', ')) + '). Parte de la variación de facturación es por <b>precio</b>, no por volumen.</span>';
  }
}
// #3 Banderas: entre barra y barra, marcar si PAMI aumento en ese mes (tooltip).
async function loadTrendFlags(series){
  if (!series || series.length < 2) return;
  var res = await api('/api/nomencladores/variaciones');
  if (!res.ok || !res.data) return;
  var map = {};
  (res.data.variaciones || []).forEach(function(v){ map[v.from + '|' + v.to] = v; });
  var bars = document.querySelectorAll('#clientDashboardTrend .dtb');
  for (var i = 1; i < series.length; i++){
    var v = map[series[i - 1].period + '|' + series[i].period];
    if (!v || v.general === null || v.general === undefined || Math.abs(v.general) < 0.005) continue;
    var bar = bars[i];
    if (!bar) continue;
    var parts = [];
    if (v.consultas != null) parts.push('consultas ' + pctArrow(v.consultas));
    if (v.nivel1 != null) parts.push('nivel 1 ' + pctArrow(v.nivel1));
    if (v.general != null) parts.push('general ' + pctArrow(v.general));
    var flag = document.createElement('span');
    flag.className = 'dtb-flag';
    flag.textContent = '🚩';
    flag.title = 'PAMI ' + (v.general >= 0 ? 'aumentó' : 'bajó') + ' entre ' + shortMonth(series[i - 1].label || series[i - 1].period) + ' y ' + shortMonth(series[i].label || series[i].period) + ': ' + parts.join(', ');
    bar.appendChild(flag);
  }
}
function percentFmt(n){
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-';
  try { return Number(n).toLocaleString('es-AR', { style:'percent', maximumFractionDigits:1 }); }
  catch (e) { return Math.round(Number(n) * 1000) / 10 + '%'; }
}
function parseMoneyInput(value){
  var raw = String(value == null ? '' : value).trim();
  if (!raw) return 0;
  if (raw.indexOf(',') >= 0) raw = raw.replace(/\./g, '').replace(',', '.');
  raw = raw.replace(/[^\d.-]/g, '');
  var n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function cleanNomType(value){
  var text = String(value || '').trim();
  return (!text || text === '0') ? '-' : text;
}
function scopeLabel(scope){
  return scope === 'internacion' ? 'Internación' : scope === 'ambulatorio' ? 'Ambulatorio' : 'Otros';
}
function dateFmt(iso){
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('es-AR'); } catch (e) { return iso; }
}
function fillSelect(id, items){
  var el = document.getElementById(id);
  if (!el) return;
  var current = el.value;
  el.innerHTML = '<option value="">Todos</option>' + (items || []).map(function(item){
    return '<option value="' + esc(item.value) + '">' + esc(item.label) + '</option>';
  }).join('');
  if ([].slice.call(el.options).some(function(o){ return o.value === current; })) el.value = current;
}
function moduleOptionByValue(value){
  return NOM_MODULES.filter(function(item){ return item.value === value; })[0];
}
function updateModuleTrigger(){
  var trigger = document.getElementById('nomModuleTrigger');
  if (!trigger) return;
  if (!NOM_SELECTED_MODULES.length) {
    trigger.textContent = 'Todos';
    return;
  }
  if (NOM_SELECTED_MODULES.length === 1) {
    var item = moduleOptionByValue(NOM_SELECTED_MODULES[0]);
    trigger.textContent = item ? item.label : NOM_SELECTED_MODULES[0];
    return;
  }
  trigger.textContent = NOM_SELECTED_MODULES.length + ' modulos';
}
function renderModuleOptions(items){
  NOM_MODULES = items || [];
  NOM_SELECTED_MODULES = NOM_SELECTED_MODULES.filter(function(value){
    return NOM_MODULES.some(function(item){ return item.value === value; });
  });
  var box = document.getElementById('nomModuleOptions');
  if (!box) return;
  box.innerHTML = NOM_MODULES.map(function(item){
    var checked = NOM_SELECTED_MODULES.includes(item.value) ? ' checked' : '';
    return '<label class="multi-option"><input type="checkbox" value="' + esc(item.value) + '"' + checked + ' onchange="toggleModuleSelection(this)"> <span>' + esc(item.label) + '</span></label>';
  }).join('') || '<div class="multi-empty">Sin módulos</div>';
  filterModuleOptions();
  updateModuleTrigger();
}
// Filtra los checkboxes visibles según lo tipeado en el buscador del menú.
function filterModuleOptions(){
  var box = document.getElementById('nomModuleOptions');
  var input = document.getElementById('nomModuleSearch');
  if (!box) return;
  var q = normalizeReportSearch(input ? input.value : '');
  var any = false;
  box.querySelectorAll('.multi-option').forEach(function(lbl){
    var show = !q || normalizeReportSearch(lbl.textContent).indexOf(q) >= 0;
    lbl.style.display = show ? '' : 'none';
    if (show) any = true;
  });
  var none = box.querySelector('.multi-noresult');
  if (q && !any){
    if (!none){ none = document.createElement('div'); none.className = 'multi-empty multi-noresult'; none.textContent = 'Sin resultados'; box.appendChild(none); }
    none.style.display = '';
  } else if (none){ none.style.display = 'none'; }
}
function toggleModuleMenu(){
  var menu = document.getElementById('nomModuleMenu');
  if (!menu) return;
  var opened = menu.classList.toggle('show');
  if (opened){
    var input = document.getElementById('nomModuleSearch');
    if (input) setTimeout(function(){ input.focus(); }, 0);
  }
}
function toggleModuleSelection(input){
  var value = input.value;
  if (input.checked) {
    if (!NOM_SELECTED_MODULES.includes(value)) NOM_SELECTED_MODULES.push(value);
  } else {
    NOM_SELECTED_MODULES = NOM_SELECTED_MODULES.filter(function(item){ return item !== value; });
  }
  updateModuleTrigger();
  searchNomenclador();
}
function clearModuleSelection(){
  NOM_SELECTED_MODULES = [];
  document.querySelectorAll('#nomModuleOptions input[type="checkbox"]').forEach(function(input){ input.checked = false; });
  updateModuleTrigger();
  searchNomenclador();
}
document.addEventListener('click', function(event){
  var multi = document.getElementById('nomModuleMulti');
  var menu = document.getElementById('nomModuleMenu');
  if (multi && menu && !multi.contains(event.target)) menu.classList.remove('show');
});
function fillPeriodSelect(items, selected){
  var el = document.getElementById('nomPeriod');
  if (!el) return;
  var options = (items || []).map(function(item){
    var suffix = item.rowCount ? ' (' + item.rowCount + ')' : '';
    return '<option value="' + esc(item.value) + '">' + esc(item.label + suffix) + '</option>';
  }).join('');
  el.innerHTML = options || '<option value="">Sin cargar</option>';
  if (selected && [].slice.call(el.options).some(function(o){ return o.value === selected; })) el.value = selected;
  else if (el.options.length) el.value = el.options[0].value;
}
function fillClientPeriodSelect(items, selected){
  var el = document.getElementById('clientNomPeriod');
  if (!el) return;
  var list = items || [];
  el.innerHTML = (items || []).map(function(item){
    var suffix = item.rowCount ? ' (' + item.rowCount + ')' : '';
    return '<option value="' + esc(item.value) + '">' + esc(item.label + suffix) + '</option>';
  }).join('') || '<option value="">Sin cargar</option>';
  var preferred = selected || (list[0] ? list[0].value : '');
  if (preferred && [].slice.call(el.options).some(function(o){ return o.value === preferred; })) el.value = preferred;
  else if (el.options.length) el.value = el.options[0].value;
}
function fillClientReportPeriodSelect(items, selected){
  var el = document.getElementById('clientReportPeriod');
  if (!el) return;
  var list = items || [];
  el.innerHTML = list.map(function(item){
    var suffix = item.rowCount ? ' (' + item.rowCount + ')' : '';
    return '<option value="' + esc(item.value) + '">' + esc(item.label + suffix) + '</option>';
  }).join('') || '<option value="">Sin cargar</option>';
  var preferred = selected || (list[0] ? list[0].value : '');
  if (preferred && [].slice.call(el.options).some(function(o){ return o.value === preferred; })) el.value = preferred;
}
// Hojas del "Dashboard de reportes": Resumen / Módulos / Nomenclador. El
// nomenclador estaba antes al final de la página (había que scrollear todo
// el dashboard para verlo); ahora es una hoja propia, accesible de entrada.
function setDashSection(sec){
  DASH_SECTION = sec;
  var secc = { resumen: 'dash-sub-resumen', modulos: 'dash-sub-modulos', nomenclador: 'dash-sub-nomenclador' };
  var tabs = { resumen: 'dashTabResumen', modulos: 'dashTabModulos', nomenclador: 'dashTabNomenclador' };
  Object.keys(secc).forEach(function(k){
    var s = document.getElementById(secc[k]); if (s) s.style.display = (k === sec) ? '' : 'none';
    var t = document.getElementById(tabs[k]); if (t) t.classList.toggle('active', k === sec);
  });
  // Los controles Mes/Comparar/Comparativa son del comparativo de Resumen y Módulos.
  // El Nomenclador tiene su propio selector de período, así que ahí no van.
  var hdr = document.getElementById('clientDashHeaderControls');
  if (hdr) hdr.style.display = (sec === 'nomenclador') ? 'none' : '';
}
function renderNomencladorRows(rows, bodyId, metaId, total){
  var body = document.getElementById(bodyId);
  if (!body) return;
  var safeRows = rows || [];
  if (metaId) {
    document.getElementById(metaId).textContent = total + ' coincidencias' + (total > safeRows.length ? ' - mostrando ' + safeRows.length : '');
  }
  if (!safeRows.length){
    body.innerHTML = '<tr><td colspan="6" class="muted-cell">Sin resultados para esos filtros.</td></tr>';
    return;
  }
  body.innerHTML = safeRows.map(function(row){
    var scope = row.scope || 'otros';
    return '<tr>'
      + '<td><div class="nom-code">' + esc(row.moduleCode || '-') + '</div><div class="nom-muted">' + esc(row.moduleDescription || '') + '</div></td>'
      + '<td><div class="nom-practice-line"><span class="nom-code">' + esc(row.practiceCode || '-') + '</span><span class="nom-desc">' + esc(row.practiceDescription || '') + '</span></div>' + (row.observations ? '<div class="nom-muted">' + esc(row.observations) + '</div>' : '') + '</td>'
      + '<td class="nom-type">' + esc(cleanNomType(row.type)) + '</td>'
      + '<td><span class="scope-badge scope-' + esc(scope) + '">' + esc(scopeLabel(scope)) + '</span></td>'
      + '<td class="nom-money"><b>' + esc(moneyFmt(row.total)) + '</b><div class="nom-muted">H ' + esc(moneyFmt(row.honorarios)) + ' - G ' + esc(moneyFmt(row.gastos)) + '</div></td>'
      + '<td class="nom-auth">' + esc(row.authLevel || '-') + '</td>'
      + '</tr>';
  }).join('');
}
// ================= Informes: varios pacientes (lote) =================
var LOTE_ROWS = [];
var LOTE_LADOS = [{ v: 'noesp', t: 'No especificado' }, { v: 'derecho', t: 'Derecho' }, { v: 'izquierdo', t: 'Izquierdo' }, { v: 'bilateral', t: 'Bilateral' }];
function loteInit(){
  var c = document.getElementById('loteCentro');
  if (c){ var pv = c.value; var clientes = INFORMES_CFG.clientes || [];
    c.innerHTML = clientes.map(function(x){ return opt(x.slug, x.name); }).join('');
    if (pv && clientes.some(function(x){ return x.slug === pv; })) c.value = pv; }
  loteLlenarMedicos();
}
// Médicos disponibles para el cliente elegido (y, si ya hay lote detectado,
// que además firmen alguna de las prácticas realmente presentes).
function loteMedicosValidos(){
  var clienteSel = (document.getElementById('loteCentro') || {}).value || '';
  var keys = LOTE_ROWS.length ? uniq(LOTE_ROWS.map(function(r){ return r.modelo; }).filter(Boolean)) : null;
  return (INFORMES_CFG.medicos || []).filter(function(m){
    if (!scopeAplica(m.clientes, clienteSel)) return false;
    return keys ? keys.some(function(k){ return scopeAplica(m.modelos, k); }) : true;
  });
}
function loteLlenarMedicos(){
  var med = document.getElementById('loteMedico'); if (!med) return;
  var pm = med.value;
  var vals = loteMedicosValidos();
  // "Automático" = cada fila usa el médico de SU práctica (lo podés cambiar por fila).
  med.innerHTML = opt('', '🔄 Automático (según la práctica)')
    + vals.map(function(m){ return opt(m.id, m.nombre + (m.hasFirma ? '' : ' (sin firma)')); }).join('');
  med.value = (pm === '' || (pm && vals.some(function(m){ return m.id === pm; }))) ? pm : '';
}
// Una línea del pegado (tab-separada tipo Excel; si no hay tabs, 2+ espacios).
function loteParseLinea(linea){
  var cells = String(linea).split('\t');
  if (cells.length < 2) cells = String(linea).split(/\s{2,}/);
  cells = cells.map(function(s){ return s.trim(); });
  var out = { benef: '', nombre: '', codigo: '', practica: '', fecha: '' };
  for (var i = 0; i < cells.length; i++){
    var c = cells[i]; if (!c) continue;
    var mCod = c.match(/^(\d{4,6})\s*[-–]\s*(.+)$/);
    var mFec = c.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (!out.benef && /^\d{9,}$/.test(c)) { out.benef = c; continue; }
    if (!out.codigo && mCod) { out.codigo = mCod[1]; out.practica = mCod[2].trim(); continue; }
    if (!out.fecha && mFec) { out.fecha = mFec[1]; continue; }
    if (!out.nombre && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}/.test(c) && !/\d{4}/.test(c)) { out.nombre = c; continue; }
  }
  return out;
}
function loteModeloPorCodigo(codigo){
  if (!codigo) return '';
  // Un solo modelo por código de práctica ahora que no hay uno por cliente.
  var m = (INFORMES_CFG.modelos || []).find(function(x){ return String(x.codigoPractica) === String(codigo); });
  return m ? m.key : '';
}
function loteMedicoParaModelo(modelo, medDef){
  var meds = (INFORMES_CFG.medicos || []).filter(function(m){ return scopeAplica(m.modelos, modelo); });
  if (medDef && meds.some(function(m){ return m.id === medDef; })) return medDef;
  return meds.length ? meds[0].id : '';
}
// Si un paciente tiene 717111 y 717125 el mismo día -> combinado (sin importar
// el cliente: es el código el que dice si corresponde combinar, no el centro).
function loteCombinar(rows){
  var grupos = {};
  rows.forEach(function(r){ var k = r.benef + '|' + r.fecha; (grupos[k] = grupos[k] || []).push(r); });
  var out = [], hechos = {};
  rows.forEach(function(r){
    var k = r.benef + '|' + r.fecha, g = grupos[k];
    var tiene11 = g.some(function(x){ return x.codigo === '717111'; });
    var tiene25 = g.some(function(x){ return x.codigo === '717125'; });
    if (tiene11 && tiene25 && (r.codigo === '717111' || r.codigo === '717125')){
      if (hechos[k]) return; hechos[k] = true;
      var base = g.find(function(x){ return x.codigo === '717111'; }) || r;
      out.push({ nombre: base.nombre, benef: base.benef, fecha: base.fecha, codigo: '717111+717125', practica: 'Cerumen + tratamiento químico', modeloForzado: 'orl-combinado' });
      return;
    }
    out.push(r);
  });
  return out;
}
function loteDetectar(){
  var err = document.getElementById('loteError'); err.textContent = '';
  var lineas = document.getElementById('loteTexto').value.split(/\r?\n/).filter(function(l){ return l.trim(); });
  if (!lineas.length){ err.textContent = 'Pegá al menos una línea.'; return; }
  var parsed = lineas.map(loteParseLinea).filter(function(r){ return r.nombre || r.benef; });
  parsed = loteCombinar(parsed);
  var medDef = document.getElementById('loteMedico').value;
  LOTE_ROWS = parsed.map(function(r){
    var modelo = r.modeloForzado || loteModeloPorCodigo(r.codigo);
    var presets = modelo ? (INFORMES_CFG.descripciones || []).filter(function(d){ return scopeAplica(d.modelos, modelo); }) : [];
    return { nombre: r.nombre, benef: r.benef, fecha: r.fecha, documento: '', codigo: r.codigo, practicaTxt: r.practica,
      modelo: modelo, presetId: presets.length ? presets[0].id : '', lado: 'noesp', sexo: '', medicoId: modelo ? loteMedicoParaModelo(modelo, medDef) : '' };
  });
  loteLlenarMedicos(); // ahora que hay lote, acota el "por defecto" a los médicos de esas prácticas
  loteRender();
}
function loteRedetectar(){ loteLlenarMedicos(); if (LOTE_ROWS.length) loteDetectar(); }
function loteLimpiar(){
  document.getElementById('loteTexto').value = '';
  LOTE_ROWS = [];
  document.getElementById('loteError').textContent = '';
  var card = document.getElementById('loteResultCard'); if (card) card.style.display = 'none';
  loteLlenarMedicos();
}
function loteMedicoDefault(){
  var medDef = document.getElementById('loteMedico').value;
  LOTE_ROWS.forEach(function(row){ if (row.modelo) row.medicoId = loteMedicoParaModelo(row.modelo, medDef); });
  loteRender();
}
function loteRender(){
  // Los modelos ya no son por cliente (ver comentario en informes.js sobre
  // MODELOS): antes acá se filtraba por m.centro === centro, pero listarModelos()
  // hace rato dejó de mandar ese campo -> el filtro daba SIEMPRE vacío, y el
  // desplegable de "Práctica" quedaba sin ninguna opción real (solo el
  // placeholder "— sin plantilla —"), aunque el modelo ya estuviera bien
  // detectado por código puntualmente. Se usa el catálogo completo.
  var modelosCentro = INFORMES_CFG.modelos || [];
  var body = document.getElementById('loteBody'); if (!body) return;
  var ok = 0;
  body.innerHTML = LOTE_ROWS.map(function(row, i){
    var m = (INFORMES_CFG.modelos || []).find(function(x){ return x.key === row.modelo; });
    var listo = row.modelo && (!modeloRequiereSexo(row.modelo) || row.sexo);
    if (listo) ok++;
    var pracSel = '<select class="inp lote-inp" onchange="loteSetPractica(' + i + ',this.value)"><option value="">— sin plantilla —</option>'
      + modelosCentro.map(function(x){ return '<option value="' + esc(x.key) + '"' + (x.key === row.modelo ? ' selected' : '') + '>' + esc(x.short) + '</option>'; }).join('') + '</select>';
    var presets = row.modelo ? (INFORMES_CFG.descripciones || []).filter(function(d){ return scopeAplica(d.modelos, row.modelo); }) : [];
    var presetSel = presets.length
      ? '<select class="inp lote-inp" onchange="loteSetPreset(' + i + ',this.value)">'
        + presets.map(function(d){ return '<option value="' + esc(d.id) + '"' + (d.id === row.presetId ? ' selected' : '') + '>' + esc(presetLabel(d)) + '</option>'; }).join('')
        + '<option value="__custom__"' + (row.presetId === '__custom__' ? ' selected' : '') + '>Texto personalizado</option></select>'
      : '<span class="lote-muted">—</span>';
    var ladoSel = (m && m.requiereLado)
      ? '<select class="inp lote-inp" onchange="loteSetLado(' + i + ',this.value)">'
        + LOTE_LADOS.map(function(l){ return '<option value="' + l.v + '"' + (l.v === row.lado ? ' selected' : '') + '>' + l.t + '</option>'; }).join('') + '</select>'
      : '<span class="lote-muted">—</span>';
    var sexoCampo = row.modelo ? modeloSexoCampo(row.modelo) : null;
    var sexoSel = sexoCampo
      ? '<select class="inp lote-inp' + ((sexoCampo.requerido && !row.sexo) ? ' lote-req' : '') + '" onchange="loteSetSexo(' + i + ',this.value)"><option value="">Elegí…</option>'
        + (sexoCampo.opciones || []).map(function(o){ return '<option value="' + esc(o) + '"' + (o === row.sexo ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>'
      : '<span class="lote-muted">—</span>';
    var meds = row.modelo ? (INFORMES_CFG.medicos || []).filter(function(mm){ return scopeAplica(mm.modelos, row.modelo); }) : (INFORMES_CFG.medicos || []);
    var medSel = '<select class="inp lote-inp" onchange="loteSetMedico(' + i + ',this.value)">'
      + meds.map(function(mm){ return '<option value="' + esc(mm.id) + '"' + (mm.id === row.medicoId ? ' selected' : '') + '>' + esc(mm.nombre) + (mm.hasFirma ? '' : ' (s/f)') + '</option>'; }).join('')
      + '<option value=""' + (row.medicoId ? '' : ' selected') + '>Sin firma</option></select>';
    var dl = row.modelo ? '<button class="rowbtn" title="Descargar este PDF" onclick="loteDescargarFila(' + i + ')"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' : '<span class="lote-muted">sin plantilla</span>';
    return '<tr' + (row.modelo ? '' : ' class="lote-row-off"') + '>'
      + '<td><div class="lote-nom">' + esc(row.nombre || '—') + '</div><div class="lote-muted">' + esc(row.benef || '') + ' · ' + esc(row.fecha || '—') + '</div></td>'
      + '<td>' + pracSel + '<div class="lote-muted">' + esc(row.codigo || '') + '</div></td>'
      + '<td>' + presetSel + '</td><td>' + sexoSel + '</td><td>' + ladoSel + '</td><td>' + medSel + '</td>'
      + '<td style="text-align:right">' + dl + '</td></tr>';
  }).join('') || '<tr><td colspan="7" class="lote-muted" style="padding:14px">No se detectaron pacientes.</td></tr>';
  document.getElementById('loteCount').textContent = LOTE_ROWS.length;
  document.getElementById('loteOkCount').textContent = ok;
  document.getElementById('loteResultCard').style.display = LOTE_ROWS.length ? '' : 'none';
  document.getElementById('loteZipBtn').disabled = ok === 0;
}
function loteSetPractica(i, key){
  LOTE_ROWS[i].modelo = key;
  var presets = key ? (INFORMES_CFG.descripciones || []).filter(function(d){ return scopeAplica(d.modelos, key); }) : [];
  LOTE_ROWS[i].presetId = presets.length ? presets[0].id : '';
  LOTE_ROWS[i].medicoId = key ? loteMedicoParaModelo(key, document.getElementById('loteMedico').value) : '';
  loteRender();
}
function loteSetPreset(i, id){ LOTE_ROWS[i].presetId = id; }
function loteSetLado(i, v){ LOTE_ROWS[i].lado = v; }
function loteSetMedico(i, id){ LOTE_ROWS[i].medicoId = id; }
function loteSetSexo(i, v){ LOTE_ROWS[i].sexo = v; loteRender(); }
function loteTextoDe(row){
  if (row.presetId === '__custom__') return row.texto || '';
  var p = presetById(row.presetId); if (!p) return '';
  if (row.lado && p.ladoTextos && p.ladoTextos[row.lado]) return p.ladoTextos[row.lado];
  var sx = String(row.sexo || '').toLowerCase();
  if (sx && p.textoPorSexo && p.textoPorSexo[sx]) return p.textoPorSexo[sx];
  return p.texto || '';
}
function loteItemPayload(row){
  if (!row.modelo) return null;
  if (modeloRequiereSexo(row.modelo) && !row.sexo) return null;  // falta el sexo obligatorio
  var p = presetById(row.presetId);
  var modelo = (INFORMES_CFG.modelos || []).find(function(m){ return m.key === row.modelo; }) || {};
  // Base: defaults del modelo → valores del preset → overlay por sexo (diagnóstico).
  var valores = {};
  (modelo.campos || []).forEach(function(c){ if (c.default) valores[c.key] = c.default; });
  if (p && p.valores) Object.keys(p.valores).forEach(function(k){ valores[k] = p.valores[k]; });
  if (row.sexo){
    valores.sexo = row.sexo;
    var over = (p && p.valoresPorSexo && p.valoresPorSexo[String(row.sexo).toLowerCase()]) || {};
    Object.keys(over).forEach(function(k){ valores[k] = over[k]; });
  }
  return { modelo: row.modelo,
    clienteSlug: (document.getElementById('loteCentro') || {}).value || '',
    paciente: { nombre: row.nombre, benef: row.benef, fecha: row.fecha, documento: row.documento || '' },
    textoInforme: loteTextoDe(row), medicoId: row.medicoId || '', valores: valores };
}
async function loteDescargarFila(i){
  var row = LOTE_ROWS[i];
  if (row && row.modelo && modeloRequiereSexo(row.modelo) && !row.sexo){ nsAlert('Elegí el sexo de ' + (row.nombre || 'este paciente') + ' antes de generar.'); return; }
  var payload = loteItemPayload(row); if (!payload) return;
  var r = await fetch('/api/informes/generar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok){ var d = {}; try { d = await r.json(); } catch (e) {} nsAlert((d && d.error) || 'No se pudo generar.'); return; }
  var blob = await r.blob(); var cd = r.headers.get('content-disposition') || ''; var m = cd.match(/filename="([^"]+)"/);
  bajarBlob(blob, m ? m[1] : 'informe.pdf');
}
async function loteGenerarZip(){
  var err = document.getElementById('loteError'); err.textContent = '';
  // Filas con plantilla que no van a generar por falta del sexo obligatorio.
  var faltanSexo = LOTE_ROWS.filter(function(r){ return r.modelo && modeloRequiereSexo(r.modelo) && !r.sexo; });
  var items = LOTE_ROWS.map(loteItemPayload).filter(Boolean);
  if (!items.length){ err.textContent = faltanSexo.length ? 'Elegí el sexo de los pacientes marcados antes de generar.' : 'No hay pacientes con plantilla para generar.'; return; }
  if (faltanSexo.length && !await nsConfirm(faltanSexo.length + ' paciente(s) sin sexo elegido no se van a incluir. ¿Generar el resto igual?', { titulo:'Faltan datos', okLabel:'Generar el resto' })) return;
  var btn = document.getElementById('loteZipBtn'); btn.disabled = true; var t = btn.textContent; btn.textContent = 'Generando…';
  try {
    var r = await fetch('/api/informes/lote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: items }) });
    if (!r.ok){ var d = {}; try { d = await r.json(); } catch (e) {} err.textContent = (d && d.error) || 'No se pudo generar el lote.'; return; }
    var blob = await r.blob(); var cd = r.headers.get('content-disposition') || ''; var m = cd.match(/filename="([^"]+)"/);
    bajarBlob(blob, m ? m[1] : 'Informes_lote.zip');
  } catch (e){ err.textContent = 'No se pudo generar el lote.'; }
  finally { btn.disabled = false; btn.textContent = t; }
}
async function loadClients(options){
  options = options || {};
  var res = await api('/api/clientes');
  if (!res.ok) return;
  CLIENTS = res.data.clients || [];
  if (!ACTIVE_CLIENT && CLIENTS.length) ACTIVE_CLIENT = CLIENTS[0];
  renderClientList();
  if (options.detail === false) return;
  renderActiveClient();
}
// En qué grupo del menú va un cliente (Consultorios/Med. Cabecera/Potenciales) -
// mismo campo que manda el server (client.seccion, ver normalizeClient). El
// fallback es solo por las dudas; el server ya lo normaliza siempre.
function clienteSeccion(c){
  if (c && c.seccion) return c.seccion;
  if (c && c.enAnalisis) return 'potencial';
  return (c && c.tipo === 'med_cabecera') ? 'med_cabecera' : 'consultorio';
}
// Mover un cliente a otra sección de menú (drag&drop o cualquier otro caller).
// Liviano: solo pega la sección nueva, no toca el resto de los datos.
async function moverClienteSeccion(slug, seccion){
  var r = await req('PATCH', '/api/clientes/' + encodeURIComponent(slug) + '/seccion', { seccion: seccion });
  if (!r.ok) { alert((r.data && r.data.error) || 'No se pudo mover el cliente.'); return; }
  CLIENTS = r.data.clients || CLIENTS;
  if (ACTIVE_CLIENT && ACTIVE_CLIENT.slug === slug) ACTIVE_CLIENT = CLIENTS.filter(function(c){ return c.slug === slug; })[0] || ACTIVE_CLIENT;
  renderClientList();
}
// Drag&drop entre las 3 listas del menú (Consultorios/Med. Cabecera/Potenciales):
// arrastrar un cliente a otro grupo lo mueve de sección, sin abrir ningún modal.
// Solo para admin (únicos que pueden editar clientes).
function iniDragDropSecciones(){
  var grupos = [
    { id: 'clientNavListConsultorios', seccion: 'consultorio' },
    { id: 'clientNavListMedCab', seccion: 'med_cabecera' },
    { id: 'clientNavListPotenciales', seccion: 'potencial' }
  ];
  grupos.forEach(function(g){
    var el = document.getElementById(g.id);
    if (!el || el._dragHooked) return;
    el._dragHooked = true;
    el.addEventListener('dragover', function(e){ e.preventDefault(); el.classList.add('drop-target'); });
    el.addEventListener('dragleave', function(){ el.classList.remove('drop-target'); });
    el.addEventListener('drop', function(e){
      e.preventDefault();
      el.classList.remove('drop-target');
      var slug = e.dataTransfer.getData('text/plain');
      if (!slug) return;
      var actual = CLIENTS.filter(function(c){ return c.slug === slug; })[0];
      if (actual && clienteSeccion(actual) === g.seccion) return; // ya está ahí
      moverClienteSeccion(slug, g.seccion);
    });
  });
  document.addEventListener('dragstart', function(e){
    var a = e.target.closest && e.target.closest('.client-nav-item[draggable="true"]');
    if (!a) return;
    var slug = a.getAttribute('data-client-slug');
    if (!slug) return;
    e.dataTransfer.setData('text/plain', slug);
    e.dataTransfer.effectAllowed = 'move';
  });
}
function renderClientList(){
  var cons = document.getElementById('clientNavListConsultorios');
  var med = document.getElementById('clientNavListMedCab');
  var medGroup = document.getElementById('navGroupMedCab');
  if (!cons) return;
  // --- Clínica: el menú son las SECCIONES de su propio centro (no una lista de
  // clientes). El header del grupo pasa a ser el nombre del centro. ---
  if (ME && ME.role === 'clinica' && ME.centro){
    var centroCli = CLIENTS.filter(function(c){ return c.slug === ME.centro; })[0];
    var hdrCli = document.querySelector('#navGroupConsultorios .nav-parent span');
    if (hdrCli) hdrCli.textContent = centroCli ? centroCli.name : 'Mi centro';
    // Las solapas de arriba están ocultas para la clínica por CSS (client-tabs):
    // este menú de la izquierda ES su navegación. Por eso todo lo que la clínica
    // puede abrir tiene que estar acá (una sección de su centro con `section`, o
    // una vista propia de la herramienta con `view`, como Crear informes).
    // Cada ítem lleva su capacidad; el admin prende/apaga cada una por usuario.
    // "Crear informes" (y todo lo de OMEs) va bajo la capacidad 'omes'.
    var SECC_CLINICA = [
      { label: 'Dashboard',            section: 'mescurso',     cap: 'dashboard' },
      { label: 'Reportes',             section: 'dashboard',    cap: 'reportes' },
      { label: 'Crear informes',       view: 'informes',        cap: 'omes' },
      { label: 'Liberar cupo',         view: 'liberarcupo',     cap: 'liberarcupo' },
      { label: 'Credencial provisoria', section: 'credencialcli', cap: 'credencial' },
      { label: 'Usuarios del centro',  section: 'usuarioscli',  cap: 'usuarios' },
      { label: 'Honorarios',           section: 'honorarios',   cap: 'honorarios' },
      { label: 'Datos del centro',     section: 'basica',       cap: 'datos' },
    ].filter(function(s){ return clinicaTieneCap(s.cap); });
    // ¿Estamos parados en una vista aparte (Crear informes / Liberar cupo) y no
    // en una sección del centro? Sirve para el resaltado del ítem activo.
    var vistaActiva = function(v){ var el = document.getElementById('view-' + v); return !!(el && el.style.display === 'block'); };
    var enVistaAparte = vistaActiva('informes') || vistaActiva('liberarcupo');
    cons.innerHTML = SECC_CLINICA.map(function(s){
      var active = s.view
        ? (vistaActiva(s.view) ? ' active' : '')
        : (ACTIVE_CLIENT && !enVistaAparte && CLIENT_SECTION === s.section ? ' active' : '');
      var attr = s.view ? ('data-cli-view="' + s.view + '"') : ('data-cli-section="' + s.section + '"');
      return '<button class="client-nav-item' + active + '" type="button" ' + attr + '>' + s.label + '</button>';
    }).join('');
    if (med) med.innerHTML = '';
    if (medGroup) medGroup.style.display = 'none';
    // El menú de la clínica ES su navegación: el grupo va SIEMPRE abierto (si no,
    // el .nav-sub queda display:none y no se ve nada). Además go() lo cierra al
    // salir de la vista de clientes (ej. al abrir "Crear informes"), así que lo
    // reabrimos en cada render para que el menú no desaparezca.
    var grpCli = document.getElementById('navGroupConsultorios');
    if (grpCli){ grpCli.style.display = ''; grpCli.classList.add('open'); }
    cons.querySelectorAll('[data-cli-view]').forEach(function(btn){
      btn.addEventListener('click', function(){ go(btn.getAttribute('data-cli-view')); renderClientList(); });
    });
    cons.querySelectorAll('[data-cli-section]').forEach(function(btn){
      btn.addEventListener('click', function(){
        go('clientes'); selectClient(ME.centro); setClientSection(btn.getAttribute('data-cli-section')); renderClientList();
      });
    });
    // Clínica no gestiona OTROS clientes de NS (ni siquiera el pipeline de
    // "potenciales"): esa lista es interna nuestra. La limpiamos siempre acá,
    // en vez de confiar en que haya quedado vacía de un render anterior (ej.
    // el modo espejo del admin, que sí la puebla con TODOS los clientes).
    var potGroupCli = document.getElementById('navGroupPotenciales');
    var potListCli = document.getElementById('clientNavListPotenciales');
    if (potListCli) potListCli.innerHTML = '';
    if (potGroupCli) potGroupCli.style.display = 'none';
    return;
  }
  // --- Operador Clínica: mismo mecanismo que clínica (menú = secciones de su
  // propio centro), pero lista propia y corta a propósito - por ahora una sola
  // pantalla, sin plata ni gráficas. Se le suman de a una a medida que se
  // construyen (ver PDF "Empleado Cliente"), nunca heredando de la de clínica. ---
  if (ME && ME.role === 'operador_clinica' && ME.centro){
    var centroOpCli = CLIENTS.filter(function(c){ return c.slug === ME.centro; })[0];
    var hdrOpCli = document.querySelector('#navGroupConsultorios .nav-parent span');
    if (hdrOpCli) hdrOpCli.textContent = centroOpCli ? centroOpCli.name : 'Mi centro';
    var SECC_OPCLINICA = [
      { key: 'pendientes', label: 'Pendientes' },
      { key: 'basica', label: 'Datos del centro' },
    ];
    cons.innerHTML = SECC_OPCLINICA.map(function(s){
      var active = (ACTIVE_CLIENT && CLIENT_SECTION === s.key) ? ' active' : '';
      return '<button class="client-nav-item' + active + '" type="button" data-cli-section="' + s.key + '">' + s.label + '</button>';
    }).join('');
    if (med) med.innerHTML = '';
    if (medGroup) medGroup.style.display = 'none';
    // Igual que la clínica: el grupo va siempre abierto y visible, si no el menú
    // (que es toda su navegación) queda oculto.
    var grpOpCli = document.getElementById('navGroupConsultorios');
    if (grpOpCli){ grpOpCli.style.display = ''; grpOpCli.classList.add('open'); }
    cons.querySelectorAll('[data-cli-section]').forEach(function(btn){
      btn.addEventListener('click', function(){
        go('clientes'); selectClient(ME.centro); setClientSection(btn.getAttribute('data-cli-section')); renderClientList();
      });
    });
    // Ídem clínica: "potenciales" es el pipeline comercial de NS, no algo que un
    // empleado del centro deba ver (mucho menos el nombre de otro cliente/
    // prospecto). Se limpia siempre, no se asume que ya esté vacío.
    var potGroupOp = document.getElementById('navGroupPotenciales');
    var potListOp = document.getElementById('clientNavListPotenciales');
    if (potListOp) potListOp.innerHTML = '';
    if (potGroupOp) potGroupOp.style.display = 'none';
    return;
  }
  // Sección de menú de un cliente (ver normalizeClient/seccion en server.js):
  // fallback defensivo por si algo viejo llegara sin normalizar, pero el
  // server siempre la manda ya calculada.
  var esAdminReal = !!(ME && ME.role === 'admin');
  var itemHtml = function(client){
    var active = ACTIVE_CLIENT && ACTIVE_CLIENT.slug === client.slug ? ' active' : '';
    // Arrastrable solo para el admin (es quien puede moverlo de sección).
    var drag = esAdminReal ? ' draggable="true"' : '';
    return '<a class="client-nav-item' + active + '" href="#clientes/' + esc(client.slug) + '" data-client-slug="' + esc(client.slug) + '"' + drag + '>' + esc(client.name) + '</a>';
  };
  var pot = document.getElementById('clientNavListPotenciales');
  var potGroup = document.getElementById('navGroupPotenciales');
  // Los "en análisis" (potenciales) van a su propia sección, salen de Consultorios/MedCab.
  // Demo, y un operador con lista propia, ven SOLO los clientes que se les
  // asignaron. En el servidor ya se filtra, pero el modo espejo no cambia la
  // sesión (sigue siendo la del admin y trae la lista completa), así que el
  // filtro va también acá para que la vista previa muestre exactamente lo que
  // va a ver esa persona.
  var restringido = tieneClientesRestringidos(ME);
  var esColaborador = !!(ME && ME.role === 'colaborador');
  var VISIBLES = CLIENTS;
  if (restringido){
    var permitidos = (ME && ME.clientes) || [];
    VISIBLES = CLIENTS.filter(function(c){ return permitidos.indexOf(c.slug) >= 0; });
  }
  // Sección de menú: campo propio del cliente (seccion), independiente de tipo/
  // enAnalisis - el admin la cambia desde "Editar cliente" o arrastrando en el
  // menú (ver clienteSeccion() y moverClienteSeccion()). Default 'consultorio'
  // por si algo viejo llega sin normalizar (no debería pasar: el server siempre
  // la manda).
  var consultorios = VISIBLES.filter(function(c){ return clienteSeccion(c) === 'consultorio'; });
  // Al operador, de los consultorios le aparecen SOLO aquellos en los que tiene
  // algo para hacer: hoy, los que tienen Plan Salud, o los que tienen su propio
  // tablero de bandeja CUP (ej. Caballito Pediátrico - ver bandejaCup). Sin
  // esto no podría entrar a esas pantallas, porque el grupo Consultorios está
  // oculto para su rol.
  if (ME && ME.role === 'operador') consultorios = consultorios.filter(function(c){ return slugTienePlanSalud(c.slug) || c.bandejaCup; });
  var medCab = VISIBLES.filter(function(c){ return clienteSeccion(c) === 'med_cabecera'; });
  // Potenciales clientes: el usuario de DEMOSTRACIÓN no los ve nunca (no le
  // mostramos a un prospecto el pipeline comercial). El colaborador sí, pero
  // solo los que estén dentro de su propia lista asignada.
  var potenciales = (restringido && !esColaborador) ? [] : VISIBLES.filter(function(c){ return clienteSeccion(c) === 'potencial'; });
  cons.innerHTML = consultorios.map(itemHtml).join('');
  if (med) med.innerHTML = medCab.map(itemHtml).join('');
  if (medGroup) medGroup.style.display = medCab.length ? '' : 'none';
  // Al operador se le oculta Consultorios salvo que le haya quedado alguno
  // arriba (los de Plan Salud): antes se ocultaba siempre, porque solo
  // trabajaba con Med. Cabecera - sigue siendo una decisión de alcance, no
  // falta de datos, pero ahora el alcance incluye Plan Salud.
  var consGroup = document.getElementById('navGroupConsultorios');
  if (consGroup) consGroup.style.display = (ME && ME.role === 'operador' && !consultorios.length) ? 'none' : '';
  if (pot) pot.innerHTML = potenciales.map(itemHtml).join('');
  if (potGroup) potGroup.style.display = potenciales.length ? '' : 'none';
  // Para el colaborador la separación interna de NS (consultorios vs médicos de
  // cabecera) no significa nada: para él son, simplemente, los clientes.
  var consHdr = document.querySelector('#navGroupConsultorios .nav-parent span');
  if (consHdr) consHdr.textContent = esColaborador ? 'Clientes' : 'Consultorios';
  var medHdr = document.querySelector('#navGroupMedCab .nav-parent span');
  if (medHdr) medHdr.textContent = 'Med. Cabecera';
  document.querySelectorAll('#clientNavListConsultorios [data-client-slug], #clientNavListMedCab [data-client-slug], #clientNavListPotenciales [data-client-slug]').forEach(function(button){
    button.addEventListener('click', function(e){
      // Ctrl/Cmd/Shift+click: dejar que el navegador abra el href en pestaña/ventana nueva.
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      go('clientes');
      selectClient(button.getAttribute('data-client-slug'));
    });
  });
  var createBtn = document.getElementById('clientNewBtn');
  // Clase (no style inline) para que el modo colapsado pueda ocultarlo.
  if (createBtn) createBtn.classList.toggle('is-admin', !!(ME && ME.role === 'admin'));
  // Los grupos de clientes arrancan SIEMPRE cerrados: el usuario los despliega cuando
  // quiere. Antes se abría el del cliente activo, pero como nunca se cerraba, el menú
  // quedaba desplegado solo (típico: "Consultorios" abierto sin haberlo tocado).
  // Drag&drop entre secciones (solo admin - moverClienteSeccion/iniDragDropSecciones).
  // Ojo: un grupo vacío (medGroup/potGroup arriba) queda con display:none y no
  // sirve como blanco para soltar - hoy no es un caso real (siempre hay algo en
  // Consultorios/Potenciales), pero si alguna vez Med. Cabecera queda en cero,
  // no se le puede arrastrar nada hasta que tenga uno (se puede mover por el
  // dropdown "Sección" de Editar cliente igual, ese camino no depende de esto).
  if (esAdminReal) iniDragDropSecciones();
}
function selectClient(slug){
  ACTIVE_CLIENT = CLIENTS.filter(function(client){ return client.slug === slug; })[0] || ACTIVE_CLIENT;
  if (ACTIVE_CLIENT && (ACTIVE_CLIENT.tipo === 'med_cabecera' || ACTIVE_CLIENT.bandejaCup) && CLIENT_SECTION === 'general') CLIENT_SECTION = 'mescurso';
  // NO forzamos la solapa: se mantiene la última usada (CLIENT_SECTION). Si venís
  // por un link con solapa, selectClientWhenReady la aplica después.
  setDashSection('resumen');
  renderClientList();
  renderActiveClient();
}
var CLIENT_SECTIONS = [
  { key:'mescurso',  sec:'client-section-mescurso',  tab:'clientTabMescurso',  crumb:'Dashboard mes en curso' },
  { key:'basica',    sec:'client-section-basica',    tab:'clientTabBasica',    crumb:'Información básica' },
  { key:'dashboard', sec:'client-section-dashboard', tab:'clientTabDashboard', crumb:'Dashboard de reportes' },
  { key:'reportes',  sec:'client-section-reportes',  tab:'clientTabReportes',  crumb:'Adjuntar reporte' },
  { key:'medicos',   sec:'client-section-medicos',   tab:'clientTabMedicos',   crumb:'Usuarios médicos' },
  { key:'honorarios',sec:'client-section-honorarios',tab:'clientTabHonorarios',crumb:'Honorarios' },
  { key:'credencialcli',sec:'client-section-credencial',tab:'clientTabCredencialCli',crumb:'Credencial provisoria' },
  { key:'usuarioscli',sec:'client-section-usuarios',tab:'clientTabUsuariosCli',crumb:'Usuarios del centro' },
  { key:'general',   sec:'client-section-general',   tab:'clientTabGeneral',   crumb:'Dashboard general' },
  { key:'osdop',     sec:'client-section-osdop',     tab:'clientTabOsdop',     crumb:'OSDOP' },
  { key:'plansalud', sec:'client-section-plansalud', tab:'clientTabPlanSalud',crumb:'Plan Salud' },
  // Sin pestaña propia todavía (nadie más que operador_clinica la usa, que
  // navega por el menú izquierdo, no por pestañas - ver renderClientList).
  { key:'pendientes',sec:'client-section-pendientes',tab:'',                  crumb:'Pendientes' }
];
// Plan Salud (CIMA): módulo en desarrollo por etapas, visible SOLO para estos
// usuarios puntuales (no es un tema de rol — ni "Dube" ni ningún otro admin
// nuevo lo debe ver por default). Sumar a alguien es agregar su username acá.
var PLAN_SALUD_USUARIOS = ['seba', 'nacho'];
// Capacidades del rol clínica (qué ve): las configura el admin por usuario.
// ME.capacidades ya viene resuelto del server (default = todo menos "omes").
var CLINICA_CAP_DEFAULT_FRONT = ['dashboard', 'reportes', 'credencial', 'honorarios', 'usuarios', 'datos'];
function capacidadesCliente(){
  if (!(ME && ME.role === 'clinica')) return [];
  return Array.isArray(ME.capacidades) ? ME.capacidades : CLINICA_CAP_DEFAULT_FRONT.slice();
}
function clinicaTieneCap(cap){ return capacidadesCliente().indexOf(cap) >= 0; }
// ===== Modelo de permisos del rol `operador` (Javi): POR USUARIO Y POR CLIENTE
// Las herramientas de NS (Informes, Generar OME, Afiliados, Informes recibidos,
// Liberar cupo) ya no viven sueltas en el menú lateral: entran como PESTAÑA
// dentro de cada cliente, ya scopeadas a ese cliente. Qué ve en cada uno lo
// define el admin (Configuración → Usuarios), y se guarda en
// ME.modulosCliente = { "<slug>": ["mescurso","cabina",…] }.
// Dos familias de módulo, porque se abren distinto:
//  - 'seccion': una solapa del cliente de siempre (CLIENT_SECTIONS).
//  - 'vista'  : una herramienta de NS (view-*), que se abre debajo del header
//               del cliente con ese cliente ya elegido (ver abrirHerramientaCliente).
var OPERADOR_MODULOS = [
  { key:'mescurso',    label:'Dashboard',          tipo:'seccion' },
  { key:'basica',      label:'Información básica', tipo:'seccion' },
  { key:'plansalud',   label:'Plan Salud',         tipo:'seccion' },
  { key:'general',     label:'Dashboard general',  tipo:'seccion' },
  { key:'cabina',      label:'Informes recibidos', tipo:'vista' },
  { key:'informes',    label:'Informes',           tipo:'vista' },
  { key:'omeweb',      label:'Generar OME',        tipo:'vista' },
  { key:'padron',      label:'Afiliados',          tipo:'vista' },
  { key:'liberarcupo', label:'Liberar cupo',       tipo:'vista' }
];
function operadorModuloLabel(key){
  var m = OPERADOR_MODULOS.filter(function(x){ return x.key === key; })[0];
  return m ? m.label : key;
}
// Qué módulos tiene este operador en ESTE cliente. Si el admin todavía no lo
// configuró, se cae al default derivado (lo que ese cliente ya mostraba), así
// el día del deploy nadie se queda sin nada y la config se va llenando de a poco.
function modulosClienteDe(slug){
  slug = String(slug || '');
  var cfg = ME && ME.modulosCliente;
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, slug) && Array.isArray(cfg[slug])) return cfg[slug];
  return modulosClienteDefault(slug);
}
function modulosClienteDefault(slug){
  var c = (CLIENTS || []).filter(function(x){ return x.slug === slug; })[0] || {};
  var tablero = (c.tipo === 'med_cabecera' || !!c.bandejaCup);
  var m = [];
  if (tablero) m.push('mescurso');
  if (slugTienePlanSalud(slug)) m.push('plansalud');
  m.push('basica');
  if (tablero) m.push('general');
  return m;
}
// Qué pestañas ve cada tipo de cliente. Los médicos de cabecera tienen tablero
// propio desde la bandeja automática; no usan valorización ni reportes cerrados.
// Los consultorios suman "Usuarios médicos" (solo admin, porque maneja claves).
function clientSeccionesPermitidas(){
  var esClinica = (ME && ME.role === 'clinica');
  var esOperador = (ME && ME.role === 'operador');
  var esMC = ACTIVE_CLIENT && ACTIVE_CLIENT.tipo === 'med_cabecera';
  // Consultorio con "bandejaCup" (ej. Caballito Pediátrico): mismo tablero que
  // un médico de cabecera, pero sigue siendo Consultorio en todo lo demás. El
  // operador (Javi) de un consultorio normal solo ve "Información básica" -
  // acá lo tratamos como si fuera médico de cabecera SOLO para destrabarle el
  // tablero (mescurso/general), sin tocar el "esMC" real que usan las otras
  // ramas (admin, colaborador) para no ensancharle a Caballito el resto de
  // pestañas de un médico de cabecera.
  var esTableroCup = esMC || !!(ACTIVE_CLIENT && ACTIVE_CLIENT.bandejaCup);
  // Colaborador (socio externo, solo lectura): por ahora SOLO los dashboards.
  // Es una lista propia y corta a propósito: los módulos se le van sumando de a
  // uno acá, no hereda nada por estar en la misma rama que otro rol.
  if (ME && ME.role === 'colaborador') return esMC ? ['mescurso'] : ['mescurso', 'dashboard'];
  // Operador Clínica (empleado del centro): Información básica + Pendientes
  // (mismo contador que ve Javi de este centro). Cero plata, cero gráficas.
  // Lista propia y corta, igual criterio que arriba.
  if (ME && ME.role === 'operador_clinica') return ['basica', 'pendientes'];
  // El operador ve, de un médico de cabecera (Scheffelaar/Dubesarky), lo
  // mismo que un admin salvo OSDOP (facturación, no es su trabajo) - es una
  // lista propia, no "la del admin menos algo": si mañana se suma OTRA
  // herramienta especial de algún médico puntual, no le llega sola por
  // heredar la lista del admin. De un consultorio normal sigue viendo SOLO
  // la información básica: nada de dashboards, adjuntar reporte, honorarios
  // ni usuarios médicos.
  // Plan Salud: en un centro que lo tenga, el operador suma esa solapa a la
  // Información básica que ya veía. Va primero en la lista a propósito: es la
  // que usa para trabajar, así que es donde aterriza por defecto
  // (setClientSection cae en permitidas[0]) - la básica queda a un clic.
  // Operador NS: las solapas salen de lo que el admin le habilitó en ESTE
  // cliente (ver OPERADOR_MODULOS / modulosClienteDe). Las herramientas de NS
  // del mismo catálogo no son solapas: se dibujan aparte, en renderTabsHerramientas().
  if (esOperador){
    var modsOp = modulosClienteDe((ACTIVE_CLIENT && ACTIVE_CLIENT.slug) || '');
    var secsOp = OPERADOR_MODULOS
      .filter(function(m){ return m.tipo === 'seccion' && modsOp.indexOf(m.key) >= 0; })
      .map(function(m){ return m.key; });
    return secsOp.length ? secsOp : ['basica'];
  }
  if (esMC) {
    var seccionesMC = ['mescurso', 'basica'];
    // OSDOP: calculadora de facturación, por ahora exclusiva de Scheffelaar.
    if (ACTIVE_CLIENT.slug === 'scheffelaar-mc') seccionesMC.push('osdop');
    seccionesMC.push('general');
    return seccionesMC;
  }
  // Clínica (dueño): qué secciones ve lo configura el admin por usuario
  // (capacidades). Default cuando no hay nada guardado: todo menos "omes".
  // "Crear informes" no es una sección de acá: es una vista aparte, va en el
  // menú por SECC_CLINICA y la gatea la capacidad 'omes'.
  if (esClinica){
    var caps = capacidadesCliente();
    var permitCli = [];
    if (caps.indexOf('dashboard') >= 0) permitCli.push('mescurso');
    if (caps.indexOf('reportes') >= 0) permitCli.push('dashboard');
    if (caps.indexOf('credencial') >= 0) permitCli.push('credencialcli');
    if (caps.indexOf('honorarios') >= 0) permitCli.push('honorarios');
    if (caps.indexOf('usuarios') >= 0) permitCli.push('usuarioscli');
    if (caps.indexOf('datos') >= 0) permitCli.push('basica');
    if (clienteTienePlanSalud() && puedeVerPlanSalud()) permitCli.push('plansalud');
    return permitCli;
  }
  var base = ['mescurso', 'basica', 'dashboard', 'honorarios', 'reportes'];
  // Médicos: por ahora solo admin (no se le muestra al centro).
  if (ME && ME.role === 'admin') base.push('medicos');
  // Plan Salud: SOLO en centros que ya la tienen conectada (hoy: CIMA -
  // clienteTienePlanSalud) y solo para quien puede verla (el operador entra
  // por rol; el admin/socio, solo si está en PLAN_SALUD_USUARIOS). Antes el
  // admin la veía en CUALQUIER centro "para poder conectar la planilla", pero
  // eso terminaba mostrando la pestaña en todos los clientes sin planilla -
  // nadie sin acceso a un centro con Plan Salud debe verla ahí.
  if (clienteTienePlanSalud() && puedeVerPlanSalud()) base.push('plansalud');
  return base;
}
// Quién entra a Plan Salud además del admin: el operador POR ROL (es su
// trabajo, y el estándar del proyecto es que todos los de un rol tengan lo
// mismo), y los admin/socios que estén en el allowlist por persona mientras
// el módulo esté en desarrollo.
function puedeVerPlanSalud(){
  if (!ME) return false;
  if (ME.role === 'operador') return true;
  return PLAN_SALUD_USUARIOS.indexOf(ME.username) >= 0;
}
// Qué centros tienen el módulo de Plan Salud = los que tienen planilla
// conectada en el server (se cargan con cargarPlanSaludSlugs; CIMA viene
// sembrado).
var PLAN_SALUD_SLUGS = ['cima'];
function slugTienePlanSalud(slug){ return PLAN_SALUD_SLUGS.indexOf(String(slug || '')) >= 0; }
async function cargarPlanSaludSlugs(){
  try {
    var r = await api('/api/plan-salud/clientes');
    if (r.ok && r.data && Array.isArray(r.data.slugs)) {
      PLAN_SALUD_SLUGS = r.data.slugs;
      if (typeof ACTIVE_CLIENT !== 'undefined' && ACTIVE_CLIENT) aplicarPestanasCliente();
    }
  } catch (e) {}
}
function clienteTienePlanSalud(){
  return !!(ACTIVE_CLIENT && slugTienePlanSalud(ACTIVE_CLIENT.slug));
}
// ===== Herramientas de NS como pestaña DEL CLIENTE (rol operador) =====
// Una herramienta abierta es UNA SECCIÓN MÁS del cliente: CLIENT_SECTION puede
// valer 'cabina', 'padron', etc. Se modeló así (y no como un estado paralelo)
// porque TODO el flujo que ya existe — renderActiveClient, el hash, F5, el
// localStorage de "última solapa" — pasa por CLIENT_SECTION. Con un estado
// aparte, cada re-render volvía a la solapa anterior y cerraba la herramienta.
function esHerramientaDeCliente(key){
  if (!(ME && ME.role === 'operador') || !ACTIVE_CLIENT) return false;
  var m = OPERADOR_MODULOS.filter(function(x){ return x.key === key && x.tipo === 'vista'; })[0];
  if (!m) return false;
  return modulosClienteDe(ACTIVE_CLIENT.slug).indexOf(key) >= 0;
}
function renderTabsHerramientas(){
  var cont = document.getElementById('clientToolTabs');
  if (!cont) return;
  if (!(ME && ME.role === 'operador') || !ACTIVE_CLIENT){ cont.innerHTML = ''; return; }
  var mods = modulosClienteDe(ACTIVE_CLIENT.slug);
  cont.innerHTML = OPERADOR_MODULOS
    .filter(function(m){ return m.tipo === 'vista' && mods.indexOf(m.key) >= 0; })
    .map(function(m){
      return '<button type="button"' + (CLIENT_SECTION === m.key ? ' class="active"' : '')
        + ' data-cli-tool="' + esc(m.key) + '">' + esc(m.label) + '</button>';
    }).join('');
  cont.querySelectorAll('[data-cli-tool]').forEach(function(b){
    b.addEventListener('click', function(){ setClientSection(b.getAttribute('data-cli-tool')); });
  });
}
// Abre una herramienta SIN salirse del cliente: go() muestra la vista de la
// herramienta, y acá volvemos a mostrar la vista de clientes (header +
// pestañas) con sus secciones ocultas. Como todos los view-* son hermanos en el
// DOM, la herramienta queda justo debajo del header del cliente.
// Idempotente a propósito: si un re-render la vuelve a pedir, se re-aplica sin
// romper nada.
function abrirHerramientaCliente(view){
  if (!ACTIVE_CLIENT) return;
  var slug = ACTIVE_CLIENT.slug;
  go(view);
  var vc = document.getElementById('view-clientes');
  if (vc) vc.style.display = 'block';
  // go() sacó el "modo cliente" (porque la vista activa no es 'clientes') y con
  // eso se iba el encabezado con el nombre del centro: sin él la herramienta
  // queda flotando y no se sabe sobre qué cliente se está trabajando.
  document.body.classList.add('client-view');
  var tb = document.querySelector('.topbar');
  if (tb) tb.classList.add('client-mode');
  CLIENT_SECTIONS.forEach(function(s){
    var sec = document.getElementById(s.sec); if (sec) sec.style.display = 'none';
    var tab = document.getElementById(s.tab); if (tab) tab.classList.remove('active');
  });
  preseleccionarClienteEnHerramienta(view, slug);
  renderTabsHerramientas();
  var crumb = document.getElementById('clientCrumbSection');
  if (crumb) crumb.textContent = operadorModuloLabel(view);
  pushHash('clientes/' + slug + '/' + view);
}
// La herramienta trae su propio selector de cliente (se llena async): esperamos
// a que exista la opción y la elegimos, igual que cabinaElegirCliente.
function elegirClienteEnSelector(id, slug, luego, tries){
  tries = tries || 0;
  var sel = document.getElementById(id);
  if (sel && [].slice.call(sel.options).some(function(o){ return o.value === slug; })){
    if (sel.value !== slug){ sel.value = slug; if (typeof luego === 'function') luego(); }
    return;
  }
  if (tries < 40) setTimeout(function(){ elegirClienteEnSelector(id, slug, luego, tries + 1); }, 100);
}
// Qué selector de "Cliente" trae cada herramienta. Abierta como pestaña DEL
// cliente, ese selector sobra (el cliente ya lo elegiste al entrar) y encima
// invita a cambiarlo, que es justo lo que no queremos: se oculta.
var HERRAMIENTA_SELECTOR = { cabina:'cabCliente', liberarcupo:'lcCliente', padron:'padCliente', omeweb:'omeCliente', informes:'infCentro' };
function mostrarSelectorDeHerramienta(view, mostrar){
  var id = HERRAMIENTA_SELECTOR[view];
  if (!id) return;
  var sel = document.getElementById(id);
  var wrap = sel && (sel.closest('.field') || sel.parentElement);
  if (wrap) wrap.style.display = mostrar ? '' : 'none';
}
function preseleccionarClienteEnHerramienta(view, slug){
  mostrarSelectorDeHerramienta(view, false);
  if (view === 'cabina') return cabinaElegirCliente(slug);
  if (view === 'liberarcupo') return elegirClienteEnSelector('lcCliente', slug, onLiberarCupoCliente);
  if (view === 'padron') return elegirClienteEnSelector('padCliente', slug, loadPadronView);
  if (view === 'omeweb') return elegirClienteEnSelector('omeCliente', slug, function(){ onOmeClienteChange(); });
  if (view === 'informes') return elegirClienteEnSelector('infCentro', slug, function(){ if (typeof onCentroChange === 'function') onCentroChange(); });
}
// Muestra/oculta las pestañas según el tipo de cliente.
function aplicarPestanasCliente(){
  var permitidas = clientSeccionesPermitidas();
  var esMC = ACTIVE_CLIENT && ACTIVE_CLIENT.tipo === 'med_cabecera';
  var tabMes = document.getElementById('clientTabMescurso');
  if (tabMes) tabMes.textContent = esMC ? 'Dashboard' : 'Dashboard mes en curso';
  var tabGeneral = document.getElementById('clientTabGeneral');
  if (tabGeneral) tabGeneral.textContent = esMC ? 'Configuración' : 'Dashboard general';
  CLIENT_SECTIONS.forEach(function(s){
    var tab = document.getElementById(s.tab);
    if (tab) tab.style.display = permitidas.indexOf(s.key) >= 0 ? '' : 'none';
  });
  renderTabsHerramientas();
}
function setClientSection(section){
  // Una herramienta de NS (Informes recibidos, Afiliados, …) es una sección más
  // para el operador: se guarda igual en CLIENT_SECTION y se abre acá, así el
  // hash, el F5 y cada re-render la respetan en vez de volver a la solapa vieja.
  if (esHerramientaDeCliente(section)){
    CLIENT_SECTION = section;
    try { localStorage.setItem('ns_client_section', CLIENT_SECTION); } catch (e){}
    abrirHerramientaCliente(section);
    return;
  }
  // Veníamos de una herramienta y volvemos a una solapa normal: hay que
  // esconder su vista (go() no la esconde porque seguimos en "clientes") y
  // devolverle su selector de cliente, por si alguien la abre después desde el
  // menú (admin/operador sin restringir).
  OPERADOR_MODULOS.forEach(function(m){
    if (m.tipo !== 'vista') return;
    var el = document.getElementById('view-' + m.key);
    if (el && m.key !== section){ el.style.display = 'none'; mostrarSelectorDeHerramienta(m.key, true); }
  });
  var permitidas = clientSeccionesPermitidas();
  if (permitidas.indexOf(section) < 0) section = permitidas[0];
  var found = null;
  for (var i = 0; i < CLIENT_SECTIONS.length; i++){ if (CLIENT_SECTIONS[i].key === section){ found = CLIENT_SECTIONS[i]; break; } }
  if (!found) found = CLIENT_SECTIONS[2]; // por defecto: Dashboard de reportes
  CLIENT_SECTION = found.key;
  try { localStorage.setItem('ns_client_section', CLIENT_SECTION); } catch (e){}
  CLIENT_SECTIONS.forEach(function(s){
    var sec = document.getElementById(s.sec);
    var tab = document.getElementById(s.tab);
    if (sec) sec.style.display = s.key === CLIENT_SECTION ? 'block' : 'none';
    if (tab) tab.classList.toggle('active', s.key === CLIENT_SECTION);
  });
  renderTabsHerramientas();
  var crumb = document.getElementById('clientCrumbSection');
  if (crumb) crumb.textContent = clientSectionCrumb(found);
  // El hash guarda cliente + sub-solapa, así F5 restaura la solapa exacta.
  if (ACTIVE_CLIENT) pushHash('clientes/' + ACTIVE_CLIENT.slug + '/' + CLIENT_SECTION);
  // La bandeja (puede ser grande) se carga recién al abrir su solapa, no en cada
  // cambio de cliente.
  if (CLIENT_SECTION === 'mescurso') loadClientMesCurso();
  // Igual que la bandeja: si alguien dejó este cliente abierto y mientras tanto
  // se cerró/subió un reporte nuevo (o se confirmaron débitos), al volver a esta
  // solapa había que salir y reentrar al cliente para verlo — ahora se repide.
  if (CLIENT_SECTION === 'dashboard') loadClientDashboard();
  if (CLIENT_SECTION === 'general') renderClientGeneral();
  if (CLIENT_SECTION === 'medicos') loadClientMedicos();
  if (CLIENT_SECTION === 'honorarios') loadClientHonorarios();
  if (CLIENT_SECTION === 'osdop') renderOsdop();
  if (CLIENT_SECTION === 'plansalud') renderPlanSalud();
  if (CLIENT_SECTION === 'pendientes') loadClientPendientesCentro();
  if (CLIENT_SECTION === 'usuarioscli') loadClientUsuarios();
}
function clientSectionCrumb(found){
  if (ACTIVE_CLIENT && ACTIVE_CLIENT.tipo === 'med_cabecera') {
    if (found.key === 'mescurso') return 'Dashboard';
    if (found.key === 'general') return 'Configuración';
  }
  return found.crumb;
}
// Pendientes del centro (operador_clinica): mismos 3 números que ve el
// operador de NS de este cliente en su Inicio, sin plata ni detalle de
// pacientes - eso sigue viviendo en la Cabina de informes, que no es de acá.
// El título de la tarjeta es un saludo con el nombre DEL CENTRO (mismo estilo
// que saludoHTML del Inicio de NS) - los informes que faltan son de/para ESE
// centro, así que es lo que tiene que verse, no quién de NS los resuelve.
async function loadClientPendientesCentro(){
  var box = document.getElementById('centroPendCard');
  if (!box || !ACTIVE_CLIENT) return;
  var tit = document.getElementById('centroPendSaludo');
  if (tit) tit.innerHTML = saludoHTML({ name: ACTIVE_CLIENT.name });
  box.innerHTML = '<p class="nom-muted">Cargando…</p>';
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/pendientes-centro');
  if (!res.ok || !res.data){ box.innerHTML = '<p class="nom-muted">No se pudo cargar.</p>'; return; }
  var d = res.data;
  var total = (d.pendientes||0) + (d.sinTransmitir||0) + (d.cup||0);
  if (!total){ box.innerHTML = '<p class="nom-muted">Sin pendientes 🎉 No hay nada esperando resolución por ahora.</p>'; return; }
  var filas = [];
  if (d.pendientes) filas.push({ n:d.pendientes, tx:'informe' + (d.pendientes===1?'':'s') + ' asignado' + (d.pendientes===1?'':'s') + ' en gestión' });
  if (d.sinTransmitir) filas.push({ n:d.sinTransmitir, tx:'informe' + (d.sinTransmitir===1?'':'s') + ' resuelto' + (d.sinTransmitir===1?'':'s') + ', falta transmitir' });
  if (d.cup) filas.push({ n:d.cup, tx:'pendiente' + (d.cup===1?'':'s') + ' de validar o transmitir' });
  box.innerHTML = filas.map(function(f){
    return '<div class="ini-pendop-row" style="padding:10px 0;border-bottom:1px solid var(--border)">'
      + '<span class="ini-pendop-badge pend">' + f.n + '</span> <span>' + esc(f.tx) + '</span></div>';
  }).join('');
}
// ===== Autogestión de usuarios del centro (rol clínica) =====
// La clínica administra a sus propios empleados (operador_clinica de su centro):
// crear, activar/desactivar, cambiar a qué entra (módulos), resetear clave, borrar.
// El backend fuerza rol y centro; acá solo armamos la pantalla.
var USR_MODULOS_LABEL = { padron:'Afiliados', informes:'Generar informes', liberarcupo:'Liberar cupo' };
var USR_MODULOS_DISP = [];  // módulos que la clínica puede delegar (según sus capacidades; los manda el server)
function cliUsrCentroSlug(){ return (ME && ME.centro) || (ACTIVE_CLIENT && ACTIVE_CLIENT.slug) || ''; }
async function loadClientUsuarios(){
  var cont = document.getElementById('cliUsrList');
  if (!cont) return;
  var slug = cliUsrCentroSlug();
  if (!slug){ cont.innerHTML = '<div class="cfg-empty">No se pudo determinar el centro.</div>'; return; }
  cont.innerHTML = '<div class="cfg-empty">Cargando…</div>';
  var res = await api('/api/clientes/' + encodeURIComponent(slug) + '/usuarios');
  if (!res.ok || !res.data){ cont.innerHTML = '<div class="cfg-empty">No se pudo cargar la lista.</div>'; return; }
  var users = res.data.users || [];
  // Solo se pueden delegar las herramientas que el propio centro tiene (el
  // server manda cuáles en modulosDisponibles). Mostramos esos checkboxes en el
  // alta y escondemos el resto; si no hay ninguno, se avisa.
  var disp = Array.isArray(res.data.modulosDisponibles) ? res.data.modulosDisponibles : [];
  USR_MODULOS_DISP = disp;
  var formBox = document.getElementById('cliUsrModulos');
  if (formBox){
    [].slice.call(formBox.querySelectorAll('input[type="checkbox"]')).forEach(function(i){
      var ok = disp.indexOf(i.value) >= 0;
      if (i.parentElement) i.parentElement.style.display = ok ? '' : 'none';
      if (!ok) i.checked = false;
    });
    var vacio = document.getElementById('cliUsrModVacio');
    if (!disp.length){
      if (!vacio){ vacio = document.createElement('div'); vacio.id = 'cliUsrModVacio'; vacio.className = 'nom-muted'; vacio.textContent = 'Tu centro todavía no tiene herramientas para delegar (Afiliados / Informes / Liberar cupo). Se habilitan desde NS.'; formBox.parentNode.insertBefore(vacio, formBox.nextSibling); }
      vacio.style.display = '';
    } else if (vacio){ vacio.style.display = 'none'; }
  }
  if (!users.length){ cont.innerHTML = '<div class="cfg-empty">Todavía no creaste ningún usuario.</div>'; return; }
  cont.innerHTML = users.map(function(u){
    var mods = Object.keys(USR_MODULOS_LABEL).filter(function(k){ return disp.indexOf(k) >= 0; }).map(function(k){
      var on = (u.modulos || []).indexOf(k) >= 0;
      return '<label class="inf-campo" style="flex-direction:row;align-items:center;gap:6px;margin:0">'
        + '<input type="checkbox" data-usr="' + esc(u.username) + '" value="' + k + '"' + (on ? ' checked' : '') + '> ' + esc(USR_MODULOS_LABEL[k]) + '</label>';
    }).join('');
    var estado = u.active
      ? '<span class="cfg-tag on">activo</span>'
      : '<span class="cfg-tag off">desactivado</span>';
    var pend = u.mustChange ? ' <span class="nom-muted">· debe cambiar la clave</span>' : '';
    return '<div class="cfg-item">'
      + '<div class="cfg-row"><span class="cfg-name">' + esc(u.name) + ' <span class="nom-muted">(' + esc(u.username) + ')</span></span>' + estado + pend + '</div>'
      + '<div class="cfg-scope" style="display:flex;flex-wrap:wrap;gap:6px 18px;margin:6px 0">' + mods + '</div>'
      + '<div class="cred-actions" style="gap:8px;flex-wrap:wrap">'
      +   '<button class="btn btn-ghost btn-sm" type="button" onclick="guardarModulosUsuario(\'' + esc(u.username) + '\')">Guardar accesos</button>'
      +   '<button class="btn btn-ghost btn-sm" type="button" onclick="toggleUsuarioCentro(\'' + esc(u.username) + '\',' + (u.active ? 'false' : 'true') + ')">' + (u.active ? 'Desactivar' : 'Activar') + '</button>'
      +   '<button class="btn btn-ghost btn-sm" type="button" onclick="resetPassUsuarioCentro(\'' + esc(u.username) + '\')">Cambiar clave</button>'
      +   '<button class="rowbtn danger" title="Eliminar" onclick="eliminarUsuarioCentro(\'' + esc(u.username) + '\')">' + SVG_TRASH + '</button>'
      + '</div>'
      + '</div>';
  }).join('');
}
async function crearUsuarioCentro(ev){
  if (ev && ev.preventDefault) ev.preventDefault();
  var err = document.getElementById('cliUsrError'), ok = document.getElementById('cliUsrOk');
  if (err){ err.style.display = 'none'; err.textContent = ''; }
  if (ok){ ok.style.display = 'none'; ok.textContent = ''; }
  var slug = cliUsrCentroSlug();
  var payload = {
    username: (document.getElementById('cliUsrUser').value || '').trim(),
    name: (document.getElementById('cliUsrName').value || '').trim(),
    email: (document.getElementById('cliUsrEmail').value || '').trim(),
    password: document.getElementById('cliUsrPass').value || '',
    modulos: Array.prototype.slice.call(document.querySelectorAll('#cliUsrModulos input:checked')).map(function(c){ return c.value; }),
  };
  var res = await req('POST', '/api/clientes/' + encodeURIComponent(slug) + '/usuarios', payload);
  if (!res.ok){ if (err){ err.textContent = (res.data && res.data.error) || 'No se pudo crear el usuario.'; err.style.display = ''; } return; }
  if (ok){ ok.textContent = 'Usuario creado. La clave inicial la tiene que cambiar en el primer ingreso.'; ok.style.display = ''; }
  document.getElementById('cliUsrUser').value = '';
  document.getElementById('cliUsrName').value = '';
  document.getElementById('cliUsrEmail').value = '';
  document.getElementById('cliUsrPass').value = '';
  document.querySelectorAll('#cliUsrModulos input:checked').forEach(function(c){ c.checked = false; });
  loadClientUsuarios();
}
async function guardarModulosUsuario(username){
  var slug = cliUsrCentroSlug();
  var mods = Array.prototype.slice.call(document.querySelectorAll('#cliUsrList input[data-usr="' + username + '"]:checked')).map(function(c){ return c.value; });
  var res = await req('PATCH', '/api/clientes/' + encodeURIComponent(slug) + '/usuarios/' + encodeURIComponent(username), { modulos: mods });
  if (!res.ok){ nsAlert((res.data && res.data.error) || 'No se pudieron guardar los accesos.'); return; }
  loadClientUsuarios();
}
async function toggleUsuarioCentro(username, activar){
  var slug = cliUsrCentroSlug();
  if (!activar && !await nsConfirm('No va a poder entrar hasta que lo vuelvas a activar.', { titulo:'Desactivar usuario', okLabel:'Desactivar' })) return;
  var res = await req('PATCH', '/api/clientes/' + encodeURIComponent(slug) + '/usuarios/' + encodeURIComponent(username), { active: !!activar });
  if (!res.ok){ nsAlert((res.data && res.data.error) || 'No se pudo cambiar el estado.'); return; }
  loadClientUsuarios();
}
async function resetPassUsuarioCentro(username){
  var nueva = await nsPrompt('Nueva contraseña (mínimo 6 caracteres)', {
    titulo: 'Cambiar clave de ' + username,
    cuerpo: 'La va a tener que cambiar en su próximo ingreso.',
    placeholder: 'Nueva clave', okLabel: 'Cambiar clave' });
  if (nueva === null) return;
  if (String(nueva).length < 6){ nsAlert('La clave tiene que tener al menos 6 caracteres.'); return; }
  var slug = cliUsrCentroSlug();
  var res = await req('POST', '/api/clientes/' + encodeURIComponent(slug) + '/usuarios/' + encodeURIComponent(username) + '/password', { password: nueva });
  if (!res.ok){ nsAlert((res.data && res.data.error) || 'No se pudo cambiar la clave.'); return; }
  nsAlert('Clave cambiada. Avisale al usuario la nueva clave: ' + nueva, { titulo:'Listo' });
}
async function eliminarUsuarioCentro(username){
  if (!await nsConfirm('Se elimina el usuario ' + username + ' de tu centro. No se puede deshacer.', { titulo:'Eliminar usuario', okLabel:'Eliminar' })) return;
  var slug = cliUsrCentroSlug();
  var res = await req('DELETE', '/api/clientes/' + encodeURIComponent(slug) + '/usuarios/' + encodeURIComponent(username));
  if (!res.ok){ nsAlert((res.data && res.data.error) || 'No se pudo eliminar.'); return; }
  loadClientUsuarios();
}
// Plan Salud (CIMA): etapa 1, todavía en desarrollo. Por ahora solo confirma
// qué archivo se eligió — el parseo real se suma cuando tengamos un reporte
// de ejemplo del sistema CIMA para saber el formato exacto de columnas.
async function renderPlanSalud(){
  var box = document.getElementById('planSaludConfigBox');
  var estado = document.getElementById('planSaludEstado');
  if (estado) estado.textContent = '';
  if (!box || !ACTIVE_CLIENT) return;
  var esAdmin = ME && ME.role === 'admin';
  box.innerHTML = '<span class="nom-muted">Cargando…</span>';
  var r = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/plan-salud/config');
  var sheet = (r.ok && r.data && r.data.sheet) || null;
  if (sheet && sheet.spreadsheetId){
    var url = 'https://docs.google.com/spreadsheets/d/' + sheet.spreadsheetId + '/edit#gid=' + (sheet.gid || 0);
    box.innerHTML = '<div class="ps-conn"><span class="ps-badge ok">✅ Planilla conectada</span> '
      + '<a href="' + esc(url) + '" target="_blank" rel="noopener">Abrir planilla</a>'
      + (esAdmin ? ' <button class="btn btn-ghost btn-sm" type="button" onclick="planSaludConectar()">Cambiar</button> <button class="btn btn-ghost btn-sm" type="button" onclick="planSaludDesconectar()">Desconectar</button>' : '')
      + '</div>';
  } else if (!esAdmin){
    box.innerHTML = '<span class="nom-muted">Este centro todavía no tiene una planilla de Plan Salud conectada.</span>';
  } else {
    box.innerHTML = '<div class="ps-conn"><input class="inp" id="planSaludUrl" placeholder="Pegá el link de la planilla de Google (con #gid de la hoja)" style="min-width:320px;flex:1">'
      + '<button class="btn btn-primary btn-sm" type="button" onclick="planSaludConectar()">Conectar</button></div>';
  }
}
async function planSaludConectar(){
  if (!ACTIVE_CLIENT) return;
  var input = document.getElementById('planSaludUrl');
  var url = input ? input.value.trim() : '';
  if (!url){ url = await nsPrompt('Link de la planilla de Google', { titulo:'Conectar planilla', placeholder:'https://docs.google.com/spreadsheets/d/…#gid=…', okLabel:'Conectar' }); if (url === null) return; }
  var estado = document.getElementById('planSaludEstado');
  if (estado) estado.textContent = 'Conectando y verificando la planilla…';
  var r = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/plan-salud/config', { url: url });
  if (!r.ok){ if (estado) estado.textContent = ''; nsAlert((r.data && r.data.error) || 'No se pudo conectar la planilla.'); return; }
  if (estado) estado.textContent = 'Conectada: ' + (r.data.titulo || '') + ' · hoja ' + (r.data.hoja || '');
  await cargarPlanSaludSlugs();
  renderPlanSalud();
}
async function planSaludDesconectar(){
  if (!ACTIVE_CLIENT) return;
  if (!await nsConfirm('¿Desconectar la planilla de Plan Salud de este centro?', { titulo:'Desconectar', okLabel:'Desconectar', peligro:true })) return;
  try { await fetch('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/plan-salud/config', { method:'DELETE', headers:{'content-type':'application/json'} }); } catch(e){}
  await cargarPlanSaludSlugs();
  renderPlanSalud();
}
// OSDOP (Scheffelaar): calculadora simple valor x cantidad por concepto, para
// saber cuánto debería facturar la médica. Vive solo en el navegador (localStorage
// por cliente) — es una cuenta rápida, no un registro que necesite guardarse en
// el servidor ni compartirse entre dispositivos.
var OSDOP_CONCEPTOS = ['Cardiología', 'Clínica médica'];
var OSDOP_MAX_FILAS = 8;
function osdopStorageKey(){ return 'ns_osdop_' + (ACTIVE_CLIENT ? ACTIVE_CLIENT.slug : ''); }
function osdopFilaVacia(concepto){ return { concepto: concepto || '', valor: '', coseguro: '', cantidad: '' }; }
// Guardado como ARRAY de filas (antes era un objeto por concepto fijo): un
// mismo concepto puede repetirse en varias filas — ej. pacientes de Cardiología
// con coseguro en una fila y sin coseguro en otra, cada una con su cantidad.
function osdopCargarGuardado(){
  try {
    var raw = JSON.parse(localStorage.getItem(osdopStorageKey()) || 'null');
    if (Array.isArray(raw) && raw.length) return raw;
  } catch (e) {}
  return OSDOP_CONCEPTOS.map(function (c) { return osdopFilaVacia(c); });
}
function osdopGuardar(filas){
  try { localStorage.setItem(osdopStorageKey(), JSON.stringify(filas)); } catch (e) {}
}
function osdopOpcionesConcepto(seleccionado){
  var html = '<option value=""' + (!seleccionado ? ' selected' : '') + '>Seleccionar…</option>';
  OSDOP_CONCEPTOS.forEach(function (c) {
    html += '<option value="' + esc(c) + '"' + (c === seleccionado ? ' selected' : '') + '>' + esc(c) + '</option>';
  });
  return html;
}
function renderOsdop(){
  var body = document.getElementById('osdopBody');
  if (!body) return;
  var filas = osdopCargarGuardado();
  body.innerHTML = filas.map(function (f, i) {
    return '<tr data-idx="' + i + '">'
      + '<td><select class="inp" onchange="calcularOsdop()">' + osdopOpcionesConcepto(f.concepto) + '</select></td>'
      + '<td class="num"><input class="inp" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0" value="' + (f.valor || '') + '" oninput="calcularOsdop()"></td>'
      + '<td class="num"><input class="inp" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0" value="' + (f.coseguro || '') + '" oninput="calcularOsdop()"></td>'
      + '<td class="num"><input class="inp" type="number" inputmode="numeric" min="0" step="1" placeholder="0" value="' + (f.cantidad || '') + '" oninput="calcularOsdop()"></td>'
      + '<td class="num osdop-subtotal">$ 0,00</td>'
      + '<td class="osdop-col-acciones"><button type="button" class="icon-danger-btn mini" title="Quitar fila" onclick="osdopQuitarFila(' + i + ')"><svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></td>'
      + '</tr>';
  }).join('');
  calcularOsdop();
  osdopActualizarBotonAgregar(filas.length);
}
function osdopActualizarBotonAgregar(cantidadFilas){
  var btn = document.getElementById('osdopAddBtn');
  if (!btn) return;
  btn.disabled = cantidadFilas >= OSDOP_MAX_FILAS;
  btn.textContent = cantidadFilas >= OSDOP_MAX_FILAS ? 'Máximo ' + OSDOP_MAX_FILAS + ' filas' : '+ Agregar fila';
}
function osdopAgregarFila(){
  var filas = osdopCargarGuardado();
  if (filas.length >= OSDOP_MAX_FILAS) return;
  filas.push(osdopFilaVacia());
  osdopGuardar(filas);
  renderOsdop();
}
function osdopQuitarFila(idx){
  var filas = osdopCargarGuardado();
  filas.splice(idx, 1);
  if (!filas.length) filas = OSDOP_CONCEPTOS.map(function (c) { return osdopFilaVacia(c); });
  osdopGuardar(filas);
  renderOsdop();
}
function calcularOsdop(){
  var body = document.getElementById('osdopBody');
  var totalEl = document.getElementById('osdopTotal');
  if (!body) return;
  var filas = [];
  var total = 0;
  [].slice.call(body.querySelectorAll('tr')).forEach(function (row) {
    var select = row.querySelector('select');
    var inputs = row.querySelectorAll('input');
    var concepto = select.value;
    var valor = Number(inputs[0].value) || 0;
    var coseguro = Number(inputs[1].value) || 0;
    var cantidad = Number(inputs[2].value) || 0;
    // Sin concepto elegido, la fila no suma ni resta (queda en $0 aparte),
    // aunque tenga números cargados — evita sumar de más por accidente.
    var subtotal = concepto ? (valor * cantidad) - coseguro : 0;
    total += subtotal;
    row.querySelector('.osdop-subtotal').textContent = moneyFmt(subtotal);
    filas.push({ concepto: concepto, valor: inputs[0].value, coseguro: inputs[1].value, cantidad: inputs[2].value });
  });
  if (totalEl) totalEl.textContent = moneyFmt(total);
  osdopGuardar(filas);
}
// Exportar a PDF: no hace falta servidor ni librería nueva, se arma un
// encabezado (cliente + fecha) visible solo al imprimir y se dispara el
// diálogo nativo del navegador — ahí el usuario elige "Guardar como PDF".
function osdopExportarPDF(){
  var head = document.getElementById('osdopPrintHead');
  if (head) {
    var nombreCliente = (ACTIVE_CLIENT && ACTIVE_CLIENT.name) || 'Scheffelaar';
    var hoy = new Date().toLocaleDateString('es-AR');
    head.innerHTML = '<div class="op-title">OSDOP — ' + esc(nombreCliente) + '</div>'
      + '<div class="op-sub">Calculadora de facturación — ' + esc(hoy) + '</div>';
  }
  window.print();
}
// El lote de credenciales es exclusivo de Scheffelaar: en "Configuración"
// se muestra solo para ese cliente; el resto ve el placeholder.
function renderClientGeneral(){
  var card = document.getElementById('credLoteCard'), ph = document.getElementById('generalPlaceholder');
  var links = document.getElementById('schefeLinks');
  var cupCard = document.getElementById('cupInformeCard');
  var slug = ACTIVE_CLIENT ? ACTIVE_CLIENT.slug : '';
  var tieneCred = CRED_CLIENTES.indexOf(slug) >= 0;
  var esMC = !!(ACTIVE_CLIENT && ACTIVE_CLIENT.tipo === 'med_cabecera');
  if (card) card.style.display = tieneCred ? '' : 'none';
  if (cupCard) cupCard.style.display = 'none';
  if (ph) ph.style.display = (tieneCred || esMC) ? 'none' : '';
  if (links){
    var sid = CRED_PLANILLA[slug];
    if (tieneCred && sid){
      links.style.display = 'flex';
      var a = links.querySelector('a'); if (a) a.href = 'https://docs.google.com/spreadsheets/d/' + sid + '/edit';
    } else { links.style.display = 'none'; }
  }
  if (tieneCred) credSchedCargar();
}
// ===== Informe del CUP (médico de cabecera): sube a mano el Excel del Panel de
// prestaciones de PAMI, UN mes por vez (no se pisan entre sí). El mes más nuevo
// del historial es el que queda "en vivo" y sigue alimentando el match de
// "Informes recibidos" y "Pendientes de Javi" (misma bandeja de siempre). =====
function cupInformeBadges(d){
  return '<div class="ini-pendop-badges" style="margin-top:4px">'
    + ((d.pendienteValidar||0) ? '<span class="ini-pendop-badge pend" title="Pendiente validar">'+d.pendienteValidar+' por validar</span>' : '')
    + ((d.pendienteTransmitir||0) ? '<span class="ini-pendop-badge cup" title="Pendiente transmitir">'+d.pendienteTransmitir+' por transmitir</span>' : '')
    + ((d.listas||0) ? '<span class="ini-pendop-badge transm" style="background:var(--success)" title="Validadas y transmitidas">'+d.listas+' listas</span>' : '')
    + '</div>';
}
function cupInformeHistorialHTML(historial){
  if (!historial || !historial.length) return '<p class="nom-muted">Todavía no se subió ningún informe del CUP para este médico.</p>';
  return historial.map(function(d){
    var fecha = new Date(d.uploadedAt).toLocaleString('es-AR');
    return '<div class="cup-historial-item">'
      + '<b>' + esc(d.monthLabel || d.month) + '</b>' + (d.live ? '<span class="cup-live">EN USO</span>' : '') + '<br>'
      + '<span class="nom-muted">' + esc(d.archivo || '') + ' · ' + fecha + ' · ' + esc(d.uploadedBy || '') + ' · ' + (d.count||0) + ' filas</span>'
      + cupInformeBadges(d)
      + '</div>';
  }).join('');
}
function cupInformeMesPorDefecto(){
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}
async function cargarCupInforme(){
  var box = document.getElementById('cupInformeEstado');
  var mesInput = document.getElementById('cupInformeMes');
  if (mesInput && !mesInput.value) mesInput.value = cupInformeMesPorDefecto();
  if (!box || !ACTIVE_CLIENT) return;
  box.innerHTML = 'Cargando…';
  var r = await api('/api/clientes/' + ACTIVE_CLIENT.slug + '/bandeja/archivo');
  if (!r.ok){ box.innerHTML = '<span class="msg err">No se pudo cargar el estado.</span>'; return; }
  box.innerHTML = cupInformeHistorialHTML((r.data || {}).historial);
}
async function subirCupInforme(files){
  if (!files || !files[0] || !ACTIVE_CLIENT) return;
  var box = document.getElementById('cupInformeEstado');
  var mesInput = document.getElementById('cupInformeMes');
  var mes = (mesInput && mesInput.value) || cupInformeMesPorDefecto();
  if (box) box.innerHTML = 'Procesando informe del CUP…';
  var fd = new FormData(); fd.append('file', files[0]); fd.append('month', mes);
  var r = await fetch('/api/clientes/' + ACTIVE_CLIENT.slug + '/bandeja/archivo', { method:'POST', body: fd });
  var data = {}; try { data = await r.json(); } catch(e){}
  if (!r.ok){ if (box) box.innerHTML = '<span class="msg err">' + esc(data.error || 'No se pudo procesar el archivo.') + '</span>'; return; }
  await cargarCupInforme();
  iniCargarPendientesOperador();
  iniCargarMisPendientes();
}
// Acceso PAMI del cliente. La TARJETA editable (user/clave) es solo admin; el UP de
// la cabecera lo ven admin y operador (el operador lo usa para trabajar; el GET del
// backend no le manda la clave).
async function loadClientPami(){
  var card = document.getElementById('clientPamiCard');
  if (!card) return;
  var esAdmin = !!(ME && ME.role === 'admin');
  var puedeVerUp = esAdmin || !!(ME && ME.role === 'operador');
  card.style.display = esAdmin ? '' : 'none';   // la tarjeta con user/clave, solo admin
  setClientHeaderUp('');   // se oculta al instante al cambiar de cliente; reaparece al traer el UP
  if (!ACTIVE_CLIENT || !puedeVerUp) return;
  if (esAdmin){
    document.getElementById('clientPamiUser').value = '';
    document.getElementById('clientPamiPass').value = '';
    document.getElementById('clientPamiPass').type = 'password';
    document.getElementById('clientPamiMsg').textContent = '';
    document.getElementById('clientPamiPassIco').innerHTML = EYE_ON;
  }
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/pami');
  if (res.ok && res.data){
    setClientHeaderUp(res.data.pamiUser || '');
    if (esAdmin){
      document.getElementById('clientPamiUser').value = res.data.pamiUser || '';
      document.getElementById('clientPamiPass').placeholder = res.data.hasPassword ? '•••••• guardada — dejar vacío para no cambiarla' : 'Escribí la clave';
      var revealBtn = document.getElementById('clientPamiRevealBtn');
      if (revealBtn) revealBtn.style.display = res.data.hasPassword ? '' : 'none';
    }
  }
}
// UP (usuario PAMI) al lado del nombre del cliente en la cabecera: se ve en TODAS las
// solapas mientras se trabaja con el cliente. Con botón para copiarlo de un clic.
function setClientHeaderUp(up){
  var el = document.getElementById('clientHeaderUp'); if (!el) return;
  if (up){
    el.innerHTML = 'UP <b>' + esc(up) + '</b>' +
      '<button class="icon-btn mini" type="button" title="Copiar UP" onclick="copiarTexto(\'' + esc(up) + '\',this)"><svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" stroke-width="1.8"/></svg></button>';
    el.hidden = false;
  } else {
    el.innerHTML = ''; el.hidden = true;
  }
}
// Ver la clave guardada (admin): la trae desencriptada y la muestra en el campo.
async function revealClientPami(){
  if (!ACTIVE_CLIENT) return;
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/pami/credenciales');
  if (!res.ok || !res.data) return;
  var pass = document.getElementById('clientPamiPass');
  pass.value = res.data.pamiPassword || '';
  pass.dataset.fromReveal = '1';
  pass.type = 'text';
  document.getElementById('clientPamiPassIco').innerHTML = EYE_OFF;
}
// Ojo del campo: revela la clave (la trae guardada si el campo está vacío) o la
// oculta. Si lo revelado venía de la guardada, al ocultar limpia para que
// "vacío = no cambiar" siga valiendo.
async function toggleRevealClientPami(){
  if (!ACTIVE_CLIENT) return;
  var pass = document.getElementById('clientPamiPass');
  var ico = document.getElementById('clientPamiPassIco');
  if (pass.type === 'password'){
    if (!pass.value){
      var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/pami/credenciales');
      if (res.ok && res.data && res.data.pamiPassword){ pass.value = res.data.pamiPassword; pass.dataset.fromReveal = '1'; }
    }
    pass.type = 'text';
    if (ico) ico.innerHTML = EYE_OFF;
  } else {
    pass.type = 'password';
    if (ico) ico.innerHTML = EYE_ON;
    if (pass.dataset.fromReveal === '1'){ pass.value = ''; pass.dataset.fromReveal = ''; }
  }
}
async function saveClientPami(){
  if (!ACTIVE_CLIENT) return;
  var msg = document.getElementById('clientPamiMsg'); msg.className = 'msg ok'; msg.textContent = '';
  var btn = document.getElementById('clientPamiSaveBtn'); btn.disabled = true;
  var res = await req('POST', '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/pami', {
    pamiUser: document.getElementById('clientPamiUser').value.trim(),
    pamiPassword: document.getElementById('clientPamiPass').value,
  });
  btn.disabled = false;
  if (!res.ok){ msg.className = 'msg err'; msg.textContent = (res.data && res.data.error) || 'No se pudo guardar.'; return; }
  document.getElementById('clientPamiPass').value = '';
  document.getElementById('clientPamiPass').placeholder = res.data.hasPassword ? '•••••• guardada — dejar vacío para no cambiarla' : 'Escribí la clave';
  msg.textContent = 'Acceso PAMI guardado.';
}

// ===== Usuarios médicos del consultorio (solo admin) =====
// ===== Honorarios y ganancia real (admin + clínica del centro) =====
var HON = { periodo: '', codigos: [], config: {}, reportes: [], reporteId: '', fuente: '', reporteNombre: '' };
async function loadClientHonorarios(reporteId){
  if (!ACTIVE_CLIENT) return;
  var err = document.getElementById('honError'); if (err) err.style.display = 'none';
  var qs = reporteId ? ('?reporte=' + encodeURIComponent(reporteId)) : '';
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/honorarios' + qs);
  if (!res.ok){ if (err){ err.style.display = ''; err.textContent = (res.data && res.data.error) || 'No se pudo cargar.'; } return; }
  var d = res.data;
  HON = { periodo: d.periodo || '', codigos: d.codigos || [], config: d.config || {}, reportes: d.reportes || [], reporteId: d.reporteId || '', fuente: d.fuente || '', reporteNombre: d.reporteNombre || '' };
  // Selector de reportes cerrados.
  var sel = document.getElementById('honReporte');
  if (sel){
    sel.innerHTML = HON.reportes.map(function(r){ var etq = r.title || r.nomencladorLabel || r.dashboardPeriod || r.id; return '<option value="' + esc(r.id) + '"' + (String(r.id) === String(HON.reporteId) ? ' selected' : '') + '>' + esc(etq) + '</option>'; }).join('') || '<option value="">(sin reportes cerrados)</option>';
    sel.style.display = HON.reportes.length ? '' : 'none';
  }
  var pe = document.getElementById('honPeriodo');
  if (pe) pe.textContent = HON.fuente === 'reporte' ? ((HON.reporteNombre || 'Reporte') + ' · ' + (HON.periodo || '')) : (HON.periodo ? ('Mes en curso ' + HON.periodo + ' (aún sin reporte cerrado)') : 'Sin datos');
  renderHonorarios();
}
function honCalc(cod, cfg){
  var fact = Number(cod.facturado) || 0, hon = 0;
  if (cfg && Number(cfg.valor) > 0){
    hon = (cfg.tipo === 'pct') ? fact * Number(cfg.valor) / 100 : (Number(cod.cantidad) || 0) * Number(cfg.valor);
  }
  return { fact: fact, hon: hon, gan: fact - hon };
}
function renderHonorarios(){
  var body = document.getElementById('honBody'); if (!body) return;
  if (!HON.codigos.length){ body.innerHTML = '<tr><td colspan="6" class="muted-cell">' + (HON.reportes.length ? 'El reporte elegido no tiene prácticas.' : 'Todavía no hay reportes cerrados de este centro.') + '</td></tr>'; var t = document.getElementById('honTotales'); if (t) t.innerHTML = ''; return; }
  var html = '', espActual = null;
  HON.codigos.forEach(function(cod){
    if (cod.especialidad !== espActual){ espActual = cod.especialidad; html += '<tr class="hon-esp"><td colspan="6">' + esc(espActual || 'Sin especialidad') + '</td></tr>'; }
    var cfg = HON.config[cod.code] || null;
    var tipo = cfg ? cfg.tipo : 'monto', valor = cfg ? cfg.valor : '';
    var c = honCalc(cod, cfg);
    html += '<tr data-code="' + esc(cod.code) + '">' +
      '<td>' + esc(cod.nombre || cod.code) + ' <span class="nom-muted">(' + esc(cod.code) + ')</span></td>' +
      '<td class="num">' + numberFmt(cod.cantidad) + '</td>' +
      '<td class="num">' + moneyFmt(cod.facturado) + '</td>' +
      '<td class="hon-pago">' +
        '<select class="inp mini hon-tipo" onchange="honCambio(\'' + esc(cod.code) + '\')"><option value="monto"' + (tipo !== 'pct' ? ' selected' : '') + '>$/prác.</option><option value="pct"' + (tipo === 'pct' ? ' selected' : '') + '>%</option></select>' +
        '<input class="inp mini hon-valor" inputmode="decimal" value="' + esc(valor) + '" placeholder="0" oninput="honRecalc(\'' + esc(cod.code) + '\')" onchange="honCambio(\'' + esc(cod.code) + '\')">' +
      '</td>' +
      '<td class="num" id="honHon_' + esc(cod.code) + '">' + moneyFmt(c.hon) + '</td>' +
      '<td class="num hon-gan" id="honGan_' + esc(cod.code) + '">' + moneyFmt(c.gan) + '</td>' +
    '</tr>';
  });
  body.innerHTML = html;
  honTotales();
  // Selector "Para:" de la liquidación: una opción por especialidad presente.
  var selL = document.getElementById('honLiqPara');
  if (selL){
    var esps = [];
    HON.codigos.forEach(function(c){ var e = c.especialidad || 'Sin especialidad'; if (esps.indexOf(e) < 0) esps.push(e); });
    var prev = selL.value;
    selL.innerHTML = '<option value="">Todo el centro</option>' + esps.map(function(e){ return '<option value="' + esc(e) + '">' + esc(e) + '</option>'; }).join('');
    if (prev && esps.indexOf(prev) >= 0) selL.value = prev;
  }
}
// Liquidación de honorarios en PDF membretado (para entregarle al médico). El
// server la reconstruye desde el reporte + la config guardada; acá solo pedimos
// el archivo con el reporte elegido y, si corresponde, filtrada a una especialidad.
async function descargarLiquidacion(){
  if (!ACTIVE_CLIENT) return;
  if (!HON.codigos.length){ nsAlert('No hay prácticas para liquidar en el período elegido.'); return; }
  var especialidad = (document.getElementById('honLiqPara') || {}).value || '';
  var payload = { reporte: HON.reporteId || '', especialidad: especialidad };
  try {
    var resp = await fetch('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/honorarios/liquidacion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) });
    if (!resp.ok){
      var msg = 'No se pudo generar la liquidación.';
      try { var j = await resp.json(); if (j && j.error) msg = j.error; } catch(e){}
      nsAlert(msg); return;
    }
    var blob = await resp.blob(); var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url;
    var etq = especialidad ? (' - ' + especialidad) : '';
    a.download = ('Liquidacion ' + (ACTIVE_CLIENT.name || '') + etq).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') + '.pdf';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
  } catch (e){ nsAlert('No se pudo generar la liquidación.'); }
}
function honFilaCfg(code){
  var tr = document.querySelector('#honBody tr[data-code="' + code + '"]'); if (!tr) return null;
  return { tipo: tr.querySelector('.hon-tipo').value, valor: facturaParseMonto(tr.querySelector('.hon-valor').value) };
}
function honRecalc(code){
  var cod = HON.codigos.find(function(x){ return String(x.code) === String(code); }); if (!cod) return;
  var c = honCalc(cod, honFilaCfg(code));
  var h = document.getElementById('honHon_' + code), g = document.getElementById('honGan_' + code);
  if (h) h.textContent = moneyFmt(c.hon);
  if (g) g.textContent = moneyFmt(c.gan);
  honTotales();
}
async function honCambio(code){
  honRecalc(code);
  var cfg = honFilaCfg(code); if (!cfg) return;
  if (cfg.valor > 0) HON.config[code] = cfg; else delete HON.config[code];
  await req('POST', '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/honorarios', { code: code, tipo: cfg.tipo, valor: cfg.valor });
}
function honTotales(){
  var box = document.getElementById('honTotales'); if (!box) return;
  var tf = 0, th = 0;
  HON.codigos.forEach(function(cod){
    var cfg = honFilaCfg(cod.code) || HON.config[cod.code] || null;
    var c = honCalc(cod, cfg); tf += c.fact; th += c.hon;
  });
  box.innerHTML =
    '<div class="hon-tot in"><span>Facturado (PAMI)</span><b>' + moneyFmt(tf) + '</b></div>' +
    '<div class="hon-tot out"><span>Honorarios (médicos)</span><b>' + moneyFmt(th) + '</b></div>' +
    '<div class="hon-tot net"><span>Ganancia real</span><b>' + moneyFmt(tf - th) + '</b></div>';
}
async function honDescargar(fmt){
  if (!HON.codigos.length) return;
  var filas = HON.codigos.map(function(cod){
    var cfg = honFilaCfg(cod.code) || HON.config[cod.code] || null;
    var c = honCalc(cod, cfg);
    var pago = cfg && cfg.valor > 0 ? (cfg.tipo === 'pct' ? (cfg.valor + '%') : ('$ ' + cfg.valor + '/prác.')) : '';
    return [cod.especialidad || '', cod.nombre + ' (' + cod.code + ')', cod.cantidad, Number(cod.facturado) || 0, pago, c.hon, c.gan];
  });
  var cli = (ACTIVE_CLIENT && ACTIVE_CLIENT.name) || '';
  var d = { fmt: fmt, titulo: 'Honorarios ' + cli + ' - ' + (HON.periodo || ''), columnas: ['ESPECIALIDAD', 'PRACTICA', 'CANT', 'FACTURADO', 'LE PAGO', 'HONORARIOS', 'GANANCIA'], filas: filas, moneyCols: [3, 5, 6] };
  try {
    var resp = await fetch('/api/mescurso/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(d) });
    if (!resp.ok) throw new Error('export');
    var blob = await resp.blob(); var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url;
    a.download = d.titulo.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') + (fmt === 'pdf' ? '.pdf' : '.xlsx');
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
  } catch (e){ nsAlert('No se pudo generar el archivo.'); }
}
var MEDICOS = [];
async function loadClientMedicos(){
  if (!ACTIVE_CLIENT) return;
  var err = document.getElementById('medicosError'); if (err) err.style.display = 'none';
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/medicos');
  MEDICOS = (res.ok && res.data && res.data.medicos) ? res.data.medicos : [];
  renderClientMedicos();
}
// Marca/desmarca un médico como preferido de su especialidad (para el parseo de OMEs).
async function toggleMedicoPreferido(id){
  if (!ACTIVE_CLIENT) return;
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/medicos/' + encodeURIComponent(id) + '/preferido', {});
  if (!res.ok){ nsAlert((res.data && res.data.error) || 'No se pudo marcar.'); return; }
  MEDICOS = (res.data && res.data.medicos) || MEDICOS;
  renderClientMedicos();
}
// Marca/desmarca el usuario PAMI del médico como deshabilitado (bloqueado/vencido).
async function toggleMedicoDeshabilitado(id){
  if (!ACTIVE_CLIENT) return;
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/medicos/' + encodeURIComponent(id) + '/deshabilitado', {});
  if (!res.ok){ nsAlert((res.data && res.data.error) || 'No se pudo marcar.'); return; }
  MEDICOS = (res.data && res.data.medicos) || MEDICOS;
  renderClientMedicos();
}
// Marca/desmarca el médico "comodín": cubre las especialidades que NO tienen médico
// activo propio (uno solo por cliente).
async function toggleMedicoComodin(id){
  if (!ACTIVE_CLIENT) return;
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/medicos/' + encodeURIComponent(id) + '/comodin', {});
  if (!res.ok){ nsAlert((res.data && res.data.error) || 'No se pudo marcar.'); return; }
  MEDICOS = (res.data && res.data.medicos) || MEDICOS;
  renderClientMedicos();
}
// Verificación de acceso a PAMI por médico: chip de estado + "última verificación".
var MED_VERIFICANDO = {};
function medHace(iso){
  try{ var d=new Date(iso); var diff=(Date.now()-d.getTime())/1000;
    if(diff<90) return 'recién'; if(diff<3600) return 'hace '+Math.round(diff/60)+' min';
    if(diff<86400) return 'hace '+Math.round(diff/3600)+' h';
    return d.toLocaleDateString('es-AR'); }catch(e){ return ''; }
}
function medEstadoChip(m){
  if (MED_VERIFICANDO[m.id]) return '<span class="med-estado prog">⏳ Verificando…</span>';
  var e = m.estado || '';
  var cuando = m.verificadoAt ? (' · ' + medHace(m.verificadoAt)) : '';
  var det = m.verificadoDetalle ? (' — ' + m.verificadoDetalle) : '';
  if (e === 'activo') return '<span class="med-estado ok" title="El login a CUP PAMI funcionó' + esc(cuando) + '">🟢 Activo<span class="med-estado-when">' + esc(cuando) + '</span></span>';
  if (e === 'inactivo') return '<span class="med-estado bad" title="PAMI rechazó el login (usuario/clave)' + esc(det) + '">🔴 Inactivo<span class="med-estado-when">' + esc(cuando) + '</span></span>';
  if (e === 'error') return '<span class="med-estado warn" title="No se pudo verificar' + esc(det) + '">⚠️ Sin poder verificar<span class="med-estado-when">' + esc(cuando) + '</span></span>';
  return '<span class="med-estado muted">⚪ Sin verificar</span>';
}
function verificarMedico(id){ return verificarMedicosEnqueue({ medicoId: id }); }
function verificarTodosMedicos(){ return verificarMedicosEnqueue({}); }
async function verificarMedicosEnqueue(body){
  if (!ACTIVE_CLIENT) return;
  var slug = ACTIVE_CLIENT.slug;
  var res = await api('/api/clientes/' + encodeURIComponent(slug) + '/medicos/verificar', body || {});
  if (!res.ok){ nsAlert((res.data && res.data.error) || 'No se pudo iniciar la verificación.'); return; }
  var ids = (res.data && res.data.medicoIds) || [];
  if (!ids.length) return;
  var antes = {}; (MEDICOS||[]).forEach(function(m){ antes[m.id]=m.verificadoAt||''; });
  ids.forEach(function(x){ MED_VERIFICANDO[x]=true; });
  renderClientMedicos();
  var vueltas = 0;
  var timer = setInterval(async function(){
    vueltas++;
    var r = await api('/api/clientes/' + encodeURIComponent(slug) + '/medicos');
    if (r.ok && r.data && r.data.medicos){
      MEDICOS = r.data.medicos;
      var listos = ids.every(function(x){ var m=MEDICOS.find(function(y){return y.id===x;}); return m && (m.verificadoAt||'')!==(antes[x]||''); });
      if (listos || vueltas > 90){ clearInterval(timer); ids.forEach(function(x){ delete MED_VERIFICANDO[x]; }); }
      renderClientMedicos();
    }
  }, 4000);
}
var PAMI_BLANQUEO_URL = 'https://efectores.pami.org.ar/pami_efectores/segu_olvido_password.php';
function renderClientMedicos(){
  var body = document.getElementById('medicosBody'); if (!body) return;
  if (!MEDICOS.length){ body.innerHTML = '<tr><td colspan="5" class="muted-cell">Sin médicos cargados.</td></tr>'; return; }
  var ojo = '<svg viewBox="0 0 24 24" fill="none">' + EYE_ON + '</svg>';
  var copiar = '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" stroke-width="1.8"/></svg>';
  var llave = '<svg viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M11 12l9-9M17 3l3 3M15 5l2 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var esAdminMed = ME && ME.role === 'admin';
  body.innerHTML = MEDICOS.map(function(m){
    var mid = esc(m.id);
    var claveCell;
    if (m.tieneClave){
      claveCell = '<span class="med-pass saved"><span id="medClaveTxt_' + mid + '">Clave guardada</span>' +
        (esAdminMed ? '<button class="icon-btn mini" type="button" title="Ver" onclick="revealMedicoClave(\'' + mid + '\')">' + ojo + '</button>' : '') + '</span>';
    } else {
      claveCell = '<span class="med-pass missing">Sin clave</span>';
    }
    var usuarioCell = m.usuario
      ? '<span class="med-user"><code>' + esc(m.usuario) + '</code>' + (esAdminMed ? '<button class="icon-btn mini" type="button" title="Copiar" data-copy="' + esc(m.usuario) + '" onclick="copiarTexto(this.dataset.copy, this)">' + copiar + '</button>' : '') + '</span>'
      : '<span class="med-user muted">Sin usuario</span>';
    var accesoCell = '<div class="med-access">' + usuarioCell + claveCell + medEstadoChip(m) + '</div>';
    var acciones = esAdminMed
      ? '<button class="icon-btn mini" type="button" title="Editar" onclick="openMedicoModal(\'' + mid + '\')"><svg viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
          (m.tieneClave ? '<button class="icon-btn mini" type="button" title="Probar acceso a PAMI (activo/inactivo)"' + (MED_VERIFICANDO[m.id] ? ' disabled' : '') + ' onclick="verificarMedico(\'' + mid + '\')">' + (MED_VERIFICANDO[m.id] ? '⏳' : '🔎') + '</button>' : '') +
          (m.usuario ? '<button class="icon-btn mini" type="button" title="Blanquear" onclick="blanquearMedicoClave(\'' + mid + '\')">' + llave + '</button>' : '') +
          '<button class="icon-btn mini' + (m.deshabilitado ? ' med-deshab-on' : '') + '" type="button" title="' + (m.deshabilitado ? 'Usuario DESHABILITADO — clic para rehabilitar' : 'Marcar usuario como deshabilitado (bloqueado o clave vencida en PAMI)') + '" onclick="toggleMedicoDeshabilitado(\'' + mid + '\')">🚫</button>' +
          '<button class="icon-btn mini' + (m.comodin ? ' med-comodin-on' : '') + '" type="button" title="' + (m.comodin ? 'Comodín — cubre especialidades sin médico activo (clic para quitar)' : 'Marcar como comodín (cubre especialidades sin médico activo)') + '" onclick="toggleMedicoComodin(\'' + mid + '\')">🃏</button>' +
          '<button class="icon-danger-btn mini" type="button" title="Borrar" onclick="deleteMedico(\'' + mid + '\')"><svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
      : '<span class="nom-muted">—</span>';
    var prefBtn = (esAdminMed && m.especialidad)
      ? '<button class="med-star ' + (m.preferido ? 'on' : '') + '" type="button" title="' + (m.preferido ? 'Médico preferido de esta especialidad' : 'Marcar como preferido') + '" onclick="toggleMedicoPreferido(\'' + mid + '\')">' + (m.preferido ? '★' : '☆') + '</button>'
      : (m.preferido ? '<span class="med-star on" title="Preferido de esta especialidad">★</span>' : '');
    return '<tr class="' + (m.tieneClave ? '' : 'medico-sin-clave ') + (m.deshabilitado ? 'medico-deshabilitado' : '') + '">' +
      '<td><div class="med-main"><b>' + esc(m.nombre || '-') + '</b>' + (m.deshabilitado ? ' <span class="med-deshab-badge">deshabilitado</span>' : '') + '</div></td>' +
      '<td><div class="med-spec-wrap"><span class="med-spec">' + (esc(m.especialidad) || 'Sin especialidad') + '</span>' + prefBtn + '</div></td>' +
      '<td>' + accesoCell + '</td>' +
      '<td><span class="med-phone">' + (esc(m.telefono) || '-') + '</span></td>' +
      '<td class="row-actions medico-actions">' + acciones + '</td>' +
    '</tr>';
  }).join('');
}
// Revela la clave del médico (admin): la trae desencriptada y la muestra con botón copiar.
async function revealMedicoClave(id){
  if (!ACTIVE_CLIENT) return;
  var span = document.getElementById('medClaveTxt_' + id); if (!span) return;
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/medicos/' + encodeURIComponent(id) + '/credenciales');
  if (!res.ok || !res.data){ return; }
  var clave = res.data.clave || '';
  var copiar = '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" stroke-width="1.8"/></svg>';
  var cell = span.parentElement;
  cell.innerHTML = '<code id="medClaveVal_' + id + '"></code>' +
    ' <button class="icon-btn mini" type="button" title="Copiar" onclick="copiarClaveRevelada(\'' + id + '\', this)">' + copiar + '</button>';
  // textContent (no innerHTML) para no interpretar la clave como HTML.
  document.getElementById('medClaveVal_' + id).textContent = clave;
}
function copiarClaveRevelada(id, btn){
  var el = document.getElementById('medClaveVal_' + id);
  if (el) copiarTexto(el.textContent, btn);
}
// Copia un texto al portapapeles y da un feedback breve en el botón.
function copiarTexto(txt, btn){
  try {
    navigator.clipboard.writeText(txt);
    if (btn){ var old = btn.getAttribute('title'); btn.setAttribute('title', 'Copiado'); setTimeout(function(){ btn.setAttribute('title', old || 'Copiar'); }, 1200); }
  } catch (e){}
}
// Blanquea la clave: copia el usuario al portapapeles y abre la página de PAMI para
// blanquear (no se puede pre-cargar el usuario en su form; queda listo para pegar).
function blanquearMedicoClave(id){
  var m = MEDICOS.find(function(x){ return x.id === id; });
  if (m && m.usuario){ try { navigator.clipboard.writeText(m.usuario); } catch (e){} }
  window.open(PAMI_BLANQUEO_URL, '_blank', 'noopener');
}

// ===== Administración → Facturas (solo admin) — períodos > clientes > facturas =====
var FACTURAS = { clientes: [], registros: [], periodos: [], archivados: [], minimo: 67170 };
var FAC_PER_OPEN = {};   // qué períodos están abiertos (por nombre)
var FAC_CLI_OPEN = {};   // qué clientes están abiertos (clave: pIdx + '_' + slug)
var FAC_RENDER = [];     // nombres de período en el orden en que se renderizan
function facturaParseMonto(v){
  // Acepta "2.678.400,00" o "2678400.00" o "2678400" — y también lo que se PEGA con
  // símbolo de moneda o espacios ("$ 129.761,13", "AR$ 1.000,50"): primero se saca
  // todo lo que no sea dígito, coma, punto o signo (el $, los espacios y el espacio
  // duro que copia el navegador). Sin esto, "$ 129.761,13" se leía como 0.
  var s = String(v == null ? '' : v).replace(/[^\d.,-]/g, '').trim();
  if (!s) return 0;
  if (s.indexOf(',') >= 0){ s = s.replace(/\./g, '').replace(',', '.'); }
  var n = Number(s);
  return isFinite(n) ? n : 0;
}
function facGrupoDe(c){ return (c && c.tipo === 'med_cabecera') ? 'medcab' : 'consultorios'; }
async function loadFacturas(){
  var err = document.getElementById('facturasError'); if (err) err.style.display = 'none';
  var res = await api('/api/facturas');
  if (!res.ok){ if (err){ err.style.display = ''; err.textContent = (res.data && res.data.error) || 'No se pudo cargar.'; } return; }
  FACTURAS = { clientes: res.data.clientes || [], registros: res.data.registros || [], periodos: res.data.periodos || [], archivados: res.data.archivados || [], minimo: res.data.minimoGanancias != null ? res.data.minimoGanancias : 67170 };
  var mEl = document.getElementById('facMinimo'); if (mEl) mEl.value = FACTURAS.minimo;
  // Por defecto abrimos el período más nuevo (último de la lista).
  if (!Object.keys(FAC_PER_OPEN).length && FACTURAS.periodos.length) FAC_PER_OPEN[FACTURAS.periodos[FACTURAS.periodos.length - 1]] = true;
  renderFacturas();
}
async function saveMinimo(){
  var el = document.getElementById('facMinimo');
  var v = facturaParseMonto(el ? el.value : '');
  var res = await req('POST', '/api/facturas/minimo', { valor: v });
  if (res.ok){ FACTURAS.minimo = res.data.minimoGanancias; renderFacturas(); }
}
async function agregarPeriodo(){
  var nombre = await nsPrompt('Nombre del nuevo período', { titulo:'Nuevo período', placeholder:'Ej: JULIO, AGOSTO…', okLabel:'Crear' });
  if (!nombre) return;
  nombre = nombre.trim(); if (!nombre) return;
  // Copia la estructura del período más nuevo (facturas con el mes +1, montos vacíos).
  var copiarDe = FACTURAS.periodos.length ? FACTURAS.periodos[FACTURAS.periodos.length - 1] : '';
  var res = await req('POST', '/api/facturas/periodo', { valor: nombre, copiarDe: copiarDe });
  if (res.ok){
    FACTURAS.periodos = res.data.periodos || [];
    if (res.data.registros) FACTURAS.registros = res.data.registros;
    FAC_PER_OPEN[nombre] = true;
    renderFacturas();
  }
}
async function renombrarPeriodo(pIdx){
  var viejo = FAC_RENDER[pIdx];
  var nuevo = await nsPrompt('Nuevo nombre del período', { titulo:'Renombrar período', valor: viejo, okLabel:'Guardar' });
  if (nuevo == null) return;
  nuevo = nuevo.trim(); if (!nuevo || nuevo === viejo) return;
  var res = await req('POST', '/api/facturas/periodo/renombrar', { viejo: viejo, nuevo: nuevo });
  if (res.ok){
    FACTURAS.periodos = res.data.periodos || [];
    if (res.data.archivados) FACTURAS.archivados = res.data.archivados;
    if (res.data.registros) FACTURAS.registros = res.data.registros;
    if (FAC_PER_OPEN[viejo]){ delete FAC_PER_OPEN[viejo]; FAC_PER_OPEN[nuevo] = true; }
    renderFacturas();
  }
}
var FAC_GRUPOS = [
  { key: 'consultorios', titulo: 'Consultorios' },
  { key: 'medcab', titulo: 'Médicos de cabecera' },
];
// clave única por (período, cliente) para los ids del DOM.
function facParseKey(k){ var i = k.indexOf('_'); var pIdx = Number(k.substring(0, i)); var slug = k.substring(i + 1); return { pIdx: pIdx, slug: slug, periodo: FAC_RENDER[pIdx] }; }
function renderFacturas(){
  var box = document.getElementById('facturasBody'); if (!box) return;
  var qEl = document.getElementById('facBuscar');
  var q = (qEl ? qEl.value : '').toLowerCase().trim();
  var activos = FACTURAS.periodos.slice().reverse();   // más nuevo arriba
  var arch = FACTURAS.archivados.slice().reverse();
  var verArchEl = document.getElementById('facVerArch');
  var verArch = !!(verArchEl && verArchEl.checked);
  // El checkbox "Ver archivados" solo tiene sentido si hay archivados.
  var lbl = document.getElementById('facVerArchLabel'); if (lbl) lbl.style.display = arch.length ? '' : 'none';
  var actMostrar = q ? activos.filter(function(p){ return p.toLowerCase().indexOf(q) >= 0; }) : activos;
  // Los archivados se muestran si están tildados en "Ver archivados" o si el nombre coincide con la búsqueda.
  var archMostrar = (verArch || q) ? arch.filter(function(p){ return !q || p.toLowerCase().indexOf(q) >= 0; }) : [];
  FAC_RENDER = actMostrar.concat(archMostrar);
  var html;
  if (!FAC_RENDER.length){
    html = q ? '<p class="nom-muted">Ningún período coincide con “' + esc(q) + '”.</p>'
             : '<p class="nom-muted">No hay períodos todavía. Creá uno con “+ Período”.</p>';
  } else {
    html = FAC_RENDER.map(function(_, i){ return facturaPeriodoSection(i); }).join('');
  }
  if (!q && !verArch && arch.length) html += '<div class="fac-archivados-info">📦 ' + arch.length + ' período(s) archivado(s). Tildá “Ver archivados” arriba para mostrarlos.</div>';
  box.innerHTML = html;
}
function facturaPeriodoSection(pIdx){
  var periodo = FAC_RENDER[pIdx];
  var esArch = FACTURAS.archivados.indexOf(periodo) >= 0;
  var abierto = FAC_PER_OPEN[periodo] === true;
  var cuerpo = FAC_GRUPOS.map(function(g){
    var cls = FACTURAS.clientes.filter(function(c){ return facGrupoDe(c) === g.key; });
    if (!cls.length) return '';
    var grid = cls.map(function(c){ return facturaCliBlock(c, pIdx); }).join('');
    return '<div class="fac-subgrupo">' + g.titulo + '</div><div class="fac-grid">' + grid + '</div>';
  }).join('');
  var svgArch = esArch
    ? '<svg viewBox="0 0 24 24" fill="none"><path d="M3 8h18M4 8l1 12h14l1-12M9 12h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 12v5m0 0l-2-2m2 2l2-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="4" rx="1" stroke="currentColor" stroke-width="1.8"/><path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M9 12h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return '<div class="factura-group' + (abierto ? ' open' : '') + (esArch ? ' archivado' : '') + '" id="facPer_' + pIdx + '">' +
    '<div class="factura-group-head" onclick="togglePeriodo(' + pIdx + ')">' +
      '<svg class="nav-caret" viewBox="0 0 24 24" fill="none"><path d="M8 10l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<h4>' + esc(periodo) + (esArch ? ' <span class="fac-arch-tag">archivado</span>' : '') + '</h4>' +
      '<button class="icon-btn mini" type="button" title="Renombrar período" onclick="event.stopPropagation();renombrarPeriodo(' + pIdx + ')"><svg viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      '<button class="icon-btn mini" type="button" title="' + (esArch ? 'Desarchivar' : 'Archivar') + '" onclick="event.stopPropagation();archivarPeriodo(' + pIdx + ')">' + svgArch + '</button>' +
      '<button class="icon-danger-btn mini" type="button" title="Borrar período" onclick="event.stopPropagation();borrarPeriodo(' + pIdx + ')"><svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
    '</div>' +
    '<div class="factura-group-body">' + cuerpo + '</div>' +
  '</div>';
}
async function archivarPeriodo(pIdx){
  var periodo = FAC_RENDER[pIdx];
  var esArch = FACTURAS.archivados.indexOf(periodo) >= 0;
  var res = await req('POST', '/api/facturas/periodo/archivar', { valor: periodo, archivar: !esArch });
  if (res.ok){ FACTURAS.periodos = res.data.periodos || []; FACTURAS.archivados = res.data.archivados || []; renderFacturas(); }
}
// Fila de una factura (descripción + monto + quitar). Sin ids: se leen por clase.
function facItemRow(k, label, monto){
  return '<div class="fac-item-row">' +
    '<input class="inp mini fac-desc" value="' + esc(label) + '" placeholder="Detalle (ej: FACTURA 06-26)" onchange="saveFacturaRow(\'' + k + '\')">' +
    '<input class="inp mini fac-monto" inputmode="decimal" value="' + esc(monto) + '" placeholder="Monto" oninput="facturaRecalcRow(\'' + k + '\')" onchange="saveFacturaRow(\'' + k + '\')">' +
    '<button class="icon-danger-btn mini" type="button" title="Quitar" onclick="removeFacturaItem(this,\'' + k + '\')"><svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
  '</div>';
}
// Bloque colapsable de un cliente dentro de un período.
function facturaCliBlock(c, pIdx){
  var periodo = FAC_RENDER[pIdx];
  var k = pIdx + '_' + c.slug;
  var r = FACTURAS.registros.find(function(x){ return x.slug === c.slug && x.periodo === periodo; });
  var items = (r && r.items && r.items.length) ? r.items : [{ label: '', monto: '' }];
  var total = items.reduce(function(a, it){ return a + (Number(it.monto) || 0); }, 0);
  var ret = Math.max(0, total - (Number(FACTURAS.minimo) || 0)) * (Number(c.retencionPct) || 0) / 100;
  var neto = total - ret;
  var base = c.baseComision === 'neto' ? neto : total;
  var com = base * (Number(c.comisionPct) || 0) / 100;
  var cad = com / (Number(c.socios) || 2);
  var abierto = FAC_CLI_OPEN[k] !== false;
  var itemsHtml = items.map(function(it){ return facItemRow(k, it.label || '', it.monto || ''); }).join('');
  return '<div class="fac-cli' + (abierto ? ' open' : '') + '" id="facCli_' + k + '">' +
    '<div class="fac-cli-head" onclick="toggleFacturaCli(\'' + k + '\')">' +
      '<svg class="nav-caret mini-caret" viewBox="0 0 24 24" fill="none"><path d="M8 10l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<b class="fac-cli-name">' + esc(c.name) + '</b>' +
      (c.pamiUser ? '<span class="fac-up" onclick="event.stopPropagation()" title="Nº de UP (podés seleccionarlo sin que se cierre)">' + esc(c.pamiUser) + '</span>' + '<button class="icon-btn mini" type="button" title="Copiar UP" onclick="event.stopPropagation();copiarTexto(\'' + esc(c.pamiUser) + '\',this)"><svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" stroke-width="1.8"/></svg></button>' + (c.tieneClave ? '<button class="icon-btn mini" type="button" title="Copiar clave PAMI" onclick="event.stopPropagation();copiarClavePami(\'' + c.slug + '\',this)"><svg viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" stroke-width="1.8"/></svg></button>' : '') : '') +
      '<span class="fac-tot">Total <b id="facTot_' + k + '">' + moneyFmt(total) + '</b></span>' +
      '<span class="fac-tot">Neto acred. <b id="facNet_' + k + '">' + moneyFmt(neto) + '</b></span>' +
      '<span class="fac-tot">Comisión <b id="facCom_' + k + '">' + moneyFmt(com) + '</b></span>' +
      '<span class="fac-tot">C/socio <b id="facCad_' + k + '">' + moneyFmt(cad) + '</b></span>' +
    '</div>' +
    '<div class="fac-cli-body">' +
      '<div class="fac-cli-cfg">' +
        '<div class="fac-cfg-row">' +
          '<label class="fac-cfg">Com. <input class="inp mini fac-in" id="facPct_' + k + '" inputmode="decimal" value="' + (c.comisionPct || 0) + '" oninput="facturaRecalcRow(\'' + k + '\')" onchange="saveFacturaConfig(\'' + k + '\',\'' + c.slug + '\')">%</label>' +
          '<label class="fac-cfg">Socios <input class="inp mini fac-in" id="facSoc_' + k + '" inputmode="numeric" value="' + (c.socios || 2) + '" oninput="facturaRecalcRow(\'' + k + '\')" onchange="saveFacturaConfig(\'' + k + '\',\'' + c.slug + '\')"></label>' +
          '<label class="fac-cfg">Ret. <input class="inp mini fac-in" id="facRet_' + k + '" inputmode="decimal" value="' + (c.retencionPct || 0) + '" oninput="facturaRecalcRow(\'' + k + '\')" onchange="saveFacturaConfig(\'' + k + '\',\'' + c.slug + '\')">%</label>' +
        '</div>' +
        '<div class="fac-cfg-row">' +
          '<label class="fac-cfg">Comisión sobre <select class="inp mini" id="facBase_' + k + '" onchange="saveFacturaConfig(\'' + k + '\',\'' + c.slug + '\')"><option value="bruto"' + (c.baseComision !== 'neto' ? ' selected' : '') + '>Bruto</option><option value="neto"' + (c.baseComision === 'neto' ? ' selected' : '') + '>Neto acred.</option></select></label>' +
          '<label class="fac-cfg">Cobro est. <input type="date" class="inp mini fac-fecha" id="facFec_' + k + '" value="' + esc(r && r.fechaCobro || '') + '" onchange="saveFacturaRow(\'' + k + '\')"></label>' +
          '<label class="fac-cfg">Subida <input type="checkbox" class="fac-chk" id="facSub_' + k + '" ' + (r && r.subida ? 'checked' : '') + ' onchange="saveFacturaRow(\'' + k + '\')"></label>' +
        '</div>' +
      '</div>' +
      '<div class="fac-items" id="facItems_' + k + '">' + itemsHtml + '</div>' +
      '<button class="btn btn-ghost btn-sm" type="button" onclick="addFacturaItem(\'' + k + '\')">+ Factura</button>' +
    '</div>' +
  '</div>';
}
// Recalcula Total/Comisión/C-socio de un cliente en vivo (sin re-render).
function facturaRecalcRow(k){
  var cont = document.getElementById('facItems_' + k);
  var total = 0;
  if (cont) cont.querySelectorAll('.fac-monto').forEach(function(inp){ total += facturaParseMonto(inp.value); });
  var pct = facturaParseMonto(document.getElementById('facPct_' + k).value);
  var soc = Math.max(1, Math.round(Number(document.getElementById('facSoc_' + k).value) || 2));
  var retPct = facturaParseMonto((document.getElementById('facRet_' + k) || {}).value);
  var baseEl = document.getElementById('facBase_' + k);
  var ret = Math.max(0, total - (Number(FACTURAS.minimo) || 0)) * retPct / 100, neto = total - ret;
  var base = (baseEl && baseEl.value === 'neto') ? neto : total;
  var com = base * pct / 100, cad = com / soc;
  var set = function(id, v){ var e = document.getElementById(id + k); if (e) e.textContent = moneyFmt(v); };
  set('facTot_', total); set('facNet_', neto); set('facCom_', com); set('facCad_', cad);
}
function addFacturaItem(k){
  var cont = document.getElementById('facItems_' + k); if (!cont) return;
  var tmp = document.createElement('div'); tmp.innerHTML = facItemRow(k, '', '');
  var fila = tmp.firstChild; cont.appendChild(fila);
  var desc = fila.querySelector('.fac-desc'); if (desc) desc.focus();
}
function removeFacturaItem(btn, k){
  var fila = btn.closest('.fac-item-row'); if (fila) fila.remove();
  saveFacturaRow(k);
}
function togglePeriodo(pIdx){
  var periodo = FAC_RENDER[pIdx];
  FAC_PER_OPEN[periodo] = !(FAC_PER_OPEN[periodo] === true);
  var el = document.getElementById('facPer_' + pIdx);
  if (el) el.classList.toggle('open', FAC_PER_OPEN[periodo]);
}
function toggleFacturaCli(k){
  var abierto = FAC_CLI_OPEN[k] !== false;
  FAC_CLI_OPEN[k] = !abierto;
  var el = document.getElementById('facCli_' + k);
  if (el) el.classList.toggle('open', FAC_CLI_OPEN[k]);
}
async function borrarPeriodo(pIdx){
  var periodo = FAC_RENDER[pIdx];
  if (!await nsConfirm('Se borra el período “' + periodo + '” y todas sus facturas.', { titulo:'Borrar período', okLabel:'Borrar', peligro:true })) return;
  var res = await req('POST', '/api/facturas/periodo/borrar', { valor: periodo });
  if (res.ok){ FACTURAS.periodos = res.data.periodos || []; if (res.data.archivados) FACTURAS.archivados = res.data.archivados; FACTURAS.registros = res.data.registros || []; delete FAC_PER_OPEN[periodo]; renderFacturas(); }
}
async function saveFacturaConfig(k, slug){
  var pct = facturaParseMonto(document.getElementById('facPct_' + k).value);
  var soc = Math.max(1, Math.round(Number(document.getElementById('facSoc_' + k).value) || 2));
  var ret = facturaParseMonto((document.getElementById('facRet_' + k) || {}).value);
  var baseEl = document.getElementById('facBase_' + k);
  var res = await req('POST', '/api/facturas/config', { slug: slug, comisionPct: pct, socios: soc, retencionPct: ret, baseComision: baseEl ? baseEl.value : 'bruto' });
  if (res.ok){
    var c = FACTURAS.clientes.find(function(x){ return x.slug === slug; });
    if (c){ c.comisionPct = res.data.comisionPct; c.socios = res.data.socios; c.retencionPct = res.data.retencionPct; c.baseComision = res.data.baseComision; }
    // Actualiza y recalcula el cliente en TODOS los períodos visibles (config global).
    FACTURAS.periodos.forEach(function(_, i){
      var kk = i + '_' + slug;
      var pe = document.getElementById('facPct_' + kk); if (pe) pe.value = res.data.comisionPct;
      var se = document.getElementById('facSoc_' + kk); if (se) se.value = res.data.socios;
      var re = document.getElementById('facRet_' + kk); if (re) re.value = res.data.retencionPct;
      var be = document.getElementById('facBase_' + kk); if (be) be.value = res.data.baseComision;
      if (document.getElementById('facItems_' + kk)) facturaRecalcRow(kk);
    });
  }
}
async function saveFacturaRow(k){
  facturaRecalcRow(k);
  var p = facParseKey(k);
  var cont = document.getElementById('facItems_' + k);
  var items = [];
  if (cont) cont.querySelectorAll('.fac-item-row').forEach(function(row){
    var mi = row.querySelector('.fac-monto');
    var m = facturaParseMonto(mi.value);
    // Si se pegó con símbolo/formato ("$ 129.761,13"), dejar el número limpio en pantalla.
    if (mi.value.trim() && String(m) !== mi.value.trim()) mi.value = m ? m : '';
    items.push({ label: row.querySelector('.fac-desc').value.trim(), monto: m });
  });
  var res = await req('POST', '/api/facturas', {
    slug: p.slug, periodo: p.periodo, items: items,
    fechaCobro: document.getElementById('facFec_' + k).value,
    subida: document.getElementById('facSub_' + k).checked,
  });
  if (res.ok){ FACTURAS.registros = res.data.registros || []; }
}
// Copia la clave PAMI del cliente al portapapeles (admin). La trae desencriptada
// del endpoint de credenciales del cliente.
async function copiarClavePami(slug, btn){
  var res = await api('/api/clientes/' + encodeURIComponent(slug) + '/pami/credenciales');
  if (!res.ok || !res.data){ if (btn){ var o = btn.getAttribute('title'); btn.setAttribute('title', 'No se pudo'); setTimeout(function(){ btn.setAttribute('title', o || 'Copiar clave PAMI'); }, 1400); } return; }
  copiarTexto(res.data.pamiPassword || '', btn);
}

// ===== Administración → Gastos (solo admin) =====
var GASTOS = { gastos: [], pagos: {}, dolar: { valor: 0, fecha: '' } };
function gastosPeriodoActual(){
  var el = document.getElementById('gastosPeriodo');
  if (el && !el.value){ var d = new Date(); el.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  return el ? el.value : '';
}
async function loadGastos(){
  gastosPeriodoActual();
  var err = document.getElementById('gastosError'); if (err) err.style.display = 'none';
  var res = await api('/api/gastos');
  if (!res.ok){ if (err){ err.style.display = ''; err.textContent = (res.data && res.data.error) || 'No se pudo cargar.'; } return; }
  GASTOS = { gastos: res.data.gastos || [], pagos: res.data.pagos || {}, dolar: res.data.dolar || { valor: 0, fecha: '' } };
  renderGastos();
}
function renderGastos(){
  var body = document.getElementById('gastosBody'); if (!body) return;
  var periodo = gastosPeriodoActual();
  var pagosMes = GASTOS.pagos[periodo] || {};
  var dolarTxt = document.getElementById('gastosDolar');
  if (dolarTxt) dolarTxt.innerHTML = GASTOS.dolar.valor ? ('💵 Dólar oficial: <b>' + moneyFmt(GASTOS.dolar.valor) + '</b>' + (GASTOS.dolar.fecha ? ' (' + esc(GASTOS.dolar.fecha) + ')' : '')) : '<span class="nom-muted">No pude traer la cotización del dólar.</span>';
  if (!GASTOS.gastos.length){ body.innerHTML = '<tr><td colspan="6" class="muted-cell">Sin gastos cargados.</td></tr>'; document.getElementById('gastosTotal').textContent = moneyFmt(0); return; }
  var total = 0;
  body.innerHTML = GASTOS.gastos.map(function(g){
    var pago = pagosMes[g.id];
    var pagado = !!(pago && pago.pagado);
    var rate = (pago && pago.rate) ? pago.rate : GASTOS.dolar.valor;
    var ars = g.moneda === 'USD' ? (Number(g.monto) || 0) * (Number(rate) || 0) : (Number(g.monto) || 0);
    total += ars;
    var montoTxt = g.moneda === 'USD' ? ('US$ ' + (Number(g.monto) || 0)) : moneyFmt(g.monto);
    var arsTxt = moneyFmt(ars) + (g.moneda === 'USD' && rate ? ' <span class="nom-muted">×' + moneyFmt(rate) + '</span>' : '');
    return '<tr>' +
      '<td>' + esc(g.concepto) + '</td>' +
      '<td class="num">' + (g.dia || '-') + '</td>' +
      '<td class="num">' + montoTxt + '</td>' +
      '<td class="num">' + arsTxt + '</td>' +
      '<td class="num"><input type="checkbox" class="fac-chk" ' + (pagado ? 'checked' : '') + ' onchange="toggleGastoPagado(\'' + g.id + '\', this.checked)"></td>' +
      '<td class="row-actions">' +
        '<button class="icon-btn mini" type="button" title="Editar" onclick="openGastoModal(\'' + g.id + '\')"><svg viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button> ' +
        '<button class="icon-danger-btn mini" type="button" title="Borrar" onclick="deleteGasto(\'' + g.id + '\')"><svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      '</td>' +
    '</tr>';
  }).join('');
  document.getElementById('gastosTotal').textContent = moneyFmt(total);
}
function openGastoModal(id){
  var g = id ? GASTOS.gastos.find(function(x){ return x.id === id; }) : null;
  document.getElementById('gastoId').value = g ? g.id : '';
  document.getElementById('gastoConcepto').value = g ? (g.concepto || '') : '';
  document.getElementById('gastoDia').value = g ? (g.dia || '') : '';
  document.getElementById('gastoMonto').value = g ? (g.monto || '') : '';
  document.getElementById('gastoMoneda').value = g ? (g.moneda || 'ARS') : 'ARS';
  document.getElementById('gastoTitle').textContent = g ? 'Editar gasto' : 'Nuevo gasto';
  document.getElementById('gastoModalError').textContent = '';
  showModal('gastoModal', 'gastoScrim');
  document.getElementById('gastoConcepto').focus();
}
function closeGastoModal(){ hideModal('gastoModal', 'gastoScrim'); }
async function saveGasto(){
  var errBox = document.getElementById('gastoModalError'); errBox.textContent = '';
  var concepto = document.getElementById('gastoConcepto').value.trim();
  if (!concepto){ errBox.textContent = 'Poné un concepto.'; return; }
  var btn = document.getElementById('gastoSaveBtn'); btn.disabled = true;
  var res = await req('POST', '/api/gastos', {
    id: document.getElementById('gastoId').value || '',
    concepto: concepto,
    dia: Number(document.getElementById('gastoDia').value) || 1,
    monto: facturaParseMonto(document.getElementById('gastoMonto').value),
    moneda: document.getElementById('gastoMoneda').value,
  });
  btn.disabled = false;
  if (!res.ok){ errBox.textContent = (res.data && res.data.error) || 'No se pudo guardar.'; return; }
  GASTOS.gastos = res.data.gastos || [];
  renderGastos();
  closeGastoModal();
}
async function deleteGasto(id){
  if (!await nsConfirm('Se borra este gasto fijo.', { titulo:'Borrar gasto', okLabel:'Borrar', peligro:true })) return;
  var res = await req('DELETE', '/api/gastos/' + encodeURIComponent(id));
  if (res.ok){ GASTOS.gastos = res.data.gastos || []; renderGastos(); }
}
async function toggleGastoPagado(id, pagado){
  var res = await req('POST', '/api/gastos/pagado', { periodo: gastosPeriodoActual(), gastoId: id, pagado: pagado });
  if (res.ok){ GASTOS.pagos = res.data.pagos || {}; renderGastos(); }
}
// Marca como pagados en el mes actual los mismos gastos que estaban pagados el mes
// anterior (los fijos recurrentes), así no hay que tildarlos uno por uno cada mes.
async function copiarGastosMesAnterior(){
  var periodo = gastosPeriodoActual(); if (!periodo){ return; }
  var res = await req('POST', '/api/gastos/copiar-pagos', { periodo: periodo });
  if (!res.ok){ nsAlert(res.error || 'No se pudo copiar.'); return; }
  GASTOS.pagos = res.data.pagos || GASTOS.pagos; renderGastos();
  if (!res.data.copiados) nsAlert('El mes anterior' + (res.data.prev ? ' (' + res.data.prev + ')' : '') + ' no tenía gastos pagados para copiar.');
}

// ===== Resumen de cuenta: sub-pestañas (Resumen · Ingresos · Gastos) =====
var RES_SECTION = 'resumen';
function setResSection(sec){
  RES_SECTION = sec;
  var secc = { resumen: 'res-sub-resumen', ingresos: 'res-sub-ingresos', gastos: 'res-sub-gastos' };
  var tabs = { resumen: 'resTabResumen', ingresos: 'resTabIngresos', gastos: 'resTabGastos' };
  Object.keys(secc).forEach(function(k){
    var s = document.getElementById(secc[k]); if (s) s.style.display = (k === sec) ? '' : 'none';
    var t = document.getElementById(tabs[k]); if (t) t.classList.toggle('active', k === sec);
  });
  if (sec === 'resumen') loadResultado();
  else if (sec === 'ingresos') loadIngresosExtra();
  else if (sec === 'gastos') loadGastos();
}

// ===== Ingresos extra (fuera de comisiones) =====
var INGRESOS = { ingresos: [], dolar: { valor: 0, fecha: '' } };
function ingresosPeriodoActual(){
  var el = document.getElementById('ingresosPeriodo');
  if (el && !el.value){ var d = new Date(); el.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  return el ? el.value : '';
}
async function loadIngresosExtra(){
  var periodo = ingresosPeriodoActual();
  var err = document.getElementById('ingresosError'); if (err) err.style.display = 'none';
  var res = await api('/api/ingresos?mes=' + encodeURIComponent(periodo));
  if (!res.ok){ if (err){ err.style.display = ''; err.textContent = (res.data && res.data.error) || 'No se pudo cargar.'; } return; }
  INGRESOS = { ingresos: res.data.ingresos || [], dolar: res.data.dolar || { valor: 0, fecha: '' } };
  renderIngresos();
}
function renderIngresos(){
  var body = document.getElementById('ingresosBody'); if (!body) return;
  var dolarTxt = document.getElementById('ingresosDolar');
  if (dolarTxt) dolarTxt.innerHTML = INGRESOS.dolar.valor ? ('💵 Dólar oficial: <b>' + moneyFmt(INGRESOS.dolar.valor) + '</b>' + (INGRESOS.dolar.fecha ? ' (' + esc(INGRESOS.dolar.fecha) + ')' : '')) : '';
  if (!INGRESOS.ingresos.length){ body.innerHTML = '<tr><td colspan="5" class="muted-cell">Sin ingresos extra este mes.</td></tr>'; document.getElementById('ingresosTotal').textContent = moneyFmt(0); return; }
  var total = 0;
  body.innerHTML = INGRESOS.ingresos.map(function(g){
    var partes = Math.max(2, Math.round(Number(g.partes) || 2));
    var nsShare = (typeof g.nsShareArs === 'number') ? g.nsShareArs
      : ((g.moneda === 'USD' ? (Number(g.monto) || 0) * (Number(INGRESOS.dolar.valor) || 0) : (Number(g.monto) || 0)) * 2 / partes);
    total += nsShare;
    var montoTxt = g.moneda === 'USD' ? ('US$ ' + (Number(g.monto) || 0)) : moneyFmt(g.monto);
    var divideTxt = partes === 2 ? '2 (todo NS)' : (partes + ' (2/' + partes + ' NS)');
    return '<tr>' +
      '<td>' + esc(g.descripcion) + '</td>' +
      '<td class="num">' + montoTxt + '</td>' +
      '<td class="num">' + divideTxt + '</td>' +
      '<td class="num">' + moneyFmt(nsShare) + '</td>' +
      '<td class="row-actions">' +
        '<button class="icon-btn mini" type="button" title="Editar" onclick="openIngresoModal(\'' + g.id + '\')"><svg viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button> ' +
        '<button class="icon-danger-btn mini" type="button" title="Borrar" onclick="deleteIngreso(\'' + g.id + '\')"><svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      '</td>' +
    '</tr>';
  }).join('');
  document.getElementById('ingresosTotal').textContent = moneyFmt(total);
}
function openIngresoModal(id){
  var g = id ? INGRESOS.ingresos.find(function(x){ return x.id === id; }) : null;
  document.getElementById('ingresoId').value = g ? g.id : '';
  document.getElementById('ingresoDescripcion').value = g ? (g.descripcion || '') : '';
  document.getElementById('ingresoMonto').value = g ? (g.monto || '') : '';
  document.getElementById('ingresoMoneda').value = g ? (g.moneda || 'ARS') : 'ARS';
  document.getElementById('ingresoPartes').value = String((g && g.partes) || 2);
  document.getElementById('ingresoTitle').textContent = g ? 'Editar ingreso' : 'Nuevo ingreso';
  document.getElementById('ingresoModalError').textContent = '';
  showModal('ingresoModal', 'ingresoScrim');
  document.getElementById('ingresoDescripcion').focus();
}
function closeIngresoModal(){ hideModal('ingresoModal', 'ingresoScrim'); }
async function saveIngreso(){
  var errBox = document.getElementById('ingresoModalError'); errBox.textContent = '';
  var descripcion = document.getElementById('ingresoDescripcion').value.trim();
  if (!descripcion){ errBox.textContent = 'Poné una descripción.'; return; }
  var btn = document.getElementById('ingresoSaveBtn'); btn.disabled = true;
  var res = await req('POST', '/api/ingresos', {
    id: document.getElementById('ingresoId').value || '',
    descripcion: descripcion,
    mes: ingresosPeriodoActual(),
    monto: facturaParseMonto(document.getElementById('ingresoMonto').value),
    moneda: document.getElementById('ingresoMoneda').value,
    partes: Number(document.getElementById('ingresoPartes').value) || 2,
  });
  btn.disabled = false;
  if (!res.ok){ errBox.textContent = (res.data && res.data.error) || 'No se pudo guardar.'; return; }
  closeIngresoModal();
  loadIngresosExtra();
}
async function deleteIngreso(id){
  if (!await nsConfirm('Se borra este ingreso.', { titulo:'Borrar ingreso', okLabel:'Borrar', peligro:true })) return;
  var res = await req('DELETE', '/api/ingresos/' + encodeURIComponent(id));
  if (res.ok) loadIngresosExtra();
}

// ===== Inicio: resultado económico del mes (solo admin) =====
async function loadResultado(){
  var card = document.getElementById('dashResultado'); if (!card) return;
  if (!ME || ME.role !== 'admin'){ card.style.display = 'none'; return; }
  card.style.display = '';
  var mesEl = document.getElementById('resMes');
  if (mesEl && !mesEl.value){ var d = new Date(); mesEl.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  var mes = mesEl ? mesEl.value : '';
  var res = await api('/api/resultado' + (mes ? '?mes=' + encodeURIComponent(mes) : ''));
  if (!res.ok || !res.data) return;
  var d = res.data;
  // Falta cobrar (arriba, grande) = facturas + ingresos extra todavía SIN cobrar.
  // Ganancia real del mes (abajo) = lo efectivamente cobrado − gastos pagados. Los
  // ingresos extra ahora funcionan igual que las facturas: cuentan solo si están cobrados.
  var faltaCobrar = 0, cobrado = 0;
  (d.detalle || []).concat(d.extras || []).forEach(function(x){ if (x.cobrado) cobrado += (x.monto || 0); else faltaCobrar += (x.monto || 0); });
  var ganancia = cobrado - (d.gastos || 0);
  var bols = document.getElementById('resBolsillo');
  bols.textContent = moneyFmt(faltaCobrar);
  bols.classList.toggle('neg', faltaCobrar < 0);
  var gan = document.getElementById('resGanancia');
  gan.textContent = moneyFmt(ganancia);
  gan.classList.toggle('neg', ganancia < 0);
  document.getElementById('resCobrado').textContent = moneyFmt(cobrado);
  document.getElementById('resGastos').textContent = moneyFmt(d.gastos);
  document.getElementById('resIngreso').textContent = moneyFmt(d.ingresoNS);
  document.getElementById('resNacho').textContent = moneyFmt(ganancia / 2);
  document.getElementById('resSeba').textContent = moneyFmt(ganancia / 2);
  // Desglose: cada factura con su comisión NS + check de cobrado (vencido si la
  // fecha de cobro ya pasó y no está marcada).
  var box = document.getElementById('resDesglose');
  if (box){
    var hoy = new Date(); hoy = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0') + '-' + String(hoy.getDate()).padStart(2, '0');
    var mapFila = function(x){
      var vencido = !x.cobrado && x.fechaCobro && x.fechaCobro < hoy;
      var cls = 'mescurso-line res-cobro-line' + (x.cobrado ? ' cobrado' : (vencido ? ' vencido' : ''));
      var fecha = x.fechaCobro ? x.fechaCobro.split('-').reverse().slice(0, 2).join('/') : '';
      var nota = fecha
        ? '<span class="res-fecha">' + (x.cobrado ? '✓ cobrado' : (vencido ? '⚠ cobro vencido ' + fecha : 'cobra ' + fecha)) + '</span>'
        : (x.cobrado ? '<span class="res-fecha">✓ cobrado</span>' : '');
      var toggle = x.extra ? 'toggleIngresoCobrado' : 'toggleResCobrado';
      var etq = x.extra ? ' <span class="res-etq">extra</span>' : '';
      return '<div class="' + cls + '">' +
        '<span class="res-cobro-nombre"><input type="checkbox" class="res-check" ' + (x.cobrado ? 'checked' : '') + ' onchange="' + toggle + '(\'' + esc(x.id) + '\', this.checked)" title="Marcar cobrado">' +
        esc(x.name) + etq + ' ' + nota + '</span>' +
        '<b>' + (x.extra ? '+ ' : '') + moneyFmt(x.monto) + '</b>' +
      '</div>';
    };
    var filas = (d.detalle || []).map(mapFila).join('') + (d.extras || []).map(mapFila).join('');
    if (!filas) filas = '<div class="mescurso-line"><span class="nom-muted">Sin facturas ni ingresos con cobro en el mes</span><b></b></div>';
    // La línea muestra el TOTAL de gastos fijos del mes (impacta aunque no se haya
    // pagado); la nota dice cuánto va pagado. La ganancia real de arriba resta solo
    // lo pagado (se descuenta a medida que se paga).
    var gTot = d.gastosTotal || 0, gPag = d.gastos || 0;
    var notaG = gTot > 0 ? '<span class="res-fecha">' + (gPag >= gTot ? '✓ todo pagado' : 'pagado ' + moneyFmt(gPag) + ' de ' + moneyFmt(gTot)) + '</span>' : '';
    filas += '<div class="mescurso-line alert"><span>Gastos fijos ' + notaG + '</span><b>− ' + moneyFmt(gTot) + '</b></div>';
    box.innerHTML = filas;
  }
  document.getElementById('resDetalle').textContent = d.facturasContadas + ' factura(s) con cobro en el mes · dólar oficial ' + (d.dolar && d.dolar.valor ? moneyFmt(d.dolar.valor) : '—');
  renderResChart(d.serie || [], d.mes);
  loadResClientes();
}
// Comparativa de facturación neta por cliente: cada uno contra su propio
// último cierre vs. el anterior (no todos cierran el mismo mes calendario).
// Pensado para ir evaluando la tendencia a medida que se acumulan meses.
async function loadResClientes(){
  var card = document.getElementById('resClientsCard');
  var box = document.getElementById('resClientsChart');
  if (!card || !box) return;
  var res = await api('/api/resultado/clientes');
  if (!res.ok){ card.style.display = 'none'; return; }
  var clientes = res.data.clientes || [];
  card.style.display = '';
  if (!clientes.length){
    box.innerHTML = '<div class="rescli-empty">Todavía no hay reportes cerrados para comparar.</div>';
    return;
  }
  var max = clientes.reduce(function(mx, c){ return Math.max(mx, Math.abs(c.net || 0)); }, 0) || 1;
  box.innerHTML = clientes.map(function(c){
    var pct = c.delta && c.delta.percent;
    var deltaCls = 'flat', deltaTxt = 'sin dato previo';
    if (pct != null){
      deltaCls = pct > 0.001 ? 'pos' : (pct < -0.001 ? 'neg' : 'flat');
      deltaTxt = (pct > 0 ? '+' : '') + Math.round(pct * 100) + '%';
    }
    var w = Math.max(3, Math.round(Math.abs(c.net || 0) / max * 100));
    return '<div class="rescli-row" title="' + esc(c.label || c.period) + (c.comparePeriod ? (' vs ' + esc(resMesCorto(c.comparePeriod))) : '') + '">'
      + '<div class="rescli-info"><span class="rescli-name">' + esc(c.name) + '</span>'
      + '<span class="rescli-delta ' + deltaCls + '">' + esc(deltaTxt) + '</span></div>'
      + '<span class="rescli-amt">' + esc(moneyFmt(c.net || 0)) + '</span>'
      + '<div class="rescli-bar-track"><div class="rescli-bar-fill" style="width:' + w + '%"></div></div>'
      + '</div>';
  }).join('');
}
async function toggleResCobrado(id, cobrado){
  var res = await req('POST', '/api/facturas/cobrado', { id: id, cobrado: cobrado });
  if (res.ok) loadResultado();
}
async function toggleIngresoCobrado(id, cobrado){
  var res = await req('POST', '/api/ingresos/cobrado', { id: id, cobrado: cobrado });
  if (res.ok) loadResultado();
}
var RES_MESES = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function resMesCorto(mes){ var p = String(mes).split('-'); return (RES_MESES[Number(p[1])] || '') + ' ' + String(p[0] || '').slice(2); }
function renderResChart(serie, mesSel){
  var box = document.getElementById('resChart'); if (!box) return;
  if (!serie.length){ box.innerHTML = '<div class="nom-muted">Sin datos.</div>'; return; }
  var max = 1;
  serie.forEach(function(s){ max = Math.max(max, Math.abs(s.bolsilloNS)); });
  box.innerHTML = serie.map(function(s){
    var h = Math.round(Math.abs(s.bolsilloNS) / max * 100);
    var cls = 'rc-fill' + (s.bolsilloNS < 0 ? ' neg' : '') + (s.mes === mesSel ? ' sel' : '');
    return '<div class="rc-bar" title="' + resMesCorto(s.mes) + ': ' + moneyFmt(s.bolsilloNS) + '">' +
      '<div class="rc-track"><div class="' + cls + '" style="height:' + h + '%"></div></div>' +
      '<div class="rc-lbl">' + resMesCorto(s.mes) + '</div>' +
    '</div>';
  }).join('');
}
function openMedicoModal(id){
  var m = id ? MEDICOS.find(function(x){ return x.id === id; }) : null;
  document.getElementById('medicoId').value = m ? m.id : '';
  document.getElementById('medicoNombre').value = m ? (m.nombre || '') : '';
  document.getElementById('medicoEspecialidad').value = m ? (m.especialidad || '') : '';
  document.getElementById('medicoUsuario').value = m ? (m.usuario || '') : '';
  document.getElementById('medicoTelefono').value = m ? (m.telefono || '') : '';
  var clave = document.getElementById('medicoClave'); clave.value = ''; clave.type = 'password';
  document.getElementById('medicoClaveIco').innerHTML = EYE_ON;
  document.getElementById('medicoClaveHint').textContent = (m && m.tieneClave) ? 'Ya hay una clave guardada — dejá vacío para no cambiarla.' : 'Se guarda encriptada.';
  document.getElementById('medicoTitle').textContent = m ? 'Editar médico' : 'Nuevo médico';
  document.getElementById('medicoModalError').textContent = '';
  showModal('medicoModal', 'medicoScrim');
  document.getElementById('medicoNombre').focus();
}
function closeMedicoModal(){ hideModal('medicoModal', 'medicoScrim'); }
async function saveMedico(){
  if (!ACTIVE_CLIENT) return;
  var errBox = document.getElementById('medicoModalError'); errBox.textContent = '';
  var nombre = document.getElementById('medicoNombre').value.trim();
  if (!nombre){ errBox.textContent = 'El nombre y apellido es obligatorio.'; return; }
  var btn = document.getElementById('medicoSaveBtn'); btn.disabled = true;
  var res = await req('POST', '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/medicos', {
    id: document.getElementById('medicoId').value || '',
    nombre: nombre,
    especialidad: document.getElementById('medicoEspecialidad').value.trim(),
    usuario: document.getElementById('medicoUsuario').value.trim(),
    clave: document.getElementById('medicoClave').value,
    telefono: document.getElementById('medicoTelefono').value.trim(),
  });
  btn.disabled = false;
  if (!res.ok){ errBox.textContent = (res.data && res.data.error) || 'No se pudo guardar.'; return; }
  MEDICOS = (res.data && res.data.medicos) || [];
  renderClientMedicos();
  closeMedicoModal();
}
async function deleteMedico(id){
  if (!ACTIVE_CLIENT || !id) return;
  var m = MEDICOS.find(function(x){ return x.id === id; });
  if (!await nsConfirm('Se borra a ' + ((m && m.nombre) || 'este médico') + '.', { titulo:'Borrar médico', okLabel:'Borrar', peligro:true })) return;
  var res = await req('DELETE', '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/medicos/' + encodeURIComponent(id));
  if (!res.ok){ var err = document.getElementById('medicosError'); if (err){ err.style.display = ''; err.textContent = (res.data && res.data.error) || 'No se pudo borrar.'; } return; }
  MEDICOS = (res.data && res.data.medicos) || [];
  renderClientMedicos();
}
// Panel "Dashboard mes en curso": dos cuadros resumen (mes en curso desde la
// bandeja de la app + mes pasado sin cerrar desde el último reporte con débitos
// sin confirmar) y, debajo, la bandeja cruda que subió la app.
var MESCURSO_MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
var MESCURSO_REPORTE_ID = null;
var MESCURSO_FALTAN_INFORMES = []; // detalle copiable de las que faltan informe (mes en curso)
var MESCURSO_POSIBLES_DEBITOS = []; // detalle copiable de los cruces que debitan (mes en curso)
var MESCURSO_FALTAN_INFORMES_JULIO = []; // faltan informe del reporte "sin cerrar"
var MESCURSO_POSIBLES_DEBITOS_JULIO = []; // posibles débitos del reporte "sin cerrar"
var MESCURSO_DEBITOS_CERRADO = []; // débitos del mes cerrado (card "Cerrado", el ante-último)
var MESCURSO_FALTAN_INFORMES_CERRADO = []; // faltan informe del mes cerrado (card "Cerrado")
var MESCURSO_MODULOS = [];          // desglose por módulo del mes en curso
var MESCURSO_MODULOS_JULIO = [];    // ... del reporte "sin cerrar"
var MESCURSO_MODULOS_CERRADO = [];  // ... del mes cerrado
// Normaliza el desglose por módulo (mes en curso trae gross; los reportes traen net).
function mescMods(arr){ return (Array.isArray(arr)?arr:[]).map(function(m){
  // "Mes en curso" manda grossTransmitido/grossPendiente (sobre el bruto, sin
  // débitos todavía); "sin cerrar"/"cerrado" mandan netTransmitido/netPendiente
  // (sobre el neto, ya con débitos descontados) — en los dos casos es la misma
  // idea: cuánto de la columna ya es transmitido = cobro real, y cuánto todavía
  // no (validado sin transmitir, por transmitir, etc.) y por lo tanto no está
  // garantizado.
  var transmitido = (m.netTransmitido!=null?m.netTransmitido:(m.grossTransmitido!=null?m.grossTransmitido:null));
  var pendiente = (m.netPendiente!=null?m.netPendiente:(m.grossPendiente!=null?m.grossPendiente:null));
  // La facturación del módulo es la TRANSMITIDA, nada más — ausentes, no
  // transmitidos y falta informe no suman a ningún total hasta que se
  // transmiten. "Pendiente" queda solo informativo, aparte, sin sumarse.
  var monto = (transmitido != null) ? transmitido : (m.net != null ? m.net : (m.gross || 0));
  return { code:m.moduleCode||'', desc:m.moduleDescription||'', consultas:m.consultations||0, practicas:m.practices||0, monto:monto,
  montoTransmitido: transmitido, montoPendiente: pendiente,
  sinValor:m.sinValor||0, sinValorCodigos:(m.sinValorCodigos||[]) }; }); }
// Todos los períodos (mes en curso, sin cerrar, cerrado) ya traen desglose
// transmitido/pendiente por módulo (ver mescMods) — esta función queda para
// cubrir el caso raro de un período sin ese dato (reporte muy viejo).
function mesCursoModHayDesglose(md){ return (md || []).some(function(m){ return m.montoTransmitido != null; }); }
var MESCURSO_POSIBLES_DEBITOS_ADELANTE = []; // posibles débitos de turnos futuros (hacia adelante)
var MESCURSO_FUTUROS = [];   // meses futuros (sep, oct…) con sus posiblesDebitosRows
var MESCURSO_POSIBLES_DEBITOS_FUTURO = []; // el mes futuro que se está viendo en el panel
var MESCURSO_AUSENTES = [];          // detalle de ausentes (con turno pero sin validar)
var MESCURSO_AUSENTES_JULIO = [];    // ausentes del reporte "sin cerrar"
var MESCURSO_AUSENTES_CERRADO = [];  // ausentes del mes cerrado
var MESCURSO_FUERACORTE_JULIO = [];  // prácticas a facturar fuera de corte (reporte "sin cerrar")
var MESCURSO_MEDCAB_HISTORIAL = [];  // historial por mes del dashboard de médico de cabecera (para exportar)
var MESCURSO_PERIODO_ACTUAL = '';
var MESCURSO_PERIODO_JULIO = '';
var MESCURSO_PERIODO_CERRADO = '';
var MESCURSO_PANEL_ABIERTO = '';    // '' | 'informes' | 'debitos' | 'informes-julio' | 'debitos-julio' | 'debitos-adelante' | 'ausentes'
var MESCURSO_PANEL_SORT = {};       // panelId -> { col, dir }
// Toggle "detalle / agrupado por módulo" al lado de PDF/Excel/Copiar, en los paneles
// que listan benef/apellido/práctica/turno/valor (ausentes, faltan informes, fuera de
// corte). Alterna cómo se ven las MISMAS filas del panel, no trae otro dato del mes.
var MESCURSO_PANEL_VISTA = {};      // panelId -> 'detalle' | 'modulo'
function mesCursoSetCaret(id, abierto){ var c = document.getElementById(id); if (c) c.textContent = abierto ? '▾' : '▸'; }
function mesCursoAgruparPorModulo(rows){
  var map = {}, orden = [];
  (rows || []).forEach(function(x){
    var key = (x.modCode || '') + '|' + (x.modDesc || '');
    if (!map[key]){ map[key] = { code: x.modCode || '', desc: x.modDesc || 'Sin módulo', consultas: 0, practicas: 0, monto: 0 }; orden.push(key); }
    var m = map[key];
    if (x.esConsulta) m.consultas++; else m.practicas++;
    m.monto += Number(x.valor) || 0;
  });
  return orden.map(function(k){ return map[k]; })
    .sort(function(a, b){ return (b.consultas + b.practicas) - (a.consultas + a.practicas); });
}
function mesCursoAlternarVista(tipo){
  MESCURSO_PANEL_VISTA[tipo] = (MESCURSO_PANEL_VISTA[tipo] === 'modulo') ? 'detalle' : 'modulo';
  MESCURSO_PANEL_ABIERTO = ''; // fuerza a redibujar abierto (no a cerrar) con la vista nueva
  mesCursoTogglePanel(tipo);
}
// Arma un panel "benef/apellido/práctica/turno/valor" que además puede verse
// agrupado por módulo (mismas filas, agrupadas) según MESCURSO_PANEL_VISTA[tipo].
// accionFn (crear informe / liberar cupo) solo aplica en la vista de detalle: no
// tiene sentido "crear informe" sobre un módulo entero.
function mesCursoPanelDetalleOModulo(tipo, arr, tituloBase, tono, copiaFn, accionFn){
  var vista = MESCURSO_PANEL_VISTA[tipo] || 'detalle';
  var toggleBtn = '<button class="btn btn-ghost" type="button" title="Alternar entre el detalle y el agrupado por módulo" onclick="mesCursoAlternarVista(\'' + tipo + '\')">'
    + (vista === 'modulo' ? '📋 Ver detalle' : '📦 Ver por módulo') + '</button>';
  if (vista === 'modulo'){
    var mods = mesCursoAgruparPorModulo(arr);
    var modCols = ['Módulo', 'Consultas', 'Prácticas', 'Facturación'];
    var mapMod = function(m){ return [(m.code ? m.code + ' - ' : '') + m.desc, numberFmt(m.consultas), numberFmt(m.practicas), moneyFmt(m.monto)]; };
    return mods.length ? mesCursoTablaHtml(tituloBase + ' (por módulo) · ' + mods.length, tono, copiaFn, modCols, mods.map(mapMod), tipo, null, toggleBtn, [3])
      : mesCursoVacioHtml(tituloBase, tono);
  }
  var cols = ['Benef', 'Apellido y nombre', 'Práctica', 'Turno', 'Valor'];
  var mapInformes = function(x){ return [x.benef, x.nombre, x.practica, x.turno, moneyFmt(x.valor || 0)]; };
  return arr.length ? mesCursoTablaHtml(tituloBase + ' · ' + arr.length, tono, copiaFn, cols, arr.map(mapInformes), tipo, accionFn, toggleBtn, [4])
    : mesCursoVacioHtml(tituloBase, tono);
}
function toggleFaltanInformes(){ mesCursoTogglePanel('informes'); }
function togglePosiblesDebitos(){ mesCursoTogglePanel('debitos'); }
function toggleAusentes(){ mesCursoTogglePanel('ausentes'); }
function toggleFaltanInformesJulio(){ mesCursoTogglePanel('informes-julio'); }
function toggleFaltanInformesCerrado(){ mesCursoTogglePanel('informes-cerrado'); }
function toggleDebitosJulio(){ mesCursoTogglePanel('debitos-julio'); }
function toggleDebitosCerrado(){ mesCursoTogglePanel('debitos-cerrado'); }
function toggleAusentesJulio(){ mesCursoTogglePanel('ausentes-julio'); }
function toggleAusentesCerrado(){ mesCursoTogglePanel('ausentes-cerrado'); }
function toggleFueraCorteJulio(){ mesCursoTogglePanel('fueracorte-julio'); }
function toggleModulos(){ mesCursoTogglePanel('modulos'); }
function toggleModulosJulio(){ mesCursoTogglePanel('modulos-julio'); }
function toggleModulosCerrado(){ mesCursoTogglePanel('modulos-cerrado'); }
function toggleDebitosAdelante(){ mesCursoTogglePanel('debitos-adelante'); }
function toggleDebitosFuturo(period){ mesCursoTogglePanel('debitos-futuro:' + period); }
// ---- Crear informe directo desde "Faltan informes" -------------------------
// Los modelos traen codigoPractica (ej "570129") y la fila de faltante trae la
// práctica como "570129 - CONSULTA...". Si hay un modelo con ese código, se
// puede generar el PDF de una: usa el médico y el texto por defecto del modelo.
var _informesCfgCargando = false;
function ensureInformesCfg(cb){
  if ((INFORMES_CFG.modelos || []).length){ if (cb) cb(); return; }
  if (_informesCfgCargando) return;
  _informesCfgCargando = true;
  api('/api/informes/config').then(function(res){
    if (res.ok && res.data) INFORMES_CFG = res.data;
    _informesCfgCargando = false;
    if (cb) cb();
  }).catch(function(){ _informesCfgCargando = false; });
}
function codigoDePractica(s){ var m = String(s || '').match(/\d{4,}/); return m ? m[0] : ''; }
// Palabras genéricas que no distinguen una práctica de otra (no puntúan en el
// match por nombre).
var _PRACT_GENERICAS = { ECOGRAFIA:1, ECOGRAFICO:1, ECOGRAFICA:1, ECO:1, DE:1, DEL:1, LA:1, EL:1, LOS:1, LAS:1, Y:1, O:1, CON:1, SIN:1, POR:1, COMPLETA:1, COMPLETO:1, BILATERAL:1, BIALTERAL:1, COMPUTARIZADA:1, COMPUTARIZADO:1, ESTUDIO:1, MEDICION:1, UNI:1, INCLUYE:1, INSUMOS:1, CATETERES:1, NI:1 };
function _normPract(s){
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function _clavesPract(s){
  // Los números sueltos no cuentan como palabra del nombre: el código ya se usó
  // para elegir los candidatos, y si además puntúa acá, el modelo que lo lleva
  // escrito en su práctica (ej. "180114 - Ecografía vesicoprostática") le gana a
  // todos los que comparten ese código aunque el nombre no tenga nada que ver.
  return _normPract(s).split(' ').filter(function(w){ return w.length >= 3 && !_PRACT_GENERICAS[w] && !/^\d+$/.test(w); });
}
// Elige, entre una lista de modelos, el que mejor pega por nombre con la práctica
// de la fila. Puntúa por palabras clave compartidas; a igualdad, gana el modelo
// más específico que no le sobren palabras (vesical vs vesical-con-residuo).
function _mejorModeloPorNombre(practica, modelos){
  var filaKw = _clavesPract(practica);
  if (!filaKw.length) return null;
  var best = null, bestScore = -1;
  (modelos || []).forEach(function(m){
    var mKw = _clavesPract([m.estudio, m.label, m.practica].filter(Boolean).join(' '));
    if (!mKw.length) return;
    var matched = mKw.filter(function(w){ return filaKw.indexOf(w) >= 0; }).length;
    if (!matched) return;
    // más palabras compartidas manda; a igualdad, el modelo con menos palabras
    // clave (match más ajustado, sin pedir de más).
    var score = matched - mKw.length * 0.001;
    if (score > bestScore){ bestScore = score; best = m; }
  });
  return best;
}
function modeloParaPracticaRow(practica){
  var modelos = INFORMES_CFG.modelos || [];
  var cod = codigoDePractica(practica);
  if (cod){
    var porCod = modelos.filter(function(m){ return String(m.codigoPractica || '') === cod; });
    if (porCod.length === 1) return porCod[0];
    // Varios modelos con el mismo código (ej. PAMI usa 180114 para vesical Y
    // próstata): desempata por el nombre de la fila.
    if (porCod.length > 1) return _mejorModeloPorNombre(practica, porCod) || porCod[0];
  }
  // Sin código o código sin modelo: matchea por nombre (los modelos de ecografía
  // tienen codigoPractica vacío pero el estudio identifica la práctica).
  return _mejorModeloPorNombre(practica, modelos);
}
function faltanInformesDe(panelId){
  if (panelId === 'informes') return MESCURSO_FALTAN_INFORMES || [];
  if (panelId === 'informes-julio') return MESCURSO_FALTAN_INFORMES_JULIO || [];
  if (panelId === 'informes-cerrado') return MESCURSO_FALTAN_INFORMES_CERRADO || [];
  return [];
}
// Botón por fila: sólo aparece si hay un modelo para esa práctica.
var MESCURSO_OMES_GEN = {}; // OMEs que ya tienen informe generado (para no crear/subir de nuevo)
var MESCURSO_FALTANTES_DESEST = {}; // OMEs de faltantes desestimados (no se crea informe; el monto igual cuenta)
function accionCrearInforme(panelId){
  if (!puedeAccionesGestionCliente()) return null;
  return function(idx){
    var x = faltanInformesDe(panelId)[idx];
    if (!x) return '';
    var omeDig = String(x.ome || '').replace(/\D/g, '');
    // Desestimado (ej. paciente no afiliado): no se ofrece crear/subir. El monto
    // sigue contando (es plata perdida), solo se bloquea la acción. Reversible.
    if (omeDig && MESCURSO_FALTANTES_DESEST[omeDig]) {
      return '<span class="mc-desest" style="color:var(--text-2);font-weight:600;font-size:12px;white-space:nowrap" title="Desestimado: no se le genera informe. El monto sigue contando como plata perdida.">🚫 Desestimado</span>'
        + ' <button class="btn btn-ghost mc-crear" type="button" title="Reactivar (volver a ofrecer crear)" onclick="reactivarFaltante(\'' + panelId + '\',' + idx + ',this)">↩️</button>';
    }
    // Ya se generó/subió un informe para esta OME (aunque la bandeja no lo refleje):
    // no se ofrece crear/subir de nuevo. Persiste tras F5 (viene de omes-generadas).
    if (omeDig && MESCURSO_OMES_GEN[omeDig]) {
      return '<span class="mc-generado" style="color:#16a34a;font-weight:600;font-size:12px;white-space:nowrap" title="Ya se generó un informe para esta OME (subiéndose o subido). Cuando la bandeja se refresque, sale de la lista.">✅ Generado</span>';
    }
    var puedeCrear = !!modeloParaPracticaRow(x.practica);
    var btn = '';
    if (puedeCrear) {
      btn += '<button class="btn btn-ghost mc-crear" type="button" title="Crear informe" onclick="crearInformeDirecto(\'' + panelId + '\',' + idx + ',this)">📝 Crear</button>';
      // "Crear y subir": solo si la fila trae la OME (sin OME no se puede subir).
      if (x.ome) btn += ' <button class="btn btn-ghost mc-crear-subir" type="button" title="Crear y subir a PAMI" onclick="crearYSubirInforme(\'' + panelId + '\',' + idx + ',this)">📤 Crear y subir</button>';
    }
    // "Desestimar": disponible siempre que haya OME (para poder marcarlo), aunque
    // no exista modelo para la práctica.
    if (omeDig) btn += ' <button class="btn btn-ghost mc-desest-btn" type="button" title="Desestimar: no generar informe (paciente no afiliado, etc.). El monto igual cuenta." onclick="desestimarFaltante(\'' + panelId + '\',' + idx + ',this)">🚫 Desestimar</button>';
    return btn;
  };
}
async function desestimarFaltante(panelId, idx, btn){
  var x = faltanInformesDe(panelId)[idx]; if (!x) return;
  var omeDig = String(x.ome || '').replace(/\D/g, ''); if (!omeDig) return;
  var slug = ACTIVE_CLIENT && ACTIVE_CLIENT.slug; if (!slug) return;
  var motivo = await nsPrompt('¿Por qué se desestima? (queda anotado)', {
    titulo: 'Desestimar faltante', cuerpo: (x.nombre || x.patientName || '') + ' — ' + (x.practica || ''),
    placeholder: 'Ej: paciente no afiliado', okLabel: 'Desestimar' });
  if (motivo === null) return;
  var r = await api('/api/clientes/' + encodeURIComponent(slug) + '/faltantes/' + omeDig + '/desestimar', { motivo: motivo });
  if (!r.ok){ nsAlert((r.data && r.data.error) || 'No se pudo desestimar.'); return; }
  MESCURSO_FALTANTES_DESEST[omeDig] = 1;
  // Re-dibuja el panel abierto para reflejar el cambio (mismo tipo = panelId).
  if (typeof mesCursoTogglePanel === 'function'){ MESCURSO_PANEL_ABIERTO = ''; mesCursoTogglePanel(panelId); }
}
async function reactivarFaltante(panelId, idx, btn){
  var x = faltanInformesDe(panelId)[idx]; if (!x) return;
  var omeDig = String(x.ome || '').replace(/\D/g, ''); if (!omeDig) return;
  var slug = ACTIVE_CLIENT && ACTIVE_CLIENT.slug; if (!slug) return;
  var r = await api('/api/clientes/' + encodeURIComponent(slug) + '/faltantes/' + omeDig + '/desestimar', { desestimar: false });
  if (!r.ok){ nsAlert((r.data && r.data.error) || 'No se pudo reactivar.'); return; }
  delete MESCURSO_FALTANTES_DESEST[omeDig];
  // Re-dibuja el panel abierto para reflejar el cambio (mismo tipo = panelId).
  if (typeof mesCursoTogglePanel === 'function'){ MESCURSO_PANEL_ABIERTO = ''; mesCursoTogglePanel(panelId); }
}
function ausentesDePanel(panelId){
  if (panelId === 'ausentes') return MESCURSO_AUSENTES || [];
  if (panelId === 'ausentes-julio') return MESCURSO_AUSENTES_JULIO || [];
  if (panelId === 'ausentes-cerrado') return MESCURSO_AUSENTES_CERRADO || [];
  return [];
}
function periodoAusentesPanel(panelId, fila){
  var turno = String((fila && fila.turno) || '');
  var m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(turno);
  if (m) return m[3] + '-' + m[2];
  if (panelId === 'ausentes') return MESCURSO_PERIODO_ACTUAL || '';
  if (panelId === 'ausentes-julio') return MESCURSO_PERIODO_JULIO || '';
  if (panelId === 'ausentes-cerrado') return MESCURSO_PERIODO_CERRADO || '';
  return '';
}
function fechaAusenteIso(fila){
  var m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String((fila && fila.turno) || ''));
  return m ? (m[3] + '-' + m[2] + '-' + m[1]) : '';
}
// Clínica (dueño del centro) y colaborador ven los listados (quién falta, quién
// faltó) igual que siempre, pero NO las acciones de gestión (crear/subir/
// desestimar informe, liberar cupo) - eso sigue siendo trabajo de NS. Central
// en un solo lugar para poder habilitarlo más adelante por configuración
// puntual, si hace falta, sin tocar cada botón por separado.
function puedeAccionesGestionCliente(){
  return !(ME && (ME.role === 'clinica' || ME.role === 'colaborador'));
}
function accionLiberarCupoAusente(panelId){
  if (!puedeAccionesGestionCliente()) return null;
  return function(idx){
    var x = ausentesDePanel(panelId)[idx];
    if (!x) return '';
    return '<button class="btn btn-ghost mc-crear" type="button" title="Liberar cupo" onclick="irALiberarCupoAusente(\'' + panelId + '\',' + idx + ',this)">🚫 Cupo</button>';
  };
}
function irALiberarCupoAusente(panelId, idx, btn){
  var x = ausentesDePanel(panelId)[idx];
  if (!x || !ACTIVE_CLIENT) return;
  var fecha = fechaAusenteIso(x);
  var period = periodoAusentesPanel(panelId, x);
  var q = String(x.ome || x.orden || x.n_orden || x.benef || x.nombre || '').trim();
  try {
    sessionStorage.setItem('ns-liberar-cupo-preset', JSON.stringify({
      clientSlug: ACTIVE_CLIENT.slug,
      period: period,
      desde: fecha,
      hasta: fecha,
      q: q,
      ome: String(x.ome || x.orden || x.n_orden || '').trim()
    }));
  } catch(e){}
  if (btn) btn.disabled = true;
  go('liberarcupo', navElFor('liberarcupo'));
}
// Arma el payload de generación a partir de la fila del faltante + su modelo.
// Devuelve null (con alert) si falta el médico del modelo.
// Preset (texto por defecto) y valores para un modelo, eligiendo el preset por
// índice (para cuando el modelo tiene varios resultados).
function payloadInformeDeFila(x, opts){
  opts = opts || {};
  var m = modeloParaPracticaRow(x.practica);
  if (!m){ nsAlert('No hay un modelo cargado para esa práctica.'); return null; }
  var medicoId = opts.medicoId || loteMedicoParaModelo(m.key);
  if (!medicoId){ nsAlert('El modelo "' + (m.label || m.key) + '" no tiene un médico asignado.\nCargalo desde la sección Informes.'); return null; }
  var slugFila = (ACTIVE_CLIENT && ACTIVE_CLIENT.slug) || '';
  var presets = (INFORMES_CFG.descripciones || []).filter(function(d){ return scopeAplica(d.modelos, m.key) && scopeAplica(d.clientes, slugFila); });
  var preset = (opts.presetId ? presets.find(function(d){ return d.id === opts.presetId; }) : null) || presets[0];
  var fechaM = /(\d{2}\/\d{2}\/\d{4})/.exec(String(x.turno || ''));
  var valores = Object.assign({}, (preset && preset.valores) || {}, opts.valores || {});
  return {
    modelo: m.key,
    clienteSlug: (ACTIVE_CLIENT && ACTIVE_CLIENT.slug) || '',
    // El sexo ya viene resuelto en la fila (credencial o nombre). Este es el
    // camino directo, sin modal: si no se pasara acá, los informes creados en
    // lote saldrían sin sexo mientras que los de a uno sí lo llevan.
    paciente: { nombre: x.nombre || '', benef: x.benef || '', fecha: fechaM ? fechaM[1] : '', documento: '', cobertura: '', sexo: x.sexo || '' },
    textoInforme: (preset && preset.texto) || '',
    estudio: m.estudio || '',
    valores: valores,
    medicoId: medicoId,
    _modelo: m
  };
}
// ¿El modelo obliga a elegir algo antes de generar? (varios resultados, campos
// requeridos como sexo, o hay que elegir médico). Devuelve las opciones.
// ===== Selección múltiple en Faltan informes: crear y subir varios =====
function mcFaltCheckSel(panelId){
  var checks = [].slice.call(document.querySelectorAll('.mc-falt-chk[data-panel="' + panelId + '"]'));
  var n = checks.filter(function(c){ return c.checked; }).length;
  var b = document.getElementById('mcFaltBulk-' + panelId);
  if (b){ b.disabled = (n === 0); b.textContent = '📤 Crear y subir seleccionados' + (n ? ' (' + n + ')' : ''); }
}
function mcFaltCheckAll(el, panelId){
  // "Seleccionar todos" respeta el filtro: si hay filas ocultas por el buscador,
  // solo marca/desmarca las visibles (así "todos" = todos los que estás viendo).
  [].slice.call(document.querySelectorAll('.mc-falt-chk[data-panel="' + panelId + '"]')).forEach(function(c){
    var tr = c.closest ? c.closest('tr') : null;
    if (tr && tr.style.display === 'none') return;
    c.checked = el.checked;
  });
  mcFaltCheckSel(panelId);
}
// Procesa los faltantes tildados uno por uno: para cada uno abre su modal de
// opciones (preset/médico/sexo), y al confirmar lo encola. Secuencial: el
// siguiente modal aparece cuando cerrás el anterior.
async function crearYSubirSeleccionadosPanel(panelId){
  var idxs = [].slice.call(document.querySelectorAll('.mc-falt-chk[data-panel="' + panelId + '"]'))
    .filter(function(c){ return c.checked; }).map(function(c){ return parseInt(c.value, 10); });
  if (!idxs.length) return;
  if (!await nsConfirm('Vas a crear y subir ' + idxs.length + ' informe(s). Para cada uno vas a elegir el resultado, el médico y los datos que falten.', { titulo:'Crear y subir varios', okLabel:'Empezar' })) return;
  var hechos = 0, saltados = 0;
  for (var k = 0; k < idxs.length; k++){
    var x = faltanInformesDe(panelId)[idxs[k]];
    if (!x || !x.ome){ saltados++; continue; }
    var omeDig = String(x.ome || '').replace(/\D/g, '');
    if (omeDig && (MESCURSO_OMES_GEN[omeDig] || MESCURSO_FALTANTES_DESEST[omeDig])){ saltados++; continue; }
    var m = modeloParaPracticaRow(x.practica);
    if (!m){ saltados++; continue; }   // sin modelo no se puede crear
    var op = opcionesModelo(m);
    if (op.haceFalta){
      var ok = await modalOpcionesInforme(x, m, op, true, null);   // abre modal, espera confirmar/cancelar
      if (ok){ hechos++; MESCURSO_OMES_GEN[omeDig] = 1; } else { saltados++; }
    } else {
      var payload = payloadInformeDeFila(x);
      if (payload){ delete payload._modelo; payload.ome = x.ome; payload.practicaTexto = x.practica || ''; ejecutarCrearYSubir(payload, x, null); hechos++; MESCURSO_OMES_GEN[omeDig] = 1; }
      else saltados++;
    }
  }
  // Re-dibuja el panel (los hechos pasan a "Generado").
  if (typeof mesCursoTogglePanel === 'function'){ MESCURSO_PANEL_ABIERTO = ''; mesCursoTogglePanel(panelId); }
  nsAlert('Encolados ' + hechos + ' informe(s).' + (saltados ? ' ' + saltados + ' salteado(s) (sin OME/modelo o ya generados).' : ''));
}
function opcionesModelo(m){
  var slug = (ACTIVE_CLIENT && ACTIVE_CLIENT.slug) || '';
  // Un médico pertenece a ESTE centro si no tiene clientes (global) o si lo
  // incluye. Antes el desplegable mostraba médicos de TODOS los centros.
  var delCentro = function(md){ return !Array.isArray(md.clientes) || md.clientes.length === 0 || (slug && md.clientes.indexOf(slug) >= 0); };
  // Los resultados también se acotan al centro: hay prácticas que cada centro
  // redacta distinto (el venoso de MMII). Sin centros = para todos, como siempre.
  var presets = (INFORMES_CFG.descripciones || []).filter(function(d){ return scopeAplica(d.modelos, m.key) && delCentro(d); });
  var medicos = (INFORMES_CFG.medicos || []).filter(function(md){ return scopeAplica(md.modelos, m.key) && delCentro(md); });
  if (!medicos.length) medicos = (INFORMES_CFG.medicos || []).filter(delCentro); // sin médico propio del modelo → los del centro
  if (!medicos.length) medicos = (INFORMES_CFG.medicos || []); // fallback: ninguno del centro → todos, para no dejar el selector vacío
  var camposReq = (m.campos || []).filter(function(c){ return c.requerido; });
  return { presets: presets, medicos: medicos, camposReq: camposReq,
    haceFalta: presets.length > 1 || medicos.length !== 1 || camposReq.length > 0 };
}
// Faltantes de la MISMA visita (mismo paciente + mismo turno) que la fila x, con
// OME y no desestimados/ya generados. Sirve para que un mismo informe cubra las
// varias OMEs de la visita (ej. ORL cerumen + tratamiento).
function faltantesDeVisita(panelId, x){
  var benef = String((x && x.benef) || '').replace(/\D/g, '');
  var turno = String((x && x.turno) || '');
  var xo = String((x && x.ome) || '').replace(/\D/g, '');
  return (faltanInformesDe(panelId) || []).filter(function(f){
    if (String(f.benef || '').replace(/\D/g, '') !== benef) return false;
    if (String(f.turno || '') !== turno) return false;
    var od = String(f.ome || '').replace(/\D/g, '');
    if (!od) return false;
    if (MESCURSO_FALTANTES_DESEST[od]) return false;
    if (od !== xo && MESCURSO_OMES_GEN[od]) return false; // otra OME de la visita ya generada
    return true;
  });
}
// Crear + subir a PAMI. Si el modelo tiene opciones (o la visita tiene varias
// OMEs), abre el modal para elegir.
async function crearYSubirInforme(panelId, idx, btn){
  var x = faltanInformesDe(panelId)[idx];
  if (!x) return;
  if (!x.ome){ await nsConfirm('Esta práctica no tiene OME en la bandeja, no se puede subir.', { titulo:'Sin OME', okLabel:'Entendido', cancelLabel:'' }); return; }
  var m = modeloParaPracticaRow(x.practica);
  if (!m){ await nsConfirm('No hay un modelo cargado para esa práctica.', { titulo:'Sin modelo', okLabel:'Entendido', cancelLabel:'' }); return; }
  var op = opcionesModelo(m);
  var visita = faltantesDeVisita(panelId, x);
  if (op.haceFalta || visita.length > 1){ modalOpcionesInforme(x, m, op, true, btn, visita); return; }
  var payload = payloadInformeDeFila(x);
  if (!payload) return;
  delete payload._modelo;
  payload.ome = x.ome; payload.practicaTexto = x.practica || '';
  if (!await nsConfirm('', { titulo:'Crear y subir a PAMI',
      cuerpoHtml:'<b>'+esc(x.nombre || '')+'</b><br>'+esc(x.practica || '')+'<br>OME '+esc(x.ome)+'<br>Modelo: '+esc(m.label || m.key)+'<br><br>Se crea el informe y se sube a PAMI. Es real e irreversible.',
      okLabel:'Crear y subir' })) return;
  ejecutarCrearYSubir(payload, x, btn);
}
async function ejecutarCrearYSubir(payload, x, btn){
  var prev = btn ? btn.textContent : '';
  if (btn){ btn.disabled = true; btn.textContent = '…'; }
  try {
    var r = await api('/api/informes/generar-y-subir', payload);
    if (!r.ok) throw new Error((r.data && r.data.error) || ('No se pudo (HTTP ' + r.status + ').'));
    // Marca "generado" TODAS las OMEs que cubre el informe (el mismo PDF se sube a
    // todas las de la visita), no solo la de la fila clickeada.
    var omesGen = (r.data && r.data.omes) || (payload && payload.omes) || (x && x.ome ? [x.ome] : []);
    omesGen.forEach(function(o){ var d = String(o).replace(/\D/g, ''); if (d) MESCURSO_OMES_GEN[d] = 1; });
    if (btn){ btn.textContent = '⏳ En cola'; btn.disabled = true; btn.title = 'Informe generado; esperando que el worker lo suba a PAMI'; }
    var taskId = r.data && r.data.taskId;
    if (taskId && btn) seguirSubidaInforme(taskId, btn);
  } catch (e){
    nsAlert(e && e.message ? e.message : 'No se pudo crear/subir el informe.');
    if (btn){ btn.disabled = false; btn.textContent = prev; }
  }
}
// Sigue el estado de la subida (la corre el worker de la app) y va actualizando
// el botón: En cola → Subiendo… → Subido ✓ (o el motivo si falla). Polea cada 5s.
function seguirSubidaInforme(taskId, btn){
  var intentos = 0;
  var timer = setInterval(async function(){
    intentos++;
    if (intentos > 48){ clearInterval(timer); if (btn) btn.title = 'Sigue en proceso; revisá en Informes recibidos.'; return; }
    var r = await api('/api/admin/worker/tasks');
    if (!r.ok || !r.data) return;
    var t = (r.data.tasks || []).find(function(x){ return x.id === taskId; });
    if (!t) return;
    if (t.status === 'pending'){ btn.textContent = '⏳ En cola'; return; }
    if (t.status === 'running'){ btn.textContent = '⏳ Subiendo…'; return; }
    if (t.status === 'done' || t.status === 'error'){
      clearInterval(timer);
      var det = (t.result && t.result.detalle && t.result.detalle[0]) || null;
      var subido = t.result && Number(t.result.subidos) > 0;
      if (subido){
        btn.textContent = '✅ Subido'; btn.disabled = true;
        btn.title = 'Subido y transmitido a PAMI'; btn.style.color = '#16a34a';
      } else {
        btn.textContent = '✗ No subió'; btn.disabled = false;
        btn.title = (det && det.motivo) || t.error || 'No se pudo subir'; btn.style.color = '#dc2626';
      }
    }
  }, 5000);
}
async function crearInformeDirecto(panelId, idx, btn){
  var x = faltanInformesDe(panelId)[idx];
  if (!x) return;
  var m = modeloParaPracticaRow(x.practica);
  if (!m){ nsAlert('No hay un modelo cargado para esa práctica.'); return; }
  var op = opcionesModelo(m);
  if (op.haceFalta){ modalOpcionesInforme(x, m, op, false, btn); return; }
  var payload = payloadInformeDeFila(x);
  if (!payload) return;
  delete payload._modelo;
  ejecutarCrear(payload, x, btn);
}
// Genera el PDF y lo descarga (sin subir).
async function ejecutarCrear(payload, x, btn){
  var prev = btn ? btn.textContent : '';
  if (btn){ btn.disabled = true; btn.textContent = '…'; }
  try {
    var r = await fetch('/api/informes/generar', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) });
    if (!r.ok){ var d = {}; try { d = await r.json(); } catch (e) {} throw new Error((d && d.error) || ('No se pudo generar (HTTP ' + r.status + ').')); }
    var blob = await r.blob();
    var cd = r.headers.get('content-disposition') || '';
    var mm = cd.match(/filename="([^"]+)"/);
    bajarBlob(blob, mm ? mm[1] : ('informe_' + String((x && x.nombre) || 'paciente').replace(/[^a-z0-9]+/gi, '_') + '.pdf'));
    if (btn){ btn.textContent = '✓ Listo'; btn.disabled = false; }
  } catch (e){
    nsAlert(e && e.message ? e.message : 'No se pudo generar el informe.');
    if (btn){ btn.disabled = false; btn.textContent = prev; }
  }
}
// ---- Modal "elegir opciones" para crear (y subir) un informe --------------
function mcEnsureModalCss(){
  if (document.getElementById('mc-inf-css')) return;
  var s = document.createElement('style'); s.id = 'mc-inf-css';
  s.textContent = [
    '.mc-inf-scrim{position:fixed;inset:0;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;z-index:10000;padding:20px}',
    '.mc-inf-box{background:var(--card,#fff);color:var(--text,#0f172a);border-radius:16px;width:100%;max-width:440px;box-shadow:0 24px 60px rgba(0,0,0,.35);overflow:hidden}',
    '.mc-inf-head{padding:16px 18px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff}',
    '.mc-inf-head b{font-size:16px}.mc-inf-head .mc-inf-sub{display:block;font-size:12px;opacity:.9;margin-top:2px}',
    '.mc-inf-body{padding:16px 18px;display:flex;flex-direction:column;gap:12px}',
    '.mc-inf-field label{display:block;font-size:12px;font-weight:600;color:var(--text-2,#64748b);margin-bottom:4px}',
    '.mc-inf-field label .mc-inf-hint{font-weight:500;opacity:.75}',
    // Pantalla de revisión: la caja se agranda para que el PDF se lea de verdad.
    '.mc-inf-box.mc-inf-rev{max-width:860px;width:94vw;max-height:92vh;display:flex;flex-direction:column}',
    '.mc-inf-rev .mc-inf-body{overflow:auto;flex:1}',
    '.mc-inf-rev .rev-pdf{height:62vh;min-height:340px;border:1px solid var(--border,#e2e8f0);border-radius:10px;overflow:hidden;background:var(--bg-2,#f8fafc)}',
    '.mc-inf-rev .rev-pdf-frame{width:100%;height:100%;border:0;display:block}',
    '.mc-inf-rev .rev-pdf-msg{padding:16px;font-size:13px;color:var(--text-2,#64748b)}',
    '.mc-inf-rev .rev-avisos{border:1px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12.5px}',
    '.mc-inf-rev .rev-avisos ul{margin:6px 0 0 16px;padding:0}',
    '.mc-inf-field select,.mc-inf-field input{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--border,#e2e8f0);border-radius:10px;background:var(--bg,#fff);color:var(--text,#0f172a);font-size:14px}',
    '.mc-inf-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px 16px}',
    '.mc-inf-btn{padding:9px 16px;border-radius:10px;border:1px solid var(--border,#e2e8f0);background:var(--card,#fff);color:var(--text,#0f172a);font-weight:600;cursor:pointer;font-size:14px}',
    '.mc-inf-btn.primary{background:#2563eb;color:#fff;border-color:transparent}',
    '.mc-inf-btn.subir{background:#16a34a;color:#fff;border-color:transparent}',
    '.mc-inf-visita{display:flex;flex-direction:column;gap:6px;border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:8px 10px}',
    '.mc-inf-omechk{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:400;color:var(--text,#0f172a);margin:0;cursor:pointer}',
    '.mc-inf-omechk input{width:auto}.mc-inf-omechk span{flex:1;min-width:0}.mc-inf-omechk b{color:var(--text-2,#64748b);font-size:11.5px;font-weight:600}',
  ].join('\n');
  document.head.appendChild(s);
}
function modalOpcionesInforme(x, m, op, subir, btn, visita){
  mcEnsureModalCss();
  // Default: el médico habitual del modelo, pero solo si está entre los del
  // centro (op.medicos ya viene filtrado); si no, el primero del centro.
  var medDef = loteMedicoParaModelo(m.key);
  if (!op.medicos.some(function(md){ return md.id === medDef; })) medDef = (op.medicos[0] && op.medicos[0].id) || '';
  var presOpts = op.presets.map(function(p, i){ return '<option value="' + esc(p.id) + '"' + (i === 0 ? ' selected' : '') + '>' + esc(p.nombre) + '</option>'; }).join('');
  var medOpts = op.medicos.map(function(md){ return '<option value="' + esc(md.id) + '"' + (md.id === medDef ? ' selected' : '') + '>' + esc(md.nombre) + '</option>'; }).join('');
  var campoHtml = function(c){
    var inp;
    if (c.tipo === 'select'){
      inp = '<select data-campo="' + esc(c.key) + '"><option value="">— Elegir —</option>' +
        (c.opciones || []).map(function(o){ return '<option' + (o === c.default ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    } else {
      inp = '<input data-campo="' + esc(c.key) + '" value="' + esc(c.default || '') + '">';
    }
    return '<div class="mc-inf-field"><label>' + esc(c.label || c.key) + ' *</label>' + inp + '</div>';
  };
  // El sexo va PRIMERO (arriba de todo): al elegirlo se filtran los presets.
  var sexoCampo = op.camposReq.find(function(c){ return c.key === 'sexo'; });
  var restoCampos = op.camposReq.filter(function(c){ return c.key !== 'sexo'; });
  // Si la visita (mismo paciente + turno) tiene varias OMEs, se ofrecen todas:
  // el mismo informe se sube a las tildadas.
  var visitaMulti = subir && Array.isArray(visita) && visita.length > 1;
  var visitaHtml = visitaMulti
    ? '<div class="mc-inf-field"><label>Esta visita tiene ' + visita.length + ' OMEs — el mismo informe se sube a las tildadas:</label><div class="mc-inf-visita">'
      + visita.map(function(f){
          var od = String(f.ome || '').replace(/\D/g, '');
          var prac = String(f.practica || '').split(' - ').slice(-1)[0];
          return '<label class="mc-inf-omechk"><input type="checkbox" class="mc-inf-ome" value="' + esc(od) + '" checked> <span>' + esc(prac) + '</span> <b>OME ' + esc(od) + '</b></label>';
        }).join('') + '</div></div>'
    : '';
  var scrim = document.createElement('div'); scrim.className = 'mc-inf-scrim';
  scrim.innerHTML =
    '<div class="mc-inf-box">' +
      '<div class="mc-inf-head"><b>' + (subir ? 'Crear y subir informe' : 'Crear informe') + '</b>' +
        '<span class="mc-inf-sub">' + esc(x.nombre || '') + ' · ' + esc((x.practica || '').split(' - ').slice(-1)[0]) + (subir ? ' · OME ' + esc(x.ome || '') : '') + '</span></div>' +
      '<div class="mc-inf-body">' +
        (sexoCampo ? campoHtml(sexoCampo) : '') +
        // Sexo del paciente (dato del paciente, no del estudio): se pregunta salvo
        // que el modelo ya tenga su propio campo de sexo (ej. urodinamia).
        // Cuando lo sabemos llega ya elegido, y se aclara DE DÓNDE salió: la
        // credencial es un dato de PAMI; el nombre es una deducción nuestra y
        // hay que poder distinguirlas de un vistazo antes de firmar.
        (!sexoCampo ? '<div class="mc-inf-field"><label>Sexo del paciente' + (x.sexo ? ' <span class="mc-inf-hint">· ' + (x.sexoOrigen === 'credencial' ? 'según la credencial' : 'deducido del nombre, revisalo') + '</span>' : '') + '</label><select id="mc-inf-sexo"><option value="">— Sin especificar —</option><option value="Masculino"' + (String(x.sexo || '').toLowerCase().indexOf('masc') === 0 ? ' selected' : '') + '>Masculino</option><option value="Femenino"' + (String(x.sexo || '').toLowerCase().indexOf('fem') === 0 ? ' selected' : '') + '>Femenino</option></select></div>' : '') +
        (op.presets.length > 1 ? '<div class="mc-inf-field"><label>Resultado del informe</label><select id="mc-inf-preset">' + presOpts + '</select></div>' : '') +
        '<div class="mc-inf-field"><label>Médico que firma *</label><select id="mc-inf-medico">' + medOpts + '</select></div>' +
        visitaHtml +
        restoCampos.map(campoHtml).join('') +
      '</div>' +
      '<div class="mc-inf-foot"><button class="mc-inf-btn" id="mc-inf-cancel">Cancelar</button>' +
        '<button class="mc-inf-btn ' + (subir ? 'subir' : 'primary') + '" id="mc-inf-ok">' + (subir ? '📤 Crear y subir' : '📝 Crear') + '</button></div>' +
    '</div>';
  document.body.appendChild(scrim);
  // Devuelve una Promise: resuelve true si se confirmó (y se encoló la creación),
  // false si se canceló. Permite encadenar varios en la creación masiva.
  return new Promise(function(resolve){
    // Filtro de presets por sexo (urodinamia M1-M8 / F1-F8): al elegir el sexo se
    // ofrecen solo los de ese sexo; al elegir un preset se sincroniza el sexo.
    (function(){
      var presetSel = scrim.querySelector('#mc-inf-preset');
      var sexoSel = scrim.querySelector('[data-campo="sexo"]');
      if (!presetSel || !sexoSel) return;
      if (!op.presets.some(function(p){ return p.valores && p.valores.sexo; })) return;
      var nsx = function(s){ s = String(s || '').toLowerCase(); return s.indexOf('masc') === 0 ? 'masculino' : s.indexOf('fem') === 0 ? 'femenino' : ''; };
      var rebuild = function(){
        var sx = nsx(sexoSel.value);
        var prev = presetSel.value;
        var vis = op.presets.filter(function(p){ var ps = nsx(p.valores && p.valores.sexo); return !ps || !sx || ps === sx; });
        presetSel.innerHTML = vis.map(function(p){ return '<option value="' + esc(p.id) + '">' + esc(p.nombre) + '</option>'; }).join('');
        if (vis.some(function(p){ return p.id === prev; })) presetSel.value = prev;
      };
      sexoSel.addEventListener('change', rebuild);
      presetSel.addEventListener('change', function(){
        var p = op.presets.find(function(pp){ return pp.id === presetSel.value; });
        var ps = p && p.valores && p.valores.sexo;
        if (ps && nsx(sexoSel.value) !== nsx(ps)) { sexoSel.value = ps; }
      });
      rebuild();
    })();
    function cerrar(val){ scrim.remove(); resolve(!!val); }
    scrim.addEventListener('click', function(e){ if (e.target === scrim) cerrar(false); });
    scrim.querySelector('#mc-inf-cancel').onclick = function(){ cerrar(false); };
    scrim.querySelector('#mc-inf-ok').onclick = async function(){
      var presetSel = scrim.querySelector('#mc-inf-preset');
      var medicoId = scrim.querySelector('#mc-inf-medico').value;
      if (!medicoId){ nsAlert('Elegí el médico que firma.'); return; }
      var valores = {};
      var falta = null;
      op.camposReq.forEach(function(c){
        var el = scrim.querySelector('[data-campo="' + c.key + '"]');
        var v = el ? String(el.value || '').trim() : '';
        if (!v) falta = c.label || c.key;
        valores[c.key] = v;
      });
      if (falta){ nsAlert('Completá: ' + falta); return; }
      // OMEs de la visita tildadas (si no hay bloque de visita, la OME sola).
      var omes = [];
      scrim.querySelectorAll('.mc-inf-ome:checked').forEach(function(c){ if (c.value) omes.push(c.value); });
      if (!omes.length) omes = [String(x.ome || '').replace(/\D/g, '')].filter(Boolean);
      var payload = payloadInformeDeFila(x, { medicoId: medicoId, presetId: presetSel ? presetSel.value : '', valores: valores });
      if (!payload) return;
      var sexoPac = scrim.querySelector('#mc-inf-sexo');
      if (sexoPac && sexoPac.value && payload.paciente) payload.paciente.sexo = sexoPac.value;
      delete payload._modelo;
      // Modelos que piden confirmar mirando el PDF (ej. la vesicoprostática).
      // Si vuelve a editar, el modal queda como estaba y no se crea nada.
      if (m.revisionPrevia){
        var sub = (x.nombre || '') + (x.turno ? ' · ' + String(x.turno).split(' ')[0] : '');
        var avisosRev = (m.key === 'eco-vesicoprostatica' && typeof avisosVesicoprostatica === 'function')
          ? avisosVesicoprostatica(payload.valores || {}, String(payload.textoInforme || '') + ' ' + String((payload.valores || {}).conclusion || ''))
          : [];
        var okRev = await revisarInformePdf(payload, sub, avisosRev);
        if (!okRev) return;
      }
      scrim.remove();
      if (subir){
        payload.ome = x.ome; payload.omes = omes; payload.practicaTexto = x.practica || '';
        ejecutarCrearYSubir(payload, x, btn);
      } else {
        ejecutarCrear(payload, x, btn);
      }
      resolve(true);
    };
  });
}
// Última pantalla antes de crear: muestra el PDF YA ARMADO (el mismo que se va a
// generar, no una maqueta) para confirmarlo. Se pide desde el modelo con
// `revisionPrevia`, no para todos: desde "Faltan informes" se crea de a muchos y
// un paso extra en cada uno haría lento el trabajo en tanda.
// Resuelve true si se confirma, false si se vuelve a editar.
function revisarInformePdf(payload, subtitulo, avisos){
  mcEnsureModalCss();
  return new Promise(function(resolve){
    var av = (avisos || []).length
      ? '<div class="rev-avisos"><b>⚠ Revisá la coherencia (son avisos, no cambian el informe)</b><ul>'
        + avisos.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>'
      : '';
    var scrim = document.createElement('div'); scrim.className = 'mc-inf-scrim';
    scrim.innerHTML =
      '<div class="mc-inf-box mc-inf-rev">'
      + '<div class="mc-inf-head"><b>Revisá el informe antes de crearlo</b><span class="mc-inf-sub">' + esc(subtitulo || '') + '</span></div>'
      + '<div class="mc-inf-body">' + av
      + '<div class="rev-pdf"><div class="rev-pdf-msg">Armando la vista previa…</div>'
      + '<iframe class="rev-pdf-frame" style="display:none"></iframe></div></div>'
      + '<div class="mc-inf-foot"><button class="mc-inf-btn" id="rev-volver">Volver a editar</button>'
      + '<button class="mc-inf-btn primary" id="rev-ok" disabled>✓ Confirmar y crear</button></div></div>';
    document.body.appendChild(scrim);
    var url = null;
    function cerrar(val){ if (url) URL.revokeObjectURL(url); scrim.remove(); resolve(!!val); }
    scrim.addEventListener('click', function(e){ if (e.target === scrim) cerrar(false); });
    scrim.querySelector('#rev-volver').onclick = function(){ cerrar(false); };
    scrim.querySelector('#rev-ok').onclick = function(){ cerrar(true); };
    // El PDF de la vista previa es el mismo endpoint que genera el definitivo:
    // lo que se ve acá es exactamente lo que se va a crear.
    fetch('/api/informes/generar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function(r){ if (!r.ok) throw new Error('no se pudo generar'); return r.blob(); })
      .then(function(blob){
        if (!scrim.isConnected) { return; }
        url = URL.createObjectURL(blob);
        var f = scrim.querySelector('.rev-pdf-frame');
        f.src = url + '#toolbar=0&navpanes=0&view=FitH';
        f.style.display = 'block';
        scrim.querySelector('.rev-pdf-msg').style.display = 'none';
        scrim.querySelector('#rev-ok').disabled = false;
      })
      .catch(function(){
        if (!scrim.isConnected) return;
        // Sin vista previa igual se deja confirmar: si el PDF no se puede armar,
        // el error real va a salir al crearlo y con su mensaje.
        scrim.querySelector('.rev-pdf-msg').textContent = 'No se pudo armar la vista previa. Podés crear el informe igual y ver el resultado.';
        scrim.querySelector('#rev-ok').disabled = false;
      });
  });
}
// Si hay un panel de faltan-informes abierto, lo vuelve a dibujar (para reflejar
// "Generado"/desestimado cuando llega la data async, tras F5 sin esperar la bandeja).
function redibujarPanelFaltantesAbierto(){
  if (typeof MESCURSO_PANEL_ABIERTO === 'string' && /^informes/.test(MESCURSO_PANEL_ABIERTO) && typeof mesCursoTogglePanel === 'function'){
    var t = MESCURSO_PANEL_ABIERTO; MESCURSO_PANEL_ABIERTO = ''; mesCursoTogglePanel(t);
  }
}
// Abre/cierra debajo de los cuadros el detalle copiable.
function mesCursoTogglePanel(tipo){
  var panel = document.getElementById('mescursoInformesPanel');
  if (!panel) return;
  var apagarCarets = function(){
    ['mescursoInformesCaret','mescursoDebitosCaret','mescursoInformesJulioCaret','mescursoDebitosJulioCaret','mescursoDebitosCerradoCaret','mescursoInformesCerradoCaret','mescursoDebitosAdelanteCaret','mescursoAusentesCaret','mescursoAusentesJulioCaret','mescursoAusentesCerradoCaret','mescursoFueraCorteJulioCaret','mescursoModulosCaret','mescursoModulosJulioCaret','mescursoModulosCerradoCaret']
      .forEach(function(id){ mesCursoSetCaret(id, false); });
    document.querySelectorAll('[id^="mescursoDebFut-"]').forEach(function(c){ c.textContent = '▸'; });
  };
  if (MESCURSO_PANEL_ABIERTO === tipo){
    panel.innerHTML = ''; MESCURSO_PANEL_ABIERTO = ''; apagarCarets();
    return;
  }
  // Los paneles de faltan-informes muestran el botón "Crear informe": si la
  // config de modelos todavía no llegó, la traemos y re-dibujamos el panel.
  if (/^informes/.test(tipo) && !(INFORMES_CFG.modelos || []).length){
    ensureInformesCfg(function(){ if (MESCURSO_PANEL_ABIERTO === tipo){ MESCURSO_PANEL_ABIERTO = ''; mesCursoTogglePanel(tipo); } });
  }
  var html = '';
  var debCols = ['Benef', 'Apellido y nombre', 'Turno', 'Práctica que se debita', 'Estado', 'Motivo', 'Se cruza con', 'Débito'];
  // El umbral no se cruza con otra práctica (es valorización parcial): dejamos vacío
  // el "Se cruza con" para no mostrar un cruce casual.
  var mapDebitos = function(x){ return [x.benef, x.nombre, x.turno, x.practica, x.estado, x.categoria || '', (x.categoria === 'Umbral' ? '' : (x.cruce || '')), moneyFmt(x.monto)]; };
  if (tipo === 'informes'){
    html = mesCursoPanelDetalleOModulo('informes', MESCURSO_FALTAN_INFORMES || [], 'Faltan informes', 'error', 'copiarFaltanInformes', accionCrearInforme('informes'));
  } else if (tipo === 'informes-julio'){
    html = mesCursoPanelDetalleOModulo('informes-julio', MESCURSO_FALTAN_INFORMES_JULIO || [], 'Faltan informes (mes anterior)', 'error', 'copiarFaltanInformesJulio', accionCrearInforme('informes-julio'));
  } else if (tipo === 'informes-cerrado'){
    html = mesCursoPanelDetalleOModulo('informes-cerrado', MESCURSO_FALTAN_INFORMES_CERRADO || [], 'Faltan informes (mes cerrado)', 'error', 'copiarFaltanInformesCerrado', accionCrearInforme('informes-cerrado'));
  } else if (tipo === 'debitos-julio'){
    var dj = MESCURSO_POSIBLES_DEBITOS_JULIO || [];
    html = dj.length ? mesCursoTablaHtml('Posibles débitos (mes anterior) · ' + dj.length, 'warn', 'copiarPosiblesDebitosJulio', debCols, dj.map(mapDebitos), 'debitos-julio', null, null, [7]) : mesCursoVacioHtml('Posibles débitos (mes anterior)', 'warn');
  } else if (tipo === 'debitos-cerrado'){
    var dc = MESCURSO_DEBITOS_CERRADO || [];
    // Mes cerrado: los excluyentes traen "Se cruza con"; los umbrales quedan sin cruce.
    html = dc.length ? mesCursoTablaHtml('Débitos (mes cerrado) · ' + dc.length, 'warn', 'copiarDebitosCerrado', debCols, dc.map(mapDebitos), 'debitos-cerrado', null, null, [7]) : mesCursoVacioHtml('Débitos (mes cerrado)', 'warn');
  } else if (tipo === 'modulos' || tipo === 'modulos-julio' || tipo === 'modulos-cerrado'){
    var md = tipo === 'modulos' ? MESCURSO_MODULOS : (tipo === 'modulos-julio' ? MESCURSO_MODULOS_JULIO : MESCURSO_MODULOS_CERRADO);
    var modDesglose = mesCursoModHayDesglose(md);
    // La facturación del módulo es la TRANSMITIDA (✅), nada más — no suma
    // ausentes, no transmitidos ni falta informe. "Pendiente" (⏳) es solo
    // informativo, aparte, para saber que existe sin que se lea como cobrado.
    var modCols = modDesglose ? ['Módulo', 'Consultas', 'Prácticas', '✅ Transmitido', '⏳ Pendiente'] : ['Módulo', 'Consultas', 'Prácticas', 'Facturación'];
    var modMoneyCols = modDesglose ? [3, 4] : [3];
    var mapMod = modDesglose
      ? function(m){ return [(m.code ? m.code + ' - ' : '') + m.desc, numberFmt(m.consultas), numberFmt(m.practicas), moneyFmt(m.montoTransmitido || 0), moneyFmt(m.montoPendiente || 0)]; }
      : function(m){ return [(m.code ? m.code + ' - ' : '') + m.desc, numberFmt(m.consultas), numberFmt(m.practicas), moneyFmt(m.monto)]; };
    var copiaMod = tipo === 'modulos' ? 'copiarModulos' : (tipo === 'modulos-julio' ? 'copiarModulosJulio' : 'copiarModulosCerrado');
    // Aviso ⚠ cuando un módulo tiene prácticas SIN VALORIZAR (código que no está en el
    // nomenclador → cuenta pero suma $0). Es plata que no se está facturando. No tiene
    // sentido para quien no ve valores (es justamente para asignar un valor).
    var accModulos = function(idx){
      var mm = md[idx];
      if (mm && mm.sinValor > 0) return '<button type="button" class="mc-sinvalor" onclick="event.stopPropagation();mesCursoAbrirSinValor(\'' + tipo + '\',' + idx + ')" title="' + mm.sinValor + ' sin valorizar: el código no figura en el nomenclador, no suma a la facturación. Clic para asignarle valor.">⚠ ' + mm.sinValor + ' sin valorizar</button>';
      return '';
    };
    var haySinValor = veValoresCliente() && md.some(function(m){ return m.sinValor > 0; });
    html = md.length ? mesCursoTablaHtml('Cantidades por módulo · ' + md.length + ' módulos', '', copiaMod, modCols, md.map(mapMod), tipo, haySinValor ? accModulos : null, null, modMoneyCols) : mesCursoVacioHtml('Cantidades por módulo', '');
  } else if (tipo === 'debitos-adelante'){
    var da = MESCURSO_POSIBLES_DEBITOS_ADELANTE || [];
    html = da.length ? mesCursoTablaHtml('Posibles débitos por adelantado · ' + da.length, 'warn', 'copiarPosiblesDebitosAdelante', debCols, da.map(mapDebitos), 'debitos-adelante', null, null, [7]) : mesCursoVacioHtml('Posibles débitos por adelantado', 'warn');
  } else if (tipo.indexOf('debitos-futuro:') === 0){
    var perFut = tipo.slice('debitos-futuro:'.length);
    var fm = (MESCURSO_FUTUROS || []).find(function(x){ return x.period === perFut; });
    MESCURSO_POSIBLES_DEBITOS_FUTURO = (fm && fm.posiblesDebitosRows) || [];
    var tituloFut = 'Posibles débitos por adelantado · ' + ((fm && fm.label) || perFut);
    html = MESCURSO_POSIBLES_DEBITOS_FUTURO.length ? mesCursoTablaHtml(tituloFut + ' · ' + MESCURSO_POSIBLES_DEBITOS_FUTURO.length, 'warn', 'copiarPosiblesDebitosFuturo', debCols, MESCURSO_POSIBLES_DEBITOS_FUTURO.map(mapDebitos), tipo, null, null, [7]) : mesCursoVacioHtml(tituloFut, 'warn');
  } else if (tipo === 'ausentes'){
    html = mesCursoPanelDetalleOModulo('ausentes', MESCURSO_AUSENTES || [], 'Ausentes', 'warn', 'copiarAusentes', accionLiberarCupoAusente('ausentes'));
  } else if (tipo === 'ausentes-julio'){
    html = mesCursoPanelDetalleOModulo('ausentes-julio', MESCURSO_AUSENTES_JULIO || [], 'Ausentes sin validar (mes anterior)', 'warn', 'copiarAusentesJulio', accionLiberarCupoAusente('ausentes-julio'));
  } else if (tipo === 'ausentes-cerrado'){
    html = mesCursoPanelDetalleOModulo('ausentes-cerrado', MESCURSO_AUSENTES_CERRADO || [], 'Ausentes sin validar (mes cerrado)', 'warn', 'copiarAusentesCerrado', accionLiberarCupoAusente('ausentes-cerrado'));
  } else if (tipo === 'fueracorte-julio'){
    html = mesCursoPanelDetalleOModulo('fueracorte-julio', MESCURSO_FUERACORTE_JULIO || [], 'A facturar fuera de corte (mes anterior)', 'warn', 'copiarFueraCorteJulio', null);
  } else {
    var pd = MESCURSO_POSIBLES_DEBITOS || [];
    html = pd.length ? mesCursoTablaHtml('Posibles débitos · ' + pd.length, 'warn', 'copiarPosiblesDebitos', debCols, pd.map(mapDebitos), 'debitos', null, null, [7]) : mesCursoVacioHtml('Posibles débitos', 'warn');
  }
  panel.innerHTML = html;
  MESCURSO_PANEL_ABIERTO = tipo;
  apagarCarets();
  mesCursoSetCaret('mescursoInformesCaret', tipo === 'informes');
  mesCursoSetCaret('mescursoDebitosCaret', tipo === 'debitos');
  mesCursoSetCaret('mescursoInformesJulioCaret', tipo === 'informes-julio');
  mesCursoSetCaret('mescursoDebitosJulioCaret', tipo === 'debitos-julio');
  mesCursoSetCaret('mescursoDebitosCerradoCaret', tipo === 'debitos-cerrado');
  mesCursoSetCaret('mescursoInformesCerradoCaret', tipo === 'informes-cerrado');
  mesCursoSetCaret('mescursoModulosCaret', tipo === 'modulos');
  mesCursoSetCaret('mescursoModulosJulioCaret', tipo === 'modulos-julio');
  mesCursoSetCaret('mescursoModulosCerradoCaret', tipo === 'modulos-cerrado');
  mesCursoSetCaret('mescursoDebitosAdelanteCaret', tipo === 'debitos-adelante');
  mesCursoSetCaret('mescursoAusentesCaret', tipo === 'ausentes');
  mesCursoSetCaret('mescursoAusentesJulioCaret', tipo === 'ausentes-julio');
  mesCursoSetCaret('mescursoAusentesCerradoCaret', tipo === 'ausentes-cerrado');
  mesCursoSetCaret('mescursoFueraCorteJulioCaret', tipo === 'fueracorte-julio');
  if (tipo.indexOf('debitos-futuro:') === 0) mesCursoSetCaret('mescursoDebFut-' + tipo.slice('debitos-futuro:'.length), true);
}
// Panel vacío: se abre igual que el de la tabla (mismo header, mismo click para
// cerrar) cuando el tipo elegido no tiene filas — así el botón siempre "hace
// algo" en vez de quedarse sin reacción cuando el conteo es 0.
function mesCursoVacioHtml(titulo, tono){
  return '<div class="mescurso-panel ' + esc(tono || '') + '">'
    + '<div class="mescurso-panel-head"><b>' + esc(titulo) + '</b></div>'
    + '<div class="mescurso-panel-vacio">Sin registros para este período.</div>'
    + '</div>';
}
function mesCursoParseFecha(v){
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(v || '').trim());
  if (!m) return null;
  return new Date(+m[3], (+m[2]) - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
}
function mesCursoParseNumero(v){
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  var limpio = s.replace(/\$/g, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(limpio)) return null;
  return Number(limpio);
}
function mesCursoSortKey(valor, header){
  var h = String(header || '').toLowerCase();
  var fecha = /turno|fecha/.test(h) ? mesCursoParseFecha(valor) : null;
  if (fecha != null && isFinite(fecha)) return { tipo:'num', valor:fecha };
  var num = /valor|facturaci|debito|débito|consultas|prácticas|practicas|benef/.test(h) || String(valor || '').indexOf('$') >= 0
    ? mesCursoParseNumero(valor)
    : null;
  if (num != null && isFinite(num)) return { tipo:'num', valor:num };
  return { tipo:'txt', valor:String(valor == null ? '' : valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() };
}
function mesCursoOrdenarFilas(panelId, headers, filas){
  var sort = MESCURSO_PANEL_SORT[String(panelId || '')];
  var rows = (filas || []).map(function(f, idx){ return { idx:idx, cells:f }; });
  if (!sort || sort.col == null) return rows;
  rows.sort(function(a, b){
    var ka = mesCursoSortKey(a.cells[sort.col], headers[sort.col]);
    var kb = mesCursoSortKey(b.cells[sort.col], headers[sort.col]);
    var cmp = 0;
    if (ka.tipo === 'num' && kb.tipo === 'num') cmp = ka.valor - kb.valor;
    else cmp = String(ka.valor).localeCompare(String(kb.valor), 'es', { numeric:true, sensitivity:'base' });
    if (!cmp) cmp = a.idx - b.idx;
    return sort.dir === 'desc' ? -cmp : cmp;
  });
  return rows;
}
function mesCursoOrdenar(panelId, col){
  var key = String(panelId || '');
  var actual = MESCURSO_PANEL_SORT[key] || {};
  MESCURSO_PANEL_SORT[key] = { col:col, dir:(actual.col === col && actual.dir === 'asc') ? 'desc' : 'asc' };
  MESCURSO_PANEL_ABIERTO = '';
  mesCursoTogglePanel(key);
}
// Saca las columnas de $ (por índice) cuando el que mira no puede ver valores.
// Siempre son la/s última/s columna/s en estas tablas, así que sacarlas no
// desalinea los índices de las que quedan antes.
// Arma " · $1.234" (o el separador que se pida) solo si hay monto Y el que mira
// puede ver valores — así el fragmento entero desaparece (separador incluido) en
// vez de dejar un "· " colgando cuando moneyFmt ya devuelve vacío por su cuenta.
function mcMoneyPart(monto, sep){
  if (!veValoresCliente() || !monto) return '';
  return (sep == null ? ' · ' : sep) + esc(moneyFmt(monto));
}
function mcOcultarValores(headers, filas, moneyCols){
  if (veValoresCliente() || !moneyCols || !moneyCols.length) return { headers: headers, filas: filas };
  var keep = headers.map(function(_, i){ return i; }).filter(function(i){ return moneyCols.indexOf(i) < 0; });
  return {
    headers: keep.map(function(i){ return headers[i]; }),
    filas: filas.map(function(row){ return keep.map(function(i){ return row[i]; }); })
  };
}
function mesCursoTablaHtml(titulo, tono, copiaFn, headers, filas, panelId, accionFn, extraAcciones, moneyCols){
  var oculto = mcOcultarValores(headers, filas, moneyCols);
  headers = oculto.headers; filas = oculto.filas;
  // Columnas que absorben el ancho sobrante (las de texto largo): así la tabla
  // llena el panel sin dejar un bloque vacío a la derecha ni abrir huecos entre
  // las columnas cortas. El resto se ajusta al contenido.
  var expand = /informes|ausentes/.test(String(panelId || '')) ? [1, 2] : (/modulos/.test(String(panelId || '')) ? [0] : [1, 3, 6]);
  var sort = MESCURSO_PANEL_SORT[String(panelId || '')] || {};
  var clase = function(i){
    var cls = [];
    if (expand.indexOf(i) >= 0) cls.push('mc-exp');
    if (sort.col === i) cls.push('sort-' + sort.dir);
    return cls.length ? ' class="' + cls.join(' ') + '"' : '';
  };
  var ordenadas = mesCursoOrdenarFilas(panelId, headers, filas);
  // Columna extra opcional (botón "Crear informe"): no se copia ni se exporta,
  // sólo se muestra. La celda va sin escapar porque trae HTML del botón.
  var conAcc = typeof accionFn === 'function';
  // Selección múltiple: solo en los paneles de faltan-informes (crear/subir varios).
  var conCheck = conAcc && /^informes/.test(String(panelId || ''));
  var pid = esc(panelId || '');
  var thead = '<tr>' + (conCheck ? '<th class="mc-chk-th"><input type="checkbox" title="Seleccionar todos" onclick="mcFaltCheckAll(this,\'' + pid + '\')"></th>' : '') + headers.map(function(h, i){
    var icon = sort.col === i ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '';
    return '<th' + clase(i) + '><button type="button" class="mc-sort" onclick="mesCursoOrdenar(\'' + esc(panelId || '') + '\',' + i + ')" title="Ordenar por ' + esc(h) + '">' + esc(h) + '<span>' + esc(icon) + '</span></button></th>';
  }).join('') + (conAcc ? '<th></th>' : '') + '</tr>';
  var tbody = ordenadas.map(function(row){
    // `data-col` lleva el nombre de la columna: en celular la fila se dibuja como
    // tarjeta y ese texto es la etiqueta de cada dato (ver styles.css). La celda
    // vacía se marca para no ocupar un renglón con la etiqueta sola.
    return '<tr>' + (conCheck ? '<td class="mc-chk-td"><input type="checkbox" class="mc-falt-chk" data-panel="' + pid + '" value="' + row.idx + '" onclick="mcFaltCheckSel(\'' + pid + '\')"></td>' : '') + row.cells.map(function(c, i){
        var txt = String(c == null ? '' : c);
        var cl = clase(i), vacio = txt.trim() === '' ? ' mc-vacio' : '';
        if (vacio) cl = cl ? cl.replace(/"$/, vacio + '"') : ' class="mc-vacio"';
        return '<td' + cl + ' data-col="' + esc(headers[i] || '') + '">' + esc(txt) + '</td>';
      }).join('')
      + (conAcc ? '<td class="mc-acc">' + (accionFn(row.idx) || '') + '</td>' : '') + '</tr>';
  }).join('');
  var acciones = '';
  // Buscador de filas: escribir "holter" (o parte de una práctica/nombre) deja
  // solo las filas que coinciden. Útil para trabajar un tipo de estudio por vez.
  if (filas.length) acciones += '<input class="inp mc-filtro" type="text" placeholder="Filtrar (ej: holter)" oninput="mesCursoFiltrarTabla(this)" style="max-width:190px;height:30px">';
  if (conCheck) acciones += '<button id="mcFaltBulk-' + pid + '" class="btn btn-primary btn-sm" type="button" disabled onclick="crearYSubirSeleccionadosPanel(\'' + pid + '\')">📤 Crear y subir seleccionados</button>';
  acciones += '<button class="btn btn-ghost" type="button" title="Copiar" onclick="' + copiaFn + '(this)">📋</button>';
  if (panelId){
    acciones += '<button class="btn btn-ghost" type="button" title="Descargar PDF" onclick="mesCursoDescargar(\'pdf\',\'' + panelId + '\',this)">📄 PDF</button>'
      + '<button class="btn btn-ghost" type="button" title="Descargar Excel" onclick="mesCursoDescargar(\'xlsx\',\'' + panelId + '\',this)">📊 Excel</button>';
  }
  if (extraAcciones) acciones += extraAcciones;
  return '<div class="mescurso-panel ' + esc(tono) + '">'
    + '<div class="mescurso-panel-head"><b>' + esc(titulo) + '</b>'
    + '<div class="mescurso-panel-actions">' + acciones + '</div></div>'
    + '<div class="table-scroll"><table class="bandeja-table"><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table></div>'
    + '</div>';
}
// Filtra las filas de la tabla del panel (la que está en el mismo .mescurso-panel
// del input) por texto: oculta las filas que no contienen lo tipeado (práctica,
// nombre, benef…). No toca los datos ni la selección; solo muestra/oculta.
function mesCursoFiltrarTabla(inp){
  var q = (inp && inp.value || '').trim().toLowerCase();
  var panel = inp && inp.closest ? inp.closest('.mescurso-panel') : null;
  if (!panel) return;
  var filas = panel.querySelectorAll('table.bandeja-table tbody tr');
  [].slice.call(filas).forEach(function(tr){
    var ok = !q || (tr.textContent || '').toLowerCase().indexOf(q) >= 0;
    tr.style.display = ok ? '' : 'none';
  });
}
// Datos crudos (encabezados en mayúscula + valores numéricos de $) para exportar
// un panel. Reusa los mismos globales que "copiar". Envoltorio: si el panel tiene
// toggle detalle/módulo, exporta la vista que está viendo ahora; y si el que mira
// no puede ver valores, saca la columna de $ antes de mandarla a armar el archivo.
function mesCursoDescargarDatos(panelId){
  var d = mesCursoDescargarDatosCruda(panelId);
  if (d && d.moneyCols && d.moneyCols.length && !veValoresCliente()){
    var oculto = mcOcultarValores(d.columnas, d.filas, d.moneyCols);
    d.columnas = oculto.headers; d.filas = oculto.filas; d.moneyCols = [];
  }
  return d;
}
// Mismo shape que mesCursoDatosDetalleOModulo pero para exportar (números crudos,
// no texto formateado: el $ se arma en el servidor al generar el PDF/Excel).
function mesCursoDatosDetalleOModulo(panelId, arr, tituloBase){
  var cli = (ACTIVE_CLIENT && ACTIVE_CLIENT.name) || '';
  if ((MESCURSO_PANEL_VISTA[panelId] || 'detalle') === 'modulo'){
    var mods = mesCursoAgruparPorModulo(arr);
    return { titulo: tituloBase + ' (por módulo) - ' + cli, columnas: ['MODULO', 'CONSULTAS', 'PRACTICAS', 'FACTURACION'],
      filas: mods.map(function(m){ return [(m.code ? m.code + ' - ' : '') + m.desc, m.consultas, m.practicas, m.monto]; }), moneyCols: [3] };
  }
  return { titulo: tituloBase + ' - ' + cli, columnas: ['BENEF', 'APELLIDO Y NOMBRE', 'PRACTICA', 'TURNO', 'VALOR'],
    filas: (arr || []).map(function(x){ return [x.benef, x.nombre, x.practica, x.turno, Number(x.valor) || 0]; }), moneyCols: [4] };
}
function mesCursoDescargarDatosCruda(panelId){
  var debCols = ['BENEF', 'APELLIDO Y NOMBRE', 'TURNO', 'PRACTICA QUE SE DEBITA', 'ESTADO', 'MOTIVO', 'SE CRUZA CON', 'DEBITO'];
  var mapDeb = function(x){ return [x.benef, x.nombre, x.turno, x.practica, x.estado, x.categoria || '', (x.categoria === 'Umbral' ? '' : (x.cruce || '')), Number(x.monto) || 0]; };
  var cli = (ACTIVE_CLIENT && ACTIVE_CLIENT.name) || '';
  if (panelId === 'ausentes') return mesCursoDatosDetalleOModulo('ausentes', MESCURSO_AUSENTES || [], 'Ausentes');
  if (panelId === 'ausentes-julio') return mesCursoDatosDetalleOModulo('ausentes-julio', MESCURSO_AUSENTES_JULIO || [], 'Ausentes sin validar (mes anterior)');
  if (panelId === 'ausentes-cerrado') return mesCursoDatosDetalleOModulo('ausentes-cerrado', MESCURSO_AUSENTES_CERRADO || [], 'Ausentes sin validar (mes cerrado)');
  if (panelId === 'fueracorte-julio') return mesCursoDatosDetalleOModulo('fueracorte-julio', MESCURSO_FUERACORTE_JULIO || [], 'A facturar fuera de corte (mes anterior)');
  if (panelId === 'informes') return mesCursoDatosDetalleOModulo('informes', MESCURSO_FALTAN_INFORMES || [], 'Faltan informes');
  if (panelId === 'informes-julio') return mesCursoDatosDetalleOModulo('informes-julio', MESCURSO_FALTAN_INFORMES_JULIO || [], 'Faltan informes (mes anterior)');
  if (panelId === 'informes-cerrado') return mesCursoDatosDetalleOModulo('informes-cerrado', MESCURSO_FALTAN_INFORMES_CERRADO || [], 'Faltan informes (mes cerrado)');
  if (panelId === 'debitos-julio') return { titulo: 'Posibles débitos (mes anterior) - ' + cli, columnas: debCols, filas: (MESCURSO_POSIBLES_DEBITOS_JULIO || []).map(mapDeb), moneyCols: [7] };
  if (panelId === 'debitos-cerrado') return { titulo: 'Débitos (mes cerrado) - ' + cli, columnas: debCols, filas: (MESCURSO_DEBITOS_CERRADO || []).map(mapDeb), moneyCols: [7] };
  if (panelId === 'modulos' || panelId === 'modulos-julio' || panelId === 'modulos-cerrado'){
    var modArr = panelId === 'modulos' ? MESCURSO_MODULOS : (panelId === 'modulos-julio' ? MESCURSO_MODULOS_JULIO : MESCURSO_MODULOS_CERRADO);
    var modTit = panelId === 'modulos' ? 'Cantidades por módulo (mes en curso)' : (panelId === 'modulos-julio' ? 'Cantidades por módulo (mes anterior)' : 'Cantidades por módulo (mes cerrado)');
    var modArrDesglose = mesCursoModHayDesglose(modArr);
    var modArrCols = modArrDesglose ? ['MODULO', 'CONSULTAS', 'PRACTICAS', 'TRANSMITIDO', 'PENDIENTE'] : ['MODULO', 'CONSULTAS', 'PRACTICAS', 'FACTURACION'];
    var modArrMoneyCols = modArrDesglose ? [3, 4] : [3];
    var modArrMap = modArrDesglose
      ? function(m){ return [(m.code ? m.code + ' - ' : '') + m.desc, Number(m.consultas) || 0, Number(m.practicas) || 0, Number(m.montoTransmitido) || 0, Number(m.montoPendiente) || 0]; }
      : function(m){ return [(m.code ? m.code + ' - ' : '') + m.desc, Number(m.consultas) || 0, Number(m.practicas) || 0, Number(m.monto) || 0]; };
    return { titulo: modTit + ' - ' + cli, columnas: modArrCols,
      filas: (modArr || []).map(modArrMap), moneyCols: modArrMoneyCols };
  }
  if (panelId === 'medcab-historial') return { titulo: medCabTituloTablero() + ' - ' + cli,
    columnas: ['MES', 'FALTAN VALIDAR', 'FALTAN INFORME', 'TRANSMITIDAS', 'TOTAL EN BANDEJA'],
    filas: (MESCURSO_MEDCAB_HISTORIAL || []).map(function(d){
      var validar = Number(d.pendienteValidar) || 0, transmitir = Number(d.pendienteTransmitir) || 0, listas = Number(d.listas) || 0;
      var total = Number(d.count) || (validar + transmitir + listas);
      return [d.monthLabel || d.month || 'Mes', validar, transmitir, listas, total];
    }) };
  if (panelId === 'debitos-adelante') return { titulo: 'Posibles débitos por adelantado - ' + cli, columnas: debCols, filas: (MESCURSO_POSIBLES_DEBITOS_ADELANTE || []).map(mapDeb), moneyCols: [7] };
  if (String(panelId).indexOf('debitos-futuro:') === 0) {
    var perF = String(panelId).slice('debitos-futuro:'.length);
    var fmF = (MESCURSO_FUTUROS || []).find(function(x){ return x.period === perF; });
    return { titulo: 'Posibles débitos por adelantado ' + ((fmF && fmF.label) || perF) + ' - ' + cli, columnas: debCols, filas: (MESCURSO_POSIBLES_DEBITOS_FUTURO || []).map(mapDeb), moneyCols: [7] };
  }
  return { titulo: 'Posibles débitos - ' + cli, columnas: debCols, filas: (MESCURSO_POSIBLES_DEBITOS || []).map(mapDeb), moneyCols: [7] };
}
async function mesCursoDescargar(fmt, panelId, btn){
  var d = mesCursoDescargarDatos(panelId);
  if (!d.filas.length) return;
  d.fmt = fmt;
  var prev = btn ? btn.textContent : '';
  if (btn){ btn.disabled = true; btn.textContent = '…'; }
  try {
    var resp = await fetch('/api/mescurso/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify(d)
    });
    if (!resp.ok) throw new Error('export');
    var blob = await resp.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = d.titulo.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') + (fmt === 'pdf' ? '.pdf' : '.xlsx');
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
  } catch (e){
    nsAlert('No se pudo generar el archivo.');
  } finally {
    if (btn){ btn.disabled = false; btn.textContent = prev; }
  }
}
// Copian el listado (con encabezado) separado por tabs, para pegar en Excel.
// Rutean por mesCursoDescargarDatos: así "copiar" siempre trae lo mismo que se ve
// en pantalla (detalle o agrupado por módulo, según el toggle) y con el mismo
// recorte de $ para quien no puede verlos.
function copiarFaltanInformes(btn){ var d = mesCursoDescargarDatos('informes'); mesCursoCopiar(btn, d.columnas, d.filas); }
function copiarAusentes(btn){ var d = mesCursoDescargarDatos('ausentes'); mesCursoCopiar(btn, d.columnas, d.filas); }
function copiarAusentesJulio(btn){ var d = mesCursoDescargarDatos('ausentes-julio'); mesCursoCopiar(btn, d.columnas, d.filas); }
function copiarAusentesCerrado(btn){ var d = mesCursoDescargarDatos('ausentes-cerrado'); mesCursoCopiar(btn, d.columnas, d.filas); }
function copiarFueraCorteJulio(btn){ var d = mesCursoDescargarDatos('fueracorte-julio'); mesCursoCopiar(btn, d.columnas, d.filas); }
function copiarFaltanInformesJulio(btn){ var d = mesCursoDescargarDatos('informes-julio'); mesCursoCopiar(btn, d.columnas, d.filas); }
function copiarFaltanInformesCerrado(btn){ var d = mesCursoDescargarDatos('informes-cerrado'); mesCursoCopiar(btn, d.columnas, d.filas); }
// ===== Asignar valor a códigos "sin valorizar" de un módulo (desde el chip ⚠) =====
var SV_ASIGNO = false;
function mesCursoAbrirSinValor(tipo, idx){
  var arr = tipo === 'modulos' ? MESCURSO_MODULOS : (tipo === 'modulos-julio' ? MESCURSO_MODULOS_JULIO : MESCURSO_MODULOS_CERRADO);
  var m = arr[idx]; if (!m) return;
  SV_ASIGNO = false;
  var codes = m.sinValorCodigos || [];
  var tit = document.getElementById('svModalTitle');
  if (tit) tit.textContent = (m.code ? m.code + ' - ' : '') + m.desc + ' — sin valorizar';
  var h = '<div style="font-size:12.5px;color:var(--text-2);margin-bottom:12px">Estos códigos aparecen en la bandeja pero <b>no están en el nomenclador</b>: cuentan pero suman $0. Asignales el valor PAMI y se valorizan en todos los clientes y en las próximas bandejas.</div>';
  if (!codes.length){ h += '<div class="nom-muted">No hay códigos sin valorizar en este módulo.</div>'; }
  else {
    h += '<div style="display:flex;flex-direction:column;gap:8px">';
    codes.forEach(function(c){
      h += '<div class="sv-row" data-code="' + esc(c.code) + '" data-desc="' + esc(c.desc || '') + '" data-mc="' + esc(m.code || '') + '" data-md="' + esc(m.desc || '') + '">'
        + '<div class="sv-info"><div><span class="nom-code">' + esc(c.code) + '</span> ' + esc(c.desc || '') + '</div><div class="nom-muted" style="font-size:12px">' + (c.count || 0) + ' ' + ((c.count || 0) === 1 ? 'vez' : 'veces') + ' en el período</div></div>'
        + '<input class="inp" type="number" step="0.01" min="0" placeholder="Valor $" onkeydown="if(event.key===\'Enter\')this.nextElementSibling.click()">'
        + '<button class="btn btn-primary btn-sm" onclick="mesCursoAsignarValor(this)">Asignar</button>'
        + '</div>';
    });
    h += '</div><div id="svMsg" style="margin-top:12px;font-size:12.5px"></div>';
  }
  document.getElementById('svModalBody').innerHTML = h;
  showModal('svModal', 'svScrim');
}
function cerrarSinValor(){
  hideModal('svModal', 'svScrim');
  // Si se asignó algún valor, recargamos el dashboard para que se re-valorice.
  if (SV_ASIGNO && typeof loadClientMesCurso === 'function' && ACTIVE_CLIENT){ SV_ASIGNO = false; loadClientMesCurso(ACTIVE_CLIENT.slug); }
}
async function mesCursoAsignarValor(btn){
  if (!ACTIVE_CLIENT) return;
  var rowEl = btn.closest('.sv-row');
  var input = rowEl.querySelector('input');
  var total = Number(String(input.value).replace(',', '.'));
  var msg = document.getElementById('svMsg');
  if (!(total > 0)){ input.focus(); if (msg){ msg.style.color = '#dc2626'; msg.textContent = 'Ingresá un valor mayor a 0.'; } return; }
  btn.disabled = true; btn.textContent = 'Guardando…';
  var res = await req('POST', '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/practice-values', {
    code: rowEl.getAttribute('data-code'), total: total,
    practiceDescription: rowEl.getAttribute('data-desc'),
    moduleCode: rowEl.getAttribute('data-mc'), moduleDescription: rowEl.getAttribute('data-md')
  });
  if (!res.ok){ btn.disabled = false; btn.textContent = 'Asignar'; if (msg){ msg.style.color = '#dc2626'; msg.textContent = (res.data && res.data.error) || 'No se pudo guardar.'; } return; }
  SV_ASIGNO = true;
  rowEl.classList.add('sv-done'); input.disabled = true; btn.textContent = '✓ Asignado';
  if (msg){ msg.style.color = '#16a34a'; msg.textContent = '✅ Guardado. Al cerrar se actualiza la facturación.'; }
}
function copiarPosiblesDebitos(btn){ var d = mesCursoDescargarDatos('debitos'); mesCursoCopiar(btn, d.columnas, d.filas); }
function copiarPosiblesDebitosJulio(btn){ var d = mesCursoDescargarDatos('debitos-julio'); mesCursoCopiar(btn, d.columnas, d.filas); }
function copiarDebitosCerrado(btn){ var d = mesCursoDescargarDatos('debitos-cerrado'); mesCursoCopiar(btn, d.columnas, d.filas); }
function copiarModulos(btn){ var d = mesCursoDescargarDatos('modulos'); mesCursoCopiar(btn, d.columnas, d.filas); }
function copiarModulosJulio(btn){ var d = mesCursoDescargarDatos('modulos-julio'); mesCursoCopiar(btn, d.columnas, d.filas); }
function copiarModulosCerrado(btn){ var d = mesCursoDescargarDatos('modulos-cerrado'); mesCursoCopiar(btn, d.columnas, d.filas); }
function copiarPosiblesDebitosAdelante(btn){ var d = mesCursoDescargarDatos('debitos-adelante'); mesCursoCopiar(btn, d.columnas, d.filas); }
// Este es dinámico (no tiene un panelId fijo: depende de qué mes futuro se está
// mirando), así que se arma acá mismo en vez de por mesCursoDescargarDatos.
function copiarPosiblesDebitosFuturo(btn){
  var headers = ['BENEF', 'APELLIDO Y NOMBRE', 'TURNO', 'PRACTICA QUE SE DEBITA', 'ESTADO', 'MOTIVO', 'SE CRUZA CON', 'DEBITO'];
  var filas = (MESCURSO_POSIBLES_DEBITOS_FUTURO || []).map(function(x){ return [x.benef, x.nombre, x.turno, x.practica, x.estado, x.categoria || '', (x.categoria === 'Umbral' ? '' : (x.cruce || '')), x.monto]; });
  var oculto = mcOcultarValores(headers, filas, [7]);
  mesCursoCopiar(btn, oculto.headers, oculto.filas);
}
function mesCursoCopiar(btn, headers, filas){
  var tsv = [headers.join('\t')].concat(filas.map(function(f){ return f.join('\t'); })).join('\n');
  var ok = function(){ if (btn){ btn.textContent = '✓'; setTimeout(function(){ btn.textContent = '📋'; }, 1500); } };
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(tsv).then(ok, function(){ mesCursoCopiaFallback(tsv, ok); });
  } else {
    mesCursoCopiaFallback(tsv, ok);
  }
}
function mesCursoCopiaFallback(text, ok){
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); ok && ok(); } catch (e) {}
  document.body.removeChild(ta);
}
// Fecha en que se cierra un período (llegan los débitos ≈ día 1 del 2do mes
// siguiente a la prestación). Ej. Julio 2026-07 → 01/09/2026.
function mesCursoCierre(period){
  var m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!m) return '';
  var anio = +m[1], mes = +m[2] + 2;
  while (mes > 12){ mes -= 12; anio++; }
  return '01/' + String(mes).padStart(2, '0') + '/' + anio;
}
function mesCursoFechaCorta(iso){
  if (!iso) return '';
  try {
    var d = new Date(iso);
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  } catch (e){ return ''; }
}
// Fecha + hora local (día y horario de la última actualización de la app).
function mesCursoFechaHora(iso){
  if (!iso) return '';
  try {
    var d = new Date(iso);
    return mesCursoFechaCorta(iso) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' hs';
  } catch (e){ return ''; }
}
// Botón "Actualizar" (mes en curso): deja un pedido de refresco; la PC lo sondea
// (~10 min) y corre la bajada de TODAS las bandejas. Muestra el progreso.
// Estado GLOBAL del refresco (pendiente/corriendo): el botón lo respeta en TODOS
// los clientes, así no se puede pedir dos veces hasta que la PC termine.
var REFRESCO_ACTIVO = false;
var REFRESCO_POLL = null;
function arrancarPollRefresco(){
  if (REFRESCO_POLL) return;  // ya hay uno sondeando
  var vueltas = 0;
  REFRESCO_POLL = setInterval(async function(){
    vueltas++;
    var e = await req('GET', '/api/bandeja/refresco/estado');
    var activo = !!(e.ok && e.data && (e.data.pendiente || e.data.corriendo));
    if (!activo){
      clearInterval(REFRESCO_POLL); REFRESCO_POLL = null; REFRESCO_ACTIVO = false;
      // Terminó: recargar la card (el botón vuelve, con los datos nuevos).
      try { if (document.getElementById('view-clientes').style.display !== 'none') loadClientMesCurso(); } catch(_){}
      return;
    }
    if (vueltas > 120){ clearInterval(REFRESCO_POLL); REFRESCO_POLL = null; }  // techo ~30 min
  }, 15000);
}
async function pedirRefrescoBandejas(btn){
  var label = (btn && btn.getAttribute('data-refresh-label')) || 'Actualizar';
  if (btn){ btn.disabled = true; btn.textContent = '⏳ Pidiendo…'; }
  var r = await req('POST', '/api/bandeja/refresco/pedir', {});
  if (!r.ok){ if (btn){ btn.disabled = false; btn.textContent = '🔄 ' + label; } nsAlert((r.data && r.data.error) || 'No se pudo pedir el refresco.'); return; }
  REFRESCO_ACTIVO = true;
  if (btn){ btn.disabled = true; btn.textContent = '⏳ Actualizando…'; btn.title = 'La PC lo está corriendo'; }
  arrancarPollRefresco();
}
// Indicador de salud: SOLO avisa si el último sync falló o la bandeja quedó
// desactualizada (>20 hs). Si está todo bien no muestra nada (cero ruido).
function mesCursoSaludHtml(estado, uploadedAt){
  if (estado && estado.ok === false){
    var cuando = estado.at ? (' (último intento ' + mesCursoFechaHora(estado.at) + ')') : '';
    var motivo = estado.error ? (': ' + estado.error) : '';
    return '<div class="mescurso-salud err">⚠ No se pudo actualizar' + esc(cuando) + esc(motivo) + '</div>';
  }
  if (estado && (estado.transmitErrores || 0) > 0){
    var detalle = (estado.omitidosDetalle || []).filter(function(d){ return d && (d.nroOrden || d.motivo); });
    var lista = detalle.length
      ? '<div class="mescurso-salud-detalle">' + detalle.slice(0, 8).map(function(d){
          return '<div>OME <b>' + esc(d.nroOrden || '-') + '</b>' + (d.motivo ? ' — ' + esc(d.motivo) : '') + '</div>';
        }).join('') + (detalle.length > 8 ? '<div>… y ' + (detalle.length - 8) + ' más</div>' : '') + '</div>'
      : (estado.transmitError ? ': ' + esc(estado.transmitError) : '');
    return '<div class="mescurso-salud err">⚠ ' + esc(numberFmt(estado.transmitErrores)) + ' OME(s) no se pudieron transmitir hoy' + lista + '</div>';
  }
  if (uploadedAt){
    try {
      var horas = (Date.now() - new Date(uploadedAt).getTime()) / 3600000;
      if (horas > 20) return '<div class="mescurso-salud warn">⚠ Sin actualizar hace más de un día — última: ' + esc(mesCursoFechaHora(uploadedAt)) + '</div>';
    } catch (e){}
  }
  return '';
}
// Desglose del estimado por estado (qué está firme y qué depende de informes/turnos).
function mesCursoDesgloseHtml(r){
  var parts = [];
  if (r.grossTransmitido) parts.push('<span class="ok">En cobro <b>' + esc(moneyFmt(r.grossTransmitido)) + '</b></span>');
  if (r.missingInformeAmount) parts.push('<span class="err">Falta informe <b>' + esc(moneyFmt(r.missingInformeAmount)) + '</b></span>');
  if (r.grossTurno) parts.push('<span class="warn">Proyectado <b>' + esc(moneyFmt(r.grossTurno)) + '</b></span>');
  return parts.length ? '<div class="mescurso-desglose">' + parts.join('') + '</div>' : '';
}
function mesCursoMesActualLabel(){
  var d = new Date();
  return MESCURSO_MESES[d.getMonth()].replace(/^./, function(c){ return c.toUpperCase(); }) + ' ' + d.getFullYear();
}
// Periodo del mes anterior al actual ('2026-08' hoy -> '2026-07').
function mesCursoPeriodoAnterior(){
  var d = new Date();
  var y = d.getFullYear(), m = d.getMonth() - 1; // getMonth 0-11
  if (m < 0){ m = 11; y -= 1; }
  return y + '-' + String(m + 1).padStart(2, '0');
}
// Un mes calendario antes de un período "YYYY-MM" (ej. 2026-07 -> 2026-06).
function mesCursoMesAntes(period){
  var m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!m) return '';
  var y = +m[1], mo = +m[2] - 1;
  if (mo < 1){ mo = 12; y -= 1; }
  return y + '-' + String(mo).padStart(2, '0');
}
function mesCursoLabelPeriodo(period){
  var mm = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!mm) return String(period || '');
  var nombre = MESCURSO_MESES[(+mm[2]) - 1] || '';
  return nombre.replace(/^./, function(c){ return c.toUpperCase(); }) + ' ' + mm[1];
}
// Botón "Actualizar" reutilizable (mes en curso y mes sin cerrar). Un solo pedido
// de refresco baja TODAS las bandejas (mira 2 meses atrás), así que sirve para las
// dos cards. Sin id: pedirRefrescoBandejas usa el botón clickeado, no getElementById.
function mesCursoBotonRefresco(label){
  if (!(ME && (ME.role === 'admin' || ME.role === 'operador'))) return '';
  var texto = label || 'Actualizar';
  return REFRESCO_ACTIVO
    ? '<button class="btn btn-sm" type="button" disabled title="Se está actualizando" style="margin-left:8px">⏳ Actualizando…</button>'
    : '<button class="btn btn-sm" type="button" onclick="pedirRefrescoBandejas(this)" data-refresh-label="' + esc(texto) + '" title="Actualizar bandeja" style="margin-left:8px">🔄 ' + esc(texto) + '</button>';
}
// Card izquierda: resumen valorizado de la bandeja del mes en curso (tipo Julio).
function mesCursoCardMesEnCurso(r, estado){
  var chip = (r && r.label) || mesCursoMesActualLabel();
  // Rango de días que abarca la bandeja (ej. "01/08 al 18/08"), por las dudas.
  var abarca = (r && r.coversFrom && r.coversTo) ? (r.coversFrom + ' al ' + r.coversTo) : '';
  var head = '<div class="mescurso-head"><span class="mescurso-title">Mes en curso'
    + (abarca ? ' <span class="mescurso-abarca">' + esc(abarca) + '</span>' : '') + '</span>'
    + '<span class="mescurso-chip">' + esc(chip) + '</span>'
    + mesCursoBotonRefresco()
    + '</div>';
  if (!r){
    if (estado && estado.ok === false){
      return '<div class="mescurso-card">' + head
        + '<div class="mescurso-empty"><b>No se pudo bajar la bandeja</b>'
        + '<span>' + esc(estado.error || 'Falló la última actualización.') + (estado.at ? ' (último intento ' + esc(mesCursoFechaHora(estado.at)) + ')' : '') + '</span></div></div>';
    }
    return '<div class="mescurso-card">' + head
      + '<div class="mescurso-empty"><b>Esperando la bandeja</b>'
      + '<span>Cuando la app suba la bandeja de ' + esc(chip) + ', vas a ver acá el resumen del mes.</span></div></div>';
  }
  var salud = mesCursoSaludHtml(estado, r.uploadedAt);
  var nomNota = r.nomencladorLabel ? ('valorizado con nomenclador ' + r.nomencladorLabel) : 'valor estimativo';
  var footNom = r.count ? (esc(numberFmt(r.matched || 0)) + '/' + esc(numberFmt(r.count)) + ' prácticas valorizadas') : '';
  // Las líneas de "Faltan informes" y "Posibles débitos" son siempre clickeables
  // (abren el detalle copiable debajo, o un aviso de "sin registros" si no hay
  // filas) — así el botón se ve y se comporta igual haya o no datos.
  var faltanClick = ' mescurso-click" onclick="toggleFaltanInformes()';
  var faltanCaret = ' <span class="mescurso-caret" id="mescursoInformesCaret">▸</span>';
  var debitosClick = ' mescurso-click" onclick="togglePosiblesDebitos()';
  var debitosCaret = ' <span class="mescurso-caret" id="mescursoDebitosCaret">▸</span>';
  var cobroReal = r.grossTransmitido || 0;
  var faltaInf = r.missingInformeAmount || 0;
  var estimado = cobroReal + faltaInf;
  // En un cliente EN ANÁLISIS no transmitimos, así que lo validado-sin-transmitir
  // no es "falta informe" (deuda) sino "faltante de transmisión" (potencial).
  var enAnalisisCli = ACTIVE_CLIENT && ACTIVE_CLIENT.enAnalisis;
  var lblFalta = enAnalisisCli ? 'Faltante de transmisión' : 'Faltan informes';
  var lblFaltaNota = enAnalisisCli ? 'Faltante de transmisión' : 'Falta informe';
  // Cobro real en $0 habiendo prestaciones = casi siempre un error (la
  // actualización no captó las transmitidas, o falló). Lo marcamos en rojo.
  var cobroCeroWarn = (cobroReal === 0 && (r.count || 0) > 0)
    ? '<div class="mescurso-salud err">⚠ Cobro real en $0 con ' + esc(numberFmt(r.count || 0)) + ' prestaciones — probable error de la transmisión o la actualización. Revisá.</div>'
    : '';
  var ausTot = r.absent || 0;
  var ausentesClick = ' mescurso-click" onclick="toggleAusentes()';
  var ausentesCaret = ' <span class="mescurso-caret" id="mescursoAusentesCaret">▸</span>';
  var ausentesHtml = '<div class="mescurso-ausentes' + ausentesClick + '"><span>Ausentes' + ausentesCaret + ' <b>' + esc(numberFmt(ausTot)) + '</b> · ' + esc(numberFmt(r.ausentesConsultas || 0)) + ' consultas · ' + esc(numberFmt(r.ausentesPracticas || 0)) + ' prácticas</span><b>' + mcMoneyPart(r.grossTurno, '') + '</b></div>';
  var valHtml = veValoresCliente()
    ? ('<div class="mescurso-val-lbl">Cobro real (transmitido)</div>'
      + '<div class="mescurso-val">' + esc(moneyFmt(cobroReal)) + '</div>'
      + '<div class="mescurso-val-note">+ ' + lblFaltaNota + ' <b>' + esc(moneyFmt(faltaInf)) + '</b>'
      + ' → Estimado <b>' + esc(moneyFmt(estimado)) + '</b> · ' + esc(nomNota) + '</div>')
    : '';
  return '<div class="mescurso-card">' + head + salud + cobroCeroWarn
    + valHtml
    + '<div class="mescurso-lines duo">'
    + '<div class="mescurso-line mescurso-click" onclick="toggleModulos()"><span>Consultas · prácticas <span class="mescurso-caret" id="mescursoModulosCaret">▸</span></span><b>' + esc(numberFmt(r.consultations || 0)) + ' · ' + esc(numberFmt(r.practices || 0)) + '</b></div>'
    + '<div class="mescurso-line"><span>Validadas · transmitidas</span><b>' + esc(numberFmt(r.validated || 0)) + ' · ' + esc(numberFmt(r.transmitted || 0)) + '</b></div>'
    + '<div class="mescurso-line warn' + debitosClick + '"><span>Posibles débitos' + debitosCaret + '</span><b>' + esc(numberFmt(r.posiblesDebitosCount || 0)) + mcMoneyPart(r.posiblesDebitos) + '</b></div>'
    + '<div class="mescurso-line alert' + faltanClick + '"><span>' + lblFalta + faltanCaret + '</span><b>' + esc(numberFmt(r.missingInforme || 0)) + mcMoneyPart(r.missingInformeAmount) + '</b>' + (((r.missingInformeDebito || 0) && veValoresCliente()) ? '<small class="mescurso-debnote">' + esc(numberFmt(r.missingInformeDebito)) + ' irían a débito · ' + esc(moneyFmt(r.missingInformeDebitoAmount || 0)) + '</small>' : '') + '</div>'
    + '</div>'
    + ausentesHtml
    + '<div class="mescurso-foot">' + esc(numberFmt(r.count || 0)) + ' prestaciones · ' + footNom + '</div>'
    + (r.uploadedAt ? '<div class="mescurso-sync"><span>🔄 Última actualización de la app</span><b>' + esc(mesCursoFechaHora(r.uploadedAt)) + '</b></div>' : '')
    + (estado && estado.transmitAt ? '<div class="mescurso-sync"><span>🔁 Transmitidas hoy</span><b>' + esc(numberFmt(estado.transmitidas || 0)) + ((estado.transmitErrores || 0) > 0 ? ' · ' + esc(numberFmt(estado.transmitErrores)) + ' con error' : '') + '</b></div>' : '')
    + '</div>';
}
// Card "Hacia adelante": turnos futuros (día siguiente al corte → fin de mes).
// Objetivo: detectar posibles débitos ANTES de que ocurran. No estima $ (los
// turnos futuros no deberían faltar pero faltan → un estimado sería irreal).
// Bloque compacto de un mes FUTURO (septiembre, octubre…) dentro de la card.
function mesCursoBloqueFuturo(f){
  if (!f) return '';
  var abarca = (f.coversFrom && f.coversTo) ? (f.coversFrom + ' al ' + f.coversTo) : '';
  var deb = f.posiblesDebitosCount || 0;
  return '<div class="mescurso-futuro" style="border-top:1px dashed var(--border,#d8dee6);margin-top:10px;padding-top:8px">'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">'
    + '<b>' + esc(f.label || f.period || '') + '</b>'
    + (abarca ? '<span class="mescurso-abarca">' + esc(abarca) + '</span>' : '') + '</div>'
    + ((f.count || 0) === 0
        ? '<div class="mescurso-val-note" style="margin:0">Sin turnos agendados todavía</div>'
        : ('<div class="mescurso-val-note" style="margin:0 0 8px">' + esc(numberFmt(f.count || 0)) + ' turnos · '
            + esc(numberFmt(f.consultations || 0)) + ' consultas · ' + esc(numberFmt(f.practices || 0)) + ' prácticas</div>'
            + '<div class="mescurso-line warn mescurso-click" onclick="toggleDebitosFuturo(\'' + esc(f.period) + '\')"><span>Posibles débitos por adelantado <span class="mescurso-caret" id="mescursoDebFut-' + esc(f.period) + '">▸</span></span><b>' + esc(numberFmt(deb)) + (f.posiblesDebitos ? ' · ' + esc(moneyFmt(f.posiblesDebitos)) : '') + '</b></div>'))
    + '</div>';
}
function mesCursoCardAdelante(a, futuros){
  futuros = futuros || [];
  if ((!a || !a.count) && !futuros.length) return '';
  var chip = (a && a.label) || (futuros[0] && futuros[0].label) || '';
  var head = '<div class="mescurso-head"><span class="mescurso-title">Hacia adelante</span>'
    + '<span class="mescurso-chip">' + esc(chip) + '</span></div>';
  var body = '';
  if (a && a.count){
    var abarca = (a.coversFrom && a.coversTo) ? (a.coversFrom + ' al ' + a.coversTo) : '';
    var debCount = a.posiblesDebitosCount || 0;
    var djClick = ' mescurso-click" onclick="toggleDebitosAdelante()';
    var djCaret = ' <span class="mescurso-caret" id="mescursoDebitosAdelanteCaret">▸</span>';
    body += (abarca ? '<div class="mescurso-abarca" style="margin-bottom:6px">' + esc(abarca) + '</div>' : '')
      + '<div class="mescurso-val-lbl">Turnos agendados</div>'
      + '<div class="mescurso-val chico">' + esc(numberFmt(a.count || 0)) + '</div>'
      + '<div class="mescurso-val-note">' + esc(numberFmt(a.consultations || 0)) + ' consultas · ' + esc(numberFmt(a.practices || 0)) + ' prácticas · para detectar débitos antes de que pasen</div>'
      + '<div class="mescurso-lines">'
      + '<div class="mescurso-line warn' + djClick + '"><span>Posibles débitos por adelantado' + djCaret + '</span><b>' + esc(numberFmt(debCount)) + (a.posiblesDebitos ? ' · ' + esc(moneyFmt(a.posiblesDebitos)) : '') + '</b></div>'
      + '</div>';
  }
  // Meses futuros (septiembre, octubre…) — mismo cuadro, apilados.
  futuros.forEach(function(f){ body += mesCursoBloqueFuturo(f); });
  var uploadedAt = (a && a.uploadedAt) || (futuros[0] && futuros[0].uploadedAt) || '';
  return '<div class="mescurso-card adelante">' + head + body
    + '<div class="mescurso-foot">Turnos futuros · no suman a facturación</div>'
    + (uploadedAt ? '<div class="mescurso-sync"><span>🔄 Última actualización</span><b>' + esc(mesCursoFechaHora(uploadedAt)) + '</b></div>' : '')
    + '</div>';
}
// Card derecha cuando NO hay reporte del mes anterior: cartel "falta reporte".
function mesCursoCardFaltaReporte(period){
  var label = mesCursoLabelPeriodo(period);
  return '<div class="mescurso-card sincerrar"><div class="mescurso-head">'
    + '<span class="mescurso-title">Sin cerrar</span>'
    + '<span class="mescurso-chip warn">' + esc(label) + '</span></div>'
    + '<div class="mescurso-empty"><b>Falta el reporte de ' + esc(label) + '</b>'
    + '<span>Todavía no subiste el reporte transmitido de ' + esc(label) + '. Cuando lo subas, vas a ver acá la facturación, los informes que faltan y los ausentes.</span></div></div>';
}
// Línea de "arrastre": el próximo corte del mes anterior entra en el corte de este
// mes → se suma a la facturación y se muestra el total real del corte.
function mescArrastreHtml(current){
  if (!veValoresCliente()) return '';
  var arr = Number(current && current.prevPeriodCutoff) || 0;
  if (arr <= 0) return '';
  var total = Number((current && current.net) || 0) + arr;
  return '<div class="mescurso-arrastre">+ <b>' + esc(moneyFmt(arr)) + '</b> del corte anterior · Total del corte <b>' + esc(moneyFmt(total)) + '</b></div>';
}
function mesCursoCardSinCerrar(current, reporte){
  if (!current || !current.period){
    return '<div class="mescurso-card sincerrar"><div class="mescurso-head">'
      + '<span class="mescurso-title">Sin cerrar</span></div>'
      + '<div class="mescurso-empty"><b>Sin período pendiente</b>'
      + '<span>Cuando haya un reporte transmitido con débitos sin confirmar, el resumen aparece acá.</span></div></div>';
  }
  var cierre = mesCursoCierre(current.period);
  var fechaRep = (reporte && reporte.closedAt) ? mesCursoFechaCorta(reporte.closedAt) : '';
  var faltan = current.missingInforme || 0;
  var faltanMonto = current.missingInformeAmount || 0;
  var ausentes = current.absent || 0;
  var ausMonto = current.absentAmount || 0;
  var debCount = current.debitCount || 0;
  var debMonto = current.debit || 0;
  var fueraCorte = current.outsideCutoff || 0;
  var fueraCorteMonto = current.nextPeriodCutoff || 0;
  var clickable = MESCURSO_REPORTE_ID ? ' mescurso-click' : '';
  var onclick = MESCURSO_REPORTE_ID ? ' onclick="irAReporteSinCerrar()"' : '';
  // "Faltan informes" y "Posibles débitos" abren el detalle inline abajo (no
  // navegan); siempre clickeables, haya o no filas.
  var fjClick = ' mescurso-click" onclick="toggleFaltanInformesJulio()';
  var fjCaret = ' <span class="mescurso-caret" id="mescursoInformesJulioCaret">▸</span>';
  var djClick = ' mescurso-click" onclick="toggleDebitosJulio()';
  var djCaret = ' <span class="mescurso-caret" id="mescursoDebitosJulioCaret">▸</span>';
  var footParts = [];
  if (fechaRep) footParts.push('Reporte del ' + esc(fechaRep));
  if (cierre) footParts.push('los débitos cierran el ' + esc(cierre));
  var foot = footParts.length ? '<div class="mescurso-foot">' + footParts.join(' · ') + '</div>' : '';
  // Última actualización del refresco automático (la app barre este mes en cada
  // bajada). Refleja hasta cuándo está al día la transmisión.
  var syncSc = (reporte && reporte.updatedAt) ? '<div class="mescurso-sync"><span>🔄 Última actualización</span><b>' + esc(mesCursoFechaHora(reporte.updatedAt)) + '</b></div>' : '';
  var confDeb = reporte && reporte.debitStatus === 'confirmado';
  return '<div class="mescurso-card sincerrar">'
    + '<div class="mescurso-head"><span class="mescurso-title">Sin cerrar</span>'
    + '<span class="mescurso-chip warn">' + esc(current.label || '') + '</span>'
    + mesCursoBotonRefresco()
    + '</div>'
    + (veValoresCliente() ? (
      '<div class="mescurso-val-lbl">Facturación</div>'
      + '<div class="mescurso-val">' + esc(moneyFmt(current.net || 0)) + '</div>' + mescArrastreHtml(current)
      + '<div class="mescurso-val-note">Valor aproximado · factura sin cerrar (falta informe no suma acá)'
      + (debMonto ? ' · ya con <b>' + esc(moneyFmt(debMonto)) + '</b> de ' + (confDeb ? 'débitos' : 'posibles débitos') + ' descontados' : '')
      + (Number(current.nextPeriodCutoff) > 0 ? ' · + <b>' + esc(moneyFmt(current.nextPeriodCutoff)) + '</b> que entra en el próximo corte' : '') + '</div>'
    ) : '')
    + '<div class="mescurso-lines duo">'
    + '<div class="mescurso-line mescurso-click" onclick="toggleModulosJulio()"><span>Consultas · prácticas <span class="mescurso-caret" id="mescursoModulosJulioCaret">▸</span></span><b>' + esc(numberFmt(current.consultations || 0)) + ' · ' + esc(numberFmt(current.practices || 0)) + '</b></div>'
    + '<div class="mescurso-line warn' + djClick + '"><span>' + (confDeb ? 'Débitos' : 'Posibles débitos') + djCaret + '</span><b>' + esc(numberFmt(debCount)) + mcMoneyPart(debMonto) + '</b></div>'
    + '<div class="mescurso-line alert' + fjClick + '"><span>Faltan informes' + fjCaret + '</span>'
    + '<b>' + esc(numberFmt(faltan)) + mcMoneyPart(faltanMonto) + '</b>' + (((current.missingInformeDebito || 0) && veValoresCliente()) ? '<small class="mescurso-debnote">' + esc(numberFmt(current.missingInformeDebito)) + ' irían a débito · ' + esc(moneyFmt(current.missingInformeDebitoAmount || 0)) + '</small>' : '') + '</div>'
    + '<div class="mescurso-line mescurso-click" onclick="toggleAusentesJulio()"><span>Ausentes sin validar <span class="mescurso-caret" id="mescursoAusentesJulioCaret">▸</span></span>'
    + '<b>' + esc(numberFmt(ausentes)) + mcMoneyPart(ausMonto) + '</b></div>'
    + (fueraCorte > 0 ? '<div class="mescurso-line wide mescurso-click" onclick="toggleFueraCorteJulio()"><span>A facturar fuera de corte <span class="mescurso-caret" id="mescursoFueraCorteJulioCaret">▸</span></span><b>' + esc(numberFmt(fueraCorte)) + mcMoneyPart(fueraCorteMonto) + '</b></div>' : '')
    + '</div>'
    + (current.transmittedToday > 0 ? '<div class="mescurso-sync"><span>🔁 Transmitidas hoy</span><b>' + esc(numberFmt(current.transmittedToday)) + '</b></div>' : '')
    + syncSc + foot + '</div>';
}
function irAReporteSinCerrar(){
  if (!MESCURSO_REPORTE_ID) return;
  setClientSection('reportes');
  var id = MESCURSO_REPORTE_ID;
  setTimeout(function(){ openClientReport(id); }, 30);
}
function mesCursoAbrirReporte(id){
  if (!id) return;
  setClientSection('reportes');
  setTimeout(function(){ openClientReport(id); }, 30);
}
// Card estática de un mes YA cerrado (ej. el ante-último: junio cuando el actual es
// agosto). No trae los desplegables interactivos (esos están cableados al mes "sin
// cerrar"); muestra el resumen y, al tocar, abre el reporte de ese mes.
function mesCursoCardMesCerrado(current, reporte){
  var fechaRep = (reporte && reporte.closedAt) ? mesCursoFechaCorta(reporte.closedAt) : '';
  var debMonto = current.debit || 0, debCount = current.debitCount || 0;
  var faltan = current.missingInforme || 0, faltanMonto = current.missingInformeAmount || 0;
  var ausentes = current.absent || 0, ausMonto = current.absentAmount || 0;
  var foot = fechaRep ? '<div class="mescurso-foot">Reporte del ' + esc(fechaRep) + '</div>' : '';
  var syncSc = (reporte && reporte.updatedAt) ? '<div class="mescurso-sync"><span>🔄 Última actualización</span><b>' + esc(mesCursoFechaHora(reporte.updatedAt)) + '</b></div>' : '';
  var clickable = reporte ? ' mescurso-click" onclick="mesCursoAbrirReporte(\'' + esc(reporte.id) + '\')' : '';
  // Confirmados = ya cotejados contra PAMI → dejan de ser "posibles".
  var confDeb = reporte && reporte.debitStatus === 'confirmado';
  return '<div class="mescurso-card cerrado' + clickable + '">'
    + '<div class="mescurso-head"><span class="mescurso-title">Cerrado</span>'
    + '<span class="mescurso-chip">' + esc(current.label || '') + '</span></div>'
    + (veValoresCliente() ? (
      '<div class="mescurso-val-lbl">Facturación</div>'
      + '<div class="mescurso-val">' + esc(moneyFmt(current.net || 0)) + '</div>' + mescArrastreHtml(current)
      + '<div class="mescurso-val-note">Valor aproximado'
      + (debMonto ? ' · ya con <b>' + esc(moneyFmt(debMonto)) + '</b> de ' + (confDeb ? 'débitos' : 'posibles débitos') + ' descontados' : '')
      + (Number(current.nextPeriodCutoff) > 0 ? ' · + <b>' + esc(moneyFmt(current.nextPeriodCutoff)) + '</b> que entra en el próximo corte' : '') + '</div>'
    ) : '')
    + '<div class="mescurso-lines duo">'
    + '<div class="mescurso-line mescurso-click" onclick="event.stopPropagation();toggleModulosCerrado()"><span>Consultas · prácticas <span class="mescurso-caret" id="mescursoModulosCerradoCaret">▸</span></span><b>' + esc(numberFmt(current.consultations || 0)) + ' · ' + esc(numberFmt(current.practices || 0)) + '</b></div>'
    + '<div class="mescurso-line warn mescurso-click" onclick="event.stopPropagation();toggleDebitosCerrado()"><span>' + (confDeb ? 'Débitos' : 'Posibles débitos') + ' <span class="mescurso-caret" id="mescursoDebitosCerradoCaret">▸</span></span><b>' + esc(numberFmt(debCount)) + mcMoneyPart(debMonto) + '</b></div>'
    + '<div class="mescurso-line alert mescurso-click" onclick="event.stopPropagation();toggleFaltanInformesCerrado()"><span>Faltan informes <span class="mescurso-caret" id="mescursoInformesCerradoCaret">▸</span></span><b>' + esc(numberFmt(faltan)) + mcMoneyPart(faltanMonto) + '</b>' + (((current.missingInformeDebito || 0) && veValoresCliente()) ? '<small class="mescurso-debnote">' + esc(numberFmt(current.missingInformeDebito)) + ' irían a débito · ' + esc(moneyFmt(current.missingInformeDebitoAmount || 0)) + '</small>' : '') + '</div>'
    + '<div class="mescurso-line mescurso-click" onclick="event.stopPropagation();toggleAusentesCerrado()"><span>Ausentes sin validar <span class="mescurso-caret" id="mescursoAusentesCerradoCaret">▸</span></span><b>' + esc(numberFmt(ausentes)) + mcMoneyPart(ausMonto) + '</b></div>'
    + '</div>'
    + (current.transmittedToday > 0 ? '<div class="mescurso-sync"><span>🔁 Transmitidas hoy</span><b>' + esc(numberFmt(current.transmittedToday)) + '</b></div>' : '')
    + syncSc + foot + '</div>';
}
function medCabEstadoMes(d){
  var validar = Number(d && d.pendienteValidar) || 0;
  var transmitir = Number(d && d.pendienteTransmitir) || 0;
  if (validar || transmitir) return 'pendiente';
  if ((Number(d && d.listas) || 0) > 0) return 'ok';
  return 'vacio';
}
// Este tablero lo usan DOS clases de cliente: el médico de cabecera de verdad
// (tipo = med_cabecera) y un consultorio de pago fijo con bandeja del CUP
// (bandejaCup, ej. Caballito). Los textos no pueden decir "médico de cabecera"
// en el segundo caso - es un consultorio.
function medCabEsMedicoDeCabecera(){ return !!(ACTIVE_CLIENT && ACTIVE_CLIENT.tipo === 'med_cabecera'); }
function medCabTituloTablero(){ return medCabEsMedicoDeCabecera() ? 'Dashboard médico de cabecera' : 'Dashboard por bandeja del CUP'; }
function medCabNotaCard(){ return medCabEsMedicoDeCabecera() ? 'Médico de cabecera · sin valorización por práctica' : 'Consultorio de pago fijo · sin valorización por práctica'; }
// Un renglón clickeable de la tarjeta: abre la lista de PACIENTES de ese mes y
// esa categoría (sin valores: la bandeja del CUP no los tiene).
function medCabLinea(d, tono, label, valor, tipo){
  var slug = (ACTIVE_CLIENT && ACTIVE_CLIENT.slug) || '';
  var nom = (ACTIVE_CLIENT && ACTIVE_CLIENT.name) || '';
  var mes = (d && d.month) || '';
  var etiqueta = nom + (d && d.monthLabel ? ' · ' + d.monthLabel : '');
  var clickable = valor > 0;
  return '<div class="mescurso-line ' + tono + (clickable ? ' mescurso-click' : '') + '"'
    + (clickable ? ' onclick="abrirPendientesDetalle(\'' + escJs(slug) + '\',\'' + tipo + '\',\'' + escJs(etiqueta) + '\',\'' + escJs(mes) + '\')" title="Ver los pacientes"' : '')
    + '><span>' + esc(label) + (clickable ? ' <span class="mescurso-caret">▸</span>' : '') + '</span>'
    + '<b>' + esc(numberFmt(valor)) + '</b></div>';
}
function medCabMesCard(d){
  var validar = Number(d && d.pendienteValidar) || 0;
  var transmitir = Number(d && d.pendienteTransmitir) || 0;
  var listas = Number(d && d.listas) || 0;
  var total = Number(d && d.count) || (validar + transmitir + listas);
  var pendientes = validar + transmitir;
  var estado = medCabEstadoMes(d);
  var cls = estado === 'ok' ? ' ok' : (estado === 'pendiente' ? ' warn' : '');
  return '<div class="mescurso-card medcab-card' + cls + '">'
    + '<div class="mescurso-head"><span class="mescurso-title">' + esc(d.monthLabel || d.month || 'Mes') + '</span>'
    + (d.live ? '<span class="mescurso-chip">Actual</span>' : '') + '</div>'
    + '<div class="mescurso-val-lbl">Pendientes</div>'
    + '<div class="mescurso-val chico">' + esc(numberFmt(pendientes)) + '</div>'
    + '<div class="mescurso-val-note">' + esc(medCabNotaCard()) + '</div>'
    + '<div class="mescurso-lines">'
    + medCabLinea(d, 'warn',  'Faltan validar',   validar,   'cup-validar')
    + medCabLinea(d, 'alert', 'Faltan informe',   transmitir, 'cup-informe')
    + medCabLinea(d, '',      'Transmitidas',     listas,    'cup-transmitidas')
    + medCabLinea(d, '',      'Total en bandeja', total,     'cup-total')
    + '</div>'
    + (d.uploadedAt ? '<div class="mescurso-sync"><span>Ultima actualización</span><b>' + esc(mesCursoFechaHora(d.uploadedAt)) + '</b></div>' : '')
    + '</div>';
}
function medCabResumenLista(historial, key, titulo, empty){
  var rows = (historial || []).filter(function(d){ return (Number(d && d[key]) || 0) > 0; });
  if (!rows.length) return '<div class="medcab-list"><h3>' + esc(titulo) + '</h3><p class="nom-muted">' + esc(empty) + '</p></div>';
  var tipo = key === 'pendienteValidar' ? 'cup-validar' : 'cup-informe';
  var slug = (ACTIVE_CLIENT && ACTIVE_CLIENT.slug) || '';
  var nom = (ACTIVE_CLIENT && ACTIVE_CLIENT.name) || '';
  return '<div class="medcab-list"><h3>' + esc(titulo) + '</h3>'
    + rows.map(function(d){
      var etiqueta = nom + (d.monthLabel ? ' · ' + d.monthLabel : '');
      // Mismo detalle que el renglón de la tarjeta: los pacientes de ese mes.
      return '<div class="medcab-list-row mescurso-click" title="Ver los pacientes"'
        + ' onclick="abrirPendientesDetalle(\'' + escJs(slug) + '\',\'' + tipo + '\',\'' + escJs(etiqueta) + '\',\'' + escJs(d.month || '') + '\')">'
        + '<span>' + esc(d.monthLabel || d.month || 'Mes') + ' <span class="mescurso-caret">▸</span></span>'
        + '<b>' + esc(numberFmt(d[key] || 0)) + '</b></div>';
    }).join('')
    + '</div>';
}
async function loadMedCabMesCurso(){
  var box = document.getElementById('clientMesCurso');
  if (!box || !ACTIVE_CLIENT) return;
  var slug = ACTIVE_CLIENT.slug;
  box.innerHTML = '<div class="client-card"><p class="nom-muted">Cargando dashboard...</p></div>';
  var results = await Promise.all([
    api('/api/clientes/' + encodeURIComponent(slug) + '/bandeja/archivo'),
    api('/api/bandeja/refresco/estado'),
  ]);
  if (!ACTIVE_CLIENT || ACTIVE_CLIENT.slug !== slug) return;
  var r = results[0];
  var refEstado = (results[1] && results[1].ok && results[1].data) ? results[1].data : null;
  REFRESCO_ACTIVO = !!(refEstado && (refEstado.pendiente || refEstado.corriendo));
  if (!r.ok) {
    box.innerHTML = '<div class="mescurso-card"><div class="mescurso-empty"><b>No se pudo cargar la bandeja</b><span>' + esc((r.data && r.data.error) || 'Revisá el estado del server.') + '</span></div></div>';
    return;
  }
  var historial = ((r.data || {}).historial || []).slice().sort(function(a, b){
    return String(b.month || '').localeCompare(String(a.month || ''));
  });
  if (!historial.length) {
    box.innerHTML = '<div class="mescurso-card"><div class="mescurso-head"><span class="mescurso-title">' + esc(medCabTituloTablero()) + '</span>' + mesCursoBotonRefresco('Actualizar bandeja') + '</div>'
      + '<div class="mescurso-empty"><b>Esperando bandeja automática</b><span>Cuando el server baje la bandeja del CUP, acá se separan los meses que faltan validar y los que faltan informe.</span></div></div>';
    if (REFRESCO_ACTIVO) arrancarPollRefresco();
    return;
  }
  var cards = historial.slice(0, 6).map(medCabMesCard).join('');
  // Los números de arriba son los del MES EN CURSO (la bandeja viva), no la suma
  // de todos los meses: así son EXACTAMENTE los mismos que muestra el panel de
  // Pendientes del Inicio (pendientesDeCliente usa esa misma bandeja) y que la
  // tarjeta del mes actual de acá abajo. Antes sumaban todo el historial y no
  // cuadraban con nada.
  var vivo = historial.filter(function(d){ return d.live; })[0] || historial[0] || {};
  var totalValidar = Number(vivo.pendienteValidar) || 0;
  var totalTransmitir = Number(vivo.pendienteTransmitir) || 0;
  var totalListas = Number(vivo.listas) || 0;
  var mesVivo = vivo.month || '';
  var etiquetaVivo = ((ACTIVE_CLIENT && ACTIVE_CLIENT.name) || '') + (vivo.monthLabel ? ' · ' + vivo.monthLabel : '');
  var totalBtn = function(n, label, tipo){
    if (!n) return '<div><b>' + esc(numberFmt(n)) + '</b><span>' + esc(label) + '</span></div>';
    return '<div class="medcab-total-link" role="button" tabindex="0" title="Ver los pacientes"'
      + ' onclick="abrirPendientesDetalle(\'' + escJs((ACTIVE_CLIENT && ACTIVE_CLIENT.slug) || '') + '\',\'' + tipo + '\',\'' + escJs(etiquetaVivo) + '\',\'' + escJs(mesVivo) + '\')">'
      + '<b>' + esc(numberFmt(n)) + '</b><span>' + esc(label) + '</span></div>';
  };
  MESCURSO_MEDCAB_HISTORIAL = historial;
  box.innerHTML = '<div class="client-card medcab-dashboard-head">'
    + '<div><h3>' + esc(medCabTituloTablero()) + '</h3><p>Control por bandejas del CUP. No se valoriza por práctica porque el pago es fijo.</p></div>'
    + '<div class="medcab-totals">'
    + totalBtn(totalValidar, 'faltan validar' + (vivo.monthLabel ? ' · ' + vivo.monthLabel : ''), 'cup-validar')
    + totalBtn(totalTransmitir, 'faltan informe' + (vivo.monthLabel ? ' · ' + vivo.monthLabel : ''), 'cup-informe')
    + totalBtn(totalListas, 'transmitidas' + (vivo.monthLabel ? ' · ' + vivo.monthLabel : ''), 'cup-transmitidas')
    + '<button class="btn btn-ghost" type="button" title="Descargar PDF" onclick="mesCursoDescargar(\'pdf\',\'medcab-historial\',this)">📄 PDF</button>'
    + '<button class="btn btn-ghost" type="button" title="Descargar Excel" onclick="mesCursoDescargar(\'xlsx\',\'medcab-historial\',this)">📊 Excel</button>'
    + mesCursoBotonRefresco('Actualizar bandeja')
    + '</div></div>'
    + '<div class="mescurso-cards medcab-grid">' + cards + '</div>'
    + '<div class="medcab-columns">'
    + medCabResumenLista(historial, 'pendienteValidar', 'Meses con faltante de validación', 'No hay meses con OMEs pendientes de validar.')
    + medCabResumenLista(historial, 'pendienteTransmitir', 'Meses con faltante de informe', 'No hay meses con OMEs pendientes de informe.')
    + '</div>';
  if (REFRESCO_ACTIVO) arrancarPollRefresco();
}
async function loadClientMesCurso(){
  var box = document.getElementById('clientMesCurso');
  if (!box || !ACTIVE_CLIENT) return;
  // "bandejaCup": mismo tablero que un médico de cabecera (sin valorizar por
  // práctica), pero en un cliente que sigue siendo Consultorio en todo lo
  // demás (informes, OMEs, reportes, honorarios) — ver normalizeClient en
  // server.js. Caballito Pediátrico es el primer caso: pago fijo, sin
  // valorización, pero NO debe "entrar" a médico de cabecera.
  if (ACTIVE_CLIENT.tipo === 'med_cabecera' || ACTIVE_CLIENT.bandejaCup) return loadMedCabMesCurso();
  var slug = ACTIVE_CLIENT.slug;
  // OMEs que ya tienen informe generado (para ocultar "Crear/Crear y subir" aunque
  // la bandeja no esté refrescada). Fire-and-forget: los paneles se abren después.
  // OMEs ya generadas y faltantes desestimados: se ESPERAN junto con el resto (no
  // fire-and-forget), así al dibujar los paneles ya sabemos qué mostrar como
  // "Generado"/desestimado aunque la bandeja no se haya refrescado. Antes se perdía
  // al apretar F5 (se dibujaba antes de que llegara la data).
  MESCURSO_OMES_GEN = {};
  MESCURSO_FALTANTES_DESEST = {};
  // El mes anterior es SIEMPRE el calendario anterior a hoy (Agosto -> Julio), no
  // "el último reporte que exista". Si no hay reporte de ese mes, se muestra el
  // cartel de "falta reporte" (no se cae a un mes más viejo).
  var prev = mesCursoPeriodoAnterior();
  var prev2 = mesCursoMesAntes(prev);   // el mes ANTES del "sin cerrar" (ej. junio)
  var results = await Promise.all([
    api('/api/clientes/' + encodeURIComponent(slug) + '/bandeja/resumen'),
    api('/api/clientes/' + encodeURIComponent(slug) + '/dashboard?period=' + encodeURIComponent(prev)),
    api('/api/clientes/' + encodeURIComponent(slug) + '/reportes'),
    api('/api/bandeja/refresco/estado'),
    api('/api/clientes/' + encodeURIComponent(slug) + '/dashboard?period=' + encodeURIComponent(prev2)),
    api('/api/clientes/' + encodeURIComponent(slug) + '/informes/omes-generadas'),
    api('/api/clientes/' + encodeURIComponent(slug) + '/faltantes-desestimados'),
  ]);
  if (results[5] && results[5].ok && results[5].data) ((results[5].data.omes) || []).forEach(function(o){ MESCURSO_OMES_GEN[String(o).replace(/\D/g, '')] = 1; });
  if (results[6] && results[6].ok && results[6].data) ((results[6].data.omes) || []).forEach(function(o){ MESCURSO_FALTANTES_DESEST[String(o).replace(/\D/g, '')] = 1; });
  if (!ACTIVE_CLIENT || ACTIVE_CLIENT.slug !== slug) return; // cambió de cliente mientras cargaba
  var resumen = (results[0].ok && results[0].data) ? results[0].data.resumen : null;
  var estadoSync = (results[0].ok && results[0].data) ? results[0].data.estado : null;
  var adelante = (results[0].ok && results[0].data) ? results[0].data.adelante : null;
  var futuros = (results[0].ok && results[0].data) ? (results[0].data.futuros || []) : [];
  var refEstado = (results[3] && results[3].ok && results[3].data) ? results[3].data : null;
  REFRESCO_ACTIVO = !!(refEstado && (refEstado.pendiente || refEstado.corriendo));
  MESCURSO_FALTAN_INFORMES = (resumen && resumen.missingInformeRows) || [];
  MESCURSO_AUSENTES = (resumen && resumen.ausentesRows) || [];
  MESCURSO_POSIBLES_DEBITOS = (resumen && resumen.posiblesDebitosRows) || [];
  MESCURSO_MODULOS = mescMods(resumen && resumen.modules);
  MESCURSO_PERIODO_ACTUAL = (resumen && resumen.period) || '';
  MESCURSO_POSIBLES_DEBITOS_ADELANTE = (adelante && adelante.posiblesDebitosRows) || [];
  MESCURSO_FUTUROS = futuros || [];
  MESCURSO_PANEL_ABIERTO = '';
  var dash = (results[1].ok && results[1].data) ? results[1].data : null;
  var current = dash && dash.current ? dash.current : null;
  MESCURSO_PERIODO_JULIO = (current && current.period) || prev;
  MESCURSO_FALTAN_INFORMES_JULIO = (current && current.missingInformeRows) || [];
  MESCURSO_POSIBLES_DEBITOS_JULIO = (current && current.posiblesDebitosRows) || [];
  MESCURSO_AUSENTES_JULIO = (current && current.ausentesRows) || [];
  MESCURSO_FUERACORTE_JULIO = (current && current.fueraCorteRows) || [];
  MESCURSO_MODULOS_JULIO = mescMods(current && current.modules);
  var reportes = (results[2].ok && results[2].data) ? (results[2].data.reports || []) : [];
  // ¿Hay reporte del mes anterior? (current viene vacío si no hay nada de ese mes).
  var hayAnterior = current && current.period === prev && ((current.reportCount || 0) > 0 || (current.totalRows || 0) > 0);
  var pendiente = hayAnterior ? (reportes.filter(function(r){ return r.dashboardPeriod === prev; })[0] || null) : null;
  MESCURSO_REPORTE_ID = pendiente ? pendiente.id : null;

  var cardDer = hayAnterior ? mesCursoCardSinCerrar(current, pendiente) : mesCursoCardFaltaReporte(prev);
  var cardAdel = mesCursoCardAdelante(adelante, futuros);
  // Card extra del mes ANTES del "sin cerrar" (ej. junio), solo si hay reporte de ese
  // mes. Deja ver dos meses cerrados de un vistazo (útil para evaluar potenciales).
  var dash2 = (results[4] && results[4].ok && results[4].data) ? results[4].data : null;
  var current2 = dash2 && dash2.current ? dash2.current : null;
  MESCURSO_PERIODO_CERRADO = (current2 && current2.period) || prev2;
  MESCURSO_DEBITOS_CERRADO = (current2 && current2.posiblesDebitosRows) || [];   // detalle de la card "Cerrado"
  MESCURSO_AUSENTES_CERRADO = (current2 && current2.ausentesRows) || [];
  MESCURSO_FALTAN_INFORMES_CERRADO = (current2 && current2.missingInformeRows) || [];
  ensureInformesCfg(); // para tener listo el botón "Crear informe" en los faltantes
  MESCURSO_MODULOS_CERRADO = mescMods(current2 && current2.modules);
  var hayJunio = current2 && current2.period === prev2 && ((current2.reportCount || 0) > 0 || (current2.totalRows || 0) > 0);
  var reporte2 = hayJunio ? (reportes.filter(function(r){ return r.dashboardPeriod === prev2; })[0] || null) : null;
  var cardCerrado = hayJunio ? mesCursoCardMesCerrado(current2, reporte2) : '';
  var gridClass = cardCerrado ? ' cuatro' : (cardAdel ? ' tres' : '');
  box.innerHTML = '<div class="mescurso-cards' + gridClass + '">' + (cardAdel || '') + mesCursoCardMesEnCurso(resumen, estadoSync) + cardDer + cardCerrado + '</div>'
    + '<div id="mescursoInformesPanel"></div>';
  // Si hay un refresco pendiente/corriendo, seguir sondeando (recarga al terminar).
  if (REFRESCO_ACTIVO) arrancarPollRefresco();
}
async function renderActiveClient(){
  var client = ACTIVE_CLIENT;
  if (!client) return;
  // El filtro de módulos del dashboard es por cliente: si se cambió de
  // cliente, se limpia (los códigos de módulo de uno no tienen por qué
  // aplicar al otro). Si es el mismo cliente (ej. se guardó una edición),
  // se deja como estaba.
  if (DASH_MODULE_FILTER_CLIENT !== client.slug) { DASH_MODULE_FILTER = []; DASH_MODULE_FILTER_CLIENT = client.slug; }
  document.getElementById('clientCrumbName').textContent = client.name;
  document.getElementById('clientName').textContent = client.name;
  setClientHeaderUp('');   // se limpia al cambiar de cliente; loadClientPami lo recarga
  aplicarPestanasCliente();
  setClientSection(CLIENT_SECTION);
  loadClientPami();
  document.getElementById('clientBusinessName').textContent = client.businessName;
  document.getElementById('clientCuit').textContent = client.cuit;
  document.getElementById('clientUgl').textContent = client.ugl || '-';
  document.getElementById('clientSap').textContent = client.sap || '-';
  document.getElementById('clientDireccion').textContent = client.direccion || '-';
  document.getElementById('clientTelefono').textContent = client.telefono || '-';
  document.getElementById('clientModules').innerHTML = client.activeModules.map(function(module){
    return '<span class="module-chip"><b>' + esc(module.code) + '</b> ' + esc(module.name) + '</span>';
  }).join('');
  var esAdmin = ME && ME.role === 'admin';
  ['clientModulesEdit', 'clientEditBtn', 'clientDeleteBtn'].forEach(function(id){
    var b = document.getElementById(id); if (b) b.style.display = esAdmin ? 'grid' : 'none';
  });
  var summary = await api('/api/nomencladores');
  if (summary.ok) {
    var items = summary.data.nomencladores || [];
    fillClientPeriodSelect(items, items[0] ? items[0].value : summary.data.activePeriod);
    // Si hay un reporte abierto, el nomenclador queda asociado a ese reporte
    // (no se resetea al más reciente al cambiar de página).
    var reportePeriod = (CLIENT_REPORT_SOURCE && CLIENT_REPORT_SOURCE.nomencladorPeriod) || '';
    fillClientReportPeriodSelect(items, reportePeriod || (items[0] ? items[0].value : summary.data.activePeriod));
  }
  // Independientes -> en paralelo (antes iban en serie, uno esperando al otro).
  await Promise.all([loadClientReports(), loadClientDashboard(), loadClientNomenclador()]);
  restoreClientReportDraft();
}
function queueClientNomencladorSearch(){
  clearTimeout(CLIENT_NOM_TIMER);
  CLIENT_NOM_TIMER = setTimeout(loadClientNomenclador, 220);
}
async function loadClientNomenclador(){
  if (!ACTIVE_CLIENT) return;
  var period = document.getElementById('clientNomPeriod').value || NOM_ACTIVE_PERIOD;
  var q = document.getElementById('clientNomQ').value.trim();
  var modules = ACTIVE_CLIENT.activeModules.map(function(module){ return module.code; }).join(',');
  var params = new URLSearchParams({ period:period, q:q, modules:modules, limit:'120' });
  var res = await api('/api/nomencladores/search?' + params.toString());
  var body = document.getElementById('clientNomBody');
  if (!res.ok){
    body.innerHTML = '<tr><td colspan="6" class="muted-cell">' + esc(res.data.error || 'No se pudo buscar.') + '</td></tr>';
    document.getElementById('clientNomMeta').textContent = 'Sin datos para mostrar.';
    return;
  }
  renderNomencladorRows(res.data.rows || [], 'clientNomBody', 'clientNomMeta', res.data.total || 0);
}
// Descarga el nomenclador del cliente (la vista resumida, filtrada por sus
// módulos activos) en Excel o PDF, respetando el período y la búsqueda actual.
// Descarga el nomenclador COMPLETO (todos los módulos) en el formato limpio, como
// el del cliente pero sin filtrar. Usa el período elegido arriba (nomPeriod).
async function descargarNomencladorCompleto(format){
  var period = (document.getElementById('nomPeriod') || {}).value || NOM_ACTIVE_PERIOD || '';
  if (!period){ nsAlert('Primero elegí un nomenclador (período).'); return; }
  var params = new URLSearchParams({ period: period, format: format });
  try {
    var r = await fetch('/api/nomencladores/export?' + params.toString());
    if (!r.ok){ var d = {}; try { d = await r.json(); } catch (e) {} nsAlert((d && d.error) || 'No se pudo generar el archivo.'); return; }
    var blob = await r.blob();
    var cd = r.headers.get('content-disposition') || '';
    var m = cd.match(/filename="([^"]+)"/);
    bajarBlob(blob, m ? m[1] : ('nomenclador.' + (format === 'pdf' ? 'pdf' : 'xlsx')));
  } catch (e){ nsAlert('No se pudo generar el archivo.'); }
}
async function exportClientNomenclador(format){
  if (!ACTIVE_CLIENT) return;
  var period = document.getElementById('clientNomPeriod').value || NOM_ACTIVE_PERIOD || '';
  if (!period){ nsAlert('Primero elegí un nomenclador (período) para este cliente.'); return; }
  var q = document.getElementById('clientNomQ').value.trim();
  var params = new URLSearchParams({ period: period, q: q, format: format });
  var btn = document.getElementById(format === 'pdf' ? 'clientNomPdfBtn' : 'clientNomXlsxBtn');
  if (btn) btn.disabled = true;
  try {
    var r = await fetch('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/nomenclador/export?' + params.toString());
    if (!r.ok){ var d = {}; try { d = await r.json(); } catch (e) {} nsAlert((d && d.error) || 'No se pudo generar el archivo.'); return; }
    var blob = await r.blob();
    var cd = r.headers.get('content-disposition') || '';
    var m = cd.match(/filename="([^"]+)"/);
    bajarBlob(blob, m ? m[1] : ('nomenclador.' + (format === 'pdf' ? 'pdf' : 'xlsx')));
  } catch (e){ nsAlert('No se pudo generar el archivo.'); }
  finally { if (btn) btn.disabled = false; }
}
function moduleNameFromOption(option){
  var code = String(option.value || '').trim();
  var label = String(option.label || '').trim();
  var prefix = code ? code + ' - ' : '';
  return label.indexOf(prefix) === 0 ? label.slice(prefix.length).trim() : label;
}
async function renderClientModuleOptions(boxId, selectedModules){
  var box = document.getElementById(boxId);
  if (!box) return false;
  box.innerHTML = '<div class="muted-cell">Cargando módulos...</div>';
  var period = document.getElementById('clientNomPeriod').value || '';
  var summary = await api('/api/nomencladores' + (period ? '?period=' + encodeURIComponent(period) : ''));
  if (!summary.ok || !summary.data.loaded){
    box.innerHTML = '<div class="muted-cell">Primero carga un nomenclador.</div>';
    return false;
  }
  var activeByCode = {};
  (selectedModules || []).forEach(function(module){ activeByCode[String(module.code)] = module; });
  var options = ((summary.data.filters || {}).modules || []).map(function(option){
    return { code:String(option.value || '').trim(), name:moduleNameFromOption(option) };
  }).filter(function(option){ return option.code; });
  (selectedModules || []).forEach(function(module){
    if (!options.some(function(option){ return option.code === module.code; })) options.push(module);
  });
  box.innerHTML = options.map(function(option){
    var checked = activeByCode[option.code] ? ' checked' : '';
    return '<label class="module-edit-option"><input type="checkbox" value="' + esc(option.code) + '" data-name="' + esc(option.name) + '"' + checked + '><span><b>' + esc(option.code) + '</b> ' + esc(option.name) + '</span></label>';
  }).join('') || '<div class="muted-cell">No hay modulos disponibles en este nomenclador.</div>';
  return options.length > 0;
}
function selectedClientModulesFrom(boxId){
  return [].slice.call(document.querySelectorAll('#' + boxId + ' input:checked')).map(function(input){
    return { code:input.value, name:input.getAttribute('data-name') || '' };
  });
}
// Al elegir "Médico de cabecera" auto-tildamos su módulo (código 1).
function onClientCreateTipoChange(){
  if ((document.getElementById('clientCreateTipo') || {}).value !== 'med_cabecera') return;
  var cb = document.querySelector('#clientCreateModulesOptions input[value="1"]');
  if (cb) cb.checked = true;
}
async function openClientCreateModal(){
  var err = document.getElementById('clientCreateError');
  if (err) err.textContent = '';
  ['clientCreateName','clientCreateBusinessName','clientCreateCuit','clientCreateUgl','clientCreateSap'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var tipoSel = document.getElementById('clientCreateTipo');
  if (tipoSel) tipoSel.value = 'consultorio';
  var eaC = document.getElementById('clientCreateEnAnalisis'); if (eaC) eaC.checked = false;
  showModal('clientCreateModal','ccScrim');
  await renderClientModuleOptions('clientCreateModulesOptions', []);
}
function closeClientCreateModal(){ hideModal('clientCreateModal','ccScrim'); }
async function saveClientCreate(){
  var err = document.getElementById('clientCreateError');
  if (err) err.textContent = '';
  var selected = selectedClientModulesFrom('clientCreateModulesOptions');
  if (!selected.length){ if (err) err.textContent = 'Seleccioná al menos un módulo.'; return; }
  var payload = {
    name: (document.getElementById('clientCreateName') || {}).value || '',
    businessName: (document.getElementById('clientCreateBusinessName') || {}).value || '',
    cuit: (document.getElementById('clientCreateCuit') || {}).value || '',
    ugl: (document.getElementById('clientCreateUgl') || {}).value || '',
    sap: (document.getElementById('clientCreateSap') || {}).value || '',
    tipo: (document.getElementById('clientCreateTipo') || {}).value || 'consultorio',
    enAnalisis: !!((document.getElementById('clientCreateEnAnalisis') || {}).checked),
    activeModules: selected
  };
  var btn = document.getElementById('clientCreateSave');
  if (btn) btn.disabled = true;
  var res = await req('POST', '/api/clientes', payload);
  if (btn) btn.disabled = false;
  if (!res.ok){ if (err) err.textContent = res.data.error || 'No se pudo crear el cliente.'; return; }
  CLIENTS = res.data.clients || CLIENTS;
  closeClientCreateModal();
  go('clientes');
  selectClient((res.data.client || {}).slug);
}
async function openClientModulesModal(){
  if (!ACTIVE_CLIENT) return;
  var err = document.getElementById('clientModulesError');
  err.textContent = '';
  showModal('clientModulesModal','cmScrim');
  await renderClientModuleOptions('clientModulesOptions', ACTIVE_CLIENT.activeModules);
}
function closeClientModulesModal(){ hideModal('clientModulesModal','cmScrim'); }
async function saveClientModules(){
  if (!ACTIVE_CLIENT) return;
  var err = document.getElementById('clientModulesError');
  err.textContent = '';
  var selected = selectedClientModulesFrom('clientModulesOptions');
  if (!selected.length){ err.textContent = 'Seleccioná al menos un módulo.'; return; }
  var btn = document.getElementById('clientModulesSave');
  btn.disabled = true;
  var res = await req('PATCH', '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/modules', { activeModules:selected });
  btn.disabled = false;
  if (!res.ok){ err.textContent = res.data.error || 'No se pudieron guardar los módulos.'; return; }
  CLIENTS = res.data.clients || CLIENTS;
  ACTIVE_CLIENT = res.data.client || ACTIVE_CLIENT;
  renderClientList();
  closeClientModulesModal();
  await renderActiveClient();
}
// ---- Editar / eliminar cliente ----
function openClientEditModal(){
  if (!ACTIVE_CLIENT) return;
  var err = document.getElementById('clientEditError'); if (err) err.textContent = '';
  var set = function(id, v){ var el = document.getElementById(id); if (el) el.value = v || ''; };
  set('clientEditName', ACTIVE_CLIENT.name);
  set('clientEditBusinessName', ACTIVE_CLIENT.businessName);
  set('clientEditCuit', ACTIVE_CLIENT.cuit);
  set('clientEditUgl', ACTIVE_CLIENT.ugl);
  set('clientEditSap', ACTIVE_CLIENT.sap);
  set('clientEditTipo', ACTIVE_CLIENT.tipo === 'med_cabecera' ? 'med_cabecera' : 'consultorio');
  var enAn = document.getElementById('clientEditEnAnalisis'); if (enAn) enAn.checked = !!ACTIVE_CLIENT.enAnalisis;
  var bCup = document.getElementById('clientEditBandejaCup'); if (bCup) bCup.checked = !!ACTIVE_CLIENT.bandejaCup;
  set('clientEditSeccion', ACTIVE_CLIENT.seccion || 'consultorio');
  set('clientEditDireccion', ACTIVE_CLIENT.direccion);
  set('clientEditTelefono', ACTIVE_CLIENT.telefono);
  set('clientEditLogoW', ACTIVE_CLIENT.logoW ? String(ACTIVE_CLIENT.logoW) : '');
  renderClientEditLogo();
  showModal('clientEditModal', 'ceScrim');
}
// Miniatura del logo actual (o "sin logo cargado") en el modal de edición.
function renderClientEditLogo(){
  var img = document.getElementById('clientEditLogoPreview');
  var empty = document.getElementById('clientEditLogoEmpty');
  var del = document.getElementById('clientEditLogoDel');
  var tieneLogo = !!(ACTIVE_CLIENT && ACTIVE_CLIENT.logo);
  if (img){ img.style.display = tieneLogo ? '' : 'none'; img.src = tieneLogo ? ('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/logo-archivo?v=' + Date.now()) : ''; }
  if (empty) empty.style.display = tieneLogo ? 'none' : '';
  if (del) del.style.display = tieneLogo ? '' : 'none';
}
async function uploadClientLogo(fileInput){
  if (!ACTIVE_CLIENT) return;
  var err = document.getElementById('clientEditError'); if (err) err.textContent = '';
  var f = fileInput.files[0]; if (!f) return;
  var form = new FormData(); form.append('file', f);
  var r = await fetch('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/logo', { method: 'POST', body: form });
  var d = {}; try { d = await r.json(); } catch (e) {}
  fileInput.value = '';
  if (!r.ok){ if (err) err.textContent = (d && d.error) || 'No se pudo subir el logo.'; return; }
  ACTIVE_CLIENT = d.client || ACTIVE_CLIENT;
  CLIENTS = CLIENTS.map(function(c){ return c.slug === ACTIVE_CLIENT.slug ? ACTIVE_CLIENT : c; });
  renderClientEditLogo();
}
async function quitarClientLogo(){
  if (!ACTIVE_CLIENT || !ACTIVE_CLIENT.logo) return;
  if (!await nsConfirm('Se quita el logo de este cliente.', { titulo:'Quitar logo', okLabel:'Quitar', peligro:true })) return;
  var r = await req('DELETE', '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/logo');
  if (!r.ok) return;
  ACTIVE_CLIENT = r.data.client || ACTIVE_CLIENT;
  CLIENTS = CLIENTS.map(function(c){ return c.slug === ACTIVE_CLIENT.slug ? ACTIVE_CLIENT : c; });
  renderClientEditLogo();
}
function closeClientEditModal(){ hideModal('clientEditModal', 'ceScrim'); }
async function saveClientEdit(){
  if (!ACTIVE_CLIENT) return;
  var err = document.getElementById('clientEditError'); if (err) err.textContent = '';
  var payload = {
    name: (document.getElementById('clientEditName') || {}).value || '',
    businessName: (document.getElementById('clientEditBusinessName') || {}).value || '',
    cuit: (document.getElementById('clientEditCuit') || {}).value || '',
    ugl: (document.getElementById('clientEditUgl') || {}).value || '',
    sap: (document.getElementById('clientEditSap') || {}).value || '',
    tipo: (document.getElementById('clientEditTipo') || {}).value || 'consultorio',
    enAnalisis: !!((document.getElementById('clientEditEnAnalisis') || {}).checked),
    bandejaCup: !!((document.getElementById('clientEditBandejaCup') || {}).checked),
    seccion: (document.getElementById('clientEditSeccion') || {}).value || 'consultorio',
    direccion: (document.getElementById('clientEditDireccion') || {}).value || '',
    telefono: (document.getElementById('clientEditTelefono') || {}).value || '',
    logoW: Number((document.getElementById('clientEditLogoW') || {}).value) || 0
  };
  var btn = document.getElementById('clientEditSave'); if (btn) btn.disabled = true;
  var res = await req('PATCH', '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug), payload);
  if (btn) btn.disabled = false;
  if (!res.ok){ if (err) err.textContent = (res.data && res.data.error) || 'No se pudo guardar.'; return; }
  CLIENTS = res.data.clients || CLIENTS;
  ACTIVE_CLIENT = res.data.client || ACTIVE_CLIENT;
  renderClientList();
  closeClientEditModal();
  await renderActiveClient();
}
function openClientDeleteModal(){
  if (!ACTIVE_CLIENT) return;
  var err = document.getElementById('clientDeleteError'); if (err) err.textContent = '';
  var nm = document.getElementById('clientDeleteName'); if (nm) nm.textContent = ACTIVE_CLIENT.name;
  showModal('clientDeleteModal', 'cdScrim');
}
function closeClientDeleteModal(){ hideModal('clientDeleteModal', 'cdScrim'); }
async function confirmClientDelete(){
  if (!ACTIVE_CLIENT) return;
  var err = document.getElementById('clientDeleteError'); if (err) err.textContent = '';
  var btn = document.getElementById('clientDeleteConfirm'); if (btn) btn.disabled = true;
  var res = await req('DELETE', '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug));
  if (btn) btn.disabled = false;
  if (!res.ok){ if (err) err.textContent = (res.data && res.data.error) || 'No se pudo eliminar.'; return; }
  CLIENTS = res.data.clients || [];
  closeClientDeleteModal();
  ACTIVE_CLIENT = CLIENTS[0] || null;
  renderClientList();
  if (ACTIVE_CLIENT) selectClient(ACTIVE_CLIENT.slug);
  else go('dash', navElFor('dash'));
}
function renderSavedClientReports(){
  var body = document.getElementById('clientSavedReportsBody');
  var meta = document.getElementById('clientSavedReportMeta');
  if (!body) return;
  var reports = CLIENT_SAVED_REPORTS || [];
  if (meta) meta.textContent = reports.length ? reports.length + ' reportes guardados.' : 'Sin reportes guardados.';
  if (!reports.length){
    body.innerHTML = '<tr><td colspan="5" class="muted-cell">Sin reportes guardados.</td></tr>';
    return;
  }
  body.innerHTML = reports.map(function(report){
    var summary = report.summary || {};
    var notes = String(report.observations || '').trim();
    var viewing = CLIENT_REPORT_MODE === 'closed' && CLIENT_REPORT_ID === report.id;
    var actions = '<button class="btn btn-ghost report-open-btn" type="button" onclick="openClientReport(&quot;' + esc(report.id) + '&quot;)">Ver</button>'
      + '<button class="btn btn-ghost report-open-btn" type="button" onclick="downloadClientReport(&quot;' + esc(report.id) + '&quot;)">Excel</button>'
      + '<button class="btn btn-navy report-open-btn" type="button" onclick="openReportPdfModal(&quot;' + esc(report.id) + '&quot;)">Descargar PDF</button>'
      + (viewing ? '<button class="btn btn-ghost report-open-btn" type="button" onclick="closeClientReportView()">Cerrar</button>' : '')
      + '<button class="icon-danger-btn mini" type="button" title="Eliminar reporte" aria-label="Eliminar reporte" onclick="openReportDeleteModal(&quot;' + esc(report.id) + '&quot;,&quot;' + esc(report.title || 'reporte') + '&quot;)">' + SVG_TRASH + '</button>';
    var ds = report.debitStatus === 'confirmado' ? 'confirmado' : 'pendiente';
    var dsBadge = '<button type="button" class="debit-status ' + ds + '" title="Tocar para cambiar el estado de los débitos" onclick="toggleReportDebitStatus(&quot;' + esc(report.id) + '&quot;,&quot;' + (ds === 'confirmado' ? 'pendiente' : 'confirmado') + '&quot;)">'
      + (ds === 'confirmado' ? '✓ Débitos confirmados' : '⏳ Falta confirmar débitos') + '</button>';
    return '<tr>'
      + '<td><div class="nom-code">' + esc(report.title || 'Reporte cerrado') + '</div><div class="nom-muted">' + esc(dateFmt(report.closedAt)) + '<br>' + esc(report.sourceFilename || '') + (notes ? '<br>Obs. ' + esc(notes) : '') + '</div><div class="report-badges">' + dsBadge + '</div></td>'
      + '<td>' + esc(report.nomencladorLabel || report.nomencladorPeriod || '-') + '</td>'
      + '<td class="tnum">' + esc(report.rowCount || summary.totalRows || 0) + '</td>'
      + '<td class="nom-money"><b>' + esc(moneyFmt(summary.net || 0)) + '</b><div class="nom-muted">Deb. ' + esc(moneyFmt(summary.debit || 0))
        + (Number(summary.missingInformeAmount) > 0 ? '<br>Falta inf. ' + esc(moneyFmt(summary.missingInformeAmount)) : '')
        + (Number(summary.nextPeriodCutoff) > 0 ? '<br>Próx. corte ' + esc(moneyFmt(summary.nextPeriodCutoff)) : '')
        + '</div></td>'
      + '<td><div class="report-row-actions">' + actions + '</div></td>'
      + '</tr>';
  }).join('');
}
// Marca los débitos de un reporte como confirmados / pendientes de confirmar.
async function toggleReportDebitStatus(id, estado){
  if (!ACTIVE_CLIENT || !id) return;
  var r = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/reportes/' + encodeURIComponent(id) + '/debitos-estado', { estado: estado });
  if (r.ok) await loadClientReports();
}
// Modal con las opciones de PDF del reporte (en vez de muchos botones).
var REPORT_PDF_ID = '';
function closeDebitosModal(){ hideModal('debitosModal', 'debitosScrim'); }
function openDebitosModal(){
  var data = CLIENT_DASHBOARD_DATA || {};
  var cur = data.current || {};
  var rows = [];
  (cur.modules || []).forEach(function(m){
    (m.rows || []).forEach(function(r){
      if (Number(r.debit) > 0) rows.push({
        patientName: r.patientName, benefit: r.benefit,
        practiceCode: r.practiceCode, practiceDescription: r.practiceDescription,
        moduleCode: m.moduleCode, moduleDescription: m.moduleDescription,
        gross: r.gross, debit: r.debit
      });
    });
  });
  rows.sort(function(a, b){ return Number(b.debit || 0) - Number(a.debit || 0); });
  var total = rows.reduce(function(s, r){ return s + Number(r.debit || 0); }, 0);
  var meta = document.getElementById('debitosModalMeta');
  if (meta) meta.textContent = (cur.label || '') + ' · ' + rows.length + ' débito' + (rows.length === 1 ? '' : 's') + ' · total ' + moneyFmt(total);
  var body = document.getElementById('debitosModalBody');
  if (body) body.innerHTML = rows.length ? rows.map(function(r){
    return '<tr>'
      + '<td>' + esc(r.patientName || '-') + (r.benefit ? '<div class="nom-muted">' + esc(r.benefit) + '</div>' : '') + '</td>'
      + '<td><span class="nom-code">' + esc(r.practiceCode || '-') + '</span> ' + esc(r.practiceDescription || '')
        + (r.moduleCode ? '<div class="nom-muted">' + esc(r.moduleCode) + (r.moduleDescription ? ' ' + esc(r.moduleDescription) : '') + '</div>' : '') + '</td>'
      + '<td class="nom-money"><b>' + esc(moneyFmt(r.debit || 0)) + '</b><div class="nom-muted">de ' + esc(moneyFmt(r.gross || 0)) + '</div></td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="3" class="muted-cell">No hay debitos en este mes.</td></tr>';
  showModal('debitosModal', 'debitosScrim');
}
function openReportPdfModal(id){
  REPORT_PDF_ID = id;
  var box = document.getElementById('reportPdfModulesList');
  if (box) box.innerHTML = '<div class="modal-note" style="padding:8px 2px">Cargando especialidades…</div>';
  showModal('reportPdfModal', 'reportPdfScrim');
  loadReportPdfModules(id);
}
function closeReportPdfModal(){ hideModal('reportPdfModal', 'reportPdfScrim'); }
// Arma un botón por cada especialidad REAL del reporte (dinámico, no cardio/traumato fijos).
async function loadReportPdfModules(id){
  var box = document.getElementById('reportPdfModulesList');
  if (!box || !ACTIVE_CLIENT) return;
  try {
    var r = await fetch('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/reportes/' + encodeURIComponent(id) + '/modulos');
    var data = await r.json();
    if (REPORT_PDF_ID !== id) return; // cambió de reporte mientras cargaba
    var mods = (data && data.modules) || [];
    box.innerHTML = mods.map(function(m){
      return '<button type="button" onclick="reportPdfChoose(\'mod:' + esc(String(m.code)) + '\')">'
        + '<b>🩺 ' + esc(m.name) + '</b><span>Módulo ' + esc(String(m.code)) + ' · ' + esc(moneyFmt(m.net)) + '</span></button>';
    }).join('');
  } catch(e){ box.innerHTML = ''; }
}
function reportPdfChoose(kind){
  var id = REPORT_PDF_ID; if (!id) return;
  closeReportPdfModal();
  if (kind === 'general') downloadGeneralReportPdf(id);
  else if (kind.indexOf('mod:') === 0) downloadProfessionalReport(id, kind.slice(4));
  else downloadSpecialReportPdf(id, kind);
}
var REPORT_DELETE_ID = '';
function openReportDeleteModal(id, title){
  REPORT_DELETE_ID = id;
  var nm = document.getElementById('reportDeleteName'); if (nm) nm.textContent = title || 'este reporte';
  var err = document.getElementById('reportDeleteError'); if (err) err.textContent = '';
  showModal('reportDeleteModal', 'reportDeleteScrim');
}
function closeReportDeleteModal(){ hideModal('reportDeleteModal', 'reportDeleteScrim'); }
async function confirmReportDelete(){
  if (!ACTIVE_CLIENT || !REPORT_DELETE_ID) return;
  var err = document.getElementById('reportDeleteError'); if (err) err.textContent = '';
  var btn = document.getElementById('reportDeleteConfirm'); if (btn) btn.disabled = true;
  var res = await req('DELETE', '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/reportes/' + encodeURIComponent(REPORT_DELETE_ID));
  if (btn) btn.disabled = false;
  if (!res.ok){ if (err) err.textContent = (res.data && res.data.error) || 'No se pudo eliminar el reporte.'; return; }
  closeReportDeleteModal();
  if (CLIENT_REPORT_ID === REPORT_DELETE_ID && CLIENT_REPORT_MODE === 'closed') clearClientReport();
  await loadClientReports();
}
function downloadClientReport(id){
  if (!ACTIVE_CLIENT || !id) return;
  window.location.href = '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/reportes/' + encodeURIComponent(id) + '/download';
}
function downloadGeneralReportPdf(id){
  if (!ACTIVE_CLIENT || !id) return;
  window.location.href = '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/reportes/' + encodeURIComponent(id) + '/general-pdf';
}
function downloadProfessionalReport(id, moduleCode){
  if (!ACTIVE_CLIENT || !id || !moduleCode) return;
  window.location.href = '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/reportes/' + encodeURIComponent(id) + '/professional-pdf/' + encodeURIComponent(moduleCode);
}
function downloadSpecialReportPdf(id, section){
  if (!ACTIVE_CLIENT || !id || !section) return;
  window.location.href = '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/reportes/' + encodeURIComponent(id) + '/special-pdf/' + encodeURIComponent(section);
}
async function loadClientReports(){
  if (!ACTIVE_CLIENT) return;
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/reportes');
  CLIENT_SAVED_REPORTS = res.ok ? (res.data.reports || []) : [];
  renderSavedClientReports();
}
function fillClientDashboardSelects(periods, currentPeriod, comparePeriod){
  var current = document.getElementById('clientDashPeriod');
  var compare = document.getElementById('clientDashCompare');
  var options = (periods || []).map(function(item){
    var suffix = item.reportCount ? ' (' + item.reportCount + ')' : '';
    return '<option value="' + esc(item.period) + '">' + esc(item.label + suffix) + '</option>';
  }).join('');
  if (current) {
    current.innerHTML = options || '<option value="">Sin reportes</option>';
    if (currentPeriod && [].slice.call(current.options).some(function(option){ return option.value === currentPeriod; })) current.value = currentPeriod;
  }
  if (compare) {
    // No se puede comparar un mes contra sí mismo: se excluye el actual.
    var compareOptions = (periods || []).filter(function(item){ return item.period !== currentPeriod; }).map(function(item){
      var suffix = item.reportCount ? ' (' + item.reportCount + ')' : '';
      return '<option value="' + esc(item.period) + '">' + esc(item.label + suffix) + '</option>';
    }).join('');
    compare.innerHTML = '<option value="">Sin comparación</option>' + compareOptions;
    if (comparePeriod && comparePeriod !== currentPeriod && [].slice.call(compare.options).some(function(option){ return option.value === comparePeriod; })) compare.value = comparePeriod;
  }
}
// Fila de la tabla comparativa: métrica, valor de este mes, del anterior y la variación.
function cmpRow(label, curr, prev, delta, money){
  var fmt = money ? moneyFmt : numberFmt;
  var raw = delta ? Number(delta.value || 0) : (Number(curr) - Number(prev));
  var arrow = raw > 0 ? '▲ ' : (raw < 0 ? '▼ ' : '');
  var cls = raw > 0 ? 'good' : (raw < 0 ? 'bad' : '');
  var pct = (delta && delta.percent != null) ? ' (' + percentFmt(Math.abs(delta.percent)) + ')' : '';
  return '<tr><td>' + esc(label) + '</td>'
    + '<td class="num">' + esc(fmt(curr)) + '</td>'
    + '<td class="num">' + esc(fmt(prev)) + '</td>'
    + '<td class="num ' + cls + '">' + arrow + esc(fmt(Math.abs(raw)) + pct) + '</td></tr>';
}
function deltaText(label, delta, money){
  if (!delta) return '';
  var raw = Number(delta.value || 0);
  var value = money ? moneyFmt(Math.abs(raw)) : numberFmt(Math.abs(raw));
  var signClass = raw >= 0 ? 'good' : 'bad';
  var arrow = raw > 0 ? '▲ ' : (raw < 0 ? '▼ ' : '');
  var pct = delta.percent === null ? '' : ' (' + percentFmt(Math.abs(delta.percent)) + ')';
  return '<span class="' + signClass + '">' + esc(label) + ': ' + arrow + esc(value + pct) + '</span>';
}
// invert=true para métricas donde BAJAR es bueno (débitos, ausentes).
function dashboardDelta(delta, money, invert){
  if (!delta) return '';
  var raw = Number(delta.value || 0);
  var good = invert ? raw <= 0 : raw >= 0;
  var signClass = good ? 'good' : 'bad';
  var arrow = raw > 0 ? '▲' : (raw < 0 ? '▼' : '–');
  var value = money ? moneyFmt(Math.abs(raw)) : numberFmt(Math.abs(raw));
  var pct = delta.percent === null ? '' : '<span class="dashboard-delta-pct">' + esc(percentFmt(Math.abs(delta.percent))) + '</span>';
  return '<small class="dashboard-delta ' + signClass + '"><span class="dashboard-delta-arrow">' + arrow + '</span>' + esc(value) + pct + '</small>';
}
// Descarga la comparativa mes vs mes en Excel (con fórmulas) o PDF.
async function descargarComparativa(format){
  if (!ACTIVE_CLIENT) return;
  var period = (document.getElementById('clientDashPeriod') || {}).value || '';
  var compare = (document.getElementById('clientDashCompare') || {}).value || '';
  if (!period || !compare){ nsAlert('Elegí un mes y un mes para comparar antes de descargar.'); return; }
  var params = new URLSearchParams({ period: period, compare: compare, format: format });
  try {
    var r = await fetch('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/dashboard/comparativa/export?' + params.toString());
    if (!r.ok){ var d = {}; try { d = await r.json(); } catch (e) {} nsAlert((d && d.error) || 'No se pudo generar el archivo.'); return; }
    var blob = await r.blob();
    var cd = r.headers.get('content-disposition') || '';
    var m = cd.match(/filename="([^"]+)"/);
    bajarBlob(blob, m ? m[1] : ('comparativa.' + (format === 'pdf' ? 'pdf' : 'xlsx')));
  } catch (e){ nsAlert('No se pudo generar el archivo.'); }
}
// Resumen ejecutivo en texto: qué facturó y por qué cambió (arriba de todo).
// Cuenta las prestaciones COBRADAS (net > 0) de un período, sumando desde los rows
// de sus módulos — misma definición que el encabezado y el desglose por práctica.
function dashCobradasCount(periodo, kind){
  var n = 0;
  ((periodo && periodo.modules) || []).forEach(function(m){
    (m.rows || []).forEach(function(r){ if (r.kind === kind && Number(r.net || 0) > 0) n++; });
  });
  return n;
}
function renderDashResumen(current, compare, deltas){
  var box = document.getElementById('clientDashboardResumen');
  if (!box) return;
  if (!current.period){ box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  var curL = current.label || current.period;
  var curCons = dashCobradasCount(current, 'Consulta');   // solo cobradas, coherente con el neto
  var curPrac = dashCobradasCount(current, 'Practica');
  var totalPrest = curCons + curPrac;
  var promedio = totalPrest ? (Number(current.net || 0) / totalPrest) : 0;
  if (!compare.period){
    box.innerHTML = '<b>' + esc(curL) + '</b> facturó <b>' + esc(moneyFmt(current.net || 0)) + '</b> en '
      + esc(numberFmt(totalPrest)) + ' prestaciones cobradas (' + esc(numberFmt(curCons)) + ' consultas · '
      + esc(numberFmt(curPrac)) + ' prácticas). Promedio por prestación ' + esc(moneyFmt(promedio)) + '. '
      + '<span class="resumen-hint">Elegí un mes en “Comparar con” para ver qué cambió.</span>';
    return;
  }
  var cmpL = compare.label || compare.period;
  var dn = deltas.net || { value: 0, percent: null };
  var v = Number(dn.value || 0);
  var up = v >= 0;
  var pct = dn.percent == null ? '' : ' (' + (up ? '+' : '−') + percentFmt(Math.abs(dn.percent)) + ')';
  var varHtml = '<span class="resumen-var ' + (up ? 'pos' : 'neg') + '">' + (up ? '▲' : '▼') + ' '
    + esc((up ? '+' : '−') + moneyFmt(Math.abs(v)) + pct) + '</span>';
  var dc = curCons - dashCobradasCount(compare, 'Consulta');   // deltas de cobradas
  var dp = curPrac - dashCobradasCount(compare, 'Practica');
  var drv = [];
  if (dc) drv.push((dc > 0 ? '+' : '−') + numberFmt(Math.abs(dc)) + ' consultas');
  if (dp) drv.push((dp > 0 ? '+' : '−') + numberFmt(Math.abs(dp)) + ' prácticas');
  var drvPhrase = drv.length ? ' Movimiento de volumen: ' + esc(drv.join(' · ')) + '.' : '';
  var cmpCons = dashCobradasCount(compare, 'Consulta') + dashCobradasCount(compare, 'Practica');
  var cmpProm = cmpCons ? (Number(compare.net || 0) / cmpCons) : 0;
  var avgPhrase = ' Promedio por prestación ' + esc(moneyFmt(promedio))
    + (cmpProm ? ' (antes ' + esc(moneyFmt(cmpProm)) + ').' : '.');
  box.innerHTML = '<b>' + esc(curL) + '</b> facturó <b>' + esc(moneyFmt(current.net || 0)) + '</b>, ' + varHtml
    + ' frente a <b>' + esc(cmpL) + '</b> (' + esc(moneyFmt(compare.net || 0)) + ').' + drvPhrase + avgPhrase;
}
// Ranking "Qué explica la variación": módulos con mayor suba y mayor baja de neto.
function dashModulePairs(current, compare){
  var prev = {}; (compare.modules || []).forEach(function(m){ prev[String(m.moduleCode)] = m; });
  var cur = {}; (current.modules || []).forEach(function(m){ cur[String(m.moduleCode)] = m; });
  var keys = {}; Object.keys(prev).forEach(function(k){ keys[k] = 1; }); Object.keys(cur).forEach(function(k){ keys[k] = 1; });
  return Object.keys(keys).map(function(k){
    var c = cur[k] || {}, p = prev[k] || {};
    return {
      code: c.moduleCode || p.moduleCode || k,
      desc: c.moduleDescription || p.moduleDescription || '',
      netVar: Number(c.net || 0) - Number(p.net || 0),
      consVar: Number(c.consultations || 0) - Number(p.consultations || 0),
      pracVar: Number(c.practices || 0) - Number(p.practices || 0),
    };
  });
}
function renderDashRanking(current, compare){
  var box = document.getElementById('clientDashboardRanking');
  if (!box) return;
  if (!compare.period){ box.style.display = 'none'; box.innerHTML = ''; return; }
  var list = dashModulePairs(current, compare);
  var subas = list.filter(function(x){ return x.netVar > 0; }).sort(function(a, b){ return b.netVar - a.netVar; }).slice(0, 5);
  var bajas = list.filter(function(x){ return x.netVar < 0; }).sort(function(a, b){ return a.netVar - b.netVar; }).slice(0, 5);
  function sub(v, lbl){ if (!v) return ''; return '<span class="rk-sub ' + (v > 0 ? 'pos' : 'neg') + '">' + (v > 0 ? '+' : '−') + numberFmt(Math.abs(v)) + ' ' + lbl + '</span>'; }
  function item(x, pos){
    return '<div class="rk-item"><div class="rk-mod"><span class="nom-code">' + esc(x.code) + '</span> ' + esc(x.desc) + '</div>'
      + '<div class="rk-right"><div class="rk-net ' + (pos ? 'pos' : 'neg') + '">' + (pos ? '+' : '−') + esc(moneyFmt(Math.abs(x.netVar))) + '</div>'
      + '<div class="rk-deltas">' + sub(x.consVar, 'cons') + sub(x.pracVar, 'prác') + '</div></div></div>';
  }
  function col(title, arr, pos, empty){
    return '<div class="rk-col"><div class="rk-col-title ' + (pos ? 'pos' : 'neg') + '">' + esc(title) + '</div>'
      + (arr.length ? arr.map(function(x){ return item(x, pos); }).join('') : '<div class="rk-empty">' + esc(empty) + '</div>') + '</div>';
  }
  box.style.display = '';
  box.innerHTML = '<div class="rk-head">Qué explica la variación</div><div class="rk-cols">'
    + col('Principales subas', subas, true, 'Sin subas.') + col('Principales bajas', bajas, false, 'Sin bajas.') + '</div>';
}
var DASH_MODULE_SORT = 'neto';
function setDashModuleSort(mode){
  DASH_MODULE_SORT = (mode === 'suba' || mode === 'baja') ? mode : 'neto';
  if (CLIENT_DASHBOARD_DATA) renderClientDashboard(CLIENT_DASHBOARD_DATA);
}
var CLIENT_DASHBOARD_DATA = null;
// Filtro de módulos de la tabla del dashboard: array de códigos (string)
// tildados. Vacío = se ven todos (comportamiento normal, sin filtro).
var DASH_MODULE_FILTER = [];
var DASH_MODULE_FILTER_CLIENT = ''; // slug del cliente al que pertenece el filtro actual
var DASH_ALL_MODULES = []; // todos los módulos del período actual (para el picker, sin filtrar)
function toggleDashModuleFilterPop(force){
  var pop = document.getElementById('dmfPop');
  if (!pop) return;
  var show = typeof force === 'boolean' ? force : (pop.style.display === 'none');
  pop.style.display = show ? '' : 'none';
  if (show){
    renderDashModuleFilterOptions();
    var s = document.getElementById('dmfSearch');
    if (s){ s.value = ''; s.focus(); }
  }
}
function renderDashModuleFilterOptions(){
  var list = document.getElementById('dmfPopList');
  if (!list) return;
  var q = ((document.getElementById('dmfSearch') || {}).value || '').trim().toLowerCase();
  var items = DASH_ALL_MODULES.filter(function(m){
    if (!q) return true;
    var hay = (String(m.moduleCode || '') + ' ' + String(m.moduleDescription || '')).toLowerCase();
    return hay.indexOf(q) !== -1;
  }).slice().sort(function(a, b){ return String(a.moduleDescription || '').localeCompare(String(b.moduleDescription || '')); });
  list.innerHTML = items.length ? items.map(function(m){
    var code = String(m.moduleCode || '');
    var checked = DASH_MODULE_FILTER.indexOf(code) !== -1 ? ' checked' : '';
    return '<label><input type="checkbox" value="' + esc(code) + '"' + checked + ' onchange="onDashModuleFilterCheck(this)"><span><b>' + esc(code) + '</b> ' + esc(m.moduleDescription || '') + '</span></label>';
  }).join('') : '<div class="muted-cell">Sin módulos que coincidan.</div>';
}
function onDashModuleFilterCheck(input){
  var code = String(input.value);
  var idx = DASH_MODULE_FILTER.indexOf(code);
  if (input.checked) { if (idx === -1) DASH_MODULE_FILTER.push(code); }
  else if (idx !== -1) DASH_MODULE_FILTER.splice(idx, 1);
  if (CLIENT_DASHBOARD_DATA) renderClientDashboard(CLIENT_DASHBOARD_DATA);
}
function removeDashModuleFilter(code){
  var idx = DASH_MODULE_FILTER.indexOf(String(code));
  if (idx !== -1) DASH_MODULE_FILTER.splice(idx, 1);
  if (CLIENT_DASHBOARD_DATA) renderClientDashboard(CLIENT_DASHBOARD_DATA);
}
function clearDashModuleFilter(){
  DASH_MODULE_FILTER = [];
  toggleDashModuleFilterPop(false);
  if (CLIENT_DASHBOARD_DATA) renderClientDashboard(CLIENT_DASHBOARD_DATA);
}
// Chips + contador de la barra (se llama en cada render, esté abierto o
// cerrado el popover; el popover en sí no se toca acá para no perder el
// scroll/búsqueda si el usuario lo tiene abierto mientras tilda opciones).
function renderDashModuleFilterBar(){
  var chipsBox = document.getElementById('dmfChips');
  var countEl = document.getElementById('dmfCount');
  var clearBtn = document.getElementById('dmfClearBtn');
  if (!chipsBox) return;
  var byCode = {};
  DASH_ALL_MODULES.forEach(function(m){ byCode[String(m.moduleCode)] = m; });
  chipsBox.innerHTML = DASH_MODULE_FILTER.map(function(code){
    var m = byCode[code];
    var label = m ? (code + ' ' + (m.moduleDescription || '')) : code;
    return '<span class="dmf-chip">' + esc(label) + '<button type="button" onclick="removeDashModuleFilter(&quot;' + esc(code) + '&quot;)" aria-label="Quitar filtro">&times;</button></span>';
  }).join('');
  if (countEl) { countEl.style.display = DASH_MODULE_FILTER.length ? '' : 'none'; countEl.textContent = String(DASH_MODULE_FILTER.length); }
  if (clearBtn) clearBtn.style.display = DASH_MODULE_FILTER.length ? '' : 'none';
}
function renderClientDashboard(data){
  data = data || {};
  CLIENT_DASHBOARD_DATA = data;
  var current = data.current || {};
  var compare = data.compare || {};
  var deltas = compare.period ? (data.deltas || {}) : {};
  fillClientDashboardSelects(data.periods || [], current.period || '', compare.period || '');
  var exp = document.getElementById('clientDashboardExport');
  if (exp) exp.style.display = compare.period ? '' : 'none';
  var cmpShort = shortMonth(compare.label || compare.period || '');
  renderDashResumen(current, compare, deltas);
  var kpis = document.getElementById('clientDashboardKpis');
  if (kpis) {
    var hc = !!compare.period;
    function kprev(txt){ return hc ? '<small class="kpi-prev">' + esc(cmpShort + ': ' + txt) + '</small>' : ''; }
    // Solo cobradas (net > 0), coherente con la facturación neta y el resto del dashboard.
    var kConsCur = dashCobradasCount(current, 'Consulta'), kConsCmp = dashCobradasCount(compare, 'Consulta');
    var kPracCur = dashCobradasCount(current, 'Practica'), kPracCmp = dashCobradasCount(compare, 'Practica');
    var kDelta = function(cur, cmp){ return dashboardDelta({ value: cur - cmp, percent: cmp ? (cur - cmp) / cmp : null }, false); };
    kpis.innerHTML = ''
      + '<div><b>' + esc(moneyFmt(current.net || 0)) + '</b><span>Facturación neta</span>' + kprev(moneyFmt(compare.net || 0)) + dashboardDelta(deltas.net, true) + '</div>'
      + '<div><b>' + esc(numberFmt(kConsCur)) + '</b><span>Consultas</span><small>' + esc(moneyFmt(current.consultationNet || 0)) + '</small>' + kprev(numberFmt(kConsCmp)) + kDelta(kConsCur, kConsCmp) + '</div>'
      + '<div><b>' + esc(numberFmt(kPracCur)) + '</b><span>Prácticas / estudios</span><small>' + esc(moneyFmt(current.practiceNet || 0)) + '</small>' + kprev(numberFmt(kPracCmp)) + kDelta(kPracCur, kPracCmp) + '</div>'
      + '<div' + (Number(current.debit) > 0 ? ' class="kpi-clickable" role="button" tabindex="0" onclick="openDebitosModal()" title="Ver debitos"' : '') + '><b>' + esc(moneyFmt(current.debit || 0)) + '</b><span>Débitos</span>' + kprev(moneyFmt(compare.debit || 0)) + dashboardDelta(deltas.debit, true, true) + '<div class="debit-breakdown">' + debitBreakdownHtml(current.debitUmbral || 0, current.debitExcluyente || 0, current.debitOtros || 0) + '</div></div>'
      + '<div><b>' + esc(numberFmt(current.absent || 0)) + '</b><span>Ausentes</span>' + kprev(numberFmt(compare.absent || 0)) + dashboardDelta(deltas.absent, false, true) + '</div>'
      + '<div><b>' + esc(numberFmt(current.outsideCutoff || 0)) + '</b><span>Fuera de corte</span><small>' + esc(moneyFmt(current.nextPeriodCutoff || 0)) + '</small>' + kprev(numberFmt(compare.outsideCutoff || 0)) + dashboardDelta(deltas.outsideCutoff, false) + '</div>';
  }
  var compareBox = document.getElementById('clientDashboardCompare');
  if (compareBox) { compareBox.style.display = 'none'; compareBox.innerHTML = ''; }
  renderDashRanking(current, compare);
  loadDashboardNomNote(current.period || '', compare.period || '');
  var trend = document.getElementById('clientDashboardTrend');
  if (trend) {
    var series = data.series || [];
    if (series.length < 2) {
      trend.style.display = 'none';
      trend.innerHTML = '';
    } else {
      trend.style.display = '';
      var maxSerie = series.reduce(function(mx, s){ return Math.max(mx, Math.abs(Number(s.net || 0))); }, 0) || 1;
      trend.innerHTML = '<div class="dashboard-trend-title">Facturación neta por mes<span class="dashboard-trend-hint">tocá un mes para verlo en el dashboard</span></div>'
        + '<div class="dashboard-trend-bars">'
        + series.map(function(s){
            var h = Math.max(4, Math.round(Math.abs(Number(s.net || 0)) / maxSerie * 100));
            var hot = s.period === current.period ? ' hot' : '';
            return '<button type="button" class="dtb' + hot + '" onclick="pickDashPeriod(&quot;' + esc(s.period) + '&quot;)" title="' + esc(s.label || s.period) + '">'
              + '<span class="dtb-amt">' + esc(moneyCompact(s.net || 0)) + '</span>'
              + '<span class="dtb-area"><span class="dtb-col" style="height:' + h + '%"></span></span>'
              + '<span class="dtb-mo">' + esc(shortMonth(s.label || s.period)) + '</span></button>';
          }).join('')
        + '</div>';
      loadTrendFlags(series);
    }
  }
  var body = document.getElementById('clientDashboardModules');
  if (body) {
    var modules = (current.modules || []).slice();
    // Se guarda la lista completa sin filtrar para el picker (DASH_ALL_MODULES)
    // antes de recortarla.
    DASH_ALL_MODULES = modules.slice();
    if (DASH_MODULE_FILTER.length) {
      modules = modules.filter(function(m){ return DASH_MODULE_FILTER.indexOf(String(m.moduleCode)) !== -1; });
    }
    renderDashModuleFilterBar();
    // % part. y la barra son sobre lo que se está viendo: el total del mes sin
    // filtro, o el total del subconjunto filtrado si hay uno activo (con
    // filtro, las % de las filas visibles suman 100%).
    var totalNet = modules.reduce(function(s, m){ return s + Math.abs(Number(m.net || 0)); }, 0);
    var maxNet = modules.reduce(function(mx, m){ return Math.max(mx, Math.abs(Number(m.net || 0))); }, 0) || 1;
    var shareTitle = DASH_MODULE_FILTER.length ? 'Participación sobre el total de los módulos filtrados' : 'Participación sobre la facturación total del mes';
    // Para la variación por módulo vs el mes que se compara.
    var hayCompare = !!compare.period;
    var curLbl = shortMonth(current.label || current.period || 'Este mes');
    var cmpLbl = shortMonth(compare.label || compare.period || 'Mes ant.');
    var compareModules = {};
    (compare.modules || []).forEach(function(m){ compareModules[String(m.moduleCode)] = m; });
    // Toggle de orden: por facturación (default) o por mayor suba/baja vs el mes comparado.
    var sortCtl = document.getElementById('clientDashboardModuleSort');
    if (sortCtl){
      sortCtl.style.display = hayCompare ? '' : 'none';
      [].slice.call(sortCtl.querySelectorAll('button')).forEach(function(b){
        b.classList.toggle('active', b.getAttribute('data-sort') === DASH_MODULE_SORT);
      });
    }
    if (hayCompare && DASH_MODULE_SORT !== 'neto'){
      modules.sort(function(a, b){
        var pa = compareModules[String(a.moduleCode)] || {}, pb = compareModules[String(b.moduleCode)] || {};
        var va = Number(a.net || 0) - Number(pa.net || 0), vb = Number(b.net || 0) - Number(pb.net || 0);
        return DASH_MODULE_SORT === 'suba' ? vb - va : va - vb;
      });
    }
    body.innerHTML = modules.length ? modules.map(function(module, moduleIndex){
      var rows = module.rows || [];
      // Agrupado por prestacion (codigo): cuantas de cada una y el neto sumado.
      function renderDetailRows(detailRows, prevRows, emptyText){
        var groups = {};
        function acumular(rows, campoCount, campoNet){
          (rows || []).forEach(function(row){
            // Solo las COBRADAS: las que suman al neto (net > 0). Las fuera de corte
            // (van al próximo período) y las validadas sin transmitir tienen net 0 y
            // no cuentan acá, así la cantidad cierra con la plata.
            if (!(Number(row.net || 0) > 0)) return;
            var code = row.practiceCode || '-';
            var key = code + '|' + (row.practiceDescription || '');
            if (!groups[key]) groups[key] = { code: code, desc: row.practiceDescription || '', count: 0, net: 0, pcount: 0, pnet: 0 };
            groups[key][campoCount] += 1;
            groups[key][campoNet] += Number(row.net || 0);
          });
        }
        acumular(detailRows, 'count', 'net');
        if (hayCompare) acumular(prevRows, 'pcount', 'pnet');
        var list = Object.keys(groups).map(function(k){ return groups[k]; });
        if (!list.length) return '<tr><td colspan="3" class="muted-cell">' + esc(emptyText) + '</td></tr>';
        list.sort(function(a, b){ return (b.count + b.pcount) - (a.count + a.pcount) || b.net - a.net; });
        return list.map(function(g){
          var cd = hayCompare ? ' ' + dashboardDelta({ value: g.count - g.pcount, percent: g.pcount ? ((g.count - g.pcount) / Math.abs(g.pcount)) : null }, false) : '';
          var nd = hayCompare ? ' ' + dashboardDelta({ value: g.net - g.pnet, percent: g.pnet ? ((g.net - g.pnet) / Math.abs(g.pnet)) : null }, true) : '';
          var cPrev = hayCompare ? '<div class="mod-prev">' + esc(cmpLbl) + ' ' + esc(numberFmt(g.pcount)) + '</div>' : '';
          var nPrev = hayCompare ? '<div class="mod-prev">' + esc(cmpLbl) + ' ' + esc(moneyFmt(g.pnet)) + '</div>' : '';
          return '<tr>'
            + '<td><span class="nom-code">' + esc(g.code) + '</span> ' + esc(g.desc || '-') + '</td>'
            + '<td class="tnum"><div class="cmp-cell"><b>' + esc(numberFmt(g.count)) + '</b>' + cd + cPrev + '</div></td>'
            + '<td class="nom-money"><div class="cmp-cell"><b>' + esc(moneyFmt(g.net)) + '</b>' + nd + nPrev + '</div></td>'
            + '</tr>';
        }).join('');
      }
      function detailRow(kind, label, detailRows, prevRows){
        return '<tr class="dashboard-module-detail" id="dashboardModuleDetail' + moduleIndex + kind + '" style="display:none"><td colspan="4">'
          + '<div class="dashboard-detail-title">' + esc(label + ' - ' + (module.moduleCode || '-') + ' ' + (module.moduleDescription || '')) + (hayCompare ? ' <span class="nom-muted">(número grande = ' + esc(curLbl) + '; abajo = ' + esc(cmpLbl) + ')</span>' : '') + '</div>'
          + '<div class="dashboard-detail-scroll"><table><thead><tr><th>Prestación</th><th>Cantidad</th><th>Neto</th></tr></thead><tbody>'
          + renderDetailRows(detailRows, prevRows, 'Sin ' + label.toLowerCase() + ' para este módulo.')
          + '</tbody></table></div></td></tr>';
      }
      function countButton(kind, count){
        var disabled = Number(count || 0) <= 0 ? ' disabled' : '';
        return '<button class="dashboard-count-btn" type="button" onclick="toggleDashboardModuleDetail(' + moduleIndex + ',&quot;' + kind + '&quot;)"' + disabled + '>' + esc(numberFmt(count || 0)) + '</button>';
      }
      var consultationRows = rows.filter(function(row){ return row.kind === 'Consulta'; });
      var practiceRows = rows.filter(function(row){ return row.kind === 'Practica'; });
      var prevMod = compareModules[String(module.moduleCode)] || {};
      var prevConsRows = (prevMod.rows || []).filter(function(r){ return r.kind === 'Consulta'; });
      var prevPracRows = (prevMod.rows || []).filter(function(r){ return r.kind === 'Practica'; });
      var netAbs = Math.abs(Number(module.net || 0));
      var barW = Math.round(netAbs / maxNet * 100);
      var share = totalNet ? Math.round(netAbs / totalNet * 100) : 0;
      // Solo COBRADAS (net > 0), coherente con el NETO del módulo y con el desglose.
      var soloCobradas = function(rs){ return (rs || []).filter(function(r){ return Number(r.net || 0) > 0; }).length; };
      var consNow = soloCobradas(consultationRows);
      var pracNow = soloCobradas(practiceRows);
      var consPrevN = soloCobradas(prevConsRows), pracPrevN = soloCobradas(prevPracRows);
      var modDelta = '', consDelta = '', pracDelta = '';
      if (hayCompare){
        var mkDelta = function(now, prev, money){ var d = Number(now) - Number(prev || 0); return dashboardDelta({ value: d, percent: prev ? (d / Math.abs(prev)) : null }, money); };
        modDelta = mkDelta(module.net || 0, prevMod.net || 0, true);
        consDelta = mkDelta(consNow, consPrevN, false);
        pracDelta = mkDelta(pracNow, pracPrevN, false);
      }
      var consPrev = hayCompare ? '<div class="mod-prev">' + esc(cmpLbl) + ' ' + esc(numberFmt(consPrevN)) + '</div>' : '';
      var pracPrev = hayCompare ? '<div class="mod-prev">' + esc(cmpLbl) + ' ' + esc(numberFmt(pracPrevN)) + '</div>' : '';
      var netoPrev = hayCompare ? '<div class="mod-neto-prev">' + esc(cmpLbl) + ' ' + esc(moneyFmt(prevMod.net || 0)) + ' ' + modDelta + '</div>' : '';
      return '<tr class="dashboard-module-row">'
        + '<td><span class="nom-code">' + esc(module.moduleCode || '-') + '</span> <span class="nom-muted">' + esc(module.moduleDescription || '') + '</span></td>'
        + '<td class="tnum"><div class="mod-metric">' + countButton('Consulta', consNow) + consDelta + consPrev + '</div></td>'
        + '<td class="tnum"><div class="mod-metric">' + countButton('Practica', pracNow) + pracDelta + pracPrev + '</div></td>'
        + '<td class="nom-money"><div class="mod-neto-line"><b>' + esc(moneyFmt(module.net || 0)) + '</b>'
        + (Number(module.nextPeriodCutoff || 0) > 0 ? '<span class="mod-fuera-corte" title="Facturado fuera de corte: se cobra el próximo período">+ ' + esc(moneyFmt(module.nextPeriodCutoff)) + ' fuera de corte</span>' : '')
        + '<div class="mod-bar"><div class="mod-bar-fill" style="width:' + barW + '%"></div></div><span class="mod-share" title="' + esc(shareTitle) + '">' + share + '%</span></div>' + netoPrev + '</td>'
        + '</tr>'
        + detailRow('Consulta', 'Consultas', consultationRows, prevConsRows)
        + detailRow('Practica', 'Practicas', practiceRows, prevPracRows);
    }).join('') : ('<tr><td colspan="4" class="muted-cell">'
      + (DASH_MODULE_FILTER.length ? 'Ningún módulo filtrado tiene datos en este período.' : 'Sin datos para este mes.')
      + '</td></tr>');
    // Fila con el total combinado de los módulos filtrados (ej. sumar los 3
    // módulos de Oftalmología). Solo aparece si hay filtro activo y trajo filas.
    if (DASH_MODULE_FILTER.length && modules.length > 1) {
      var fCons = 0, fPrac = 0, fNet = 0;
      modules.forEach(function(m){
        // Solo cobradas (net > 0), igual que en cada módulo.
        fCons += (m.rows || []).filter(function(r){ return r.kind === 'Consulta' && Number(r.net || 0) > 0; }).length;
        fPrac += (m.rows || []).filter(function(r){ return r.kind === 'Practica' && Number(r.net || 0) > 0; }).length;
        fNet += Number(m.net || 0);
      });
      // Sin badge de %: acá siempre daría 100% (el total ya se calcula sobre
      // este mismo subconjunto filtrado), no aporta nada — el dato útil de
      // esta fila es la suma en sí.
      body.innerHTML = '<tr class="dashboard-module-row dmf-summary-row">'
        + '<td><b>Total de ' + esc(numberFmt(modules.length)) + ' módulos filtrados</b></td>'
        + '<td class="tnum"><b>' + esc(numberFmt(fCons)) + '</b></td>'
        + '<td class="tnum"><b>' + esc(numberFmt(fPrac)) + '</b></td>'
        + '<td class="nom-money"><b>' + esc(moneyFmt(fNet)) + '</b></td>'
        + '</tr>' + body.innerHTML;
    }
  }
}
function toggleDashboardModuleDetail(index, kind){
  var row = document.getElementById('dashboardModuleDetail' + index + kind);
  var other = document.getElementById('dashboardModuleDetail' + index + (kind === 'Consulta' ? 'Practica' : 'Consulta'));
  if (!row) return;
  if (other) other.style.display = 'none';
  row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}
async function loadClientDashboard(){
  if (!ACTIVE_CLIENT) return;
  var period = document.getElementById('clientDashPeriod');
  var compare = document.getElementById('clientDashCompare');
  var params = new URLSearchParams();
  if (period && period.value) params.set('period', period.value);
  if (compare && compare.value) params.set('compare', compare.value);
  // Si el select ya está poblado y el usuario eligió "Sin comparación" (value=''),
  // mandamos 'none' para que el server NO caiga por default al mes anterior.
  else if (compare && compare.options.length > 1) params.set('compare', 'none');
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/dashboard' + (params.toString() ? '?' + params.toString() : ''));
  if (res.ok) renderClientDashboard(res.data);
}
function reportBaseGross(row){
  return row.billable ? Number(row.valueGross || 0) : 0;
}
function reportDebitAmount(row){
  var gross = reportBaseGross(row);
  if (!row.manualDebit || gross <= 0) return 0;
  if (row.debitType === 'pay40') return Math.max(0, gross - (gross * 0.4));
  if (row.debitType === 'pay60') return Math.max(0, gross - (gross * 0.6));
  if (row.debitType === 'pay80') return Math.max(0, gross - (gross * 0.8));
  if (row.debitType === 'partial') return Math.max(0, Math.min(gross, Number(row.debitAmount || 0)));
  return gross;
}
function reportNetAmount(row){
  return Math.max(0, reportBaseGross(row) - reportDebitAmount(row));
}
function reportCutoffNextAmount(row){
  return row && row.outsideCutoff ? Number(row.valueGross || 0) : 0;
}
function reportMissingInforme(row){
  return !!(row && row.validated && !row.transmitted && !row.absent);
}
function reportMissingInformeAmount(row){
  return reportMissingInforme(row) ? Number(row.valueGross || 0) : 0;
}
function reportDisplayStatus(row){
  return reportMissingInforme(row) ? 'Falta informe' : (row.status || '-');
}
function updateExpectedAmountStatus(net){
  var status = document.getElementById('clientReportExpectedStatus');
  if (!status) return;
  var expectedRaw = String(CLIENT_REPORT_EXPECTED_AMOUNT || '').trim();
  var expected = parseMoneyInput(expectedRaw);
  status.className = 'report-match-status muted';
  if (!expectedRaw || expected <= 0){
    status.textContent = 'Sin control';
    return;
  }
  var diff = Math.round((net - expected) * 100) / 100;
  if (Math.abs(diff) <= 0.01){
    status.className = 'report-match-status ok';
    status.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Coincide</span>';
    return;
  }
  status.className = 'report-match-status bad';
  status.textContent = 'Diferencia ' + moneyFmt(diff);
}
function updateClientReportFormState(){
  var totalRows = (CLIENT_REPORT_ROWS || []).length;
  var locked = CLIENT_REPORT_MODE === 'closed';
  var editable = CLIENT_REPORT_MODE === 'draft' || CLIENT_REPORT_MODE === 'edit';
  var title = document.getElementById('clientReportTitle');
  if (title) title.disabled = locked;
  var expected = document.getElementById('clientReportExpectedAmount');
  if (expected) expected.disabled = locked;
  var notes = document.getElementById('clientReportObservations');
  if (notes) notes.disabled = locked || !totalRows;
  var period = document.getElementById('clientReportPeriod');
  if (period) period.disabled = locked || CLIENT_REPORT_MODE === 'edit';
  var editBtn = document.getElementById('clientReportEditBtn');
  if (editBtn) editBtn.disabled = !totalRows || CLIENT_REPORT_MODE !== 'closed';
  var discardBtn = document.getElementById('clientReportDiscardBtn');
  if (discardBtn) {
    discardBtn.disabled = !totalRows || !editable;
    discardBtn.textContent = CLIENT_REPORT_MODE === 'edit' ? 'Descartar cambios' : 'Descartar reporte';
  }
  var saveBtn = document.getElementById('clientReportSaveBtn');
  if (saveBtn) {
    saveBtn.disabled = !totalRows || !editable;
    saveBtn.textContent = CLIENT_REPORT_MODE === 'edit' ? 'Guardar cambios' : 'Guardar reporte';
  }
  var pamiBtn = document.getElementById('clientReportPamiBtn');
  if (pamiBtn) pamiBtn.disabled = !totalRows || !editable;
  renderSavedClientReports();
}
// ---------- Importar débitos desde la validación de PAMI ----------
function openPamiDebitModal(){
  if (!(CLIENT_REPORT_MODE === 'draft' || CLIENT_REPORT_MODE === 'edit')) return;
  document.getElementById('pamiDebitText').value = '';
  document.getElementById('pamiDebitError').textContent = '';
  var resEl0 = document.getElementById('pamiDebitResult'); resEl0.textContent = ''; resEl0.className = 'nom-muted';
  var al = document.getElementById('pamiDebitUmbral'); if (al){ al.style.display = 'none'; al.innerHTML = ''; }
  resetPamiApplyBtn();
  showModal('pamiDebitModal', 'pamiScrim');
}
function closePamiDebitModal(){ hideModal('pamiDebitModal', 'pamiScrim'); }
// Vuelve el botón "Aplicar débitos" a su estado inicial (al abrir el modal o al
// editar la validación pegada, para poder re-aplicar si la corrigen).
function resetPamiApplyBtn(){
  var b = document.getElementById('pamiDebitApply');
  if (b){ b.textContent = 'Aplicar débitos'; b.disabled = false; b.classList.remove('btn-done'); }
  var c = document.getElementById('pamiDebitCancel'); if (c) c.textContent = 'Cancelar';
}

// ===== Panel Débitos: reglas de cruce (dos estudios el mismo día → PAMI debita uno) =====
var DEBITO_REGLAS = [];
var UMBRAL_PAGA_PCT = 60;   // % que paga PAMI en "valorización parcial por umbrales" (configurable)
// Lee la config de débitos (reglas + % umbrales) del server, cacheando el %.
async function fetchDebitoConfig(){
  var r = await api('/api/debito-reglas');
  if (r.ok){
    if (Array.isArray(r.data.reglas)) DEBITO_REGLAS = r.data.reglas;
    if (Number(r.data.umbralPagaPct) > 0) UMBRAL_PAGA_PCT = Number(r.data.umbralPagaPct);
  }
  return r;
}
// Resumen (solo lectura) de las reglas de débito en la vista "General".
async function loadGeneralDebitos(){
  var box = document.getElementById('generalDebitosResumen');
  if (!box) return;
  box.innerHTML = '<div class="nom-muted">Cargando…</div>';
  await fetchDebitoConfig();
  var reglas = DEBITO_REGLAS || [];
  var activas = reglas.filter(function(r){ return r.activa; }).length;
  if (!reglas.length){ box.innerHTML = '<div class="nom-muted">Todavía no hay reglas de débito cargadas.</div>'; return; }
  box.innerHTML = '<div class="general-debitos-meta">' + reglas.length + ' regla' + (reglas.length === 1 ? '' : 's') + ' · ' + activas + ' activa' + (activas === 1 ? '' : 's') + '</div>'
    + '<div class="debito-reglas-list">' + reglas.map(function(rg){
      var esPar = rg.tipo === 'par';
      var cuando = rg.alcance === 'periodo' ? 'en el mes' : 'el mismo día';
      var titulo = esPar ? (rg.codigosNombre || (rg.codigos||[]).join(' + ')) : (rg.debitaNombre || rg.debita);
      var detalle = esPar
        ? '<span class="nom-code">' + esc((rg.codigos||[]).join(' + ')) + '</span> ' + esc(cuando) + ' → uno paga <b>40%</b>'
        : 'Se debita <span class="nom-code">' + esc(rg.debita) + '</span> al <b>100%</b> si ' + esc(cuando) + ' hay <span class="nom-code">' + esc((rg.conCodigos||[]).join('/')) + '</span> ' + esc(rg.conNombre || '');
      return '<div class="debito-regla-item' + (rg.activa ? '' : ' off') + '"><div class="debito-regla-txt"><b>' + esc(titulo) + '</b>'
        + '<div class="nom-muted">' + detalle + '</div></div>'
        + '<span class="general-debito-estado">' + (rg.activa ? 'Activa' : 'Apagada') + '</span></div>';
    }).join('') + '</div>';
}
async function openDebitoReglasModal(){
  document.getElementById('debitoReglasError').textContent = '';
  document.getElementById('debitoReglasList').innerHTML = '<div class="nom-muted">Cargando…</div>';
  showModal('debitoReglasModal', 'debitoReglasScrim');
  await fetchDebitoConfig();
  renderDebitoReglas();
}
function closeDebitoReglasModal(){ hideModal('debitoReglasModal', 'debitoReglasScrim'); }

// ===== Cotejar neto por módulo contra los montos oficiales de PAMI =====
var COTEJO_OFICIAL = null;   // último detalle PAMI parseado (para el ajuste automático)
var COTEJO_VER_TODOS = false; // mostrar también los módulos que cuadran (redondeo)
function openCotejoModal(){
  if (!(CLIENT_REPORT_ROWS || []).length){ nsAlert('Abrí o armá un reporte primero.'); return; }
  document.getElementById('cotejoError').textContent = '';
  COTEJO_VER_TODOS = false;
  showModal('cotejoModal', 'cotejoScrim');
}
function closeCotejoModal(){ hideModal('cotejoModal', 'cotejoScrim'); }
// El reporte tiene umbrales si alguna fila quedó marcada con motivo 'umbral'.
// ¿El reporte tiene algún motivo de débito marcado? (los hechos con código viejo
// no lo tienen). Si no, para umbrales caemos a "débito parcial" (pay40/60/80).
function reportTieneMotivos(){ return (CLIENT_REPORT_ROWS || []).some(function(r){ return r.debitMotivo; }); }
function esFilaUmbral(r, tieneMotivos){
  if (!r || !r.manualDebit) return false;
  if (tieneMotivos) return r.debitMotivo === 'umbral';
  // Sin motivos: pay40/60/80 = umbral, PERO un débito de CRUCE (regla mismo día,
  // ej. ecodoppler arterial+venoso al 40%) NO es umbral aunque sea pay40 — es otra
  // cosa (Resol 2713). Mismo criterio que debitoCategoria() en el server; sin esto
  // el cotejo ofrecía "ajustar umbrales" sobre cruces y los ponía en 0% (doble castigo).
  if (r.debitSource === 'regla' || r.autoDebit) return false;
  return ['pay40', 'pay60', 'pay80'].indexOf(r.debitType) >= 0;
}
function reportTieneUmbrales(){ var tm = reportTieneMotivos(); return (CLIENT_REPORT_ROWS || []).some(function(r){ return esFilaUmbral(r, tm); }); }
// Categoría de un débito para el desglose (umbral / excluyente / otro).
function debitoCategoria(r, tieneMotivos){
  if (tieneMotivos){
    if (r.debitMotivo === 'umbral') return 'umbral';
    if (r.debitMotivo === 'excluyente' || r.debitMotivo === 'incluyente') return 'excluyente';
    return 'otro';
  }
  // Débito de REGLA (cruce mismo día, ej. ecodoppler art+ven al 40%): NO es umbral
  // aunque sea pay40. El umbral es otra cosa (Resol 2713).
  if (r.debitSource === 'regla') return 'otro';
  // Reporte sin motivos (código viejo): umbral = débito parcial; el resto = otro.
  return ['pay40', 'pay60', 'pay80'].indexOf(r.debitType) >= 0 ? 'umbral' : 'otro';
}
function debitBreakdownHtml(umbral, excl, otros){
  var l = [];
  if (umbral > 0) l.push('<span>Umbrales <b>' + esc(moneyFmt(umbral)) + '</b></span>');
  if (excl > 0) l.push('<span>Excluyentes <b>' + esc(moneyFmt(excl)) + '</b></span>');
  if (otros > 0) l.push('<span>Otros <b>' + esc(moneyFmt(otros)) + '</b></span>');
  return l.join('');
}
// Etiqueta corta del motivo del débito (para mostrar al lado de "Validación PAMI").
function motivoDebitoLabel(m){
  return { umbral:'Umbral', excluyente:'Excluyente', incluyente:'Incluyente', inactivo:'Inactivo', parcial:'Parcial' }[m] || '';
}
// Marca "Cotejar por módulo" como pendiente (⚠) SOLO si hay umbrales sin cotejar.
// Si el reporte no tiene umbrales, el botón queda normal (no muestra nada).
function updateCotejoPending(){
  var btn = document.getElementById('clientReportCotejoBtn');
  if (!btn) return;
  // "Cotejar por módulo" es solo para ajustar umbrales: se muestra únicamente si el
  // reporte está afectado (tiene filas con umbral). Sin umbrales, no aparece.
  var tiene = reportTieneUmbrales();
  btn.style.display = tiene ? '' : 'none';
  var pend = tiene && !CLIENT_REPORT_COTEJO_HECHO;
  btn.classList.toggle('cotejo-pendiente', pend);
  btn.innerHTML = pend ? 'Cotejar por módulo <small>⚠ pendiente</small>' : 'Cotejar por módulo';
}
// Módulo de una fila, remapeando los códigos viejos a su módulo (por si la vista
// todavía no tomó el remap del server).
function cotejoModuloDeFila(r){
  var c = String(r.practiceCode || '');
  if (['570123','570124','570126','820113'].indexOf(c) >= 0) return '543';
  if (c === '607137') return '552';
  return (String(r.moduleCode || '').match(/^\d+/) || [''])[0];
}
// Parsea el detalle de PAMI por módulo: por línea saca el módulo (1-3 díg) y el
// monto (el número más grande). Las líneas sin módulo (subtotal) son el total.
function parseCotejoPami(text){
  var porModulo = {}, total = 0;
  (text || '').split(/\r?\n/).forEach(function(line){
    var fields = line.split(/\t/).map(function(s){ return s.trim(); });
    if (fields.length < 2) fields = line.trim().split(/\s{2,}/);
    var amt = 0, modu = '';
    fields.forEach(function(f){
      var n = Number(String(f).replace(/\s/g,'').replace(',', '.'));
      if (isFinite(n) && n > 1000 && n > amt) amt = n;
      if (/^\d{1,3}$/.test(f)) modu = f;
    });
    if (amt <= 0) return;
    if (modu) porModulo[modu] = (porModulo[modu] || 0) + amt;
    else if (amt > total) total = amt;   // línea de subtotal
  });
  return { porModulo: porModulo, total: total };
}
function correrCotejo(){
  var err = document.getElementById('cotejoError'); err.textContent = '';
  var res = document.getElementById('cotejoResult'); res.innerHTML = '';
  var parsed = parseCotejoPami(document.getElementById('cotejoText').value);
  if (!Object.keys(parsed.porModulo).length){ err.textContent = 'No detecté módulos con monto. Pegá el detalle de PAMI (módulo + monto por línea).'; return; }
  var mio = {};
  (CLIENT_REPORT_ROWS || []).forEach(function(r){ var m = cotejoModuloDeFila(r); if (!m) return; mio[m] = (mio[m] || 0) + reportNetAmount(r); });
  var keys = {}; Object.keys(parsed.porModulo).forEach(function(k){ keys[k] = 1; }); Object.keys(mio).forEach(function(k){ keys[k] = 1; });
  var filas = Object.keys(keys).map(function(m){
    var of = parsed.porModulo[m] || 0, mi = mio[m] || 0;
    return { mod: m, oficial: of, mio: mi, dif: mi - of };
  }).sort(function(a, b){ return Math.abs(b.dif) - Math.abs(a.dif); });
  var totalMio = Object.values(mio).reduce(function(s, v){ return s + v; }, 0);
  var totalOf = parsed.total || Object.values(parsed.porModulo).reduce(function(s, v){ return s + v; }, 0);
  // Significativo (vale la pena revisar) = diferencia real, no redondeo: al menos
  // $50 Y al menos 0,1% del monto del módulo. Así los ±$1-$16 de redondeo no molestan.
  function esSignificativo(f){ return Math.abs(f.dif) >= 50 && (!f.oficial || Math.abs(f.dif) / f.oficial >= 0.001); }
  var revisar = filas.filter(esSignificativo);
  var cuadranN = filas.length - revisar.length;
  var mostrar = COTEJO_VER_TODOS ? filas : revisar;
  function filaHtml(f){
    var gap = esSignificativo(f);
    return '<tr class="cotejo-row ' + (gap ? 'cotejo-gap' : '') + '" onclick="cotejoIrAModulo(&quot;' + esc(f.mod) + '&quot;)" title="Ver las prácticas de este módulo"><td><span class="nom-code">' + esc(f.mod) + '</span></td>'
      + '<td class="nom-money">' + esc(moneyFmt(f.mio)) + '</td>'
      + '<td class="nom-money">' + (f.oficial ? esc(moneyFmt(f.oficial)) : '<span class="nom-muted">—</span>') + '</td>'
      + '<td class="nom-money ' + (gap ? (f.dif > 0 ? 'pos' : 'neg') : 'nom-muted') + '"><b>' + (f.dif >= 0 ? '+' : '−') + esc(moneyFmt(Math.abs(f.dif))) + '</b></td></tr>';
  }
  var body = mostrar.map(filaHtml).join('');
  var toggleRow = cuadranN > 0 ? '<tr class="cotejo-toggle"><td colspan="4"><button type="button" class="report-more-btn" onclick="cotejoVerTodos()">' + (COTEJO_VER_TODOS ? 'ocultar los ' + cuadranN + ' que cuadran' : 'ver los ' + cuadranN + ' módulos que cuadran (redondeo)') + '</button></td></tr>' : '';
  var difTotal = totalMio - totalOf;
  COTEJO_OFICIAL = parsed.porModulo;   // guardo el detalle PAMI para el ajuste automático
  var ajustes = calcularAjusteUmbrales(parsed.porModulo);
  var ajusteBox = '';
  if (ajustes.length){
    ajusteBox = '<div class="cotejo-ajuste"><button type="button" class="btn btn-navy" onclick="ajustarUmbralesPorCotejo()">⚡ Ajustar umbrales automáticamente</button>'
      + '<span class="nom-muted">Pone cada módulo con umbral en el % que hace coincidir con PAMI: <b>' + ajustes.map(function(a){ return a.mod + ' → ' + a.pct + '%'; }).join(' · ') + '</b>.</span></div>';
  }
  var resumen = revisar.length
    ? '<div class="cotejo-resumen bad">⚠ <b>' + revisar.length + ' módulo' + (revisar.length !== 1 ? 's' : '') + ' para revisar</b>: ' + revisar.map(function(f){ return '<b>' + esc(f.mod) + '</b> (' + (f.dif >= 0 ? '+' : '−') + esc(moneyFmt(Math.abs(f.dif))) + ')'; }).join(' · ') + '</div>'
    : '<div class="cotejo-resumen ok">✓ <b>Todo cuadra</b> — las diferencias son de redondeo (centavos).</div>';
  res.innerHTML = resumen
    + '<div class="cotejo-tablewrap"><table class="cotejo-table"><thead><tr><th>Módulo</th><th class="nom-money">Mi neto</th><th class="nom-money">PAMI</th><th class="nom-money">Diferencia</th></tr></thead>'
    + '<tbody>' + body + toggleRow + '</tbody>'
    + '<tfoot><tr><td><b>TOTAL</b></td><td class="nom-money"><b>' + esc(moneyFmt(totalMio)) + '</b></td><td class="nom-money"><b>' + esc(moneyFmt(totalOf)) + '</b></td><td class="nom-money ' + (Math.abs(difTotal) > 5 ? (difTotal > 0 ? 'pos' : 'neg') : '') + '"><b>' + (difTotal >= 0 ? '+' : '−') + esc(moneyFmt(Math.abs(difTotal))) + '</b></td></tr></tfoot></table></div>'
    + ajusteBox
    + '<p class="nom-muted cotejo-hint"><b>Tocá un módulo</b> para ver sus prácticas y ajustar a mano. Lo que no sea umbral (ej. excluyentes) se ajusta desde la fila.</p>';
  CLIENT_REPORT_COTEJO_HECHO = true;   // ya cotejó → saca el "pendiente"
  updateCotejoPending();
}
function cotejoVerTodos(){ COTEJO_VER_TODOS = !COTEJO_VER_TODOS; correrCotejo(); }
// Calcula, por módulo con umbrales, el % que hace que mi neto coincida con PAMI.
function calcularAjusteUmbrales(oficial){
  var rows = CLIENT_REPORT_ROWS || [];
  var tm = reportTieneMotivos();
  var porMod = {};
  rows.forEach(function(r){ var m = cotejoModuloDeFila(r); if (m) (porMod[m] = porMod[m] || []).push(r); });
  var ajustes = [];
  Object.keys(porMod).forEach(function(m){
    if (!(m in oficial)) return;
    var group = porMod[m];
    var umbrales = group.filter(function(r){ return esFilaUmbral(r, tm) && reportBaseGross(r) > 0; });
    if (!umbrales.length) return;
    // Si el módulo YA cuadra (diferencia de redondeo), no hay nada que ajustar:
    // no lo listamos (así el botón desaparece cuando ya está todo aplicado).
    var miNeto = group.reduce(function(s, r){ return s + reportNetAmount(r); }, 0);
    if (Math.abs(miNeto - oficial[m]) < 50) return;
    var netOther = 0; group.forEach(function(r){ if (!esFilaUmbral(r, tm)) netOther += reportNetAmount(r); });
    var bUmbral = umbrales.reduce(function(s, r){ return s + reportBaseGross(r); }, 0);
    if (bUmbral <= 0) return;
    var pct = Math.max(0, Math.min(100, (oficial[m] - netOther) / bUmbral * 100));
    // PAMI usa tiers 40/60/80/100 → si estamos cerca, snap; si no, dejamos el exacto.
    var snapped = [40, 60, 80, 100].reduce(function(b, v){ return Math.abs(v - pct) < Math.abs(b - pct) ? v : b; }, 40);
    var usar = Math.abs(snapped - pct) <= 3 ? snapped : Math.round(pct);
    ajustes.push({ mod: m, pct: usar, n: umbrales.length });
  });
  return ajustes;
}
// Aplica el ajuste: umbrales al % por módulo + excluyentes/incluyentes/inactivos a total.
function ajustarUmbralesPorCotejo(){
  if (!COTEJO_OFICIAL) return;
  var rows = CLIENT_REPORT_ROWS || [];
  rows.forEach(function(r){
    if (['excluyente','incluyente','inactivo'].indexOf(r.debitMotivo) >= 0 && r.debitSource === 'validacion' && r.debitType !== 'total'){ r.debitType = 'total'; r.debitAmount = 0; r.manualDebit = true; }
  });
  var tm = reportTieneMotivos();
  var ajustes = calcularAjusteUmbrales(COTEJO_OFICIAL);
  var porMod = {}; rows.forEach(function(r){ var m = cotejoModuloDeFila(r); if (m) (porMod[m] = porMod[m] || []).push(r); });
  ajustes.forEach(function(a){
    (porMod[a.mod] || []).filter(function(r){ return esFilaUmbral(r, tm) && reportBaseGross(r) > 0; }).forEach(function(r){
      var p = a.pct;
      if (p >= 100){ r.manualDebit = false; r.debitType = 'total'; r.debitAmount = 0; }
      else { r.manualDebit = true; r.debitAmount = 0;
        if (p === 40) r.debitType = 'pay40';
        else if (p === 60) r.debitType = 'pay60';
        else if (p === 80) r.debitType = 'pay80';
        else { r.debitType = 'partial'; r.debitAmount = reportBaseGross(r) * (1 - p / 100); }
      }
    });
  });
  renderClientReportRows();
  updateClientReportSummary();
  saveClientReportDraft();
  correrCotejo();   // re-cotejar para mostrar cómo cerró
}
function renderDebitoReglas(){
  var box = document.getElementById('debitoReglasList');
  if (!DEBITO_REGLAS.length){ box.innerHTML = '<div class="nom-muted">No hay reglas cargadas.</div>'; return; }
  box.innerHTML = DEBITO_REGLAS.map(function(rg, i){
    var esPar = rg.tipo === 'par';
    var cuando = rg.alcance === 'periodo' ? 'en el mes' : 'el mismo día';
    var titulo, detalle;
    if (esPar){
      titulo = esc(rg.codigosNombre || (rg.codigos||[]).join(' + '));
      detalle = '<span class="nom-code">' + esc((rg.codigos||[]).join(' + ')) + '</span> ' + esc(cuando) + ' → uno paga <b>40%</b>';
    } else {
      titulo = esc(rg.debitaNombre || rg.debita);
      detalle = 'Se debita <span class="nom-code">' + esc(rg.debita) + '</span> al <b>100%</b> si ' + esc(cuando) + ' hay <span class="nom-code">' + esc((rg.conCodigos||[]).join('/')) + '</span> ' + esc(rg.conNombre || '');
    }
    return '<div class="debito-regla-item">'
      + '<label class="debito-regla-toggle"><input type="checkbox" ' + (rg.activa ? 'checked' : '') + ' onchange="toggleReglaDebito(' + i + ', this.checked)"><span></span></label>'
      + '<div class="debito-regla-txt"><b>' + titulo + '</b><div class="nom-muted">' + detalle + '</div>'
      + (rg.nota ? '<div class="debito-regla-nota">' + esc(rg.nota) + '</div>' : '') + '</div>'
      + '<button class="icon-danger-btn mini" type="button" title="Eliminar" onclick="eliminarReglaDebito(' + i + ')"><svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
      + '</div>';
  }).join('');
}
function toggleReglaDebito(i, on){ if (DEBITO_REGLAS[i]) DEBITO_REGLAS[i].activa = !!on; }
function eliminarReglaDebito(i){ DEBITO_REGLAS.splice(i, 1); renderDebitoReglas(); }
function onNuevaReglaTipo(){
  var par = document.getElementById('nuevaReglaTipo').value === 'par';
  document.getElementById('nuevaReglaPar').style.display = par ? '' : 'none';
  document.getElementById('nuevaReglaInclusion').style.display = par ? 'none' : '';
}
function splitCodigos(v){ return String(v||'').split(/[,\s]+/).map(function(x){ return x.trim(); }).filter(Boolean); }
function agregarReglaDebito(){
  var err = document.getElementById('debitoReglasError'); err.textContent = '';
  var tipo = document.getElementById('nuevaReglaTipo').value;
  var regla;
  var alcance = (document.getElementById('nuevaReglaAlcance') || {}).value === 'periodo' ? 'periodo' : 'dia';
  if (tipo === 'par'){
    var cods = splitCodigos(document.getElementById('nuevaReglaCodigos').value);
    if (cods.length < 2){ err.textContent = 'Poné los dos códigos del par.'; return; }
    regla = { activa: true, tipo: 'par', monto: 'pay40', alcance: alcance, codigos: cods, codigosNombre: document.getElementById('nuevaReglaCodigosNombre').value.trim(), nota: document.getElementById('nuevaReglaNota').value.trim() };
  } else {
    var debita = document.getElementById('nuevaReglaDebita').value.trim();
    var con = splitCodigos(document.getElementById('nuevaReglaCon').value);
    if (!debita || !con.length){ err.textContent = 'Poné el código que se debita y al menos uno que lo incluye.'; return; }
    regla = { activa: true, tipo: 'inclusion', monto: 'total', alcance: alcance, debita: debita, debitaNombre: document.getElementById('nuevaReglaDebitaNombre').value.trim(), conCodigos: con, conNombre: document.getElementById('nuevaReglaConNombre').value.trim(), nota: document.getElementById('nuevaReglaNota').value.trim() };
  }
  DEBITO_REGLAS.push(regla);
  ['nuevaReglaDebita','nuevaReglaDebitaNombre','nuevaReglaCon','nuevaReglaConNombre','nuevaReglaCodigos','nuevaReglaCodigosNombre','nuevaReglaNota'].forEach(function(id){ document.getElementById(id).value=''; });
  renderDebitoReglas();
}
async function guardarReglasDebito(){
  var err = document.getElementById('debitoReglasError'); err.textContent = '';
  var btn = document.getElementById('debitoReglasSave'); btn.disabled = true;
  var r = await req('PUT', '/api/debito-reglas', { reglas: DEBITO_REGLAS });
  btn.disabled = false;
  if (!r.ok){ err.textContent = (r.data && r.data.error) || 'No se pudo guardar.'; return; }
  DEBITO_REGLAS = r.data.reglas || DEBITO_REGLAS;
  renderDebitoReglas();
  closeDebitoReglasModal();
  var gv = document.getElementById('view-soon');
  if (gv && gv.style.display !== 'none') loadGeneralDebitos();
}
// Parsea las filas pegadas de la validación de PAMI: afiliado + código + tipo.
function parsePamiValidacion(text){
  var out = [];
  (text || '').split(/\r?\n/).forEach(function(line){
    // Fila de datos = tiene afiliado (10-13 díg) + código (5-6 díg). Sirve para
    // cualquier motivo: "VALIDACION PARCIAL", "PRACTICAS EXCLUYENTES", etc.
    var af = (line.match(/\b(\d{10,13})\b/) || [])[1] || '';
    var nums = line.match(/\b\d{5,6}\b/g) || [];        // código = último número de 5-6 dígitos
    var codigo = nums.length ? nums[nums.length - 1] : '';
    if (!af || !codigo) return;
    // Motivo del débito (para la leyenda) + cuánto paga PAMI (tipo):
    //  - umbral (valorización parcial por umbrales) → estimación 40%, se ajusta por módulo.
    //  - parcial sin umbral (ej. ecodoppler art+ven) → paga 40%.
    //  - excluyente / incluyente / inactivo / otro → débito total.
    // OJO: "umbral" se chequea ANTES que "parcial" (el texto de umbrales dice
    // "VALORIZACION PARCIAL POR UMBRALES", contiene las dos palabras).
    var motivo = /umbral/i.test(line) ? 'umbral'
      : /excluyente/i.test(line) ? 'excluyente'
      : /incluyente/i.test(line) ? 'incluyente'
      : /inactivo/i.test(line) ? 'inactivo'
      : /parcial/i.test(line) ? 'parcial'
      : 'otro';
    var tipo = motivo === 'umbral' ? 'umbral' : motivo === 'parcial' ? 'pay40' : 'total';
    out.push({ afiliado: af, codigo: codigo, tipo: tipo, motivo: motivo, raw: line.trim() });
  });
  return out;
}
async function aplicarDebitosPami(){
  var err = document.getElementById('pamiDebitError'); err.textContent = '';
  var resEl = document.getElementById('pamiDebitResult'); resEl.textContent = '';
  var items = parsePamiValidacion(document.getElementById('pamiDebitText').value);
  if (!items.length){ err.textContent = 'No se detectaron filas de validación. Pegá las filas tal cual salen de PAMI (con afiliado y código).'; return; }
  // Umbral = estimación al 40% (el % real varía por módulo → se ajusta con
  // "Cotejar por módulo"). El motivo se guarda aparte (para la leyenda de la fila).
  function aplicarTipo(r, tipo){
    if (tipo === 'umbral'){ r.debitType = 'pay40'; r.debitAmount = 0; }
    else { r.debitType = tipo; r.debitAmount = 0; }
  }
  var rows = CLIENT_REPORT_ROWS || [];
  // Pegar la validación de PAMI es un REEMPLAZO TOTAL: el listado pegado es la
  // verdad completa, así que lo que NO está en él no vino debitado. Limpiamos
  // TODO débito anterior —la proyección automática de la regla y también los que
  // se pegaron antes— y después aplicamos solo el listado nuevo.
  var reglaAntes = 0, pegadosAntes = 0;
  rows.forEach(function(r){
    if (r.debitSource === 'regla') reglaAntes++;
    else if (r.manualDebit || r.debitSource) pegadosAntes++;
    if (r.manualDebit || r.debitSource){
      r.manualDebit = false; r.debitType = 'total'; r.debitAmount = 0;
      r.autoDebit = false; r.debitSource = ''; r.debitMotivo = '';
    }
  });
  var used = {}, aplicados = 0, sinMatch = [], umbralAplicados = 0;
  items.forEach(function(it){
    var afN = it.afiliado.replace(/\D/g, '');
    var idx = -1;
    for (var i = 0; i < rows.length; i++){
      if (used[i]) continue;
      var r = rows[i];
      var benN = String(r.benefit || '').replace(/\D/g, '');
      var matchAf = benN && (benN === afN || benN.indexOf(afN) === 0 || afN.indexOf(benN) === 0);
      if (matchAf && String(r.practiceCode || '') === it.codigo && reportBaseGross(r) > 0){ idx = i; break; }
    }
    if (idx >= 0){ used[idx] = true; rows[idx].manualDebit = true; aplicarTipo(rows[idx], it.tipo); rows[idx].debitSource = 'validacion'; rows[idx].debitMotivo = it.motivo || ''; rows[idx].autoDebit = false; aplicados++; if (it.motivo === 'umbral') umbralAplicados++; }
    else sinMatch.push(it.codigo + ' · ' + it.afiliado);
  });
  // Pegar la validación real = los débitos quedan confirmados.
  if (aplicados) CLIENT_REPORT_DEBIT_STATUS = 'confirmado';
  if (umbralAplicados) CLIENT_REPORT_COTEJO_HECHO = false;   // hay umbrales sin cotejar
  renderClientReportRows();
  updateClientReportSummary();
  saveClientReportDraft();
  // Mensaje de éxito (verde) — deja claro que se cargaron.
  var msg = '✓ Débitos cargados: se aplicaron ' + aplicados + ' de ' + items.length + ' fila' + (items.length !== 1 ? 's' : '') + ' detectada' + (items.length !== 1 ? 's' : '') + '. Quedan confirmados al guardar el reporte.';
  if (reglaAntes || pegadosAntes){
    var limpiados = [];
    if (reglaAntes) limpiados.push(reglaAntes + ' de la regla automática');
    if (pegadosAntes) limpiados.push(pegadosAntes + ' pegado' + (pegadosAntes !== 1 ? 's' : '') + ' antes');
    msg += ' (Reemplazo total: se limpiaron ' + limpiados.join(' y ') + '; ahora manda solo lo que pegaste.)';
  }
  if (sinMatch.length) msg += ' Sin match (' + sinMatch.length + '): ' + sinMatch.slice(0, 8).join(', ') + (sinMatch.length > 8 ? '…' : '');
  // Si no matcheó nada pero se limpiaron débitos anteriores (reemplazo total),
  // avisar fuerte: quedó sin débitos. Si el pegado era el equivocado, NO guardar.
  var msgVacio = (reglaAntes || pegadosAntes)
    ? '⚠ No matcheó ninguna fila del listado con la bandeja, y se limpiaron los ' + (reglaAntes + pegadosAntes) + ' débitos anteriores: el reporte quedó SIN débitos. Si el listado era el equivocado, cerrá sin guardar el reporte.'
    : 'No se aplicó ningún débito (ninguna fila matcheó con la bandeja).';
  resEl.textContent = aplicados ? msg : msgVacio;
  resEl.className = aplicados ? 'pami-ok' : 'msg err';
  // Botones: dejar claro que ya se aplicó.
  var applyBtn = document.getElementById('pamiDebitApply');
  if (applyBtn && aplicados){ applyBtn.textContent = '✓ Débitos aplicados'; applyBtn.disabled = true; applyBtn.classList.add('btn-done'); }
  var cancelBtn = document.getElementById('pamiDebitCancel');
  if (cancelBtn && aplicados) cancelBtn.textContent = 'Cerrar';
  // Alerta de umbrales: el % varía por módulo → hay que cotejar contra PAMI.
  var alerta = document.getElementById('pamiDebitUmbral');
  if (alerta){
    if (umbralAplicados){
      alerta.style.display = '';
      alerta.innerHTML = '⚠ Además, este reporte tiene <b>' + umbralAplicados + ' práctica' + (umbralAplicados !== 1 ? 's' : '') + ' con umbral</b> (aplicadas al 40% como estimación). El % real cambia por módulo — cerrá y usá <b>“Cotejar por módulo”</b> con la facturación de PAMI para ajustar.';
    } else { alerta.style.display = 'none'; }
  }
  // Sin umbrales cerramos solos; con umbrales dejamos abierto para que lea la alerta.
  if (aplicados && !sinMatch.length && !umbralAplicados) setTimeout(closePamiDebitModal, 1400);
}
function normalizeReportSearch(value){
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function getClientReportVisibleRows(){
  var q = normalizeReportSearch(CLIENT_REPORT_QUERY);
  var practiceQ = normalizeReportSearch(CLIENT_REPORT_PRACTICE_QUERY);
  var moduleValue = CLIENT_REPORT_MODULE || '';
  var transFrom = CLIENT_REPORT_TRANS_FROM || '';
  var transTo = CLIENT_REPORT_TRANS_TO || '';
  var __tmFiltro = reportTieneMotivos();   // para filtrar por categoría de débito
  var rows = (CLIENT_REPORT_ROWS || []).map(function(row, index){ return { row:row, index:index }; }).filter(function(item){
    if (q) {
      var haystack = normalizeReportSearch([
        item.row.patientName,
        item.row.benefit,
        item.row.order
      ].join(' '));
      if (haystack.indexOf(q) < 0) return false;
    }
    if (practiceQ) {
      var practiceHaystack = normalizeReportSearch([
        item.row.practiceCode,
        item.row.practiceDescription,
        item.row.practiceText
      ].join(' '));
      if (practiceHaystack.indexOf(practiceQ) < 0) return false;
    }
    if (moduleValue && String(item.row.moduleCode || '') !== moduleValue) return false;
    if (CLIENT_REPORT_STATUS){
      if (CLIENT_REPORT_STATUS.indexOf('deb:') === 0){
        // Filtro por categoría de débito (umbral / excluyente / otro).
        var __cat = CLIENT_REPORT_STATUS.slice(4);
        if (!(reportDebitAmount(item.row) > 0) || debitoCategoria(item.row, __tmFiltro) !== __cat) return false;
      } else if (reportDisplayStatus(item.row) !== CLIENT_REPORT_STATUS) return false;
    }
    var transDate = String(item.row.transmittedAt || '').slice(0, 10);
    if (transFrom && (!transDate || transDate < transFrom)) return false;
    if (transTo && (!transDate || transDate > transTo)) return false;
    if (CLIENT_REPORT_QUICK_FILTER === 'cutoff' && !item.row.outsideCutoff) return false;
    if (CLIENT_REPORT_QUICK_FILTER === 'missingInforme' && !reportMissingInforme(item.row)) return false;
    if (CLIENT_REPORT_QUICK_FILTER === 'debito' && !(reportDebitAmount(item.row) > 0)) return false;
    if (CLIENT_REPORT_QUICK_FILTER === 'facturable' && !(item.row.billable && reportBaseGross(item.row) > 0)) return false;
    if (CLIENT_REPORT_QUICK_FILTER === 'neto' && !(reportNetAmount(item.row) > 0)) return false;
    if (CLIENT_REPORT_QUICK_FILTER === 'ausentes' && !item.row.absent) return false;
    return true;
  });
  if (CLIENT_REPORT_SORT === 'practice-asc' || CLIENT_REPORT_SORT === 'practice-desc') {
    rows.sort(function(a, b){
      var av = normalizeReportSearch([a.row.practiceCode, a.row.practiceDescription, a.row.practiceText].join(' '));
      var bv = normalizeReportSearch([b.row.practiceCode, b.row.practiceDescription, b.row.practiceText].join(' '));
      var cmp = av.localeCompare(bv);
      return CLIENT_REPORT_SORT === 'practice-desc' ? -cmp : cmp;
    });
  } else if (/^(bruto|neto)-(asc|desc)$/.test(CLIENT_REPORT_SORT)) {
    var field = CLIENT_REPORT_SORT.indexOf('bruto') === 0 ? 'bruto' : 'neto';
    var desc = /-desc$/.test(CLIENT_REPORT_SORT);
    var val = function(r){ return field === 'bruto' ? reportBaseGross(r) : reportNetAmount(r); };
    rows.sort(function(a, b){ var d = val(a.row) - val(b.row); return desc ? -d : d; });
  }
  return rows;
}
function updateClientReportSummary(){
  var visible = getClientReportVisibleRows();
  var rows = visible.map(function(item){ return item.row; });
  var gross = 0, debit = 0, net = 0, cutoffNext = 0, missingInformeAmount = 0, absent = 0, absentValue = 0, outside = 0, missingInforme = 0, unmatched = 0;
  rows.forEach(function(row){
    gross += reportBaseGross(row);
    debit += reportDebitAmount(row);
    net += reportNetAmount(row);
    cutoffNext += reportCutoffNextAmount(row);
    missingInformeAmount += reportMissingInformeAmount(row);
    if (row.absent){ absent += 1; absentValue += Number(row.valueGross || 0); }
    if (row.outsideCutoff) outside += 1;
    if (reportMissingInforme(row)) missingInforme += 1;
    if (!row.matchFound && !row.valueEdited) unmatched += 1;
  });
  var cards = document.querySelectorAll('#clientReportSummary > div');
  if (cards[0]) cards[0].querySelector('b').textContent = moneyFmt(gross);
  if (cards[1]) cards[1].querySelector('b').textContent = moneyFmt(debit);
  if (cards[2]) cards[2].querySelector('b').textContent = moneyFmt(net);
  if (cards[3]) cards[3].querySelector('b').textContent = String(absent);
  var absentValueEl = document.getElementById('clientReportAbsentValue');
  if (absentValueEl) absentValueEl.textContent = absentValue > 0 ? moneyFmt(absentValue) : '';
  if (cards[4]) cards[4].querySelector('b').textContent = moneyFmt(cutoffNext);
  if (cards[5]) cards[5].querySelector('b').textContent = moneyFmt(missingInformeAmount);
  var cutoffCard = document.getElementById('clientReportCutoffCard');
  var missingCard = document.getElementById('clientReportMissingInformeCard');
  var debitCard = document.getElementById('clientReportDebitCard');
  if (cutoffCard) cutoffCard.classList.toggle('active', CLIENT_REPORT_QUICK_FILTER === 'cutoff');
  if (missingCard) missingCard.classList.toggle('active', CLIENT_REPORT_QUICK_FILTER === 'missingInforme');
  if (debitCard) debitCard.classList.toggle('active', CLIENT_REPORT_QUICK_FILTER === 'debito');
  var grossCard = document.getElementById('clientReportGrossCard');
  var netCard = document.getElementById('clientReportNetCard');
  var absentCard = document.getElementById('clientReportAbsentCard');
  if (grossCard) grossCard.classList.toggle('active', CLIENT_REPORT_QUICK_FILTER === 'facturable');
  if (netCard) netCard.classList.toggle('active', CLIENT_REPORT_QUICK_FILTER === 'neto');
  if (absentCard) absentCard.classList.toggle('active', CLIENT_REPORT_QUICK_FILTER === 'ausentes');
  // La "Diferencia" cruza SIEMPRE contra el neto TOTAL (todas las filas), no el
  // filtrado — así cambiar filtros no altera el control contra el monto esperado.
  var netoTotal = 0, dUmbral = 0, dExcl = 0, dOtros = 0, __tm = reportTieneMotivos();
  (CLIENT_REPORT_ROWS || []).forEach(function(row){
    netoTotal += reportNetAmount(row);
    if (!row.manualDebit) return;
    var deb = reportDebitAmount(row);
    if (deb <= 0) return;
    var cat = debitoCategoria(row, __tm);
    if (cat === 'umbral') dUmbral += deb; else if (cat === 'excluyente') dExcl += deb; else dOtros += deb;
  });
  updateExpectedAmountStatus(netoTotal);
  var bd = document.getElementById('clientReportDebitBreakdown');
  if (bd) bd.innerHTML = debitBreakdownHtml(dUmbral, dExcl, dOtros);
  updateCotejoPending();
  var totalRows = (CLIENT_REPORT_ROWS || []).length;
  var meta = rows.length + ' de ' + totalRows + ' practicas - ' + rows.filter(function(row){ return row.billable; }).length + ' facturables';
  if (outside) meta += ' - ' + outside + ' fuera de corte';
  if (missingInforme) meta += ' - ' + missingInforme + ' falta informe';
  if (unmatched) meta += ' - ' + unmatched + ' sin valor';
  document.getElementById('clientReportMeta').textContent = totalRows ? meta : 'Todavía no hay bandeja cargada.';
  var clearBtn = document.getElementById('clientReportClearBtn');
  if (clearBtn){
    // El tacho "descartar" solo tiene sentido en borrador/edición (tira el trabajo
    // sin guardar). En un reporte cerrado NO elimina —solo cierra la vista— así que
    // se oculta: para borrar un reporte guardado está el tacho de la fila de arriba.
    var editableNow = CLIENT_REPORT_MODE === 'draft' || CLIENT_REPORT_MODE === 'edit';
    clearBtn.style.display = editableNow ? '' : 'none';
    clearBtn.disabled = !totalRows;
  }
  updateClientReportFormState();
  var sortIcon = document.getElementById('clientReportPracticeSortIcon');
  if (sortIcon) sortIcon.textContent = CLIENT_REPORT_SORT === 'practice-desc' ? 'Z-A' : 'A-Z';
  var flecha = function(field){ return CLIENT_REPORT_SORT === field + '-asc' ? '↑' : CLIENT_REPORT_SORT === field + '-desc' ? '↓' : '↕'; };
  var bIcon = document.getElementById('clientReportBrutoSortIcon');
  if (bIcon) bIcon.textContent = flecha('bruto');
  var nIcon = document.getElementById('clientReportNetoSortIcon');
  if (nIcon) nIcon.textContent = flecha('neto');
  renderClientReportZeroCodes();
}
// Panel de códigos "sin valor": lista los códigos (no pacientes) en $0 para asignarles valor.
function renderClientReportZeroCodes(){
  var panel = document.getElementById('clientReportZeroPanel'), list = document.getElementById('clientReportZeroList');
  if (!panel || !list) return;
  var editable = CLIENT_REPORT_MODE === 'draft' || CLIENT_REPORT_MODE === 'edit';
  var map = {};
  (CLIENT_REPORT_ROWS || []).forEach(function(r){
    if (r.matchFound || r.valueEdited || !r.practiceCode) return;
    var k = String(r.practiceCode);
    if (!map[k]) map[k] = { code: k, desc: r.practiceDescription || r.practiceText || '', mc: r.moduleCode || '', md: r.moduleDescription || '', count: 0 };
    map[k].count += 1;
  });
  var codes = Object.keys(map).map(function(k){ return map[k]; });
  var cnt = document.getElementById('clientReportZeroCount'); if (cnt) cnt.textContent = codes.length;
  if (!codes.length || !editable){ panel.style.display = 'none'; return; }
  panel.style.display = '';
  list.innerHTML = codes.map(function(c){
    return '<div class="report-zero-row" data-code="' + esc(c.code) + '" data-desc="' + esc(c.desc) + '" data-mc="' + esc(c.mc) + '" data-md="' + esc(c.md) + '">'
      + '<div class="report-zero-info"><span class="nom-code">' + esc(c.code) + '</span> ' + esc(c.desc) + ' <span class="nom-muted">(' + c.count + ' paciente' + (c.count !== 1 ? 's' : '') + ')</span></div>'
      + '<div class="report-zero-assign"><input class="inp" type="number" step="0.01" min="0" placeholder="Valor $"><button class="btn btn-ghost" onclick="assignPracticeValue(this)">Asignar</button></div>'
      + '</div>';
  }).join('');
}
async function assignPracticeValue(btn){
  if (!ACTIVE_CLIENT) return;
  var rowEl = btn.closest('.report-zero-row');
  var code = rowEl.getAttribute('data-code');
  var input = rowEl.querySelector('input');
  var total = Number(String(input.value).replace(',', '.'));
  if (!(total > 0)){ input.focus(); return; }
  btn.disabled = true;
  var res = await req('POST', '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/practice-values', {
    code: code, total: total,
    practiceDescription: rowEl.getAttribute('data-desc'),
    moduleCode: rowEl.getAttribute('data-mc'), moduleDescription: rowEl.getAttribute('data-md')
  });
  btn.disabled = false;
  if (!res.ok){ nsAlert((res.data && res.data.error) || 'No se pudo guardar el valor.'); return; }
  (CLIENT_REPORT_ROWS || []).forEach(function(r){
    if (String(r.practiceCode) === code && !r.matchFound && !r.valueEdited){
      // OJO: no tocar r.billable. Viene bien del parser (false para ausentes /
      // no transmitidas). Ponerlo en true acá contaba prácticas ausentes.
      r.valueGross = total; r.matchFound = true; r.valueSourceCode = code;
    }
  });
  renderClientReportRows(); updateClientReportSummary(); saveClientReportDraft();
}
// Ordena por valor $ (menor↔mayor). Primer click = menor a mayor.
function toggleClientReportValueSort(field){
  CLIENT_REPORT_SORT = CLIENT_REPORT_SORT === field + '-asc' ? field + '-desc' : field + '-asc';
  renderClientReportRows();
}
// El área de trabajo (form + resumen + tabla) solo se ve con un reporte activo.
function updateReportWorkArea(){
  var work = document.getElementById('clientReportWork');
  if (!work) return;
  var activo = ['draft', 'edit', 'closed'].indexOf(CLIENT_REPORT_MODE) >= 0 && (CLIENT_REPORT_ROWS || []).length > 0;
  work.style.display = activo ? '' : 'none';
}
function renderClientReportRows(){
  updateReportWorkArea();
  var body = document.getElementById('clientReportBody');
  if (!body) return;
  if (!CLIENT_REPORT_ROWS.length){
    body.innerHTML = '<tr><td colspan="7" class="muted-cell">No hay datos cargados.</td></tr>';
    updateClientReportSummary();
    return;
  }
  var visible = getClientReportVisibleRows();
  if (!visible.length){
    body.innerHTML = '<tr><td colspan="7" class="muted-cell">No hay resultados para esa búsqueda.</td></tr>';
    updateClientReportSummary();
    return;
  }
  // Con reportes grandes (miles de filas), armar toda la tabla de una congela el
  // hilo ~1s en cada re-render. Mostramos solo las primeras N y dejamos "ver todas".
  // Los totales/summary igual se calculan sobre TODAS las filas visibles.
  var LIMIT = 250;
  var capado = !CLIENT_REPORT_SHOW_ALL && visible.length > LIMIT;
  var mostrar = capado ? visible.slice(0, LIMIT) : visible;
  var htmlFilas = mostrar.map(function(item){
    var row = item.row;
    var idx = item.index;
    var readOnly = CLIENT_REPORT_MODE === 'closed';
    var disabled = (readOnly || reportBaseGross(row) <= 0) ? ' disabled' : '';
    var checked = row.manualDebit ? ' checked' : '';
    var type = row.debitType || 'total';
    if (type === 'partial'){ var pn = reportNetAmount(row), pg = reportBaseGross(row); type = pn >= pg * 0.7 ? 'pay80' : pn >= pg * 0.5 ? 'pay60' : 'pay40'; }
    var badgeClass = row.billable ? 'ok' : (row.absent || reportMissingInforme(row) ? 'warn' : 'muted');
    var valueSource = row.valueSourceCode && row.valueSourceCode !== row.practiceCode ? '<br>Valor segun ' + esc(row.valueSourceCode) : '';
    var valueNote = row.valueEdited ? '<div class="nom-muted">Editado manual</div>' : (readOnly ? '' : '<div class="nom-muted">Doble click</div>');
    var valueDblClick = readOnly ? '' : ' ondblclick="editReportValue(' + idx + ')"';
    var autoDebitNote = '';
    if (row.debitSource === 'validacion'){
      var mot = motivoDebitoLabel(row.debitMotivo);
      autoDebitNote = '<div class="nom-muted auto-debit-note">✓ Validación PAMI' + (mot ? ' · <b class="debit-motivo">' + esc(mot) + '</b>' : '') + '</div>';
    }
    else if (row.autoDebit) autoDebitNote = '<div class="nom-muted auto-debit-note" title="' + esc(row.autoDebitReason || '') + '">Regla automática</div>';
    else if (row.debitWarning) autoDebitNote = '<div class="debit-warning-note">⚠ ' + esc(row.debitWarning) + '</div>';
    return '<tr data-report-row="' + idx + '">'
      + '<td><div class="nom-code">' + esc(row.patientName || '-') + '</div><div class="nom-muted">' + esc(row.benefit || '') + '<br>OME ' + esc(row.order || '-') + '</div></td>'
      + '<td><div class="nom-practice-line"><span class="nom-code">' + esc(row.practiceCode || '-') + '</span><span class="nom-desc">' + esc(row.practiceDescription || row.practiceText || '') + '</span></div><div class="nom-muted">' + esc(row.moduleCode || '') + ' ' + esc(row.moduleDescription || '') + valueSource + '</div></td>'
      + '<td><div>' + esc(row.appointmentLabel || '-') + '</div><div class="nom-muted">Transm. ' + esc(row.transmittedLabel || '-') + '</div></td>'
      + '<td><span class="report-status ' + badgeClass + '">' + esc(reportDisplayStatus(row)) + '</span></td>'
      + '<td class="nom-money report-value-cell"' + valueDblClick + '><b>' + esc(moneyFmt(reportBaseGross(row))) + '</b>' + valueNote + '</td>'
      + '<td><div class="debit-controls"><label class="debit-check"><input type="checkbox" onchange="toggleReportDebit(' + idx + ', this.checked)"' + checked + disabled + '> Debito</label><select class="inp" onchange="setReportDebitType(' + idx + ', this.value)"' + disabled + '><option value="total"' + (type === 'total' ? ' selected' : '') + '>Total</option><option value="pay40"' + (type === 'pay40' ? ' selected' : '') + '>40%</option><option value="pay60"' + (type === 'pay60' ? ' selected' : '') + '>60%</option><option value="pay80"' + (type === 'pay80' ? ' selected' : '') + '>80%</option></select></div>' + autoDebitNote + '</td>'
      + '<td class="nom-money"><b>' + esc(moneyFmt(reportNetAmount(row))) + '</b></td>'
      + '</tr>';
  }).join('');
  if (capado){
    htmlFilas += '<tr class="report-more-row"><td colspan="7">Mostrando <b>' + LIMIT + '</b> de <b>' + visible.length + '</b> prácticas (los totales de arriba sí incluyen todas). Buscá o filtrá para encontrar una en particular, o <button type="button" class="report-more-btn" onclick="mostrarTodasLasPracticas()">ver todas</button> <span class="nom-muted">(puede tardar un momento)</span>.</td></tr>';
  }
  body.innerHTML = htmlFilas;
  updateClientReportSummary();
}
function mostrarTodasLasPracticas(){ CLIENT_REPORT_SHOW_ALL = true; renderClientReportRows(); }
// Desde el cotejo: filtra la tabla al módulo tocado y cierra el modal.
function cotejoIrAModulo(mod){
  var sel = document.getElementById('clientReportModuleFilter');
  if (sel) sel.value = mod;
  setClientReportModuleFilter(mod);
  closeCotejoModal();
  var tabla = document.getElementById('clientReportBody');
  if (tabla && tabla.scrollIntoView) tabla.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function renderClientReportModuleFilter(){
  var el = document.getElementById('clientReportModuleFilter');
  if (!el) return;
  var modules = {};
  (CLIENT_REPORT_ROWS || []).forEach(function(row){
    var code = String(row.moduleCode || '').trim();
    if (!code) return;
    modules[code] = (code + ' - ' + (row.moduleDescription || 'Sin descripcion')).trim();
  });
  var current = CLIENT_REPORT_MODULE;
  var options = Object.keys(modules).sort(function(a,b){ return Number(a) - Number(b) || a.localeCompare(b); }).map(function(code){
    return '<option value="' + esc(code) + '">' + esc(modules[code]) + '</option>';
  }).join('');
  el.innerHTML = '<option value="">Todos los módulos</option>' + options;
  if (current && modules[current]) el.value = current;
  else {
    CLIENT_REPORT_MODULE = '';
    el.value = '';
  }
}
function setClientReportSearch(value){
  CLIENT_REPORT_QUERY = value || '';
  renderClientReportRows();
}
function setClientReportPracticeFilter(value){
  CLIENT_REPORT_PRACTICE_QUERY = value || '';
  renderClientReportRows();
}
function setClientReportModuleFilter(value){
  CLIENT_REPORT_MODULE = value || '';
  renderClientReportRows();
}
function setClientReportStatusFilter(value){
  CLIENT_REPORT_STATUS = value || '';
  renderClientReportRows();
}
function renderClientReportStatusFilter(){
  var el = document.getElementById('clientReportStatusFilter');
  if (!el) return;
  var estados = {};
  var tm = reportTieneMotivos();
  var catCount = { umbral:0, excluyente:0, otro:0 };
  (CLIENT_REPORT_ROWS || []).forEach(function(row){
    var s = reportDisplayStatus(row); if (s && s !== '-') estados[s] = true;
    if (reportDebitAmount(row) > 0){ var c = debitoCategoria(row, tm); if (c in catCount) catCount[c]++; }
  });
  var current = CLIENT_REPORT_STATUS;
  var options = Object.keys(estados).sort().map(function(s){ return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
  // Filtrar por categoría de débito (mismo desglose que la tarjeta de Débitos).
  var etq = { umbral:'Umbrales', excluyente:'Excluyentes', otro:'Otros' };
  var debOpts = '';
  ['umbral','excluyente','otro'].forEach(function(c){ if (catCount[c]) debOpts += '<option value="deb:' + c + '">' + etq[c] + ' (' + catCount[c] + ')</option>'; });
  el.innerHTML = '<option value="">Todos los estados</option>' + options
    + (debOpts ? '<optgroup label="Débitos">' + debOpts + '</optgroup>' : '');
  var vigente = !current || estados[current] || (current.indexOf('deb:') === 0 && catCount[current.slice(4)]);
  if (vigente) el.value = current;
  else { CLIENT_REPORT_STATUS = ''; el.value = ''; }
}
function toggleClientReportPracticeSort(){
  CLIENT_REPORT_SORT = CLIENT_REPORT_SORT === 'practice-asc' ? 'practice-desc' : 'practice-asc';
  renderClientReportRows();
}
function setClientReportTransmissionFilter(){
  var from = document.getElementById('clientReportTransFrom');
  var to = document.getElementById('clientReportTransTo');
  CLIENT_REPORT_TRANS_FROM = from ? from.value : '';
  CLIENT_REPORT_TRANS_TO = to ? to.value : '';
  renderClientReportRows();
}
function setClientReportQuickFilter(value){
  CLIENT_REPORT_QUICK_FILTER = CLIENT_REPORT_QUICK_FILTER === value ? '' : value;
  renderClientReportRows();
}
function handleReportSummaryCardKey(event, value){
  if (!event || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  setClientReportQuickFilter(value);
}
function setClientReportExpectedAmount(value){
  CLIENT_REPORT_EXPECTED_AMOUNT = value || '';
  updateClientReportSummary();
  saveClientReportDraft();
}
function resetClientReportFilters(){
  CLIENT_REPORT_QUERY = '';
  CLIENT_REPORT_PRACTICE_QUERY = '';
  CLIENT_REPORT_MODULE = '';
  CLIENT_REPORT_TRANS_FROM = '';
  CLIENT_REPORT_TRANS_TO = '';
  CLIENT_REPORT_QUICK_FILTER = '';
  var search = document.getElementById('clientReportSearch');
  if (search) search.value = '';
  var practice = document.getElementById('clientReportPracticeFilter');
  if (practice) practice.value = '';
  renderClientReportModuleFilter();
  renderClientReportStatusFilter();
  var from = document.getElementById('clientReportTransFrom');
  if (from) from.value = '';
  var to = document.getElementById('clientReportTransTo');
  if (to) to.value = '';
}
function setClientReportExpectedInput(value){
  CLIENT_REPORT_EXPECTED_AMOUNT = value || '';
  var input = document.getElementById('clientReportExpectedAmount');
  if (input) input.value = value || '';
}
function setClientReportObservationsInput(value){
  CLIENT_REPORT_OBSERVATIONS = value || '';
  var input = document.getElementById('clientReportObservations');
  if (input) input.value = value || '';
}
function setClientReportObservations(value){
  CLIENT_REPORT_OBSERVATIONS = value || '';
  saveClientReportDraft();
}
async function editReportValue(index){
  if (CLIENT_REPORT_MODE === 'closed') return;
  var row = CLIENT_REPORT_ROWS[index];
  if (!row) return;
  var current = Number(row.valueGross || 0);
  var entered = await nsPrompt('Nuevo valor bruto para esta práctica', { titulo:'Editar valor', valor: current ? String(current).replace('.', ',') : '', okLabel:'Guardar' });
  if (entered === null) return;
  var next = parseMoneyInput(entered);
  if (next < 0) next = 0;
  row.valueGross = next;
  row.valueBillable = row.billable ? next : 0;
  row.valueEdited = true;
  if (next > 0) row.matchFound = true;
  row.debitAmount = 0;
  renderClientReportRows();
  saveClientReportDraft();
}
function restoreClientReportDraft(){
  if (!ACTIVE_CLIENT || CLIENT_REPORT_MODE === 'draft') return;
  var key = clientReportDraftKey();
  if (!key) return;
  var raw = '';
  try { raw = localStorage.getItem(key) || ''; } catch (e) {}
  if (!raw) return;
  var draft = null;
  try { draft = JSON.parse(raw); } catch (e) { return; }
  if (!draft || !Array.isArray(draft.rows) || !draft.rows.length) return;
  CLIENT_REPORT_ROWS = draft.rows;
  CLIENT_REPORT_MODE = draft.mode === 'edit' && draft.reportId ? 'edit' : 'draft';
  CLIENT_REPORT_ID = draft.reportId || '';
  CLIENT_REPORT_SOURCE = draft.source || null;
  CLIENT_REPORT_FILE = null;
  renderClientReportModuleFilter();
  renderClientReportStatusFilter();
  resetClientReportFilters();
  setClientReportExpectedInput(draft.expectedAmount || '');
  setClientReportObservationsInput(draft.observations || '');
  var title = document.getElementById('clientReportTitle');
  if (title) title.value = draft.title || '';
  var periodSelect = document.getElementById('clientReportPeriod');
  if (periodSelect && CLIENT_REPORT_SOURCE && CLIENT_REPORT_SOURCE.nomencladorPeriod) periodSelect.value = CLIENT_REPORT_SOURCE.nomencladorPeriod;
  var st = document.getElementById('clientReportStatus');
  if (st) st.textContent = CLIENT_REPORT_MODE === 'edit' ? 'Edición restaurada. Guardá cambios para cerrar el reporte.' : 'Borrador restaurado. Para cambiar el nomenclador, volvé a adjuntar la bandeja.';
  renderClientReportRows();
}
function clearClientReport(){
  CLIENT_REPORT_ROWS = [];
  CLIENT_REPORT_MODE = '';
  CLIENT_REPORT_ID = '';
  CLIENT_REPORT_DEBIT_STATUS = '';
  CLIENT_REPORT_COTEJO_HECHO = false;
  CLIENT_REPORT_SHOW_ALL = false;
  CLIENT_REPORT_SOURCE = null;
  CLIENT_REPORT_FILE = null;
  resetClientReportFilters();
  setClientReportExpectedInput('');
  setClientReportObservationsInput('');
  var title = document.getElementById('clientReportTitle');
  if (title) title.value = '';
  var st = document.getElementById('clientReportStatus');
  if (st) st.textContent = 'Visualizacion cerrada.';
  renderClientReportRows();
}
function discardClientReportDraft(){
  removeClientReportDraft();
  clearClientReport();
  var st = document.getElementById('clientReportStatus');
  if (st) st.textContent = 'Borrador descartado.';
}
function closeClientReportView(){
  if (CLIENT_REPORT_MODE !== 'closed') return;
  clearClientReport();
  var st = document.getElementById('clientReportStatus');
  if (st) st.textContent = 'Visualizacion cerrada. El reporte guardado sigue disponible en la lista.';
  renderSavedClientReports();
}
function toggleReportDebit(index, checked){
  if (CLIENT_REPORT_MODE === 'closed') return;
  var row = CLIENT_REPORT_ROWS[index];
  if (!row) return;
  row.manualDebit = checked;
  row.debitSource = checked ? 'manual' : '';
  if (checked && !row.debitType) row.debitType = 'total';
  if (!checked) {
    row.autoDebit = false;
    row.autoDebitReason = '';
    row.autoDebitPairCode = '';
    row.autoDebitRulePage = '';
    row.autoDebitRuleCodes = '';
  }
  renderClientReportRows();
  saveClientReportDraft();
}
function setReportDebitType(index, value){
  if (CLIENT_REPORT_MODE === 'closed') return;
  var row = CLIENT_REPORT_ROWS[index];
  if (!row) return;
  row.manualDebit = true;
  if (row.debitSource !== 'validacion') row.debitSource = 'manual';
  row.debitType = (value === 'pay40' || value === 'pay60' || value === 'pay80') ? value : 'total';
  row.debitAmount = 0;
  renderClientReportRows();
  saveClientReportDraft();
}
async function saveClientReport(){
  if (!ACTIVE_CLIENT || !CLIENT_REPORT_ROWS.length || (CLIENT_REPORT_MODE !== 'draft' && CLIENT_REPORT_MODE !== 'edit')) return;
  var btn = document.getElementById('clientReportSaveBtn');
  var st = document.getElementById('clientReportStatus');
  if (btn) btn.disabled = true;
  if (st) st.textContent = CLIENT_REPORT_MODE === 'edit' ? 'Guardando cambios...' : 'Guardando reporte...';
  var payload = {
    rows: CLIENT_REPORT_ROWS,
    title: (document.getElementById('clientReportTitle') || {}).value || '',
    expectedAmount: parseMoneyInput(CLIENT_REPORT_EXPECTED_AMOUNT),
    observations: getClientReportObservationsValue(),
    sourceFilename: CLIENT_REPORT_SOURCE && CLIENT_REPORT_SOURCE.filename,
    nomencladorPeriod: CLIENT_REPORT_SOURCE && CLIENT_REPORT_SOURCE.nomencladorPeriod,
    nomencladorLabel: CLIENT_REPORT_SOURCE && CLIENT_REPORT_SOURCE.nomencladorLabel
  };
  if (CLIENT_REPORT_DEBIT_STATUS) payload.debitStatus = CLIENT_REPORT_DEBIT_STATUS;
  var path = '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/reportes';
  var method = 'POST';
  if (CLIENT_REPORT_MODE === 'edit' && CLIENT_REPORT_ID) {
    path += '/' + encodeURIComponent(CLIENT_REPORT_ID);
    method = 'PUT';
  }
  var res = await req(method, path, payload);
  // Guardia anti-duplicado: si el período (por las fechas) ya tiene un reporte
  // confirmado con débitos, avisar antes de crear un duplicado que lo tape.
  if (!res.ok && res.data && res.data.avisoDuplicado){
    var a = res.data.avisoDuplicado;
    var seguir = await nsConfirm('Ya hay un reporte CONFIRMADO de ' + a.periodLabel + ' con débitos por ' + moneyFmt(a.existente.debito) + ' ("' + a.existente.title + '").\n\nEste reporte que estás cerrando tiene datos de ESE MISMO mes (por las fechas de los turnos). Si lo cerrás igual, va a quedar como DUPLICADO y puede TAPAR los débitos confirmados del otro en el dashboard.', { titulo:'⚠ Posible duplicado', okLabel:'Cerrar igual', cancelLabel:'No cerrar' });
    if (!seguir){ if (st) st.textContent = 'Cancelado: ya hay un reporte confirmado de ' + a.periodLabel + '.'; updateClientReportSummary(); return; }
    res = await req(method, path + (path.indexOf('?') >= 0 ? '&' : '?') + 'force=1', payload);
  }
  if (!res.ok){
    if (st) st.textContent = (res.data && res.data.error) || 'No se pudo guardar el reporte.';
    updateClientReportSummary();
    return;
  }
  removeClientReportDraft();
  clearClientReport();
  if (st) st.textContent = method === 'PUT' ? 'Cambios guardados y reporte cerrado.' : 'Reporte guardado y cerrado.';
  await loadClientReports();
  await loadClientDashboard();
}
async function openClientReport(id){
  if (!ACTIVE_CLIENT || !id) return;
  CLIENT_REPORT_SHOW_ALL = false;
  var st = document.getElementById('clientReportStatus');
  if (st) st.textContent = 'Abriendo reporte cerrado...';
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/reportes/' + encodeURIComponent(id));
  if (!res.ok){
    if (st) st.textContent = res.data.error || 'No se pudo abrir el reporte.';
    return;
  }
  var report = res.data.report || {};
  CLIENT_REPORT_ROWS = report.rows || [];
  CLIENT_REPORT_MODE = 'closed';
  CLIENT_REPORT_ID = report.id || id;
  CLIENT_REPORT_SOURCE = {
    filename: report.sourceFilename || '',
    nomencladorPeriod: report.nomencladorPeriod || '',
    nomencladorLabel: report.nomencladorLabel || ''
  };
  renderClientReportModuleFilter();
  renderClientReportStatusFilter();
  resetClientReportFilters();
  setClientReportExpectedInput(report.expectedAmount ? String(report.expectedAmount).replace('.', ',') : '');
  setClientReportObservationsInput(report.observations || '');
  var title = document.getElementById('clientReportTitle');
  if (title) title.value = report.title || '';
  // Sincronizar el desplegable de nomenclador con el del reporte (si no, queda
  // mostrando el que había de antes, aunque el reporte se guardó con otro).
  var periodSelect = document.getElementById('clientReportPeriod');
  if (periodSelect && CLIENT_REPORT_SOURCE.nomencladorPeriod) periodSelect.value = CLIENT_REPORT_SOURCE.nomencladorPeriod;
  if (st) st.textContent = 'Viendo reporte cerrado: ' + (report.title || report.sourceFilename || report.id);
  renderClientReportRows();
}
function unlockClientReport(){
  if (CLIENT_REPORT_MODE !== 'closed' || !CLIENT_REPORT_ROWS.length || !CLIENT_REPORT_ID) return;
  CLIENT_REPORT_MODE = 'edit';
  var st = document.getElementById('clientReportStatus');
  if (st) st.textContent = 'Reporte desbloqueado para editar. Guarda cambios para volver a cerrarlo.';
  renderClientReportRows();
  saveClientReportDraft();
}
async function changeClientReportPeriod(){
  if (CLIENT_REPORT_MODE === 'closed') {
    var closedStatus = document.getElementById('clientReportStatus');
    if (closedStatus) closedStatus.textContent = 'Este reporte ya está cerrado; el nomenclador no se recalcula.';
    return;
  }
  if (CLIENT_REPORT_MODE === 'edit') {
    var editStatus = document.getElementById('clientReportStatus');
    if (editStatus) editStatus.textContent = 'En una edicion de reporte viejo no se recalcula el nomenclador. Carga una bandeja nueva para rehacerlo.';
    return;
  }
  if (!CLIENT_REPORT_ROWS.length) return;
  if (!CLIENT_REPORT_FILE) {
    var emptyStatus = document.getElementById('clientReportStatus');
    if (emptyStatus) emptyStatus.textContent = 'Volve a adjuntar la bandeja para recalcular con otro nomenclador. El borrador no se perdio.';
    return;
  }
  await uploadClientReport([CLIENT_REPORT_FILE], { keepFile:true });
}
// Sugiere "Reporte <Mes> <Cliente>" con el mes más frecuente de los turnos.
function sugerirNombreReporte(){
  var meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  var cnt = {};
  (CLIENT_REPORT_ROWS || []).forEach(function(r){
    var p = String(r.period || r.appointmentAt || '').slice(0, 7);
    var m = p.slice(5, 7);
    if (/^\d{2}$/.test(m)) cnt[m] = (cnt[m] || 0) + 1;
  });
  var best = '', max = 0;
  Object.keys(cnt).forEach(function(m){ if (cnt[m] > max){ max = cnt[m]; best = m; } });
  var mesNombre = best ? (meses[parseInt(best, 10) - 1] || '') : '';
  var cliente = (ACTIVE_CLIENT && ACTIVE_CLIENT.name) || '';
  return ('Reporte ' + (mesNombre ? mesNombre + ' ' : '') + cliente).replace(/\s+/g, ' ').trim();
}
async function uploadClientReport(files){
  if (!files || !files[0] || !ACTIVE_CLIENT) return;
  CLIENT_REPORT_SHOW_ALL = false;
  CLIENT_REPORT_FILE = files[0];
  var wasClosed = CLIENT_REPORT_MODE === 'closed';
  var st = document.getElementById('clientReportStatus');
  st.textContent = 'Procesando bandeja...';
  setReportUploading(true, 'Procesando “' + (files[0].name || 'bandeja') + '”… puede tardar unos segundos.');
  var period = document.getElementById('clientReportPeriod').value || '';
  var form = new FormData();
  form.append('file', files[0]);
  var res, data = {};
  try {
    res = await fetch('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/reportes/preview' + (period ? '?period=' + encodeURIComponent(period) : ''), { method:'POST', body:form });
    try { data = await res.json(); } catch (e) {}
  } catch (e) { setReportUploading(false); st.textContent = 'No se pudo procesar la bandeja (error de red).'; return; }
  if (!res.ok){
    setReportUploading(false);
    st.textContent = data.error || 'No se pudo procesar la bandeja.';
    return;
  }
  var previousById = {};
  (CLIENT_REPORT_ROWS || []).forEach(function(row){ previousById[row.id] = row; });
  CLIENT_REPORT_ROWS = (data.rows || []).map(function(row){
    var prev = previousById[row.id];
    row.manualDebit = prev ? !!prev.manualDebit : !!row.manualDebit;
    row.debitType = prev ? (prev.debitType || 'total') : (row.debitType || 'total');
    row.debitAmount = prev ? (prev.debitAmount || 0) : '';
    if (prev) {
      row.autoDebit = !!prev.autoDebit;
      row.autoDebitReason = prev.autoDebitReason || '';
      row.autoDebitPairCode = prev.autoDebitPairCode || '';
      row.autoDebitRulePage = prev.autoDebitRulePage || '';
      row.autoDebitRuleCodes = prev.autoDebitRuleCodes || '';
    }
    if (prev && prev.valueEdited) {
      row.valueGross = prev.valueGross;
      row.valueBillable = row.billable ? prev.valueGross : 0;
      row.valueEdited = true;
      row.matchFound = true;
    }
    return row;
  });
  CLIENT_REPORT_MODE = 'draft';
  CLIENT_REPORT_ID = '';
  CLIENT_REPORT_SOURCE = {
    filename: data.filename || '',
    nomencladorPeriod: data.nomencladorPeriod || '',
    nomencladorLabel: data.nomencladorLabel || ''
  };
  var periodSelect = document.getElementById('clientReportPeriod');
  if (periodSelect && data.nomencladorPeriod && [].slice.call(periodSelect.options).some(function(option){ return option.value === data.nomencladorPeriod; })) {
    periodSelect.value = data.nomencladorPeriod;
  }
  renderClientReportModuleFilter();
  renderClientReportStatusFilter();
  resetClientReportFilters();
  if (wasClosed) setClientReportExpectedInput('');
  if (wasClosed) setClientReportObservationsInput('');
  var title = document.getElementById('clientReportTitle');
  // Sugerir un nombre si el campo está vacío (o venía de un reporte cerrado):
  // "Reporte <Mes de los turnos> <Cliente>".
  if (title && (wasClosed || !title.value.trim())) title.value = sugerirNombreReporte();
  st.textContent = data.filename + ' - ' + data.rowCount + ' practicas - nomenclador ' + data.nomencladorLabel;
  renderClientReportRows();
  saveClientReportDraft();
  setReportUploading(false);
}
function setReportUploading(on, text){
  var box = document.getElementById('clientReportUploading');
  if (box) box.style.display = on ? '' : 'none';
  var t = document.getElementById('clientReportUploadingText');
  if (t && text) t.textContent = text;
}
function setDefaultUploadPeriod(){
  var el = document.getElementById('nomUploadPeriod');
  if (!el) return;
  el.value = '';
}
// ===== Calculadora de proyecciones (pestaña de Nomencladores) =====
var CALC = { data:null, items:[], saved:[], loaded:false, wired:false };
function calcMoney(n){ try{ return Number(n||0).toLocaleString('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:2,maximumFractionDigits:2}); }catch(e){ return '$ '+(Number(n)||0).toFixed(2); } }
function switchNomTab(which){
  var buscar = which!=='calc';
  var tb=document.getElementById('nom-tab-buscar'), tc=document.getElementById('nom-tab-calc');
  if(tb) tb.style.display = buscar?'':'none';
  if(tc) tc.style.display = buscar?'none':'';
  var bb=document.getElementById('nomTabBuscarBtn'), cb=document.getElementById('nomTabCalcBtn');
  if(bb) bb.classList.toggle('active', buscar);
  if(cb) cb.classList.toggle('active', !buscar);
  // El header del nomenclador (nombre del archivo + "Adjuntar Excel") es para
  // administrar el nomenclador; en la Calculadora no va, se esconde.
  var ns=document.getElementById('nomStatus'); if(ns) ns.style.display = buscar?'':'none';
  if(!buscar) loadCalcData();   // recarga con el nomenclador elegido en ese momento
}
function calcWire(){
  if(CALC.wired) return; CALC.wired=true;
  document.getElementById('calcMod').addEventListener('change', function(){
    var f=document.getElementById('calcCodFiltro'); if(f) f.value='';   // módulo nuevo, filtro limpio
    calcFillCods();
  });
  document.getElementById('calcCod').addEventListener('change', calcPreview);
  document.getElementById('calcSoloPract').addEventListener('change', calcFillCods);
  document.getElementById('calcCodFiltro').addEventListener('input', calcFillCods);
  document.getElementById('calcAdd').addEventListener('click', calcAdd);
  ['calcPctIB','calcPctGan','calcPctOtros','calcIB','calcGan','calcOtros'].forEach(function(id){
    var el=document.getElementById(id); el.addEventListener('input',calcCalc); el.addEventListener('change',calcCalc);
  });
  document.getElementById('calcSave').addEventListener('click', calcGuardar);
  document.getElementById('calcDownload').addEventListener('click', calcDescargar);
  document.getElementById('calcClear').addEventListener('click', function(){ CALC.saved=[]; calcPersistSaved(); calcRenderSaved(); });
  // "Limpiar todo" de la proyección en curso (no de las guardadas): si agregaste
  // un modulo entero por error (pueden ser 100+ practicas), borrar una por una
  // no es viable - se pide confirmacion porque es irreversible.
  document.getElementById('calcClearItems').addEventListener('click', async function(){
    if(!CALC.items.length) return;
    if(!await nsConfirm('Se vacía toda la proyección actual (' + CALC.items.length + ' práctica' + (CALC.items.length!==1?'s':'') + '). No se puede deshacer.', { titulo:'Vaciar proyección', okLabel:'Vaciar', peligro:true })) return;
    CALC.items=[]; calcRender();
  });
  var sr=document.getElementById('calcSearch');
  sr.addEventListener('input', calcSearchDo);
  sr.addEventListener('keydown', function(e){ if(e.key==='Escape') calcCloseSearch(); });
  document.addEventListener('click', function(e){
    var box=document.getElementById('calcSearchResults'), inp=document.getElementById('calcSearch');
    if(box && box.style.display!=='none' && !box.contains(e.target) && e.target!==inp) calcCloseSearch();
  });
}
function calcNorm(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase(); }
function calcBuildIndex(){
  CALC.index=[];
  (CALC.data.modulos||[]).forEach(function(m){ (m.practicas||[]).forEach(function(p){
    CALC.index.push({mod:m.code,modDesc:m.desc,cod:p.cod,desc:p.desc,valor:p.valor,consulta:p.consulta,
      excluye:p.excluye||[], _h:calcNorm(p.cod+' '+p.desc+' '+m.desc)});
  }); });
}
function calcCloseSearch(){ var r=document.getElementById('calcSearchResults'); if(r){ r.style.display='none'; r.innerHTML=''; } }
function calcSearchDo(){
  var txt=document.getElementById('calcSearch').value.trim(), q=calcNorm(txt), box=document.getElementById('calcSearchResults');
  if(q.length<2){ calcCloseSearch(); return; }
  var terms=q.split(/\s+/);
  var hits=(CALC.index||[]).filter(function(x){ return terms.every(function(t){ return x._h.indexOf(t)>=0; }); }).slice(0,15);
  if(!hits.length){ box.innerHTML='<div class="calc-sr-empty">Sin resultados para "'+esc(txt)+'"</div>'; box.style.display=''; return; }
  box.innerHTML=hits.map(function(x){
    var tag=x.consulta?'<span class="calc-sr-tag">consulta</span>':'';
    var warn=(x.excluye&&x.excluye.length)?'<span class="calc-sr-warn">⚠ excl.</span>':'';
    return '<div class="calc-sr-item" data-cod="'+esc(x.cod)+'" data-mod="'+esc(x.mod)+'">'+
      '<div class="calc-sr-main"><b>'+esc(x.cod)+'</b> '+tag+' '+warn+'<div class="d">'+esc(x.desc)+'</div><div class="m">'+esc(x.mod)+' · '+esc(x.modDesc)+'</div></div>'+
      '<div class="calc-sr-val">'+calcMoney(x.valor)+'</div></div>';
  }).join('');
  box.style.display='';
  box.querySelectorAll('.calc-sr-item').forEach(function(el){ el.addEventListener('click',function(){ calcAddFromSearch(this.dataset.mod, this.dataset.cod); }); });
}
function calcAddFromSearch(mcode, cod){
  var m=(CALC.data.modulos||[]).filter(function(x){return x.code===mcode;})[0]; if(!m) return;
  var p=m.practicas.filter(function(x){return x.cod===cod;})[0]; if(!p) return;
  calcAgregar(m.code, m.desc, p); calcRender();
  document.getElementById('calcSearch').value=''; calcCloseSearch();
}
async function loadCalcData(){
  calcWire();
  var period = (document.getElementById('nomPeriod')||{}).value || '';
  var res = await api('/api/nomencladores/calc-data' + (period?('?period='+encodeURIComponent(period)):''));
  if(!res.ok){ return; }
  CALC.data = res.data; CALC.loaded = true;
  var lab=document.getElementById('calcNomLabel'); if(lab) lab.textContent = res.data.label || '';
  var noNom=document.getElementById('calcNoNom'), grid=document.getElementById('calcGrid');
  if(!(res.data.modulos||[]).length){ if(noNom) noNom.style.display=''; if(grid) grid.style.display='none'; return; }
  if(noNom) noNom.style.display='none'; if(grid) grid.style.display='';
  try{ CALC.saved = JSON.parse(localStorage.getItem('ns-calc-saved')||'[]'); }catch(e){ CALC.saved=[]; }
  calcBuildIndex(); calcFillMods(); calcRenderSaved();
}
function calcModObj(){ var c=document.getElementById('calcMod').value; return (CALC.data.modulos||[]).filter(function(m){return m.code===c;})[0]; }
function calcVisibles(m){ var solo=document.getElementById('calcSoloPract').checked; return (m?m.practicas:[]).filter(function(p){ return !(solo && p.consulta); }); }
function calcFillMods(){
  var s=document.getElementById('calcMod'); s.innerHTML='';
  (CALC.data.modulos||[]).forEach(function(m){ var o=document.createElement('option'); o.value=m.code; o.textContent=(m.code||'—')+' · '+m.desc; s.appendChild(o); });
  calcFillCods();
}
function calcFillCods(){
  var m=calcModObj(), s=document.getElementById('calcCod'); s.innerHTML='';
  var vs=calcVisibles(m);
  var all=document.createElement('option'); all.value='__all__'; all.textContent='★ Agregar TODAS las prácticas del módulo ('+vs.length+')'; s.appendChild(all);
  // Filtro dentro del módulo (algunos tienen 40+ prácticas): "Agregar TODAS"
  // arriba sigue contando el módulo entero - el filtro solo achica cuáles se
  // listan abajo para elegir una puntual más rápido.
  var qEl=document.getElementById('calcCodFiltro'), q=qEl?calcNorm(qEl.value.trim()):'';
  var listadas=q?vs.filter(function(p){ return calcNorm(p.cod+' '+p.desc).indexOf(q)>=0; }):vs;
  listadas.forEach(function(p){ var o=document.createElement('option'); o.value=p.cod; o.textContent=p.cod+' · '+p.desc+(p.excluye&&p.excluye.length?'  ⚠ excluyente':''); s.appendChild(o); });
  if(q && !listadas.length){ var vacio=document.createElement('option'); vacio.disabled=true; vacio.textContent='(sin resultados para "'+qEl.value.trim()+'")'; s.appendChild(vacio); }
  calcPreview();
}
function calcPracActual(){ var m=calcModObj(); var c=document.getElementById('calcCod').value; return m&&m.practicas.filter(function(p){return p.cod===c;})[0]; }
function calcPreview(){
  var sel=document.getElementById('calcCod').value, prev=document.getElementById('calcPreview'), btn=document.getElementById('calcAdd');
  if(sel==='__all__'){ var vs=calcVisibles(calcModObj()), suma=vs.reduce(function(s,p){return s+p.valor;},0); prev.textContent='Agrega '+vs.length+' · '+calcMoney(suma); btn.disabled=!vs.length; return; }
  var p=calcPracActual(); prev.textContent=p?'Valoriza '+calcMoney(p.valor):''; btn.disabled=!p;
}
function calcAgregar(mcode,mdesc,p){
  var ex=CALC.items.filter(function(it){return it.mod===mcode&&it.cod===p.cod;})[0];
  if(ex){ ex.qty++; }
  else CALC.items.push({mod:mcode,modDesc:mdesc,cod:p.cod,desc:p.desc,valor:p.valor,qty:1,honMode:'monto',honVal:Math.round(p.valor*0.4),excluye:p.excluye||[],excNota:p.excNota||''});
}
function calcAdd(){
  var m=calcModObj(); if(!m) return;
  if(document.getElementById('calcCod').value==='__all__'){ var vs=calcVisibles(m); if(!vs.length) return; vs.forEach(function(p){calcAgregar(m.code,m.desc,p);}); calcRender(); return; }
  var p=calcPracActual(); if(!p) return; calcAgregar(m.code,m.desc,p); calcRender();
}
function calcConflictos(i){
  var a=CALC.items[i], out=[];
  CALC.items.forEach(function(b,j){ if(j===i) return;
    var choca=(a.excluye&&a.excluye.indexOf(b.cod)>=0)||(b.excluye&&b.excluye.indexOf(a.cod)>=0);
    if(choca) out.push(b.cod);
  });
  return out;
}
function calcHonDe(it){ return it.honMode==='pct' ? it.valor*it.qty*(it.honVal/100) : it.honVal*it.qty; }
function calcRenderItems(){
  var box=document.getElementById('calcItems'), cb=document.getElementById('calcConflict');
  if(!CALC.items.length){ box.innerHTML='<div class="calc-empty"><b>Todavía no agregaste prácticas</b>Elegí un módulo y una práctica arriba, y sumala.</div>'; cb.innerHTML=''; document.getElementById('calcCount').textContent='0 prácticas'; return; }
  var hay=false;
  var rows=CALC.items.map(function(it,i){
    var ch=calcConflictos(i); if(ch.length) hay=true;
    var warn=ch.length?'<div class="calc-warn-chip">⚠ Se pisa con '+esc(ch.join(', '))+(it.excNota?' · '+esc(it.excNota):'')+'</div>':'';
    return '<tr>'+
      '<td><div class="ccode">'+esc(it.cod)+'</div><div class="cdesc">'+esc(it.desc)+'</div><span class="calc-mod-chip">'+esc(it.mod)+' · '+esc(it.modDesc||'')+'</span>'+warn+'</td>'+
      '<td class="num">'+calcMoney(it.valor)+'</td>'+
      '<td><input class="qty" type="number" min="1" step="1" value="'+it.qty+'" data-q="'+i+'"></td>'+
      '<td><div class="calc-hon"><input type="number" min="0" step="1" value="'+it.honVal+'" data-h="'+i+'">'+
        '<div class="calc-tgl"><button data-m="'+i+'" data-mode="monto" class="'+(it.honMode==='monto'?'on':'')+'">$</button>'+
        '<button data-m="'+i+'" data-mode="pct" class="'+(it.honMode==='pct'?'on':'')+'">%</button></div></div></td>'+
      '<td class="num" style="font-weight:700">'+calcMoney(it.valor*it.qty)+'</td>'+
      '<td style="text-align:right"><button class="calc-x" data-del="'+i+'" title="Quitar">×</button></td>'+
    '</tr>';
  }).join('');
  box.innerHTML='<table><thead><tr><th>Práctica</th><th class="num">Unitario</th><th>Cant.</th><th class="num">Honorario méd.</th><th class="num">Bruto</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
  cb.innerHTML = hay ? '<div class="calc-conflict"><span>⚠</span><span>Hay prácticas <b>excluyentes entre sí</b> en la proyección. PAMI no paga todas — revisá las marcadas.</span></div>' : '';
  var tot=CALC.items.reduce(function(s,it){return s+it.qty;},0);
  document.getElementById('calcCount').textContent=tot+' práctica'+(tot!==1?'s':'');
  box.querySelectorAll('[data-q]').forEach(function(inp){ inp.addEventListener('input',function(){ CALC.items[+this.dataset.q].qty=Math.max(1,parseInt(this.value)||1); calcRender(); }); });
  box.querySelectorAll('[data-h]').forEach(function(inp){ inp.addEventListener('input',function(){ CALC.items[+this.dataset.h].honVal=Math.max(0,parseFloat(this.value)||0); calcCalc(); }); });
  box.querySelectorAll('[data-m]').forEach(function(b){ b.addEventListener('click',function(){ CALC.items[+this.dataset.m].honMode=this.dataset.mode; calcRender(); }); });
  box.querySelectorAll('[data-del]').forEach(function(b){ b.addEventListener('click',function(){ CALC.items.splice(+this.dataset.del,1); calcRender(); }); });
}
function calcTotales(){
  var bruto=CALC.items.reduce(function(s,it){return s+it.valor*it.qty;},0);
  var hon=CALC.items.reduce(function(s,it){return s+calcHonDe(it);},0);
  var pct=function(id){ return (parseFloat(document.getElementById(id).value)||0)/100; };
  var ib=document.getElementById('calcIB').checked?bruto*pct('calcPctIB'):0;
  var gan=document.getElementById('calcGan').checked?bruto*pct('calcPctGan'):0;
  var otr=document.getElementById('calcOtros').checked?bruto*pct('calcPctOtros'):0;
  var imp=ib+gan+otr, rent=bruto-hon-imp, margin=bruto?rent/bruto*100:0;
  return {bruto:bruto,hon:hon,ib:ib,gan:gan,otr:otr,imp:imp,rent:rent,margin:margin};
}
function calcCalc(){
  var t=calcTotales();
  document.getElementById('calcAmtIB').textContent=calcMoney(t.ib);
  document.getElementById('calcAmtGan').textContent=calcMoney(t.gan);
  document.getElementById('calcAmtOtros').textContent=calcMoney(t.otr);
  document.getElementById('calcBruto').textContent=calcMoney(t.bruto);
  document.getElementById('calcHon').textContent='− '+calcMoney(t.hon);
  document.getElementById('calcImp').textContent='− '+calcMoney(t.imp);
  document.getElementById('calcRent').textContent=calcMoney(t.rent);
  document.getElementById('calcMargin').textContent=(t.bruto?Math.round(t.margin):0)+'%';
  document.getElementById('calcFinal').classList.toggle('warn', t.bruto>0 && t.margin<25);
}
function calcRender(){ calcRenderItems(); calcCalc(); }
function calcPersistSaved(){ try{ localStorage.setItem('ns-calc-saved', JSON.stringify(CALC.saved)); }catch(e){} }
function calcRenderSaved(){
  var l=document.getElementById('calcSavedList'); document.getElementById('calcSavedCount').textContent=CALC.saved.length;
  if(!CALC.saved.length){ l.innerHTML='<div class="calc-saved-empty">Guardá una proyección para compararla con otra.</div>'; return; }
  l.innerHTML=CALC.saved.map(function(s,i){
    return '<div class="calc-saved"><div><div class="sv-name">'+esc(s.nombre)+'</div><div class="sv-meta">Bruto '+calcMoney(s.bruto)+'</div></div>'+
      '<div><div class="sv-val">'+calcMoney(s.rent)+'</div><div class="sv-margin">'+Math.round(s.margin)+'% margen</div></div>'+
      '<button class="calc-x" data-sdel="'+i+'" title="Quitar">×</button></div>';
  }).join('');
  l.querySelectorAll('[data-sdel]').forEach(function(b){ b.addEventListener('click',function(){ CALC.saved.splice(+this.dataset.sdel,1); calcPersistSaved(); calcRenderSaved(); }); });
}
function calcGuardar(){
  if(!CALC.items.length){ return; }
  var nombre=(document.getElementById('calcSaveName').value||'').trim() || ('Proyección '+(CALC.saved.length+1));
  var t=calcTotales();
  CALC.saved.push({nombre:nombre,bruto:t.bruto,hon:t.hon,imp:t.imp,rent:t.rent,margin:t.margin});
  document.getElementById('calcSaveName').value=''; calcPersistSaved(); calcRenderSaved();
}
function calcDescargar(){
  if(!CALC.saved.length){ return; }
  var sc=function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; };
  var head=['Proyeccion','Bruto','Honorarios','Impuestos','Rentabilidad','Margen %'];
  var lines=[head.join(';')].concat(CALC.saved.map(function(s){
    return [sc(s.nombre), s.bruto.toFixed(2), s.hon.toFixed(2), s.imp.toFixed(2), s.rent.toFixed(2), Math.round(s.margin)].join(';');
  }));
  var blob=new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='proyecciones_totales.csv';
  document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },0);
}

async function loadNomencladorSummary(period){
  var st = document.getElementById('nomStatusText');
  if (!st) return;
  setDefaultUploadPeriod();
  var selected = period || document.getElementById('nomPeriod').value || '';
  var res = await api('/api/nomencladores' + (selected ? '?period=' + encodeURIComponent(selected) : ''));
  if (!res.ok){
    st.innerHTML = '<b>No se pudo consultar el nomenclador</b><span>Revisá la sesión o volvé a ingresar.</span>';
    return;
  }
  // Al abrir sin nada elegido, mostrar siempre el ultimo mes cargado (el mas nuevo).
  var lista = res.data.nomencladores || [];
  if (!selected && lista.length && res.data.activePeriod !== lista[0].value){
    return loadNomencladorSummary(lista[0].value);
  }
  NOM_READY = !!res.data.loaded;
  var previousPeriod = NOM_ACTIVE_PERIOD;
  NOM_ACTIVE_PERIOD = res.data.activePeriod || '';
  if (previousPeriod && NOM_ACTIVE_PERIOD && previousPeriod !== NOM_ACTIVE_PERIOD) NOM_SELECTED_MODULES = [];
  fillPeriodSelect(res.data.nomencladores || [], NOM_ACTIVE_PERIOD);
  if (!NOM_READY){
    st.innerHTML = '<b>Sin nomenclador cargado</b><span>Subí un Excel .xls o .xlsx para habilitar la búsqueda.</span>';
    document.getElementById('nomBody').innerHTML = '<tr><td colspan="6" class="muted-cell">No hay datos cargados.</td></tr>';
    document.getElementById('nomResultMeta').textContent = 'Todavía no hay búsqueda.';
    return;
  }
  var d = res.data;
  st.innerHTML = '<b>' + esc(d.label || d.activePeriod) + ' - ' + esc(d.filename) + '</b><span>' + esc(d.vigencia || d.sheetName || 'Nomenclador') + ' - ' + esc(String(d.rowCount)) + ' prestaciones - cargado ' + esc(dateFmt(d.uploadedAt)) + '</span>'
    + '<span class="nom-cols">Valor: ' + esc(d.columns.total) + '</span>';
  loadNomencladorIncrease(NOM_ACTIVE_PERIOD);
  renderModuleOptions(d.filters.modules);
  fillSelect('nomScope', d.filters.scopes);
  fillSelect('nomType', d.filters.types);
  await searchNomenclador();
}
// Banner de aumento del nomenclador vs el mes anterior (general/consultas/nivel 1).
async function loadNomencladorIncrease(period){
  var box = document.getElementById('nomIncrease');
  if (!box) return;
  var res = await api('/api/nomencladores/comparar' + (period ? '?period=' + encodeURIComponent(period) : ''));
  if (!res.ok || !res.data || !res.data.hasPrevious){ box.style.display = 'none'; box.innerHTML = ''; return; }
  var d = res.data;
  function chip(obj, label){
    if (!obj || obj.avgPct === null || obj.avgPct === undefined) return '';
    var up = obj.avgPct >= 0;
    var arrow = up ? '▲' : '▼';
    return '<span class="nom-inc-chip ' + (up ? 'up' : 'down') + '"><b>' + arrow + ' ' + esc(percentFmt(Math.abs(obj.avgPct))) + '</b> ' + esc(label) + '</span>';
  }
  var chips = chip(d.general, 'general') + chip(d.consultas, 'consultas') + chip(d.nivel1, 'módulos nivel 1');
  if (!chips){ box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  box.innerHTML = '<div class="nom-inc-ic">📈</div>'
    + '<div class="nom-inc-txt">'
    + '<div class="nom-inc-lead">Aumento vs <b>' + esc(d.previousLabel || d.previousPeriod) + '</b> — promedio de las prácticas que están en los dos meses</div>'
    + '<div class="nom-inc-chips">' + chips + '</div></div>';
}
async function uploadNomenclador(files){
  if (!files || !files[0]) return;
  var st = document.getElementById('nomStatusText');
  var input = document.getElementById('nomFile');
  var period = document.getElementById('nomUploadPeriod').value;
  st.innerHTML = '<b>Procesando Excel...</b><span>Esto puede tardar unos segundos. Si no elegiste mes, se detecta desde el archivo.</span>';
  var fd = new FormData();
  if (period) fd.append('period', period);
  fd.append('file', files[0]);
  var r = await fetch('/api/nomencladores/upload', { method:'POST', body: fd });
  var data = {};
  try { data = await r.json(); } catch (e) {}
  if (input) input.value = '';
  if (!r.ok){
    st.innerHTML = '<b>No se pudo cargar</b><span>' + esc(data.error || 'Revisá el formato del archivo.') + '</span>';
    return;
  }
  await loadNomencladorSummary(data.activePeriod || period);
}
async function deleteNomenclador(){
  var period = document.getElementById('nomPeriod').value || NOM_ACTIVE_PERIOD;
  if (!period || !NOM_READY) return;
  var label = document.getElementById('nomPeriod').selectedOptions[0] ? document.getElementById('nomPeriod').selectedOptions[0].textContent : period;
  if (!await nsConfirm('Se elimina el nomenclador ' + label + '.', { titulo:'Eliminar nomenclador', okLabel:'Eliminar', peligro:true })) return;
  var st = document.getElementById('nomStatusText');
  st.innerHTML = '<b>Eliminando nomenclador...</b><span>' + esc(label) + '</span>';
  var res = await req('DELETE', '/api/nomencladores?period=' + encodeURIComponent(period));
  if (!res.ok){
    st.innerHTML = '<b>No se pudo eliminar</b><span>' + esc(res.data.error || 'Revisá permisos o sesión.') + '</span>';
    return;
  }
  NOM_READY = !!res.data.loaded;
  NOM_ACTIVE_PERIOD = res.data.activePeriod || '';
  await loadNomencladorSummary(NOM_ACTIVE_PERIOD);
}
function queueNomencladorSearch(){
  clearTimeout(NOM_TIMER);
  NOM_TIMER = setTimeout(searchNomenclador, 220);
}
async function searchNomenclador(){
  if (!NOM_READY) return;
  var q = document.getElementById('nomQ').value.trim();
  var moduleValues = NOM_SELECTED_MODULES.slice();
  var scope = document.getElementById('nomScope').value;
  var type = document.getElementById('nomType').value;
  var period = document.getElementById('nomPeriod').value || NOM_ACTIVE_PERIOD;
  var params = new URLSearchParams({ period:period, q:q, modules:moduleValues.join(','), scope:scope, type:type, limit:'120' });
  var res = await api('/api/nomencladores/search?' + params.toString());
  var body = document.getElementById('nomBody');
  if (!res.ok){
    body.innerHTML = '<tr><td colspan="6" class="muted-cell">' + esc(res.data.error || 'No se pudo buscar.') + '</td></tr>';
    return;
  }
  var rows = res.data.rows || [];
  document.getElementById('nomResultMeta').textContent = res.data.total + ' coincidencias' + (res.data.total > rows.length ? ' - mostrando ' + rows.length : '');
  if (!rows.length){
    body.innerHTML = '<tr><td colspan="6" class="muted-cell">Sin resultados para esos filtros.</td></tr>';
    return;
  }
  renderNomencladorRows(rows, 'nomBody', 'nomResultMeta', res.data.total || 0);
}

function findUser(un){ return USERS.filter(function(u){ return u.username === un; })[0]; }

// ---------- alta / edición ----------
var UM_MODE = 'create', UM_TARGET = '';
function openUserModal(mode, un){
  UM_MODE = mode; UM_TARGET = un || '';
  var isEdit = mode === 'edit';
  var u = isEdit ? findUser(un) : null;
  document.getElementById('umTitle').textContent = isEdit ? 'Editar usuario' : 'Nuevo usuario';
  document.getElementById('umSave').textContent = isEdit ? 'Guardar cambios' : 'Crear usuario';
  document.getElementById('umName').value = u ? u.name : '';
  document.getElementById('umUser').value = u ? u.username : '';
  document.getElementById('umRole').value = u ? u.role : 'operador';
  document.getElementById('umEmail').value = u ? (u.email || '') : '';
  document.getElementById('umPwd').value = '';
  document.getElementById('umActive').checked = u ? u.active : true;
  document.getElementById('umError').textContent = '';
  // usuario editable solo al crear; clave inicial solo al crear; activo solo al editar
  document.getElementById('umUserField').style.display = isEdit ? 'none' : '';
  document.getElementById('umPwdField').style.display = isEdit ? 'none' : '';
  document.getElementById('umActiveField').style.display = isEdit ? 'flex' : 'none';
  umPintarClientes(u && u.clientes);
  umPintarCentro(u && u.centro);
  umPintarModulos(u && u.modulos);
  umPintarModulosCliente(u && u.modulosCliente);
  umPintarCapacidades(u ? u.capacidades : null);
  umToggleClientes();
  showModal('userModal','umScrim');
  document.getElementById('umName').focus();
}
// Lista de clientes para el perfil "Demostración" (ve solo los que se tilden).
function umPintarClientes(sel){
  var cont = document.getElementById('umClientes');
  if (!cont) return;
  var elegidos = Array.isArray(sel) ? sel : [];
  cont.innerHTML = (CLIENTS || []).map(function(c){
    var ck = elegidos.indexOf(c.slug) >= 0 ? ' checked' : '';
    return '<label class="module-edit-option"><input type="checkbox" value="' + esc(c.slug) + '"' + ck + '><span>' + esc(c.name) + '</span></label>';
  }).join('') || '<div class="hint">No hay clientes cargados.</div>';
  // Tildar/destildar un cliente redibuja la grilla de "qué ve en cada cliente"
  // (rol operador), para no tener que cerrar y reabrir el modal.
  cont.querySelectorAll('input[type="checkbox"]').forEach(function(chk){
    chk.addEventListener('change', function(){
      if ((document.getElementById('umRole') || {}).value === 'operador') umRenderModulosCliente();
    });
  });
}
// Selector de centro para los roles atados a UNO solo (clinica, operador_clinica).
function umPintarCentro(sel){
  var cont = document.getElementById('umCentro');
  if (!cont) return;
  cont.innerHTML = (CLIENTS || []).map(function(c){
    return '<option value="' + esc(c.slug) + '">' + esc(c.name) + '</option>';
  }).join('') || '<option value="">No hay clientes cargados.</option>';
  cont.value = sel || '';
}
// Pantallas habilitadas para un operador_clinica (afiliados/informes/liberar
// cupo): por usuario puntual, no por rol (ver OPERADOR_CLINICA_MODULOS en
// server.js) - cada centro/operador puede necesitar un set distinto.
function umPintarModulos(sel){
  var elegidos = Array.isArray(sel) ? sel : [];
  [].slice.call(document.querySelectorAll('#umModulos input')).forEach(function(i){
    i.checked = elegidos.indexOf(i.value) >= 0;
  });
}
function umModulosElegidos(){
  return [].slice.call(document.querySelectorAll('#umModulos input:checked')).map(function(i){ return i.value; });
}
// Capacidades del rol clínica (qué ve): al EDITAR se reflejan las guardadas; al
// CREAR (o si el usuario no tiene nada) se pinta el default = todo menos "omes".
var CLINICA_CAP_DEFAULT_UM = ['dashboard', 'reportes', 'credencial', 'honorarios', 'usuarios', 'datos'];
function umPintarCapacidades(sel){
  // Al editar un clínica, `sel` viene resuelto del server (efectivo); al crear
  // es null y se muestra el default (todo menos "omes").
  var elegidos = Array.isArray(sel) ? sel : CLINICA_CAP_DEFAULT_UM.slice();
  [].slice.call(document.querySelectorAll('#umCapacidades input')).forEach(function(i){
    i.checked = elegidos.indexOf(i.value) >= 0;
  });
}
function umCapacidadesElegidas(){
  return [].slice.call(document.querySelectorAll('#umCapacidades input:checked')).map(function(i){ return i.value; });
}
// ===== Operador NS: qué ve DENTRO de cada cliente =====
// Una grilla por cada cliente tildado arriba. Se redibuja al cambiar de rol o
// al tildar/destildar un cliente, conservando lo ya elegido.
var UM_MODS_CLIENTE = {};   // { slug: [modulos] } en edición
function umPintarModulosCliente(guardado){
  UM_MODS_CLIENTE = {};
  if (guardado && typeof guardado === 'object' && !Array.isArray(guardado)){
    Object.keys(guardado).forEach(function(s){ if (Array.isArray(guardado[s])) UM_MODS_CLIENTE[s] = guardado[s].slice(); });
  }
  umRenderModulosCliente();
}
function umRenderModulosCliente(){
  var cont = document.getElementById('umModulosCliente');
  if (!cont) return;
  var elegidos = umClientesElegidos();
  // Sin lista propia, un operador ve TODOS los clientes: mostramos todos para
  // poder configurarlos igual.
  var slugs = elegidos.length ? elegidos : (CLIENTS || []).map(function(c){ return c.slug; });
  if (!slugs.length){ cont.innerHTML = '<div class="hint">Tildá primero los clientes que puede ver.</div>'; return; }
  cont.innerHTML = slugs.map(function(slug){
    var cli = (CLIENTS || []).filter(function(c){ return c.slug === slug; })[0];
    var actuales = Array.isArray(UM_MODS_CLIENTE[slug]) ? UM_MODS_CLIENTE[slug] : modulosClienteDefault(slug);
    var chips = OPERADOR_MODULOS.map(function(m){
      var ck = actuales.indexOf(m.key) >= 0 ? ' checked' : '';
      return '<label class="module-edit-option"><input type="checkbox" data-mc-slug="' + esc(slug) + '" value="' + esc(m.key) + '"' + ck + '><span>' + esc(m.label) + '</span></label>';
    }).join('');
    return '<div class="um-mc-cliente">'
      + '<div class="um-mc-nombre">' + esc((cli && cli.name) || slug) + '</div>'
      + '<div class="module-edit-list">' + chips + '</div>'
      + '</div>';
  }).join('');
  cont.querySelectorAll('[data-mc-slug]').forEach(function(inp){
    inp.addEventListener('change', function(){
      var s = inp.getAttribute('data-mc-slug');
      var sel = [].slice.call(cont.querySelectorAll('[data-mc-slug="' + s + '"]:checked')).map(function(i){ return i.value; });
      UM_MODS_CLIENTE[s] = sel;
    });
  });
}
function umModulosClienteElegidos(){
  var out = {};
  var cont = document.getElementById('umModulosCliente');
  if (!cont) return out;
  cont.querySelectorAll('.um-mc-cliente').forEach(function(box){
    var inp = box.querySelector('[data-mc-slug]');
    if (!inp) return;
    var s = inp.getAttribute('data-mc-slug');
    out[s] = [].slice.call(box.querySelectorAll('[data-mc-slug]:checked')).map(function(i){ return i.value; });
  });
  return out;
}
function umToggleClientes(){
  var role = document.getElementById('umRole').value;
  var f = document.getElementById('umClientesField');
  if (f) f.style.display = (role === 'demo' || role === 'operador' || role === 'colaborador') ? '' : 'none';
  var cf = document.getElementById('umCentroField');
  if (cf) cf.style.display = (role === 'clinica' || role === 'operador_clinica') ? '' : 'none';
  var mf = document.getElementById('umModulosField');
  if (mf) mf.style.display = (role === 'operador_clinica') ? '' : 'none';
  var capf = document.getElementById('umCapacidadesField');
  if (capf) capf.style.display = (role === 'clinica') ? '' : 'none';
  // Operador NS: la grilla de "qué ve en cada cliente" (una por cliente tildado).
  var mcf = document.getElementById('umModulosClienteField');
  if (mcf) mcf.style.display = (role === 'operador') ? '' : 'none';
  if (role === 'operador') umRenderModulosCliente();
  var chint = document.getElementById('umCentroHint');
  if (chint) chint.textContent = (role === 'operador_clinica')
    ? 'A qué centro pertenece. Por ahora este perfil no ve gráficas ni valores, solo Datos del centro.'
    : 'A qué centro pertenece este usuario. Solo va a ver y hacer lo que corresponda a ese centro.';
  var hint = document.getElementById('umClientesHint');
  if (!hint) return;
  if (role === 'operador') hint.textContent = 'Opcional. Si no tildás ninguno, el operador ve todos los clientes (como siempre). Si tildás alguno, pasa a ver SOLO esos - ni se entera de que existen los demás, ni puede elegirlos para generar un informe.';
  else if (role === 'colaborador') hint.textContent = 'Obligatorio. De estos clientes ve por ahora SOLO los dashboards (mes en curso y reportes). No modifica nada y nunca ve los accesos de PAMI.';
  else hint.textContent = 'Solo ve estos clientes. Puede mirar todo y descargar, pero no modificar nada.';
}
function umClientesElegidos(){
  return [].slice.call(document.querySelectorAll('#umClientes input:checked')).map(function(i){ return i.value; });
}
function closeUserModal(){ hideModal('userModal','umScrim'); }
async function saveUser(){
  var err = document.getElementById('umError'); err.textContent = '';
  var btn = document.getElementById('umSave'); btn.disabled = true;
  var name = document.getElementById('umName').value.trim();
  var role = document.getElementById('umRole').value;
  var email = document.getElementById('umEmail').value.trim();
  var centro = document.getElementById('umCentro').value;
  var res;
  if (UM_MODE === 'create'){
    var username = document.getElementById('umUser').value.trim().toLowerCase();
    var password = document.getElementById('umPwd').value;
    res = await req('POST', '/api/users', { username: username, name: name, role: role, email: email, password: password, centro: centro, clientes: umClientesElegidos(), modulos: umModulosElegidos(), modulosCliente: umModulosClienteElegidos(), capacidades: umCapacidadesElegidas() });
  } else {
    var active = document.getElementById('umActive').checked;
    res = await req('PATCH', '/api/users/' + encodeURIComponent(UM_TARGET), { name: name, role: role, email: email, active: active, centro: centro, clientes: umClientesElegidos(), modulos: umModulosElegidos(), modulosCliente: umModulosClienteElegidos(), capacidades: umCapacidadesElegidas() });
  }
  btn.disabled = false;
  if (!res.ok){ err.textContent = res.data.error || 'No se pudo guardar.'; return; }
  closeUserModal();
  await renderUsers();
}

// ---------- resetear clave ----------
function openReset(un){
  UM_TARGET = un;
  var u = findUser(un);
  document.getElementById('pwWho').textContent = (u ? u.name : un) + ' (@' + un + ')';
  document.getElementById('pwNew').value = '';
  document.getElementById('pwError').textContent = '';
  showModal('pwdModal','pwScrim');
  document.getElementById('pwNew').focus();
}
function closePwdModal(){ hideModal('pwdModal','pwScrim'); }
async function saveResetPwd(){
  var err = document.getElementById('pwError'); err.textContent = '';
  var btn = document.getElementById('pwSave'); btn.disabled = true;
  var password = document.getElementById('pwNew').value;
  var res = await req('POST', '/api/users/' + encodeURIComponent(UM_TARGET) + '/password', { password: password });
  btn.disabled = false;
  if (!res.ok){ err.textContent = res.data.error || 'No se pudo cambiar la clave.'; return; }
  closePwdModal();
  await renderUsers();
}

// ---------- activar / desactivar ----------
async function toggleActive(un, active){
  var res = await req('PATCH', '/api/users/' + encodeURIComponent(un), { active: active });
  if (!res.ok){ nsAlert(res.data.error || 'No se pudo cambiar el estado.'); return; }
  await renderUsers();
}

// ---------- eliminar ----------
function openDel(un){
  UM_TARGET = un;
  var u = findUser(un);
  document.getElementById('delWho').textContent = (u ? u.name : un) + ' (@' + un + ')';
  document.getElementById('delError').textContent = '';
  showModal('delModal','delScrim');
}
function closeDelModal(){ hideModal('delModal','delScrim'); }
async function saveDelete(){
  var err = document.getElementById('delError'); err.textContent = '';
  var btn = document.getElementById('delSave'); btn.disabled = true;
  var res = await req('DELETE', '/api/users/' + encodeURIComponent(UM_TARGET));
  btn.disabled = false;
  if (!res.ok){ err.textContent = res.data.error || 'No se pudo eliminar.'; return; }
  closeDelModal();
  await renderUsers();
}

function showModal(id, scrimId){ document.getElementById(scrimId).classList.add('show'); document.getElementById(id).classList.add('show'); }
function hideModal(id, scrimId){ document.getElementById(scrimId).classList.remove('show'); document.getElementById(id).classList.remove('show'); }

// ================= Estado del server (worker + automatización) =================
// La web ya recibe el heartbeat del worker (cada ~5s) en /api/admin/worker/status.
// Con eso mostramos si el server está vivo, qué está haciendo y las últimas tareas,
// sin necesidad de entrar por SSH. Solo admin.
var SRV_POLL = null;       // refresco mientras el modal está abierto
var SRV_DOT_POLL = null;   // refresco de fondo del puntito del botón
var SRV_TIPO_LABEL = { 'healthcheck':'Prueba', 'auditar-informes':'Auditar informes', 'subir-informes':'Subir informe', 'bandeja-sync':'Sincronizar bandeja', 'liberar-cupo':'Liberar cupo', 'crear-ome':'Generar OME' };

function srvRelativo(iso){
  if(!iso) return '—';
  var t = Date.parse(iso); if(isNaN(t)) return '—';
  var s = Math.max(0, Math.round((Date.now()-t)/1000));
  if(s<60) return 'hace '+s+'s';
  var m=Math.round(s/60); if(m<60) return 'hace '+m+' min';
  var h=Math.floor(m/60); if(h<24) return 'hace '+h+' h';
  return 'hace '+Math.floor(h/24)+' d';
}
function srvOnline(w){ return !!(w && w.lastSeenAt) && (Date.now()-Date.parse(w.lastSeenAt)) < 45000; }
function srvIconTarea(s){ return s==='done'?'✅':s==='error'?'❌':s==='running'?'⏳':s==='pending'?'🕓':'•'; }
// Estado del server: 'on' (latido reciente), 'busy' (sin latido pero hay una tarea
// corriendo → está ocupado subiendo, NO caído) u 'off' (sin conexión de verdad).
// El worker no manda latido mientras está metido en una tarea larga (subir a PAMI),
// así que sin este chequeo mostraba "Sin conexión" estando a full trabajando.
function srvEstado(st){
  var ws=(st&&st.workers)||[]; if(ws.some(srvOnline)) return 'on';
  var tasks=(st&&st.tasks)||[];
  if(tasks.some(function(t){ return t.status==='running'; })) return 'busy';
  return 'off';
}

async function srvCargarEstado(){
  var r = await fetch('/api/admin/worker/status', { credentials:'same-origin' });
  if(!r.ok) throw new Error('http '+r.status);
  return r.json();
}
function srvSetDot(estado){ var d=document.getElementById('srvDot'); if(d) d.style.background = estado==='on'||estado===true ? '#16a34a' : estado==='busy' ? '#d97706' : '#dc2626'; }
async function srvRefrescarDot(){
  try{ var st=await srvCargarEstado(); srvSetDot(srvEstado(st)); }
  catch(e){ srvSetDot('off'); }
}

function srvRender(st){
  var body=document.getElementById('srvBody'); if(!body) return;
  var ws=(st.workers||[]);
  var tasks=(st.tasks||[]);
  var estado = srvEstado(st);
  srvSetDot(estado);
  var enCola = tasks.filter(function(t){ return t.status==='pending'; }).length;
  var w = ws.slice().sort(function(a,b){ return String(b.lastSeenAt||'').localeCompare(String(a.lastSeenAt||'')); })[0];
  // Paleta según estado: verde en línea / ámbar trabajando / rojo sin conexión.
  var C = estado==='on'   ? { bg:'rgba(22,163,74,.10)', dot:'#16a34a', ring:'rgba(22,163,74,.18)', txt:'Server en línea' }
        : estado==='busy' ? { bg:'rgba(217,119,6,.10)', dot:'#d97706', ring:'rgba(217,119,6,.18)', txt:'Trabajando…' + (enCola? ' ('+enCola+' en cola)' : '') }
        :                    { bg:'rgba(220,38,38,.10)', dot:'#dc2626', ring:'rgba(220,38,38,.18)', txt:'Sin conexión con el server' };
  var h='';
  // Cabecera: vivo / trabajando / sin conexión
  h += '<div style="display:flex;align-items:center;gap:11px;padding:14px 16px;border-radius:12px;background:'+C.bg+';margin-bottom:16px">';
  h += '<span style="width:12px;height:12px;border-radius:50%;flex:none;background:'+C.dot+';box-shadow:0 0 0 4px '+C.ring+'"></span>';
  h += '<div style="min-width:0"><div style="font-weight:800;color:var(--text)">'+C.txt+'</div>';
  h += '<div style="font-size:12px;color:var(--text-2)">'+ (w ? ((w.hostname||w.workerId||'server')+' · visto '+srvRelativo(w.lastSeenAt)) : 'nunca reportó') +'</div></div></div>';

  // Qué está haciendo ahora
  var corriendo = tasks.filter(function(t){ return t.status==='running'; })[0];
  h += '<div style="font-size:11.5px;font-weight:800;color:var(--text-2);text-transform:uppercase;letter-spacing:.5px;margin:0 2px 6px">Ahora</div>';
  if(corriendo){
    var lblC = SRV_TIPO_LABEL[corriendo.type]||corriendo.type;
    h += '<div style="padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.04);margin-bottom:16px;color:var(--text)">⏳ '+lblC+(corriendo.clientSlug?' · '+corriendo.clientSlug:'')+'</div>';
  } else {
    h += '<div style="padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.04);margin-bottom:16px;color:var(--text-2)">Inactivo — esperando tareas</div>';
  }

  // Últimas tareas
  h += '<div style="font-size:11.5px;font-weight:800;color:var(--text-2);text-transform:uppercase;letter-spacing:.5px;margin:0 2px 6px">Últimas tareas</div>';
  if(!tasks.length){
    h += '<div style="color:var(--text-2);padding:4px 2px 16px">Sin tareas todavía.</div>';
  } else {
    h += '<div style="display:flex;flex-direction:column;gap:7px;margin-bottom:16px">';
    tasks.slice(0,6).forEach(function(t){
      var lbl=SRV_TIPO_LABEL[t.type]||t.type;
      var cuando = t.finishedAt||t.startedAt||t.createdAt;
      var err = (t.status==='error' && t.error) ? ' <span style="color:#dc2626">('+String(t.error).slice(0,55)+')</span>' : '';
      h += '<div style="display:flex;align-items:center;gap:8px;font-size:13px">'
         + '<span style="flex:none">'+srvIconTarea(t.status)+'</span>'
         + '<span style="flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis">'+lbl+(t.clientSlug?' · '+t.clientSlug:'')+err+'</span>'
         + '<span style="flex:none;color:var(--text-2);font-size:11px;white-space:nowrap">'+srvRelativo(cuando)+'</span>'
         + '</div>';
      // Capturas de pantalla del error en PAMI (si el bot las sacó): links para verlas.
      if (t.capturas && t.capturas.length){
        h += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:1px 0 3px 24px">';
        t.capturas.forEach(function(c, ci){
          var tip = (c.motivo ? String(c.motivo) : 'Ver captura del error').replace(/"/g,'&quot;');
          h += '<a href="/api/admin/worker/capturas/'+encodeURIComponent(t.id)+'/'+ci+'" target="_blank" rel="noopener" '
             + 'style="font-size:11px;color:#2563eb;text-decoration:none;border:1px solid rgba(37,99,235,.35);border-radius:6px;padding:1px 7px" '
             + 'title="'+tip+'">📷 '+(c.ome ? 'OME '+esc(c.ome) : 'ver error')+'</a>';
        });
        h += '</div>';
      }
    });
    h += '</div>';
  }

  // Automatización programada (horario real; editable con el botón)
  h += '<div style="display:flex;align-items:center;gap:8px;margin:0 2px 6px">'
     + '<span style="font-size:11.5px;font-weight:800;color:var(--text-2);text-transform:uppercase;letter-spacing:.5px">Automatización programada</span>'
     + '<button type="button" onclick="abrirConfigServer()" class="btn btn-sm" style="margin-left:auto;padding:2px 10px;font-size:11.5px">⚙ Editar horarios</button>'
     + '</div>';
  h += '<div style="font-size:12.5px;color:var(--text-2);line-height:1.75">'
     + (SRV_SCHEDULE ? srvFormatSchedule(SRV_SCHEDULE) : 'Cargando horarios…')
     + '</div>';

  body.innerHTML = h;
}

async function srvTick(){
  try{ srvRender(await srvCargarEstado()); }
  catch(e){ var b=document.getElementById('srvBody'); if(b) b.innerHTML='<div style="padding:18px;color:#dc2626">No pude leer el estado ('+(e&&e.message||e)+').</div>'; srvSetDot(false); }
}
function abrirEstadoServer(){
  showModal('srvModal','srvScrim');
  srvTick();
  srvCargarSchedule();   // trae el horario real para mostrarlo (y re-renderiza)
  if(SRV_POLL) clearInterval(SRV_POLL);
  SRV_POLL = setInterval(srvTick, 5000);
}
function cerrarEstadoServer(){
  hideModal('srvModal','srvScrim');
  if(SRV_POLL){ clearInterval(SRV_POLL); SRV_POLL=null; }
}

// ---- Horario de la automatización (ver + editar) ----
var SRV_SCHEDULE = null;
var SRV_DIAS_ORDEN = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
var SRV_DIA_LBL = { Mon:'Lun', Tue:'Mar', Wed:'Mié', Thu:'Jue', Fri:'Vie', Sat:'Sáb', Sun:'Dom' };

async function srvCargarSchedule(){
  try{
    var r = await fetch('/api/admin/worker/schedule', { credentials:'same-origin' });
    if(!r.ok) return;
    var d = await r.json();
    if(d && d.schedule){ SRV_SCHEDULE = d.schedule; if(document.getElementById('srvModal').classList.contains('show')) srvTick(); }
  }catch(e){}
}
function srvFormatSchedule(s){
  if(!s) return 'Cargando horarios…';
  var out = [];
  out.push('• Refresco de bandeja <b>'+esc(s.bandejaRefresh)+'</b> · reintentos <b>'+esc(s.bandejaRetry)+'</b>');
  out.push('• "Actualizar ahora" <b>cada '+esc(String(s.pollerCadaMin))+' min</b>');
  out.push('• Traer del mail (informes): <b>10:00, 14:00, 16:00, 18:00</b>');
  out.push('• Resumen de subidas por Telegram: <b>'+esc(s.telegramResumenHora||'19:00')+'</b>');
  var cad = s.scheffelaarCadena || {};
  var partes = SRV_DIAS_ORDEN.filter(function(d){ return (cad[d]||[]).length; })
     .map(function(d){ return SRV_DIA_LBL[d]+' '+cad[d].join(', '); });
  out.push('• Cadena Scheffelaar: ' + (partes.length ? '<b>'+partes.join('</b> · <b>')+'</b>' : '<i>no corre</i>'));
  var b = s.scheffelaarBenef || {};
  var bd = (b.dias||[]).map(function(d){ return SRV_DIA_LBL[d]; }).join('/');
  out.push('• Barrido benef: ' + (bd ? '<b>'+bd+' '+esc(b.hora)+'</b>' : '<i>no corre</i>'));
  return out.join('<br>');
}

function abrirConfigServer(){
  cerrarEstadoServer();          // cerramos el panel (que se auto-refresca) para editar tranquilo
  showModal('srvCfgModal','srvCfgScrim');
  var body = document.getElementById('srvCfgBody');
  if(body) body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2)">Cargando…</div>';
  fetch('/api/admin/worker/schedule', { credentials:'same-origin' })
    .then(function(r){ return r.json(); })
    .then(function(d){ SRV_SCHEDULE = (d && d.schedule) || SRV_SCHEDULE; renderConfigServer(SRV_SCHEDULE); })
    .catch(function(){ if(body) body.innerHTML = '<div style="padding:18px;color:#dc2626">No pude leer los horarios.</div>'; });
}
function cerrarConfigServer(){ hideModal('srvCfgModal','srvCfgScrim'); }

function renderConfigServer(s){
  s = s || {};
  var body = document.getElementById('srvCfgBody'); if(!body) return;
  var cad = s.scheffelaarCadena || {};
  var benefDias = (s.scheffelaarBenef && s.scheffelaarBenef.dias) || [];
  var lbl = 'style="font-size:11.5px;font-weight:800;color:var(--text-2);text-transform:uppercase;letter-spacing:.4px;margin:14px 2px 6px;display:block"';
  var row = 'style="display:flex;align-items:center;gap:8px;margin-bottom:6px"';
  var h = '';
  h += '<div style="font-size:12.5px;color:var(--text-2);margin-bottom:6px">Los cambios los toma el server solo, en unos minutos.</div>';

  h += '<span '+lbl+'>Bandejas</span>';
  h += '<div '+row+'><span style="width:150px">Refresco (bajar bandeja)</span><input type="time" id="cfgRefresh" class="inp mini" value="'+esc(s.bandejaRefresh||'20:00')+'"></div>';
  h += '<div '+row+'><span style="width:150px">Reintentar con error</span><input type="time" id="cfgRetry" class="inp mini" value="'+esc(s.bandejaRetry||'22:00')+'"></div>';
  h += '<div '+row+'><span style="width:150px">"Actualizar ahora"</span>cada <input type="number" id="cfgPoller" class="inp mini" min="1" max="60" value="'+esc(String(s.pollerCadaMin||10))+'" style="width:64px"> min</div>';

  h += '<span '+lbl+'>Cadena Scheffelaar — horas por día (separadas por coma)</span>';
  SRV_DIAS_ORDEN.forEach(function(d){
    var val = (cad[d]||[]).join(', ');
    h += '<div '+row+'><span style="width:44px">'+SRV_DIA_LBL[d]+'</span>'
       + '<input type="text" id="cfgCad_'+d+'" class="inp mini" placeholder="ej: 17:00, 19:30" value="'+esc(val)+'" style="flex:1"></div>';
  });

  h += '<span '+lbl+'>Barrido de beneficiarios</span>';
  h += '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px">';
  SRV_DIAS_ORDEN.forEach(function(d){
    var ck = benefDias.indexOf(d) >= 0 ? ' checked' : '';
    h += '<label style="display:inline-flex;align-items:center;gap:4px;font-size:13px;cursor:pointer"><input type="checkbox" id="cfgBenef_'+d+'"'+ck+'>'+SRV_DIA_LBL[d]+'</label>';
  });
  h += '</div>';
  h += '<div '+row+'><span style="width:150px">Hora</span><input type="time" id="cfgBenefHora" class="inp mini" value="'+esc((s.scheffelaarBenef&&s.scheffelaarBenef.hora)||'19:00')+'"></div>';

  h += '<span '+lbl+'>Resumen de subidas por Telegram</span>';
  h += '<div '+row+'><span style="width:150px">Hora del resumen</span><input type="time" id="cfgTelegramHora" class="inp mini" value="'+esc(s.telegramResumenHora||'19:00')+'"></div>';

  h += '<div id="cfgMsg" style="margin-top:10px;font-size:12.5px"></div>';
  h += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">'
     + '<button class="btn btn-sm" type="button" onclick="cerrarConfigServer()">Cancelar</button>'
     + '<button class="btn btn-primary btn-sm" type="button" id="cfgGuardar" onclick="guardarConfigServer()">Guardar horarios</button>'
     + '</div>';
  body.innerHTML = h;
}

function _cfgHoras(id){
  var el = document.getElementById(id); if(!el) return [];
  return String(el.value||'').split(',').map(function(t){ return t.trim(); }).filter(Boolean);
}
async function guardarConfigServer(){
  var cad = {};
  SRV_DIAS_ORDEN.forEach(function(d){ cad[d] = _cfgHoras('cfgCad_'+d); });
  var benefDias = SRV_DIAS_ORDEN.filter(function(d){ var c=document.getElementById('cfgBenef_'+d); return c && c.checked; });
  var schedule = {
    bandejaRefresh: (document.getElementById('cfgRefresh')||{}).value || '20:00',
    bandejaRetry: (document.getElementById('cfgRetry')||{}).value || '22:00',
    pollerCadaMin: parseInt((document.getElementById('cfgPoller')||{}).value, 10) || 10,
    scheffelaarCadena: cad,
    scheffelaarBenef: { dias: benefDias, hora: (document.getElementById('cfgBenefHora')||{}).value || '19:00' },
    telegramResumenHora: (document.getElementById('cfgTelegramHora')||{}).value || '19:00',
  };
  var btn = document.getElementById('cfgGuardar'); if(btn){ btn.disabled = true; btn.textContent = 'Guardando…'; }
  var msg = document.getElementById('cfgMsg');
  try{
    var r = await fetch('/api/admin/worker/schedule', { method:'POST', headers:{'content-type':'application/json'}, credentials:'same-origin', body: JSON.stringify({ schedule: schedule }) });
    var d = await r.json();
    if(!r.ok || !d.ok){ throw new Error((d && d.error) || ('http '+r.status)); }
    SRV_SCHEDULE = d.schedule;   // el server devuelve el horario ya validado/limpio
    if(msg){ msg.style.color = '#16a34a'; msg.textContent = '✅ Guardado. El server lo va a tomar en unos minutos.'; }
    setTimeout(function(){ cerrarConfigServer(); abrirEstadoServer(); }, 900);
  }catch(e){
    if(btn){ btn.disabled = false; btn.textContent = 'Guardar horarios'; }
    if(msg){ msg.style.color = '#dc2626'; msg.textContent = 'No se pudo guardar ('+(e&&e.message||e)+').'; }
  }
}

// ===== Padrón de afiliados (admin) =====
var PADRON_SEARCH_TIMER = null;
async function loadPadronView(){
  var sel = document.getElementById('padCliente');
  if (sel && !sel.options.length){
    var list = await clientesParaSelector();
    list.forEach(function(c){
      var o = document.createElement('option'); o.value = c.slug; o.textContent = c.name || c.slug; sel.appendChild(o);
    });
  }
  await refreshPadron();
}
async function refreshPadron(){
  var sel = document.getElementById('padCliente');
  var slug = sel && sel.value;
  var meta = document.getElementById('padResultMeta');
  var body = document.getElementById('padBody');
  if (!slug){ if (meta) meta.textContent = 'Elegí un cliente.'; if (body) body.innerHTML = ''; return; }
  var q = (document.getElementById('padQ').value || '').trim();
  var r = await fetch('/api/clientes/' + slug + '/padron?limit=10000&q=' + encodeURIComponent(q));
  var data = {};
  try { data = await r.json(); } catch(e){}
  if (!r.ok){ if (meta) meta.textContent = (data.error || 'No se pudo cargar.'); if (body) body.innerHTML=''; return; }
  renderPadronRows(slug, data);
}
function renderPadronRows(slug, data){
  var body = document.getElementById('padBody');
  var meta = document.getElementById('padResultMeta');
  var items = data.items || [];
  if (meta){
    var txt = 'Padrón: ' + (data.totalPadron||0) + ' afiliados · ' + (data.conBeneficio||0) + ' con beneficio';
    if (data.total !== data.totalPadron) txt += ' · ' + data.total + ' en la búsqueda';
    if (items.length < (data.total||0)) txt += ' · mostrando ' + items.length + ' (afiná la búsqueda para ver el resto)';
    meta.textContent = txt;
  }
  if (!items.length){ body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#889;padding:18px">Sin resultados.</td></tr>'; return; }
  var esAdmin = ME && ME.role === 'admin';
  body.innerHTML = items.map(function(it){
    var acciones = '';
    if (esAdmin) {
      // "Ver capita" pide beneficio+DNI a PAMI (Mi Cartilla): sin beneficio cargado
      // no se puede consultar, así que el botón queda deshabilitado en ese caso.
      var tieneBenef = !!it.beneficio;
      var btnCapita = '<button class="icon-btn" title="' + (tieneBenef ? 'Ver capita (médico de cabecera, internación, etc.)' : 'Falta el beneficio para poder consultar') + '"'
        + (tieneBenef ? ' onclick="verCapitaAfiliado(\'' + esc(it.nombre||'') + '\',\'' + esc(it.dni) + '\',\'' + esc(it.beneficio) + '\')"' : ' disabled')
        + '><svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M9 12l2 2 4-4M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
      acciones = btnCapita + ' <button class="icon-danger-btn" title="Quitar" onclick="deletePadronItem(\'' + slug + '\',\'' + esc(it.dni) + '\')"><svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    }
    return '<tr><td>' + esc(it.nombre||'') + '</td><td>' + esc(it.dni||'') + '</td><td>' + esc(it.beneficio||'—') + '</td><td>' + esc(it.tramite||'—') + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' + acciones + '</td></tr>';
  }).join('');
}
function queuePadronSearch(){ clearTimeout(PADRON_SEARCH_TIMER); PADRON_SEARCH_TIMER = setTimeout(refreshPadron, 250); }
async function uploadTurnera(files){
  if (!files || !files[0]) return;
  var sel = document.getElementById('padCliente');
  var slug = sel && sel.value;
  var input = document.getElementById('padFile');
  var st = document.getElementById('padStatusText');
  if (!slug){ if (st) st.innerHTML = '<b>Elegí un cliente primero</b><span>Seleccioná el cliente antes de subir la turnera.</span>'; if (input) input.value=''; return; }
  if (st) st.innerHTML = '<b>Procesando turnera…</b><span>Creando y actualizando afiliados.</span>';
  var fd = new FormData(); fd.append('file', files[0]);
  var r = await fetch('/api/clientes/' + slug + '/padron/upload', { method:'POST', body: fd });
  var data = {};
  try { data = await r.json(); } catch(e){}
  if (input) input.value = '';
  if (!r.ok){ if (st) st.innerHTML = '<b>No se pudo cargar</b><span>' + esc(data.error||'Revisá el archivo.') + '</span>'; return; }
  if (st) st.innerHTML = '<b>Turnera cargada ✓</b><span>' + esc(data.archivo||'') + ': ' + data.creados + ' nuevos, ' + data.actualizados + ' actualizados' + (data.sinDni ? ', ' + data.sinDni + ' sin DNI omitidos' : '') + '. Padrón: ' + data.totalPadron + ' afiliados.</span>';
  await refreshPadron();
}
async function deletePadronItem(slug, dni){
  if (!await nsConfirm('Se quita este afiliado del padrón.', { titulo:'Quitar afiliado', okLabel:'Quitar', peligro:true })) return;
  var r = await fetch('/api/clientes/' + slug + '/padron/' + dni, { method:'DELETE' });
  if (r.ok) await refreshPadron();
}

// ===== Cruzas (Grupo Justo y similares): cruce agenda vs bandeja PAMI =====
// Todo el estado del cruce que se está viendo/editando vive acá en memoria;
// "Guardar cambios" es lo único que lo persiste en el servidor.
var CZ = { clientesCargados: false, cruceActivo: null, filtroColor: null, _pickerFor: -1, paginaPacientes: 1, paginaAusentes: 1 };
var CZ_PAGE_SIZE = 75;
// "Facturado" puede ser miles de filas - nada de renderizar todo junto, se
// pagina de a 75 (misma idea para Ausentes).
function czPaginaSlice(items, page){
  var totalPages = Math.max(1, Math.ceil(items.length / CZ_PAGE_SIZE));
  page = Math.min(Math.max(1, page || 1), totalPages);
  var start = (page - 1) * CZ_PAGE_SIZE;
  return { slice: items.slice(start, start + CZ_PAGE_SIZE), page: page, totalPages: totalPages, total: items.length };
}
function czPaginadorHtml(info, fnIrA){
  if (info.totalPages <= 1) return '';
  return '<div class="cz-paginador">' +
    '<button type="button" class="btn btn-ghost" ' + (info.page <= 1 ? 'disabled' : '') + ' onclick="' + fnIrA + '(' + (info.page - 1) + ')">‹ Anterior</button>' +
    '<span class="nom-muted">Página ' + info.page + ' de ' + info.totalPages + ' · ' + info.total + ' en total</span>' +
    '<button type="button" class="btn btn-ghost" ' + (info.page >= info.totalPages ? 'disabled' : '') + ' onclick="' + fnIrA + '(' + (info.page + 1) + ')">Siguiente ›</button>' +
  '</div>';
}
var CZ_COLORES = ['VERDE', 'AMARILLO', 'NARANJA', 'ROJO', 'GRIS'];
var CZ_COLOR_HEX = { VERDE: '#c6efce', AMARILLO: '#ffeb9c', NARANJA: '#fcd5b4', ROJO: '#ffc7ce', GRIS: '#d9d9d9' };
var CZ_LEYENDA = [['VERDE','Facturado'], ['AMARILLO','Revisar error'], ['NARANJA','Falta informe'], ['ROJO','Falta OME'], ['GRIS','Incongruencia']];
async function loadCruzasClientes(){
  var sel = document.getElementById('czCliente');
  if (sel && !CZ.clientesCargados){
    CZ.clientesCargados = true;
    var list = await clientesParaSelector();
    list.forEach(function(c){ var o = document.createElement('option'); o.value = c.slug; o.textContent = c.name || c.slug; sel.appendChild(o); });
    // Recuerda el último cliente elegido - si no, siempre arranca en el
    // primero de la lista (Sala Millon) en vez de donde quedaste la vez pasada.
    var ultimo = null;
    try { ultimo = localStorage.getItem('ns_cruzas_cliente'); } catch(e){}
    if (ultimo && list.some(function(c){ return c.slug === ultimo; })) sel.value = ultimo;
    await cargarNomencladoresParaCruza();
  }
  onCambiaClienteCruzas();
}
// El nomenclador con el que se valoriza "Ausentes". Por defecto el activo (el
// mismo que ya usa la Calculadora de proyecciones) - se puede elegir otro si
// el cruce corresponde a un período distinto.
async function cargarNomencladoresParaCruza(){
  var sel = document.getElementById('czNomenclador');
  if (!sel) return;
  try {
    var r = await fetch('/api/nomencladores');
    var data = await r.json();
    var lista = data.nomencladores || [];
    var opts = '<option value="">' + (data.activePeriod ? ('Activo (' + esc(data.label || data.activePeriod) + ')') : 'Sin nomenclador cargado') + '</option>';
    opts += lista.map(function(n){ return '<option value="' + esc(n.value) + '">' + esc(n.label) + '</option>'; }).join('');
    sel.innerHTML = opts;
  } catch(e){}
}
function onCambiaClienteCruzas(){
  CZ.cruceActivo = null;
  document.getElementById('czResultado').style.display = 'none';
  var slug = document.getElementById('czCliente').value;
  if (slug){ try { localStorage.setItem('ns_cruzas_cliente', slug); } catch(e){} }
  cargarHistorialCruzas();
  cargarBandejasCruza();
}
// Bandejas ya guardadas del cliente (mes en curso + meses cerrados) para elegir
// cuál usar en la cruza, en vez de tener que subir el Excel a mano.
async function cargarBandejasCruza(){
  var sel = document.getElementById('czBandejaPeriod');
  if (!sel) return;
  var slug = document.getElementById('czCliente').value;
  if (!slug){ sel.innerHTML = '<option value="">Elegí un cliente</option>'; return; }
  sel.innerHTML = '<option value="">Cargando…</option>';
  try {
    var r = await fetch('/api/cruzas/' + slug + '/bandejas');
    var data = {}; try { data = await r.json(); } catch(e){}
    var periods = (data && data.periods) || [];
    if (!periods.length){ sel.innerHTML = '<option value="">Este cliente no tiene bandejas guardadas</option>'; return; }
    sel.innerHTML = periods.map(function(b){
      var extra = b.live ? ' (actual)' : '';
      var n = b.count ? (' · ' + b.count + ' filas') : '';
      return '<option value="' + esc(b.period) + '">' + esc(b.label || b.period) + extra + n + '</option>';
    }).join('');
  } catch(e){
    sel.innerHTML = '<option value="">No se pudieron cargar las bandejas</option>';
  }
}
function marcarArchivoElegido(inputId, spanId){
  var inp = document.getElementById(inputId), span = document.getElementById(spanId);
  var f = inp && inp.files && inp.files[0];
  if (span) span.textContent = f ? f.name : '';
}
async function cargarHistorialCruzas(){
  var slug = document.getElementById('czCliente').value;
  var box = document.getElementById('czHistorial');
  if (!slug){ box.textContent = 'Elegí un cliente arriba.'; return; }
  box.textContent = 'Cargando…';
  var r = await fetch('/api/cruzas/' + slug);
  var data = {}; try { data = await r.json(); } catch(e){}
  if (!r.ok){ box.textContent = data.error || 'No se pudo cargar.'; return; }
  var cruces = data.cruces || [];
  if (!cruces.length){ box.textContent = 'Todavía no hay ningún cruce para este cliente.'; return; }
  box.innerHTML = cruces.map(function(c){
    var fecha = new Date(c.createdAt).toLocaleString('es-AR');
    var estado = c.status === 'confirmado' ? '<span class="cz-tag ok">Confirmado</span>' : '<span class="cz-tag">Borrador</span>';
    var res = c.resumen || {};
    var chips = CZ_COLORES.map(function(k){ var n = res[k.toLowerCase()] || 0; return n ? ('<span class="cz-chip cz-chip-mini cz-chip-' + k.toLowerCase() + '">' + n + '</span>') : ''; }).join(' ');
    return '<div class="cz-historial-item" onclick="abrirCruce(\'' + esc(c.id) + '\')" style="cursor:pointer;padding:10px 0;border-bottom:1px solid var(--line)">' +
      '<b>' + esc(c.label) + '</b> ' + estado + ' <span class="nom-muted">' + fecha + ' · ' + c.ausentesCount + ' ausentes · ' + c.faltaOmeCount + ' falta ome</span><br>' + chips +
      '</div>';
  }).join('');
}
async function cruzarAhora(){
  var slug = document.getElementById('czCliente').value;
  var err = document.getElementById('czError');
  err.style.display = 'none';
  if (!slug){ err.textContent = 'Elegí un cliente.'; err.style.display = 'block'; return; }
  var agenda = document.getElementById('czFileAgenda').files[0];
  var bandejaPeriod = (document.getElementById('czBandejaPeriod') || {}).value || '';
  if (!agenda){ err.textContent = 'Subí el Listado de consultas.'; err.style.display = 'block'; return; }
  if (!bandejaPeriod){ err.textContent = 'Elegí la bandeja de transmisión que querés cruzar.'; err.style.display = 'block'; return; }
  var btn = document.getElementById('czCruzarBtn'); btn.disabled = true; var textoOrig = btn.textContent; btn.textContent = 'Cruzando…';
  try {
    var fd = new FormData();
    fd.append('agenda', agenda);
    fd.append('bandejaPeriod', bandejaPeriod);
    fd.append('label', document.getElementById('czLabel').value || '');
    fd.append('nomencladorPeriod', document.getElementById('czNomenclador').value || '');
    var r = await fetch('/api/cruzas/' + slug + '/cruzar', { method:'POST', body: fd });
    var data = {}; try { data = await r.json(); } catch(e){}
    if (!r.ok){ err.textContent = data.error || 'No se pudo procesar el cruce.'; err.style.display = 'block'; return; }
    CZ.cruceActivo = data;
    document.getElementById('czFileAgenda').value = ''; document.getElementById('czLabel').value = '';
    document.getElementById('czNombreAgenda').textContent = '';
    renderCruceActivo();
    await cargarHistorialCruzas();
  } finally {
    btn.disabled = false; btn.textContent = textoOrig;
  }
}
async function abrirCruce(id){
  var slug = document.getElementById('czCliente').value;
  var r = await fetch('/api/cruzas/' + slug + '/' + id);
  var data = {}; try { data = await r.json(); } catch(e){}
  if (!r.ok) { nsAlert(data.error || 'No se pudo abrir el cruce.'); return; }
  CZ.cruceActivo = data;
  renderCruceActivo();
  document.getElementById('czResultado').scrollIntoView({ behavior:'smooth', block:'start' });
}
function renderCruceActivo(){
  var c = CZ.cruceActivo;
  document.getElementById('czResultado').style.display = c ? '' : 'none';
  if (!c) return;
  CZ.filtroColor = null;
  CZ.paginaPacientes = 1;
  CZ.paginaAusentes = 1;
  var buscar = document.getElementById('czBuscar'); if (buscar) buscar.value = '';
  document.getElementById('czResTitulo').textContent = c.label;
  document.getElementById('czEstadoBadge').innerHTML = c.status === 'confirmado'
    ? ('Confirmado el ' + new Date(c.confirmedAt).toLocaleString('es-AR'))
    : 'Borrador - todavía sin confirmar';
  document.getElementById('czConfirmarBtn').style.display = c.status === 'confirmado' ? 'none' : '';
  document.getElementById('czPdfBtn').disabled = c.status !== 'confirmado';
  document.getElementById('czPdfBtn').title = c.status === 'confirmado' ? '' : 'Confirmá el cruce primero';

  czRenderPacientesTabla();
  renderFaltaOmeTable();
  czRenderAusentesTabla();
}
function czRenderAusentesTabla(){
  var c = CZ.cruceActivo; if (!c) return;
  var ausentes = c.ausentes || [];
  var info = czPaginaSlice(ausentes, CZ.paginaAusentes);
  CZ.paginaAusentes = info.page;
  var ausBody = document.getElementById('czAusentesBody');
  ausBody.innerHTML = info.slice.map(function(a){
    var val = (a.valor || 0) > 0 ? moneyFmt(a.valor) : '<span class="nom-muted">—</span>';
    return '<tr><td>' + esc(a.beneficio) + '</td><td>' + esc(a.nombre) + '</td><td>' + esc(a.practica) + '</td><td>' + esc(a.turno) + '</td><td class="num">' + val + '</td></tr>';
  }).join('') || '<tr><td colspan="5" class="nom-muted">Ningún no-show detectado en este cruce.</td></tr>';
  var pagBox = document.getElementById('czAusentesPaginador');
  if (pagBox) pagBox.innerHTML = czPaginadorHtml(info, 'czIrAPaginaAusentes');
}
function czIrAPaginaAusentes(p){ CZ.paginaAusentes = p; czRenderAusentesTabla(); }
// Chips de resumen: clickeables, filtran la tabla por color. Tocar el color ya
// activo lo saca (vuelve a "todos"). El buscador de texto se combina con el
// color elegido (los dos filtros aplican juntos).
function czRenderPacientesTabla(){
  var c = CZ.cruceActivo; if (!c) return;
  var chips = document.getElementById('czResumenChips');
  chips.innerHTML = CZ_COLORES.map(function(k){
    var n = (c.resumen && c.resumen[k.toLowerCase()]) || 0;
    var on = CZ.filtroColor === k ? ' on' : '';
    return '<button type="button" class="cz-chip cz-chip-' + k.toLowerCase() + on + '" title="' + k + '" onclick="czFiltrarPorColor(\'' + k + '\')">' + n + '</button>';
  }).join('');

  var q = calcNorm((document.getElementById('czBuscar') || {}).value || '').trim();
  var leyenda = document.getElementById('czFiltroActivo');
  if (leyenda && !leyenda.dataset.wired){
    leyenda.dataset.wired = '1';
    leyenda.innerHTML = CZ_LEYENDA.map(function(x){
      return '<span class="cz-leyenda-item"><span class="cz-swatch cz-swatch-tiny cz-swatch-' + x[0].toLowerCase() + '"></span>' + x[1] + '</span>';
    }).join('');
  }

  var pares = c.pacientes.map(function(p, i){ return [i, p]; }).filter(function(par){
    var p = par[1];
    if (CZ.filtroColor && p.color !== CZ.filtroColor) return false;
    if (q && calcNorm(p.nombre + ' ' + p.dni + ' ' + p.beneficio).indexOf(q) < 0) return false;
    return true;
  });
  var info = czPaginaSlice(pares, CZ.paginaPacientes);
  CZ.paginaPacientes = info.page;

  var body = document.getElementById('czPacientesBody');
  body.innerHTML = info.slice.map(function(par){
    var i = par[0], p = par[1];
    return '<tr>' +
      '<td>' + esc(p.beneficio) + '</td><td>' + esc(p.dni) + '</td><td>' + esc(p.nombre) + '</td><td>' + esc(p.especialidades) + '</td>' +
      '<td><button type="button" class="cz-swatch cz-swatch-' + p.color.toLowerCase() + '" title="' + p.color + ' - tocar para cambiar" onclick="czTogglePicker(event,' + i + ')"></button></td>' +
      '<td><input class="inp" value="' + esc(p.detalle) + '" oninput="cambiarDetallePaciente(' + i + ',this.value)"></td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="6" class="nom-muted">Ningún paciente coincide con el filtro.</td></tr>';
  var pagBox = document.getElementById('czPacientesPaginador');
  if (pagBox) pagBox.innerHTML = czPaginadorHtml(info, 'czIrAPaginaPacientes');
}
function czIrAPaginaPacientes(p){ CZ.paginaPacientes = p; czRenderPacientesTabla(); }
function czFiltrarPorColor(color){
  CZ.filtroColor = (CZ.filtroColor === color) ? null : color;
  CZ.paginaPacientes = 1;
  czRenderPacientesTabla();
}
function czAplicarFiltros(){ CZ.paginaPacientes = 1; czRenderPacientesTabla(); }
// Selector de color por fila: en vez de un <select> con el nombre escrito (el
// color ya alcanza para leerlo), un pill de color + un popover chico con las
// 5 opciones al tocarlo.
function czTogglePicker(ev, i){
  ev.stopPropagation();
  var pop = document.getElementById('czColorPopover');
  if (CZ._pickerFor === i && pop.style.display !== 'none'){ czCerrarPicker(); return; }
  CZ._pickerFor = i;
  pop.innerHTML = CZ_COLORES.map(function(k){
    return '<button type="button" class="cz-swatch cz-swatch-' + k.toLowerCase() + ' cz-swatch-lg" title="' + k + '" onclick="czElegirColor(' + i + ',\'' + k + '\')"></button>';
  }).join('');
  var r = ev.currentTarget.getBoundingClientRect();
  pop.style.left = Math.round(r.left) + 'px';
  pop.style.top = Math.round(r.bottom + 6) + 'px';
  pop.style.display = 'flex';
}
function czCerrarPicker(){ var pop = document.getElementById('czColorPopover'); if (pop) pop.style.display = 'none'; CZ._pickerFor = -1; }
document.addEventListener('click', function(e){ var pop = document.getElementById('czColorPopover'); if (pop && pop.style.display !== 'none' && !pop.contains(e.target)) czCerrarPicker(); });
function czElegirColor(i, valor){
  cambiarColorPaciente(i, valor);
  czCerrarPicker();
}
function cambiarColorPaciente(i, valor){
  CZ.cruceActivo.pacientes[i].color = valor;
  var c = CZ.cruceActivo;
  c.resumen = { verde:0, amarillo:0, naranja:0, rojo:0, gris:0 };
  c.pacientes.forEach(function(p){ c.resumen[p.color.toLowerCase()] = (c.resumen[p.color.toLowerCase()]||0) + 1; });
  czRenderPacientesTabla();
}
function cambiarDetallePaciente(i, valor){ CZ.cruceActivo.pacientes[i].detalle = valor; }
// CSV liviano solo con "Ausentes" (la tabla completa con colores ya está en
// "Descargar Excel" - esto es para pasarle rápido la lista de no-shows a
// alguien sin tener que abrir todo el libro).
// Antes armaba un CSV plano del lado del navegador: sin estilo, columnas sin
// acomodar, y Excel reinterpretaba el N° de beneficio (14 dígitos) como
// número (notación científica). Ahora baja el mismo Excel con estilo NS que
// arma el servidor (buildAusentesWorkbook en server.js).
function descargarAusentesExcel(){
  var c = CZ.cruceActivo; if (!c) return;
  var slug = document.getElementById('czCliente').value;
  window.open('/api/cruzas/' + slug + '/' + c.id + '/export-ausentes.xlsx', '_blank');
}
function renderFaltaOmeTable(){
  var c = CZ.cruceActivo;
  var body = document.getElementById('czFaltaOmeBody');
  var auto = (c.faltaOmeAuto || []).map(function(f){
    return '<tr class="nom-muted"><td>' + esc(f.turno) + '</td><td>' + esc(f.especialidad) + '</td><td>' + esc(f.nombre) + '</td><td>' + esc(f.beneficio) + '</td><td>' + esc(f.obs) + '</td><td></td></tr>';
  }).join('');
  var manual = (c.faltaOmeManual || []).map(function(f, i){
    return '<tr>' +
      '<td><input class="inp" value="' + esc(f.turno) + '" oninput="cambiarFaltaOmeManual(' + i + ',\'turno\',this.value)"></td>' +
      '<td><input class="inp" value="' + esc(f.especialidad) + '" oninput="cambiarFaltaOmeManual(' + i + ',\'especialidad\',this.value)"></td>' +
      '<td><input class="inp" value="' + esc(f.nombre) + '" oninput="cambiarFaltaOmeManual(' + i + ',\'nombre\',this.value)"></td>' +
      '<td><input class="inp" value="' + esc(f.beneficio) + '" oninput="cambiarFaltaOmeManual(' + i + ',\'beneficio\',this.value)"></td>' +
      '<td><input class="inp" value="' + esc(f.obs) + '" oninput="cambiarFaltaOmeManual(' + i + ',\'obs\',this.value)"></td>' +
      '<td><button class="icon-danger-btn mini" title="Quitar" onclick="quitarFilaFaltaOme(' + i + ')">×</button></td>' +
    '</tr>';
  }).join('');
  body.innerHTML = (auto + manual) || '<tr><td colspan="6" class="nom-muted">Nada por ahora - buena señal.</td></tr>';
}
function agregarFilaFaltaOme(){
  var c = CZ.cruceActivo; if (!c) return;
  if (!c.faltaOmeManual) c.faltaOmeManual = [];
  c.faltaOmeManual.push({ turno:'', especialidad:'', nombre:'', beneficio:'', obs:'' });
  renderFaltaOmeTable();
}
function quitarFilaFaltaOme(i){ CZ.cruceActivo.faltaOmeManual.splice(i, 1); renderFaltaOmeTable(); }
function cambiarFaltaOmeManual(i, campo, valor){ CZ.cruceActivo.faltaOmeManual[i][campo] = valor; }
async function guardarEdicionesCruce(){
  var c = CZ.cruceActivo; if (!c) return;
  var slug = document.getElementById('czCliente').value;
  var btn = document.getElementById('czGuardarBtn'); var textoOrig = btn.textContent; btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    var body = {
      pacientes: c.pacientes.map(function(p){ return { beneficio: p.beneficio, color: p.color, detalle: p.detalle }; }),
      faltaOmeManual: c.faltaOmeManual || [],
    };
    var r = await fetch('/api/cruzas/' + slug + '/' + c.id, { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
    var data = {}; try { data = await r.json(); } catch(e){}
    if (!r.ok){ nsAlert(data.error || 'No se pudo guardar.'); return; }
    CZ.cruceActivo = data; renderCruceActivo();
    await cargarHistorialCruzas();
  } finally { btn.disabled = false; btn.textContent = textoOrig; }
}
async function confirmarCruce(){
  var c = CZ.cruceActivo; if (!c) return;
  if (!await nsConfirm('Guardá los cambios pendientes antes si hiciste alguna corrección.', { titulo:'Confirmar cruce', okLabel:'Confirmar' })) return;
  var slug = document.getElementById('czCliente').value;
  var r = await fetch('/api/cruzas/' + slug + '/' + c.id + '/confirmar', { method:'POST' });
  var data = {}; try { data = await r.json(); } catch(e){}
  if (!r.ok){ nsAlert(data.error || 'No se pudo confirmar.'); return; }
  CZ.cruceActivo = data; renderCruceActivo();
  await cargarHistorialCruzas();
}
async function eliminarCruceActual(){
  var c = CZ.cruceActivo; if (!c) return;
  if (!await nsConfirm('Se elimina este cruce (' + c.label + '). No se puede deshacer.', { titulo:'Eliminar cruce', okLabel:'Eliminar', peligro:true })) return;
  var slug = document.getElementById('czCliente').value;
  await fetch('/api/cruzas/' + slug + '/' + c.id, { method:'DELETE' });
  CZ.cruceActivo = null;
  document.getElementById('czResultado').style.display = 'none';
  await cargarHistorialCruzas();
}
function descargarCruceExcel(){
  var c = CZ.cruceActivo; if (!c) return;
  var slug = document.getElementById('czCliente').value;
  window.open('/api/cruzas/' + slug + '/' + c.id + '/export.xlsx', '_blank');
}
// PDF final (mismo mecanismo que OSDOP: armar el bloque solo-impresión y
// window.print()). Se arma acá, no en el servidor, para reusar el mismo CSS
// de impresión que ya tiene la web.
function czMesDe(turno){
  var meses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(turno||''));
  return m ? meses[parseInt(m[2], 10) - 1] || '' : '';
}
function czTotalValor(arr){ return (arr || []).reduce(function(s, f){ return s + (f.valor || 0); }, 0); }
// Fila de TOTAL al pie de una tabla del PDF: nadie debería tener que sumar
// a mano 200 filas para saber cuánto hay en juego en cada sección.
function czFilaTotalHtml(colspan, items, totalNoun){
  var total = czTotalValor(items);
  var conValor = items.filter(function(f){ return (f.valor || 0) > 0; }).length;
  var etiqueta = 'TOTAL (' + items.length + ' ' + totalNoun + (conValor !== items.length ? ' · ' + conValor + ' valorizados' : '') + ')';
  return '<tr class="cz-print-total"><td colspan="' + colspan + '">' + esc(etiqueta) + '</td><td class="num">' + moneyFmt(total) + '</td></tr>';
}
function exportarCrucePDF(){
  var c = CZ.cruceActivo; if (!c || c.status !== 'confirmado') return;

  var faltaInforme = c.faltaInforme || [];
  var infHtml;
  if (!faltaInforme.length) {
    infHtml = '<p class="cz-print-vacio">Nada pendiente de transmitir.</p>';
  } else {
    var porMes = {};
    faltaInforme.forEach(function(f){ var mes = czMesDe(f.turno) || 'SIN FECHA'; (porMes[mes] = porMes[mes] || []).push(f); });
    var infFilas = Object.keys(porMes).map(function(mes){
      var cab = '<tr><td colspan="5" class="cz-print-mes">' + esc(mes) + '</td></tr>';
      var filas = porMes[mes].map(function(f){
        var val = (f.valor || 0) > 0 ? moneyFmt(f.valor) : '—';
        return '<tr><td class="centro">' + esc(f.beneficio) + '</td><td>' + esc(f.nombre) + '</td><td>' + esc(f.practica) + '</td><td class="centro">' + esc(f.turno) + '</td><td class="num">' + val + '</td></tr>';
      }).join('');
      return cab + filas;
    }).join('');
    infHtml = '<table><thead><tr><th>Beneficio</th><th>Nombre</th><th>Práctica</th><th>Turno</th><th class="num">Valor</th></tr></thead><tbody>' +
      infFilas + czFilaTotalHtml(4, faltaInforme, 'prácticas') + '</tbody></table>';
  }

  var ausentes = c.ausentes || [];
  var ausHtml;
  if (!ausentes.length) {
    ausHtml = '<p class="cz-print-vacio">Ningún no-show detectado.</p>';
  } else {
    var ausFilas = ausentes.map(function(a){
      var val = (a.valor || 0) > 0 ? moneyFmt(a.valor) : '—';
      return '<tr><td class="centro">' + esc(a.beneficio) + '</td><td>' + esc(a.nombre) + '</td><td>' + esc(a.practica) + '</td><td class="centro">' + esc(a.turno) + '</td><td class="num">' + val + '</td></tr>';
    }).join('');
    ausHtml = '<table><thead><tr><th>Beneficio</th><th>Nombre</th><th>Práctica</th><th>Turno</th><th class="num">Valor</th></tr></thead><tbody>' +
      ausFilas + czFilaTotalHtml(4, ausentes, 'turnos') + '</tbody></table>';
  }

  // Sin columna Valor: acá no hay un código de práctica confiable (las
  // manuales son una obs libre, no un código) - mismo criterio que en el Excel.
  var ome = [].concat(c.faltaOmeAuto || [], c.faltaOmeManual || []);
  var omeHtml;
  if (!ome.length) {
    omeHtml = '<p class="cz-print-vacio">Nada pendiente.</p>';
  } else {
    var omeFilas = ome.map(function(f){
      return '<tr><td class="centro">' + esc(f.turno) + '</td><td>' + esc(f.especialidad) + '</td><td>' + esc(f.nombre) + '</td><td class="centro">' + esc(f.beneficio) + '</td><td>' + esc(f.obs) + '</td></tr>';
    }).join('');
    omeHtml = '<table><thead><tr><th>Turno</th><th>Especialidad</th><th>Nombre</th><th>Beneficio</th><th>Obs</th></tr></thead><tbody>' + omeFilas + '</tbody></table>';
  }

  // El PDF es el resumen: una barra con los 3 conteos y el total valorizado
  // en riesgo, antes de entrar al detalle fila por fila. Falta ome no suma acá
  // (no tiene columna de Valor - ver arriba).
  var granTotal = czTotalValor(faltaInforme) + czTotalValor(ausentes);
  var resumenHtml =
    '<div class="cz-print-resumen">' +
      '<div><b>' + faltaInforme.length + '</b><span>Falta informe</span></div>' +
      '<div><b>' + ausentes.length + '</b><span>Ausentes</span></div>' +
      '<div><b>' + ome.length + '</b><span>Falta ome</span></div>' +
      '<div class="cz-print-resumen-total"><b>' + moneyFmt(granTotal) + '</b><span>Valorizado en riesgo</span></div>' +
    '</div>';

  var clienteNombre = document.getElementById('czCliente').selectedOptions[0].textContent;
  document.getElementById('czPrintArea').innerHTML =
    '<div class="cz-print-head"><div class="op-title">' + esc(clienteNombre) + ' — ' + esc(c.label) + '</div></div>' +
    resumenHtml +
    '<section><h3>Falta informe</h3>' + infHtml + '</section>' +
    '<section><h3>Ausentes</h3>' + ausHtml + '</section>' +
    '<section><h3>Falta ome</h3>' + omeHtml + '</section>';

  // #czPrintArea vive fuera de #root (ver index.html): esta clase oculta #root
  // entero con display:none mientras se imprime, así no queda ocupando alto y
  // generando páginas en blanco después del contenido real (ver styles.css).
  document.body.classList.add('cz-imprimiendo');
  var limpiar = function(){ document.body.classList.remove('cz-imprimiendo'); };
  if (window.matchMedia) {
    var mq = window.matchMedia('print');
    var onMq = function(ev){
      if (ev.matches) return;
      limpiar();
      if (mq.removeEventListener) mq.removeEventListener('change', onMq); else mq.removeListener(onMq);
    };
    if (mq.addEventListener) mq.addEventListener('change', onMq); else mq.addListener(onMq);
  }
  window.onafterprint = limpiar;
  setTimeout(limpiar, 30000); // red de seguridad si el navegador no dispara ningún evento
  window.print();
}

// ===== Capita del afiliado (Mi Cartilla PAMI): médico de cabecera, internación
// y demás módulos con prestador fijo asignado. Beneficio+DNI siempre vienen de
// una fila ya cargada (padrón); no se le pide nada más al operador. =====
function closeCapitaModal(){ hideModal('capitaModal', 'capitaScrim'); }
function capitaModuloCardHtml(m, destacado){
  var cls = 'capita-card' + (destacado ? ' capita-card--destacado' : '');
  if (m.error) {
    return '<div class="' + cls + '"><div class="capita-card-modulo">' + esc(m.moduloNombre) + '</div><div class="capita-card-vacio">No se pudo consultar (' + esc(m.error) + ').</div></div>';
  }
  if (!m.asignado) {
    return '<div class="' + cls + '"><div class="capita-card-modulo">' + esc(m.moduloNombre) + '</div><div class="capita-card-vacio">Sin prestador asignado.</div></div>';
  }
  var a = m.asignado;
  var red = m.total > 1 ? ' <span class="capita-card-red">+ ' + (m.total - 1) + ' más en la red</span>' : '';
  return '<div class="' + cls + '">'
    + '<div class="capita-card-modulo">' + esc(a.moduloPami || a.modulo || m.moduloNombre) + '</div>'
    + '<div class="capita-card-prestador">' + esc(a.prestador) + '</div>'
    + (a.direccion ? '<div class="capita-card-dato">📍 ' + esc(a.direccion) + '</div>' : '')
    + (a.telefono ? '<div class="capita-card-dato">📞 ' + esc(a.telefono) + '</div>' : '')
    + red
    + '</div>';
}
// Consulta manual desde los dos campos de arriba de la tabla: no depende de que
// el afiliado ya esté cargado en el padrón (a veces no lo está, o el cliente
// elegido no tiene su turnera subida todavía).
function consultarCapitaManual(){
  var err = document.getElementById('capitaManualError'); if (err) err.textContent = '';
  var dni = (document.getElementById('capitaDni').value || '').replace(/\D+/g, '');
  var benef = (document.getElementById('capitaBenef').value || '').replace(/\D+/g, '');
  if (!dni || !benef) { if (err) err.textContent = 'Completá DNI y N° de afiliación.'; return; }
  verCapitaAfiliado('', dni, benef);
}
async function verCapitaAfiliado(nombre, dni, beneficio){
  var meta = document.getElementById('capitaModalMeta');
  var content = document.getElementById('capitaModalContent');
  if (meta) meta.textContent = (nombre || 'Afiliado') + ' — DNI ' + dni + ' · Beneficio ' + beneficio;
  if (content) content.innerHTML = '<div class="capita-loading">Consultando PAMI…</div>';
  showModal('capitaModal', 'capitaScrim');
  var r = await req('POST', '/api/pami/capita', { dni: dni, beneficio: beneficio });
  if (!content) return;
  if (!r.ok) {
    content.innerHTML = '<div class="msg err">' + esc((r.data && r.data.error) || 'No se pudo consultar PAMI.') + '</div>';
    return;
  }
  var modulos = r.data.modulos || [];
  var destacados = modulos.filter(function(m){ return m.prioridad; });
  var resto = modulos.filter(function(m){ return !m.prioridad; });
  // Nombre visible del módulo cuando no hay asignado (asignado==null no trae
  // nombre propio): lo completamos acá mismo antes de renderizar, a partir del
  // orden fijo con el que el server ya arma la lista.
  var nombresFallback = ['Médico o médica de cabecera', 'Internación', 'Kinesiología', 'Radiocirugía', 'Laboratorio', 'Laboratorio de alta complejidad', 'Estudios diagnósticos', 'Estudios neurológicos de alta complejidad', 'PET', 'Spect cerebral', 'Centellograma', 'Odontóloga u odontólogo de cabecera', 'Centro Integral de Salud Mental', 'Guardia de Salud Mental', 'Urgencia Domiciliaria en Salud Mental', 'Solicitar traslado', 'Urgencias médicas', 'Radioterapia'];
  modulos.forEach(function(m, i){ m.moduloNombre = (m.asignado && (m.asignado.moduloPami || m.asignado.modulo)) || nombresFallback[i] || ('Módulo ' + (i + 1)); });
  var html = '<div class="capita-destacados">' + destacados.map(function(m){ return capitaModuloCardHtml(m, true); }).join('') + '</div>';
  if (resto.length) {
    html += '<div class="capita-resto-head">Resto de los módulos capitados</div>'
      + '<div class="capita-resto">' + resto.map(function(m){ return capitaModuloCardHtml(m, false); }).join('') + '</div>';
  }
  content.innerHTML = html;
}

// ===== Cabina de informes recibidos (admin) =====
var CAB_ITEMS = [];      // items del cliente actual (para abrir el modal sin re-fetch)
var CAB_ITEM = null;     // item abierto en el modal
// Los chips del resumen son CHECKBOXES (multi-selección): cada uno prende/apaga
// si ese estado se muestra en la tabla. Por defecto se ESCONDEN los estados
// "ruidosos" (ya transmitido + desestimado): son cientos y no hay nada que hacer
// con ellos; todo lo demás (lo accionable) se muestra. La elección queda guardada
// en el navegador, por usuario.
var CAB_OCULTOS_DEFAULT = ['ya_transmitido', 'desestimado'];
function cabOcultosKey(){ return 'ns-cabina-ocultos-' + (ME && ME.username || ''); }
function cabEstadosOcultos(){
  try { var v = JSON.parse(localStorage.getItem(cabOcultosKey()) || 'null'); if (Array.isArray(v)) return v; } catch(e){}
  return CAB_OCULTOS_DEFAULT.slice();
}
function cabGuardarOcultos(arr){ try { localStorage.setItem(cabOcultosKey(), JSON.stringify(arr)); } catch(e){} }
function cabEstadoOculto(k){ return cabEstadosOcultos().indexOf(k) >= 0; }
// Buscador de paciente (nombre, DNI, archivo u OME). Vacío = no filtra.
var CAB_BUSCAR = '';
function cabSetBuscar(v){ CAB_BUSCAR = String(v || '').trim().toLowerCase(); aplicarFiltroCabina(); }
function cabMatchBusca(it){
  if (!CAB_BUSCAR) return true;
  var ex = it.extract || {};
  var omes = (it.resuelto && it.resuelto.omes) ? it.resuelto.omes.join(' ') : ((it.match && it.match.ome) || '');
  var hay = [ex.nombre, ex.dni, it.filename, omes].join(' ').toLowerCase();
  return hay.indexOf(CAB_BUSCAR) >= 0;
}
async function loadCabinaView(){
  var sel = document.getElementById('cabCliente');
  if (sel && !sel.options.length){
    var list = await clientesParaSelector();
    // Solo los clientes que usan el sistema de informes. Scheffelaar y
    // Dubesarky (médicos de cabecera) suman OMEs acá también - por ahora se
    // cargan a mano, más adelante entran solas varias veces por día.
    // Cuando se sume otro cliente, agregar su slug acá.
    var CON_INFORMES = ['caballito-pediatrico', 'scheffelaar-mc', 'dubesarky-ezequiel'];
    list.filter(function(c){ return CON_INFORMES.indexOf(c.slug) >= 0; })
        .forEach(function(c){ var o = document.createElement('option'); o.value = c.slug; o.textContent = c.name || c.slug; sel.appendChild(o); });
  }
  // Las fechas también filtran qué informes se muestran (no solo la bajada del mail).
  ['cabDesde','cabHasta'].forEach(function(id){
    var el = document.getElementById(id);
    if (el && !el._cabHooked){ el._cabHooked = true; el.addEventListener('change', function(){ guardarRangoCabina(); aplicarFiltroCabina(); }); }
  });
  await cargarEstadoMail();
  await refreshCabina();
}
// El rango de fechas queda guardado EN ESTE NAVEGADOR: al volver a entrar sigue el
// último que elegiste, en vez de saltar a hoy y perder el filtro cada vez.
function guardarRangoCabina(){
  try {
    localStorage.setItem('ns-cabina-rango', JSON.stringify({
      desde: (document.getElementById('cabDesde') || {}).value || '',
      hasta: (document.getElementById('cabHasta') || {}).value || '',
    }));
  } catch (e) {}
}
function rangoCabinaGuardado(){
  try { return JSON.parse(localStorage.getItem('ns-cabina-rango') || 'null'); } catch (e) { return null; }
}
// Descarga la cabina en Excel o PDF (para compartir con el socio). El endpoint
// manda el archivo como adjunto; el navegador lo baja con la cookie de sesión.
function descargarCabina(fmt){
  var slug = document.getElementById('cabCliente').value;
  if (!slug){ return; }
  var a = document.createElement('a');
  a.href = '/api/clientes/' + slug + '/informes/export.' + fmt;
  document.body.appendChild(a); a.click(); a.remove();
}
// Informes a mandar a PAMI: los que se están VIENDO (filtrados por fecha y, si hay
// un chip de estado prendido, por ese estado — auditar/subir lo que tenés en
// pantalla, no todo el rango). Para subir, además solo los "listo para subir".
function cabIdsParaTarea(tipo){
  var de=(document.getElementById('cabDesde')||{}).value||'', ha=(document.getElementById('cabHasta')||{}).value||'';
  var vis=CAB_ITEMS.filter(function(it){ var f=cabFecha(it); if(!f)return true; if(de&&f<de)return false; if(ha&&f>ha)return false; return true; });
  // Solo lo que se está VIENDO: estados no ocultos + lo que matchee el buscador.
  vis=vis.filter(function(it){ return !cabEstadoOculto(cabEstadoDe(it)) && cabMatchBusca(it); });
  if (tipo==='subir-informes'){
    return vis.filter(function(it){ var e=cabEstadoDe(it); return e==='ok'||e==='resuelto'; }).map(function(it){return it.id;});
  }
  return vis.map(function(it){return it.id;});
}
// Subir UN informe suelto a PAMI (botón 📤 de la fila) — misma cola que el masivo,
// pero con un solo informeId.
async function subirInformeUno(id){
  var slug=document.getElementById('cabCliente').value; if(!slug){ nsAlert('Elegí un cliente.'); return; }
  var it=(CAB_ITEMS||[]).find(function(x){ return x.id===id; });
  var nom=(it&&it.extract&&it.extract.nombre)||'este informe';
  var omesArr=(it&&it.resuelto&&(it.resuelto.omes||(it.resuelto.ome?[it.resuelto.ome]:[])))||(it&&it.match&&it.match.ome?[it.match.ome]:[]);
  var ome=omesArr.join(', ');
  if(!await nsConfirm('', { titulo:'Subir a PAMI', cuerpoHtml:'<b>'+esc(nom)+'</b>'+(ome?(' · OME '+esc(ome)):'')+'<br><br>Se sube a PAMI. Es real e irreversible.', okLabel:'Subir' })) return;
  cabEstado('Preparando…','working');
  try{
    var r=await fetch('/api/admin/worker/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'subir-informes',clientSlug:slug,payload:{informeIds:[id]}})});
    var d=await r.json();
    if(!r.ok){ cabEstado('',''); nsAlert(d.error||'No se pudo crear la tarea.'); return; }
    seguirTarea(d.task.id,'subir-informes');
  }catch(e){ cabEstado('',''); nsAlert('Error de red al crear la tarea.'); }
}
async function tareaCabina(tipo){
  var slug=document.getElementById('cabCliente').value; if(!slug){ nsAlert('Elegí un cliente.'); return; }
  var ids=cabIdsParaTarea(tipo);
  if(!ids.length){ nsAlert(tipo==='subir-informes'?'No hay informes listos para subir en este rango.':'No hay informes para auditar en este rango.'); return; }
  if(tipo==='subir-informes' && !await nsConfirm('Se suben ' + ids.length + ' informe(s) a PAMI. Es real e irreversible.', { titulo:'Subir a PAMI', okLabel:'Subir '+ids.length })) return;
  cabEstado('Preparando…','working');
  try{
    var r=await fetch('/api/admin/worker/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:tipo,clientSlug:slug,payload:{informeIds:ids}})});
    var d=await r.json();
    if(!r.ok){ cabEstado('',''); nsAlert(d.error||'No se pudo crear la tarea.'); return; }
    seguirTarea(d.task.id, tipo);
  }catch(e){ cabEstado('',''); nsAlert('Error de red al crear la tarea.'); }
}
// Limpiar (borrar del sistema) los informes YA TRANSMITIDOS hasta una fecha, para
// liberar espacio. Pide la fecha (inclusive) y confirma con el conteo antes de borrar.
async function limpiarTransmitidos(){
  var slug = document.getElementById('cabCliente').value;
  if (!slug){ nsAlert('Elegí un cliente.'); return; }
  var hoy = new Date().toISOString().slice(0,10);
  var hastaDef = (document.getElementById('cabHasta')||{}).value || hoy;
  var hasta = await nsPrompt('Borrar los YA TRANSMITIDOS con fecha hasta (inclusive):', {
    titulo: '🧹 Limpiar transmitidos', inputType: 'date', valor: hastaDef, okLabel: 'Seguir' });
  if (hasta === null || !hasta) return;
  // Conteo local para avisar antes de borrar (mismo criterio de fecha que la tabla).
  var aBorrar = (CAB_ITEMS||[]).filter(function(it){
    return cabEstadoDe(it) === 'ya_transmitido' && cabFecha(it) && cabFecha(it) <= hasta;
  }).length;
  if (!aBorrar){ nsAlert('No hay informes ya transmitidos hasta esa fecha.'); return; }
  if (!await nsConfirm('Se borran ' + aBorrar + ' informe(s) YA TRANSMITIDOS (con fecha hasta ' + hasta + ') y se liberan sus archivos. No afecta a los que faltan subir. No se puede deshacer.', { titulo:'Limpiar transmitidos', okLabel:'Borrar '+aBorrar, peligro:true })) return;
  cabEstado('Limpiando…','working');
  try{
    var r = await fetch('/api/clientes/'+slug+'/informes/limpiar-transmitidos', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ hasta: hasta }) });
    var d = await r.json();
    cabEstado('','');
    if (!r.ok){ nsAlert((d && d.error) || 'No se pudo limpiar.'); return; }
    await refreshCabina();
    nsAlert('Listo: se borraron ' + (d.borrados||0) + ' informe(s) ya transmitidos.');
  }catch(e){ cabEstado('',''); nsAlert('Error de red al limpiar.'); }
}
function seguirTarea(id, tipo){
  var accion=(tipo==='subir-informes')?'Subiendo a PAMI':'Auditando en PAMI';
  var vueltas=0;
  var timer=setInterval(async function(){
    vueltas++;
    try{
      var d=await fetch('/api/admin/worker/tasks').then(function(r){return r.json();});
      var t=(d.tasks||[]).find(function(x){return x.id===id;});
      if(!t) return;
      if(t.status==='pending'){ cabEstado('En cola'+(vueltas>6?' — puede demorar':'')+'…','working'); return; }
      if(t.status==='running'){ cabEstado(accion+'…','working'); return; }
      clearInterval(timer);
      cabEstado('','');
      if(t.status==='done'){
        mostrarResultadoTarea(tipo, t);
        await refreshCabina();
      } else {
        mostrarResultadoTarea(tipo, t);
      }
    }catch(e){}
  }, 3000);
}
function cerrarResultadoTarea(){ hideModal('taskResModal','taskResScrim'); }
// Copiar el N° de OME al portapapeles con un clic (sin abrir el informe).
function cabCopiarFallback(txt){ try{ var ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); ta.remove(); }catch(e){} }
function cabCopiarOme(el, ome){
  var txt=String(ome||'').trim();
  var restore=el.textContent;
  var ok=function(){ el.textContent='✓ copiado'; el.classList.add('copiado'); setTimeout(function(){ el.textContent=restore; el.classList.remove('copiado'); }, 1200); };
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(ok, function(){ cabCopiarFallback(txt); ok(); }); }
    else { cabCopiarFallback(txt); ok(); }
  }catch(e){ cabCopiarFallback(txt); ok(); }
}
// Estado de la tarea (subiendo/auditando) como chip visible y en castellano llano
// — nada de nombres de server ni logs internos. tipo: 'working' | 'error' | ''.
function cabEstado(texto, tipo){
  var el = document.getElementById('cabTareaEstado'); if (!el) return;
  if (!texto){ el.hidden = true; el.textContent = ''; el.className = 'cab-estado'; return; }
  el.hidden = false; el.textContent = texto; el.className = 'cab-estado' + (tipo ? (' is-' + tipo) : '');
}
// Ventana linda con el resultado de subir/auditar a PAMI (en vez del alert del navegador).
function mostrarResultadoTarea(tipo, t){
  var res = t.result || {};
  var ok = t.status === 'done';
  var titulo, resumen, filas = '';
  var row = function(ic, nombre, motivo, color){
    return '<div style="display:flex;align-items:flex-start;gap:9px;padding:7px 0;border-top:1px solid var(--border)">'
      + '<span style="flex:0 0 auto">'+ic+'</span>'
      + '<span style="flex:1;min-width:0;color:var(--text);font-size:13.5px">'+esc(nombre)+'</span>'
      + '<span style="flex:0 0 auto;font-size:12px;color:'+(color||'var(--text-2)')+';text-align:right;max-width:55%">'+esc(motivo)+'</span></div>';
  };
  if (!ok){
    titulo = '❌ La tarea falló';
    resumen = '<span style="color:#dc2626">'+esc(t.error||'error del worker.')+'</span>';
  } else if (tipo === 'subir-informes'){
    var det = res.detalle || [];
    var subidos = res.subidos || 0, total = res.total || det.length;
    titulo = '📤 Subida a PAMI';
    resumen = '<b>'+subidos+'</b> de <b>'+total+'</b> informe(s) transmitidos'
      + (subidos < total ? ' · <span style="color:#b45309">'+(total-subidos)+' con problema</span>' : ' ✅');
    filas = det.map(function(d){
      var okd = ['transmitido','ya_transmitido'].indexOf(d.estado) >= 0;
      var etq = d.estado==='ya_transmitido' ? 'ya estaba transmitido' : (okd ? 'transmitido' : (d.motivo || d.estado || 'sin subir'));
      return row(okd?'✅':'⚠️', d.filename || ('OME '+(d.ome||'')), etq, okd?'#16a34a':'#b45309');
    }).join('');
  } else {
    var det2 = res.detalle || [];
    titulo = '🔎 Auditoría en PAMI';
    resumen = '<b>'+(res.con_doc||0)+'</b> de <b>'+(res.total||det2.length)+'</b> con documentación cargada.';
    filas = det2.slice(0,300).map(function(d){
      var ic = d.trans==='SI' ? '✅' : (d.doc==='SI' ? '📄' : '⚠️');
      return row(ic, d.paciente || ('OME '+(d.ome||'')), 'doc '+(d.doc||'-')+' · trans '+(d.trans||'-'), d.trans==='SI'?'#16a34a':'var(--text-2)');
    }).join('');
  }
  var ttl = document.getElementById('taskResTitle'); if (ttl) ttl.textContent = titulo;
  var body = document.getElementById('taskResBody');
  if (body) body.innerHTML =
    '<div style="font-size:14px;margin-bottom:'+(filas?'10px':'2px')+'">'+resumen+'</div>'
    + (filas ? '<div style="max-height:360px;overflow-y:auto">'+filas+'</div>' : '');
  showModal('taskResModal','taskResScrim');
}

// ===== Generar OME especialista =====
var OME_WEB = { medicos: [], taskTimer: null, searchTimer: null, lastTaskId: '', closeSearchWired: false };
function omeNotice(kind, title, text){
  var el = document.getElementById('omeNotice');
  if (!el) return;
  var icon = kind === 'ok' ? '✓' : (kind === 'err' ? '!' : (kind === 'warn' ? '!' : 'i'));
  el.className = 'lc-notice ' + (kind || 'info');
  el.innerHTML = '<div aria-hidden="true">' + esc(icon) + '</div><div><b>' + esc(title || '') + '</b><span>' + esc(text || '') + '</span></div>';
  el.style.display = 'flex';
}
function omeClearNotice(){
  var el = document.getElementById('omeNotice');
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
}
function omeClienteActual(){
  var slug = (document.getElementById('omeCliente') || {}).value || '';
  return (CLIENTS || []).find(function(c){ return c.slug === slug; }) || null;
}
// ===== Leer un pedido de OME (mensaje de WhatsApp) y completar el formulario =====
// Todo por reglas, sin IA. Cada especialidad: cómo la nombran en el mensaje (rx),
// cómo figura en el médico (med), y el código de consulta del nomenclador.
var OME_ESPECIALIDADES = [
  { key:'Cardiología',       codigo:'570129', rx:/cardiolog/,           med:/cardiolog/ },
  { key:'Neumonología',      codigo:'820157', rx:/neumonolog|neumolog/, med:/neumonolog|neumolog/ },
  { key:'Urología',          codigo:'820167', rx:/urolog/,              med:/urolog/ },
  { key:'Traumatología',     codigo:'820165', rx:/traumato|ortopedia/,  med:/traumatolog|ortopedia/ },
  { key:'Ginecología',       codigo:'820145', rx:/ginec/,               med:/ginecolog/ },
  { key:'Gastroenterología', codigo:'820139', rx:/gastro/,              med:/gastroenterolog/ },
  { key:'ORL',               codigo:'820168', rx:/\borl\b|otorrino/,    med:/otorrinolaring/ }
];
function omeNorm(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase(); }
function omeLeerPedido(texto){
  var raw = String(texto||'').trim();
  if (!raw) return null;
  var n = omeNorm(raw);
  var dni = ''; var mDni = n.match(/dni\s*[:.\-]?\s*(\d{6,9})/); if (mDni) dni = mDni[1];
  var benef = ''; var mBen = n.match(/\b(\d{11,14})\b/); if (mBen) benef = mBen[1];
  // Formato corto: sin "DNI xxxx" ni beneficio largo, un número suelto de 7-9 díg = DNI.
  if (!dni && !benef){ var m2 = n.match(/\b(\d{7,9})\b/); if (m2) dni = m2[1]; }
  var esp = null; for (var i=0;i<OME_ESPECIALIDADES.length;i++){ if (OME_ESPECIALIDADES[i].rx.test(n)){ esp = OME_ESPECIALIDADES[i]; break; } }
  // Nombre por resta: saco números, "dni", relleno y las palabras de especialidad.
  var t = ' ' + raw.replace(/[,.;]/g,' ') + ' ';
  t = t.replace(/\d+/g,' ');
  var ESPSTRIP = /\b(cardiolog|neumonolog|neumolog|urolog|traumato|ortopedia|ginec|gastro|otorrino|orl)[a-zñáéíóúü]*/gi;
  var STRIP = /\b(hola|buen|buenas|buenos|dia|dias|día|días|tarde|tardes|noche|noches|necesito|necesita|necesitamos|queria|quería|quisiera|solicitar|solicito|solicitamos|pedir|pido|una|un|unas|unos|ome|omes|orden|ordenes|órden|de|del|para|el|la|los|las|al|con|sin|pcte|paciente|pac|favor|por|derivacion|derivación|me|y|se|su|le|es|este|esta|dni)\b/gi;
  t = t.replace(ESPSTRIP,' ').replace(STRIP,' ');
  var nombre = t.replace(/\s+/g,' ').trim();
  return { especialidad: esp, dni: dni, beneficio: benef, nombre: nombre, raw: raw };
}
function omeResolverMedico(esp){
  if (!esp) return { medico:null, varios:false };
  var all = (OME_WEB.medicos||[]);
  var meds = all.filter(function(m){ return esp.med.test(omeNorm(m.especialidad)); });
  var hab = function(m){ return !m.deshabilitado; };
  // Médico activo propio de la especialidad (preferido primero).
  var activo = meds.find(function(m){ return m.preferido && m.tieneClave && hab(m); })
            || meds.find(function(m){ return m.tieneClave && hab(m); });
  if (activo) return { medico: activo, varios: meds.length>1 };
  // Sin médico activo propio → comodín (cubre especialidades sin médico activo).
  var comodin = all.find(function(m){ return m.comodin && m.tieneClave && hab(m); });
  if (comodin) return { medico: comodin, varios:false, comodin:true };
  var pick = meds.find(function(m){ return hab(m); })
          || meds.find(function(m){ return m.preferido && m.tieneClave; })
          || meds.find(function(m){ return m.tieneClave; })
          || meds[0] || null;
  return { medico: pick, varios: meds.length>1 };
}
function omeParsearYCompletar(){
  var texto = (document.getElementById('omeMensaje')||{}).value || '';
  var d = omeLeerPedido(texto);
  if (!d){ omeNotice('warn','Pegá el pedido','Poné el mensaje de WhatsApp en la cajita y volvé a tocar el botón.'); return; }
  var set = function(id,val){ var el=document.getElementById(id); if (el) el.value = val; };
  set('omeNombre', d.nombre || '');
  set('omeDni', d.dni || '');
  set('omeBenef', d.beneficio || '');
  if (!(document.getElementById('omeDiagnostico')||{}).value) set('omeDiagnostico','Z000');
  var avisos = [];
  if (!d.dni && !d.beneficio) avisos.push('no encontré DNI ni beneficio');
  if (!d.nombre) avisos.push('no pude sacar el nombre');
  if (d.especialidad){
    set('omeCodigo', d.especialidad.codigo);
    set('omePractica', 'Consulta ' + d.especialidad.key + ' (' + d.especialidad.codigo + ')');
    var rm = omeResolverMedico(d.especialidad);
    if (rm.medico){ set('omeMedico', rm.medico.id);
      if (rm.medico.deshabilitado) avisos.push('el usuario de ' + rm.medico.nombre + ' está DESHABILITADO — no vas a poder crear hasta rehabilitarlo');
      else if (!rm.medico.tieneClave) avisos.push('el médico de ' + d.especialidad.key + ' (' + rm.medico.nombre + ') está SIN CLAVE — no vas a poder crear hasta cargarla');
      else if (rm.varios && !rm.medico.preferido) avisos.push('hay varios médicos de ' + d.especialidad.key + '; verificá el elegido o marcá uno como preferido');
    } else avisos.push('no hay médico de ' + d.especialidad.key + ' cargado');
  } else {
    avisos.push('no reconocí la especialidad — poné el código y el médico a mano');
  }
  var ident = d.beneficio ? ('Benef ' + d.beneficio) : (d.dni ? ('DNI ' + d.dni) : 'sin identidad');
  var resumen = 'Paciente: ' + (d.nombre||'—') + ' · ' + ident + (d.especialidad ? (' · ' + d.especialidad.key) : '');
  if (avisos.length) omeNotice('warn','Revisá antes de generar', resumen + '. Ojo: ' + avisos.join('; ') + '.');
  else omeNotice('ok','Listo para revisar', resumen + '. Confirmá y dale Generar OME.');
}
async function loadOmeWebView(){
  if (!OME_WEB.closeSearchWired) {
    document.addEventListener('click', function(ev){
      var box = document.getElementById('omeSuggestions');
      var field = document.querySelector('.ome-practice-field');
      if (box && field && !field.contains(ev.target)) box.style.display = 'none';
    });
    document.addEventListener('keydown', function(ev){
      if (ev.key === 'Escape') {
        var box = document.getElementById('omeSuggestions');
        if (box) box.style.display = 'none';
      }
    });
    OME_WEB.closeSearchWired = true;
  }
  var sel = document.getElementById('omeCliente');
  if (sel && !sel.options.length){
    try {
      var list = await clientesParaSelector();
      sel.innerHTML = list.map(function(c){ return '<option value="' + esc(c.slug) + '">' + esc(c.name || c.slug) + '</option>'; }).join('');
      try {
        var last = localStorage.getItem('ns-ome-cliente') || '';
        if (last && Array.prototype.some.call(sel.options, function(o){ return o.value === last; })) sel.value = last;
      } catch(e){}
    } catch(e){}
  }
  await onOmeClienteChange(false);
}
async function onOmeClienteChange(save){
  var slug = (document.getElementById('omeCliente') || {}).value || '';
  if (save !== false) { try { localStorage.setItem('ns-ome-cliente', slug); } catch(e){} }
  var med = document.getElementById('omeMedico');
  if (med) med.innerHTML = '<option value="">Cargando...</option>';
  omeClearNotice();
  OME_WEB.medicos = [];
  if (!slug){ if (med) med.innerHTML = '<option value="">Elegí un cliente</option>'; return; }
  try{
    var r = await fetch('/api/clientes/' + encodeURIComponent(slug) + '/medicos/publicos');
    var d = await r.json();
    if (!r.ok) throw new Error(d.error || 'No se pudieron cargar los médicos.');
    OME_WEB.medicos = d.medicos || [];
    if (med) {
      med.innerHTML = OME_WEB.medicos.length
        ? OME_WEB.medicos.map(function(m){
            return '<option value="' + esc(m.id) + '">' + esc(m.nombre || 'Sin nombre') + (m.especialidad ? ' · ' + esc(m.especialidad) : '') + (m.tieneClave ? '' : ' · sin clave') + '</option>';
          }).join('')
        : '<option value="">Sin médicos cargados</option>';
    }
  }catch(e){
    if (med) med.innerHTML = '<option value="">No disponible</option>';
    omeNotice('err', 'No se pudieron cargar médicos', e.message || String(e));
  }
}
function omeBuscarPracticasDebounced(){
  if (OME_WEB.searchTimer) clearTimeout(OME_WEB.searchTimer);
  OME_WEB.searchTimer = setTimeout(omeBuscarPracticas, 260);
}
async function omeBuscarPracticas(){
  var q = ((document.getElementById('omePractica') || {}).value || '').trim();
  var code = ((document.getElementById('omeCodigo') || {}).value || '').trim();
  var box = document.getElementById('omeSuggestions');
  var info = document.getElementById('omeNomInfo');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  if (!q && !code){ if (info) info.textContent = ''; return; }
  var params = new URLSearchParams();
  params.set('q', code || q);
  params.set('limit', '10');
  var c = omeClienteActual();
  (c && c.activeModules || []).forEach(function(m){ params.append('module', m.code || m); });
  if (info) info.textContent = 'Buscando en nomenclador...';
  try{
    var r = await fetch('/api/nomencladores/search?' + params.toString());
    var d = await r.json();
    if (!r.ok) throw new Error(d.error || 'No se pudo buscar.');
    var rows = d.rows || [];
    if (info) info.textContent = rows.length ? (rows.length + ' coincidencia(s)') : 'Sin coincidencias';
    if (!box || !rows.length) return;
    window._OME_PRACTICAS = rows;
    box.innerHTML = rows.map(function(row, i){
      var practiceCode = row.practiceCode || row.code || '';
      var practiceDescription = row.practiceDescription || row.description || '';
      return '<button type="button" onclick="omeElegirPractica(' + i + ')">'
        + '<b>' + esc(practiceCode) + '</b>'
        + '<div><div class="ome-sug-name">' + esc(practiceDescription || '-') + '</div><span class="ome-sug-module">' + esc([row.moduleCode, row.moduleDescription].filter(Boolean).join(' - ')) + '</span></div>'
        + '<span class="ome-sug-money">' + esc(moneyFmt(row.total || 0)) + '</span>'
        + '</button>';
    }).join('');
    box.style.display = '';
  }catch(e){
    if (info) info.textContent = '';
    omeNotice('err', 'No se pudo buscar la práctica', e.message || String(e));
  }
}
function omeElegirPractica(i){
  var row = (window._OME_PRACTICAS || [])[i];
  if (!row) return;
  var c = document.getElementById('omeCodigo');
  var p = document.getElementById('omePractica');
  if (c) c.value = row.practiceCode || row.code || '';
  if (p) p.value = row.practiceDescription || row.description || '';
  var box = document.getElementById('omeSuggestions'); if (box) box.style.display = 'none';
  var info = document.getElementById('omeNomInfo'); if (info) info.textContent = [row.moduleCode, row.moduleDescription].filter(Boolean).join(' - ');
}
function omePayload(){
  return {
    medicoId: (document.getElementById('omeMedico') || {}).value || '',
    beneficio: ((document.getElementById('omeBenef') || {}).value || '').trim(),
    dni: ((document.getElementById('omeDni') || {}).value || '').trim(),
    nombre: ((document.getElementById('omeNombre') || {}).value || '').trim(),
    diagnostico: ((document.getElementById('omeDiagnostico') || {}).value || '').trim() || 'Z000',
    codigo: ((document.getElementById('omeCodigo') || {}).value || '').trim(),
    practica: ((document.getElementById('omePractica') || {}).value || '').trim(),
    mensaje: ((document.getElementById('omeMensaje') || {}).value || '').trim(),
  };
}
async function crearOmeEspecialista(){
  var slug = (document.getElementById('omeCliente') || {}).value || '';
  if (!slug){ omeNotice('warn', 'Elegí un cliente', 'Primero seleccioná el centro desde donde se genera la OME.'); return; }
  var payload = omePayload();
  var faltan = [];
  if (!payload.medicoId) faltan.push('médico');
  if (!payload.beneficio && !payload.dni) faltan.push('BENEF o DNI');
  if (!payload.codigo) faltan.push('código');
  if (!payload.diagnostico) faltan.push('diagnóstico');
  if (faltan.length){ omeNotice('warn', 'Faltan datos', 'Completá ' + faltan.join(', ') + '.'); return; }
  var btn = document.getElementById('omeCrearBtn');
  var meta = document.getElementById('omeTaskMeta');
  var out = document.getElementById('omeResultado');
  if (btn) btn.disabled = true;
  if (meta) meta.textContent = 'Enviando tarea...';
  if (out) out.innerHTML = '<div class="ome-result-empty">Esperando al worker PAMI...</div>';
  omeNotice('info', 'Tarea en preparación', 'La web está encolando la generación de la OME.');
  try{
    var r = await fetch('/api/clientes/' + encodeURIComponent(slug) + '/ome/especialista', {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload)
    });
    var d = await r.json();
    if (!r.ok) throw new Error(d.error || 'No se pudo crear la tarea.');
    if (meta) meta.textContent = 'Tarea enviada. Esperando al worker...';
    omeNotice('info', 'Tarea enviada', 'El server la va a tomar y devolverá el número de OME o el error de PAMI.');
    seguirOmeTarea(d.task.id);
  }catch(e){
    if (btn) btn.disabled = false;
    if (meta) meta.textContent = 'No se pudo enviar.';
    if (out) out.innerHTML = '<div class="ome-result-empty">No hay resultado.</div>';
    omeNotice('err', 'No se pudo generar la tarea', e.message || String(e));
  }
}
function seguirOmeTarea(id){
  OME_WEB.lastTaskId = id;
  if (OME_WEB.taskTimer) clearInterval(OME_WEB.taskTimer);
  var btn = document.getElementById('omeCrearBtn');
  var meta = document.getElementById('omeTaskMeta');
  var out = document.getElementById('omeResultado');
  var vueltas = 0;
  OME_WEB.taskTimer = setInterval(async function(){
    vueltas++;
    try{
      var d = await fetch('/api/admin/worker/tasks').then(function(r){ return r.json(); });
      var t = (d.tasks || []).find(function(x){ return x.id === id; });
      if (!t) return;
      if (t.status === 'pending'){
        if (meta) meta.textContent = 'Esperando al worker' + (vueltas > 8 ? ' (revisá el server)' : '') + '...';
        return;
      }
      if (t.status === 'running'){
        var lg = (t.logs && t.logs.length) ? t.logs[t.logs.length - 1].message : '';
        if (meta) meta.textContent = 'Generando... ' + String(lg || '').slice(0, 90);
        return;
      }
      clearInterval(OME_WEB.taskTimer); OME_WEB.taskTimer = null;
      if (btn) btn.disabled = false;
      if (t.status === 'done'){
        var res = t.result || {};
        var row = res.row || {};
        var nro = res.nro_ome || row.nro_ome || '';
        var resultado = res.resultado || row.resultado || '';
        var ok = !!nro && ['OK','GENERADA','YA_TIENE_OME'].indexOf(String(resultado || '').toUpperCase()) >= 0;
        if (meta) meta.textContent = 'Finalizada.';
        if (out) out.innerHTML = '<div class="ome-result-card ' + (ok ? '' : 'err') + '">'
          + '<div><b>' + esc(ok ? 'OME lista' : 'PAMI respondió con observación') + '</b>'
          + '<span>' + esc(row.nombre || res.nombre || '') + (resultado ? ' · ' + esc(resultado) : '') + '</span>'
          + '<span>' + esc(row.practica || res.practica || '') + '</span></div>'
          + '<code>' + esc(nro || resultado || 'Sin OME') + '</code></div>';
        omeNotice(ok ? 'ok' : 'warn', ok ? 'OME generada' : 'Tarea terminada sin número de OME', ok ? ('Número: ' + nro) : (resultado || 'Revisá el detalle del server.'));
      } else {
        if (meta) meta.textContent = 'Falló.';
        if (out) out.innerHTML = '<div class="ome-result-card err"><div><b>Error al generar OME</b><span>' + esc(t.error || 'Error del worker') + '</span></div><code>Error</code></div>';
        omeNotice('err', 'La tarea falló', t.error || 'Error del worker.');
      }
    }catch(e){}
  }, 3000);
}
function limpiarOmeForm(){
  ['omeBenef','omeDni','omeNombre','omeCodigo','omePractica','omeMensaje'].forEach(function(id){ var el = document.getElementById(id); if (el) el.value = ''; });
  var d = document.getElementById('omeDiagnostico'); if (d) d.value = 'Z000';
  var out = document.getElementById('omeResultado'); if (out) out.innerHTML = '<div class="ome-result-empty">No hay datos cargados.</div>';
  var meta = document.getElementById('omeTaskMeta'); if (meta) meta.textContent = 'Todavía no hay una tarea enviada.';
  var sug = document.getElementById('omeSuggestions'); if (sug) { sug.style.display = 'none'; sug.innerHTML = ''; }
  var info = document.getElementById('omeNomInfo'); if (info) info.textContent = '';
  omeClearNotice();
}

// ===== Liberar cupo PAMI =====
var LC_ROWS = [];
var LC_TASK_TIMER = null;
function lcPeriodoLabel(p){ return typeof mesCursoLabelPeriodo === 'function' ? mesCursoLabelPeriodo(p) : p; }
function lcApplyIncomingPreset(){
  var raw = '';
  try { raw = sessionStorage.getItem('ns-liberar-cupo-preset') || ''; sessionStorage.removeItem('ns-liberar-cupo-preset'); } catch(e){}
  if (!raw) return;
  var preset = null;
  try { preset = JSON.parse(raw); } catch(e){ preset = null; }
  if (!preset) return;
  var cli = document.getElementById('lcCliente');
  if (cli && preset.clientSlug && Array.prototype.some.call(cli.options, function(o){ return o.value === preset.clientSlug; })) {
    cli.value = preset.clientSlug;
    try { localStorage.setItem('ns-liberar-cupo-cliente', preset.clientSlug); } catch(e){}
  }
  [['lcDesde','desde'],['lcHasta','hasta'],['lcBuscar','q'],['lcCodigo','code']].forEach(function(x){
    var el = document.getElementById(x[0]);
    if (el && preset[x[1]] != null) el.value = String(preset[x[1]] || '');
  });
  var per = document.getElementById('lcPeriodo');
  if (per && preset.period) {
    var p = String(preset.period || '');
    if (!Array.prototype.some.call(per.options, function(o){ return o.value === p; })) {
      per.innerHTML = '<option value="' + esc(p) + '">' + esc(lcPeriodoLabel(p)) + '</option>';
    }
    per.value = p;
  }
}
async function loadLiberarCupoView(){
  var sel = document.getElementById('lcCliente');
  if (sel && !sel.options.length){
    // clientesParaSelector() ya viene scopeado por rol Y re-filtrado por el
    // usuario EFECTIVO (ME) - cubre tanto una sesión real restringida como el
    // modo espejo (donde la sesión real sigue siendo la del admin). Si a este
    // usuario le queda un solo cliente posible (operador_clinica, atado a su
    // centro), no tiene sentido mostrarle un selector - se ve como una
    // herramienta de NS con un cliente de más, en vez de "el liberar cupo de
    // este centro". Se oculta y se deja autoseleccionado.
    var list = await clientesParaSelector();
    list.forEach(function(c){ var o = document.createElement('option'); o.value = c.slug; o.textContent = c.name || c.slug; sel.appendChild(o); });
    var wrap = document.getElementById('lcClienteWrap');
    if (wrap) wrap.style.display = (list.length <= 1) ? 'none' : '';
    if (list.length === 1) sel.value = list[0].slug;
    try {
      var last = localStorage.getItem('ns-liberar-cupo-cliente') || '';
      if (last && Array.prototype.some.call(sel.options, function(o){ return o.value === last; })) sel.value = last;
    } catch(e){}
  }
  lcApplyIncomingPreset();
  ['lcDesde','lcHasta','lcModulo','lcCodigo','lcBuscar','lcPeriodo'].forEach(function(id){
    var el = document.getElementById(id);
    if (el && !el._lcHooked){ el._lcHooked = true; el.addEventListener(id === 'lcBuscar' || id === 'lcCodigo' ? 'input' : 'change', lcQueueRefresh); }
  });
  await refreshLiberarCupo();
}
function lcBase(){
  var slug = (document.getElementById('lcCliente') || {}).value || '';
  return slug ? '/api/clientes/' + encodeURIComponent(slug) + '/liberar-cupo' : '';
}
function lcBuildParams(){
  var p = new URLSearchParams();
  [['period','lcPeriodo'],['desde','lcDesde'],['hasta','lcHasta'],['module','lcModulo'],['code','lcCodigo'],['q','lcBuscar']].forEach(function(x){
    var v = (document.getElementById(x[1]) || {}).value || '';
    if (v) p.set(x[0], v);
  });
  return p;
}
function lcNotice(kind, title, text){
  var el = document.getElementById('lcError');
  if (!el) return;
  var icon = kind === 'ok' ? '✓' : (kind === 'err' ? '!' : (kind === 'warn' ? '!' : 'i'));
  el.className = 'lc-notice ' + (kind || 'info');
  el.innerHTML = '<div aria-hidden="true">' + esc(icon) + '</div><div><b>' + esc(title || '') + '</b><span>' + esc(text || '') + '</span></div>';
  el.style.display = 'flex';
}
function lcClearNotice(){
  var el = document.getElementById('lcError');
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
  el.className = 'msg err';
}
function onLiberarCupoCliente(){
  try { localStorage.setItem('ns-liberar-cupo-cliente', (document.getElementById('lcCliente') || {}).value || ''); } catch(e){}
  var per = document.getElementById('lcPeriodo'); if (per) per.innerHTML = '';
  refreshLiberarCupo();
}
var LC_REFRESH_TIMER = null;
function lcQueueRefresh(){
  if (LC_REFRESH_TIMER) clearTimeout(LC_REFRESH_TIMER);
  LC_REFRESH_TIMER = setTimeout(refreshLiberarCupo, 250);
}
async function refreshLiberarCupo(){
  var base = lcBase();
  var body = document.getElementById('lcBody'), meta = document.getElementById('lcResultMeta'), title = document.getElementById('lcResultTitle');
  lcClearNotice();
  if (!base){ if (body) body.innerHTML = '<tr><td colspan="8" class="nom-empty">Elegí un cliente.</td></tr>'; return; }
  if (meta) meta.textContent = 'Cargando...';
  var qs = lcBuildParams().toString();
  try{
    var r = await fetch(base + '/candidatos' + (qs ? '?' + qs : ''));
    var d = await r.json();
    if(!r.ok){ throw new Error(d.error || 'No se pudo cargar.'); }
    LC_ROWS = d.rows || [];
    lcRenderPeriodos(d.periods || [], d.period || '');
    lcRenderModulos(d.modules || []);
    if (title) title.textContent = 'OMEs no validadas';
    if (meta) meta.textContent = (d.totalFiltrado || 0) + ' visible(s) de ' + (d.total || 0) + ' detectada(s)' + (d.label ? ' · ' + d.label : '') + (d.source === 'reportes' ? ' · desde reporte guardado' : '');
    var st = document.getElementById('lcStatusText');
    if (st) st.innerHTML = '<span>Seleccioná ausentes/no validadas desde la bandeja guardada y enviá la cancelación al worker PAMI.</span>';
    renderLiberarCupoRows();
  }catch(e){
    LC_ROWS = [];
    if (meta) meta.textContent = '';
    if (body) body.innerHTML = '<tr><td colspan="8" class="nom-empty">No se pudieron cargar candidatos.</td></tr>';
    lcNotice('err', 'No se pudieron cargar candidatos', e.message || String(e));
  }
}
function lcRenderPeriodos(periods, selected){
  var sel = document.getElementById('lcPeriodo'); if (!sel) return;
  var current = sel.value || selected || '';
  var html = (periods || []).map(function(p){ return '<option value="' + esc(p.period) + '">' + esc(p.label || p.period) + (p.live ? ' (actual)' : (p.source === 'reportes' ? ' (reporte)' : '')) + '</option>'; }).join('');
  sel.innerHTML = html || '<option value="">Sin bandejas</option>';
  if (current && Array.prototype.some.call(sel.options, function(o){ return o.value === current; })) sel.value = current;
  else if (selected) sel.value = selected;
}
function lcRenderModulos(modules){
  var sel = document.getElementById('lcModulo'); if (!sel) return;
  var val = sel.value || '';
  var html = '<option value="">Módulo entero</option>' + (modules || []).map(function(m){ return '<option value="' + esc(m.value) + '">' + esc(m.label) + ' (' + esc(m.count) + ')</option>'; }).join('');
  sel.innerHTML = html;
  if (val && Array.prototype.some.call(sel.options, function(o){ return o.value === val; })) sel.value = val;
}
function renderLiberarCupoRows(){
  var body = document.getElementById('lcBody'); if (!body) return;
  if (!LC_ROWS.length){ body.innerHTML = '<tr><td colspan="8" class="nom-empty">No hay OMEs no validadas con estos filtros.</td></tr>'; lcUpdateSelected(); return; }
  body.innerHTML = LC_ROWS.map(function(r, i){
    var modulo = [r.moduleCode, r.moduleDescription].filter(Boolean).join(' - ') || '-';
    return '<tr>'
      + '<td><input type="checkbox" class="lc-check" data-ome="' + esc(r.n_orden) + '" onchange="lcUpdateSelected()"></td>'
      + '<td><b>' + esc(r.n_orden) + '</b><div class="cab-sub">' + esc(r.f_vencimiento || '') + '</div></td>'
      + '<td>' + esc(r.turno || '') + '</td>'
      + '<td>' + esc(r.beneficio || '') + '</td>'
      + '<td>' + esc(r.nombre || '') + '</td>'
      + '<td>' + esc(r.practica || '') + '<div class="cab-sub">' + esc(modulo) + '</div></td>'
      + '<td><span class="cab-badge warn">' + esc(r.estado || 'No validada') + '</span></td>'
      + '<td class="cab-actions"><button class="rowbtn" title="Liberar" onclick="liberarCupoUno(' + i + ')">🚫</button></td>'
      + '</tr>';
  }).join('');
  lcUpdateSelected();
}
function lcSelectedOmes(){
  return Array.prototype.slice.call(document.querySelectorAll('.lc-check:checked')).map(function(x){ return x.getAttribute('data-ome') || ''; }).filter(Boolean);
}
function lcUpdateSelected(){
  var n = lcSelectedOmes().length;
  var el = document.getElementById('lcSelected'); if (el) el.textContent = n ? (n + ' seleccionada(s)') : 'Sin selección';
}
function lcToggleTodos(on){
  document.querySelectorAll('.lc-check').forEach(function(x){ x.checked = !!on; });
  lcUpdateSelected();
}
function liberarCupoUno(i){
  var r = LC_ROWS[i]; if (!r) return;
  liberarCupoSeleccionadas([r.n_orden]);
}
async function liberarCupoSeleccionadas(omes){
  var base = lcBase(); if (!base){ lcNotice('warn', 'Elegí un cliente', 'Primero seleccioná el cliente que tiene la bandeja.'); return; }
  omes = omes || lcSelectedOmes();
  if (!omes.length){ lcNotice('warn', 'Seleccioná al menos una OME', 'Tildá una o más órdenes para liberar cupo.'); return; }
  if (!await nsConfirm('Se libera cupo de ' + omes.length + ' OME(s) en PAMI. Esto cancela la aceptación.', { titulo:'Liberar cupo', okLabel:'Liberar', peligro:true })) return;
  var est = document.getElementById('lcTareaEstado'); if (est) est.textContent = 'Creando tarea...';
  lcNotice('info', 'Tarea en preparación', 'Estoy enviando la solicitud al worker PAMI.');
  var filtros = {};
  lcBuildParams().forEach(function(v, k){ filtros[k] = v; });
  try{
    var r = await fetch(base + '/liberar', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ period:(document.getElementById('lcPeriodo')||{}).value||'', omes:omes, filtros:filtros }) });
    var d = await r.json();
    if(!r.ok){ if(est) est.textContent = ''; lcNotice('err', 'No se pudo crear la tarea', d.error || 'Volvé a intentar en unos segundos.'); return; }
    lcNotice('info', 'Tarea enviada', 'Esperando que el worker tome la liberación.');
    seguirLiberarCupoTarea(d.task.id);
  }catch(e){ if(est) est.textContent = ''; lcNotice('err', 'Error de conexión', 'No se pudo crear la tarea.'); }
}
function seguirLiberarCupoTarea(id){
  if (LC_TASK_TIMER) clearInterval(LC_TASK_TIMER);
  var est = document.getElementById('lcTareaEstado');
  var vueltas = 0;
  LC_TASK_TIMER = setInterval(async function(){
    vueltas++;
    try{
      var d = await fetch('/api/admin/worker/tasks').then(function(r){ return r.json(); });
      var t = (d.tasks || []).find(function(x){ return x.id === id; });
      if(!t) return;
      if(t.status === 'pending'){ if(est) est.textContent = 'Esperando al worker' + (vueltas > 6 ? ' (revisá si está prendido)' : '') + '...'; return; }
      if(t.status === 'running'){ var lg = (t.logs && t.logs.length) ? t.logs[t.logs.length - 1].message : ''; if(est) est.textContent = 'Liberando... ' + String(lg).slice(0, 70); return; }
      clearInterval(LC_TASK_TIMER); LC_TASK_TIMER = null;
      if(est) est.textContent = '';
      if(t.status === 'done'){
        var res = t.result || {};
        await refreshLiberarCupo();
        lcNotice('ok', 'Liberación terminada', (res.liberadas || 0) + ' liberada(s), ' + (res.errores || 0) + ' error(es), ' + (res.omitidas || 0) + ' omitida(s).');
      } else {
        lcNotice('err', 'La tarea falló', t.error || 'Error del worker.');
      }
    }catch(e){}
  }, 3000);
}
function descargarLiberarCupoReporte(){
  var base = lcBase(); if (!base) return;
  var qs = lcBuildParams().toString();
  var a = document.createElement('a');
  a.href = base + '/reporte.xlsx' + (qs ? '?' + qs : '');
  document.body.appendChild(a); a.click(); a.remove();
}
async function cargarEstadoMail(){
  var card = document.getElementById('cabMailCard');
  var info = document.getElementById('cabMailInfo');
  try {
    var r = await fetch('/api/informes-gmail-estado');
    var d = await r.json();
    if (d && d.conectado){
      if (card) card.style.display = '';
      if (info) info.textContent = 'Casilla: ' + (d.email || 'conectada');
      // Se mantiene el último rango que usaste; solo si nunca elegiste uno arranca en hoy.
      var hoy = new Date().toISOString().slice(0,10);
      var guardado = rangoCabinaGuardado() || {};
      var de = document.getElementById('cabDesde'), ha = document.getElementById('cabHasta');
      if (de && !de.value) de.value = guardado.desde || hoy;
      if (ha && !ha.value) ha.value = guardado.hasta || hoy;
    } else {
      if (card) card.style.display = 'none';
    }
  } catch(e){ if (card) card.style.display = 'none'; }
}
async function traerDelMail(){
  var slug = document.getElementById('cabCliente').value;
  if (!slug){ nsAlert('Elegí un cliente primero.'); return; }
  var de = document.getElementById('cabDesde').value, ha = document.getElementById('cabHasta').value;
  if (!de){ nsAlert('Elegí la fecha desde.'); return; }
  // Gmail usa "before" exclusivo -> sumamos un día al "hasta" para incluirlo.
  var desde = de.replace(/-/g,'/');
  var hastaD = ha ? new Date(ha+'T00:00:00') : new Date(de+'T00:00:00');
  hastaD.setDate(hastaD.getDate()+1);
  var hasta = hastaD.getFullYear()+'/'+String(hastaD.getMonth()+1).padStart(2,'0')+'/'+String(hastaD.getDate()).padStart(2,'0');
  var btn = document.getElementById('cabMailBtn');
  var meta = document.getElementById('cabResultMeta');
  if (btn) btn.disabled = true;
  if (meta) meta.textContent = 'Buscando en el mail y leyendo los informes… puede tardar.';
  // Trae de a tandas (tope 40/corrida por el timeout de Railway) pero AUTOMÁTICO:
  // sigue solo hasta que no queden más. El backend saltea los ya bajados (por
  // nombre), así cada vuelta trae los próximos 40 sin repetir.
  try {
    var total = 0, vueltas = 0;
    while (vueltas < 30) {   // tope de seguridad (~1200 informes)
      vueltas++;
      if (meta) meta.textContent = 'Trayendo del mail… ' + (total ? '(' + total + ' hasta ahora)' : 'puede tardar') + (vueltas > 1 ? ' · tanda ' + vueltas : '');
      var r = await fetch('/api/clientes/'+slug+'/informes/gmail', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ desde:desde, hasta:hasta }) });
      var d = await r.json();
      if (!r.ok){ nsAlert(d.error || 'No se pudieron traer los informes.'); break; }
      total += (d.procesados || 0);
      await refreshCabina();                 // que se vea entrar cada tanda
      if (!d.hayMas || !d.procesados){        // no queda más (o una tanda no trajo nada)
        nsAlert(total === 0 ? 'No había informes nuevos en ese rango.' : 'Listo: se trajeron ' + total + ' informe(s) en total.');
        break;
      }
    }
  } catch(e){ nsAlert('Error de red al traer del mail.'); }
  if (btn) btn.disabled = false;
  await refreshCabina();
}
async function refreshCabina(){
  var sel = document.getElementById('cabCliente');
  var slug = sel ? sel.value : '';
  var body = document.getElementById('cabBody');
  var meta = document.getElementById('cabResultMeta');
  var res = document.getElementById('cabResumen');
  if (!slug){ if(body) body.innerHTML=''; if(res) res.innerHTML=''; if(meta) meta.textContent='Elegí un cliente.'; return; }
  try {
    var r = await fetch('/api/clientes/' + slug + '/informes');
    var d = await r.json();
    if (!r.ok){ if(meta) meta.textContent = d.error || 'No se pudo cargar.'; return; }
    CAB_ITEMS = d.items || [];
    cabMostrarUltimaImport(d.lastMailImportAt);
    aplicarFiltroCabina();
  } catch(e){ if(meta) meta.textContent = 'Error de red.'; }
}
// Muestra cuándo fue la última vez que se trajo del mail para este cliente.
function cabMostrarUltimaImport(iso){
  var el = document.getElementById('cabUltimaImport'); if (!el) return;
  if (!iso){ el.textContent = 'Sin importaciones de mail todavía'; return; }
  var d = new Date(iso);
  if (isNaN(d)){ el.textContent = ''; return; }
  var f = d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
  var h = d.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
  el.textContent = 'Última importación del mail: ' + f + ' ' + h;
}
// Fecha del informe para filtrar/mostrar: la del mail si la tenemos, si no cuándo se bajó.
function cabFecha(it){ return String((it && (it.fecha || it.storedAt)) || '').slice(0,10); }
// Cuándo entró el informe, para la columna "Recibido". Los que vinieron por mail
// muestran la fecha del mail (y la hora, si el import la guardó: `fechaHora` se
// empezó a guardar después, los viejos tienen solo el día). Los subidos a mano no
// tienen mail, así que se muestra cuándo se subieron y se aclara en el título.
function cabRecibido(it){
  it = it || {};
  var porMail = it.origen === 'mail';
  var iso = String((porMail ? (it.fechaHora || it.fecha) : it.storedAt) || '');
  if (!iso) return { txt: '—', title: '' };
  var p = iso.slice(0,10).split('-');
  if (p.length !== 3) return { txt: '—', title: '' };
  var dia = p[2] + '/' + p[1] + '/' + p[0];
  var hora = '';
  // Solo si hay hora de verdad. Un "YYYY-MM-DD" pelado NO se pasa por Date():
  // se interpreta como UTC y en Argentina muestra el día anterior.
  if (/T\d{2}:\d{2}/.test(iso)) {
    var d = new Date(iso);
    if (!isNaN(d)) {
      // Con hora hay que tomar la fecha LOCAL, no la del ISO: un mail de las
      // 02:00 UTC acá entró el día anterior. Y se arma a mano para que quede
      // siempre DD/MM/AAAA y 24 hs (toLocale* devuelve "8/9/2026" y "a. m.").
      var z = function(n){ return String(n).padStart(2, '0'); };
      dia = z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + d.getFullYear();
      hora = z(d.getHours()) + ':' + z(d.getMinutes());
    }
  }
  return {
    txt: dia, hora: hora,
    title: porMail ? ('Llegó por mail el ' + dia + (hora ? ' a las ' + hora : '')) : ('Subido a mano el ' + dia + (hora ? ' a las ' + hora : '')),
    aMano: !porMail,
  };
}
// Mismo criterio que usa el badge de la fila (cabBadge) para clasificar un
// informe: una sola función, así el chip del resumen y el badge de la tabla
// nunca pueden quedar desalineados.
function cabResueltoOmes(it){
  var a = (it.resuelto && (it.resuelto.omes || (it.resuelto.ome ? [it.resuelto.ome] : []))) || [];
  return a.map(function(o){ return String(o).replace(/\D+/g,''); }).filter(Boolean);
}
// ¿Todos los OMEs a los que se resolvió el informe ya están transmitidos en PAMI?
// Mismo criterio que el match automático de una sola práctica: si la OME está
// transmitida no hay nada que subir. Si alguna OME resuelta no aparece entre los
// candidatos de la bandeja (no se puede confirmar), NO se da por transmitida.
function cabResueltoTodoTransmitido(it){
  // El server guarda el flag calculado con la bandeja COMPLETA al resolver: es el
  // confiable. El fallback (candidatos del match) viene recortado a 8, así que puede
  // quedarse corto en informes con muchos turnos.
  if (it.resuelto && typeof it.resuelto.todoTransmitido === 'boolean') return it.resuelto.todoTransmitido;
  var omes = cabResueltoOmes(it);
  if (!omes.length) return false;
  var trans = {};
  ((it.match && it.match.candidatos) || []).forEach(function(c){
    if (c && c.transmitida && c.ome) trans[String(c.ome).replace(/\D+/g,'')] = true;
  });
  return omes.every(function(o){ return trans[o]; });
}
// El estado SIN mirar si esta reclamado. `cabEstadoDe` corta en
// 'reclamado' apenas ve la marca, y eso tapa lo que hay abajo: un
// informe puede estar reclamado al centro Y ademas tener la OME sin
// validar. Son dos cosas distintas y hay que hacer las dos.
function cabEstadoSinReclamo(it){
  if (it.resuelto){
    if (cabResueltoTodoTransmitido(it)) return 'ya_transmitido';
    if (it.resuelto.faltaValidar) return 'falta_validar';
    if (it.match && it.match.estado === 'falta_validar') return 'falta_validar';
    return 'ok';
  }
  return it.match ? it.match.estado : 'sin_match';
}
function cabEstadoDe(it){
  if (it.desestimado) return 'desestimado';
  if (it.reclamado) return 'reclamado';   // reclamado al centro, esperando datos
  // Un resuelto a mano cuya OME todavía no está transmitida es, a los efectos de
  // subir, lo mismo que un "listo para subir": va en el mismo grupo. Solo se separa
  // cuando ya está todo transmitido (ahí no hay nada que hacer).
  if (it.resuelto){
    if (cabResueltoTodoTransmitido(it)) return 'ya_transmitido';
    if (it.resuelto.faltaValidar) return 'falta_validar';   // la subida rebotó: OME sin validar
    if (it.match && it.match.estado === 'falta_validar') return 'falta_validar'; // la OME figura sin validar en la bandeja
    return 'ok';
  }
  return it.match ? it.match.estado : 'sin_match';
}
function cabResumenDe(items){
  var r = {};
  items.forEach(function(it){ var e = cabEstadoDe(it); r[e] = (r[e]||0)+1; });
  return r;
}
// Filtra los informes por el rango Desde/Hasta (inclusive, para mostrar), y
// además por el chip de estado elegido (si hay uno). Los chips muestran el
// total del rango de fechas SIN el filtro de estado (así no desaparecen al
// elegir uno), pero la tabla de abajo sí queda acotada a ambos filtros.
function aplicarFiltroCabina(){
  var slug = (document.getElementById('cabCliente')||{}).value || '';
  var de = (document.getElementById('cabDesde')||{}).value || '';
  var ha = (document.getElementById('cabHasta')||{}).value || '';
  var vis = CAB_ITEMS.filter(function(it){
    var f = cabFecha(it);
    if (!f) return true;                 // sin fecha -> siempre visible
    if (de && f < de) return false;
    if (ha && f > ha) return false;      // "hasta" INCLUSIVE al mostrar
    return true;
  });
  // El resumen (los chips con sus conteos) muestra SIEMPRE todos los estados del
  // rango, prendidos o apagados — si no, no habría cómo volver a mostrar uno.
  var resumen = cabResumenDe(vis);
  renderCabinaResumen(resumen, vis.length);
  var filtrados = vis.filter(function(it){
    if (cabEstadoOculto(cabEstadoDe(it))) return false;   // estado destildado
    if (!cabMatchBusca(it)) return false;                 // no matchea el buscador
    return true;
  });
  renderCabinaRows(slug, filtrados);
  var meta = document.getElementById('cabResultMeta');
  if (meta) {
    var motivos = [];
    if (vis.length !== CAB_ITEMS.length) motivos.push('del rango de fechas');
    var ocultosPorEstado = vis.filter(function(it){ return cabEstadoOculto(cabEstadoDe(it)); }).length;
    if (ocultosPorEstado) motivos.push('de estados destildados');
    if (CAB_BUSCAR) motivos.push('de la búsqueda');
    meta.textContent = filtrados.length + ' informe(s)' +
      (motivos.length ? ' (de ' + CAB_ITEMS.length + ' — el resto queda fuera ' + motivos.join(' o ') + ')' : '');
  }
}
// Prende/apaga un estado (checkbox del chip). Queda guardado en el navegador.
function toggleCabEstadoFiltro(k){
  var arr = cabEstadosOcultos();
  var i = arr.indexOf(k);
  if (i >= 0) arr.splice(i, 1); else arr.push(k);
  cabGuardarOcultos(arr);
  aplicarFiltroCabina();
}
var CAB_ESTADOS = {
  ok:{t:'Listo para subir',c:'ok'},
  falta_validar:{t:'Falta validar',c:'warn'},
  factura:{t:'Factura',c:'fac'},
  ya_transmitido:{t:'Ya transmitido',c:'muted'}, revisar_practica:{t:'Revisar práctica',c:'warn'},
  revisar_nombre:{t:'Revisar nombre',c:'warn'}, sin_ome:{t:'Sin OME en bandeja',c:'warn'}, sin_match:{t:'No se encontró',c:'bad'},
  no_es_pami:{t:'No es de PAMI',c:'warn'},
  reclamado:{t:'Reclamado',c:'warn'}, desestimado:{t:'Desestimado',c:'muted'}
};
function renderCabinaResumen(resumen, total){
  var res = document.getElementById('cabResumen'); if (!res) return;
  var orden = ['ok','falta_validar','factura','revisar_practica','revisar_nombre','sin_ome','no_es_pami','sin_match','reclamado','ya_transmitido','desestimado'];
  var chips = orden.filter(function(k){ return resumen[k]; }).map(function(k){
    var m = CAB_ESTADOS[k] || {t:k,c:'muted'};
    var on = !cabEstadoOculto(k);   // tildado = se muestra
    return '<button type="button" class="cab-chip '+m.c+(on?' on':' off')+'" '
      + 'aria-pressed="'+on+'" title="'+(on?'Se está mostrando. Clic para ocultarlo.':'Oculto. Clic para mostrarlo.')+'" '
      + 'onclick="toggleCabEstadoFiltro(\''+k+'\')"><span class="cab-chip-box" aria-hidden="true">'+(on?'✓':'')+'</span>'+resumen[k]+' '+esc(m.t)+'</button>';
  });
  res.innerHTML = total ? chips.join('') : '';
}
function cabBadge(it){
  if (it.error) return '<span class="cab-badge bad" title="'+esc(it.error)+'">No se pudo leer</span>';
  var e = cabEstadoDe(it);
  if (e === 'desestimado') return '<span class="cab-badge muted" title="Desestimado por el operador: no se sube">Desestimado</span>';
  if (e === 'reclamado') {
    var nr=(it.reclamado&&it.reclamado.nota)?(' — '+it.reclamado.nota):'';
    // Si ademas le falta validar la OME, decirlo: son dos tareas
    // distintas. Con solo "Reclamado" uno espera al centro y despues se
    // encuentra con que igual no se puede subir.
    var falta = cabEstadoSinReclamo(it) === 'falta_validar';
    return '<span class="cab-badge warn" title="Reclamado al centro, esperando datos'
      + (falta ? '. Y la OME todavia no esta validada en PAMI: hay que validarla igual' : '')
      + esc(nr)+'">Reclamado'+(falta ? '/Falta validar' : '')+'</span>';
  }
  if (e === 'falta_validar') return '<span class="cab-badge warn" title="La OME está en la bandeja pero todavía no está validada en PAMI. Hay que validarla antes de poder subir el informe.">Falta validar</span>';
  if (it.resuelto) {
    var no=(it.resuelto.omes&&it.resuelto.omes.length)||1;
    if (e === 'ya_transmitido') return '<span class="cab-badge muted" title="Resuelto a mano; '+(no>1?'sus '+no+' OMEs ya están':'su OME ya está')+' transmitido(s) en PAMI, no hay nada para subir">Ya transmitido</span>';
    return '<span class="cab-badge ok" title="Resuelto a mano, listo para subir">Listo para subir'+(no>1?' · '+no+' OMEs':'')+'</span>';
  }
  var m = CAB_ESTADOS[e] || {t:e,c:'muted'};
  return '<span class="cab-badge '+m.c+'">'+esc(m.t)+'</span>';
}
function renderCabinaRows(slug, items){
  var body = document.getElementById('cabBody'); if (!body) return;
  if (!items.length){ body.innerHTML = '<tr><td colspan="9" class="nom-empty">Todavía no subiste informes para este cliente.</td></tr>'; cabToggleSel(); return; }
  body.innerHTML = items.map(function(it){
    var omesArr = (it.resuelto && (it.resuelto.omes || (it.resuelto.ome ? [it.resuelto.ome] : []))) || (it.match && it.match.ome ? [it.match.ome] : []);
    // Si está "Falta validar", en la columna OME mostramos SOLO la(s) que falta
    // validar (el resto del estudio ya se transmitió), no todas las del informe.
    if (cabEstadoDe(it) === 'falta_validar' && it.resuelto && (it.resuelto.omesFaltaValidar || []).length) {
      omesArr = it.resuelto.omesFaltaValidar;
    }
    var ome = omesArr.join(', ');
    var ocr = it.extract && it.extract.ocrUsado ? ' <span class="cab-ocr" title="Leído por OCR (escaneado)">OCR</span>' : '';
    var dni = it.extract && it.extract.dni ? 'DNI '+esc(it.extract.dni) : (it.extract && it.extract.beneficio ? 'Benef '+esc(it.extract.beneficio) : '');
    var asunto = it.asunto ? esc(it.asunto) : '—';
    var rec = cabRecibido(it);
    return '<tr class="cab-row" onclick="abrirInforme(\''+esc(it.id)+'\')">'
      + '<td style="text-align:center" onclick="event.stopPropagation()"><input type="checkbox" class="cab-check" value="'+esc(it.id)+'" onclick="cabToggleSel()"></td>'
      + '<td><span class="cab-file">'+esc(it.filename)+'</span>'+ocr+'</td>'
      + '<td>'+esc((it.extract&&it.extract.nombre)||'—')+'<div class="cab-sub">'+dni+'</div></td>'
      + '<td>'+esc((it.extract&&it.extract.practica)||'—')+'</td>'
      + '<td>'+cabBadge(it)+'</td>'
      + '<td>'+(ome?('<span class="cab-ome" title="Clic para copiar el N° de OME" onclick="event.stopPropagation();cabCopiarOme(this,\''+esc(ome)+'\')">'+esc(ome)+'</span>'):'—')+'</td>'
      + '<td class="cab-recibido" title="'+esc(rec.title)+'">'+esc(rec.txt)
        + (rec.hora ? '<div class="cab-sub">'+esc(rec.hora)+'</div>' : '')
        + (rec.aMano ? '<div class="cab-sub">a mano</div>' : '') + '</td>'
      + '<td class="cab-asunto" title="'+(it.asunto?esc(it.asunto):'')+'">'+asunto+'</td>'
      + '<td class="cab-actions" onclick="event.stopPropagation()">'
        + '<button class="rowbtn" title="Revisar" onclick="abrirInforme(\''+esc(it.id)+'\')">🔍</button>'
        + (['ok','resuelto','falta_validar'].indexOf(cabEstadoDe(it))>=0 ? '<button class="rowbtn" title="Subir este a PAMI (si ya validaste la OME)" onclick="event.stopPropagation();subirInformeUno(\''+esc(it.id)+'\')">📤</button>' : '')
        + '<button class="rowbtn" title="Reanalizar" onclick="reanalizarInforme(\''+esc(it.id)+'\')">🔄</button>'
        + '<button class="rowbtn" title="'+(it.reclamado?'Soltar (volvió del centro)':'Reclamar al centro')+'" onclick="toggleReclamar(\''+esc(it.id)+'\','+(it.reclamado?'true':'false')+')">'+(it.reclamado?'↩️':'📮')+'</button>'
        + '<button class="rowbtn" title="'+(it.desestimado?'Reactivar':'Desestimar (no subir)')+'" onclick="toggleDesestimar(\''+esc(it.id)+'\','+(it.desestimado?'true':'false')+')">'+(it.desestimado?'↩️':'🚫')+'</button>'
        + '<button class="rowbtn danger" title="Borrar" onclick="borrarInforme(\''+esc(it.id)+'\')">'+ (typeof SVG_TRASH!=='undefined'?SVG_TRASH:'🗑') +'</button>'
      + '</td></tr>';
  }).join('');
  cabToggleSel(); // reset de la barra de selección al re-renderizar
}
// ===== Selección múltiple para desestimar en lote =====
function cabToggleSel(){
  var checks = [].slice.call(document.querySelectorAll('#cabBody .cab-check'));
  var n = checks.filter(function(c){ return c.checked; }).length;
  var cnt = document.getElementById('cabSelCount');
  if (cnt) cnt.textContent = n;
  var normal = document.getElementById('cabToolbarNormal');
  var sel = document.getElementById('cabToolbarSel');
  if (normal) normal.style.display = (n === 0) ? 'contents' : 'none';
  if (sel) sel.style.display = (n === 0) ? 'none' : 'inline-flex';
  var all = document.getElementById('cabCheckAll');
  if (all){ all.checked = checks.length > 0 && n === checks.length; all.indeterminate = n > 0 && n < checks.length; }
}
function cabToggleAll(el){
  [].slice.call(document.querySelectorAll('#cabBody .cab-check')).forEach(function(c){ c.checked = el.checked; });
  cabToggleSel();
}
function cabLimpiarSel(){
  [].slice.call(document.querySelectorAll('#cabBody .cab-check')).forEach(function(c){ c.checked = false; });
  cabToggleSel();
}
async function cabSubirSeleccionados(){
  var checks = [].slice.call(document.querySelectorAll('#cabBody .cab-check')).filter(function(c){ return c.checked; });
  if (!checks.length) return;
  var ids = [], noListos = 0;
  checks.forEach(function(c){
    var it = (CAB_ITEMS||[]).find(function(x){ return x.id===c.value; });
    var e = it ? cabEstadoDe(it) : '';
    if (e==='ok' || e==='resuelto' || e==='falta_validar') ids.push(c.value); else noListos++;
  });
  if (!ids.length){ await nsConfirm('Ninguno de los seleccionados está "Listo para subir".', { titulo:'No hay nada para subir', okLabel:'Entendido', cancelLabel:'' }); return; }
  var extra = noListos ? (' (' + noListos + ' seleccionado(s) no están listos y se omiten.)') : '';
  if (!await nsConfirm('Se suben ' + ids.length + ' informe(s) a PAMI. Es real e irreversible.' + extra, { titulo:'Subir a PAMI', okLabel:'Subir '+ids.length })) return;
  var slug = document.getElementById('cabCliente').value;
  cabEstado('Preparando…','working');
  try{
    var r = await fetch('/api/admin/worker/tasks', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ type:'subir-informes', clientSlug: slug, payload:{ informeIds: ids } }) });
    var d = await r.json();
    if(!r.ok){ cabEstado('',''); nsAlert(d.error||'No se pudo crear la tarea.'); return; }
    seguirTarea(d.task.id, 'subir-informes');
  }catch(e){ cabEstado('',''); nsAlert('Error de red al crear la tarea.'); }
}
// ===== Motivo al desestimar (modal + motivos configurables) =====
function motivosDesestActuales(){
  var m = (typeof INFORMES_CFG === 'object' && INFORMES_CFG && INFORMES_CFG.motivosDesestimacion) || [];
  return m.length ? m.slice() : ['NO PAMI', 'NO CORRESPONDE'];
}
var _desestResolve = null; // resolvedor de la Promise abierta
var _desestSel = '';       // motivo elegido de la lista
// Abre el modal y devuelve una Promise que resuelve con el motivo (string) o null si se cancela.
function pedirMotivoDesest(cantidad){
  return new Promise(function(resolve){
    _desestResolve = resolve;
    _desestSel = '';
    var t = document.getElementById('desestTitle');
    if (t) t.textContent = cantidad > 1 ? ('Desestimar ' + cantidad + ' informes') : 'Desestimar informe';
    var sub = document.getElementById('desestSub');
    if (sub) sub.textContent = (cantidad > 1 ? ('Se dan por cerrados ' + cantidad + ' informes y no se suben. ') : 'Se da por cerrado y no se sube. ') + 'Elegí el motivo:';
    var otro = document.getElementById('desestOtro'); if (otro) otro.value = '';
    var ok = document.getElementById('desestOk'); if (ok) ok.disabled = true;
    var adm = document.getElementById('desestAdmin'); if (adm) adm.style.display = (ME && ME.role === 'admin') ? '' : 'none';
    var ed = document.getElementById('desestEditor'); if (ed) ed.style.display = 'none';
    var lbl = document.getElementById('desestEditLbl'); if (lbl) lbl.textContent = '⚙️ Editar motivos';
    renderDesestMotivos();
    showModal('desestModal', 'desestScrim');
    // Traé la lista real de config (si no estaba cargada) y re-render.
    ensureInformesCfg(function(){ renderDesestMotivos(); });
  });
}
function renderDesestMotivos(){
  var cont = document.getElementById('desestMotivos'); if (!cont) return;
  var lista = motivosDesestActuales();
  cont.innerHTML = lista.map(function(m, i){
    return '<button type="button" class="desest-chip' + (_desestSel === m ? ' on' : '') + '" onclick="desestElegirIdx(' + i + ')">' + esc(m) + '</button>';
  }).join('') || '<span class="nom-muted">No hay motivos cargados. Escribí uno abajo.</span>';
}
function desestElegirIdx(i){
  var lista = motivosDesestActuales();
  _desestSel = lista[i] || '';
  var otro = document.getElementById('desestOtro'); if (otro) otro.value = '';
  var ok = document.getElementById('desestOk'); if (ok) ok.disabled = !_desestSel;
  renderDesestMotivos();
}
function desestOtroInput(){
  var otro = document.getElementById('desestOtro');
  var txt = otro ? otro.value.trim() : '';
  if (txt){ _desestSel = ''; renderDesestMotivos(); }
  var ok = document.getElementById('desestOk'); if (ok) ok.disabled = !(txt || _desestSel);
}
function cerrarDesestimar(){
  hideModal('desestModal', 'desestScrim');
  if (_desestResolve){ var r = _desestResolve; _desestResolve = null; r(null); }
}
function desestConfirmar(){
  var otro = document.getElementById('desestOtro');
  var txt = otro ? otro.value.trim() : '';
  var motivo = txt || _desestSel || '';
  if (!motivo) return;
  hideModal('desestModal', 'desestScrim');
  if (_desestResolve){ var r = _desestResolve; _desestResolve = null; r(motivo); }
}
// --- Edición de motivos (solo admin) ---
function desestToggleEditar(){
  var ed = document.getElementById('desestEditor');
  var lbl = document.getElementById('desestEditLbl');
  if (!ed) return;
  var abrir = ed.style.display === 'none';
  ed.style.display = abrir ? '' : 'none';
  if (lbl) lbl.textContent = abrir ? '⚙️ Ocultar edición' : '⚙️ Editar motivos';
  if (abrir) renderDesestEditor();
}
function renderDesestEditor(){
  var ed = document.getElementById('desestEditor'); if (!ed) return;
  var lista = motivosDesestActuales();
  ed.innerHTML =
    lista.map(function(m, i){
      return '<div class="desest-edit-row"><span>' + esc(m) + '</span>'
        + '<button type="button" class="rowbtn" title="Quitar" onclick="desestQuitarMotivo(' + i + ')">🗑️</button></div>';
    }).join('')
    + '<div class="desest-edit-add"><input class="inp" id="desestNuevo" maxlength="60" placeholder="Nuevo motivo…" onkeydown="if(event.key===\'Enter\'){event.preventDefault();desestAgregarMotivo();}">'
    + '<button type="button" class="btn btn-sm" onclick="desestAgregarMotivo()">Agregar</button></div>';
}
async function guardarMotivosDesest(lista){
  var res = await api('/api/informes/motivos-desestimacion', { motivos: lista });
  if (!res.ok){ nsAlert((res.data && res.data.error) || 'No se pudo guardar.'); return false; }
  if (typeof INFORMES_CFG !== 'object' || !INFORMES_CFG) INFORMES_CFG = {};
  INFORMES_CFG.motivosDesestimacion = (res.data && res.data.motivosDesestimacion) || lista;
  return true;
}
async function desestAgregarMotivo(){
  var inp = document.getElementById('desestNuevo');
  var v = inp ? inp.value.trim() : '';
  if (!v) return;
  var lista = motivosDesestActuales();
  if (lista.some(function(x){ return x.toUpperCase() === v.toUpperCase(); })){ if (inp) inp.value = ''; return; }
  lista.push(v);
  if (await guardarMotivosDesest(lista)){ renderDesestEditor(); renderDesestMotivos(); }
}
async function desestQuitarMotivo(i){
  var lista = motivosDesestActuales();
  lista.splice(i, 1);
  if (await guardarMotivosDesest(lista)){ renderDesestEditor(); renderDesestMotivos(); }
}
async function cabDesestimarSeleccionados(){
  var ids = [].slice.call(document.querySelectorAll('#cabBody .cab-check'))
    .filter(function(c){ return c.checked; }).map(function(c){ return c.value; });
  if (!ids.length) return;
  var motivo = await pedirMotivoDesest(ids.length);
  if (motivo === null) return; // canceló
  var slug = document.getElementById('cabCliente').value;
  var cnt = document.getElementById('cabSelCount');
  var okN = 0, errN = 0;
  for (var i = 0; i < ids.length; i++){
    if (cnt) cnt.textContent = 'desestimando ' + (i+1) + '/' + ids.length + '…';
    try {
      var res = await api('/api/clientes/'+slug+'/informes/'+encodeURIComponent(ids[i])+'/desestimar', { desestimar: true, motivo: motivo });
      if (res.ok){ okN++; var it=(CAB_ITEMS||[]).find(function(x){return x.id===ids[i];}); if(it) it.desestimado = (res.data && res.data.item && res.data.item.desestimado) || { at:new Date().toISOString() }; }
      else errN++;
    } catch(e){ errN++; }
  }
  aplicarFiltroCabina();
  nsAlert('Desestimados: ' + okN + (errN ? (' · ' + errN + ' con error') : '') + '.');
}
async function uploadInformes(files){
  if (!files || !files.length) return;
  var slug = document.getElementById('cabCliente').value;
  if (!slug){ nsAlert('Elegí un cliente primero.'); document.getElementById('cabFiles').value=''; return; }
  var fd = new FormData();
  for (var i=0;i<files.length;i++) fd.append('archivo'+i, files[i]);
  var meta = document.getElementById('cabResultMeta');
  if (meta) meta.textContent = 'Leyendo '+files.length+' informe(s)… los escaneados tardan un poco.';
  try {
    var r = await fetch('/api/clientes/'+slug+'/informes/upload', { method:'POST', body:fd });
    var d = await r.json();
    if (!r.ok) nsAlert(d.error || 'No se pudieron subir los informes.');
  } catch(e){ nsAlert('Error de red al subir.'); }
  document.getElementById('cabFiles').value = '';
  await refreshCabina();
}
function abrirInforme(id){
  var it = CAB_ITEMS.find(function(x){ return x.id === id; }); if (!it) return;
  CAB_ITEM = it;
  var slug = document.getElementById('cabCliente').value;
  document.getElementById('cabModalTitle').textContent = it.filename;
  document.getElementById('cabModalErr').textContent = '';
  document.getElementById('cabOmeManual').value = (it.resuelto && it.resuelto.ome) || '';
  // El beneficio a mano arranca vacío en cada paciente (o con el que ya tenga el
  // informe). Sin esto quedaba pegado el del paciente anterior -> riesgo de guardarlo mal.
  document.getElementById('cabBenefManual').value = (it.extract && it.extract.beneficio) || '';
  // Vista del archivo original: pdf/imagen embebido; el Word el navegador no lo dibuja,
  // así que mostramos el TEXTO extraído (para leer el contenido sin abrir Word).
  var frame = document.getElementById('cabFrame');
  var cajaTxt = document.getElementById('cabTexto');
  var urlArch = '/api/clientes/'+slug+'/informes/'+id+'/archivo';
  var esPreview = /\.(pdf|jpe?g|png|tiff?)$/i.test(it.filename);
  if (esPreview){ frame.style.display=''; frame.src = urlArch; cajaTxt.style.display='none'; }
  else {
    frame.style.display='none'; frame.removeAttribute('src');
    cajaTxt.style.display=''; cajaTxt.textContent = 'Leyendo el documento…';
    var reqId = id;
    fetch('/api/clientes/'+slug+'/informes/'+id+'/texto').then(function(r){ return r.json(); }).then(function(d){
      if (!CAB_ITEM || CAB_ITEM.id !== reqId) return; // cambió de informe mientras cargaba
      var txt = (d && d.texto || '').trim();
      cajaTxt.textContent = txt || (d && d.error ? 'No se pudo leer: '+d.error : 'El documento no tiene texto.');
    }).catch(function(){ if (CAB_ITEM && CAB_ITEM.id===reqId) cajaTxt.textContent = 'No se pudo leer el documento.'; });
  }
  // Datos extraídos.
  var via = it.match && it.match.via ? it.match.via.replace('beneficio_padron','beneficio (padrón)').replace('beneficio_informe','beneficio (informe)') : '';
  var datos = '<div class="cab-datos-grid">'
    + cabDato('Paciente', (it.extract&&it.extract.nombre)||'—')
    + cabDato('DNI', (it.extract&&it.extract.dni)||'—')
    + cabDato('Beneficio', (it.extract&&it.extract.beneficio)||'—')
    + cabDato('Práctica', (it.extract&&it.extract.practica)||'—')
    + '</div>'
    + '<div class="cab-estado-line">'+cabBadge(it)+ (via?(' <span class="cab-sub">por '+esc(via)+'</span>'):'')
    + (it.extract&&it.extract.ocrUsado?' <span class="cab-ocr">OCR</span>':'')
    + (!esPreview?(' · <a href="'+urlArch+'" target="_blank" rel="noopener">Abrir el Word original</a>'):'') + '</div>';
  document.getElementById('cabDatos').innerHTML = datos;
  // Candidatos de la bandeja.
  var cands = (it.match && it.match.candidatos) || [];
  var cont = document.getElementById('cabCandidatos');
  if (!cands.length){
    var sug = (it.match && it.match.sugerencias) || [];
    // Cuando el informe declara una obra social que no es PAMI, el
    // problema no es que "no se encontró": es que no hay que buscarlo.
    // Decirlo cambia lo que el operador hace: en vez de ponerse a buscar
    // la OME, lo saca de la cola.
    //
    // OJO: acá NO va un `return`. Después del if/else viene el
    // showModal, así que cortar el flujo deja el panel sin abrir.
    var noPami = !!(it.match && it.match.estado === 'no_es_pami');
    var h;
    if (noPami){
      var os = ((it.match && it.match.obraSocial) || '').trim();
      h = '<div class="cab-sub">'
        + 'El informe dice <b>' + esc(os || 'otra obra social') + '</b>, as&iacute; que no es de PAMI '
        + 'y no se busca en el padr&oacute;n.'
        + '<br>Si en realidad es de PAMI, fij&aacute; la OME a mano ac&aacute; abajo.</div>';
    } else {
      h = '<div class="cab-sub">Sin candidatos en la bandeja. Fijá la OME a mano si la conocés.</div>';
    }
    if (sug.length && !noPami){
      h += '<div class="cab-cand-title" style="margin-top:10px">¿Es alguno de estos? (del padrón)</div>'
        + sug.map(function(s){
          return '<div class="cab-cand">'
            + '<div class="cab-cand-main"><b>'+esc(s.nombre||'')+'</b><div class="cab-sub">DNI '+esc(s.dni||'—')+' · benef '+esc(s.beneficio||'—')+' · '+Math.round((s.score||0)*100)+'% parecido</div></div>'
            + '<button class="btn btn-ghost btn-sm" onclick="usarSugerencia(\''+esc(s.beneficio||'')+'\')">Usar</button>'
            + '</div>';
        }).join('');
    }
    cont.innerHTML = h;
  }
  else {
    // Un informe puede cubrir varias OMEs (otorrino: otomicroscopía + rinomanometría).
    // Tildás las que correspondan y "Usar los N tildados" las pega todas; el "Usar" de
    // cada fila sigue sirviendo para el caso de una sola.
    // Ya tildadas: lo que resolvió el operador, o —si todavía no lo tocó— las que
    // el matcher encontró solo cuando el informe cubre varias prácticas.
    var yaSel = (it.resuelto && (it.resuelto.omes || (it.resuelto.ome ? [it.resuelto.ome] : [])))
      || (it.match && it.match.omes) || [];
    cont.innerHTML = '<div class="cab-cand-title">Candidatos en la bandeja <span class="cab-sub" style="font-weight:400">— tildá varios si el informe cubre más de una práctica</span></div>'
      + cands.map(function(c){
        var estado = c.transmitida ? '<span class="cab-badge muted">ya transmitido</span>' : (c.validada?'<span class="cab-badge ok">validada</span>':'<span class="cab-badge warn">sin validar</span>');
        var ck = (c.ome && yaSel.indexOf(c.ome)>=0) ? ' checked' : '';
        return '<div class="cab-cand">'
          + '<input type="checkbox" class="cab-cand-ck" value="'+esc(c.ome||'')+'" data-benef="'+esc(c.beneficio||'')+'" onchange="actualizarSelOmes()"'+(c.ome?'':' disabled')+ck+'>'
          + '<div class="cab-cand-main"><b>'+esc(c.practica||'—')+'</b><div class="cab-sub">'+esc(c.nombre||'')+' · benef '+esc(c.beneficio||'—')+' · OME '+esc(c.ome||'—')+'</div></div>'
          + estado
          + '<button class="btn btn-ghost btn-sm" onclick="usarCandidato(\''+esc(c.ome||'')+'\',\''+esc(c.beneficio||'')+'\')">Usar</button>'
          + '</div>';
      }).join('')
      + '<div id="cabSelBar" class="cab-selbar" style="display:none"><button class="btn btn-primary btn-sm" onclick="usarSeleccionados()">Usar los <span id="cabSelN">0</span> tildados</button></div>';
    actualizarSelOmes();
  }
  showModal('cabinaModal', 'cabinaScrim');
}
function cabDato(label, val){ return '<div class="cab-dato"><span>'+esc(label)+'</span><b>'+esc(val)+'</b></div>'; }
function cerrarCabinaModal(){ hideModal('cabinaModal', 'cabinaScrim'); var f=document.getElementById('cabFrame'); if(f) f.removeAttribute('src'); var t=document.getElementById('cabTexto'); if(t){ t.textContent=''; t.style.display='none'; } CAB_ITEM=null; }
function usarCandidato(ome, beneficio){ if (!ome){ document.getElementById('cabModalErr').textContent='Ese candidato no tiene OME.'; return; } document.getElementById('cabOmeManual').value = ome; resolverInformeManual(beneficio||''); }
// Muestra/oculta la barra "Usar los N tildados" según cuántos candidatos se marcaron.
function actualizarSelOmes(){
  var cks = document.querySelectorAll('.cab-cand-ck:checked');
  var bar = document.getElementById('cabSelBar');
  if (!bar) return;
  var n = document.getElementById('cabSelN'); if (n) n.textContent = cks.length;
  bar.style.display = cks.length ? '' : 'none';
}
// Resuelve el informe contra VARIAS OMEs de una (el archivo se sube a cada una).
async function usarSeleccionados(){
  if (!CAB_ITEM) return;
  var cks = document.querySelectorAll('.cab-cand-ck:checked');
  if (!cks.length) return;
  var omes = [], benef = '';
  cks.forEach(function(c){ omes.push(c.value); if(!benef) benef = c.getAttribute('data-benef')||''; });
  benef = benef || (CAB_ITEM.extract && CAB_ITEM.extract.beneficio) || '';
  var slug = document.getElementById('cabCliente').value;
  var err = document.getElementById('cabModalErr');
  var r = await fetch('/api/clientes/'+slug+'/informes/'+CAB_ITEM.id+'/resolver', {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ omes:omes, beneficio:benef }) });
  var d = await r.json();
  if (!r.ok){ err.textContent = d.error || 'No se pudo confirmar.'; return; }
  cerrarCabinaModal();
  await refreshCabina();
}
// Usar una sugerencia del padrón: carga su beneficio (lo aprende) y re-matchea.
function usarSugerencia(beneficio){ if(!beneficio){ return; } document.getElementById('cabBenefManual').value = beneficio; guardarBeneficioInforme(); }
async function resolverInformeManual(benefOverride){
  if (!CAB_ITEM) return;
  var slug = document.getElementById('cabCliente').value;
  var ome = document.getElementById('cabOmeManual').value.replace(/\D+/g,'');
  var err = document.getElementById('cabModalErr');
  if (!ome){ err.textContent = 'Escribí el número de OME.'; return; }
  var benef = benefOverride || (CAB_ITEM.extract && CAB_ITEM.extract.beneficio) || '';
  var r = await fetch('/api/clientes/'+slug+'/informes/'+CAB_ITEM.id+'/resolver', {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ ome:ome, beneficio:benef }) });
  var d = await r.json();
  if (!r.ok){ err.textContent = d.error || 'No se pudo confirmar.'; return; }
  cerrarCabinaModal();
  await refreshCabina();
}
// Guardar el beneficio (lo aprende en el padrón por DNI) y re-matchear. Para los
// "No se encontró": el operador lo busca en PAMI y lo carga una sola vez.
async function guardarBeneficioInforme(){
  if (!CAB_ITEM) return;
  var slug = document.getElementById('cabCliente').value;
  var ben = (document.getElementById('cabBenefManual').value||'').replace(/\D+/g,'');
  var err = document.getElementById('cabModalErr');
  if (ben.length < 10){ err.textContent = 'El beneficio tiene que tener al menos 10 dígitos.'; return; }
  var r = await fetch('/api/clientes/'+slug+'/informes/'+CAB_ITEM.id+'/beneficio', {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ beneficio:ben }) });
  var d = await r.json();
  if (!r.ok){ err.textContent = d.error || 'No se pudo guardar.'; return; }
  var idAct = CAB_ITEM.id;
  await refreshCabina();               // actualiza la lista con el re-match
  abrirInforme(idAct);                 // reabre con el resultado (quedó ok, o hay que elegir práctica)
}
async function reanalizarInforme(id){
  var slug = document.getElementById('cabCliente').value;
  var r = await fetch('/api/clientes/'+slug+'/informes/'+id+'/rematch', { method:'POST' });
  if (r.ok) await refreshCabina(); else { var d=await r.json().catch(function(){return{};}); nsAlert(d.error||'No se pudo reanalizar.'); }
}
async function borrarInforme(id){
  if (!await nsConfirm('Se elimina de la lista de informes recibidos. No se puede deshacer.', { titulo:'Borrar informe', okLabel:'Borrar', peligro:true })) return;
  var slug = document.getElementById('cabCliente').value;
  var r = await fetch('/api/clientes/'+slug+'/informes/'+id, { method:'DELETE' });
  if (r.ok) await refreshCabina();
}
// Desestimar (dar por cerrado sin subir) / reactivar. `esta`=true si ya está desestimado.
async function toggleDesestimar(id, esta){
  var motivo = '';
  if (!esta){
    motivo = await pedirMotivoDesest(1);
    if (motivo === null) return; // canceló
  }
  var slug = document.getElementById('cabCliente').value;
  var payload = esta ? { desestimar: false } : { desestimar: true, motivo: motivo };
  var res = await api('/api/clientes/'+slug+'/informes/'+encodeURIComponent(id)+'/desestimar', payload);
  if (!res.ok){ nsAlert((res.data && res.data.error) || 'No se pudo desestimar.'); return; }
  var it = (CAB_ITEMS||[]).find(function(x){ return x.id===id; });
  if (it){ if (res.data.item && res.data.item.desestimado) it.desestimado = res.data.item.desestimado; else delete it.desestimado; }
  aplicarFiltroCabina();
}
// Reclamar al centro: el operador no sabe de qué paciente es y lo reclamó para que
// confirmen. Queda "en gestión" (fuera de revisar), con una nota. Reversible: soltar
// lo devuelve a su estado anterior.
// ===== Ventanas in-app (reemplazan confirm()/prompt() del navegador) =====
var _nsAskResolve = null, _nsAskMode = 'confirm';
function _nsAskOpen(opts){
  return new Promise(function(resolve){
    _nsAskResolve = resolve;
    _nsAskMode = opts.mode || 'confirm';
    var t = document.getElementById('nsAskTitle');
    if (t) t.textContent = opts.titulo || (_nsAskMode === 'prompt' ? 'Escribí' : 'Confirmar');
    var body = document.getElementById('nsAskBody');
    if (body) body.innerHTML = opts.cuerpoHtml || (opts.cuerpo ? esc(opts.cuerpo).replace(/\n/g, '<br>') : '');
    var wrap = document.getElementById('nsAskInputWrap');
    var inp = document.getElementById('nsAskInput');
    if (_nsAskMode === 'prompt'){
      if (wrap) wrap.style.display = '';
      var lbl = document.getElementById('nsAskInputLabel'); if (lbl) lbl.textContent = opts.inputLabel || '';
      if (inp){ inp.type = opts.inputType || 'text'; inp.placeholder = opts.placeholder || ''; inp.value = opts.valor || ''; }
    } else if (wrap){ wrap.style.display = 'none'; }
    var okB = document.getElementById('nsAskOkBtn');
    if (okB){
      okB.textContent = opts.okLabel || (_nsAskMode === 'prompt' ? 'Guardar' : 'Confirmar');
      okB.className = 'btn ' + (opts.peligro ? 'btn-danger' : 'btn-primary');
    }
    var cB = document.getElementById('nsAskCancelBtn');
    if (cB){
      if (opts.cancelLabel === ''){ cB.style.display = 'none'; }
      else { cB.style.display = ''; cB.textContent = opts.cancelLabel || 'Cancelar'; }
    }
    showModal('nsAskModal', 'nsAskScrim');
    setTimeout(function(){ try { (_nsAskMode === 'prompt' && inp ? inp : okB).focus(); } catch(e){} }, 30);
  });
}
function nsAskCancel(){
  hideModal('nsAskModal', 'nsAskScrim');
  if (_nsAskResolve){ var r = _nsAskResolve; _nsAskResolve = null; r(_nsAskMode === 'prompt' ? null : false); }
}
function nsAskOk(){
  var val = _nsAskMode === 'prompt' ? ((document.getElementById('nsAskInput')||{}).value || '').trim() : true;
  hideModal('nsAskModal', 'nsAskScrim');
  if (_nsAskResolve){ var r = _nsAskResolve; _nsAskResolve = null; r(val); }
}
// nsConfirm(cuerpo, opts) -> Promise<bool>; nsPrompt(label, opts) -> Promise<string|null>
function nsConfirm(cuerpo, opts){ return _nsAskOpen(Object.assign({ mode:'confirm', cuerpo:cuerpo }, opts || {})); }
function nsPrompt(inputLabel, opts){ return _nsAskOpen(Object.assign({ mode:'prompt', inputLabel:inputLabel }, opts || {})); }
// nsAlert: aviso (un solo botón). Reemplaza al nsAlert() del navegador. Se puede usar
// sin await (muestra la ventana y el código sigue) o con await si querés esperar.
function nsAlert(cuerpo, opts){ return _nsAskOpen(Object.assign({ mode:'confirm', cuerpo:cuerpo, titulo:'Aviso', okLabel:'Entendido', cancelLabel:'' }, opts || {})); }

async function toggleReclamar(id, esta){
  var nota = '';
  if (!esta){
    nota = await nsPrompt('¿Qué reclamaste? (queda anotado)', {
      titulo: 'Reclamar al centro',
      cuerpo: 'Anotá qué reclamaste para que quede registrado.',
      placeholder: 'Ej: reclamado a Caballito para que confirmen el paciente',
      okLabel: 'Reclamar' });
    if (nota === null) return;   // canceló
  } else {
    if (!await nsConfirm('Vuelve a la lista de revisar.', { titulo:'Soltar informe', okLabel:'Soltar' })) return;
  }
  var slug = document.getElementById('cabCliente').value;
  var res = await api('/api/clientes/'+slug+'/informes/'+encodeURIComponent(id)+'/reclamar', esta ? { reclamar: false } : { nota: nota });
  if (!res.ok){ nsAlert((res.data && res.data.error) || 'No se pudo reclamar.'); return; }
  var it = (CAB_ITEMS||[]).find(function(x){ return x.id===id; });
  if (it){ if (res.data.item && res.data.item.reclamado) it.reclamado = res.data.item.reclamado; else delete it.reclamado; }
  aplicarFiltroCabina();
}

var ME = null;         // usuario EFECTIVO (el espejado si el modo espejo está activo)
var ME_REAL = null;    // usuario realmente logueado (siempre el admin real)
var ESPEJO = false;    // modo espejo activo (solo lectura)
function setUser(u){ ME_REAL = u; aplicarUsuario(u); actividadArrancarHeartbeat(); cargarPlanSaludSlugs(); }
// ---------- Actividad (heartbeat de horas conectado) ----------
// Solo tiene efecto real en el backend para el rol "operador" (ver
// ROLES_MONITOREADOS en server.js); para cualquier otro rol el ping no hace
// nada, así que ni lo mandamos. Usa SIEMPRE ME_REAL (la sesión real), no ME
// (que puede estar "espejado" por un admin viendo como otro usuario) - lo que
// se mide es cuánto tiempo pasa conectado el que realmente inició sesión.
var ACTIVIDAD_HB_WIRED = false;
function actividadArrancarHeartbeat(){
  if (ACTIVIDAD_HB_WIRED) return;
  if (!ME_REAL || ME_REAL.role !== 'operador') return;
  ACTIVIDAD_HB_WIRED = true;
  var enviar = function(){ if (document.visibilityState !== 'hidden') req('POST', '/api/actividad/ping'); };
  enviar();
  setInterval(enviar, 60000);
}
// ---------- Menú de cuenta (cuelga del avatar de arriba a la derecha) ----------
// Las acciones de la PERSONA (cambiar clave, salir) viven acá; lo del sistema
// (Configuración general, Ver como…) sigue en la barra lateral.
function toggleAvatarMenu(ev){
  if (ev) ev.stopPropagation();
  var m = document.getElementById('avatarMenu'); if (!m) return;
  if (m.hidden) abrirAvatarMenu(); else cerrarAvatarMenu();
}
function abrirAvatarMenu(){
  var m = document.getElementById('avatarMenu'); if (!m) return;
  m.hidden = false;
  var btn = document.getElementById('topAvatar'); if (btn) btn.setAttribute('aria-expanded', 'true');
}
function cerrarAvatarMenu(){
  var m = document.getElementById('avatarMenu'); if (!m || m.hidden) return;
  m.hidden = true;
  var btn = document.getElementById('topAvatar'); if (btn) btn.setAttribute('aria-expanded', 'false');
}
// Se cierra al hacer clic afuera o con Escape, como cualquier menú del sistema.
document.addEventListener('click', function(e){
  var m = document.getElementById('avatarMenu');
  if (!m || m.hidden) return;
  var btn = document.getElementById('topAvatar');
  if (!m.contains(e.target) && !(btn && btn.contains(e.target))) cerrarAvatarMenu();
});
document.addEventListener('keydown', function(e){ if (e.key === 'Escape') cerrarAvatarMenu(); });

// Aplica la UI (menú, sidebar, saludo) para un usuario dado.
function aplicarUsuario(u){
  ME = u;
  // Administración (Facturas/Gastos) es solo para admin.
  var gp = document.getElementById('navGroupPagos'); if (gp) gp.style.display = (u.role === 'admin') ? '' : 'none';
  var lb = document.getElementById('labBtn'); if (lb) lb.style.display = (u.role === 'admin') ? '' : 'none';   // botón Laboratorio (martillo), solo admin
  var sb = document.getElementById('srvBtn'); if (sb) sb.style.display = (u.role === 'admin') ? '' : 'none';   // botón Estado del server, solo admin
  if (u.role === 'admin') { srvRefrescarDot(); if (SRV_DOT_POLL) clearInterval(SRV_DOT_POLL); SRV_DOT_POLL = setInterval(srvRefrescarDot, 60000); }
  // Padrón (Afiliados) e Informes recibidos: admin y operador (los USAN); el usuario
  // de demostración los VE pero no puede ejecutar acciones (el backend se las bloquea).
  var verHerramientas = (u.role === 'admin' || u.role === 'operador' || u.role === 'demo');
  var np = document.getElementById('navPadron'); if (np) np.style.display = verHerramientas ? '' : 'none';
  var nc = document.getElementById('navCabina'); if (nc) nc.style.display = verHerramientas ? '' : 'none';
  var nl = document.getElementById('navLiberarCupo'); if (nl) nl.style.display = (u.role === 'admin' || u.role === 'operador') ? '' : 'none';
  var no = document.getElementById('navOmeWeb'); if (no) no.style.display = (u.role === 'admin' || u.role === 'operador') ? '' : 'none';
  // Cruzas: herramienta nueva y sensible (montos + datos de pacientes) - solo admin por ahora.
  var ncz = document.getElementById('navCruzas'); if (ncz) ncz.style.display = (u.role === 'admin') ? '' : 'none';
  // Nomencladores: por ahora un operador no lo necesita - se le oculta (mismo
  // criterio de alcance que Consultorios). El colaborador tampoco.
  var esColaborador = (u.role === 'colaborador');
  var nn = document.getElementById('navNomencladores'); if (nn) nn.style.display = (u.role === 'operador' || esColaborador) ? 'none' : '';
  // Colaborador: por ahora entra SOLO a los dashboards de sus clientes, así que
  // del menú le queda Inicio + la lista de clientes. Cuando se le sumen módulos,
  // se habilitan de a uno acá y en clientSeccionesPermitidas().
  if (esColaborador) {
    ['navInformes', 'navOmeWeb', 'navPadron', 'navCabina', 'navLiberarCupo', 'navCruzas', 'navNomencladores'].forEach(function(id){
      var el = document.getElementById(id); if (el) el.style.display = 'none';
    });
  }
  // Operador NS (Javi): las herramientas dejan de vivir sueltas en el menú y
  // pasan a ser PESTAÑAS dentro de cada cliente, ya scopeadas a ese cliente y
  // según lo que el admin le habilitó cliente por cliente (OPERADOR_MODULOS /
  // modulosClienteDe). El menú le queda Inicio + sus clientes: una herramienta
  // siempre se usa desde adentro del cliente, así no puede quedar apuntando al
  // cliente equivocado.
  if (u.role === 'operador') {
    ['navInformes', 'navOmeWeb', 'navPadron', 'navCabina', 'navLiberarCupo'].forEach(function(id){
      var el = document.getElementById(id); if (el) el.style.display = 'none';
    });
  }
  // Configuración general (usuarios, débitos): alguien con clientes restringidos
  // no debe entrar ahí - un operador sin restringir sí, como siempre.
  var ngen = document.getElementById('navGeneral'); if (ngen) ngen.style.display = tieneClientesRestringidos(u) ? 'none' : '';
  // Javi (rol operador): no debe leer la palabra "Clientes" en el menú - se
  // oculta el título de esa sección (el desplegable de Med. Cabecera queda
  // igual adentro, solo sin el agrupador visible por encima). Al perder el
  // header pierde también su botón de plegar/desplegar, así que forzamos a
  // que el contenido quede siempre visible (nunca colapsado).
  var navSecCli = document.getElementById('navSectionClientes');
  var itemsCli = document.querySelector('.nav-section-items[data-section-items="clientes"]');
  // El contenedor de clientes es .ns-only (interno de NS), pero clínica y
  // operador_clinica NAVEGAN justamente por ahí (su propio centro). Sin esto, el
  // CSS body.role-clinica .ns-only lo tapa con !important y el menú de la clínica
  // queda vacío. Se le saca ns-only SOLO a esos dos roles (igual que el patrón de
  // navInformes en operador_clinica); para el resto queda como estaba.
  var esRolCentro = (u.role === 'clinica' || u.role === 'operador_clinica');
  if (itemsCli) itemsCli.classList.toggle('ns-only', !esRolCentro);
  if (u.role === 'operador' || esRolCentro) {
    // No necesitan el rótulo "clientes" arriba del grupo (operador ni lee la
    // palabra; clínica/operador_clinica ya ven el nombre del centro como header
    // del grupo). Y el contenido queda siempre desplegado, nunca colapsado.
    if (navSecCli) navSecCli.style.display = 'none';
    if (itemsCli) itemsCli.classList.remove('collapsed');
  } else if (navSecCli) {
    navSecCli.style.display = '';
  }
  var ini = initials(u.name);
  document.getElementById('sideName').textContent = u.name;
  document.getElementById('sideRole').textContent = roleLabel(u.role);
  // Mismo dato en la cabecera del menú del avatar (que es de dónde ahora salen
  // "Cambiar contraseña" y "Cerrar sesión").
  var amN = document.getElementById('avatarMenuName'); if (amN) amN.textContent = u.name;
  var amR = document.getElementById('avatarMenuRole'); if (amR) amR.textContent = roleLabel(u.role);
  cerrarAvatarMenu();
  // Para la clínica, en vez de iniciales (que salen feas, ej. "CIMA (centro)" → "C(")
  // mostramos una cruz de salud. Los usuarios internos de NS mantienen sus iniciales.
  var cruzSalud = '<svg viewBox="0 0 24 24" style="width:20px;height:20px" aria-hidden="true"><path d="M9.5 3h5a1 1 0 011 1v4.5H20a1 1 0 011 1v5a1 1 0 01-1 1h-4.5V20a1 1 0 01-1 1h-5a1 1 0 01-1-1v-4.5H4a1 1 0 01-1-1v-5a1 1 0 011-1h4.5V4a1 1 0 011-1z" fill="currentColor"/></svg>';
  var sa = document.getElementById('sideAvatar'), ta = document.getElementById('topAvatar');
  if (u.role === 'clinica' || u.role === 'operador_clinica'){ if (sa) sa.innerHTML = cruzSalud; if (ta) ta.innerHTML = cruzSalud; }
  else { if (sa) sa.textContent = ini; if (ta) ta.textContent = ini; }
  // El saludo vive en la barra de arriba (título de Inicio). Si al entrar la vista
  // visible es el dashboard, lo ponemos ya (el login normal no pasa por go('dash')).
  var _vdTit = document.getElementById('view-dash');
  if (_vdTit && getComputedStyle(_vdTit).display !== 'none') document.getElementById('pageTitle').innerHTML = saludoHTML(u);
  // El acceso "Ver como…" solo lo ve el admin real.
  var vc = document.getElementById('verComoLink'); if (vc) vc.style.display = (ME_REAL && ME_REAL.role === 'admin') ? '' : 'none';
  // Rol clínica: solo su centro (oculta lo interno de NS por CSS) y sin "Adjuntar reporte".
  document.body.classList.toggle('role-clinica', u.role === 'clinica');
  document.body.classList.toggle('role-demo', u.role === 'demo');
  // Operador Clínica: mismo encierro visual que clínica (oculta lo interno de NS).
  document.body.classList.toggle('role-operador_clinica', u.role === 'operador_clinica');
  // Módulos puntuales habilitados para ESTE operador_clinica (afiliados/informes/
  // liberar cupo): el CSS de arriba oculta TODO lo .ns-only con !important, así
  // que para destapar un ítem hay que sacarle la clase (un display inline no le
  // gana al !important).
  if (u.role === 'operador_clinica') {
    var opMods = Array.isArray(u.modulos) ? u.modulos : [];
    [['navPadron', 'padron'], ['navInformes', 'informes'], ['navLiberarCupo', 'liberarcupo']].forEach(function(par){
      var el = document.getElementById(par[0]);
      if (!el) return;
      var habilitado = opMods.indexOf(par[1]) >= 0;
      el.classList.toggle('ns-only', !habilitado);
      el.style.display = habilitado ? '' : 'none';
    });
  }
  var tabRep = document.getElementById('clientTabReportes'); if (tabRep) tabRep.style.display = (u.role === 'clinica') ? 'none' : '';
  // El login normal NO pasa por go('dash') (el dashboard se ve por defecto), así que
  // marcamos la clase de la vista de inicio acá según qué sección está visible.
  var _vd = document.getElementById('view-dash');
  document.body.classList.toggle('dash-view', !!(_vd && getComputedStyle(_vd).display !== 'none'));
  iniArrancar();   // campana: mensajes del Inicio (admin/operador) o pendientes del centro (operador_clinica)
}
// Vistas internas de NS a las que la clínica no entra (la mandamos a su centro).
var NS_ONLY_VIEWS = ['dash','informes','omeweb','nomencladores','credencial','soon','resumen','facturas','padron','cabina','liberarcupo','cruzas'];
// ===== Modo espejo: ver el sistema como otro usuario (solo lectura) =====
async function abrirVerComo(){
  if (!ME_REAL || ME_REAL.role !== 'admin') return;
  var res = await api('/api/users');
  var users = (res.ok && res.data && (res.data.users || res.data)) || [];
  var sel = document.getElementById('espejoSelect');
  window._ESPEJO_USERS = users;
  sel.innerHTML = users.filter(function(u){ return u.username !== ME_REAL.username; })
    .map(function(u){ return '<option value="' + esc(u.username) + '">' + esc(u.name) + ' — ' + esc(roleLabel(u.role)) + '</option>'; }).join('');
  if (!sel.innerHTML){ sel.innerHTML = '<option value="">(no hay otros usuarios)</option>'; }
  showModal('espejoModal', 'espejoScrim');
}
function cerrarVerComo(){ hideModal('espejoModal', 'espejoScrim'); }
function confirmarVerComo(){
  var sel = document.getElementById('espejoSelect');
  var uname = sel && sel.value;
  var u = (window._ESPEJO_USERS || []).find(function(x){ return x.username === uname; });
  if (!u) return;
  cerrarVerComo();
  verComo(u);
}
function verComo(u){
  if (!ME_REAL || ME_REAL.role !== 'admin') return;
  ESPEJO = true;
  aplicarUsuario(u);
  document.body.classList.add('espejo-activo');
  var nom = document.getElementById('espejoBannerNombre'); if (nom) nom.textContent = u.name + ' · ' + roleLabel(u.role);
  renderClientList();  // re-filtra el menú según el usuario espejado (clínica → su centro)
  go('dash');
}
function salirEspejo(){
  ESPEJO = false;
  aplicarUsuario(ME_REAL);
  document.body.classList.remove('espejo-activo');
  renderClientList();  // vuelve a mostrar todos los centros
  go('dash');
}
var _espejoToastT = null;
function toastEspejo(){
  var t = document.getElementById('espejoToast'); if (!t) return;
  t.classList.add('show');
  if (_espejoToastT) clearTimeout(_espejoToastT);
  _espejoToastT = setTimeout(function(){ t.classList.remove('show'); }, 1800);
}
function bloqueadoEspejo(){ if (ESPEJO){ toastEspejo(); return true; } return false; }
function showApp(){ document.body.classList.remove('mustchange','booting'); document.body.classList.add('authed'); renderUsers(); loadClients({ detail:false }); applyRoute(); }
function showChange(){ document.body.classList.remove('authed','booting'); document.body.classList.add('mustchange'); }
function showLogin(){ document.body.classList.remove('authed','mustchange','booting','resetting'); }

async function api(path, body){
  if (body && bloqueadoEspejo()) return { ok:false, status:0, data:{ error:'Modo espejo: solo lectura' } };
  var opt = { method: body ? 'POST' : 'GET', headers: { 'content-type':'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  var r = await fetch(path, opt);
  var data = {};
  try { data = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, data: data };
}
async function req(method, path, body){
  if (String(method).toUpperCase() !== 'GET' && bloqueadoEspejo()) return { ok:false, status:0, data:{ error:'Modo espejo: solo lectura' } };
  var opt = { method: method, headers: { 'content-type':'application/json' } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  var r = await fetch(path, opt);
  var data = {};
  try { data = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, data: data };
}

// Limpia todo estado de "qué cliente estaba viendo" antes de arrancar una
// sesión nueva. Sin esto, loguearse con otro usuario en la MISMA pestaña (sin
// recargar la página — típico en una PC compartida de recepción, o probando
// varios logins seguidos) podía arrastrar el CLIENTS/ACTIVE_CLIENT/hash del
// login anterior: se vio a Baimed (operador_clinica) mostrando por un
// instante los datos de Cima, porque el hash/las variables globales todavía
// apuntaban al cliente que se estaba viendo antes de loguearse. También borra
// el hash para que TODOS los roles arranquen en Inicio (ver go()/cargarInicio).
function limpiarEstadoClienteAlEntrar(){
  CLIENTS = [];
  ACTIVE_CLIENT = null;
  // Los selectores de "Cliente" de Padrón/Cabina/OME web/Liberar cupo/Cruzas se
  // llenan UNA sola vez por pestaña (si ya tienen opciones, no se vuelven a
  // pedir — evita golpear el server cada vez que se reabre la pantalla). Pero
  // eso significa que sobreviven a un logout: si en la MISMA pestaña entra
  // OTRO usuario, hereda el <select> ya poblado (y hasta el cliente
  // seleccionado) del usuario anterior — que puede no tener acceso a esos
  // clientes → "Tu usuario no tiene acceso a ese cliente" (visto con Javi en
  // Liberar cupo). Se vacían acá para que cada login los repueble con SU
  // propia lista (clientesParaSelector ya scopea por usuario).
  ['lcCliente', 'padCliente', 'cabCliente', 'omeCliente', 'czCliente'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  CZ.clientesCargados = false;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e){ try { location.hash = ''; } catch (e2){} }
}
async function doLogin(){
  var err = document.getElementById('loginError'); err.textContent = '';
  var info = document.getElementById('loginInfo'); if (info) info.textContent = '';
  var btn = document.getElementById('loginBtn'); btn.disabled = true;
  var username = document.getElementById('loginUser').value.trim();
  var password = document.getElementById('pwd').value;
  var remember = document.getElementById('remember').checked;
  if (!username || !password){ btn.disabled = false; err.textContent = 'Completá usuario y contraseña'; return; }
  var res = await api('/api/login', { username: username, password: password, remember: remember });
  btn.disabled = false;
  if (!res.ok){ err.textContent = res.data.error || 'No se pudo ingresar'; return; }
  document.getElementById('pwd').value = '';
  limpiarEstadoClienteAlEntrar();
  setUser(res.data.user);
  if (res.data.user.mustChange) showChange(); else showApp();
}

// ---------- olvidé mi contraseña ----------
function openForgot(){
  document.getElementById('fgId').value = document.getElementById('loginUser').value.trim();
  document.getElementById('fgError').textContent = '';
  document.getElementById('fgOk').textContent = '';
  document.getElementById('fgSend').disabled = false;
  showModal('forgotModal','fgScrim');
  document.getElementById('fgId').focus();
}
function closeForgot(){ hideModal('forgotModal','fgScrim'); }
async function sendForgot(){
  var err = document.getElementById('fgError'); err.textContent = '';
  var ok = document.getElementById('fgOk'); ok.textContent = '';
  var id = document.getElementById('fgId').value.trim();
  if (!id){ err.textContent = 'Escribí tu usuario o email.'; return; }
  var btn = document.getElementById('fgSend'); btn.disabled = true;
  await req('POST', '/api/forgot', { identifier: id });
  ok.textContent = 'Si hay una cuenta con un email registrado, te enviamos el enlace. Revisá tu correo (y el spam).';
}

// ---------- restablecer desde el mail ----------
var RESET_TOKEN = '';
function showReset(){ document.body.classList.remove('authed','mustchange','booting'); document.body.classList.add('resetting'); }
async function doReset(){
  var err = document.getElementById('resetError'); err.textContent = '';
  var a = document.getElementById('rp1').value, b = document.getElementById('rp2').value;
  if (a !== b){ err.textContent = 'Las contraseñas no coinciden'; return; }
  if (a.length < 6){ err.textContent = 'La clave debe tener al menos 6 caracteres'; return; }
  var res = await req('POST', '/api/reset', { token: RESET_TOKEN, newPassword: a });
  if (!res.ok){ err.textContent = res.data.error || 'No se pudo restablecer la clave.'; return; }
  document.getElementById('rp1').value = '';
  document.getElementById('rp2').value = '';
  // limpio el token de la URL y vuelvo al login con aviso
  try { history.replaceState({}, '', location.pathname); } catch (e) {}
  document.body.classList.remove('resetting');
  showLogin();
  var info = document.getElementById('loginInfo');
  if (info) info.textContent = 'Listo, tu clave se actualizó. Ya podés ingresar.';
}

function openChange(){
  document.getElementById('np1').value = '';
  document.getElementById('np2').value = '';
  document.getElementById('changeError').textContent = '';
  showChange();
}

async function doChange(){
  var err = document.getElementById('changeError'); err.textContent = '';
  var a = document.getElementById('np1').value, b = document.getElementById('np2').value;
  if (a !== b){ err.textContent = 'Las contraseñas no coinciden'; return; }
  if (a.length < 6){ err.textContent = 'La clave debe tener al menos 6 caracteres'; return; }
  var res = await api('/api/change-password', { newPassword: a });
  if (!res.ok){ err.textContent = res.data.error || 'No se pudo cambiar la clave'; return; }
  document.getElementById('np1').value = '';
  document.getElementById('np2').value = '';
  showApp();
}

async function doLogout(){
  await api('/api/logout', {});
  document.getElementById('loginUser').value = '';
  document.getElementById('pwd').value = '';
  // Red de seguridad extra (ver limpiarEstadoClienteAlEntrar, que también corre
  // al loguearse): si algo quedó sin limpiar al salir, que no espere al
  // próximo login de otro usuario en esta misma pestaña.
  ME = null; ME_REAL = null; ESPEJO = false;
  limpiarEstadoClienteAlEntrar();
  showLogin();
}

// ---------- init: ¿restablecer? ¿hay sesión? ----------
(async function(){
  var m = location.search.match(/[?&]reset=([^&]+)/);
  if (m){ RESET_TOKEN = decodeURIComponent(m[1]); showReset(); return; }
  var res = await api('/api/me');
  if (res.ok){
    setUser(res.data.user);
    if (res.data.user.mustChange) showChange(); else showApp();
  } else {
    showLogin();
  }
})();

// ---- Aviso de versión nueva (la SPA no recarga el index.html al navegar por hash,
// así que un deploy nuevo no se toma hasta recargar. Chequeamos y avisamos). ----
var __appVerBase = (function(){
  var s = document.querySelector('script[src*="app.js"]');
  var m = s && s.src.match(/[?&]v=(\d+)/);
  return m ? m[1] : '';
})();
async function checkAppVersion(){
  if (!__appVerBase) return;
  try {
    var r = await fetch('/api/version', { cache: 'no-store' });
    if (!r.ok) return;
    var d = await r.json();
    if (d && d.version && String(d.version) !== String(__appVerBase)){
      var b = document.getElementById('appUpdateBanner');
      if (b) b.style.display = 'flex';
    }
  } catch (e) {}
}
document.addEventListener('visibilitychange', function(){ if (!document.hidden) checkAppVersion(); });
setTimeout(checkAppVersion, 3000);
setInterval(checkAppVersion, 5 * 60 * 1000);
