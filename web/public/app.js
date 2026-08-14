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

var titles = { dash:'Inicio', users:'Usuarios', clientes:'Clientes', nomencladores:'Nomencladores', soon:'Configuracion general' };
function go(v, el){
  ['dash','users','clientes','nomencladores','soon'].forEach(function(x){ document.getElementById('view-'+x).style.display = x===v ? 'block' : 'none'; });
  document.getElementById('pageTitle').textContent = titles[v];
  document.querySelector('.topbar').classList.toggle('client-mode', v === 'clientes');
  document.body.classList.toggle('client-view', v === 'clientes');
  if (v === 'users') renderUsers();
  if (v === 'clientes') loadClients();
  if (v === 'nomencladores') loadNomencladorSummary();
  document.querySelectorAll('.nav a, .side-config a, .nav-parent, .client-nav-item').forEach(function(a){ a.classList.remove('active'); });
  var clientsGroup = document.getElementById('clientsNavGroup');
  if (clientsGroup) {
    clientsGroup.classList.toggle('open', v === 'clientes');
    clientsGroup.classList.toggle('active', v === 'clientes');
  }
  if (el) el.classList.add('active');
  document.body.classList.remove('nav-open');
}

function openDrawer(){ document.getElementById('drawer').classList.add('show'); document.getElementById('scrim').classList.add('show'); }
function closeDrawer(){ document.getElementById('drawer').classList.remove('show'); document.getElementById('scrim').classList.remove('show'); }

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

// ---------- nomencladores ----------
var NOM_READY = false;
var NOM_TIMER = null;
var NOM_ACTIVE_PERIOD = '';
var NOM_MODULES = [];
var NOM_SELECTED_MODULES = [];
var CLIENTS = [];
var ACTIVE_CLIENT = null;
var CLIENT_NOM_TIMER = null;
var CLIENT_SECTION = 'basica';
var CLIENT_NOM_OPEN = false;
var CLIENT_REPORT_ROWS = [];
var CLIENT_REPORT_QUERY = '';
var CLIENT_REPORT_PRACTICE_QUERY = '';
var CLIENT_REPORT_MODULE = '';
var CLIENT_REPORT_TRANS_FROM = '';
var CLIENT_REPORT_TRANS_TO = '';
var CLIENT_REPORT_EXPECTED_AMOUNT = '';
var CLIENT_REPORT_SORT = '';
var CLIENT_REPORT_MODE = '';
var CLIENT_REPORT_ID = '';
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
  return scope === 'internacion' ? 'Internacion' : scope === 'ambulatorio' ? 'Ambulatorio' : 'Otros';
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
  }).join('') || '<div class="multi-empty">Sin modulos</div>';
  updateModuleTrigger();
}
function toggleModuleMenu(){
  var menu = document.getElementById('nomModuleMenu');
  if (menu) menu.classList.toggle('show');
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
  var list = document.getElementById('clientNavList');
  if (!list) return;
  list.innerHTML = CLIENTS.map(function(client){
    var active = ACTIVE_CLIENT && ACTIVE_CLIENT.slug === client.slug ? ' active' : '';
    return '<button class="client-nav-item' + active + '" type="button" data-client-slug="' + esc(client.slug) + '">' + esc(client.name) + '</button>';
  }).join('');
  list.querySelectorAll('[data-client-slug]').forEach(function(button){
    button.addEventListener('click', function(){
      go('clientes', document.getElementById('clientsNavToggle'));
      selectClient(button.getAttribute('data-client-slug'));
    });
  });
}
function selectClient(slug){
  ACTIVE_CLIENT = CLIENTS.filter(function(client){ return client.slug === slug; })[0] || ACTIVE_CLIENT;
  CLIENT_SECTION = 'basica';
  CLIENT_NOM_OPEN = false;
  renderClientList();
  renderActiveClient();
}
function setClientSection(section){
  CLIENT_SECTION = section === 'reportes' ? 'reportes' : 'basica';
  var basica = document.getElementById('client-section-basica');
  var reportes = document.getElementById('client-section-reportes');
  var tabBasica = document.getElementById('clientTabBasica');
  var tabReportes = document.getElementById('clientTabReportes');
  if (basica) basica.style.display = CLIENT_SECTION === 'basica' ? 'block' : 'none';
  if (reportes) reportes.style.display = CLIENT_SECTION === 'reportes' ? 'block' : 'none';
  if (tabBasica) tabBasica.classList.toggle('active', CLIENT_SECTION === 'basica');
  if (tabReportes) tabReportes.classList.toggle('active', CLIENT_SECTION === 'reportes');
  var crumb = document.getElementById('clientCrumbSection');
  if (crumb) crumb.textContent = CLIENT_SECTION === 'reportes' ? 'Reportes' : 'Informacion basica';
}
async function renderActiveClient(){
  var client = ACTIVE_CLIENT;
  if (!client) return;
  document.getElementById('clientCrumbName').textContent = client.name;
  document.getElementById('clientName').textContent = client.name;
  setClientSection(CLIENT_SECTION);
  renderClientNomencladorPanel();
  document.getElementById('clientBusinessName').textContent = client.businessName;
  document.getElementById('clientCuit').textContent = client.cuit;
  document.getElementById('clientModules').innerHTML = client.activeModules.map(function(module){
    return '<span class="module-chip"><b>' + esc(module.code) + '</b> ' + esc(module.name) + '</span>';
  }).join('');
  var editBtn = document.getElementById('clientModulesEdit');
  if (editBtn) editBtn.style.display = ME && ME.role === 'admin' ? 'grid' : 'none';
  var summary = await api('/api/nomencladores');
  if (summary.ok) {
    var items = summary.data.nomencladores || [];
    fillClientPeriodSelect(items, items[0] ? items[0].value : summary.data.activePeriod);
    fillClientReportPeriodSelect(items, items[0] ? items[0].value : summary.data.activePeriod);
  }
  await loadClientReports();
  restoreClientReportDraft();
  await loadClientNomenclador();
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
function moduleNameFromOption(option){
  var code = String(option.value || '').trim();
  var label = String(option.label || '').trim();
  var prefix = code ? code + ' - ' : '';
  return label.indexOf(prefix) === 0 ? label.slice(prefix.length).trim() : label;
}
async function openClientModulesModal(){
  if (!ACTIVE_CLIENT) return;
  var err = document.getElementById('clientModulesError');
  err.textContent = '';
  var box = document.getElementById('clientModulesOptions');
  box.innerHTML = '<div class="muted-cell">Cargando modulos...</div>';
  showModal('clientModulesModal','cmScrim');
  var period = document.getElementById('clientNomPeriod').value || '';
  var summary = await api('/api/nomencladores' + (period ? '?period=' + encodeURIComponent(period) : ''));
  if (!summary.ok || !summary.data.loaded){
    box.innerHTML = '<div class="muted-cell">Primero carga un nomenclador.</div>';
    return;
  }
  var activeByCode = {};
  ACTIVE_CLIENT.activeModules.forEach(function(module){ activeByCode[String(module.code)] = module; });
  var options = ((summary.data.filters || {}).modules || []).map(function(option){
    return { code:String(option.value || '').trim(), name:moduleNameFromOption(option) };
  }).filter(function(option){ return option.code; });
  ACTIVE_CLIENT.activeModules.forEach(function(module){
    if (!options.some(function(option){ return option.code === module.code; })) options.push(module);
  });
  box.innerHTML = options.map(function(option){
    var checked = activeByCode[option.code] ? ' checked' : '';
    return '<label class="module-edit-option"><input type="checkbox" value="' + esc(option.code) + '" data-name="' + esc(option.name) + '"' + checked + '><span><b>' + esc(option.code) + '</b> ' + esc(option.name) + '</span></label>';
  }).join('') || '<div class="muted-cell">No hay modulos disponibles en este nomenclador.</div>';
}
function closeClientModulesModal(){ hideModal('clientModulesModal','cmScrim'); }
async function saveClientModules(){
  if (!ACTIVE_CLIENT) return;
  var err = document.getElementById('clientModulesError');
  err.textContent = '';
  var selected = [].slice.call(document.querySelectorAll('#clientModulesOptions input:checked')).map(function(input){
    return { code:input.value, name:input.getAttribute('data-name') || '' };
  });
  if (!selected.length){ err.textContent = 'Selecciona al menos un modulo.'; return; }
  var btn = document.getElementById('clientModulesSave');
  btn.disabled = true;
  var res = await req('PATCH', '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/modules', { activeModules:selected });
  btn.disabled = false;
  if (!res.ok){ err.textContent = res.data.error || 'No se pudieron guardar los modulos.'; return; }
  CLIENTS = res.data.clients || CLIENTS;
  ACTIVE_CLIENT = res.data.client || ACTIVE_CLIENT;
  renderClientList();
  closeClientModulesModal();
  await renderActiveClient();
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
    return '<tr>'
      + '<td><div class="nom-code">' + esc(report.title || 'Reporte cerrado') + '</div><div class="nom-muted">' + esc(dateFmt(report.closedAt)) + '<br>' + esc(report.sourceFilename || '') + (notes ? '<br>Obs. ' + esc(notes) : '') + '</div></td>'
      + '<td>' + esc(report.nomencladorLabel || report.nomencladorPeriod || '-') + '</td>'
      + '<td class="tnum">' + esc(report.rowCount || summary.totalRows || 0) + '</td>'
      + '<td class="nom-money"><b>' + esc(moneyFmt(summary.net || 0)) + '</b><div class="nom-muted">Deb. ' + esc(moneyFmt(summary.debit || 0)) + '</div></td>'
      + '<td><div class="report-row-actions"><button class="btn btn-ghost report-open-btn" type="button" onclick="openClientReport(&quot;' + esc(report.id) + '&quot;)">Ver</button><button class="btn btn-ghost report-open-btn" type="button" onclick="downloadClientReport(&quot;' + esc(report.id) + '&quot;)">Descargar</button></div></td>'
      + '</tr>';
  }).join('');
}
function downloadClientReport(id){
  if (!ACTIVE_CLIENT || !id) return;
  window.location.href = '/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/reportes/' + encodeURIComponent(id) + '/download';
}
function downloadActiveClientReport(){
  if (!CLIENT_REPORT_ID) return;
  downloadClientReport(CLIENT_REPORT_ID);
}
async function loadClientReports(){
  if (!ACTIVE_CLIENT) return;
  var res = await api('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/reportes');
  CLIENT_SAVED_REPORTS = res.ok ? (res.data.reports || []) : [];
  renderSavedClientReports();
}
function reportBaseGross(row){
  return row.billable ? Number(row.valueGross || 0) : 0;
}
function reportDebitAmount(row){
  var gross = reportBaseGross(row);
  if (!row.manualDebit || gross <= 0) return 0;
  if (row.debitType === 'pay40') return Math.max(0, gross - (gross * 0.4));
  if (row.debitType === 'pay60') return Math.max(0, gross - (gross * 0.6));
  if (row.debitType === 'partial') return Math.max(0, Math.min(gross, Number(row.debitAmount || 0)));
  return gross;
}
function reportNetAmount(row){
  return Math.max(0, reportBaseGross(row) - reportDebitAmount(row));
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
  var downloadBtn = document.getElementById('clientReportDownloadBtn');
  if (downloadBtn) downloadBtn.disabled = !CLIENT_REPORT_ID || CLIENT_REPORT_MODE !== 'closed';
  var closeBtn = document.getElementById('clientReportCloseBtn');
  if (closeBtn) closeBtn.disabled = !totalRows || CLIENT_REPORT_MODE !== 'closed';
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
    var transDate = String(item.row.transmittedAt || '').slice(0, 10);
    if (transFrom && (!transDate || transDate < transFrom)) return false;
    if (transTo && (!transDate || transDate > transTo)) return false;
    return true;
  });
  if (CLIENT_REPORT_SORT === 'practice-asc' || CLIENT_REPORT_SORT === 'practice-desc') {
    rows.sort(function(a, b){
      var av = normalizeReportSearch([a.row.practiceCode, a.row.practiceDescription, a.row.practiceText].join(' '));
      var bv = normalizeReportSearch([b.row.practiceCode, b.row.practiceDescription, b.row.practiceText].join(' '));
      var cmp = av.localeCompare(bv);
      return CLIENT_REPORT_SORT === 'practice-desc' ? -cmp : cmp;
    });
  }
  return rows;
}
function updateClientReportSummary(){
  var visible = getClientReportVisibleRows();
  var rows = visible.map(function(item){ return item.row; });
  var gross = 0, debit = 0, net = 0, absent = 0, outside = 0, unmatched = 0;
  rows.forEach(function(row){
    gross += reportBaseGross(row);
    debit += reportDebitAmount(row);
    net += reportNetAmount(row);
    if (row.absent) absent += 1;
    if (row.outsideCutoff) outside += 1;
    if (!row.matchFound && !row.valueEdited) unmatched += 1;
  });
  var cards = document.querySelectorAll('#clientReportSummary div');
  if (cards[0]) cards[0].querySelector('b').textContent = moneyFmt(gross);
  if (cards[1]) cards[1].querySelector('b').textContent = moneyFmt(debit);
  if (cards[2]) cards[2].querySelector('b').textContent = moneyFmt(net);
  if (cards[3]) cards[3].querySelector('b').textContent = String(absent);
  updateExpectedAmountStatus(net);
  var totalRows = (CLIENT_REPORT_ROWS || []).length;
  var meta = rows.length + ' de ' + totalRows + ' practicas - ' + rows.filter(function(row){ return row.billable; }).length + ' facturables';
  if (outside) meta += ' - ' + outside + ' fuera de corte';
  if (unmatched) meta += ' - ' + unmatched + ' sin valor';
  document.getElementById('clientReportMeta').textContent = totalRows ? meta : 'Todavia no hay bandeja cargada.';
  var clearBtn = document.getElementById('clientReportClearBtn');
  if (clearBtn) clearBtn.disabled = !totalRows;
  updateClientReportFormState();
  var sortIcon = document.getElementById('clientReportPracticeSortIcon');
  if (sortIcon) sortIcon.textContent = CLIENT_REPORT_SORT === 'practice-desc' ? 'Z-A' : 'A-Z';
}
function renderClientReportRows(){
  var body = document.getElementById('clientReportBody');
  if (!body) return;
  if (!CLIENT_REPORT_ROWS.length){
    body.innerHTML = '<tr><td colspan="7" class="muted-cell">No hay datos cargados.</td></tr>';
    updateClientReportSummary();
    return;
  }
  var visible = getClientReportVisibleRows();
  if (!visible.length){
    body.innerHTML = '<tr><td colspan="7" class="muted-cell">No hay resultados para esa busqueda.</td></tr>';
    updateClientReportSummary();
    return;
  }
  body.innerHTML = visible.map(function(item){
    var row = item.row;
    var idx = item.index;
    var readOnly = CLIENT_REPORT_MODE === 'closed';
    var disabled = (readOnly || reportBaseGross(row) <= 0) ? ' disabled' : '';
    var checked = row.manualDebit ? ' checked' : '';
    var type = row.debitType || 'total';
    if (type === 'partial') type = reportNetAmount(row) >= reportBaseGross(row) * 0.5 ? 'pay60' : 'pay40';
    var badgeClass = row.billable ? 'ok' : (row.absent ? 'warn' : 'muted');
    var valueSource = row.valueSourceCode && row.valueSourceCode !== row.practiceCode ? '<br>Valor segun ' + esc(row.valueSourceCode) : '';
    var valueNote = row.valueEdited ? '<div class="nom-muted">Editado manual</div>' : (readOnly ? '' : '<div class="nom-muted">Doble click</div>');
    var valueDblClick = readOnly ? '' : ' ondblclick="editReportValue(' + idx + ')"';
    return '<tr data-report-row="' + idx + '">'
      + '<td><div class="nom-code">' + esc(row.patientName || '-') + '</div><div class="nom-muted">' + esc(row.benefit || '') + '<br>OME ' + esc(row.order || '-') + '</div></td>'
      + '<td><div class="nom-practice-line"><span class="nom-code">' + esc(row.practiceCode || '-') + '</span><span class="nom-desc">' + esc(row.practiceDescription || row.practiceText || '') + '</span></div><div class="nom-muted">' + esc(row.moduleCode || '') + ' ' + esc(row.moduleDescription || '') + valueSource + '</div></td>'
      + '<td><div>' + esc(row.appointmentLabel || '-') + '</div><div class="nom-muted">Transm. ' + esc(row.transmittedLabel || '-') + '</div></td>'
      + '<td><span class="report-status ' + badgeClass + '">' + esc(row.status || '-') + '</span></td>'
      + '<td class="nom-money report-value-cell"' + valueDblClick + '><b>' + esc(moneyFmt(reportBaseGross(row))) + '</b>' + valueNote + '</td>'
      + '<td><div class="debit-controls"><label class="debit-check"><input type="checkbox" onchange="toggleReportDebit(' + idx + ', this.checked)"' + checked + disabled + '> Debito</label><select class="inp" onchange="setReportDebitType(' + idx + ', this.value)"' + disabled + '><option value="total"' + (type === 'total' ? ' selected' : '') + '>Total</option><option value="pay40"' + (type === 'pay40' ? ' selected' : '') + '>40%</option><option value="pay60"' + (type === 'pay60' ? ' selected' : '') + '>60%</option></select></div></td>'
      + '<td class="nom-money"><b>' + esc(moneyFmt(reportNetAmount(row))) + '</b></td>'
      + '</tr>';
  }).join('');
  updateClientReportSummary();
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
  el.innerHTML = '<option value="">Todos los modulos</option>' + options;
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
  var search = document.getElementById('clientReportSearch');
  if (search) search.value = '';
  var practice = document.getElementById('clientReportPracticeFilter');
  if (practice) practice.value = '';
  renderClientReportModuleFilter();
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
  var entered = window.prompt('Nuevo valor bruto para esta practica', current ? String(current).replace('.', ',') : '');
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
  resetClientReportFilters();
  setClientReportExpectedInput(draft.expectedAmount || '');
  setClientReportObservationsInput(draft.observations || '');
  var title = document.getElementById('clientReportTitle');
  if (title) title.value = draft.title || '';
  var periodSelect = document.getElementById('clientReportPeriod');
  if (periodSelect && CLIENT_REPORT_SOURCE && CLIENT_REPORT_SOURCE.nomencladorPeriod) periodSelect.value = CLIENT_REPORT_SOURCE.nomencladorPeriod;
  var st = document.getElementById('clientReportStatus');
  if (st) st.textContent = CLIENT_REPORT_MODE === 'edit' ? 'Edicion restaurada. Guarda cambios para cerrar el reporte.' : 'Borrador restaurado. Para cambiar el nomenclador, volve a adjuntar la bandeja.';
  renderClientReportRows();
}
function clearClientReport(){
  CLIENT_REPORT_ROWS = [];
  CLIENT_REPORT_MODE = '';
  CLIENT_REPORT_ID = '';
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
}
function toggleReportDebit(index, checked){
  if (CLIENT_REPORT_MODE === 'closed') return;
  var row = CLIENT_REPORT_ROWS[index];
  if (!row) return;
  row.manualDebit = checked;
  if (checked && !row.debitType) row.debitType = 'total';
  renderClientReportRows();
  saveClientReportDraft();
}
function setReportDebitType(index, value){
  if (CLIENT_REPORT_MODE === 'closed') return;
  var row = CLIENT_REPORT_ROWS[index];
  if (!row) return;
  row.manualDebit = true;
  row.debitType = value === 'pay40' || value === 'pay60' ? value : 'total';
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
}
async function openClientReport(id){
  if (!ACTIVE_CLIENT || !id) return;
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
  resetClientReportFilters();
  setClientReportExpectedInput(report.expectedAmount ? String(report.expectedAmount).replace('.', ',') : '');
  setClientReportObservationsInput(report.observations || '');
  var title = document.getElementById('clientReportTitle');
  if (title) title.value = report.title || '';
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
    if (closedStatus) closedStatus.textContent = 'Este reporte ya esta cerrado; el nomenclador no se recalcula.';
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
async function uploadClientReport(files){
  if (!files || !files[0] || !ACTIVE_CLIENT) return;
  CLIENT_REPORT_FILE = files[0];
  var wasClosed = CLIENT_REPORT_MODE === 'closed';
  var st = document.getElementById('clientReportStatus');
  st.textContent = 'Procesando bandeja...';
  var period = document.getElementById('clientReportPeriod').value || '';
  var form = new FormData();
  form.append('file', files[0]);
  var res = await fetch('/api/clientes/' + encodeURIComponent(ACTIVE_CLIENT.slug) + '/reportes/preview' + (period ? '?period=' + encodeURIComponent(period) : ''), { method:'POST', body:form });
  var data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok){
    st.textContent = data.error || 'No se pudo procesar la bandeja.';
    return;
  }
  var previousById = {};
  (CLIENT_REPORT_ROWS || []).forEach(function(row){ previousById[row.id] = row; });
  CLIENT_REPORT_ROWS = (data.rows || []).map(function(row){
    var prev = previousById[row.id];
    row.manualDebit = prev ? !!prev.manualDebit : false;
    row.debitType = prev ? (prev.debitType || 'total') : 'total';
    row.debitAmount = prev ? (prev.debitAmount || 0) : '';
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
  resetClientReportFilters();
  if (wasClosed) setClientReportExpectedInput('');
  if (wasClosed) setClientReportObservationsInput('');
  var title = document.getElementById('clientReportTitle');
  if (title && wasClosed) title.value = '';
  st.textContent = data.filename + ' - ' + data.rowCount + ' practicas - nomenclador ' + data.nomencladorLabel;
  renderClientReportRows();
  saveClientReportDraft();
}
function setDefaultUploadPeriod(){
  var el = document.getElementById('nomUploadPeriod');
  if (!el) return;
  el.value = '';
}
async function loadNomencladorSummary(period){
  var st = document.getElementById('nomStatus');
  if (!st) return;
  setDefaultUploadPeriod();
  var selected = period || document.getElementById('nomPeriod').value || '';
  var res = await api('/api/nomencladores' + (selected ? '?period=' + encodeURIComponent(selected) : ''));
  if (!res.ok){
    st.innerHTML = '<div><b>No se pudo consultar el nomenclador</b><span>Revisa la sesion o volve a ingresar.</span></div>';
    return;
  }
  NOM_READY = !!res.data.loaded;
  var previousPeriod = NOM_ACTIVE_PERIOD;
  NOM_ACTIVE_PERIOD = res.data.activePeriod || '';
  if (previousPeriod && NOM_ACTIVE_PERIOD && previousPeriod !== NOM_ACTIVE_PERIOD) NOM_SELECTED_MODULES = [];
  fillPeriodSelect(res.data.nomencladores || [], NOM_ACTIVE_PERIOD);
  if (!NOM_READY){
    st.innerHTML = '<div><b>Sin nomenclador cargado</b><span>Subi un Excel .xls o .xlsx para habilitar la busqueda.</span></div>';
    document.getElementById('nomBody').innerHTML = '<tr><td colspan="6" class="muted-cell">No hay datos cargados.</td></tr>';
    document.getElementById('nomResultMeta').textContent = 'Todavia no hay busqueda.';
    return;
  }
  var d = res.data;
  st.innerHTML = '<div><b>' + esc(d.label || d.activePeriod) + ' - ' + esc(d.filename) + '</b><span>' + esc(d.vigencia || d.sheetName || 'Nomenclador') + ' - ' + esc(String(d.rowCount)) + ' prestaciones - cargado ' + esc(dateFmt(d.uploadedAt)) + '</span></div>'
    + '<div class="nom-cols">Valor: ' + esc(d.columns.total) + '</div>';
  renderModuleOptions(d.filters.modules);
  fillSelect('nomScope', d.filters.scopes);
  fillSelect('nomType', d.filters.types);
  await searchNomenclador();
}
async function uploadNomenclador(files){
  if (!files || !files[0]) return;
  var st = document.getElementById('nomStatus');
  var input = document.getElementById('nomFile');
  var period = document.getElementById('nomUploadPeriod').value;
  st.innerHTML = '<div><b>Procesando Excel...</b><span>Esto puede tardar unos segundos. Si no elegiste mes, se detecta desde el archivo.</span></div>';
  var fd = new FormData();
  if (period) fd.append('period', period);
  fd.append('file', files[0]);
  var r = await fetch('/api/nomencladores/upload', { method:'POST', body: fd });
  var data = {};
  try { data = await r.json(); } catch (e) {}
  if (input) input.value = '';
  if (!r.ok){
    st.innerHTML = '<div><b>No se pudo cargar</b><span>' + esc(data.error || 'Revisa el formato del archivo.') + '</span></div>';
    return;
  }
  await loadNomencladorSummary(data.activePeriod || period);
}
async function deleteNomenclador(){
  var period = document.getElementById('nomPeriod').value || NOM_ACTIVE_PERIOD;
  if (!period || !NOM_READY) return;
  var label = document.getElementById('nomPeriod').selectedOptions[0] ? document.getElementById('nomPeriod').selectedOptions[0].textContent : period;
  if (!confirm('Eliminar nomenclador ' + label + '?')) return;
  var st = document.getElementById('nomStatus');
  st.innerHTML = '<div><b>Eliminando nomenclador...</b><span>' + esc(label) + '</span></div>';
  var res = await req('DELETE', '/api/nomencladores?period=' + encodeURIComponent(period));
  if (!res.ok){
    st.innerHTML = '<div><b>No se pudo eliminar</b><span>' + esc(res.data.error || 'Revisa permisos o sesion.') + '</span></div>';
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
var ME = null;
function setUser(u){
  ME = u;
  var ini = initials(u.name);
  document.getElementById('sideName').textContent = u.name;
  document.getElementById('sideRole').textContent = roleLabel(u.role);
  document.getElementById('sideAvatar').textContent = ini;
  document.getElementById('topAvatar').textContent = ini;
  document.getElementById('dashHello').textContent = 'Buen día, ' + (u.name.split(' ')[0]) + ' 👋';
}
function showApp(){ document.body.classList.remove('mustchange','booting'); document.body.classList.add('authed'); renderUsers(); loadClients({ detail:false }); }
function showChange(){ document.body.classList.remove('authed','booting'); document.body.classList.add('mustchange'); }
function showLogin(){ document.body.classList.remove('authed','mustchange','booting','resetting'); }

async function api(path, body){
  var opt = { method: body ? 'POST' : 'GET', headers: { 'content-type':'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  var r = await fetch(path, opt);
  var data = {};
  try { data = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, data: data };
}
async function req(method, path, body){
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
