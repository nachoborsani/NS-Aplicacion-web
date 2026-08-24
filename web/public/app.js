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
  var group = document.getElementById(tipo === 'medcab' ? 'navGroupMedCab' : 'navGroupConsultorios');
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

var titles = { dash:'Inicio', users:'Usuarios', clientes:'Clientes', nomencladores:'Nomencladores', informes:'Informes', credencial:'Credencial provisoria', resumen:'Resumen de cuenta', facturas:'Facturas', gastos:'Gastos', soon:'Configuración general' };
// Grupo "Pagos" del menú: si estás en el sidebar colapsado o fuera de la vista,
// entra a Facturas; si ya estás, solo colapsa/expande el desplegable.
function togglePagosGroup(el){
  var group = document.getElementById('navGroupPagos');
  var enFacturas = document.getElementById('view-facturas').style.display !== 'none';
  var colapsado = document.body.classList.contains('sidebar-collapsed');
  if (!enFacturas || colapsado){ go('facturas', el); return; }
  if (group) group.classList.toggle('open');
}
function go(v, el){
  // El rol clínica solo entra a su centro: cualquier vista interna de NS lo redirige.
  if (ME && ME.role === 'clinica' && NS_ONLY_VIEWS.indexOf(v) >= 0){
    if (ME.centro){ go('clientes'); selectClientWhenReady(ME.centro, 'mescurso'); }
    return;
  }
  ['dash','clientes','nomencladores','informes','credencial','resumen','facturas','gastos','soon'].forEach(function(x){ document.getElementById('view-'+x).style.display = x===v ? 'block' : 'none'; });
  document.getElementById('pageTitle').textContent = titles[v];
  document.querySelector('.topbar').classList.toggle('client-mode', v === 'clientes');
  document.body.classList.toggle('client-view', v === 'clientes');
  if (v === 'clientes'){ expandSidebar(); loadClients(); }
  if (v === 'dash') updateDashClientsTile();
  if (v === 'resumen') loadResultado();
  if (v === 'nomencladores') loadNomencladorSummary();
  if (v === 'informes'){ setInformesTab('generar'); loadInformesConfig(); }
  if (v === 'soon'){ renderUsers(); loadGeneralDebitos(); }
  if (v === 'facturas') loadFacturas();
  if (v === 'gastos') loadGastos();
  document.querySelectorAll('.nav a, .side-config a, .nav-parent, .client-nav-item').forEach(function(a){ a.classList.remove('active'); });
  ['navGroupConsultorios', 'navGroupMedCab'].forEach(function(id){
    var g = document.getElementById(id);
    if (g){ g.classList.toggle('open', v === 'clientes'); g.classList.toggle('active', v === 'clientes'); }
  });
  var gPagos = document.getElementById('navGroupPagos');
  var enAdmin = (v === 'resumen' || v === 'facturas' || v === 'gastos');
  if (gPagos){ gPagos.classList.toggle('open', enAdmin); gPagos.classList.toggle('active', enAdmin); }
  if (el) el.classList.add('active');
  document.body.classList.remove('nav-open');
  if (v !== 'informes') pushHash(v);  // en informes el hash lo pone setInformesTab (con la sub-pestaña)
}

// ---------- Credencial provisoria: consulta en vivo a PAMI ----------
async function descargarCredencial(){
  var btn = document.getElementById('credBtn');
  var err = document.getElementById('credError');
  var result = document.getElementById('credResult');
  err.style.display = 'none'; result.style.display = 'none'; result.innerHTML = '';
  var payload = {
    benef: (document.getElementById('credBenef').value || '').trim(),
    dni: (document.getElementById('credDni').value || '').trim(),
    tramite: (document.getElementById('credTramite').value || '').trim(),
    genero: (document.getElementById('credGenero').value || '').trim()
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
// Clientes con módulo de credenciales; la tarjeta aparece en su Dashboard general.
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
  if (r.ok && r.data && r.data.ok === false){ alert(r.data.error || 'No se pudo iniciar.'); return; }
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
  if (['dash', 'clientes', 'nomencladores', 'informes', 'credencial', 'resumen', 'facturas', 'gastos', 'soon'].indexOf(v) < 0) v = 'dash';
  APPLYING_ROUTE = true;
  go(v, navElFor(v));
  APPLYING_ROUTE = false;
  if (v === 'informes'){ var t = parts[1]; setInformesTab(['generar', 'lote', 'config'].indexOf(t) >= 0 ? t : 'generar'); }
  if (v === 'clientes' && parts[1]) selectClientWhenReady(parts[1], parts[2]);
}
function selectClientWhenReady(slug, section, tries){
  tries = tries || 0;
  if (typeof CLIENTS !== 'undefined' && CLIENTS && CLIENTS.length){
    if (CLIENTS.filter(function(c){ return c.slug === slug; })[0]){
      APPLYING_ROUTE = true;
      selectClient(slug);
      if (section && ['mescurso', 'basica', 'dashboard', 'reportes', 'medicos', 'general'].indexOf(section) >= 0) setClientSection(section);
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

function openDrawer(){ document.getElementById('drawer').classList.add('show'); document.getElementById('scrim').classList.add('show'); }
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
    paciente: {
      nombre: document.getElementById('infNombre').value.trim(),
      benef: document.getElementById('infBenef').value.trim(),
      fecha: document.getElementById('infFecha').value.trim(),
      documento: document.getElementById('infDoc').value.trim(),
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
function programarPreviewVivo(){ clearTimeout(PREVIEW_TIMER); PREVIEW_TIMER = setTimeout(actualizarPreviewVivo, 500); }
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
function onInformeSexoChange(){ aplicarDefaultsPorSexo(); programarPreviewVivo(); }
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
function llenarCentros(){
  var sel = document.getElementById('infCentro'); if (!sel) return;
  var prev = sel.value;
  var centros = uniq((INFORMES_CFG.modelos || []).map(function(m){ return m.centro; }));
  sel.innerHTML = centros.map(function(c){ return opt(c, c); }).join('') || '<option value="">(sin centros)</option>';
  if (prev && centros.indexOf(prev) >= 0) sel.value = prev;
  onCentroChange(true);
}
function onCentroChange(keep){
  var centro = (document.getElementById('infCentro') || {}).value || '';
  var sel = document.getElementById('infEspecialidad'); if (!sel) return;
  var prev = keep === true ? sel.value : '';
  var esps = uniq((INFORMES_CFG.modelos || []).filter(function(m){ return m.centro === centro; }).map(function(m){ return m.especialidad; }));
  sel.innerHTML = esps.map(function(e){ return opt(e, e); }).join('') || '<option value="">(sin especialidades)</option>';
  if (prev && esps.indexOf(prev) >= 0) sel.value = prev;
  onEspecialidadChange(keep);
}
function onEspecialidadChange(keep){
  var centro = (document.getElementById('infCentro') || {}).value || '';
  var esp = (document.getElementById('infEspecialidad') || {}).value || '';
  var sel = document.getElementById('infPractica'); if (!sel) return;
  var prev = keep === true ? sel.value : '';
  var ms = (INFORMES_CFG.modelos || []).filter(function(m){ return m.centro === centro && m.especialidad === esp; });
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
// Renderiza los campos técnicos del modelo (ej. Holter) con sus defaults.
function renderCampos(key){
  var wrap = document.getElementById('infCamposWrap'), box = document.getElementById('infCampos');
  if (!wrap || !box) return;
  var campos = modeloCampos(key);
  if (!campos.length){ wrap.style.display = 'none'; box.innerHTML = ''; return; }
  box.innerHTML = campos.map(function(c){
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
  }).join('');
  wrap.style.display = '';
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
  var desc = document.getElementById('infDescripcion');
  if (desc){
    var prevD = desc.value;
    var rs = (INFORMES_CFG.descripciones || []).filter(function(d){ return scopeAplica(d.modelos, key); });
    desc.innerHTML = rs.map(function(d){ return opt(d.id, presetLabel(d)); }).join('')
      + opt('__custom__', 'Texto personalizado');
    if (prevD && rs.some(function(d){ return d.id === prevD; })) desc.value = prevD;
  }
  var med = document.getElementById('infMedico');
  if (med){
    var prevM = med.value;
    var ms = (INFORMES_CFG.medicos || []).filter(function(m){ return scopeAplica(m.modelos, key); });
    med.innerHTML = ms.map(function(m){ return opt(m.id, m.nombre + (m.hasFirma ? '' : ' (sin firma)')); }).join('')
      + opt('', 'Sin firma (deja el espacio)');
    if (prevM) med.value = prevM;
  }
  var ladoWrap = document.getElementById('infLadoWrap');
  if (ladoWrap) ladoWrap.style.display = modeloRequiereLado(key) ? '' : 'none';
  var m = (INFORMES_CFG.modelos || []).find(function(x){ return x.key === key; }) || {};
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
  var cm = document.getElementById('infMedicosCount'); if (cm) cm.textContent = '(' + (INFORMES_CFG.medicos || []).length + ')';
  var cd = document.getElementById('infDescripcionesCount'); if (cd) cd.textContent = '(' + (INFORMES_CFG.descripciones || []).length + ')';
  var ml = document.getElementById('infMedicosList');
  if (ml){
    ml.innerHTML = (INFORMES_CFG.medicos || []).map(function(m){
      var tag = m.hasFirma ? '<span class="cfg-tag on">firma ✓</span>' : '<span class="cfg-tag off">sin firma</span>';
      var fila = '<div class="cfg-row"><span class="cfg-name">' + esc(m.nombre) + '</span>' + tag
        + '<label class="cfg-upload">' + (m.hasFirma ? 'Cambiar' : 'Subir') + ' firma<input type="file" accept="image/png" onchange="uploadFirmaMedico(\'' + esc(m.id) + '\',this)"></label>'
        + '<button class="rowbtn danger" title="Eliminar" onclick="deleteMedico(\'' + esc(m.id) + '\')">' + SVG_TRASH + '</button></div>';
      var sub = modelos.length ? cfgSub('Informes que firma', cfgMetaInformes(m.modelos), '<div class="cfg-scope">' + scopeChips('med', m.id, modelos, m.modelos) + '</div>') : '';
      return '<div class="cfg-item">' + fila + sub + '</div>';
    }).join('') || '<div class="cfg-empty">Todavía no hay médicos.</div>';
  }
  var dl = document.getElementById('infDescripcionesList');
  if (dl){
    dl.innerHTML = (INFORMES_CFG.descripciones || []).map(function(d){
      var titulo = d.nombre || presetLabel(d);
      var prev = d.texto ? '<div class="cfg-textoprev">' + esc(d.texto.length > 220 ? d.texto.slice(0, 218) + '…' : d.texto) + '</div>' : '';
      var fila = '<div class="cfg-row"><span class="cfg-name">' + esc(titulo) + '</span>'
        + '<button class="rowbtn danger" title="Eliminar" onclick="deleteDescripcion(\'' + esc(d.id) + '\')">' + SVG_TRASH + '</button></div>';
      var chips = modelos.length ? '<div class="cfg-scope">' + scopeChips('desc', d.id, modelos, d.modelos) + '</div>' : '';
      // Editor de valores estándar (solo si el resultado está asignado a un informe con campos, ej. Holter)
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
      return '<div class="cfg-item">' + fila + prev + sub + '</div>';
    }).join('') || '<div class="cfg-empty">Todavía no hay resultados.</div>';
  }
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
async function toggleScope(kind, id, key){
  function toggle(arr){ arr = (arr || []).slice(); var i = arr.indexOf(key); if (i >= 0) arr.splice(i, 1); else arr.push(key); return arr; }
  var r;
  if (kind === 'med'){
    var m = (INFORMES_CFG.medicos || []).find(function(x){ return x.id === id; }); if (!m) return;
    r = await req('POST', '/api/informes/medicos/' + encodeURIComponent(id) + '/scope', { modelos: toggle(m.modelos) });
  } else if (kind === 'desc'){
    var d = (INFORMES_CFG.descripciones || []).find(function(x){ return x.id === id; }); if (!d) return;
    r = await req('POST', '/api/informes/descripciones/' + encodeURIComponent(id) + '/scope', { modelos: toggle(d.modelos) });
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
  if (!confirm('¿Eliminar este médico?')) return;
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
  if (!confirm('¿Eliminar esta descripción?')) return;
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
  return { admin:'Administrador', operador:'Operador', medico:'Médico', clinica:'Clínica' }[r] || r;
}
var ROLE = {
  admin:    { chip:'admin', label:'Admin',    bg:'linear-gradient(135deg,#3a3f8f,#5a60c0)' },
  operador: { chip:'oper',  label:'Operador', bg:'linear-gradient(135deg,#18B7B2,#0f7f7c)' },
  medico:   { chip:'med',   label:'Médico',   bg:'linear-gradient(135deg,#3B82C4,#2a5f96)' },
  clinica:  { chip:'clin',  label:'Clínica',  bg:'linear-gradient(135deg,#7a4fd0,#5a37a0)' },
};
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
var USERS = [];
var SVG_EDIT  = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var SVG_KEY   = '<svg viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M10.85 12.15L20 3M17 6l2.5 2.5M14 9l2.5 2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var SVG_POWER = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v9M6.4 6.4a8 8 0 1011.2 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var SVG_TRASH = '<svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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

// Tile de "Clientes activos" en Inicio.
async function updateDashClientsTile(){
  var el = document.getElementById('dashClientsCount'); if (!el) return;
  if (!CLIENTS || !CLIENTS.length){ var res = await api('/api/clientes'); if (res.ok) CLIENTS = res.data.clients || []; }
  el.textContent = (CLIENTS || []).length;
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
var CLIENT_NOM_OPEN = false;
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
function moneyFmt(n){
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
function renderClientNomencladorPanel(){
  var box = document.getElementById('clientNomencladorBox');
  var btn = document.getElementById('clientNomToggleBtn');
  if (box) box.classList.toggle('collapsed', !CLIENT_NOM_OPEN);
  if (btn) {
    btn.textContent = CLIENT_NOM_OPEN ? 'Ocultar' : 'Mostrar';
    btn.setAttribute('aria-expanded', CLIENT_NOM_OPEN ? 'true' : 'false');
  }
}
function toggleClientNomenclador(){
  CLIENT_NOM_OPEN = !CLIENT_NOM_OPEN;
  renderClientNomencladorPanel();
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
  if (c){ var pv = c.value; var centros = uniq((INFORMES_CFG.modelos || []).map(function(m){ return m.centro; }));
    c.innerHTML = centros.map(function(x){ return opt(x, x); }).join(''); if (pv) c.value = pv; }
  loteLlenarMedicos();
}
// Médicos autorizados para alguna práctica del centro elegido (los válidos del lote).
function loteMedicosValidos(){
  var keys;
  if (LOTE_ROWS.length){
    // Con lote detectado: solo las prácticas realmente presentes.
    keys = uniq(LOTE_ROWS.map(function(r){ return r.modelo; }).filter(Boolean));
  } else {
    var centro = (document.getElementById('loteCentro') || {}).value || '';
    keys = (INFORMES_CFG.modelos || []).filter(function(m){ return m.centro === centro; }).map(function(m){ return m.key; });
  }
  return (INFORMES_CFG.medicos || []).filter(function(m){ return keys.some(function(k){ return scopeAplica(m.modelos, k); }); });
}
function loteLlenarMedicos(){
  var med = document.getElementById('loteMedico'); if (!med) return;
  var pm = med.value;
  var vals = loteMedicosValidos();
  med.innerHTML = vals.map(function(m){ return opt(m.id, m.nombre + (m.hasFirma ? '' : ' (sin firma)')); }).join('') + opt('', 'Sin firma / elegir por fila');
  med.value = (pm && vals.some(function(m){ return m.id === pm; })) ? pm : (vals[0] ? vals[0].id : '');
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
function loteModeloPorCodigo(codigo, centro){
  if (!codigo) return '';
  var m = (INFORMES_CFG.modelos || []).find(function(x){ return x.centro === centro && String(x.codigoPractica) === String(codigo); });
  return m ? m.key : '';
}
function loteMedicoParaModelo(modelo, medDef){
  var meds = (INFORMES_CFG.medicos || []).filter(function(m){ return scopeAplica(m.modelos, modelo); });
  if (medDef && meds.some(function(m){ return m.id === medDef; })) return medDef;
  return meds.length ? meds[0].id : '';
}
// Si un paciente tiene 717111 y 717125 el mismo día (Caballito) -> combinado.
function loteCombinar(rows, centro){
  if (centro !== 'Centro Médico Caballito') return rows;
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
      out.push({ nombre: base.nombre, benef: base.benef, fecha: base.fecha, codigo: '717111+717125', practica: 'Cerumen + tratamiento químico', modeloForzado: 'caballito-orl-combinado' });
      return;
    }
    out.push(r);
  });
  return out;
}
function loteDetectar(){
  var err = document.getElementById('loteError'); err.textContent = '';
  var centro = document.getElementById('loteCentro').value;
  var lineas = document.getElementById('loteTexto').value.split(/\r?\n/).filter(function(l){ return l.trim(); });
  if (!lineas.length){ err.textContent = 'Pegá al menos una línea.'; return; }
  var parsed = lineas.map(loteParseLinea).filter(function(r){ return r.nombre || r.benef; });
  parsed = loteCombinar(parsed, centro);
  var medDef = document.getElementById('loteMedico').value;
  LOTE_ROWS = parsed.map(function(r){
    var modelo = r.modeloForzado || loteModeloPorCodigo(r.codigo, centro);
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
  var centro = document.getElementById('loteCentro').value;
  var modelosCentro = (INFORMES_CFG.modelos || []).filter(function(m){ return m.centro === centro; });
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
    paciente: { nombre: row.nombre, benef: row.benef, fecha: row.fecha, documento: row.documento || '' },
    textoInforme: loteTextoDe(row), medicoId: row.medicoId || '', valores: valores };
}
async function loteDescargarFila(i){
  var row = LOTE_ROWS[i];
  if (row && row.modelo && modeloRequiereSexo(row.modelo) && !row.sexo){ alert('Elegí el sexo de ' + (row.nombre || 'este paciente') + ' antes de generar.'); return; }
  var payload = loteItemPayload(row); if (!payload) return;
  var r = await fetch('/api/informes/generar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok){ var d = {}; try { d = await r.json(); } catch (e) {} alert((d && d.error) || 'No se pudo generar.'); return; }
  var blob = await r.blob(); var cd = r.headers.get('content-disposition') || ''; var m = cd.match(/filename="([^"]+)"/);
  bajarBlob(blob, m ? m[1] : 'informe.pdf');
}
async function loteGenerarZip(){
  var err = document.getElementById('loteError'); err.textContent = '';
  // Filas con plantilla que no van a generar por falta del sexo obligatorio.
  var faltanSexo = LOTE_ROWS.filter(function(r){ return r.modelo && modeloRequiereSexo(r.modelo) && !r.sexo; });
  var items = LOTE_ROWS.map(loteItemPayload).filter(Boolean);
  if (!items.length){ err.textContent = faltanSexo.length ? 'Elegí el sexo de los pacientes marcados antes de generar.' : 'No hay pacientes con plantilla para generar.'; return; }
  if (faltanSexo.length && !confirm(faltanSexo.length + ' paciente(s) sin sexo elegido no se van a incluir. ¿Generar el resto igual?')) return;
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
    var SECC_CLINICA = [
      { key: 'mescurso',   label: 'Dashboard' },
      { key: 'dashboard',  label: 'Reportes' },
      { key: 'honorarios', label: 'Honorarios' },
      { key: 'basica',     label: 'Datos del centro' },
    ];
    cons.innerHTML = SECC_CLINICA.map(function(s){
      var active = (ACTIVE_CLIENT && CLIENT_SECTION === s.key) ? ' active' : '';
      return '<button class="client-nav-item' + active + '" type="button" data-cli-section="' + s.key + '">' + s.label + '</button>';
    }).join('');
    if (med) med.innerHTML = '';
    if (medGroup) medGroup.style.display = 'none';
    cons.querySelectorAll('[data-cli-section]').forEach(function(btn){
      btn.addEventListener('click', function(){
        go('clientes'); selectClient(ME.centro); setClientSection(btn.getAttribute('data-cli-section')); renderClientList();
      });
    });
    return;
  }
  var itemHtml = function(client){
    var active = ACTIVE_CLIENT && ACTIVE_CLIENT.slug === client.slug ? ' active' : '';
    return '<button class="client-nav-item' + active + '" type="button" data-client-slug="' + esc(client.slug) + '">' + esc(client.name) + '</button>';
  };
  var consultorios = CLIENTS.filter(function(c){ return c.tipo !== 'med_cabecera'; });
  var medCab = CLIENTS.filter(function(c){ return c.tipo === 'med_cabecera'; });
  cons.innerHTML = consultorios.map(itemHtml).join('');
  if (med) med.innerHTML = medCab.map(itemHtml).join('');
  if (medGroup) medGroup.style.display = medCab.length ? '' : 'none';
  var consHdr = document.querySelector('#navGroupConsultorios .nav-parent span');
  if (consHdr) consHdr.textContent = 'Consultorios';
  var medHdr = document.querySelector('#navGroupMedCab .nav-parent span');
  if (medHdr) medHdr.textContent = 'Med. Cabecera';
  document.querySelectorAll('#clientNavListConsultorios [data-client-slug], #clientNavListMedCab [data-client-slug]').forEach(function(button){
    button.addEventListener('click', function(){
      go('clientes');
      selectClient(button.getAttribute('data-client-slug'));
    });
  });
  var createBtn = document.getElementById('clientNewBtn');
  // Clase (no style inline) para que el modo colapsado pueda ocultarlo.
  if (createBtn) createBtn.classList.toggle('is-admin', !!(ME && ME.role === 'admin'));
}
function selectClient(slug){
  ACTIVE_CLIENT = CLIENTS.filter(function(client){ return client.slug === slug; })[0] || ACTIVE_CLIENT;
  // NO forzamos la solapa: se mantiene la última usada (CLIENT_SECTION). Si venís
  // por un link con solapa, selectClientWhenReady la aplica después.
  CLIENT_NOM_OPEN = false;
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
  { key:'general',   sec:'client-section-general',   tab:'clientTabGeneral',   crumb:'Dashboard general' }
];
// Qué pestañas ve cada tipo de cliente. Los médicos de cabecera por ahora NO
// tienen reportes ni mes en curso: solo Info básica + Dashboard general. Los
// consultorios suman "Usuarios médicos" (solo admin, porque maneja claves).
function clientSeccionesPermitidas(){
  var esClinica = (ME && ME.role === 'clinica');
  var esMC = ACTIVE_CLIENT && ACTIVE_CLIENT.tipo === 'med_cabecera';
  if (esMC) return ['general', 'basica'];
  var base = ['mescurso', 'basica', 'dashboard', 'honorarios'];
  // La clínica NO adjunta reportes (solo lectura). El resto sí.
  if (!esClinica) base.push('reportes');
  // Médicos: por ahora solo admin (no se le muestra al centro).
  if (ME && ME.role === 'admin') base.push('medicos');
  return base;
}
// Muestra/oculta las pestañas según el tipo de cliente.
function aplicarPestanasCliente(){
  var permitidas = clientSeccionesPermitidas();
  CLIENT_SECTIONS.forEach(function(s){
    var tab = document.getElementById(s.tab);
    if (tab) tab.style.display = permitidas.indexOf(s.key) >= 0 ? '' : 'none';
  });
}
function setClientSection(section){
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
  var crumb = document.getElementById('clientCrumbSection');
  if (crumb) crumb.textContent = found.crumb;
  // El hash guarda cliente + sub-solapa, así F5 restaura la solapa exacta.
  if (ACTIVE_CLIENT) pushHash('clientes/' + ACTIVE_CLIENT.slug + '/' + CLIENT_SECTION);
  // La bandeja (puede ser grande) se carga recién al abrir su solapa, no en cada
  // cambio de cliente.
  if (CLIENT_SECTION === 'mescurso') loadClientMesCurso();
  if (CLIENT_SECTION === 'general') renderClientGeneral();
  if (CLIENT_SECTION === 'medicos') loadClientMedicos();
  if (CLIENT_SECTION === 'honorarios') loadClientHonorarios();
}
// El lote de credenciales es exclusivo de Scheffelaar: en el "Dashboard general"
// se muestra solo para ese cliente; el resto ve el placeholder.
function renderClientGeneral(){
  var card = document.getElementById('credLoteCard'), ph = document.getElementById('generalPlaceholder');
  var links = document.getElementById('schefeLinks');
  var slug = ACTIVE_CLIENT ? ACTIVE_CLIENT.slug : '';
  var tieneCred = CRED_CLIENTES.indexOf(slug) >= 0;
  if (card) card.style.display = tieneCred ? '' : 'none';
  if (ph) ph.style.display = tieneCred ? 'none' : '';
  if (links){
    var sid = CRED_PLANILLA[slug];
    if (tieneCred && sid){
      links.style.display = 'flex';
      var a = links.querySelector('a'); if (a) a.href = 'https://docs.google.com/spreadsheets/d/' + sid + '/edit';
    } else { links.style.display = 'none'; }
  }
  if (tieneCred) credSchedCargar();
}
// Acceso PAMI del cliente (card en Informacion basica) — solo admin.
async function loadClientPami(){
  var card = document.getElementById('clientPamiCard');
  if (!card) return;
  if (!ME || ME.role !== 'admin' || !ACTIVE_CLIENT){ card.style.display = 'none'; return; }
  card.style.display = '';
  var user = document.getElementById('clientPamiUser');
  var pass = document.getElementById('clientPamiPass');
  var msg = document.getElementById('clientPamiMsg');
  var revealBtn = document.getElementById('clientPamiRevealBtn');
  user.value = ''; pass.value = ''; pass.type = 'password'; msg.textContent = '';
  document.getElementById('clientPamiPassIco').innerHTML = EYE_ON;
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/pami');
  if (res.ok && res.data){
    user.value = res.data.pamiUser || '';
    pass.placeholder = res.data.hasPassword ? '•••••• guardada — dejar vacío para no cambiarla' : 'Escribí la clave';
    if (revealBtn) revealBtn.style.display = res.data.hasPassword ? '' : 'none';
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
  } catch (e){ alert('No se pudo generar el archivo.'); }
}
var MEDICOS = [];
async function loadClientMedicos(){
  if (!ACTIVE_CLIENT) return;
  var err = document.getElementById('medicosError'); if (err) err.style.display = 'none';
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/medicos');
  MEDICOS = (res.ok && res.data && res.data.medicos) ? res.data.medicos : [];
  renderClientMedicos();
}
var PAMI_BLANQUEO_URL = 'https://efectores.pami.org.ar/pami_efectores/segu_olvido_password.php';
function renderClientMedicos(){
  var body = document.getElementById('medicosBody'); if (!body) return;
  if (!MEDICOS.length){ body.innerHTML = '<tr><td colspan="6" class="muted-cell">Sin médicos cargados.</td></tr>'; return; }
  var ojo = '<svg viewBox="0 0 24 24" fill="none">' + EYE_ON + '</svg>';
  var copiar = '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" stroke-width="1.8"/></svg>';
  var llave = '<svg viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M11 12l9-9M17 3l3 3M15 5l2 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var esAdminMed = ME && ME.role === 'admin';
  body.innerHTML = MEDICOS.map(function(m){
    var claveCell;
    if (m.tieneClave){
      claveCell = '<span id="medClaveTxt_' + m.id + '">•••••• guardada</span>' +
        (esAdminMed ? ' <button class="icon-btn mini" type="button" title="Ver" onclick="revealMedicoClave(\'' + m.id + '\')">' + ojo + '</button>' : '');
    } else {
      claveCell = '<span class="nom-muted">sin clave</span>';
    }
    var usuarioCell = m.usuario
      ? esc(m.usuario) + (esAdminMed ? ' <button class="icon-btn mini" type="button" title="Copiar" onclick="copiarTexto(\'' + esc(m.usuario) + '\', this)">' + copiar + '</button>' : '')
      : '-';
    var acciones = esAdminMed
      ? '<button class="icon-btn mini" type="button" title="Editar" onclick="openMedicoModal(\'' + m.id + '\')"><svg viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button> ' +
          (m.usuario ? '<button class="icon-btn mini" type="button" title="Blanquear" onclick="blanquearMedicoClave(\'' + m.id + '\')">' + llave + '</button> ' : '') +
          '<button class="icon-danger-btn mini" type="button" title="Borrar" onclick="deleteMedico(\'' + m.id + '\')"><svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
      : '<span class="nom-muted">—</span>';
    return '<tr>' +
      '<td>' + esc(m.nombre) + '</td>' +
      '<td>' + (esc(m.especialidad) || '-') + '</td>' +
      '<td>' + usuarioCell + '</td>' +
      '<td>' + claveCell + '</td>' +
      '<td>' + (esc(m.telefono) || '-') + '</td>' +
      '<td class="row-actions">' + acciones + '</td>' +
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
  // Acepta "2.678.400,00" o "2678400.00" o "2678400".
  var s = String(v == null ? '' : v).trim();
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
  var nombre = prompt('Nombre del nuevo período (ej: JULIO, AGOSTO, etc.):');
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
  var nuevo = prompt('Nuevo nombre del período:', viejo);
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
  var actMostrar = q ? activos.filter(function(p){ return p.toLowerCase().indexOf(q) >= 0; }) : activos;
  var archMostrar = q ? arch.filter(function(p){ return p.toLowerCase().indexOf(q) >= 0; }) : [];
  FAC_RENDER = actMostrar.concat(archMostrar);
  var html;
  if (!FAC_RENDER.length){
    html = q ? '<p class="nom-muted">Ningún período coincide con “' + esc(q) + '”.</p>'
             : '<p class="nom-muted">No hay períodos todavía. Creá uno con “+ Período”.</p>';
  } else {
    html = FAC_RENDER.map(function(_, i){ return facturaPeriodoSection(i); }).join('');
  }
  if (!q && arch.length) html += '<div class="fac-archivados-info">📦 ' + arch.length + ' período(s) archivado(s). Buscalos por nombre arriba.</div>';
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
      (c.pamiUser ? '<span class="fac-up">' + esc(c.pamiUser) + '</span>' + (c.tieneClave ? '<button class="icon-btn mini" type="button" title="Copiar clave PAMI" onclick="event.stopPropagation();copiarClavePami(\'' + c.slug + '\',this)"><svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" stroke-width="1.8"/></svg></button>' : '') : '') +
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
  if (!confirm('¿Borrar el período “' + periodo + '” y todas sus facturas?')) return;
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
    items.push({ label: row.querySelector('.fac-desc').value.trim(), monto: facturaParseMonto(row.querySelector('.fac-monto').value) });
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
  if (!confirm('¿Borrar este gasto fijo?')) return;
  var res = await req('DELETE', '/api/gastos/' + encodeURIComponent(id));
  if (res.ok){ GASTOS.gastos = res.data.gastos || []; renderGastos(); }
}
async function toggleGastoPagado(id, pagado){
  var res = await req('POST', '/api/gastos/pagado', { periodo: gastosPeriodoActual(), gastoId: id, pagado: pagado });
  if (res.ok){ GASTOS.pagos = res.data.pagos || {}; renderGastos(); }
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
  var bols = document.getElementById('resBolsillo');
  bols.textContent = moneyFmt(d.bolsilloNS);
  bols.classList.toggle('neg', d.bolsilloNS < 0);
  document.getElementById('resIngreso').textContent = moneyFmt(d.ingresoNS);
  document.getElementById('resGastos').textContent = moneyFmt(d.gastos);
  document.getElementById('resNacho').textContent = moneyFmt(d.bolsilloNacho);
  document.getElementById('resSeba').textContent = moneyFmt(d.bolsilloSeba);
  // Desglose: cada factura con su comisión NS + check de cobrado (vencido si la
  // fecha de cobro ya pasó y no está marcada).
  var box = document.getElementById('resDesglose');
  if (box){
    var hoy = new Date(); hoy = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0') + '-' + String(hoy.getDate()).padStart(2, '0');
    var filas = (d.detalle || []).map(function(x){
      var vencido = !x.cobrado && x.fechaCobro && x.fechaCobro < hoy;
      var cls = 'mescurso-line res-cobro-line' + (x.cobrado ? ' cobrado' : (vencido ? ' vencido' : ''));
      var fecha = x.fechaCobro ? x.fechaCobro.split('-').reverse().slice(0, 2).join('/') : '';
      var nota = fecha ? '<span class="res-fecha">' + (x.cobrado ? '✓ cobrado' : (vencido ? '⚠ cobro vencido ' + fecha : 'cobra ' + fecha)) + '</span>' : '';
      return '<div class="' + cls + '">' +
        '<span class="res-cobro-nombre"><input type="checkbox" class="res-check" ' + (x.cobrado ? 'checked' : '') + ' onchange="toggleResCobrado(\'' + x.id + '\', this.checked)" title="Marcar cobrado">' +
        esc(x.name) + ' ' + nota + '</span>' +
        '<b>' + moneyFmt(x.monto) + '</b>' +
      '</div>';
    }).join('') || '<div class="mescurso-line"><span class="nom-muted">Sin facturas con cobro en el mes</span><b></b></div>';
    filas += '<div class="mescurso-line alert"><span>Gastos fijos</span><b>− ' + moneyFmt(d.gastos) + '</b></div>';
    box.innerHTML = filas;
  }
  document.getElementById('resDetalle').textContent = d.facturasContadas + ' factura(s) con cobro en el mes · dólar oficial ' + (d.dolar && d.dolar.valor ? moneyFmt(d.dolar.valor) : '—');
  renderResChart(d.serie || [], d.mes);
}
async function toggleResCobrado(id, cobrado){
  var res = await req('POST', '/api/facturas/cobrado', { id: id, cobrado: cobrado });
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
  if (!confirm('¿Borrar a ' + ((m && m.nombre) || 'este médico') + '?')) return;
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
var MESCURSO_POSIBLES_DEBITOS_ADELANTE = []; // posibles débitos de turnos futuros (hacia adelante)
var MESCURSO_AUSENTES = [];          // detalle de ausentes (con turno pero sin validar)
var MESCURSO_PANEL_ABIERTO = '';    // '' | 'informes' | 'debitos' | 'informes-julio' | 'debitos-julio' | 'debitos-adelante' | 'ausentes'
function mesCursoSetCaret(id, abierto){ var c = document.getElementById(id); if (c) c.textContent = abierto ? '▾' : '▸'; }
function toggleFaltanInformes(){ mesCursoTogglePanel('informes'); }
function togglePosiblesDebitos(){ mesCursoTogglePanel('debitos'); }
function toggleAusentes(){ mesCursoTogglePanel('ausentes'); }
function toggleFaltanInformesJulio(){ mesCursoTogglePanel('informes-julio'); }
function toggleDebitosJulio(){ mesCursoTogglePanel('debitos-julio'); }
function toggleDebitosAdelante(){ mesCursoTogglePanel('debitos-adelante'); }
// Abre/cierra debajo de los cuadros el detalle copiable.
function mesCursoTogglePanel(tipo){
  var panel = document.getElementById('mescursoInformesPanel');
  if (!panel) return;
  var apagarCarets = function(){
    ['mescursoInformesCaret','mescursoDebitosCaret','mescursoInformesJulioCaret','mescursoDebitosJulioCaret','mescursoDebitosAdelanteCaret','mescursoAusentesCaret']
      .forEach(function(id){ mesCursoSetCaret(id, false); });
  };
  if (MESCURSO_PANEL_ABIERTO === tipo){
    panel.innerHTML = ''; MESCURSO_PANEL_ABIERTO = ''; apagarCarets();
    return;
  }
  var html = '';
  var cols = ['Benef', 'Apellido y nombre', 'Práctica', 'Turno', 'Valor'];
  var mapInformes = function(x){ return [x.benef, x.nombre, x.practica, x.turno, moneyFmt(x.valor || 0)]; };
  var debCols = ['Benef', 'Apellido y nombre', 'Turno', 'Práctica que se debita', 'Estado', 'Se cruza con', 'Débito'];
  var mapDebitos = function(x){ return [x.benef, x.nombre, x.turno, x.practica, x.estado, x.cruce, moneyFmt(x.monto)]; };
  if (tipo === 'informes'){
    var fi = MESCURSO_FALTAN_INFORMES || [];
    if (!fi.length) return;
    html = mesCursoTablaHtml('Faltan informes · ' + fi.length, 'error', 'copiarFaltanInformes', cols, fi.map(mapInformes), 'informes');
  } else if (tipo === 'informes-julio'){
    var fj = MESCURSO_FALTAN_INFORMES_JULIO || [];
    if (!fj.length) return;
    html = mesCursoTablaHtml('Faltan informes (mes anterior) · ' + fj.length, 'error', 'copiarFaltanInformesJulio', cols, fj.map(mapInformes), 'informes-julio');
  } else if (tipo === 'debitos-julio'){
    var dj = MESCURSO_POSIBLES_DEBITOS_JULIO || [];
    if (!dj.length) return;
    html = mesCursoTablaHtml('Posibles débitos (mes anterior) · ' + dj.length, 'warn', 'copiarPosiblesDebitosJulio', debCols, dj.map(mapDebitos), 'debitos-julio');
  } else if (tipo === 'debitos-adelante'){
    var da = MESCURSO_POSIBLES_DEBITOS_ADELANTE || [];
    if (!da.length) return;
    html = mesCursoTablaHtml('Posibles débitos por adelantado · ' + da.length, 'warn', 'copiarPosiblesDebitosAdelante', debCols, da.map(mapDebitos), 'debitos-adelante');
  } else if (tipo === 'ausentes'){
    var au = MESCURSO_AUSENTES || [];
    if (!au.length) return;
    html = mesCursoTablaHtml('Ausentes · ' + au.length, 'warn', 'copiarAusentes', cols, au.map(mapInformes), 'ausentes');
  } else {
    var pd = MESCURSO_POSIBLES_DEBITOS || [];
    if (!pd.length) return;
    html = mesCursoTablaHtml('Posibles débitos · ' + pd.length, 'warn', 'copiarPosiblesDebitos', debCols, pd.map(mapDebitos), 'debitos');
  }
  panel.innerHTML = html;
  MESCURSO_PANEL_ABIERTO = tipo;
  apagarCarets();
  mesCursoSetCaret('mescursoInformesCaret', tipo === 'informes');
  mesCursoSetCaret('mescursoDebitosCaret', tipo === 'debitos');
  mesCursoSetCaret('mescursoInformesJulioCaret', tipo === 'informes-julio');
  mesCursoSetCaret('mescursoDebitosJulioCaret', tipo === 'debitos-julio');
  mesCursoSetCaret('mescursoDebitosAdelanteCaret', tipo === 'debitos-adelante');
  mesCursoSetCaret('mescursoAusentesCaret', tipo === 'ausentes');
}
function mesCursoTablaHtml(titulo, tono, copiaFn, headers, filas, panelId){
  // Columnas que absorben el ancho sobrante (las de texto largo): así la tabla
  // llena el panel sin dejar un bloque vacío a la derecha ni abrir huecos entre
  // las columnas cortas. El resto se ajusta al contenido.
  var expand = /informes|ausentes/.test(String(panelId || '')) ? [1, 2] : [1, 3, 5];
  var clase = function(i){ return expand.indexOf(i) >= 0 ? ' class="mc-exp"' : ''; };
  var thead = '<tr>' + headers.map(function(h, i){ return '<th' + clase(i) + '>' + esc(h) + '</th>'; }).join('') + '</tr>';
  var tbody = filas.map(function(f){
    return '<tr>' + f.map(function(c, i){ return '<td' + clase(i) + '>' + esc(String(c == null ? '' : c)) + '</td>'; }).join('') + '</tr>';
  }).join('');
  var acciones = '<button class="btn btn-ghost" type="button" title="Copiar" onclick="' + copiaFn + '(this)">📋</button>';
  if (panelId){
    acciones += '<button class="btn btn-ghost" type="button" title="Descargar PDF" onclick="mesCursoDescargar(\'pdf\',\'' + panelId + '\',this)">📄 PDF</button>'
      + '<button class="btn btn-ghost" type="button" title="Descargar Excel" onclick="mesCursoDescargar(\'xlsx\',\'' + panelId + '\',this)">📊 Excel</button>';
  }
  return '<div class="mescurso-panel ' + esc(tono) + '">'
    + '<div class="mescurso-panel-head"><b>' + esc(titulo) + '</b>'
    + '<div class="mescurso-panel-actions">' + acciones + '</div></div>'
    + '<div class="table-scroll"><table class="bandeja-table"><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table></div>'
    + '</div>';
}
// Datos crudos (encabezados en mayúscula + valores numéricos de $) para exportar
// un panel. Reusa los mismos globales que "copiar".
function mesCursoDescargarDatos(panelId){
  var infoCols = ['BENEF', 'APELLIDO Y NOMBRE', 'PRACTICA', 'TURNO', 'VALOR'];
  var debCols = ['BENEF', 'APELLIDO Y NOMBRE', 'TURNO', 'PRACTICA QUE SE DEBITA', 'ESTADO', 'SE CRUZA CON', 'DEBITO'];
  var mapInfo = function(x){ return [x.benef, x.nombre, x.practica, x.turno, Number(x.valor) || 0]; };
  var mapDeb = function(x){ return [x.benef, x.nombre, x.turno, x.practica, x.estado, x.cruce, Number(x.monto) || 0]; };
  var cli = (ACTIVE_CLIENT && ACTIVE_CLIENT.name) || '';
  if (panelId === 'ausentes') return { titulo: 'Ausentes - ' + cli, columnas: infoCols, filas: (MESCURSO_AUSENTES || []).map(mapInfo), moneyCols: [4] };
  if (panelId === 'informes') return { titulo: 'Faltan informes - ' + cli, columnas: infoCols, filas: (MESCURSO_FALTAN_INFORMES || []).map(mapInfo), moneyCols: [4] };
  if (panelId === 'informes-julio') return { titulo: 'Faltan informes (mes anterior) - ' + cli, columnas: infoCols, filas: (MESCURSO_FALTAN_INFORMES_JULIO || []).map(mapInfo), moneyCols: [4] };
  if (panelId === 'debitos-julio') return { titulo: 'Posibles débitos (mes anterior) - ' + cli, columnas: debCols, filas: (MESCURSO_POSIBLES_DEBITOS_JULIO || []).map(mapDeb), moneyCols: [6] };
  if (panelId === 'debitos-adelante') return { titulo: 'Posibles débitos por adelantado - ' + cli, columnas: debCols, filas: (MESCURSO_POSIBLES_DEBITOS_ADELANTE || []).map(mapDeb), moneyCols: [6] };
  return { titulo: 'Posibles débitos - ' + cli, columnas: debCols, filas: (MESCURSO_POSIBLES_DEBITOS || []).map(mapDeb), moneyCols: [6] };
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
    alert('No se pudo generar el archivo.');
  } finally {
    if (btn){ btn.disabled = false; btn.textContent = prev; }
  }
}
// Copian el listado (con encabezado) separado por tabs, para pegar en Excel.
function copiarFaltanInformes(btn){
  mesCursoCopiar(btn, ['BENEF', 'APELLIDO Y NOMBRE', 'PRACTICA', 'TURNO', 'VALOR'],
    (MESCURSO_FALTAN_INFORMES || []).map(function(x){ return [x.benef, x.nombre, x.practica, x.turno, x.valor]; }));
}
function copiarAusentes(btn){
  mesCursoCopiar(btn, ['BENEF', 'APELLIDO Y NOMBRE', 'PRACTICA', 'TURNO', 'VALOR'],
    (MESCURSO_AUSENTES || []).map(function(x){ return [x.benef, x.nombre, x.practica, x.turno, x.valor]; }));
}
function copiarFaltanInformesJulio(btn){
  mesCursoCopiar(btn, ['BENEF', 'APELLIDO Y NOMBRE', 'PRACTICA', 'TURNO', 'VALOR'],
    (MESCURSO_FALTAN_INFORMES_JULIO || []).map(function(x){ return [x.benef, x.nombre, x.practica, x.turno, x.valor]; }));
}
function copiarPosiblesDebitos(btn){
  mesCursoCopiar(btn, ['BENEF', 'APELLIDO Y NOMBRE', 'TURNO', 'PRACTICA QUE SE DEBITA', 'ESTADO', 'SE CRUZA CON', 'DEBITO'],
    (MESCURSO_POSIBLES_DEBITOS || []).map(function(x){ return [x.benef, x.nombre, x.turno, x.practica, x.estado, x.cruce, x.monto]; }));
}
function copiarPosiblesDebitosJulio(btn){
  mesCursoCopiar(btn, ['BENEF', 'APELLIDO Y NOMBRE', 'TURNO', 'PRACTICA QUE SE DEBITA', 'ESTADO', 'SE CRUZA CON', 'DEBITO'],
    (MESCURSO_POSIBLES_DEBITOS_JULIO || []).map(function(x){ return [x.benef, x.nombre, x.turno, x.practica, x.estado, x.cruce, x.monto]; }));
}
function copiarPosiblesDebitosAdelante(btn){
  mesCursoCopiar(btn, ['BENEF', 'APELLIDO Y NOMBRE', 'TURNO', 'PRACTICA QUE SE DEBITA', 'ESTADO', 'SE CRUZA CON', 'DEBITO'],
    (MESCURSO_POSIBLES_DEBITOS_ADELANTE || []).map(function(x){ return [x.benef, x.nombre, x.turno, x.practica, x.estado, x.cruce, x.monto]; }));
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
var REFRESCO_POLL = null;
async function pedirRefrescoBandejas(btn){
  if (btn){ btn.disabled = true; btn.textContent = '⏳ Pidiendo…'; }
  var r = await req('POST', '/api/bandeja/refresco/pedir', {});
  if (!r.ok){ if (btn){ btn.disabled = false; btn.textContent = '🔄 Actualizar'; } alert((r.data && r.data.error) || 'No se pudo pedir el refresco.'); return; }
  var desde = (r.data && r.data.pedidoAt) || new Date().toISOString();
  if (btn){ btn.textContent = '🔄 Pedido — corre en la PC…'; btn.title = 'La PC lo corre en los próximos minutos'; }
  // Sondea el estado: cuando la PC termina (terminadoAt >= el pedido), recarga.
  if (REFRESCO_POLL) clearInterval(REFRESCO_POLL);
  var vueltas = 0;
  REFRESCO_POLL = setInterval(async function(){
    vueltas++;
    var e = await req('GET', '/api/bandeja/refresco/estado');
    if (e.ok && e.data){
      if (e.data.corriendo && btn) btn.textContent = '🔄 Actualizando…';
      var termino = e.data.terminadoAt && e.data.terminadoAt >= desde && !e.data.corriendo;
      if (termino){
        clearInterval(REFRESCO_POLL); REFRESCO_POLL = null;
        if (btn){ btn.disabled = false; btn.textContent = '✅ Actualizado'; }
        try { loadClientMesCurso(); } catch(_){}
        return;
      }
    }
    if (vueltas > 60){ clearInterval(REFRESCO_POLL); REFRESCO_POLL = null; if (btn){ btn.disabled = false; btn.textContent = '🔄 Actualizar'; } }
  }, 15000);
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
function mesCursoLabelPeriodo(period){
  var mm = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!mm) return String(period || '');
  var nombre = MESCURSO_MESES[(+mm[2]) - 1] || '';
  return nombre.replace(/^./, function(c){ return c.toUpperCase(); }) + ' ' + mm[1];
}
// Card izquierda: resumen valorizado de la bandeja del mes en curso (tipo Julio).
function mesCursoCardMesEnCurso(r, estado){
  var chip = (r && r.label) || mesCursoMesActualLabel();
  // Rango de días que abarca la bandeja (ej. "01/08 al 18/08"), por las dudas.
  var abarca = (r && r.coversFrom && r.coversTo) ? (r.coversFrom + ' al ' + r.coversTo) : '';
  var puedeRefrescar = ME && (ME.role === 'admin' || ME.role === 'operador');
  var head = '<div class="mescurso-head"><span class="mescurso-title">Mes en curso'
    + (abarca ? ' <span class="mescurso-abarca">' + esc(abarca) + '</span>' : '') + '</span>'
    + '<span class="mescurso-chip">' + esc(chip) + '</span>'
    + (puedeRefrescar ? '<button class="btn btn-sm" type="button" id="btnRefrescoBandejas" onclick="pedirRefrescoBandejas(this)" title="Actualizar" style="margin-left:8px">🔄 Actualizar</button>' : '')
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
  // Las líneas de "Faltan informes" y "Posibles débitos" son clickeables (abren
  // el detalle copiable debajo) cuando hay filas.
  var faltanClick = (r.missingInforme > 0) ? ' mescurso-click" onclick="toggleFaltanInformes()' : '';
  var faltanCaret = (r.missingInforme > 0) ? ' <span class="mescurso-caret" id="mescursoInformesCaret">▸</span>' : '';
  var debitosClick = (r.posiblesDebitosCount > 0) ? ' mescurso-click" onclick="togglePosiblesDebitos()' : '';
  var debitosCaret = (r.posiblesDebitosCount > 0) ? ' <span class="mescurso-caret" id="mescursoDebitosCaret">▸</span>' : '';
  var cobroReal = r.grossTransmitido || 0;
  var faltaInf = r.missingInformeAmount || 0;
  var estimado = cobroReal + faltaInf;
  // Cobro real en $0 habiendo prestaciones = casi siempre un error (la
  // actualización no captó las transmitidas, o falló). Lo marcamos en rojo.
  var cobroCeroWarn = (cobroReal === 0 && (r.count || 0) > 0)
    ? '<div class="mescurso-salud err">⚠ Cobro real en $0 con ' + esc(numberFmt(r.count || 0)) + ' prestaciones — probable error de la transmisión o la actualización. Revisá.</div>'
    : '';
  var ausTot = r.absent || 0;
  var tieneAusRows = (r.ausentesRows && r.ausentesRows.length) || ausTot > 0;
  var ausentesClick = tieneAusRows ? ' mescurso-click" onclick="toggleAusentes()' : '';
  var ausentesCaret = tieneAusRows ? ' <span class="mescurso-caret" id="mescursoAusentesCaret">▸</span>' : '';
  var ausentesHtml = (ausTot > 0)
    ? '<div class="mescurso-ausentes' + ausentesClick + '"><span>Ausentes' + ausentesCaret + ' <b>' + esc(numberFmt(ausTot)) + '</b> · ' + esc(numberFmt(r.ausentesConsultas || 0)) + ' consultas · ' + esc(numberFmt(r.ausentesPracticas || 0)) + ' prácticas</span><b>' + (r.grossTurno ? esc(moneyFmt(r.grossTurno)) : '') + '</b></div>'
    : '';
  return '<div class="mescurso-card">' + head + salud + cobroCeroWarn
    + '<div class="mescurso-val-lbl">Cobro real (transmitido)</div>'
    + '<div class="mescurso-val">' + esc(moneyFmt(cobroReal)) + '</div>'
    + '<div class="mescurso-val-note">+ Falta informe <b>' + esc(moneyFmt(faltaInf)) + '</b> → Estimado <b>' + esc(moneyFmt(estimado)) + '</b> · ' + esc(nomNota) + '</div>'
    + '<div class="mescurso-lines">'
    + '<div class="mescurso-line"><span>Consultas · prácticas</span><b>' + esc(numberFmt(r.consultations || 0)) + ' · ' + esc(numberFmt(r.practices || 0)) + '</b></div>'
    + '<div class="mescurso-line"><span>Validadas · transmitidas</span><b>' + esc(numberFmt(r.validated || 0)) + ' · ' + esc(numberFmt(r.transmitted || 0)) + '</b></div>'
    + '<div class="mescurso-line warn' + debitosClick + '"><span>Posibles débitos' + debitosCaret + '</span><b>' + esc(numberFmt(r.posiblesDebitosCount || 0)) + (r.posiblesDebitos ? ' · ' + esc(moneyFmt(r.posiblesDebitos)) : '') + '</b></div>'
    + '<div class="mescurso-line alert' + faltanClick + '"><span>Faltan informes' + faltanCaret + '</span><b>' + esc(numberFmt(r.missingInforme || 0)) + (r.missingInformeAmount ? ' · ' + esc(moneyFmt(r.missingInformeAmount)) : '') + '</b></div>'
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
  return '<div class="mescurso-futuro" style="border-top:1px dashed var(--border,#d8dee6);margin-top:14px;padding-top:12px">'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">'
    + '<b>' + esc(f.label || f.period || '') + '</b>'
    + (abarca ? '<span class="mescurso-abarca">' + esc(abarca) + '</span>' : '') + '</div>'
    + '<div class="mescurso-val-note" style="margin:0 0 8px">' + esc(numberFmt(f.count || 0)) + ' turnos · '
    + esc(numberFmt(f.consultations || 0)) + ' consultas · ' + esc(numberFmt(f.practices || 0)) + ' prácticas</div>'
    + (deb > 0
        ? '<div class="mescurso-line warn"><span>Posibles débitos por adelantado</span><b>' + esc(numberFmt(deb)) + (f.posiblesDebitos ? ' · ' + esc(moneyFmt(f.posiblesDebitos)) : '') + '</b></div>'
        : '<div class="mescurso-val-note" style="margin:0">Sin posibles débitos detectados</div>')
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
    var djClick = (debCount > 0) ? ' mescurso-click" onclick="toggleDebitosAdelante()' : '';
    var djCaret = (debCount > 0) ? ' <span class="mescurso-caret" id="mescursoDebitosAdelanteCaret">▸</span>' : '';
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
  // "Faltan informes" y "Posibles débitos" abren el detalle inline abajo (no navegan).
  var fjClick = (faltan > 0) ? ' mescurso-click" onclick="toggleFaltanInformesJulio()' : '';
  var fjCaret = (faltan > 0) ? ' <span class="mescurso-caret" id="mescursoInformesJulioCaret">▸</span>' : '';
  var djClick = (debCount > 0) ? ' mescurso-click" onclick="toggleDebitosJulio()' : '';
  var djCaret = (debCount > 0) ? ' <span class="mescurso-caret" id="mescursoDebitosJulioCaret">▸</span>' : '';
  var footParts = [];
  if (fechaRep) footParts.push('Reporte del ' + esc(fechaRep));
  if (cierre) footParts.push('los débitos cierran el ' + esc(cierre));
  var foot = footParts.length ? '<div class="mescurso-foot">' + footParts.join(' · ') + '</div>' : '';
  return '<div class="mescurso-card sincerrar">'
    + '<div class="mescurso-head"><span class="mescurso-title">Sin cerrar</span>'
    + '<span class="mescurso-chip warn">' + esc(current.label || '') + '</span></div>'
    + '<div class="mescurso-val-lbl">Facturación</div>'
    + '<div class="mescurso-val">' + esc(moneyFmt(current.net || 0)) + '</div>'
    + '<div class="mescurso-val-note">Valor aproximado · factura sin cerrar (falta informe no suma acá)'
    + (debMonto ? ' · ya con <b>' + esc(moneyFmt(debMonto)) + '</b> de posibles débitos descontados' : '') + '</div>'
    + '<div class="mescurso-lines">'
    + '<div class="mescurso-line"><span>Consultas · prácticas</span><b>' + esc(numberFmt(current.consultations || 0)) + ' · ' + esc(numberFmt(current.practices || 0)) + '</b></div>'
    + '<div class="mescurso-line warn' + djClick + '"><span>Posibles débitos' + djCaret + '</span><b>' + esc(numberFmt(debCount)) + (debMonto ? ' · ' + esc(moneyFmt(debMonto)) : '') + '</b></div>'
    + '<div class="mescurso-line alert' + fjClick + '"><span>Faltan informes' + fjCaret + '</span>'
    + '<b>' + esc(numberFmt(faltan)) + (faltanMonto ? ' · ' + esc(moneyFmt(faltanMonto)) : '') + '</b></div>'
    + '<div class="mescurso-line' + clickable + '"' + onclick + '><span>Ausentes sin activar</span>'
    + '<b>' + esc(numberFmt(ausentes)) + (ausMonto ? ' · ' + esc(moneyFmt(ausMonto)) : '') + '</b></div>'
    + (fueraCorte > 0 ? '<div class="mescurso-line"><span>A facturar fuera de corte</span><b>' + esc(numberFmt(fueraCorte)) + ' · ' + esc(moneyFmt(fueraCorteMonto)) + '</b></div>' : '')
    + '</div>' + foot + '</div>';
}
function irAReporteSinCerrar(){
  if (!MESCURSO_REPORTE_ID) return;
  setClientSection('reportes');
  var id = MESCURSO_REPORTE_ID;
  setTimeout(function(){ openClientReport(id); }, 30);
}
async function loadClientMesCurso(){
  var box = document.getElementById('clientMesCurso');
  if (!box || !ACTIVE_CLIENT) return;
  var slug = ACTIVE_CLIENT.slug;
  // El mes anterior es SIEMPRE el calendario anterior a hoy (Agosto -> Julio), no
  // "el último reporte que exista". Si no hay reporte de ese mes, se muestra el
  // cartel de "falta reporte" (no se cae a un mes más viejo).
  var prev = mesCursoPeriodoAnterior();
  var results = await Promise.all([
    api('/api/clientes/' + encodeURIComponent(slug) + '/bandeja/resumen'),
    api('/api/clientes/' + encodeURIComponent(slug) + '/dashboard?period=' + encodeURIComponent(prev)),
    api('/api/clientes/' + encodeURIComponent(slug) + '/reportes'),
  ]);
  if (!ACTIVE_CLIENT || ACTIVE_CLIENT.slug !== slug) return; // cambió de cliente mientras cargaba
  var resumen = (results[0].ok && results[0].data) ? results[0].data.resumen : null;
  var estadoSync = (results[0].ok && results[0].data) ? results[0].data.estado : null;
  var adelante = (results[0].ok && results[0].data) ? results[0].data.adelante : null;
  var futuros = (results[0].ok && results[0].data) ? (results[0].data.futuros || []) : [];
  MESCURSO_FALTAN_INFORMES = (resumen && resumen.missingInformeRows) || [];
  MESCURSO_AUSENTES = (resumen && resumen.ausentesRows) || [];
  MESCURSO_POSIBLES_DEBITOS = (resumen && resumen.posiblesDebitosRows) || [];
  MESCURSO_POSIBLES_DEBITOS_ADELANTE = (adelante && adelante.posiblesDebitosRows) || [];
  MESCURSO_PANEL_ABIERTO = '';
  var dash = (results[1].ok && results[1].data) ? results[1].data : null;
  var current = dash && dash.current ? dash.current : null;
  MESCURSO_FALTAN_INFORMES_JULIO = (current && current.missingInformeRows) || [];
  MESCURSO_POSIBLES_DEBITOS_JULIO = (current && current.posiblesDebitosRows) || [];
  var reportes = (results[2].ok && results[2].data) ? (results[2].data.reports || []) : [];
  // ¿Hay reporte del mes anterior? (current viene vacío si no hay nada de ese mes).
  var hayAnterior = current && current.period === prev && ((current.reportCount || 0) > 0 || (current.totalRows || 0) > 0);
  var pendiente = hayAnterior ? (reportes.filter(function(r){ return r.dashboardPeriod === prev; })[0] || null) : null;
  MESCURSO_REPORTE_ID = pendiente ? pendiente.id : null;

  var cardDer = hayAnterior ? mesCursoCardSinCerrar(current, pendiente) : mesCursoCardFaltaReporte(prev);
  var cardAdel = mesCursoCardAdelante(adelante, futuros);
  box.innerHTML = '<div class="mescurso-cards' + (cardAdel ? ' tres' : '') + '">' + (cardAdel || '') + mesCursoCardMesEnCurso(resumen, estadoSync) + cardDer + '</div>'
    + '<div id="mescursoInformesPanel"></div>';
}
async function renderActiveClient(){
  var client = ACTIVE_CLIENT;
  if (!client) return;
  document.getElementById('clientCrumbName').textContent = client.name;
  document.getElementById('clientName').textContent = client.name;
  aplicarPestanasCliente();
  setClientSection(CLIENT_SECTION);
  renderClientNomencladorPanel();
  loadClientPami();
  document.getElementById('clientBusinessName').textContent = client.businessName;
  document.getElementById('clientCuit').textContent = client.cuit;
  document.getElementById('clientUgl').textContent = client.ugl || '-';
  document.getElementById('clientSap').textContent = client.sap || '-';
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
async function exportClientNomenclador(format){
  if (!ACTIVE_CLIENT) return;
  var period = document.getElementById('clientNomPeriod').value || NOM_ACTIVE_PERIOD || '';
  if (!period){ alert('Primero elegí un nomenclador (período) para este cliente.'); return; }
  var q = document.getElementById('clientNomQ').value.trim();
  var params = new URLSearchParams({ period: period, q: q, format: format });
  var btn = document.getElementById(format === 'pdf' ? 'clientNomPdfBtn' : 'clientNomXlsxBtn');
  if (btn) btn.disabled = true;
  try {
    var r = await fetch('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/nomenclador/export?' + params.toString());
    if (!r.ok){ var d = {}; try { d = await r.json(); } catch (e) {} alert((d && d.error) || 'No se pudo generar el archivo.'); return; }
    var blob = await r.blob();
    var cd = r.headers.get('content-disposition') || '';
    var m = cd.match(/filename="([^"]+)"/);
    bajarBlob(blob, m ? m[1] : ('nomenclador.' + (format === 'pdf' ? 'pdf' : 'xlsx')));
  } catch (e){ alert('No se pudo generar el archivo.'); }
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
  showModal('clientEditModal', 'ceScrim');
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
    tipo: (document.getElementById('clientEditTipo') || {}).value || 'consultorio'
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
function openReportPdfModal(id){ REPORT_PDF_ID = id; showModal('reportPdfModal', 'reportPdfScrim'); }
function closeReportPdfModal(){ hideModal('reportPdfModal', 'reportPdfScrim'); }
function reportPdfChoose(kind){
  var id = REPORT_PDF_ID; if (!id) return;
  closeReportPdfModal();
  if (kind === 'general') downloadGeneralReportPdf(id);
  else if (kind === '543' || kind === '546') downloadProfessionalReport(id, kind);
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
  if (!period || !compare){ alert('Elegí un mes y un mes para comparar antes de descargar.'); return; }
  var params = new URLSearchParams({ period: period, compare: compare, format: format });
  try {
    var r = await fetch('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/dashboard/comparativa/export?' + params.toString());
    if (!r.ok){ var d = {}; try { d = await r.json(); } catch (e) {} alert((d && d.error) || 'No se pudo generar el archivo.'); return; }
    var blob = await r.blob();
    var cd = r.headers.get('content-disposition') || '';
    var m = cd.match(/filename="([^"]+)"/);
    bajarBlob(blob, m ? m[1] : ('comparativa.' + (format === 'pdf' ? 'pdf' : 'xlsx')));
  } catch (e){ alert('No se pudo generar el archivo.'); }
}
// Resumen ejecutivo en texto: qué facturó y por qué cambió (arriba de todo).
function renderDashResumen(current, compare, deltas){
  var box = document.getElementById('clientDashboardResumen');
  if (!box) return;
  if (!current.period){ box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  var curL = current.label || current.period;
  var totalPrest = (current.consultations || 0) + (current.practices || 0);
  if (!compare.period){
    box.innerHTML = '<b>' + esc(curL) + '</b> facturó <b>' + esc(moneyFmt(current.net || 0)) + '</b> en '
      + esc(numberFmt(totalPrest)) + ' prestaciones (' + esc(numberFmt(current.consultations || 0)) + ' consultas · '
      + esc(numberFmt(current.practices || 0)) + ' prácticas). Promedio por prestación ' + esc(moneyFmt(current.averageNet || 0)) + '. '
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
  var dc = Number((deltas.consultations || {}).value || 0);
  var dp = Number((deltas.practices || {}).value || 0);
  var drv = [];
  if (dc) drv.push((dc > 0 ? '+' : '−') + numberFmt(Math.abs(dc)) + ' consultas');
  if (dp) drv.push((dp > 0 ? '+' : '−') + numberFmt(Math.abs(dp)) + ' prácticas');
  var drvPhrase = drv.length ? ' Movimiento de volumen: ' + esc(drv.join(' · ')) + '.' : '';
  var avgPhrase = ' Promedio por prestación ' + esc(moneyFmt(current.averageNet || 0))
    + (compare.averageNet ? ' (antes ' + esc(moneyFmt(compare.averageNet)) + ').' : '.');
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
    kpis.innerHTML = ''
      + '<div><b>' + esc(moneyFmt(current.net || 0)) + '</b><span>Facturación neta</span>' + kprev(moneyFmt(compare.net || 0)) + dashboardDelta(deltas.net, true) + '</div>'
      + '<div><b>' + esc(numberFmt(current.consultations || 0)) + '</b><span>Consultas</span><small>' + esc(moneyFmt(current.consultationNet || 0)) + '</small>' + kprev(numberFmt(compare.consultations || 0)) + dashboardDelta(deltas.consultations, false) + '</div>'
      + '<div><b>' + esc(numberFmt(current.practices || 0)) + '</b><span>Prácticas / estudios</span><small>' + esc(moneyFmt(current.practiceNet || 0)) + '</small>' + kprev(numberFmt(compare.practices || 0)) + dashboardDelta(deltas.practices, false) + '</div>'
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
      trend.innerHTML = '<div class="dashboard-trend-title">Facturación neta — evolución</div>'
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
    var totalNet = modules.reduce(function(s, m){ return s + Math.abs(Number(m.net || 0)); }, 0);
    var maxNet = modules.reduce(function(mx, m){ return Math.max(mx, Math.abs(Number(m.net || 0))); }, 0) || 1;
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
      var consNow = module.consultations || consultationRows.length;
      var pracNow = module.practices || practiceRows.length;
      var modDelta = '', consDelta = '', pracDelta = '';
      if (hayCompare){
        var mkDelta = function(now, prev, money){ var d = Number(now) - Number(prev || 0); return dashboardDelta({ value: d, percent: prev ? (d / Math.abs(prev)) : null }, money); };
        modDelta = mkDelta(module.net || 0, prevMod.net || 0, true);
        consDelta = mkDelta(consNow, prevMod.consultations || 0, false);
        pracDelta = mkDelta(pracNow, prevMod.practices || 0, false);
      }
      var consPrev = hayCompare ? '<div class="mod-prev">' + esc(cmpLbl) + ' ' + esc(numberFmt(prevMod.consultations || 0)) + '</div>' : '';
      var pracPrev = hayCompare ? '<div class="mod-prev">' + esc(cmpLbl) + ' ' + esc(numberFmt(prevMod.practices || 0)) + '</div>' : '';
      var netoPrev = hayCompare ? '<div class="mod-neto-prev">' + esc(cmpLbl) + ' ' + esc(moneyFmt(prevMod.net || 0)) + ' ' + modDelta + '</div>' : '';
      return '<tr class="dashboard-module-row">'
        + '<td><span class="nom-code">' + esc(module.moduleCode || '-') + '</span> <span class="nom-muted">' + esc(module.moduleDescription || '') + '</span></td>'
        + '<td class="tnum"><div class="mod-metric">' + countButton('Consulta', consNow) + consDelta + consPrev + '</div></td>'
        + '<td class="tnum"><div class="mod-metric">' + countButton('Practica', pracNow) + pracDelta + pracPrev + '</div></td>'
        + '<td class="nom-money"><div class="mod-neto-line"><b>' + esc(moneyFmt(module.net || 0)) + '</b>'
        + '<div class="mod-bar"><div class="mod-bar-fill" style="width:' + barW + '%"></div></div><span class="mod-share" title="Participación sobre la facturación total del mes">' + share + '%</span></div>' + netoPrev + '</td>'
        + '</tr>'
        + detailRow('Consulta', 'Consultas', consultationRows, prevConsRows)
        + detailRow('Practica', 'Practicas', practiceRows, prevPracRows);
    }).join('') : '<tr><td colspan="4" class="muted-cell">Sin datos para este mes.</td></tr>';
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
  if (!(CLIENT_REPORT_ROWS || []).length){ alert('Abrí o armá un reporte primero.'); return; }
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
  return tieneMotivos ? (r.debitMotivo === 'umbral') : (['pay40', 'pay60', 'pay80'].indexOf(r.debitType) >= 0);
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
  // La validación real REEMPLAZA la proyección automática: limpiamos primero los
  // débitos que puso la regla, y contamos si había acertado.
  var reglaAntes = 0, reglaAcerto = 0;
  rows.forEach(function(r){ if (r.debitSource === 'regla'){ reglaAntes++; r.manualDebit = false; r.debitType = 'total'; r.debitAmount = 0; r.autoDebit = false; r.debitSource = ''; } });
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
  if (reglaAntes) msg += ' (La regla automática había proyectado ' + reglaAntes + '; ahora manda la validación de PAMI.)';
  if (sinMatch.length) msg += ' Sin match (' + sinMatch.length + '): ' + sinMatch.slice(0, 8).join(', ') + (sinMatch.length > 8 ? '…' : '');
  resEl.textContent = aplicados ? msg : 'No se aplicó ningún débito (ninguna fila matcheó con la bandeja).';
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
    if (CLIENT_REPORT_STATUS && reportDisplayStatus(item.row) !== CLIENT_REPORT_STATUS) return false;
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
  if (!res.ok){ alert((res.data && res.data.error) || 'No se pudo guardar el valor.'); return; }
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
  (CLIENT_REPORT_ROWS || []).forEach(function(row){ var s = reportDisplayStatus(row); if (s && s !== '-') estados[s] = true; });
  var current = CLIENT_REPORT_STATUS;
  var options = Object.keys(estados).sort().map(function(s){ return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
  el.innerHTML = '<option value="">Todos los estados</option>' + options;
  if (current && estados[current]) el.value = current;
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
function editReportValue(index){
  if (CLIENT_REPORT_MODE === 'closed') return;
  var row = CLIENT_REPORT_ROWS[index];
  if (!row) return;
  var current = Number(row.valueGross || 0);
  var entered = window.prompt('Nuevo valor bruto para esta práctica', current ? String(current).replace('.', ',') : '');
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
  if (!res.ok){
    if (st) st.textContent = res.data.error || 'No se pudo guardar el reporte.';
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
  if (!confirm('Eliminar nomenclador ' + label + '?')) return;
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
  showModal('userModal','umScrim');
  document.getElementById('umName').focus();
}
function closeUserModal(){ hideModal('userModal','umScrim'); }
async function saveUser(){
  var err = document.getElementById('umError'); err.textContent = '';
  var btn = document.getElementById('umSave'); btn.disabled = true;
  var name = document.getElementById('umName').value.trim();
  var role = document.getElementById('umRole').value;
  var email = document.getElementById('umEmail').value.trim();
  var res;
  if (UM_MODE === 'create'){
    var username = document.getElementById('umUser').value.trim().toLowerCase();
    var password = document.getElementById('umPwd').value;
    res = await req('POST', '/api/users', { username: username, name: name, role: role, email: email, password: password });
  } else {
    var active = document.getElementById('umActive').checked;
    res = await req('PATCH', '/api/users/' + encodeURIComponent(UM_TARGET), { name: name, role: role, email: email, active: active });
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
  if (!res.ok){ alert(res.data.error || 'No se pudo cambiar el estado.'); return; }
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
var ME = null;         // usuario EFECTIVO (el espejado si el modo espejo está activo)
var ME_REAL = null;    // usuario realmente logueado (siempre el admin real)
var ESPEJO = false;    // modo espejo activo (solo lectura)
function setUser(u){ ME_REAL = u; aplicarUsuario(u); }
// Aplica la UI (menú, sidebar, saludo) para un usuario dado.
function aplicarUsuario(u){
  ME = u;
  // Administración (Facturas/Gastos) es solo para admin.
  var gp = document.getElementById('navGroupPagos'); if (gp) gp.style.display = (u.role === 'admin') ? '' : 'none';
  var ini = initials(u.name);
  document.getElementById('sideName').textContent = u.name;
  document.getElementById('sideRole').textContent = roleLabel(u.role);
  // Para la clínica, en vez de iniciales (que salen feas, ej. "CIMA (centro)" → "C(")
  // mostramos una cruz de salud. Los usuarios internos de NS mantienen sus iniciales.
  var cruzSalud = '<svg viewBox="0 0 24 24" style="width:20px;height:20px" aria-hidden="true"><path d="M9.5 3h5a1 1 0 011 1v4.5H20a1 1 0 011 1v5a1 1 0 01-1 1h-4.5V20a1 1 0 01-1 1h-5a1 1 0 01-1-1v-4.5H4a1 1 0 01-1-1v-5a1 1 0 011-1h4.5V4a1 1 0 011-1z" fill="currentColor"/></svg>';
  var sa = document.getElementById('sideAvatar'), ta = document.getElementById('topAvatar');
  if (u.role === 'clinica'){ if (sa) sa.innerHTML = cruzSalud; if (ta) ta.innerHTML = cruzSalud; }
  else { if (sa) sa.textContent = ini; if (ta) ta.textContent = ini; }
  var _h = new Date().getHours();
  var _saludo = _h < 6 ? 'Buenas noches' : (_h < 13 ? 'Buen día' : (_h < 20 ? 'Buenas tardes' : 'Buenas noches'));
  document.getElementById('dashHello').textContent = _saludo + ', ' + (u.name.split(' ')[0]) + ' 👋';
  // El acceso "Ver como…" solo lo ve el admin real.
  var vc = document.getElementById('verComoLink'); if (vc) vc.style.display = (ME_REAL && ME_REAL.role === 'admin') ? '' : 'none';
  // Rol clínica: solo su centro (oculta lo interno de NS por CSS) y sin "Adjuntar reporte".
  document.body.classList.toggle('role-clinica', u.role === 'clinica');
  var tabRep = document.getElementById('clientTabReportes'); if (tabRep) tabRep.style.display = (u.role === 'clinica') ? 'none' : '';
}
// Vistas internas de NS a las que la clínica no entra (la mandamos a su centro).
var NS_ONLY_VIEWS = ['dash','informes','nomencladores','credencial','soon','resumen','facturas','gastos'];
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
