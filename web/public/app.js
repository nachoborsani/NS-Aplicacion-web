var root=document.getElementById('root');
  function toggleTheme(){
    var d=root.getAttribute('data-theme')==='dark';
    root.setAttribute('data-theme', d?'light':'dark');
    document.getElementById('thIco').innerHTML = d
      ? '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
  }
  var titles={dash:'Inicio',users:'Usuarios',soon:'Configuración general'};
  function go(v,el){
    ['dash','users','soon'].forEach(function(x){document.getElementById('view-'+x).style.display = x===v?'block':'none';});
    document.getElementById('pageTitle').textContent=titles[v];
    document.querySelectorAll('.nav a, .side-config a').forEach(function(a){a.classList.remove('active');});
    if(el) el.classList.add('active');
    document.body.classList.remove('nav-open');
  }
  function togglePwd(){
    var inp=document.getElementById('pwd'), ic=document.getElementById('pwdEyeIco');
    var show = inp.type==='password';
    inp.type = show ? 'text' : 'password';
    ic.innerHTML = show
      ? '<path d="M17.94 17.94A10 10 0 0112 20c-7 0-11-8-11-8a18 18 0 015.06-5.94M9.9 4.24A9 9 0 0112 4c7 0 11 8 11 8a18 18 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>';
  }
  function openDrawer(){document.getElementById('drawer').classList.add('show');document.getElementById('scrim').classList.add('show');}
  function closeDrawer(){document.getElementById('drawer').classList.remove('show');document.getElementById('scrim').classList.remove('show');}
  // demo toggle active state
  document.querySelector('.demo').addEventListener('click',function(e){
    if(e.target.tagName!=='BUTTON')return;
    document.getElementById('d-login').classList.toggle('on', e.target.id==='d-login');
    document.getElementById('d-app').classList.toggle('on', e.target.id==='d-app');
  });
