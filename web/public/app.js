var root = document.getElementById('root');

function toggleTheme(){
  var d = root.getAttribute('data-theme') === 'dark';
  root.setAttribute('data-theme', d ? 'light' : 'dark');
  document.getElementById('thIco').innerHTML = d
    ? '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
}

var titles = { dash:'Inicio', users:'Usuarios', soon:'Configuración general' };
function go(v, el){
  ['dash','users','soon'].forEach(function(x){ document.getElementById('view-'+x).style.display = x===v ? 'block' : 'none'; });
  document.getElementById('pageTitle').textContent = titles[v];
  if (v === 'users') renderUsers();
  document.querySelectorAll('.nav a, .side-config a').forEach(function(a){ a.classList.remove('active'); });
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
      + '<td><div class="u"><div class="av" style="background:' + r.bg + '">' + esc(initials(u.name)) + '</div><div><div class="nm">' + esc(u.name) + '</div><div class="em">@' + un + '</div></div></div></td>'
      + '<td><span class="role ' + r.chip + '">' + esc(r.label) + '</span></td>'
      + '<td>' + st + '</td>'
      + '<td><div class="row-actions">' + acts + '</div></td>'
      + '</tr>';
  }).join('');
  var dc = document.getElementById('dashUsersCount'), ds = document.getElementById('dashUsersSub');
  if (dc) dc.textContent = users.length;
  if (ds){ var pend = users.filter(function(u){ return u.mustChange || !u.active; }).length; ds.textContent = (users.length - pend) + ' activos · ' + pend + ' pendientes'; }
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
  var res;
  if (UM_MODE === 'create'){
    var username = document.getElementById('umUser').value.trim().toLowerCase();
    var password = document.getElementById('umPwd').value;
    res = await req('POST', '/api/users', { username: username, name: name, role: role, password: password });
  } else {
    var active = document.getElementById('umActive').checked;
    res = await req('PATCH', '/api/users/' + encodeURIComponent(UM_TARGET), { name: name, role: role, active: active });
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
function showApp(){ document.body.classList.remove('mustchange','booting'); document.body.classList.add('authed'); renderUsers(); }
function showChange(){ document.body.classList.remove('authed','booting'); document.body.classList.add('mustchange'); }
function showLogin(){ document.body.classList.remove('authed','mustchange','booting'); }

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
  var btn = document.getElementById('loginBtn'); btn.disabled = true;
  var username = document.getElementById('loginUser').value.trim();
  var password = document.getElementById('pwd').value;
  if (!username || !password){ btn.disabled = false; err.textContent = 'Completá usuario y contraseña'; return; }
  var res = await api('/api/login', { username: username, password: password });
  btn.disabled = false;
  if (!res.ok){ err.textContent = res.data.error || 'No se pudo ingresar'; return; }
  document.getElementById('pwd').value = '';
  setUser(res.data.user);
  if (res.data.user.mustChange) showChange(); else showApp();
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

// ---------- init: ¿hay sesión? ----------
(async function(){
  var res = await api('/api/me');
  if (res.ok){
    setUser(res.data.user);
    if (res.data.user.mustChange) showChange(); else showApp();
  } else {
    showLogin();
  }
})();
