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
async function renderUsers(){
  var body = document.getElementById('usersBody');
  if (!body) return;
  var res = await api('/api/users');
  if (!res.ok){ body.innerHTML = '<tr><td colspan="4" style="color:var(--text-2);padding:16px">No se pudo cargar la lista.</td></tr>'; return; }
  var users = res.data.users || [];
  body.innerHTML = users.map(function(u){
    var r = ROLE[u.role] || { chip:'admin', label:u.role, bg:'linear-gradient(135deg,#66788a,#4f6378)' };
    var st = !u.active ? '<span class="st off">Inactivo</span>'
           : u.mustChange ? '<span class="st off">Debe cambiar clave</span>'
           : '<span class="st on">Activo</span>';
    return '<tr>'
      + '<td><div class="u"><div class="av" style="background:' + r.bg + '">' + esc(initials(u.name)) + '</div><div><div class="nm">' + esc(u.name) + '</div><div class="em">@' + esc(u.username) + '</div></div></div></td>'
      + '<td><span class="role ' + r.chip + '">' + esc(r.label) + '</span></td>'
      + '<td>' + st + '</td>'
      + '<td><button class="rowbtn">···</button></td>'
      + '</tr>';
  }).join('');
  var dc = document.getElementById('dashUsersCount'), ds = document.getElementById('dashUsersSub');
  if (dc) dc.textContent = users.length;
  if (ds){ var pend = users.filter(function(u){ return u.mustChange || !u.active; }).length; ds.textContent = (users.length - pend) + ' activos · ' + pend + ' pendientes'; }
}
function setUser(u){
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
