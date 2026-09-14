/* ============================================================================
 * Laboratorio — Sistema de gestión para centros médicos (en desarrollo).
 * Mini-app autocontenida que vive dentro de la vista #view-lab. Reusa los
 * helpers globales de app.js (api, req, esc) e inyecta su propio CSS/DOM.
 * Backend: /api/lab/*  (web/lab_server.js).
 *
 * Arranca por la AGENDA. Se van sumando módulos sobre el mismo almacén.
 * ========================================================================== */
(function () {
  "use strict";

  var LAB = {
    booted: false,
    modulo: "agenda",
    cat: { especialidades: [], profesionales: [], consultorios: [], obrasSociales: [], practicas: [] },
    rol: "", permisos: [], profesionalId: "", centro: "", centros: [],
    ag: { especialidadId: "", profesionalId: "", fecha: "" },
  };
  var DOW = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  var ESTADOS = {
    dado: { label: "Dado", color: "#94a3b8" },
    esperando: { label: "Esperando", color: "#eab308" },
    atendido: { label: "Atendido", color: "#22c55e" },
    ausente: { label: "Ausente", color: "#ef4444" },
    ausente_aviso: { label: "Ausente c/aviso", color: "#f97316" },
    cancelado: { label: "Cancelado", color: "#64748b" },
  };

  // ---- helpers -------------------------------------------------------------
  function e(tag, attrs, html) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") el.className = attrs[k];
      else if (k === "html") el.innerHTML = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    if (html != null) el.innerHTML = html;
    return el;
  }
  function esc(s) { return window.esc ? window.esc(s) : String(s == null ? "" : s); }
  function hoyISO() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function nombreEsp(id) { var x = LAB.cat.especialidades.find(function (o) { return o.id === id; }); return x ? x.nombre : ""; }
  function nombreCons(id) { var x = LAB.cat.consultorios.find(function (o) { return o.id === id; }); return x ? x.nombre : ""; }
  function toast(msg, err) {
    var t = e("div", { class: "lab-toast" + (err ? " err" : "") }, esc(msg));
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("show"); }, 10);
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 300); }, 2600);
  }
  // Modal genérico. Devuelve el nodo del cuerpo para completarlo.
  function modal(titulo, opts) {
    opts = opts || {};
    labClose();
    var scrim = e("div", { class: "lab-scrim", id: "lab-scrim" });
    var box = e("div", { class: "lab-modal" + (opts.ancho ? " " + opts.ancho : "") });
    box.appendChild(e("div", { class: "lab-modal-head" },
      '<b>' + esc(titulo) + '</b><button class="lab-x" title="Cerrar">✕</button>'));
    var body = e("div", { class: "lab-modal-body" });
    box.appendChild(body);
    if (opts.pie) box.appendChild(e("div", { class: "lab-modal-foot" }, opts.pie));
    scrim.appendChild(box);
    document.body.appendChild(scrim);
    box.querySelector(".lab-x").onclick = labClose;
    scrim.onclick = function (ev) { if (ev.target === scrim) labClose(); };
    return { scrim: scrim, box: box, body: body };
  }
  function labClose() { var s = document.getElementById("lab-scrim"); if (s) s.remove(); }
  window.labClose = labClose;

  // Todo lo que se pide lleva de que centro es. Va en un solo lugar a proposito: si
  // cada llamada tuviera que acordarse, la primera que se olvide lee los datos de otro
  // centro y nadie se entera hasta que aparece un paciente que no es.
  function conCentro(path) {
    if (!LAB.centro) return path;
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + "centro=" + encodeURIComponent(LAB.centro);
  }
  // "no-auth" es la clave que usa todo NS para decir que se cayo la sesion. Se
  // traduce aca, en la unica puerta por la que pasan las respuestas: cambiarla en el
  // server romperia la convencion del resto del sistema, y dejarla pasar le muestra
  // al usuario una palabra que no significa nada.
  function humano(r) {
    if (r && r.data && r.data.error === "no-auth") r.data.error = "Se cerró la sesión. Volvé a entrar.";
    return r;
  }
  async function api(path, body) { return humano(await window.api(conCentro(path), body)); }
  async function req(method, path, body) { return humano(await window.req(method, conCentro(path), body)); }

  // ---- init + shell --------------------------------------------------------
  window.labInit = async function () {
    injectCss();
    if (!LAB.centro) { try { LAB.centro = localStorage.getItem("ns-lab-centro") || ""; } catch (err) {} }
    var root = document.getElementById("view-lab");
    if (!root) return;
    if (!LAB.booted) {
      root.innerHTML = '<div class="lab-muted" style="padding:18px">Cargando\u2026</div>';
      // El bootstrap PRIMERO: de ahi salen los permisos, y el menu se arma con eso.
      // Al reves —que es como estaba— el menu se dibujaba con la lista de permisos
      // todavia vacia y no quedaba ningun boton: la pantalla salia sin costado.
      var listo = await cargarBootstrap();
      if (!listo) {
        // Pasa en cada deploy: el navegador ya tiene el archivo nuevo y el servidor
        // todavia esta reiniciando. Antes quedaba la pantalla armada a medias, sin
        // menu, como si el sistema estuviera roto.
        root.innerHTML = '<div class="lab-card" style="max-width:520px;margin:40px auto;text-align:center">' +
          '<h3 style="margin:0 0 6px">No pude conectarme al sistema</h3>' +
          '<div class="lab-muted" style="margin-bottom:14px">Puede ser que el servidor se esté reiniciando. Probá de nuevo en unos segundos.</div>' +
          '<button class="lab-btn primary" id="lab-reintentar" type="button">Reintentar</button></div>';
        var b = document.getElementById("lab-reintentar");
        if (b) b.onclick = function () { window.labInit(); };
        return;
      }
      root.innerHTML = "";
      root.appendChild(shell());
      LAB.booted = true;
    }
    labGo(LAB.modulo || "agenda");
  };

  // El menu va al costado y agrupado por lo que se hace con cada cosa: el dia a dia
  // arriba (agenda y pacientes), la plata en el medio, y los catalogos —que se
  // cargan una vez y no se miran mas— al final. En la tira horizontal los ocho
  // botones pesaban igual y no se encontraba nada.
  // El cuarto dato de cada modulo es el permiso que pide: el menu se arma con lo que
  // el usuario PUEDE, asi no se muestra algo que despues devuelve 403.
  var LAB_MENU = [
    ["Atención", [["inicio", "📈", "Inicio", "agenda"], ["agenda", "📅", "Agenda", "agenda"], ["sala", "🪧", "Sala de espera", "agenda"], ["recordatorios", "📲", "Recordatorios", "agenda"], ["reprogramar", "🔁", "Reprogramar", "agenda"], ["pacientes", "👤", "Pacientes", "pacientes"]]],
    ["Administración", [["caja", "💵", "Caja", "caja"], ["estadistica", "📊", "Estadística", "estadistica"], ["liquidacion", "🧾", "Liquidación", "liquidacion"]]],
    ["Configuración", [["profesionales", "🩺", "Profesionales", "config"], ["practicas", "🧾", "Prácticas", "config"],
      ["especialidades", "🏷️", "Especialidades", "config"],
      ["consultorios", "🚪", "Consultorios", "config"], ["obrasSociales", "🩹", "Obras Sociales", "config"],
      ["online", "🌐", "Turnos online", "config"], ["usuarios", "👥", "Usuarios", "usuarios"]]],
  ];
  function labPuede(permiso) { return !permiso || (LAB.permisos || []).indexOf(permiso) >= 0; }
  // El menu del sistema va en la barra azul de NS, al lado de "Inicio". Antes vivia
  // en una tarjeta blanca al costado y quedaban dos menus, uno arriba del otro.
  function pintarNavLateral() {
    var nav = document.querySelector(".sidebar .nav");
    if (!nav) return;
    nav.querySelectorAll(".lab-only").forEach(function (x) { x.remove(); });
    // Cambiar de centro: solo lo ve quien maneja mas de uno (nosotros). El usuario
    // del centro no elige: entra al suyo.
    if ((LAB.centros || []).length > 1) {
      var wrap = e("div", { class: "lab-only lab-centro-sel" });
      var sel = e("select", { class: "lab-in" });
      sel.innerHTML = LAB.centros.map(function (c) {
        return '<option value="' + esc(c.slug) + '"' + (c.slug === LAB.centro ? " selected" : "") + ">" + esc(c.name) + "</option>";
      }).join("");
      sel.onchange = function () {
        LAB.centro = sel.value;
        LAB.booted = false;   // otro centro es otra base: se recarga todo
        try { localStorage.setItem("ns-lab-centro", LAB.centro); } catch (err) {}
        window.labInit();
      };
      wrap.appendChild(sel);
      nav.appendChild(wrap);
    }
    // El "Inicio" del sistema es el modulo de Atencion; no va uno suelto arriba, que
    // dejaba dos "Inicio" a tres centimetros uno del otro.
    LAB_MENU.forEach(function (grupo) {
      var visibles = grupo[1].filter(function (m) { return labPuede(m[3]); });
      if (!visibles.length) return;   // un grupo entero sin permiso no deja el titulo solo
      nav.appendChild(e("div", { class: "nav-section lab-only" }, esc(grupo[0])));
      visibles.forEach(function (m) {
        var a = e("a", { class: "lab-only lab-navlink", "data-mod": m[0] },
          '<span class="lab-tab-ic">' + m[1] + "</span>" + esc(m[2]));
        a.onclick = function () { labGo(m[0]); };
        nav.appendChild(a);
      });
    });
    marcarNavActivo();
  }
  // La primera pantalla que el usuario tiene permitida: para un recepcionista es la
  // agenda, para alguien que solo cobra es la caja.
  function primerModulo() {
    for (var i = 0; i < LAB_MENU.length; i++) {
      var m = LAB_MENU[i][1].filter(function (x) { return labPuede(x[3]); })[0];
      if (m) return m[0];
    }
    return "agenda";
  }
  function marcarNavActivo() {
    document.querySelectorAll(".sidebar .nav .lab-navlink").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-mod") === LAB.modulo);
    });
  }
  function shell() {
    var wrap = e("div", { class: "lab-wrap" });
    wrap.appendChild(e("div", { class: "lab-content", id: "lab-content" }));
    pintarNavLateral();
    return wrap;
  }

  async function cargarBootstrap() {
    var r = await api("/api/lab/bootstrap");
    if (!r.ok || !r.data) return false;
    {
      LAB.cat.especialidades = r.data.especialidades || [];
      LAB.cat.profesionales = r.data.profesionales || [];
      LAB.cat.consultorios = r.data.consultorios || [];
      LAB.cat.obrasSociales = r.data.obrasSociales || [];
      LAB.cat.practicas = r.data.practicas || [];
      LAB.rol = r.data.rol || "";
      LAB.permisos = r.data.permisos || [];
      LAB.profesionalId = r.data.profesionalId || "";
      LAB.config = r.data.config || {};
      LAB.centro = r.data.centro || LAB.centro || "";
      LAB.centros = r.data.centros || [];
      // El sistema se presenta con el nombre del centro. "Laboratorio" es como
      // lo llamamos nosotros de este lado; el centro no tiene por que verlo.
      var tit = document.getElementById("pageTitle");
      if (tit) tit.textContent = LAB.config.centroNombre || "Sistema de turnos";
    }
    return true;
  }

  function labGo(mod) {
    LAB.modulo = mod;
    marcarNavActivo();
    var c = document.getElementById("lab-content");
    if (!c) return;
    if (mod === "agenda") viewAgenda(c);
    else if (mod === "caja") viewCaja(c);
    else if (mod === "estadistica") viewEstadistica(c);
    else if (mod === "pacientes") viewPacientes(c);
    else if (mod === "profesionales") viewProfesionales(c);
    else if (mod === "liquidacion") viewLiquidacion(c);
    else if (mod === "reprogramar") viewReprogramar(c);
    else if (mod === "recordatorios") viewRecordatorios(c);
    else if (mod === "inicio") viewInicio(c);
    else if (mod === "sala") viewSala(c);
    else if (mod === "online") viewOnline(c);
    else if (mod === "usuarios") viewUsuarios(c);
    else if (mod === "practicas") viewPracticas(c);
    else if (mod === "especialidades") viewCatalogo(c, "especialidades", "Especialidades");
    else if (mod === "consultorios") viewCatalogo(c, "consultorios", "Consultorios");
    else if (mod === "obrasSociales") viewObrasSociales(c);
  }
  window.labGo = labGo;

  /* ========================== AGENDA ==================================== */
  function viewAgenda(c) {
    if (!LAB.ag.fecha) LAB.ag.fecha = hoyISO();
    var profesAll = LAB.cat.profesionales.filter(function (p) { return p.activo !== false; });
    // opciones de especialidad
    var espOpts = '<option value="">Todas las especialidades</option>' +
      LAB.cat.especialidades.map(function (o) { return '<option value="' + o.id + '"' + (o.id === LAB.ag.especialidadId ? " selected" : "") + '>' + esc(o.nombre) + "</option>"; }).join("");
    var profesFiltrados = profesAll.filter(function (p) { return !LAB.ag.especialidadId || p.especialidadId === LAB.ag.especialidadId; });
    if (profesFiltrados.length && !profesFiltrados.some(function (p) { return p.id === LAB.ag.profesionalId; })) LAB.ag.profesionalId = profesFiltrados[0].id;
    var profOpts = profesFiltrados.length
      ? profesFiltrados.map(function (p) { return '<option value="' + p.id + '"' + (p.id === LAB.ag.profesionalId ? " selected" : "") + '>' + esc(p.nombre) + (p.especialidadId ? " · " + esc(nombreEsp(p.especialidadId)) : "") + "</option>"; }).join("")
      : '<option value="">— sin profesionales —</option>';

    c.innerHTML = "";
    var head = e("div", { class: "lab-card lab-ag-head" });
    head.innerHTML =
      '<div class="lab-ag-controls">' +
        '<select id="lab-ag-esp" class="lab-in">' + espOpts + "</select>" +
        '<select id="lab-ag-prof" class="lab-in">' + profOpts + "</select>" +
        '<div class="lab-ag-fecha">' +
          '<button class="lab-btn ghost" id="lab-ag-prev" title="Día anterior">‹</button>' +
          '<input type="date" id="lab-ag-date" class="lab-in" value="' + esc(LAB.ag.fecha) + '">' +
          '<button class="lab-btn ghost" id="lab-ag-next" title="Día siguiente">›</button>' +
          '<button class="lab-btn" id="lab-ag-ausencia" type="button" title="Marcar vacaciones, un congreso o un feriado">No atender…</button><button class="lab-btn" id="lab-ag-transf" type="button" title="Pasarle los turnos a otro profesional">Transferir…</button><button class="lab-btn" id="lab-ag-hoy">Hoy</button>' +
        "</div>" +
      "</div>" +
      '<div class="lab-ag-info" id="lab-ag-info"></div>';
    c.appendChild(head);

    c.appendChild(e("div", { class: "lab-card lab-cal-card", id: "lab-ag-cal" }));

    var leyenda = e("div", { class: "lab-leyenda" }, Object.keys(ESTADOS).filter(function (k) { return k !== "cancelado"; }).map(function (k) {
      return '<span class="lab-lg"><i style="background:' + ESTADOS[k].color + '"></i>' + esc(ESTADOS[k].label) + "</span>";
    }).join(""));
    c.appendChild(leyenda);

    c.appendChild(e("div", { id: "lab-ag-bloqueo" }));
    c.appendChild(e("div", { class: "lab-card", id: "lab-ag-grid" }, '<div class="lab-muted" style="padding:20px">Cargando…</div>'));

    // eventos
    document.getElementById("lab-ag-esp").onchange = function () { LAB.ag.especialidadId = this.value; LAB.ag.profesionalId = ""; viewAgenda(c); };
    document.getElementById("lab-ag-prof").onchange = function () { LAB.ag.profesionalId = this.value; agLoad(); };
    document.getElementById("lab-ag-date").onchange = function () { LAB.ag.fecha = this.value; agLoad(); };
    var bAus = document.getElementById("lab-ag-ausencia");
    if (bAus) bAus.onclick = ausenciaModal;
    var bTr = document.getElementById("lab-ag-transf");
    if (bTr) bTr.onclick = transferirModal;
    document.getElementById("lab-ag-hoy").onclick = function () { LAB.ag.fecha = hoyISO(); viewAgenda(c); };
    document.getElementById("lab-ag-prev").onclick = function () { LAB.ag.fecha = shiftDia(LAB.ag.fecha, -1); viewAgenda(c); };
    document.getElementById("lab-ag-next").onclick = function () { LAB.ag.fecha = shiftDia(LAB.ag.fecha, 1); viewAgenda(c); };

    renderCalendario();
    if (LAB.ag.profesionalId) agLoad();
    else document.getElementById("lab-ag-grid").innerHTML = '<div class="lab-muted" style="padding:24px">No hay profesionales cargados. Andá a <b>Profesionales</b> y creá uno con sus horarios.</div>';
  }

  function shiftDia(iso, delta) {
    var d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + delta);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  function shiftMes(iso, delta) {
    var d = new Date(iso + "T00:00:00"); d.setMonth(d.getMonth() + delta); d.setDate(1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
  }
  function renderCalendario() {
    var box = document.getElementById("lab-ag-cal"); if (!box) return;
    var d = new Date(LAB.ag.fecha + "T00:00:00");
    var y = d.getFullYear(), mo = d.getMonth();
    var startDow = new Date(y, mo, 1).getDay();
    var days = new Date(y, mo + 1, 0).getDate();
    var hoy = hoyISO();
    var html = '<div class="lab-cal-head"><button class="lab-btn ghost xs" id="cal-prev">‹</button>' +
      "<b>" + MESES[mo] + " " + y + "</b><button class=\"lab-btn ghost xs\" id=\"cal-next\">›</button></div><div class=\"lab-cal-grid\">";
    ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"].forEach(function (w) { html += '<span class="lab-cal-w">' + w + "</span>"; });
    for (var i = 0; i < startDow; i++) html += "<span></span>";
    for (var dd = 1; dd <= days; dd++) {
      var iso = y + "-" + String(mo + 1).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
      html += '<button class="lab-cal-d' + (iso === LAB.ag.fecha ? " sel" : "") + (iso === hoy ? " hoy" : "") + '" data-iso="' + iso + '">' + dd + '<i class="lab-cal-dot" data-iso="' + iso + '"></i></button>';
    }
    box.innerHTML = html + "</div>";
    box.querySelector("#cal-prev").onclick = function () { LAB.ag.fecha = shiftMes(LAB.ag.fecha, -1); viewAgenda(document.getElementById("lab-content")); };
    box.querySelector("#cal-next").onclick = function () { LAB.ag.fecha = shiftMes(LAB.ag.fecha, 1); viewAgenda(document.getElementById("lab-content")); };
    box.querySelectorAll(".lab-cal-d").forEach(function (b) {
      b.onclick = function () {
        LAB.ag.fecha = b.getAttribute("data-iso");
        var di = document.getElementById("lab-ag-date"); if (di) di.value = LAB.ag.fecha;
        box.querySelectorAll(".lab-cal-d.sel").forEach(function (x) { x.classList.remove("sel"); });
        b.classList.add("sel");
        agLoad();
      };
    });
    if (LAB.ag.profesionalId) cargarPuntosMes(y, mo);
  }
  async function cargarPuntosMes(y, mo) {
    var desde = y + "-" + String(mo + 1).padStart(2, "0") + "-01";
    var hasta = y + "-" + String(mo + 1).padStart(2, "0") + "-" + String(new Date(y, mo + 1, 0).getDate()).padStart(2, "0");
    var r = await api("/api/lab/turnos?profesionalId=" + encodeURIComponent(LAB.ag.profesionalId) + "&desde=" + desde + "&hasta=" + hasta);
    var cont = {};
    ((r.data && r.data.items) || []).forEach(function (t) { cont[t.fecha] = (cont[t.fecha] || 0) + 1; });
    document.querySelectorAll(".lab-cal-dot").forEach(function (dot) {
      if (cont[dot.getAttribute("data-iso")]) dot.classList.add("on");
    });
  }

  function fechaCorta(f) { var x = String(f || "").split("-"); return x.length === 3 ? x[2] + "/" + x[1] : f; }
  // Vacaciones, congresos, feriados: los dias en los que no se dan turnos. Sin esto,
  // la agenda ofrece horarios de un dia que el profesional no esta, y el turno se da.
  function ausenciaModal() {
    var m = modal("No atender estos días");
    var profOpts = '<option value="">Todo el centro (feriado)</option>' + LAB.cat.profesionales.map(function (o) {
      return '<option value="' + o.id + '"' + (o.id === LAB.ag.profesionalId ? " selected" : "") + ">" + esc(o.nombre) + "</option>";
    }).join("");
    m.body.innerHTML =
      '<div class="lab-form"><div class="lab-grid3">' +
        "<label>Quién<select class=\"lab-in\" id=\"bq-prof\">" + profOpts + "</select></label>" +
        '<label>Desde<input class="lab-in" type="date" id="bq-desde" value="' + esc(LAB.ag.fecha) + '"></label>' +
        '<label>Hasta<input class="lab-in" type="date" id="bq-hasta" value="' + esc(LAB.ag.fecha) + '"></label>' +
      "</div>" +
      '<label>Motivo<input class="lab-in" id="bq-motivo" placeholder="Vacaciones, congreso, feriado…"></label>' +
      '<div class="lab-modal-actions"><button class="lab-btn" id="bq-cancel">Cancelar</button><button class="lab-btn primary" id="bq-ok">Guardar</button></div></div>';
    m.body.querySelector("#bq-cancel").onclick = labClose;
    m.body.querySelector("#bq-ok").onclick = async function () {
      var r = await api("/api/lab/bloqueos", {
        profesionalId: m.body.querySelector("#bq-prof").value,
        desde: m.body.querySelector("#bq-desde").value,
        hasta: m.body.querySelector("#bq-hasta").value,
        motivo: m.body.querySelector("#bq-motivo").value,
      });
      if (!r.ok) { toast((r.data && r.data.error) || "No se pudo guardar.", true); return; }
      labClose();
      // Los turnos ya dados no se tocan solos: se avisa para que alguien decida.
      var ya = r.data.turnosEnElRango || 0;
      toast(ya ? "Guardado. Ojo: hay " + ya + " turno(s) ya dado(s) en esos días" : "Guardado ✓", !!ya);
      agLoad();
    };
  }
  // Transferir la agenda: el profesional no viene y otro lo reemplaza. Los pacientes
  // conservan su horario; lo unico que cambia es quien los atiende.
  function transferirModal() {
    if (!LAB.ag.profesionalId) { toast("Elegí primero el profesional que no va a atender.", true); return; }
    var m = modal("Transferir agenda");
    var otros = (LAB.cat.profesionales || []).filter(function (o) { return o.id !== LAB.ag.profesionalId; });
    if (!otros.length) { m.body.innerHTML = '<div class="lab-muted">No hay otro profesional cargado al que pasarle los turnos.</div>'; return; }
    m.body.innerHTML =
      '<div class="lab-form">' +
      '<div class="lab-muted" style="margin-bottom:10px">Los turnos de <b>' + esc(nombreProf(LAB.ag.profesionalId)) +
      "</b> pasan a otro profesional. Los pacientes conservan su día y su horario.</div>" +
      '<div class="lab-grid3">' +
        '<label>Pasan a<select class="lab-in" id="tr-a">' + otros.map(function (o) {
          return '<option value="' + o.id + '">' + esc(o.nombre) + "</option>";
        }).join("") + "</select></label>" +
        '<label>Desde<input class="lab-in" type="date" id="tr-desde" value="' + esc(LAB.ag.fecha) + '"></label>' +
        '<label>Hasta<input class="lab-in" type="date" id="tr-hasta" value="' + esc(LAB.ag.fecha) + '"></label>' +
      "</div>" +
      '<div class="lab-modal-actions"><button class="lab-btn" id="tr-cancel">Cancelar</button><button class="lab-btn primary" id="tr-ok">Transferir</button></div></div>';
    m.body.querySelector("#tr-cancel").onclick = labClose;
    m.body.querySelector("#tr-ok").onclick = async function () {
      var r = await api("/api/lab/turnos/transferir", {
        deProfesionalId: LAB.ag.profesionalId,
        aProfesionalId: m.body.querySelector("#tr-a").value,
        desde: m.body.querySelector("#tr-desde").value,
        hasta: m.body.querySelector("#tr-hasta").value,
      });
      if (!r.ok) { toast((r.data && r.data.error) || "No se pudo transferir.", true); return; }
      labClose();
      var d = r.data;
      toast(d.movidos + " turno(s) transferido(s) ✓");
      if ((d.chocaron || []).length) {
        // Los que chocaron NO se movieron: hay que decir cuales, no un numero.
        alert("Estos no se pudieron pasar porque el otro profesional ya tenía un turno a esa hora:\n\n" +
          d.chocaron.map(function (x) {
            return "· " + x.fecha.split("-").reverse().join("/") + " " + x.hora + " — " + (x.paciente || "") +
              " (ya estaba " + (x.contra || "otro paciente") + ")";
          }).join("\n") + "\n\nQuedaron con el profesional original.");
      }
      agLoad();
    };
  }
  async function agLoad() {
    var grid = document.getElementById("lab-ag-grid");
    var info = document.getElementById("lab-ag-info");
    if (!grid) return;
    grid.innerHTML = '<div class="lab-muted" style="padding:20px">Cargando…</div>';
    var r = await api("/api/lab/turnos?profesionalId=" + encodeURIComponent(LAB.ag.profesionalId) + "&fecha=" + encodeURIComponent(LAB.ag.fecha));
    if (!r.ok) { grid.innerHTML = '<div class="lab-muted" style="padding:20px">' + esc((r.data && r.data.error) || "No se pudo cargar la agenda.") + "</div>"; return; }
    var d = new Date(LAB.ag.fecha + "T00:00:00");
    if (info) info.innerHTML = "<b>" + DOW[d.getDay()] + "</b> " + LAB.ag.fecha.split("-").reverse().join("/") +
      " · " + esc(r.data.profesional.nombre) + (r.data.profesional.consultorioId ? " · " + esc(nombreCons(r.data.profesional.consultorioId)) : "") +
      " · <b>" + r.data.cantidad + "</b> turno" + (r.data.cantidad === 1 ? "" : "s");
    var av = document.getElementById("lab-ag-bloqueo");
    if (av) {
      var b = r.data.bloqueo;
      av.innerHTML = b
        ? '<div class="lab-bloqueo">\u26d4 <b>No se atiende este día</b>' +
            (b.motivo ? " \u00b7 " + esc(b.motivo) : "") +
            ' <span class="lab-muted">(' + esc(fechaCorta(b.desde)) + (b.hasta !== b.desde ? " al " + esc(fechaCorta(b.hasta)) : "") + ")</span>" +
            ' <button class="lab-btn xs ghost" type="button" id="ag-desbloquear">Quitar</button></div>'
        : "";
      var qb = document.getElementById("ag-desbloquear");
      if (qb) qb.onclick = async function () {
        if (!confirm("¿Volver a atender esos días?")) return;
        var rr = await req("DELETE", "/api/lab/bloqueos/" + r.data.bloqueo.id);
        if (!rr.ok) { toast("No se pudo quitar.", true); return; }
        toast("Listo, vuelve a atender ✓"); agLoad();
      };
    }
    agRender(grid, r.data.slots || []);
  }

  function agRender(grid, slots) {
    if (!slots.length) {
      grid.innerHTML = '<div class="lab-muted" style="padding:24px">El profesional no atiende este día (sin horarios cargados para ' + DOW[new Date(LAB.ag.fecha + "T00:00:00").getDay()] + "). Podés cargar un turno igual con <b>+ Sobreturno</b>.</div>" +
        '<div style="padding:0 16px 16px"><button class="lab-btn" id="lab-sobre">+ Sobreturno</button></div>';
      var sb = document.getElementById("lab-sobre"); if (sb) sb.onclick = function () { bookModal(""); };
      return;
    }
    var rows = slots.map(function (s) {
      if (s.turno) {
        var est = ESTADOS[s.turno.estado] || ESTADOS.dado;
        return '<div class="lab-slot ocupado" data-id="' + s.turno.id + '" style="border-left-color:' + est.color + '">' +
          '<div class="lab-slot-h">' + esc(s.hora) + (s.sobreturno ? ' <span class="lab-badge">sobre</span>' : "") + "</div>" +
          '<div class="lab-slot-main"><b>' + esc(s.turno.pacienteNombre || "—") + "</b>" +
            '<span class="lab-slot-sub">' + [esc(s.turno.obraSocial), esc(s.turno.motivo)].filter(Boolean).join(" · ") + "</span></div>" +
          '<div class="lab-slot-est"><span class="lab-pill" style="background:' + est.color + '">' + esc(est.label) + "</span></div>" +
          "</div>";
      }
      return '<div class="lab-slot libre" data-hora="' + esc(s.hora) + '">' +
        '<div class="lab-slot-h">' + esc(s.hora) + "</div>" +
        '<div class="lab-slot-main lab-muted">Libre</div>' +
        '<div class="lab-slot-est"><span class="lab-btn xs">Dar turno</span></div>' +
        "</div>";
    }).join("");
    grid.innerHTML = '<div class="lab-slots">' + rows + "</div>";
    grid.querySelectorAll(".lab-slot.libre").forEach(function (el) {
      el.onclick = function () { bookModal(el.getAttribute("data-hora")); };
    });
    grid.querySelectorAll(".lab-slot.ocupado").forEach(function (el) {
      el.onclick = function () { turnoModal(el.getAttribute("data-id")); };
    });
  }

  // Opciones de practica para el turno. Vacio = no se eligio ninguna y el importe
  // queda a mano, que es como venia funcionando.
  function opcionesPracticas(sel) {
    return '<option value="">— Sin práctica —</option>' + (LAB.cat.practicas || [])
      .filter(function (x) { return x.activo !== false; })
      .map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === sel ? " selected" : "") + ">" + esc(x.nombre) + "</option>";
      }).join("");
  }
  // Al elegir practica u obra social, el importe sale del valor cargado. Si esa obra
  // social todavia no tiene valor para esa practica NO se pone cero: se deja lo que
  // haya y se avisa, porque un cero cobrado es peor que un campo vacio.
  function aplicarValorPractica(cont, idPractica, idOS, idImporte) {
    var selP = cont.querySelector(idPractica), selO = cont.querySelector(idOS), inp = cont.querySelector(idImporte);
    if (!selP || !inp) return;
    function recalcular(porMano) {
      var pracId = selP.value;
      if (!pracId) return;
      var os = selO ? selO.value : "";
      var v = valorPractica(pracId, os);
      if (v) { inp.value = v; return; }
      var pr = (LAB.cat.practicas || []).find(function (x) { return x.id === pracId; });
      if (porMano) {
        toast((os || "Esa obra social") + " todavía no tiene valor cargado para " + ((pr && pr.nombre) || "esa práctica") + ".", true);
      }
    }
    selP.onchange = function () {
      recalcular(true);
      // La preparacion se dice EN EL MOSTRADOR, cuando se da el turno. Despues va
      // tambien en el recordatorio, pero el paciente ya se fue.
      var pr = (LAB.cat.practicas || []).find(function (x) { return x.id === selP.value; });
      var caja = cont.querySelector("#prep-aviso");
      if (caja) caja.innerHTML = (pr && pr.preparacion)
        ? '<div class="lab-prep">\u26a0\ufe0f <b>Decile al paciente:</b> ' + esc(pr.preparacion) + "</div>" : "";
    };
    if (selO) selO.addEventListener("change", function () { recalcular(true); });
  }

  // Reservar turno en un horario (o sobreturno si hora vacía).
  function bookModal(hora) {
    var m = modal("Dar turno · " + (hora || "sobreturno"));
    var profActual = LAB.cat.profesionales.find(function (x) { return x.id === LAB.ag.profesionalId; });
    var valorDef = (profActual && profActual.valorConsulta) || 0;
    var osOpts = '<option value="">— Obra social —</option>' + LAB.cat.obrasSociales.map(function (o) { return "<option>" + esc(o.nombre) + "</option>"; }).join("");
    m.body.innerHTML =
      '<div class="lab-form">' +
        '<label>Buscar paciente<input class="lab-in" id="bk-buscar" placeholder="Apellido, documento o celular…" autocomplete="off"></label>' +
        '<div id="bk-res" class="lab-res"></div>' +
        '<div class="lab-grid2">' +
          '<label>Paciente / Nombre<input class="lab-in" id="bk-nombre" placeholder="Apellido, Nombre"></label>' +
          '<label>Documento<input class="lab-in" id="bk-doc"></label>' +
          '<label>Obra social<select class="lab-in" id="bk-os">' + osOpts + "</select></label>" +
          '<label>N° afiliado<input class="lab-in" id="bk-afil"></label>' +
          '<label>Celular<input class="lab-in" id="bk-cel"></label>' +
          '<label>' + (hora ? "Horario" : "Horario (sobreturno)") + '<input class="lab-in" id="bk-hora" value="' + esc(hora) + '" placeholder="HH:MM"></label>' +
          '<label>Práctica<select class="lab-in" id="bk-prac">' + opcionesPracticas("") + "</select></label>" +
          '<label>Importe consulta<input class="lab-in" id="bk-importe" type="number" min="0" step="100" value="' + valorDef + '" placeholder="0"></label>' +
        "</div>" +
        '<div id="prep-aviso"></div>' +
        '<label>Motivo<input class="lab-in" id="bk-motivo" placeholder="Consulta, control, estudio…"></label>' +
      "</div>" +
      '<div class="lab-modal-actions"><button class="lab-btn ghost" id="bk-cancel">Cancelar</button><button class="lab-btn primary" id="bk-ok">Dar turno</button></div>';
    var selPacId = "";
    aplicarValorPractica(m.body, "#bk-prac", "#bk-os", "#bk-importe");
    var buscar = m.body.querySelector("#bk-buscar");
    var res = m.body.querySelector("#bk-res");
    var timer = null;
    buscar.oninput = function () {
      clearTimeout(timer); var q = this.value.trim();
      if (q.length < 2) { res.innerHTML = ""; return; }
      timer = setTimeout(async function () {
        var r = await api("/api/lab/pacientes?q=" + encodeURIComponent(q));
        var items = (r.data && r.data.items) || [];
        res.innerHTML = items.length ? items.map(function (p) {
          return '<div class="lab-res-item" data-id="' + p.id + '"><b>' + esc([p.apellido, p.nombre].filter(Boolean).join(", ")) + "</b> " +
            '<span class="lab-muted">' + esc(p.documento || "") + (p.obraSocial ? " · " + esc(p.obraSocial) : "") + "</span></div>";
        }).join("") : '<div class="lab-muted" style="padding:6px 8px">Sin resultados. Completá los datos abajo para dar el turno igual.</div>';
        res.querySelectorAll(".lab-res-item").forEach(function (it) {
          it.onclick = function () {
            var p = items.find(function (x) { return x.id === it.getAttribute("data-id"); });
            selPacId = p.id;
            m.body.querySelector("#bk-nombre").value = [p.apellido, p.nombre].filter(Boolean).join(", ");
            m.body.querySelector("#bk-doc").value = p.documento || "";
            m.body.querySelector("#bk-os").value = p.obraSocial || "";
            m.body.querySelector("#bk-afil").value = p.nroAfiliado || "";
            m.body.querySelector("#bk-cel").value = p.celular || "";
            res.innerHTML = "";
            buscar.value = [p.apellido, p.nombre].filter(Boolean).join(", ");
            // El paciente trae SU obra social: si ya habia una practica elegida, el
            // importe tiene que recalcularse con el valor de esa obra social.
            m.body.querySelector("#bk-os").dispatchEvent(new Event("change"));
          };
        });
      }, 250);
    };
    m.body.querySelector("#bk-cancel").onclick = labClose;
    m.body.querySelector("#bk-ok").onclick = async function () {
      var hh = m.body.querySelector("#bk-hora").value.trim();
      var nombre = m.body.querySelector("#bk-nombre").value.trim();
      if (!hh || !nombre) { toast("Falta el horario y el nombre.", true); return; }
      this.disabled = true;
      var payload = {
        profesionalId: LAB.ag.profesionalId, especialidadId: LAB.ag.especialidadId, fecha: LAB.ag.fecha,
        hora: hh, pacienteId: selPacId, pacienteNombre: nombre,
        documento: m.body.querySelector("#bk-doc").value, obraSocial: m.body.querySelector("#bk-os").value,
        nroAfiliado: m.body.querySelector("#bk-afil").value, celular: m.body.querySelector("#bk-cel").value,
        motivo: m.body.querySelector("#bk-motivo").value, importe: m.body.querySelector("#bk-importe").value, permitirSobreturno: !hora,
        practicaId: m.body.querySelector("#bk-prac").value,
        practicaNombre: (m.body.querySelector("#bk-prac").selectedOptions[0] || {}).text || "",
      };
      var r = await api("/api/lab/turnos", payload);
      if (!r.ok) { toast((r.data && r.data.error) || "No se pudo dar el turno.", true); this.disabled = false; return; }
      labClose(); toast("Turno dado ✓"); agLoad();
    };
    setTimeout(function () { buscar.focus(); }, 50);
  }

  // Detalle de un turno: cambiar estado / editar / cancelar.
  // Alta de un estudio. Mismo camino desde la historia clinica y desde el turno:
  // primero la ficha (JSON) y despues el archivo (multipart), que no entra en el JSON.
  async function guardarEstudio(pacienteId, datos, file) {
    var r = await api("/api/lab/pacientes/" + pacienteId + "/estudios", datos);
    if (!r.ok) return { ok: false, error: (r.data && r.data.error) || "No se pudo guardar." };
    if (file) {
      var fd = new FormData(); fd.append("file", file);
      var sube = await fetch(conCentro("/api/lab/estudios/" + r.data.item.id + "/archivo"), { method: "POST", body: fd });
      if (!sube.ok) {
        var d = await sube.json().catch(function () { return {}; });
        return { ok: true, item: r.data.item, aviso: d.error || "El estudio se guardó, pero el archivo no subió." };
      }
    }
    return { ok: true, item: r.data.item };
  }
  function opcionesTipos(sel) {
    return LAB_TIPOS.map(function (t) {
      return '<option value="' + t.cod + '"' + (t.cod === sel ? " selected" : "") + ">" + esc(t.nombre) + "</option>";
    }).join("");
  }
  // El formulario corto, para cargar el estudio sin salir del turno.
  async function estudioDeTurno(t, onSaved) {
    if (!LAB_TIPOS.length) {
      var rt = await api("/api/lab/pacientes/" + t.pacienteId + "/estudios");
      LAB_TIPOS = (rt.data && rt.data.tipos) || [];
    }
    var m = modal("Cargar estudio · " + (t.pacienteNombre || ""));
    m.body.innerHTML =
      '<div class="lab-form"><div class="lab-grid2">' +
        '<label>Fecha<input class="lab-in" type="date" id="et-fecha" value="' + esc(t.fecha || hoyISO()) + '"></label>' +
        '<label>Tipo<select class="lab-in" id="et-tipo">' + opcionesTipos("") + "</select></label>" +
      "</div>" +
      '<label>Informe<textarea class="lab-in" id="et-texto" rows="4" placeholder="El texto del informe (o dejalo vacío y adjuntá el archivo)…"></textarea></label>' +
      '<label>Archivo (PDF o imagen)<input class="lab-in" type="file" id="et-file" accept=".pdf,.jpg,.jpeg,.png"></label>' +
      '<div class="lab-modal-actions"><button class="lab-btn" id="et-cancel">Cancelar</button><button class="lab-btn primary" id="et-ok">Guardar estudio</button></div></div>';
    m.body.querySelector("#et-cancel").onclick = labClose;
    m.body.querySelector("#et-ok").onclick = async function () {
      var file = m.body.querySelector("#et-file").files[0];
      var texto = m.body.querySelector("#et-texto").value.trim();
      if (!file && !texto) { toast("Adjuntá el archivo o escribí el informe.", true); return; }
      var r = await guardarEstudio(t.pacienteId, {
        fecha: m.body.querySelector("#et-fecha").value,
        tipo: m.body.querySelector("#et-tipo").value,
        profesionalId: t.profesionalId || LAB.ag.profesionalId,
        turnoId: t.id, texto: texto,
      }, file);
      if (!r.ok) { toast(r.error, true); return; }
      labClose();
      toast(r.aviso || "Estudio cargado \u2713", !!r.aviso);
      if (onSaved) onSaved();
    };
  }
  async function turnoModal(id) {
    var grid = document.getElementById("lab-ag-grid");
    var el = grid && grid.querySelector('.lab-slot[data-id="' + id + '"]');
    // Traemos el turno del último render pidiendo la agenda de nuevo sería caro;
    // usamos lo que está en el DOM + un PUT directo por estado.
    var m = modal("Turno");
    m.body.innerHTML = '<div class="lab-muted">Cargando…</div>';
    var r = await api("/api/lab/turnos?profesionalId=" + encodeURIComponent(LAB.ag.profesionalId) + "&fecha=" + encodeURIComponent(LAB.ag.fecha));
    var slot = ((r.data && r.data.slots) || []).find(function (s) { return s.turno && s.turno.id === id; });
    var t = slot && slot.turno;
    if (!t) { m.body.innerHTML = '<div class="lab-muted">No se encontró el turno.</div>'; return; }
    m.body.innerHTML =
      '<div class="lab-turno-det">' +
        "<div><b>" + esc(t.hora) + "</b> · " + esc(t.pacienteNombre || "—") + "</div>" +
        '<div class="lab-muted">' + [esc(t.documento), esc(t.obraSocial), esc(t.practicaNombre), esc(t.motivo)].filter(Boolean).join(" · ") + "</div>" +
        (t.online ? '<div class="lab-online-tag">\U0001f310 Lo pidió el paciente por internet</div>' : "") +
        (t.preparacion ? '<div class="lab-prep">\u26a0\ufe0f <b>Preparación:</b> ' + esc(t.preparacion) + "</div>" : "") +
      "</div>" +
      '<div class="lab-sec-tit">Estado</div>' +
      '<div class="lab-estados">' + Object.keys(ESTADOS).filter(function (k) { return k !== "cancelado"; }).map(function (k) {
        return '<button class="lab-est-btn' + (t.estado === k ? " on" : "") + '" data-est="' + k + '" style="--c:' + ESTADOS[k].color + '">' + esc(ESTADOS[k].label) + "</button>";
      }).join("") + "</div>" +
      '<div class="lab-sec-tit">Cobro</div>' +
      '<label>Práctica<select class="lab-in" id="tn-prac"><option value="">— sin práctica —</option>' +
        (LAB.cat.practicas || []).map(function (pr) {
          return '<option value="' + pr.id + '"' + (pr.id === t.practicaId ? " selected" : "") + ">" + esc(pr.nombre) + "</option>";
        }).join("") + '</select></label>' +
      '<div class="lab-muted" id="tn-prac-aviso" style="margin:-4px 0 8px"></div>' +
      '<div class="lab-grid3">' +
        '<label>Práctica<select class="lab-in" id="tn-prac">' + opcionesPracticas(t.practicaId || "") + "</select></label>" +
        '<label>Obra social<input class="lab-in" id="tn-os" value="' + esc(t.obraSocial || "") + '" readonly></label>' +
        '<label>Importe<input class="lab-in" id="tn-imp" type="number" min="0" step="100" value="' + (t.importe || 0) + '"></label>' +
        '<label>Seña<input class="lab-in" id="tn-sena" type="number" min="0" step="100" value="' + (t.sena || 0) + '"></label>' +
        '<label>Insumos<input class="lab-in" id="tn-ins" type="number" min="0" step="100" value="' + (t.insumos || 0) + '"></label>' +
        '<label>Medio<select class="lab-in" id="tn-medio"><option value="">—</option>' + ["Efectivo", "Débito", "Crédito", "Transferencia", "Mercado Pago"].map(function (x) { return "<option" + (t.medioPago === x ? " selected" : "") + ">" + x + "</option>"; }).join("") + "</select></label>" +
        '<label class="lab-chk"><input type="checkbox" id="tn-pag"' + (t.pagado ? " checked" : "") + "> Cobrado</label>" +
      "</div>" +
      '<div class="lab-sec-tit">Historia cl\u00ednica</div><div id="tn-estudios"><div class="lab-muted">Cargando\u2026</div></div>' +
      '<div class="lab-modal-actions"><button class="lab-btn ghost danger" id="tn-cancel">Cancelar turno</button><button class="lab-btn primary" id="tn-guardar">Guardar cobro</button></div>';
    // Los estudios de ESTE turno, con el boton para cargar uno nuevo. Cargarlo
    // aca —con el paciente, la fecha y el profesional ya puestos— es lo que hace
    // que la historia clinica se llene mientras se atiende y no despues.
    async function estudiosDelTurno() {
      var box = m.body.querySelector("#tn-estudios");
      if (!box) return;
      if (!t.pacienteId) { box.innerHTML = '<div class="lab-muted">Este turno no está atado a una ficha de paciente, así que no se le puede cargar un estudio.</div>'; return; }
      var r = await api("/api/lab/pacientes/" + t.pacienteId + "/estudios");
      if (r.ok && r.data && r.data.tipos) LAB_TIPOS = r.data.tipos;
      var mios = ((r.data && r.data.items) || []).filter(function (x) { return x.turnoId === t.id; });
      box.innerHTML = (mios.length ? mios.map(function (x) {
        return '<div class="lab-hc-item es"><div class="lab-hc-meta"><span class="lab-hc-tipo">' + esc(x.tipo) + "</span> " + esc(x.tipoNombre || "") + "</div>" +
          (x.archivo ? '<div class="lab-hc-archline"><a class="lab-hc-arch" href="' + conCentro("/api/lab/estudios/" + x.id + "/archivo") + '" target="_blank" rel="noopener">\ud83d\udcce ' + esc(x.archivo.nombre) + "</a></div>" : "") + "</div>";
      }).join("") : '<div class="lab-muted">Sin estudios cargados en este turno.</div>')
        + '<div style="margin-top:8px"><button class="lab-btn" id="tn-estudio-new" type="button">+ Cargar estudio</button></div>';
      var b = box.querySelector("#tn-estudio-new");
      if (b) b.onclick = function () { estudioDeTurno(t, function () { turnoModal(id); }); };
    }
    estudiosDelTurno();
    aplicarValorPractica(m.body, "#tn-prac", "#tn-os", "#tn-imp");
    m.body.querySelectorAll(".lab-est-btn").forEach(function (b) {
      b.onclick = async function () {
        var est = b.getAttribute("data-est");
        var rr = await req("PUT", "/api/lab/turnos/" + id, { estado: est });
        if (!rr.ok) { toast("No se pudo cambiar el estado.", true); return; }
        m.body.querySelectorAll(".lab-est-btn").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on"); t.estado = est; toast("Estado: " + ESTADOS[est].label); agLoad();
      };
    });
    // Elegir la practica completa el importe con lo que paga la obra social del
    // paciente. Si esa obra social todavia no tiene valor cargado, se dice — poner
    // $0 seria peor: alguien lo cobra asi y nadie se entera.
    var selPrac = m.body.querySelector("#tn-prac");
    var avisoPrac = m.body.querySelector("#tn-prac-aviso");
    function pintarAvisoPractica(autocompletar) {
      var pid = selPrac.value;
      if (!pid) { avisoPrac.textContent = ""; return; }
      var v = valorPractica(pid, t.obraSocial);
      if (v) {
        avisoPrac.textContent = (t.obraSocial || "Particular") + " paga " + fmt$(v) + " por esta práctica.";
        if (autocompletar) m.body.querySelector("#tn-imp").value = v;
      } else {
        avisoPrac.textContent = "Todavía no hay valor cargado de " + (t.obraSocial || "esa obra social") + " para esta práctica: poné el importe a mano.";
      }
    }
    selPrac.onchange = function () { pintarAvisoPractica(true); };
    pintarAvisoPractica(false);
    m.body.querySelector("#tn-guardar").onclick = async function () {
      var rr = await req("PUT", "/api/lab/turnos/" + id, {
        importe: m.body.querySelector("#tn-imp").value, sena: m.body.querySelector("#tn-sena").value,
        insumos: m.body.querySelector("#tn-ins").value, medioPago: m.body.querySelector("#tn-medio").value,
        pagado: m.body.querySelector("#tn-pag").checked,
        practicaId: m.body.querySelector("#tn-prac").value,
        practicaNombre: (m.body.querySelector("#tn-prac").selectedOptions[0] || {}).text || "",
        practicaId: selPrac.value,
        practicaNombre: selPrac.value ? (selPrac.options[selPrac.selectedIndex] || {}).text : "",
      });
      if (!rr.ok) { toast("No se pudo guardar.", true); return; }
      labClose(); toast("Cobro guardado ✓"); agLoad();
    };
    m.body.querySelector("#tn-cancel").onclick = async function () {
      if (!confirm("¿Cancelar este turno?")) return;
      var rr = await req("DELETE", "/api/lab/turnos/" + id);
      if (!rr.ok) { toast("No se pudo cancelar.", true); return; }
      labClose(); toast("Turno cancelado"); agLoad();
    };
  }

  /* ========================== LIQUIDACION =============================== */
  // Cuanto le toca a cada profesional en el mes. Se calcula al vuelo cada vez: guardar
  // el numero lo dejaria viejo apenas alguien corrige un cobro.
  async function viewLiquidacion(c) {
    if (!LAB.liqPeriodo) LAB.liqPeriodo = hoyISO().slice(0, 7);
    c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">Cargando…</div></div>';
    var r = await api("/api/lab/liquidacion?periodo=" + encodeURIComponent(LAB.liqPeriodo));
    if (!r.ok) { c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">' + esc((r.data && r.data.error) || "No se pudo cargar.") + "</div></div>"; return; }
    var d = r.data, items = d.items || [];
    function contratoTxt(x) {
      if (!x.contrato) return '<span class="lab-muted">sin contrato</span>';
      return x.contrato.tipo === "porcentaje"
        ? x.contrato.valor + "% de lo " + esc(x.contrato.sobre)
        : fmt$(x.contrato.valor) + " por paciente";
    }
    c.innerHTML = '<div class="lab-card">' +
      '<div class="lab-list-head"><h3>Liquidación</h3>' +
        '<input class="lab-in" type="month" id="liq-periodo" value="' + esc(LAB.liqPeriodo) + '" style="width:170px"></div>' +
      (d.sinContrato
        ? '<div class="lab-aviso">' + d.sinContrato + " profesional(es) sin contrato cargado: no se les puede calcular nada. " +
          "Se carga en su ficha, en <b>Cómo se le paga</b>.</div>"
        : "") +
      '<table class="lab-table"><thead><tr><th>Profesional</th><th>Contrato</th><th class="num">Atendidos</th>' +
        '<th class="num">Facturado</th><th class="num">Cobrado</th><th class="num">Le toca</th><th></th></tr></thead><tbody>' +
      (items.length ? items.map(function (x) {
        return '<tr data-id="' + esc(x.profesionalId) + '"><td><b>' + esc(x.profesional) + "</b></td>" +
          "<td>" + contratoTxt(x) + '</td><td class="num">' + x.atendidos + '</td>' +
          '<td class="num">' + fmt$(x.facturado) + '</td><td class="num">' + fmt$(x.cobrado) + "</td>" +
          '<td class="num"><b>' + (x.aPagar === null ? '<span class="lab-muted">—</span>' : fmt$(x.aPagar)) + "</b></td>" +
          '<td style="text-align:right"><button class="lab-btn xs" data-det="1" type="button">Detalle</button></td></tr>';
      }).join("") : '<tr><td colspan="7" class="lab-muted">No hay movimiento ese mes.</td></tr>') +
      "</tbody>" +
      (d.total ? '<tfoot><tr><td colspan="5" style="text-align:right"><b>Total a pagar</b></td><td class="num"><b>' + fmt$(d.total) + "</b></td><td></td></tr></tfoot>" : "") +
      "</table></div>";
    c.querySelector("#liq-periodo").onchange = function () { LAB.liqPeriodo = this.value; viewLiquidacion(c); };
    c.querySelectorAll("[data-det]").forEach(function (b) {
      b.onclick = function () {
        var id = b.closest("tr").getAttribute("data-id");
        liquidacionDetalle(id, items.filter(function (x) { return x.profesionalId === id; })[0]);
      };
    });
  }
  async function liquidacionDetalle(id, resumen) {
    var m = modal("Liquidación · " + ((resumen && resumen.profesional) || ""), { ancho: "ancho" });
    m.body.innerHTML = '<div class="lab-muted">Cargando…</div>';
    var r = await api("/api/lab/liquidacion/" + id + "?periodo=" + encodeURIComponent(LAB.liqPeriodo));
    if (!r.ok) { m.body.innerHTML = '<div class="lab-muted">' + esc((r.data && r.data.error) || "No se pudo cargar.") + "</div>"; return; }
    var items = r.data.items || [];
    m.body.innerHTML =
      '<div class="lab-sala-kpis">' +
        '<div class="lab-sala-kpi"><b>' + items.length + "</b><span>pacientes</span></div>" +
        '<div class="lab-sala-kpi"><b>' + fmt$(resumen ? resumen.facturado : 0) + "</b><span>facturado</span></div>" +
        '<div class="lab-sala-kpi verde"><b>' + fmt$(resumen ? resumen.cobrado : 0) + "</b><span>cobrado</span></div>" +
        '<div class="lab-sala-kpi"><b>' + (resumen && resumen.aPagar !== null ? fmt$(resumen.aPagar) : "—") + "</b><span>le toca</span></div>" +
      "</div>" +
      (items.length
        ? '<table class="lab-table"><thead><tr><th>Fecha</th><th>Paciente</th><th>Obra social</th><th>Práctica</th><th class="num">Facturado</th><th class="num">Cobrado</th></tr></thead><tbody>' +
          items.map(function (x) {
            return "<tr><td>" + esc(x.fecha.split("-").reverse().join("/")) + " " + esc(x.hora) + "</td>" +
              "<td>" + esc(x.paciente || "") + "</td><td>" + esc(x.obraSocial || "") + "</td><td>" + esc(x.practica || "") + "</td>" +
              '<td class="num">' + fmt$(x.importe) + '</td><td class="num">' + fmt$(x.cobrado) + "</td></tr>";
          }).join("") + "</tbody></table>"
        : '<div class="lab-muted">Sin pacientes atendidos ese mes.</div>') +
      '<div class="lab-modal-actions"><button class="lab-btn" id="liq-print" type="button">Imprimir</button>' +
      '<button class="lab-btn primary" id="liq-cerrar" type="button">Cerrar</button></div>';
    m.body.querySelector("#liq-cerrar").onclick = labClose;
    m.body.querySelector("#liq-print").onclick = function () {
      var w = window.open("", "_blank");
      if (!w) { toast("Permití las ventanas emergentes para imprimir.", true); return; }
      w.document.write('<html><head><meta charset="utf-8"><title>Liquidación</title>' +
        "<style>body{font-family:system-ui,Arial,sans-serif;padding:26px;color:#111}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}" +
        "td,th{padding:6px 5px;border-bottom:1px solid #ddd;text-align:left}.num{text-align:right}h1{font-size:19px;margin:0}</style></head><body>" +
        "<h1>Liquidación · " + esc((resumen && resumen.profesional) || "") + "</h1>" +
        "<div>" + esc(LAB.liqPeriodo) + " · " + items.length + " paciente(s) · Le toca: " +
        (resumen && resumen.aPagar !== null ? fmt$(resumen.aPagar) : "—") + "</div>" +
        (m.body.querySelector("table") ? m.body.querySelector("table").outerHTML : "") +
        "</body></html>");
      w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 300);
    };
  }

  /* ========================== REPROGRAMAR =============================== */
  // Los turnos que quedaron adentro de un dia anulado. Antes se avisaba "hay 3 turnos
  // dados" y ahi terminaba: alguien tenia que acordarse de llamarlos. Esto es la cola
  // de trabajo, con el horario nuevo a un clic y el mensaje para avisarle al paciente.
  async function viewReprogramar(c) {
    c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">Cargando…</div></div>';
    var r = await api("/api/lab/reprogramar");
    if (!r.ok) { c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">' + esc((r.data && r.data.error) || "No se pudo cargar.") + "</div></div>"; return; }
    var items = (r.data && r.data.items) || [];
    if (!items.length) {
      c.innerHTML = '<div class="lab-card"><div class="lab-list-head"><h3>Reprogramar</h3></div>' +
        '<div class="lab-muted">No hay turnos para reprogramar. Acá van a aparecer los que queden adentro de un día que se anuló.</div></div>';
      return;
    }
    c.innerHTML = '<div class="lab-card">' +
      '<div class="lab-list-head"><h3>Reprogramar</h3><div class="lab-muted">' + items.length + " turno(s) sin fecha nueva</div></div>" +
      '<div class="lab-muted" style="margin-bottom:12px">Quedaron adentro de un día que se anuló. Buscales horario, avisales, y salen de esta lista.</div>' +
      items.map(function (t) {
        return '<div class="lab-repro" data-id="' + esc(t.id) + '">' +
          '<div class="lab-repro-cab"><div><b>' + esc(t.paciente || "—") + "</b>" +
            '<div class="lab-muted">' + esc(String(t.fecha || "").split("-").reverse().join("/")) + " " + esc(t.hora) +
            " · " + esc(t.profesional || "") + (t.practicaNombre ? " · " + esc(t.practicaNombre) : "") +
            (t.celular ? " · " + esc(t.celular) : " · <i>sin celular</i>") + "</div>" +
            (t.motivo ? '<div class="lab-muted">Motivo: ' + esc(t.motivo) + "</div>" : "") + "</div>" +
            '<div><button class="lab-btn xs" data-buscar="1" type="button">Buscar horario</button> ' +
            '<button class="lab-btn xs ghost" data-sacar="1" type="button" title="Ya lo arreglaste por otro lado">Sacar de la lista</button></div>' +
          "</div><div class=\"lab-repro-libres\"></div></div>";
      }).join("") + "</div>";

    c.querySelectorAll(".lab-repro").forEach(function (caja) {
      var id = caja.getAttribute("data-id");
      var t = items.filter(function (x) { return x.id === id; })[0];
      caja.querySelector("[data-sacar]").onclick = async function () {
        if (!confirm("¿Sacarlo de la lista sin moverlo?")) return;
        var rr = await api("/api/lab/turnos/" + id + "/sin-reprogramar", {});
        if (!rr.ok) { toast((rr.data && rr.data.error) || "No se pudo.", true); return; }
        toast("Listo ✓"); viewReprogramar(c);
      };
      caja.querySelector("[data-buscar]").onclick = async function () {
        var box = caja.querySelector(".lab-repro-libres");
        box.innerHTML = '<div class="lab-muted">Buscando horarios…</div>';
        var rr = await api("/api/lab/reprogramar/libres?profesionalId=" + encodeURIComponent(t.profesionalId));
        var dias = (rr.data && rr.data.dias) || [];
        if (!dias.length) { box.innerHTML = '<div class="lab-muted">No quedan horarios libres en los próximos días. Probá con otro profesional desde la agenda.</div>'; return; }
        box.innerHTML = dias.map(function (d) {
          return '<div class="lab-repro-dia"><span class="lab-repro-fecha">' + esc(d.fecha.split("-").reverse().join("/")) + "</span>" +
            d.horarios.map(function (h) {
              return '<button class="lab-btn xs" type="button" data-f="' + esc(d.fecha) + '" data-h="' + esc(h) + '">' + esc(h) + "</button>";
            }).join(" ") + "</div>";
        }).join("");
        box.querySelectorAll("[data-f]").forEach(function (b) {
          b.onclick = async function () {
            var mover = await api("/api/lab/turnos/" + id + "/mover", { fecha: b.dataset.f, hora: b.dataset.h });
            if (!mover.ok) { toast((mover.data && mover.data.error) || "No se pudo mover.", true); return; }
            var nueva = b.dataset.f.split("-").reverse().join("/") + " a las " + b.dataset.h;
            toast("Turno movido al " + nueva + " ✓");
            // El mensaje para avisarle: el turno se movio porque lo movimos nosotros,
            // asi que el aviso no es optativo.
            if (t.whatsapp) {
              var texto = "Hola " + String(t.paciente || "").split(",")[0].trim() + ", tuvimos que cambiar su turno con " +
                (t.profesional || "el profesional") + ". Queda para el " + nueva + ". Si no le sirve, avisenos. Disculpe las molestias.";
              window.open(t.whatsapp + "?text=" + encodeURIComponent(texto), "_blank", "noopener");
            }
            viewReprogramar(c);
          };
        });
      };
    });
  }

  /* ========================= RECORDATORIOS ============================== */
  // A quien hay que avisarle el turno, con el mensaje ya escrito. El envio NO es
  // automatico a proposito: mandar por WhatsApp de verdad pide una cuenta de empresa
  // aprobada y se paga por mensaje. Esto anda hoy y hace lo que de verdad cuesta:
  // saber a quien, con que texto, y no repetirle al que ya se le aviso.
  function manana() {
    var d = new Date(); d.setDate(d.getDate() + 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  async function viewRecordatorios(c) {
    if (!LAB.recFecha) LAB.recFecha = manana();
    async function pintar() {
      c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">Cargando…</div></div>';
      var r = await api("/api/lab/recordatorios?fecha=" + encodeURIComponent(LAB.recFecha));
      if (!r.ok) { c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">' + esc((r.data && r.data.error) || "No se pudo cargar.") + "</div></div>"; return; }
      var d = r.data || {}, t = d.totales || {};
      var filas = (d.items || []).map(function (x) {
        var acc = x.avisadoEl
          ? '<span class="lab-rec-ok">avisado</span> <button class="lab-btn xs ghost" data-des="' + x.id + '" type="button">deshacer</button>'
          : (x.whatsapp
              ? '<a class="lab-btn xs primary" href="' + x.whatsapp + "?text=" + encodeURIComponent(x.mensaje) + '" target="_blank" rel="noopener" data-av="' + x.id + '">WhatsApp</a>'
              : '<span class="lab-muted">sin celular</span>')
            + ' <button class="lab-btn xs" data-mark="' + x.id + '" type="button">Marcar avisado</button>';
        return "<tr" + (x.avisadoEl ? ' class="lab-rec-hecho"' : "") + "><td><b>" + esc(x.hora) + "</b></td>" +
          "<td>" + esc(x.paciente || "—") + '<div class="lab-muted">' + esc(x.profesional || "") + "</div></td>" +
          "<td>" + (x.telefonoOk ? esc(x.celular) : '<span class="lab-muted">' + esc(x.celular || "—") + "</span>") + "</td>" +
          '<td class="lab-rec-msg">' + esc(x.mensaje) + "</td>" +
          '<td style="white-space:nowrap;text-align:right">' + acc + "</td></tr>";
      }).join("");
      c.innerHTML = '<div class="lab-card">' +
        '<div class="lab-list-head"><h3>Recordatorios</h3>' +
          '<div class="lab-inline"><input class="lab-in" type="date" id="rec-fecha" value="' + esc(LAB.recFecha) + '">' +
          '<button class="lab-btn" id="rec-manana" type="button">Mañana</button>' +
          (labPuede("config") ? '<button class="lab-btn" id="rec-texto" type="button">Texto del mensaje</button>' : "") + "</div></div>" +
        '<div class="lab-muted" style="margin-bottom:10px">Los turnos del día que todavía no se atendieron. ' +
        "El mensaje se abre en tu WhatsApp con el texto puesto; al volver, marcalo como avisado.</div>" +
        '<div class="lab-sala-kpis">' +
          '<div class="lab-sala-kpi"><b>' + (t.turnos || 0) + "</b><span>por avisar</span></div>" +
          '<div class="lab-sala-kpi verde"><b>' + (t.avisados || 0) + "</b><span>avisados</span></div>" +
          '<div class="lab-sala-kpi roja"><b>' + (t.sinTelefono || 0) + "</b><span>sin celular</span></div>" +
        "</div>" +
        (filas ? '<table class="lab-table"><thead><tr><th>Hora</th><th>Paciente</th><th>Celular</th><th>Mensaje</th><th></th></tr></thead><tbody>' + filas + "</tbody></table>"
               : '<div class="lab-muted" style="padding:14px">No hay turnos para avisar ese día.</div>') +
        "</div>";
      c.querySelector("#rec-fecha").onchange = function () { LAB.recFecha = this.value; pintar(); };
      c.querySelector("#rec-manana").onclick = function () { LAB.recFecha = manana(); pintar(); };
      var bt = c.querySelector("#rec-texto");
      if (bt) bt.onclick = function () { textoRecordatorioModal(d.plantilla, pintar); };
      async function marcar(id, avisado) {
        var rr = await api("/api/lab/turnos/" + id + "/aviso", { avisado: avisado });
        if (!rr.ok) { toast("No se pudo marcar.", true); return; }
        pintar();
      }
      c.querySelectorAll("[data-mark]").forEach(function (b) { b.onclick = function () { marcar(b.dataset.mark, true); }; });
      c.querySelectorAll("[data-des]").forEach(function (b) { b.onclick = function () { marcar(b.dataset.des, false); }; });
      // Abrir el WhatsApp ya cuenta como aviso: si no, hay que acordarse de marcarlo
      // y a la segunda vuelta nadie lo hace.
      c.querySelectorAll("[data-av]").forEach(function (a) {
        a.onclick = function () { setTimeout(function () { marcar(a.dataset.av, true); }, 400); };
      });
    }
    await pintar();
  }
  function textoRecordatorioModal(plantilla, luego) {
    var m = modal("Texto del recordatorio", { ancho: "ancho" });
    m.body.innerHTML =
      '<div class="lab-form">' +
      '<div class="lab-muted" style="margin-bottom:8px">Lo que va entre llaves se reemplaza con los datos del turno: ' +
      "<b>{paciente}</b>, <b>{fecha}</b>, <b>{hora}</b>, <b>{profesional}</b>, <b>{practica}</b>, <b>{centro}</b>, <b>{direccion}</b>.</div>" +
      '<label>Mensaje<textarea class="lab-in" id="rt-txt" rows="4">' + esc(plantilla || "") + "</textarea></label>" +
      '<div class="lab-grid2">' +
        '<label>Nombre del centro<input class="lab-in" id="rt-centro" placeholder="Como lo firma el mensaje"></label>' +
        '<label>Dirección<input class="lab-in" id="rt-dir" placeholder="Opcional"></label>' +
      "</div>" +
      '<div class="lab-modal-actions"><button class="lab-btn" id="rt-cancel">Cancelar</button><button class="lab-btn primary" id="rt-ok">Guardar</button></div></div>';
    api("/api/lab/config").then(function (r) {
      var cfg = (r.data && r.data.config) || {};
      m.body.querySelector("#rt-centro").value = cfg.centroNombre || "";
      m.body.querySelector("#rt-dir").value = cfg.centroDireccion || "";
    });
    m.body.querySelector("#rt-cancel").onclick = labClose;
    m.body.querySelector("#rt-ok").onclick = async function () {
      var rr = await api("/api/lab/config", {
        plantillaRecordatorio: m.body.querySelector("#rt-txt").value,
        centroNombre: m.body.querySelector("#rt-centro").value,
        centroDireccion: m.body.querySelector("#rt-dir").value,
      });
      if (!rr.ok) { toast((rr.data && rr.data.error) || "No se pudo guardar.", true); return; }
      labClose(); toast("Texto guardado ✓"); if (luego) luego();
    };
  }

  /* ============================== INICIO ================================ */
  // Arriba lo de HOY, que es lo unico sobre lo que se puede hacer algo ahora; abajo
  // los indicadores del mes. Los numeros y sus definiciones estan tomados de lo que
  // el centro ya mira en Global App —ausentismo sobre turnos transcurridos, pacientes
  // nuevos sobre unicos del mes— para que den lo mismo y se puedan comparar.
  async function viewInicio(c) {
    c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">Cargando…</div></div>';
    if (!LAB.inicioPeriodo) LAB.inicioPeriodo = hoyISO().slice(0, 7);
    var r = await api("/api/lab/inicio?periodo=" + encodeURIComponent(LAB.inicioPeriodo));
    if (!r.ok) { c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">' + esc((r.data && r.data.error) || "No se pudo cargar.") + "</div></div>"; return; }
    var d = r.data, h = d.hoyResumen || {}, ci = d.citas || {}, pa = d.pacientes || {}, pl = d.plata || {};
    function kpi(valor, rotulo, clase) {
      return '<div class="lab-sala-kpi' + (clase ? " " + clase : "") + '"><b>' + valor + "</b><span>" + esc(rotulo) + "</span></div>";
    }
    function tabla(titulo, filas, rotulo) {
      if (!filas.length) return "";
      return '<div class="lab-card"><div class="lab-sec-tit" style="margin-top:0">' + esc(titulo) + "</div>" +
        '<table class="lab-table"><thead><tr><th>' + esc(rotulo) + '</th><th class="num">Turnos</th><th class="num">Atendidos</th><th class="num">Ausentismo</th></tr></thead><tbody>' +
        filas.map(function (g) {
          var pct = g.turnos ? Math.round((g.ausentes / g.turnos) * 1000) / 10 : 0;
          return "<tr><td>" + esc(g.nombre) + '</td><td class="num">' + g.turnos + '</td><td class="num">' + g.atendidos +
            '</td><td class="num"' + (pct >= 20 ? ' style="color:#b91c1c;font-weight:700"' : "") + ">" + pct + "%</td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    var avisar = (d.manana || {}).sinAvisar || 0;
    c.innerHTML =
      '<div class="lab-card">' +
        '<div class="lab-list-head"><h3>Hoy</h3><div class="lab-muted">' + esc(String(d.hoy || "").split("-").reverse().join("/")) + "</div></div>" +
        '<div class="lab-sala-kpis">' +
          kpi(h.turnos || 0, "turnos") + kpi(h.esperando || 0, "esperando", "amar") +
          kpi(h.atendidos || 0, "atendidos", "verde") + kpi(h.ausentes || 0, "ausentes", "roja") +
          kpi(fmt$(h.porCobrar || 0), "falta cobrar") +
        "</div>" +
        (avisar
          ? '<div class="lab-aviso">\u2709\ufe0f Hay <b>' + avisar + "</b> turno(s) de mañana sin avisar. " +
            '<button class="lab-btn xs" type="button" id="ini-rec">Ir a recordatorios</button></div>'
          : "") +
      "</div>" +
      '<div class="lab-card">' +
        '<div class="lab-list-head"><h3>El mes</h3>' +
          '<input class="lab-in" type="month" id="ini-periodo" value="' + esc(LAB.inicioPeriodo) + '" style="width:170px"></div>' +
        '<div class="lab-sec-tit" style="margin-top:0">Turnos</div>' +
        '<div class="lab-sala-kpis">' +
          kpi(ci.total || 0, "total") + kpi(ci.atendidos || 0, "atendidos", "verde") +
          kpi(ci.ausentes || 0, "ausentes", "roja") + kpi((ci.ausentismo || 0) + "%", "ausentismo", (ci.ausentismo || 0) >= 20 ? "roja" : "") +
        "</div>" +
        '<div class="lab-sec-tit">Pacientes</div>' +
        '<div class="lab-sala-kpis">' +
          kpi(pa.atendidos || 0, "atendidos") + kpi(pa.nuevos || 0, "nuevos") +
          kpi((pa.nuevosPct || 0) + "%", "son nuevos") + kpi((Math.round((100 - (pa.nuevosPct || 0)) * 10) / 10) + "%", "vuelven") +
        "</div>" +
        '<div class="lab-sec-tit">Plata</div>' +
        '<div class="lab-sala-kpis">' +
          kpi(fmt$(pl.facturado || 0), "facturado") + kpi(fmt$(pl.cobrado || 0), "cobrado", "verde") +
          kpi(fmt$(pl.porCobrar || 0), "por cobrar", (pl.porCobrar || 0) > 0 ? "roja" : "") +
        "</div>" +
        '<div class="lab-muted" style="font-size:11.5px;margin-top:6px">El ausentismo se mide sobre los turnos que ya pasaron, no sobre todo el mes. ' +
        "Un paciente que vino tres veces cuenta una.</div>" +
      "</div>" +
      tabla("Por obra social", d.porObraSocial || [], "Obra social") +
      tabla("Por profesional", d.porProfesional || [], "Profesional") +
      tabla("Prácticas más hechas", d.porPractica || [], "Práctica") +
      // Rendimiento: cuanto se aprovecha la agenda que se ofrece. Sin horarios
      // cargados NO es cero: es que no se puede calcular, y decir cero seria mentir.
      ((d.rendimiento || []).length
        ? '<div class="lab-card"><div class="lab-sec-tit" style="margin-top:0">Rendimiento por especialidad</div>' +
          '<table class="lab-table"><thead><tr><th>Especialidad</th><th class="num">Pacientes</th><th class="num">Turnos</th><th class="num">Hs. de agenda</th><th class="num">Turnos/hora</th></tr></thead><tbody>' +
          d.rendimiento.map(function (g) {
            return "<tr><td>" + esc(g.nombre) + '</td><td class="num">' + g.pacientes + '</td><td class="num">' + g.turnos +
              '</td><td class="num">' + g.horas + '</td><td class="num">' +
              (g.turnosHora === null ? '<span class="lab-muted" title="No hay horarios cargados">—</span>' : g.turnosHora) + "</td></tr>";
          }).join("") + "</tbody></table>" +
          '<div class="lab-muted" style="font-size:11.5px;margin-top:6px">Horas ofrecidas según los horarios de cada profesional, hasta el ' +
          esc(String(d.agendaHasta || "").split("-").reverse().join("/")) + ". Los días anulados no cuentan como horas ofrecidas.</div></div>"
        : "") +
      // Pacientes por sexo y edad: barras hechas con divs, sin traer una libreria de
      // graficos para cinco tramos.
      ((d.porSexoEdad && d.porSexoEdad.unicos)
        ? (function () {
            var sx = d.porSexoEdad;
            var maxi = Math.max.apply(null, sx.tramos.map(function (_, i) {
              return (sx.femenino[i] || 0) + (sx.masculino[i] || 0) + (sx.sinSexo[i] || 0);
            }).concat([1]));
            return '<div class="lab-card"><div class="lab-sec-tit" style="margin-top:0">Pacientes por sexo y edad</div>' +
              '<div class="lab-muted" style="margin-bottom:10px"><b>' + sx.unicos + "</b> paciente(s) único(s) con turno en el mes" +
              (sx.sinFecha ? " · " + sx.sinFecha + " sin fecha de nacimiento cargada" : "") + "</div>" +
              '<div class="lab-edades">' + sx.tramos.map(function (t, i) {
                var fe = sx.femenino[i] || 0, ma = sx.masculino[i] || 0, si = sx.sinSexo[i] || 0;
                var tot = fe + ma + si;
                return '<div class="lab-edad"><div class="lab-edad-barras">' +
                  '<div class="lab-edad-b f" style="height:' + Math.round((fe / maxi) * 100) + '%" title="' + fe + ' femenino"></div>' +
                  '<div class="lab-edad-b m" style="height:' + Math.round((ma / maxi) * 100) + '%" title="' + ma + ' masculino"></div>' +
                  (si ? '<div class="lab-edad-b s" style="height:' + Math.round((si / maxi) * 100) + '%" title="' + si + ' sin sexo cargado"></div>' : "") +
                  "</div><div class=\"lab-edad-rot\">" + esc(t) + '</div><div class="lab-edad-tot">' + tot + "</div></div>";
              }).join("") + "</div>" +
              '<div class="lab-edad-ref"><span class="lab-edad-b f"></span> Femenino <span class="lab-edad-b m"></span> Masculino' +
              (sx.sinSexo.some(function (x) { return x; }) ? ' <span class="lab-edad-b s"></span> Sin cargar' : "") + "</div></div>";
          })()
        : "") +
      ((d.cancelaciones || []).length
        ? '<div class="lab-card"><div class="lab-sec-tit" style="margin-top:0">Agenda anulada</div>' +
          '<table class="lab-table"><thead><tr><th>Profesional</th><th class="num">Días</th><th class="num">Hs. perdidas</th><th>Motivo</th></tr></thead><tbody>' +
          d.cancelaciones.map(function (g) {
            return "<tr><td>" + esc(g.nombre) + '</td><td class="num">' + g.dias + '</td><td class="num">' + g.horas +
              '</td><td class="lab-muted">' + esc(g.motivo || "") + "</td></tr>";
          }).join("") + "</tbody></table></div>"
        : "");
    var ip = c.querySelector("#ini-periodo");
    if (ip) ip.onchange = function () { LAB.inicioPeriodo = this.value; viewInicio(c); };
    var ir = c.querySelector("#ini-rec");
    if (ir) ir.onclick = function () { labGo("recordatorios"); };
  }

  /* ========================== SALA DE ESPERA ============================ */
  // El dia entero, todos los profesionales al lado del otro. Es la pantalla que la
  // recepcion tiene abierta todo el tiempo: quien llego, a quien le toca y quien
  // esta esperando hace rato. Se refresca sola.
  var SALA_TIMER = null;
  function salaHoraMin(h) {
    var m = String(h || "").match(/^(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  }
  async function viewSala(c) {
    clearInterval(SALA_TIMER);
    if (!LAB.salaFecha) LAB.salaFecha = hoyISO();
    async function pintar() {
      var r = await api("/api/lab/sala?fecha=" + encodeURIComponent(LAB.salaFecha));
      if (!r.ok) { c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">' + esc((r.data && r.data.error) || "No se pudo cargar.") + "</div></div>"; return; }
      var d = r.data || {};
      var t = d.totales || {};
      var ahora = new Date();
      var minAhora = ahora.getHours() * 60 + ahora.getMinutes();
      var esHoy = LAB.salaFecha === hoyISO();
      var cols = (d.profesionales || []).map(function (pr) {
        var filas = pr.turnos.map(function (tu) {
          var est = ESTADOS[tu.estado] || ESTADOS.dado;
          // Cuanto hace que espera: el dato que la recepcion no tiene en ningun lado
          // y es el que genera el reclamo en el mostrador.
          var espera = "";
          if (esHoy && tu.estado === "esperando") {
            var m0 = salaHoraMin(tu.hora);
            if (m0 !== null && minAhora > m0) espera = '<span class="lab-sala-espera">+' + (minAhora - m0) + " min</span>";
          }
          return '<button class="lab-sala-turno" type="button" data-id="' + tu.id + '" style="--c:' + est.color + '">' +
            '<span class="lab-sala-hora">' + esc(tu.hora) + "</span>" +
            '<span class="lab-sala-pac">' + esc(tu.pacienteNombre || "—") +
            (tu.practicaNombre ? '<span class="lab-sala-sub">' + esc(tu.practicaNombre) + "</span>" : "") + "</span>" +
            '<span class="lab-sala-est">' + esc(est.label) + espera + "</span></button>";
        }).join("");
        return '<div class="lab-sala-col"><div class="lab-sala-cab"><b>' + esc(pr.nombre) + "</b>" +
          '<div class="lab-muted">' + esc([pr.especialidad, pr.consultorio].filter(Boolean).join(" · ")) + "</div></div>" +
          filas + "</div>";
      }).join("");
      c.innerHTML =
        '<div class="lab-card">' +
          '<div class="lab-list-head"><h3>Sala de espera</h3>' +
            '<div class="lab-inline"><input class="lab-in" type="date" id="sala-fecha" value="' + esc(LAB.salaFecha) + '">' +
            '<button class="lab-btn" id="sala-hoy" type="button">Hoy</button></div></div>' +
          '<div class="lab-sala-kpis">' +
            '<div class="lab-sala-kpi"><b>' + (t.turnos || 0) + "</b><span>turnos</span></div>" +
            '<div class="lab-sala-kpi amar"><b>' + (t.esperando || 0) + "</b><span>esperando</span></div>" +
            '<div class="lab-sala-kpi verde"><b>' + (t.atendidos || 0) + "</b><span>atendidos</span></div>" +
            '<div class="lab-sala-kpi roja"><b>' + (t.ausentes || 0) + "</b><span>ausentes</span></div>" +
            '<div class="lab-sala-kpi"><b>' + (t.porVenir || 0) + "</b><span>por venir</span></div>" +
          "</div>" +
          (cols ? '<div class="lab-sala-grid">' + cols + "</div>"
                : '<div class="lab-muted" style="padding:14px">No hay turnos ese día.</div>') +
        "</div>";
      c.querySelector("#sala-fecha").onchange = function () { LAB.salaFecha = this.value; pintar(); };
      c.querySelector("#sala-hoy").onclick = function () { LAB.salaFecha = hoyISO(); pintar(); };
      // Un clic sobre el turno cambia el estado sin salir de la pantalla: es lo que
      // se hace cien veces por dia.
      c.querySelectorAll(".lab-sala-turno").forEach(function (b) {
        b.onclick = function () { salaEstadoModal(b.getAttribute("data-id"), pintar); };
      });
    }
    await pintar();
    // En vivo: la recepcion la deja abierta y el estado lo cambia otro.
    SALA_TIMER = setInterval(function () {
      if (LAB.modulo !== "sala") { clearInterval(SALA_TIMER); return; }
      pintar();
    }, 30000);
  }
  function salaEstadoModal(id, luego) {
    var m = modal("Estado del turno");
    m.body.innerHTML = '<div class="lab-estados">' + Object.keys(ESTADOS).filter(function (k) { return k !== "cancelado"; }).map(function (k) {
      return '<button class="lab-est-btn" data-est="' + k + '" style="--c:' + ESTADOS[k].color + '">' + esc(ESTADOS[k].label) + "</button>";
    }).join("") + "</div>";
    m.body.querySelectorAll(".lab-est-btn").forEach(function (b) {
      b.onclick = async function () {
        var rr = await req("PUT", "/api/lab/turnos/" + id, { estado: b.getAttribute("data-est") });
        if (!rr.ok) { toast("No se pudo cambiar el estado.", true); return; }
        labClose(); toast("Estado: " + ESTADOS[b.getAttribute("data-est")].label);
        if (luego) luego();
      };
    });
  }

  /* ========================== TURNOS ONLINE ============================= */
  // El centro publica su agenda: el paciente entra por un link y saca el turno solo.
  // Apagado hasta que lo prendan a proposito.
  async function viewOnline(c) {
    c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">Cargando…</div></div>';
    var r = await api("/api/lab/config");
    var cfg = (r.data && r.data.config) || {};
    var on = cfg.online || {};
    var link = location.origin + "/turnos/" + (LAB.centro || "");
    c.innerHTML = '<div class="lab-card">' +
      '<div class="lab-list-head"><h3>Turnos online</h3></div>' +
      '<div class="lab-muted" style="margin-bottom:12px">El paciente entra por un link, elige especialidad y horario, y el turno cae en la agenda. ' +
      "Queda marcado como pedido por internet, para que lo revisen antes de darlo por bueno.</div>" +
      '<label class="lab-chk" style="margin-bottom:12px"><input type="checkbox" id="on-activo"' + (on.activo ? " checked" : "") + "> Tomar turnos por internet</label>" +
      '<div class="lab-grid2">' +
        '<label>Con cuánta anticipación se puede pedir<input class="lab-in" type="number" min="1" max="120" id="on-dias" value="' + (on.dias || 30) + '"> <span class="lab-muted">días</span></label>' +
        '<label>Mensaje para el paciente<input class="lab-in" id="on-msg" value="' + esc(on.mensaje || "") + '" placeholder="Traé tu credencial y el documento"></label>' +
      "</div>" +
      '<div class="lab-modal-actions" style="justify-content:flex-start"><button class="lab-btn primary" id="on-ok" type="button">Guardar</button></div>' +
      '<div class="lab-sec-tit">El link para compartir</div>' +
      '<div class="lab-link"><code id="on-link">' + esc(link) + "</code>" +
      '<button class="lab-btn xs" id="on-copiar" type="button">Copiar</button>' +
      '<a class="lab-btn xs" href="' + esc(link) + '" target="_blank" rel="noopener">Ver cómo lo ve el paciente</a></div>' +
      '<div class="lab-muted" style="font-size:11.5px;margin-top:8px">Ese link va en el WhatsApp del centro, en Instagram o en la puerta con un QR. ' +
      "No pide usuario: cualquiera con el link puede pedir un turno, y por eso solo se muestran los horarios libres, nunca los datos de otros pacientes.</div>" +
      "</div>";
    c.querySelector("#on-ok").onclick = async function () {
      var rr = await api("/api/lab/config", {
        online: {
          activo: c.querySelector("#on-activo").checked,
          dias: c.querySelector("#on-dias").value,
          mensaje: c.querySelector("#on-msg").value,
        },
      });
      if (!rr.ok) { toast((rr.data && rr.data.error) || "No se pudo guardar.", true); return; }
      toast(c.querySelector("#on-activo").checked ? "Turnos online prendidos ✓" : "Turnos online apagados ✓");
    };
    c.querySelector("#on-copiar").onclick = function () {
      navigator.clipboard.writeText(link).then(function () { toast("Link copiado ✓"); },
        function () { toast("Copialo a mano.", true); });
    };
  }

  /* ============================ USUARIOS ================================ */
  // Quien del centro entra y a que. El puesto tilda un conjunto de permisos y despues
  // el centro agrega o saca lo que quiera: cada centro se organiza distinto y un rol
  // cerrado obliga a inventar puestos que no existen.
  var LAB_PUESTOS = {
    recepcionista: "Recepcionista",
    cajero: "Cajero",
    profesional: "Profesional",
    coordinador: "Coordinador",
  };
  async function viewUsuarios(c) {
    c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">Cargando…</div></div>';
    var r = await api("/api/lab/usuarios");
    if (!r.ok) {
      c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">' + esc((r.data && r.data.error) || "No se pudo cargar.") + "</div></div>";
      return;
    }
    var items = (r.data && r.data.items) || [];
    var catalogo = (r.data && r.data.catalogo) || [];
    var plantillas = (r.data && r.data.plantillas) || {};
    var filas = items.map(function (u) {
      if (u.esAdminNs) {
        return '<tr><td><b>' + esc(u.nombre) + '</b> <span class="lab-muted">' + esc(u.username) + "</span></td>" +
          '<td colspan="2" class="lab-muted">Administrador de NS: entra a todo el sistema.</td></tr>';
      }
      var puestos = Object.keys(LAB_PUESTOS).map(function (k) {
        return '<option value="' + k + '"' + (k === u.rol ? " selected" : "") + ">" + esc(LAB_PUESTOS[k]) + "</option>";
      }).join("");
      var tildes = catalogo.map(function (pm) {
        var on = (u.permisos || []).indexOf(pm.cod) >= 0;
        return '<label class="lab-perm"><input type="checkbox" data-perm="' + pm.cod + '"' + (on ? " checked" : "") + "> " + esc(pm.label) + "</label>";
      }).join("");
      return '<tr data-u="' + esc(u.username) + '"><td style="vertical-align:top"><b>' + esc(u.nombre) + "</b>" +
          '<div class="lab-muted">' + esc(u.username) + "</div>" +
          '<div style="margin-top:8px"><select class="lab-in us-rol"><option value="">— sin acceso —</option>' + puestos + "</select></div>" +
          '<div style="margin-top:6px" class="us-profwrap' + (u.rol === "profesional" ? "" : " oculto") + '">' +
            '<select class="lab-in us-prof"><option value="">— es el profesional… —</option>' +
            (LAB.cat.profesionales || []).map(function (o) {
              return '<option value="' + o.id + '"' + (o.id === u.profesionalId ? " selected" : "") + ">" + esc(o.nombre) + "</option>";
            }).join("") + "</select></div>" +
        "</td>" +
        '<td><div class="lab-perms">' + tildes + "</div></td>" +
        '<td style="width:110px;vertical-align:top"><button class="lab-btn xs us-save">Guardar</button></td></tr>';
    }).join("");
    c.innerHTML = '<div class="lab-card">' +
      '<div class="lab-list-head"><h3>Usuarios del centro</h3></div>' +
      '<div class="lab-muted" style="margin-bottom:10px">El puesto tilda lo que suele hacer cada uno; después agregá o sacá lo que quieras. ' +
      "Sin ningún permiso tildado, la persona no entra al sistema.</div>" +
      '<table class="lab-table"><thead><tr><th style="width:250px">Usuario y puesto</th><th>Qué puede hacer</th><th></th></tr></thead><tbody>' +
      (filas || '<tr><td colspan="3" class="lab-muted">No hay usuarios para dar de alta.</td></tr>') + "</tbody></table></div>";
    c.querySelectorAll("tr[data-u]").forEach(function (tr) {
      var selRol = tr.querySelector(".us-rol");
      var wrapProf = tr.querySelector(".us-profwrap");
      var tildes = tr.querySelectorAll("[data-perm]");
      selRol.onchange = function () {
        wrapProf.classList.toggle("oculto", selRol.value !== "profesional");
        // El puesto RE-tilda los permisos: es el punto de partida. Si despues el
        // centro los toca, lo que vale es lo que quedo tildado.
        var base = plantillas[selRol.value] || [];
        tildes.forEach(function (i) { i.checked = base.indexOf(i.getAttribute("data-perm")) >= 0; });
      };
      tr.querySelector(".us-save").onclick = async function () {
        var permisos = [];
        tildes.forEach(function (i) { if (i.checked) permisos.push(i.getAttribute("data-perm")); });
        var rr = await api("/api/lab/usuarios", {
          username: tr.getAttribute("data-u"), rol: selRol.value, permisos: permisos,
          profesionalId: selRol.value === "profesional" ? tr.querySelector(".us-prof").value : "",
        });
        if (!rr.ok) { toast((rr.data && rr.data.error) || "No se pudo guardar.", true); return; }
        toast(permisos.length ? "Permisos guardados ✓" : "Acceso quitado ✓");
      };
    });
  }

  /* ===================== OBRAS SOCIALES + SUS VALORES ==================== */
  // El catalogo de siempre, mas el boton que hacia falta: cargar los valores de esa
  // obra social para todas las practicas de una sola vez. Asi llegan —la obra social
  // manda su lista entera— y asi se actualizan, con un aumento en %.
  async function viewObrasSociales(c) {
    await viewCatalogo(c, "obrasSociales", "Obras Sociales");
    var tabla = c.querySelector(".lab-table tbody");
    if (!tabla) return;
    tabla.querySelectorAll("tr[data-id]").forEach(function (tr) {
      var celda = tr.lastElementChild;
      if (!celda) return;
      var b = document.createElement("button");
      b.className = "lab-btn xs";
      b.type = "button";
      b.textContent = "Valores";
      b.style.marginRight = "6px";
      b.onclick = function () {
        var os = (LAB.cat.obrasSociales || []).find(function (o) { return o.id === tr.getAttribute("data-id"); });
        if (os) valoresOsModal(os);
      };
      celda.insertBefore(b, celda.firstChild);
    });
  }
  async function valoresOsModal(os) {
    var m = modal("Valores de " + (os.nombre || ""), { ancho: "ancho" });
    m.body.innerHTML = '<div class="lab-muted">Cargando…</div>';
    var r = await api("/api/lab/practicas");
    LAB.cat.practicas = (r.data && r.data.items) || [];
    if (!LAB.cat.practicas.length) {
      m.body.innerHTML = '<div class="lab-muted">Todavía no hay prácticas cargadas. Cargalas en Configuración → Prácticas y después volvé a poner los valores.</div>';
      return;
    }
    m.body.innerHTML =
      '<div class="lab-muted" style="margin-bottom:10px">Lo que paga <b>' + esc(os.nombre) + '</b> por cada práctica. Dejá vacío lo que todavía no sepas.</div>' +
      '<table class="lab-table"><thead><tr><th>Práctica</th><th style="width:160px">Valor</th></tr></thead><tbody>' +
      LAB.cat.practicas.map(function (pr) {
        var v = (pr.valores || {})[os.id];
        return "<tr><td><b>" + esc(pr.nombre) + "</b>" + (pr.codigo ? ' <span class="lab-muted">' + esc(pr.codigo) + "</span>" : "") + "</td>" +
          '<td><input class="lab-in" type="number" min="0" step="100" data-prac="' + pr.id + '" value="' + (v || "") + '" placeholder="sin valor"></td></tr>';
      }).join("") + "</tbody></table>" +
      '<div class="lab-modal-actions" style="justify-content:space-between">' +
        '<div class="lab-inline"><input class="lab-in" id="vo-pct" type="number" step="0.5" placeholder="% aumento" style="width:120px">' +
        '<button class="lab-btn" id="vo-aumentar" type="button">Aplicar aumento</button></div>' +
        '<div class="lab-inline"><button class="lab-btn" id="vo-cancel" type="button">Cerrar</button>' +
        '<button class="lab-btn primary" id="vo-ok" type="button">Guardar valores</button></div></div>';
    m.body.querySelector("#vo-cancel").onclick = labClose;
    m.body.querySelector("#vo-ok").onclick = async function () {
      var valores = {};
      m.body.querySelectorAll("input[data-prac]").forEach(function (i) { valores[i.getAttribute("data-prac")] = i.value; });
      var rr = await api("/api/lab/practicas/valores", { obraSocialId: os.id, valores: valores });
      if (!rr.ok) { toast((rr.data && rr.data.error) || "No se pudo guardar.", true); return; }
      LAB.cat.practicas = (rr.data && rr.data.items) || LAB.cat.practicas;
      labClose();
      toast(rr.data.cargados + " valor(es) guardado(s) ✓");
    };
    m.body.querySelector("#vo-aumentar").onclick = async function () {
      var pct = parseFloat(m.body.querySelector("#vo-pct").value);
      if (!pct) { toast("Poné el porcentaje del aumento.", true); return; }
      if (!confirm("¿Aumentar " + pct + "% todos los valores cargados de " + os.nombre + "? Las prácticas sin valor no se tocan.")) return;
      var rr = await api("/api/lab/practicas/valores", { obraSocialId: os.id, aumentoPct: pct });
      if (!rr.ok) { toast((rr.data && rr.data.error) || "No se pudo aplicar.", true); return; }
      LAB.cat.practicas = (rr.data && rr.data.items) || LAB.cat.practicas;
      labClose(); toast("Aumento aplicado a " + rr.data.cargados + " práctica(s) ✓");
    };
  }

  /* ========================== PRACTICAS ================================= */
  // Las practicas del centro y lo que paga CADA obra social. El valor puede estar
  // vacio: recien se cargan los que se van sabiendo, y el turno tiene que poder
  // decir "todavia no hay valor" en vez de poner cero.
  async function viewPracticas(c) {
    c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">Cargando…</div></div>';
    var r = await api("/api/lab/practicas");
    LAB.cat.practicas = (r.data && r.data.items) || [];
    var oss = (LAB.cat.obrasSociales || []).filter(function (o) { return o.activo !== false; });
    var head = '<div class="lab-list-head"><h3>Prácticas</h3><button class="lab-btn primary" id="lab-prac-new">+ Nueva práctica</button></div>';
    if (!oss.length) {
      c.innerHTML = '<div class="lab-card">' + head + '<div class="lab-muted">Cargá primero las obras sociales: el valor de cada práctica se carga por obra social.</div></div>';
      c.querySelector("#lab-prac-new").onclick = function () { labGo("obrasSociales"); };
      return;
    }
    var cols = oss.map(function (o) { return "<th>" + esc(o.nombre) + "</th>"; }).join("");
    var rows = LAB.cat.practicas.map(function (pr) {
      var vals = oss.map(function (o) {
        var v = (pr.valores || {})[o.id];
        return "<td>" + (v ? fmt$(v) : '<span class="lab-muted">sin valor</span>') + "</td>";
      }).join("");
      return '<tr data-id="' + pr.id + '"><td><b>' + esc(pr.nombre) + "</b>" +
        (pr.codigo ? ' <span class="lab-muted">' + esc(pr.codigo) + "</span>" : "") +
        (pr.preparacion ? '<div class="lab-muted" title="Preparación">\u26a0\ufe0f ' + esc(pr.preparacion) + "</div>" : "") + "</td>" +
        "<td>" + esc(nombreEsp(pr.especialidadId)) + "</td>" + vals +
        '<td style="text-align:right"><button class="lab-btn xs" data-ed="1">Editar</button> ' +
        '<button class="lab-btn xs ghost danger" data-del="1">Borrar</button></td></tr>';
    }).join("");
    c.innerHTML = '<div class="lab-card">' + head +
      '<div style="overflow-x:auto"><table class="lab-table"><thead><tr><th>Práctica</th><th>Especialidad</th>' + cols + "<th></th></tr></thead>" +
      "<tbody>" + (rows || '<tr><td colspan="' + (oss.length + 3) + '" class="lab-muted">Todavía no hay prácticas cargadas.</td></tr>') + "</tbody></table></div></div>";
    c.querySelector("#lab-prac-new").onclick = function () { pracForm(null); };
    c.querySelectorAll("[data-ed]").forEach(function (b) {
      b.onclick = function () {
        var id = b.closest("tr").getAttribute("data-id");
        pracForm(LAB.cat.practicas.find(function (x) { return x.id === id; }));
      };
    });
    c.querySelectorAll("[data-del]").forEach(function (b) {
      b.onclick = async function () {
        if (!confirm("¿Borrar esta práctica? Los turnos que ya la usaron la siguen mostrando.")) return;
        var rr = await req("DELETE", "/api/lab/practicas/" + b.closest("tr").getAttribute("data-id"));
        if (!rr.ok) { toast("No se pudo borrar.", true); return; }
        toast("Práctica borrada ✓"); viewPracticas(c);
      };
    });
  }
  function pracForm(pr) {
    pr = pr || {};
    var m = modal(pr.id ? "Editar práctica" : "Nueva práctica", { ancho: "ancho" });
    var oss = (LAB.cat.obrasSociales || []).filter(function (o) { return o.activo !== false; });
    var espOpts = '<option value="">— Especialidad —</option>' + LAB.cat.especialidades.map(function (o) {
      return '<option value="' + o.id + '"' + (o.id === pr.especialidadId ? " selected" : "") + ">" + esc(o.nombre) + "</option>";
    }).join("");
    m.body.innerHTML =
      '<div class="lab-form"><div class="lab-grid3">' +
        '<label>Nombre<input class="lab-in" id="pr-nom" value="' + esc(pr.nombre || "") + '" placeholder="Consulta, ecografía…"></label>' +
        '<label>Código<input class="lab-in" id="pr-cod" value="' + esc(pr.codigo || "") + '" placeholder="interno o de nomenclador"></label>' +
        "<label>Especialidad<select class=\"lab-in\" id=\"pr-esp\">" + espOpts + "</select></label>" +
      "</div>" +
      '<label>Preparación <span class="lab-muted">(lo que el paciente tiene que hacer antes)</span><input class="lab-in" id="pr-prep" value="' + esc(pr.preparacion || "") + '" placeholder="Ayuno de 8 horas, venir con vejiga llena…"></label>' +
      '<div class="lab-sec-tit">Valor por obra social</div>' +
      '<div class="lab-muted" style="margin-bottom:8px">Dejá vacío el que no sepas todavía: el turno va a avisar que falta el valor en vez de poner $0.</div>' +
      '<div class="lab-grid3" id="pr-vals">' + oss.map(function (o) {
        var v = (pr.valores || {})[o.id];
        return "<label>" + esc(o.nombre) + '<input class="lab-in" type="number" min="0" step="100" data-os="' + o.id + '" value="' + (v || "") + '" placeholder="sin valor"></label>';
      }).join("") + "</div>" +
      '<div class="lab-modal-actions"><button class="lab-btn" id="pr-cancel">Cancelar</button><button class="lab-btn primary" id="pr-ok">Guardar</button></div></div>';
    m.body.querySelector("#pr-cancel").onclick = labClose;
    m.body.querySelector("#pr-ok").onclick = async function () {
      var valores = {};
      m.body.querySelectorAll("#pr-vals input").forEach(function (i) {
        if (String(i.value).trim() !== "") valores[i.getAttribute("data-os")] = i.value;
      });
      var datos = {
        nombre: m.body.querySelector("#pr-nom").value,
        codigo: m.body.querySelector("#pr-cod").value,
        especialidadId: m.body.querySelector("#pr-esp").value,
        preparacion: m.body.querySelector("#pr-prep").value,
        valores: valores,
      };
      var rr = pr.id ? await req("PUT", "/api/lab/practicas/" + pr.id, datos) : await api("/api/lab/practicas", datos);
      if (!rr.ok) { toast((rr.data && rr.data.error) || "No se pudo guardar.", true); return; }
      labClose(); toast("Práctica guardada ✓");
      var c = document.getElementById("lab-content");
      if (LAB.modulo === "practicas" && c) viewPracticas(c);
    };
  }
  // Que paga esta obra social por esta practica. La ficha del paciente guarda el
  // NOMBRE de la obra social y el catalogo tiene el id, asi que se resuelve por
  // nombre. Devuelve null cuando no hay valor cargado, que no es lo mismo que cero.
  function valorPractica(practicaId, nombreOS) {
    var pr = (LAB.cat.practicas || []).find(function (x) { return x.id === practicaId; });
    if (!pr) return null;
    var os = (LAB.cat.obrasSociales || []).find(function (o) {
      return String(o.nombre || "").trim().toUpperCase() === String(nombreOS || "").trim().toUpperCase();
    });
    if (!os) return null;
    var v = (pr.valores || {})[os.id];
    return v ? v : null;
  }

  /* ========================== PROFESIONALES ============================= */
  async function viewProfesionales(c) {
    c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">Cargando…</div></div>';
    var r = await api("/api/lab/profesionales");
    LAB.cat.profesionales = (r.data && r.data.items) || [];
    var head = '<div class="lab-list-head"><h3>Profesionales</h3><button class="lab-btn primary" id="lab-prof-new">+ Nuevo profesional</button></div>';
    var rows = LAB.cat.profesionales.map(function (p) {
      var dias = (p.horarios || []).map(function (h) { return DOW[h.dow].slice(0, 3) + " " + h.desde + "-" + h.hasta; }).join(" · ");
      return '<tr data-id="' + p.id + '"><td><b>' + esc(p.nombre) + "</b>" + (p.matricula ? ' <span class="lab-muted">Mat. ' + esc(p.matricula) + "</span>" : "") + "</td>" +
        "<td>" + esc(nombreEsp(p.especialidadId)) + "</td><td>" + esc(nombreCons(p.consultorioId)) + "</td>" +
        '<td class="lab-muted">' + esc(dias || "sin horarios") + "</td>" +
        '<td><button class="lab-btn xs ghost lab-prof-edit">Editar</button></td></tr>';
    }).join("");
    c.innerHTML = '<div class="lab-card">' + head +
      '<table class="lab-table"><thead><tr><th>Nombre</th><th>Especialidad</th><th>Consultorio</th><th>Horarios</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" class="lab-muted" style="padding:16px">Todavía no hay profesionales.</td></tr>') + "</tbody></table></div>";
    document.getElementById("lab-prof-new").onclick = function () { profForm(null); };
    c.querySelectorAll(".lab-prof-edit").forEach(function (b) {
      b.onclick = function () { profForm(LAB.cat.profesionales.find(function (x) { return x.id === b.closest("tr").getAttribute("data-id"); })); };
    });
  }

  function profForm(p) {
    p = p || {};
    var m = modal(p.id ? "Editar profesional" : "Nuevo profesional", { ancho: "ancho" });
    var espOpts = '<option value="">— Especialidad —</option>' + LAB.cat.especialidades.map(function (o) { return '<option value="' + o.id + '"' + (o.id === p.especialidadId ? " selected" : "") + ">" + esc(o.nombre) + "</option>"; }).join("");
    var consOpts = '<option value="">— Consultorio —</option>' + LAB.cat.consultorios.map(function (o) { return '<option value="' + o.id + '"' + (o.id === p.consultorioId ? " selected" : "") + ">" + esc(o.nombre) + "</option>"; }).join("");
    m.body.innerHTML =
      '<div class="lab-form">' +
        '<div class="lab-grid2">' +
          '<label>Nombre y apellido<input class="lab-in" id="pf-nombre" value="' + esc(p.nombre || "") + '"></label>' +
          '<label>Matrícula<input class="lab-in" id="pf-mat" value="' + esc(p.matricula || "") + '"></label>' +
          '<label>Especialidad<select class="lab-in" id="pf-esp">' + espOpts + "</select></label>" +
          '<label>Consultorio<select class="lab-in" id="pf-cons">' + consOpts + "</select></label>" +
          '<label>Valor consulta (particular)<input class="lab-in" id="pf-valor" type="number" min="0" step="100" value="' + (p.valorConsulta || 0) + '"></label>' +
        '<label>Cómo se le paga<select class="lab-in" id="pf-ctipo">' +
          '<option value="">— sin contrato —</option>' +
          '<option value="porcentaje"' + ((p.contrato || {}).tipo === "porcentaje" ? " selected" : "") + '>Un % de lo que se factura</option>' +
          '<option value="fijo"' + ((p.contrato || {}).tipo === "fijo" ? " selected" : "") + '>Un monto fijo por paciente</option>' +
        "</select></label>" +
        '<label>Cuánto<input class="lab-in" id="pf-cvalor" type="number" min="0" step="1" value="' + ((p.contrato || {}).valor || "") + '" placeholder="% o $"></label>' +
        '<label>Sobre<select class="lab-in" id="pf-csobre">' +
          '<option value="cobrado"' + ((p.contrato || {}).sobre !== "facturado" ? " selected" : "") + ">Lo cobrado</option>" +
          '<option value="facturado"' + ((p.contrato || {}).sobre === "facturado" ? " selected" : "") + ">Lo facturado</option>" +
        "</select></label>" +
        "</div>" +
        '<div class="lab-horarios-head"><b>Horarios de atención</b><button class="lab-btn xs" id="pf-add-h">+ Agregar bloque</button></div>' +
        '<div id="pf-horarios"></div>' +
      "</div>" +
      '<div class="lab-modal-actions"><button class="lab-btn ghost" id="pf-cancel">Cancelar</button><button class="lab-btn primary" id="pf-ok">Guardar</button></div>';
    var cont = m.body.querySelector("#pf-horarios");
    function addH(h) {
      h = h || { dow: 1, desde: "08:00", hasta: "12:00", duracionMin: 15 };
      var row = e("div", { class: "lab-hrow" });
      row.innerHTML =
        '<select class="lab-in dow">' + DOW.map(function (d, i) { return '<option value="' + i + '"' + (i === h.dow ? " selected" : "") + ">" + d + "</option>"; }).join("") + "</select>" +
        '<input class="lab-in" type="time" value="' + esc(h.desde) + '"><span>a</span><input class="lab-in" type="time" value="' + esc(h.hasta) + '">' +
        '<input class="lab-in dur" type="number" min="5" max="240" step="5" value="' + (h.duracionMin || 15) + '" title="Minutos por turno"><span>min</span>' +
        '<button class="lab-btn xs ghost danger del">✕</button>';
      row.querySelector(".del").onclick = function () { row.remove(); };
      cont.appendChild(row);
    }
    (p.horarios && p.horarios.length ? p.horarios : [{ dow: 1, desde: "08:00", hasta: "12:00", duracionMin: 15 }]).forEach(addH);
    m.body.querySelector("#pf-add-h").onclick = function () { addH(); };
    m.body.querySelector("#pf-cancel").onclick = labClose;
    m.body.querySelector("#pf-ok").onclick = async function () {
      var nombre = m.body.querySelector("#pf-nombre").value.trim();
      if (!nombre) { toast("Falta el nombre.", true); return; }
      var horarios = Array.prototype.map.call(cont.querySelectorAll(".lab-hrow"), function (row) {
        var ins = row.querySelectorAll("input");
        return { dow: parseInt(row.querySelector(".dow").value, 10), desde: ins[0].value, hasta: ins[1].value, duracionMin: parseInt(row.querySelector(".dur").value, 10) || 15 };
      });
      var payload = { nombre: nombre, matricula: m.body.querySelector("#pf-mat").value, especialidadId: m.body.querySelector("#pf-esp").value, consultorioId: m.body.querySelector("#pf-cons").value, valorConsulta: m.body.querySelector("#pf-valor").value, horarios: horarios,
        contrato: { tipo: m.body.querySelector("#pf-ctipo").value,
                    valor: m.body.querySelector("#pf-cvalor").value,
                    sobre: m.body.querySelector("#pf-csobre").value } };
      var r = p.id ? await req("PUT", "/api/lab/profesionales/" + p.id, payload) : await api("/api/lab/profesionales", payload);
      if (!r.ok) { toast((r.data && r.data.error) || "No se pudo guardar.", true); return; }
      labClose(); toast("Profesional guardado ✓");
      await cargarBootstrap(); labGo("profesionales");
    };
  }

  /* ========================== PACIENTES ================================= */
  function viewPacientes(c) {
    c.innerHTML =
      '<div class="lab-card">' +
        '<div class="lab-list-head"><h3>Pacientes</h3><div class="lab-inline"><button class="lab-btn ghost" id="lab-pac-dup">🔗 Unificar duplicados</button><button class="lab-btn primary" id="lab-pac-new">+ Nuevo paciente</button></div></div>' +
        '<div class="lab-search"><input class="lab-in" id="lab-pac-q" placeholder="Buscar por apellido, documento, celular o N° afiliado…" autocomplete="off"></div>' +
        '<div id="lab-pac-list"><div class="lab-muted" style="padding:16px">Escribí para buscar. (Hay pacientes cargados si ya usaste la agenda.)</div></div>' +
      "</div>";
    var q = document.getElementById("lab-pac-q");
    var timer = null;
    q.oninput = function () { clearTimeout(timer); timer = setTimeout(pacBuscar, 250); };
    document.getElementById("lab-pac-new").onclick = function () { pacForm(null); };
    document.getElementById("lab-pac-dup").onclick = function () { dupModal(); };
    pacBuscar();
  }
  async function dupModal() {
    var m = modal("Unificar pacientes duplicados", { ancho: "ancho" });
    m.body.innerHTML = '<div class="lab-muted">Buscando duplicados…</div>';
    var r = await api("/api/lab/pacientes/duplicados");
    var grupos = (r.data && r.data.grupos) || [];
    if (!grupos.length) { m.body.innerHTML = '<div class="lab-muted" style="padding:12px">No se encontraron pacientes duplicados (por DNI ni por nombre).</div>'; return; }
    m.body.innerHTML = '<div class="lab-muted" style="margin-bottom:10px">' + grupos.length + " grupo(s) con posibles duplicados. Elegí cuál queda (los otros se fusionan: sus turnos e historia clínica pasan al elegido).</div>" +
      grupos.map(function (g, gi) {
        return '<div class="lab-dup-grupo"><div class="lab-dup-clave">' + esc(g.clave) + "</div>" +
          g.pacientes.map(function (p, pi) {
            return '<label class="lab-dup-row"><input type="radio" name="dup-' + gi + '" value="' + p.id + '"' + (pi === 0 ? " checked" : "") + "> <b>" + esc([p.apellido, p.nombre].filter(Boolean).join(", ")) + "</b> " +
              '<span class="lab-muted">' + esc([p.documento, p.obraSocial, p.celular].filter(Boolean).join(" · ")) + "</span></label>";
          }).join("") +
          '<button class="lab-btn xs primary lab-dup-go" data-gi="' + gi + '">Unificar este grupo</button></div>';
      }).join("");
    m.body.querySelectorAll(".lab-dup-go").forEach(function (b) {
      b.onclick = async function () {
        var gi = b.getAttribute("data-gi");
        var g = grupos[gi];
        var mantener = (m.body.querySelector('input[name="dup-' + gi + '"]:checked') || {}).value;
        if (!mantener) return;
        var fusionar = g.pacientes.map(function (p) { return p.id; }).filter(function (id) { return id !== mantener; });
        if (!confirm("¿Unificar " + fusionar.length + " paciente(s) en el elegido? No se puede deshacer.")) return;
        var rr = await api("/api/lab/pacientes/unificar", { mantener: mantener, fusionar: fusionar });
        if (!rr.ok) { toast((rr.data && rr.data.error) || "No se pudo unificar.", true); return; }
        toast("Unificados ✓ (" + rr.data.turnosMovidos + " turnos movidos)");
        dupModal(); pacBuscar();
      };
    });
  }
  async function pacBuscar() {
    var q = (document.getElementById("lab-pac-q") || {}).value || "";
    var list = document.getElementById("lab-pac-list");
    var r = await api("/api/lab/pacientes?q=" + encodeURIComponent(q));
    var items = (r.data && r.data.items) || [];
    list.innerHTML = '<div class="lab-muted" style="padding:6px 2px">' + ((r.data && r.data.total) || 0) + ' paciente(s) · mostrando ' + items.length + "</div>" +
      '<table class="lab-table"><thead><tr><th>Apellido y nombre</th><th>Documento</th><th>Obra social</th><th>Celular</th><th></th></tr></thead><tbody>' +
      (items.map(function (p) {
        return '<tr data-id="' + p.id + '"><td><b>' + esc([p.apellido, p.nombre].filter(Boolean).join(", ")) + "</b></td><td>" + esc(p.documento || "") + "</td><td>" + esc(p.obraSocial || "") + (p.nroAfiliado ? " " + esc(p.nroAfiliado) : "") + "</td><td>" + esc(p.celular || "") + "</td>" +
          '<td style="white-space:nowrap"><button class="lab-btn xs ghost lab-pac-turnos" title="Turnos">📅</button> <button class="lab-btn xs ghost lab-pac-cuenta" title="Cuenta corriente">💳</button> <button class="lab-btn xs ghost lab-pac-presup" title="Presupuesto">💰</button> <button class="lab-btn xs ghost lab-pac-hc">📋 H.C.</button> <button class="lab-btn xs ghost lab-pac-edit">Editar</button></td></tr>';
      }).join("") || '<tr><td colspan="5" class="lab-muted" style="padding:16px">Sin pacientes.</td></tr>') + "</tbody></table>";
    list.querySelectorAll(".lab-pac-edit").forEach(function (b) {
      b.onclick = async function () {
        var id = b.closest("tr").getAttribute("data-id");
        var rr = await api("/api/lab/pacientes/" + id);
        pacForm(rr.data && rr.data.item);
      };
    });
    list.querySelectorAll(".lab-pac-hc").forEach(function (b) {
      b.onclick = async function () {
        var id = b.closest("tr").getAttribute("data-id");
        var rr = await api("/api/lab/pacientes/" + id);
        hcModal(rr.data && rr.data.item);
      };
    });
    list.querySelectorAll(".lab-pac-cuenta").forEach(function (b) {
      b.onclick = async function () {
        var id = b.closest("tr").getAttribute("data-id");
        var rr = await api("/api/lab/pacientes/" + id);
        cuentaModal(rr.data && rr.data.item);
      };
    });
    list.querySelectorAll(".lab-pac-turnos").forEach(function (b) {
      b.onclick = async function () {
        var id = b.closest("tr").getAttribute("data-id");
        var rr = await api("/api/lab/pacientes/" + id);
        turnosPacienteModal(rr.data && rr.data.item);
      };
    });
    list.querySelectorAll(".lab-pac-presup").forEach(function (b) {
      b.onclick = async function () {
        var id = b.closest("tr").getAttribute("data-id");
        var rr = await api("/api/lab/pacientes/" + id);
        presupModal(rr.data && rr.data.item);
      };
    });
  }
  // Presupuesto: ítems (concepto + cantidad + precio) → total → guardar + imprimir.
  function presupModal(p) {
    p = p || {};
    var m = modal("Presupuesto · " + ([p.apellido, p.nombre].filter(Boolean).join(", ") || "sin paciente"), { ancho: "ancho" });
    m.body.innerHTML =
      '<div class="lab-presup-items"><div class="lab-presup-h"><span>Concepto</span><span>Cant.</span><span>Precio unit.</span><span>Subtotal</span><span></span></div><div id="pr-rows"></div>' +
      '<button class="lab-btn xs" id="pr-add">+ Agregar ítem</button></div>' +
      '<div class="lab-presup-tot">Total: <b id="pr-total">$0,00</b></div>' +
      '<label>Observaciones<input class="lab-in" id="pr-obs" placeholder="Validez, condiciones…"></label>' +
      '<div class="lab-modal-actions"><button class="lab-btn ghost" id="pr-cancel">Cancelar</button><button class="lab-btn" id="pr-print">🖨️ Guardar e imprimir</button><button class="lab-btn primary" id="pr-save">Guardar</button></div>';
    var rows = m.body.querySelector("#pr-rows");
    function recalc() {
      var tot = 0;
      rows.querySelectorAll(".lab-presup-row").forEach(function (r) {
        var cant = parseFloat(r.querySelector(".pr-cant").value) || 0;
        var pu = parseFloat(r.querySelector(".pr-pu").value) || 0;
        var sub = Math.round(cant * pu * 100) / 100;
        r.querySelector(".pr-sub").textContent = fmt$(sub); tot += sub;
      });
      m.body.querySelector("#pr-total").textContent = fmt$(tot);
    }
    function addRow() {
      var r = e("div", { class: "lab-presup-row" });
      r.innerHTML = '<input class="lab-in pr-con" placeholder="Práctica / concepto"><input class="lab-in pr-cant" type="number" min="1" value="1"><input class="lab-in pr-pu" type="number" min="0" step="100" value="0"><span class="pr-sub">$0,00</span><button class="lab-btn xs ghost danger pr-del">✕</button>';
      r.querySelector(".pr-del").onclick = function () { r.remove(); recalc(); };
      r.querySelector(".pr-cant").oninput = recalc; r.querySelector(".pr-pu").oninput = recalc;
      rows.appendChild(r);
    }
    addRow();
    m.body.querySelector("#pr-add").onclick = addRow;
    m.body.querySelector("#pr-cancel").onclick = labClose;
    function juntar() {
      var items = [];
      rows.querySelectorAll(".lab-presup-row").forEach(function (r) {
        var con = r.querySelector(".pr-con").value.trim();
        if (con) items.push({ concepto: con, cantidad: r.querySelector(".pr-cant").value, precioUnitario: r.querySelector(".pr-pu").value });
      });
      return items;
    }
    async function guardar() {
      var items = juntar();
      if (!items.length) { toast("Agregá al menos un ítem.", true); return null; }
      var r = await api("/api/lab/presupuestos", { pacienteId: p.id || "", pacienteNombre: [p.apellido, p.nombre].filter(Boolean).join(", "), obraSocial: p.obraSocial || "", items: items, observaciones: m.body.querySelector("#pr-obs").value });
      if (!r.ok) { toast((r.data && r.data.error) || "No se pudo guardar.", true); return null; }
      return r.data.item;
    }
    m.body.querySelector("#pr-save").onclick = async function () { var it = await guardar(); if (it) { labClose(); toast("Presupuesto N° " + it.numero + " guardado ✓"); } };
    m.body.querySelector("#pr-print").onclick = async function () { var it = await guardar(); if (it) { labClose(); toast("Presupuesto N° " + it.numero + " guardado ✓"); imprimirPresupuesto(it); } };
  }
  function imprimirPresupuesto(pr) {
    var filas = (pr.items || []).map(function (it) { return "<tr><td>" + esc(it.concepto) + "</td><td style='text-align:center'>" + it.cantidad + "</td><td style='text-align:right'>" + fmt$(it.precioUnitario) + "</td><td style='text-align:right'>" + fmt$(it.subtotal) + "</td></tr>"; }).join("");
    var html = '<html><head><meta charset="utf-8"><title>Presupuesto ' + pr.numero + '</title>' +
      '<style>body{font-family:system-ui,Arial,sans-serif;padding:30px;color:#111}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;font-size:14px;margin-top:14px}td,th{padding:7px 5px;border-bottom:1px solid #ddd}.tot{font-size:22px;font-weight:700;margin-top:16px;text-align:right}.muted{color:#666;font-size:12px}</style></head><body>' +
      "<h1>Presupuesto N° " + pr.numero + "</h1><div class='muted'>" + esc((pr.fecha || "").split("-").reverse().join("/")) + (pr.pacienteNombre ? " · " + esc(pr.pacienteNombre) : "") + (pr.obraSocial ? " · " + esc(pr.obraSocial) : "") + "</div>" +
      "<table><tr><th style='text-align:left'>Concepto</th><th>Cant.</th><th style='text-align:right'>Precio unit.</th><th style='text-align:right'>Subtotal</th></tr>" + filas + "</table>" +
      "<div class='tot'>Total: " + fmt$(pr.total) + "</div>" +
      (pr.observaciones ? "<div class='muted' style='margin-top:14px'>" + esc(pr.observaciones) + "</div>" : "") +
      "</body></html>";
    var w = window.open("", "_blank"); if (!w) { toast("Permití las ventanas emergentes para imprimir.", true); return; }
    w.document.write(html); w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 300);
  }
  async function turnosPacienteModal(p) {
    if (!p) return;
    var m = modal("Turnos · " + [p.apellido, p.nombre].filter(Boolean).join(", "), { ancho: "ancho" });
    m.body.innerHTML = '<div class="lab-muted">Cargando…</div>';
    var r = await api("/api/lab/turnos?pacienteId=" + encodeURIComponent(p.id));
    var items = (r.data && r.data.items) || [];
    m.body.innerHTML = items.length ?
      '<table class="lab-table"><thead><tr><th>Fecha</th><th>Hora</th><th>Profesional</th><th>Motivo</th><th>Estado</th></tr></thead><tbody>' +
      items.map(function (t) {
        var est = ESTADOS[t.estado] || ESTADOS.dado;
        return "<tr><td>" + esc((t.fecha || "").split("-").reverse().join("/")) + "</td><td>" + esc(t.hora) + "</td><td>" + esc(nombreProf(t.profesionalId)) + "</td><td>" + esc(t.motivo || "") + '</td><td><span class="lab-pill" style="background:' + est.color + '">' + esc(est.label) + "</span></td></tr>";
      }).join("") + "</tbody></table>"
      : '<div class="lab-muted">Este paciente no tiene turnos.</div>';
  }

  // Historia clinica: una sola linea de tiempo con las evoluciones Y los estudios.
  // El estudio es la ficha que usan los centros de verdad —fecha, tipo, profesional
  // y el PDF del informe colgado— y es lo que hace que la HC sirva para algo mas que
  // leer: de ahi sale el informe que se presenta.
  var LAB_TIPOS = [];
  async function hcModal(p) {
    if (!p) return;
    var m = modal("Historia clínica · " + [p.apellido, p.nombre].filter(Boolean).join(", "), { ancho: "ancho" });
    var profOpts = '<option value="">— Profesional —</option>' + LAB.cat.profesionales.map(function (o) { return '<option value="' + o.id + '">' + esc(o.nombre) + "</option>"; }).join("");
    m.body.innerHTML =
      '<div class="lab-hc-tabs">' +
        '<button class="lab-hc-tab on" data-t="evolucion" type="button">Evolución</button>' +
        '<button class="lab-hc-tab" data-t="estudio" type="button">Estudio con informe</button>' +
      "</div>" +
      '<div class="lab-hc-new" id="hc-form-evolucion"><div class="lab-grid3">' +
        '<label>Fecha<input class="lab-in" type="date" id="hc-fecha" value="' + hoyISO() + '"></label>' +
        '<label>Profesional<select class="lab-in" id="hc-prof">' + profOpts + "</select></label>" +
        '<label>Motivo<input class="lab-in" id="hc-motivo" placeholder="Consulta, control…"></label>' +
      "</div>" +
      '<label>Evolución<textarea class="lab-in" id="hc-texto" rows="3" placeholder="Escribí la evolución del paciente…"></textarea></label>' +
      '<div style="text-align:right"><button class="lab-btn primary" id="hc-add">Agregar evolución</button></div></div>' +
      '<div class="lab-hc-new" id="hc-form-estudio" style="display:none"><div class="lab-grid3">' +
        '<label>Fecha<input class="lab-in" type="date" id="es-fecha" value="' + hoyISO() + '"></label>' +
        '<label>Tipo<select class="lab-in" id="es-tipo"></select></label>' +
        '<label>Profesional<select class="lab-in" id="es-prof">' + profOpts + "</select></label>" +
      "</div>" +
      '<label>Informe<textarea class="lab-in" id="es-texto" rows="3" placeholder="El texto del informe (se puede dejar vacío si adjuntás el PDF)…"></textarea></label>' +
      '<label>Archivo (PDF o imagen)<input class="lab-in" type="file" id="es-file" accept=".pdf,.jpg,.jpeg,.png"></label>' +
      '<div style="text-align:right"><button class="lab-btn primary" id="es-add">Guardar estudio</button></div></div>' +
      '<div class="lab-sec-tit">Historia</div><div id="hc-list"><div class="lab-muted">Cargando…</div></div>';

    m.body.querySelectorAll(".lab-hc-tab").forEach(function (b) {
      b.onclick = function () {
        m.body.querySelectorAll(".lab-hc-tab").forEach(function (x) { x.classList.toggle("on", x === b); });
        m.body.querySelector("#hc-form-evolucion").style.display = b.dataset.t === "evolucion" ? "" : "none";
        m.body.querySelector("#hc-form-estudio").style.display = b.dataset.t === "estudio" ? "" : "none";
      };
    });

    function fechaAr(f) { return String(f || "").split("-").reverse().join("/"); }
    function pesoKb(n) { return n ? Math.max(1, Math.round(n / 1024)) + " kB" : ""; }

    async function load() {
      var box = m.body.querySelector("#hc-list");
      var re = await api("/api/lab/pacientes/" + p.id + "/evoluciones");
      var rs = await api("/api/lab/pacientes/" + p.id + "/estudios");
      if (rs.ok && rs.data && rs.data.tipos && !LAB_TIPOS.length) {
        LAB_TIPOS = rs.data.tipos;
        var sel = m.body.querySelector("#es-tipo");
        if (sel) sel.innerHTML = LAB_TIPOS.map(function (t) { return '<option value="' + t.cod + '">' + esc(t.nombre) + "</option>"; }).join("");
      }
      var filas = []
        .concat(((re.data && re.data.items) || []).map(function (x) { return { k: "ev", x: x }; }))
        .concat(((rs.data && rs.data.items) || []).map(function (x) { return { k: "es", x: x }; }));
      filas.sort(function (a, b) {
        return String((b.x.fecha || "") + (b.x.creadoEl || "")).localeCompare(String((a.x.fecha || "") + (a.x.creadoEl || "")));
      });
      if (!filas.length) { box.innerHTML = '<div class="lab-muted">Sin evoluciones ni estudios todavía.</div>'; return; }
      box.innerHTML = filas.map(function (f) {
        var x = f.x;
        if (f.k === "ev") {
          return '<div class="lab-hc-item"><div class="lab-hc-meta"><b>' + esc(fechaAr(x.fecha)) + "</b>" +
            (x.profesionalId ? " · " + esc(nombreProf(x.profesionalId)) : "") + (x.motivo ? " · " + esc(x.motivo) : "") +
            ' <span class="lab-muted">(' + esc(x.creadoPor || "") + ")</span></div>" +
            '<div class="lab-hc-txt">' + esc(x.texto).replace(/\n/g, "<br>") + "</div></div>";
        }
        var arch = x.archivo
          ? '<a class="lab-hc-arch" href="' + conCentro("/api/lab/estudios/" + x.id + "/archivo") + '" target="_blank" rel="noopener">📎 ' + esc(x.archivo.nombre) + ' <span class="lab-muted">' + pesoKb(x.archivo.tamano) + "</span></a>"
          : '<span class="lab-muted">sin archivo adjunto</span>';
        return '<div class="lab-hc-item es"><div class="lab-hc-meta"><span class="lab-hc-tipo">' + esc(x.tipo) + "</span> <b>" + esc(fechaAr(x.fecha)) + "</b>" +
          " · " + esc(x.tipoNombre || "") + (x.profesionalId ? " · " + esc(nombreProf(x.profesionalId)) : "") +
          ' <button class="lab-btn xs ghost danger" data-del="' + x.id + '" type="button" style="float:right">Borrar</button></div>' +
          (x.texto ? '<div class="lab-hc-txt">' + esc(x.texto).replace(/\n/g, "<br>") + "</div>" : "") +
          '<div class="lab-hc-archline">' + arch + "</div></div>";
      }).join("");
      box.querySelectorAll("[data-del]").forEach(function (b) {
        b.onclick = async function () {
          if (!confirm("¿Borrar este estudio y su archivo?")) return;
          var r = await req("DELETE", "/api/lab/estudios/" + b.dataset.del);
          if (!r.ok) { toast((r.data && r.data.error) || "No se pudo borrar.", true); return; }
          toast("Estudio borrado ✓"); load();
        };
      });
    }

    m.body.querySelector("#hc-add").onclick = async function () {
      var texto = m.body.querySelector("#hc-texto").value.trim();
      if (!texto) { toast("Escribí la evolución.", true); return; }
      var r = await api("/api/lab/pacientes/" + p.id + "/evoluciones", {
        fecha: m.body.querySelector("#hc-fecha").value, profesionalId: m.body.querySelector("#hc-prof").value,
        motivo: m.body.querySelector("#hc-motivo").value, texto: texto,
      });
      if (!r.ok) { toast((r.data && r.data.error) || "No se pudo guardar.", true); return; }
      m.body.querySelector("#hc-texto").value = ""; m.body.querySelector("#hc-motivo").value = "";
      toast("Evolución agregada ✓"); load();
    };

    m.body.querySelector("#es-add").onclick = async function () {
      var file = m.body.querySelector("#es-file").files[0];
      var texto = m.body.querySelector("#es-texto").value.trim();
      if (!file && !texto) { toast("Adjuntá el archivo o escribí el informe.", true); return; }
      var r = await guardarEstudio(p.id, {
        fecha: m.body.querySelector("#es-fecha").value,
        tipo: m.body.querySelector("#es-tipo").value,
        profesionalId: m.body.querySelector("#es-prof").value,
        texto: texto,
      }, file);
      if (!r.ok) { toast(r.error, true); return; }
      m.body.querySelector("#es-texto").value = ""; m.body.querySelector("#es-file").value = "";
      toast(r.aviso || "Estudio guardado ✓", !!r.aviso); load();
    };
    load();
  }
  // Cuenta corriente: lo que se le cobro, lo que pago y lo que debe. Los cargos
  // salen de los turnos —ahi ya se anota el cobro— y aca se suman los movimientos
  // que no son un turno: un pago a cuenta, un certificado, un ajuste.
  async function cuentaModal(p) {
    if (!p) return;
    var m = modal("Cuenta corriente · " + [p.apellido, p.nombre].filter(Boolean).join(", "), { ancho: "ancho" });
    m.body.innerHTML = '<div class="lab-muted">Cargando…</div>';
    async function pintar() {
      var r = await api("/api/lab/pacientes/" + p.id + "/cuenta");
      if (!r.ok) { m.body.innerHTML = '<div class="lab-muted">' + esc((r.data && r.data.error) || "No se pudo cargar.") + "</div>"; return; }
      var t = r.data.totales || {};
      var filas = (r.data.items || []).map(function (x) {
        var esPago = x.tipo === "pago";
        return "<tr><td>" + esc(String(x.fecha || "").split("-").reverse().join("/")) + "</td>" +
          "<td>" + esc(x.concepto || "") + (x.turnoId ? ' <span class="lab-muted">turno</span>' : "") + "</td>" +
          '<td class="num">' + (esPago ? "" : fmt$(x.importe)) + "</td>" +
          '<td class="num">' + (esPago ? fmt$(x.importe) : "") + "</td>" +
          '<td style="text-align:right">' + (x.turnoId ? "" : '<button class="lab-btn xs ghost danger" data-del="' + esc(x.id) + '" type="button">✕</button>') + "</td></tr>";
      }).join("");
      var debe = (t.saldo || 0) > 0;
      m.body.innerHTML =
        '<div class="lab-sala-kpis">' +
          '<div class="lab-sala-kpi"><b>' + fmt$(t.cargos || 0) + "</b><span>se le cobró</span></div>" +
          '<div class="lab-sala-kpi verde"><b>' + fmt$(t.pagos || 0) + "</b><span>pagó</span></div>" +
          '<div class="lab-sala-kpi' + (debe ? " roja" : "") + '"><b>' + fmt$(t.saldo || 0) + "</b><span>" + (debe ? "debe" : "saldo") + "</span></div>" +
        "</div>" +
        '<div class="lab-cta-nuevo"><div class="lab-grid3">' +
          '<label>Fecha<input class="lab-in" type="date" id="cc-fecha" value="' + hoyISO() + '"></label>' +
          '<label>Concepto<input class="lab-in" id="cc-concepto" placeholder="Pago a cuenta, certificado…"></label>' +
          '<label>Importe<input class="lab-in" type="number" min="0" step="100" id="cc-importe"></label>' +
        "</div>" +
        '<div class="lab-inline" style="justify-content:flex-end;gap:8px;margin-top:8px">' +
          '<select class="lab-in" id="cc-tipo" style="width:150px"><option value="pago">Pago</option><option value="cargo">Cargo</option><option value="ajuste">Ajuste</option></select>' +
          '<select class="lab-in" id="cc-medio" style="width:160px"><option value="">— Medio —</option>' +
          ["Efectivo", "Débito", "Crédito", "Transferencia", "Mercado Pago"].map(function (x) { return "<option>" + x + "</option>"; }).join("") + "</select>" +
          '<button class="lab-btn primary" id="cc-add" type="button">Agregar</button></div></div>' +
        (filas
          ? '<table class="lab-table"><thead><tr><th>Fecha</th><th>Concepto</th><th class="num">Debe</th><th class="num">Pagó</th><th></th></tr></thead><tbody>' + filas + "</tbody></table>"
          : '<div class="lab-muted" style="padding:14px">Todavía no hay movimientos.</div>');
      m.body.querySelector("#cc-add").onclick = async function () {
        var rr = await api("/api/lab/pacientes/" + p.id + "/movimientos", {
          fecha: m.body.querySelector("#cc-fecha").value,
          tipo: m.body.querySelector("#cc-tipo").value,
          concepto: m.body.querySelector("#cc-concepto").value,
          medioPago: m.body.querySelector("#cc-medio").value,
          importe: m.body.querySelector("#cc-importe").value,
        });
        if (!rr.ok) { toast((rr.data && rr.data.error) || "No se pudo guardar.", true); return; }
        toast("Movimiento agregado ✓"); pintar();
      };
      m.body.querySelectorAll("[data-del]").forEach(function (b) {
        b.onclick = async function () {
          if (!confirm("¿Borrar este movimiento?")) return;
          var rr = await req("DELETE", "/api/lab/movimientos/" + b.dataset.del);
          if (!rr.ok) { toast((rr.data && rr.data.error) || "No se pudo borrar.", true); return; }
          toast("Borrado ✓"); pintar();
        };
      });
    }
    pintar();
  }

  function pacForm(p) {
    p = p || {};
    var m = modal(p.id ? "Editar paciente" : "Nuevo paciente", { ancho: "ancho" });
    var osOpts = '<option value="">—</option>' + LAB.cat.obrasSociales.map(function (o) { return "<option" + (o.nombre === p.obraSocial ? " selected" : "") + ">" + esc(o.nombre) + "</option>"; }).join("");
    m.body.innerHTML =
      '<div class="lab-form"><div class="lab-grid2">' +
        '<label>Apellido<input class="lab-in" id="pc-ap" value="' + esc(p.apellido || "") + '"></label>' +
        '<label>Nombre<input class="lab-in" id="pc-no" value="' + esc(p.nombre || "") + '"></label>' +
        '<label>Documento<input class="lab-in" id="pc-doc" value="' + esc(p.documento || "") + '"></label>' +
        '<label>Fecha nac.<input class="lab-in" type="date" id="pc-fn" value="' + esc(p.fechaNac || "") + '"></label>' +
        '<label>Sexo<select class="lab-in" id="pc-sx"><option value="">—</option><option' + (p.sexo === "F" ? " selected" : "") + '>F</option><option' + (p.sexo === "M" ? " selected" : "") + ">M</option></select></label>" +
        '<label>Celular<input class="lab-in" id="pc-cel" value="' + esc(p.celular || "") + '"></label>' +
        '<label>Email<input class="lab-in" id="pc-mail" value="' + esc(p.email || "") + '"></label>' +
        '<label>Obra social<select class="lab-in" id="pc-os">' + osOpts + "</select></label>" +
        '<label>N° afiliado<input class="lab-in" id="pc-afil" value="' + esc(p.nroAfiliado || "") + '"></label>' +
        '<label>Plan<input class="lab-in" id="pc-plan" value="' + esc(p.plan || "") + '"></label>' +
        '<label>Localidad<input class="lab-in" id="pc-loc" value="' + esc(p.localidad || "") + '"></label>' +
        '<label>Dirección<input class="lab-in" id="pc-dir" value="' + esc(p.direccion || "") + '"></label>' +
      "</div>" +
      '<label>Observaciones<input class="lab-in" id="pc-obs" value="' + esc(p.observaciones || "") + '"></label></div>' +
      '<div class="lab-modal-actions">' + (p.id ? '<button class="lab-btn ghost danger" id="pc-del">Eliminar</button>' : "") + '<button class="lab-btn ghost" id="pc-cancel">Cancelar</button><button class="lab-btn primary" id="pc-ok">Guardar</button></div>';
    m.body.querySelector("#pc-cancel").onclick = labClose;
    if (p.id) m.body.querySelector("#pc-del").onclick = async function () {
      if (!confirm("¿Eliminar la ficha de " + [p.apellido, p.nombre].filter(Boolean).join(", ") + "? Se borra su historia clínica; los turnos quedan con el nombre.")) return;
      var r = await req("DELETE", "/api/lab/pacientes/" + p.id);
      if (!r.ok) { toast((r.data && r.data.error) || "No se pudo eliminar.", true); return; }
      labClose(); toast("Paciente eliminado" + (r.data.turnosFuturos ? " (tenía " + r.data.turnosFuturos + " turno/s futuros)" : "")); pacBuscar();
    };
    m.body.querySelector("#pc-ok").onclick = async function () {
      var payload = {
        apellido: m.body.querySelector("#pc-ap").value, nombre: m.body.querySelector("#pc-no").value,
        documento: m.body.querySelector("#pc-doc").value, fechaNac: m.body.querySelector("#pc-fn").value,
        sexo: m.body.querySelector("#pc-sx").value, celular: m.body.querySelector("#pc-cel").value,
        email: m.body.querySelector("#pc-mail").value, obraSocial: m.body.querySelector("#pc-os").value,
        nroAfiliado: m.body.querySelector("#pc-afil").value, plan: m.body.querySelector("#pc-plan").value,
        localidad: m.body.querySelector("#pc-loc").value, direccion: m.body.querySelector("#pc-dir").value,
        observaciones: m.body.querySelector("#pc-obs").value,
      };
      if (!payload.apellido && !payload.nombre) { toast("Falta el nombre.", true); return; }
      var r = p.id ? await req("PUT", "/api/lab/pacientes/" + p.id, payload) : await api("/api/lab/pacientes", payload);
      if (!r.ok) { toast((r.data && r.data.error) || "No se pudo guardar.", true); return; }
      labClose(); toast("Paciente guardado ✓"); pacBuscar();
    };
  }

  /* ========================== CATÁLOGOS ================================= */
  async function viewCatalogo(c, recurso, titulo) {
    c.innerHTML = '<div class="lab-card"><div class="lab-muted" style="padding:16px">Cargando…</div></div>';
    var r = await api("/api/lab/" + recurso);
    var items = (r.data && r.data.items) || [];
    LAB.cat[recurso] = items;
    c.innerHTML = '<div class="lab-card">' +
      '<div class="lab-list-head"><h3>' + esc(titulo) + '</h3><div class="lab-inline"><input class="lab-in" id="cat-new" placeholder="Nuevo…"><button class="lab-btn primary" id="cat-add">Agregar</button></div></div>' +
      '<table class="lab-table"><tbody>' +
      (items.map(function (o) {
        return '<tr data-id="' + o.id + '"><td><input class="lab-in cat-nombre" value="' + esc(o.nombre) + '"></td>' +
          '<td style="width:140px"><button class="lab-btn xs cat-save">Guardar</button> <button class="lab-btn xs ghost danger cat-del">✕</button></td></tr>';
      }).join("") || '<tr><td class="lab-muted" style="padding:12px">Vacío.</td></tr>') + "</tbody></table></div>";
    async function agregarCat() {
      var inp = document.getElementById("cat-new");
      var v = (inp.value || "").trim();
      if (!v) { inp.focus(); return; }
      var rr = await api("/api/lab/" + recurso, { nombre: v });
      if (rr.ok) { inp.value = ""; toast("Agregado ✓"); await cargarBootstrap(); viewCatalogo(c, recurso, titulo); }
      else { toast((rr.data && rr.data.error) || "No se pudo agregar.", true); }
    }
    document.getElementById("cat-add").onclick = agregarCat;
    document.getElementById("cat-new").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); agregarCat(); }
    });
    c.querySelectorAll(".cat-save").forEach(function (b) {
      b.onclick = async function () {
        var tr = b.closest("tr");
        var rr = await req("PUT", "/api/lab/" + recurso + "/" + tr.getAttribute("data-id"), { nombre: tr.querySelector(".cat-nombre").value });
        if (rr.ok) { toast("Guardado ✓"); await cargarBootstrap(); }
        else { toast((rr.data && rr.data.error) || "No se pudo guardar.", true); }
      };
    });
    c.querySelectorAll(".cat-del").forEach(function (b) {
      b.onclick = async function () {
        if (!confirm("¿Eliminar?")) return;
        var rr = await req("DELETE", "/api/lab/" + recurso + "/" + b.closest("tr").getAttribute("data-id"));
        if (rr.ok) { await cargarBootstrap(); viewCatalogo(c, recurso, titulo); }
        else { toast((rr.data && rr.data.error) || "No se pudo eliminar.", true); }
      };
    });
  }

  /* ========================== CAJA ===================================== */
  function fmt$(n) { return "$" + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function nombreProf(id) { var p = LAB.cat.profesionales.find(function (x) { return x.id === id; }); return p ? p.nombre : "—"; }

  function viewCaja(c) {
    if (!LAB.cajaFecha) LAB.cajaFecha = hoyISO();
    c.innerHTML =
      '<div class="lab-card"><div class="lab-list-head"><h3>💵 Caja diaria</h3>' +
        '<div class="lab-inline"><input type="date" class="lab-in" id="cj-fecha" value="' + esc(LAB.cajaFecha) + '"><button class="lab-btn" id="cj-hoy">Hoy</button></div></div>' +
        '<div id="cj-body"><div class="lab-muted" style="padding:16px">Cargando…</div></div>' +
      "</div>";
    document.getElementById("cj-fecha").onchange = function () { LAB.cajaFecha = this.value; cajaLoad(); };
    document.getElementById("cj-hoy").onclick = function () { LAB.cajaFecha = hoyISO(); document.getElementById("cj-fecha").value = LAB.cajaFecha; cajaLoad(); };
    cajaLoad();
  }
  async function cajaLoad() {
    var body = document.getElementById("cj-body"); if (!body) return;
    var r = await api("/api/lab/turnos?desde=" + LAB.cajaFecha + "&hasta=" + LAB.cajaFecha);
    var turnos = (r.data && r.data.items) || [];
    var porProf = {};
    turnos.forEach(function (t) {
      var g = porProf[t.profesionalId] || (porProf[t.profesionalId] = { turnos: 0, atendidos: 0, ausentes: 0, importe: 0, sena: 0, insumos: 0, cobrado: 0 });
      g.turnos++;
      if (t.estado === "atendido") g.atendidos++;
      if (t.estado === "ausente" || t.estado === "ausente_aviso") g.ausentes++;
      g.importe += Number(t.importe) || 0; g.sena += Number(t.sena) || 0; g.insumos += Number(t.insumos) || 0;
      if (t.pagado) g.cobrado += (Number(t.importe) || 0) + (Number(t.insumos) || 0);
    });
    var tot = { turnos: 0, atendidos: 0, ausentes: 0, importe: 0, sena: 0, insumos: 0, cobrado: 0 };
    var filas = Object.keys(porProf).map(function (pid) {
      var g = porProf[pid];
      ["turnos", "atendidos", "ausentes", "importe", "sena", "insumos", "cobrado"].forEach(function (k) { tot[k] += g[k]; });
      var pend = g.importe + g.insumos - g.cobrado;
      return "<tr><td><b>" + esc(nombreProf(pid)) + "</b></td><td>" + g.turnos + "</td><td>" + g.atendidos + "</td><td>" + g.ausentes +
        "</td><td>" + fmt$(g.importe) + "</td><td>" + fmt$(g.sena) + "</td><td>" + fmt$(g.insumos) + "</td><td><b>" + fmt$(g.cobrado) + "</b></td><td class=" + (pend > 0 ? '"lab-pend"' : '""') + ">" + fmt$(pend) + "</td></tr>";
    }).join("");
    var pendTot = tot.importe + tot.insumos - tot.cobrado;
    body.innerHTML = turnos.length ?
      '<table class="lab-table"><thead><tr><th>Profesional</th><th>Turnos</th><th>Atend.</th><th>Ausent.</th><th>Importe</th><th>Seña</th><th>Insumos</th><th>Cobrado</th><th>Pendiente</th></tr></thead><tbody>' +
        filas +
        '<tr class="lab-tot"><td><b>TOTAL</b></td><td>' + tot.turnos + "</td><td>" + tot.atendidos + "</td><td>" + tot.ausentes + "</td><td>" + fmt$(tot.importe) + "</td><td>" + fmt$(tot.sena) + "</td><td>" + fmt$(tot.insumos) + "</td><td><b>" + fmt$(tot.cobrado) + "</b></td><td><b>" + fmt$(pendTot) + "</b></td></tr>" +
      "</tbody></table>" +
      '<div class="lab-muted" style="margin-top:10px;font-size:13px">El cobrado suma importe + insumos de los turnos marcados como <b>Cobrado</b>. Marcá el cobro desde cada turno en la Agenda.</div>'
      : '<div class="lab-muted" style="padding:20px">No hay turnos ese día.</div>';
    body.appendChild(e("div", { class: "lab-cierre", id: "cj-cierre" }));
    cierreLoad();
  }
  async function cierreLoad() {
    var box = document.getElementById("cj-cierre"); if (!box) return;
    var r = await api("/api/lab/caja/cierre?fecha=" + LAB.cajaFecha);
    var d = r.data || {};
    var t = d.cerrado ? (d.cierre.totales || {}) : (d.preview || {});
    var medios = Object.keys(t.porMedio || {}).map(function (k) { return '<span class="lab-chip">' + esc(k) + ": <b>" + fmt$(t.porMedio[k]) + "</b></span>"; }).join("");
    if (d.cerrado) {
      box.innerHTML = '<div class="lab-cierre-head"><b>✔ Caja cerrada</b> · ' + fmt$(t.cobrado) + ' · ' + (t.turnosCobrados || 0) + ' cobros' +
        '<span class="lab-muted"> — por ' + esc(d.cierre.cerradoPor) + " el " + esc((d.cierre.cerradoEl || "").slice(0, 16).replace("T", " ")) + "</span></div>" +
        (medios ? '<div class="lab-chips">' + medios + "</div>" : "") +
        '<div class="lab-cierre-actions"><button class="lab-btn" id="cj-print">🖨️ Imprimir arqueo</button><button class="lab-btn ghost danger" id="cj-reabrir">Reabrir</button></div>';
      box.querySelector("#cj-print").onclick = function () { imprimirArqueo(d.cierre); };
      box.querySelector("#cj-reabrir").onclick = async function () {
        if (!confirm("¿Reabrir la caja de este día? Vas a poder volver a cobrar y cerrar.")) return;
        await req("DELETE", "/api/lab/caja/cierre?fecha=" + LAB.cajaFecha);
        toast("Caja reabierta"); cajaLoad();
      };
    } else {
      box.innerHTML = '<div class="lab-cierre-head">Caja del día <b>abierta</b> · a cobrar hoy: <b>' + fmt$(t.cobrado) + "</b> (" + (t.turnosCobrados || 0) + " cobros)</div>" +
        (medios ? '<div class="lab-chips">' + medios + "</div>" : "") +
        '<div class="lab-cierre-actions"><button class="lab-btn primary" id="cj-cerrar">🔒 Finalizar caja</button></div>';
      box.querySelector("#cj-cerrar").onclick = async function () {
        if (!confirm("¿Finalizar la caja de " + LAB.cajaFecha.split("-").reverse().join("/") + "? Queda el arqueo del día.")) return;
        var rr = await api("/api/lab/caja/cierre?fecha=" + LAB.cajaFecha, { fecha: LAB.cajaFecha });
        if (!rr.ok) { toast((rr.data && rr.data.error) || "No se pudo cerrar.", true); return; }
        toast("Caja cerrada ✓"); cajaLoad();
      };
    }
  }
  function imprimirArqueo(cierre) {
    var t = cierre.totales || {};
    var cli = (window.ME && window.ME.centro) || "Centro médico";
    var medios = Object.keys(t.porMedio || {}).map(function (k) { return "<tr><td>" + esc(k) + "</td><td style='text-align:right'>" + fmt$(t.porMedio[k]) + "</td></tr>"; }).join("");
    var profs = (t.porProfesional || []).map(function (pp) { return "<tr><td>" + esc(nombreProf(pp.profesionalId)) + "</td><td style='text-align:center'>" + pp.turnos + "</td><td style='text-align:right'>" + fmt$(pp.monto) + "</td></tr>"; }).join("");
    var html = '<html><head><meta charset="utf-8"><title>Arqueo ' + esc(cierre.fecha) + '</title>' +
      '<style>body{font-family:system-ui,Arial,sans-serif;padding:30px;color:#111}h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px}table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:6px 4px;border-bottom:1px solid #ddd}.tot{font-size:22px;font-weight:700;margin-top:16px}.muted{color:#666;font-size:12px}</style></head><body>' +
      "<h1>Arqueo de caja</h1><div class='muted'>" + esc(cierre.fecha.split("-").reverse().join("/")) + " · cerrada por " + esc(cierre.cerradoPor) + "</div>" +
      "<div class='tot'>Total cobrado: " + fmt$(t.cobrado) + "</div>" +
      "<div class='muted'>" + (t.turnosCobrados || 0) + " cobros sobre " + (t.turnos || 0) + " turnos · seña " + fmt$(t.sena) + " · insumos " + fmt$(t.insumos) + "</div>" +
      "<h2>Por medio de pago</h2><table>" + (medios || "<tr><td class='muted'>—</td></tr>") + "</table>" +
      "<h2>Por profesional</h2><table><tr><th style='text-align:left'>Profesional</th><th>Turnos</th><th style='text-align:right'>Monto</th></tr>" + (profs || "<tr><td class='muted'>—</td></tr>") + "</table>" +
      "</body></html>";
    var w = window.open("", "_blank"); if (!w) { toast("Permití las ventanas emergentes para imprimir.", true); return; }
    w.document.write(html); w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 300);
  }

  /* ========================== ESTADÍSTICA ============================== */
  function viewEstadistica(c) {
    if (!LAB.est) { var h = hoyISO(); LAB.est = { desde: h.slice(0, 8) + "01", hasta: h }; }
    c.innerHTML =
      '<div class="lab-card"><div class="lab-list-head"><h3>📊 Estadística</h3>' +
        '<div class="lab-inline"><input type="date" class="lab-in" id="es-desde" value="' + esc(LAB.est.desde) + '"><span style="align-self:center">a</span><input type="date" class="lab-in" id="es-hasta" value="' + esc(LAB.est.hasta) + '"><button class="lab-btn primary" id="es-ver">Ver</button></div></div>' +
        '<div id="es-body"><div class="lab-muted" style="padding:16px">Elegí un rango y tocá Ver.</div></div>' +
      "</div>";
    document.getElementById("es-ver").onclick = function () {
      LAB.est.desde = document.getElementById("es-desde").value; LAB.est.hasta = document.getElementById("es-hasta").value; estLoad();
    };
    estLoad();
  }
  async function estLoad() {
    var body = document.getElementById("es-body"); if (!body) return;
    body.innerHTML = '<div class="lab-muted" style="padding:16px">Cargando…</div>';
    var r = await api("/api/lab/turnos?desde=" + LAB.est.desde + "&hasta=" + LAB.est.hasta);
    var turnos = (r.data && r.data.items) || [];
    if (!turnos.length) { body.innerHTML = '<div class="lab-muted" style="padding:16px">No hay turnos en el rango.</div>'; return; }
    var porProf = {}, porEsp = {}, porOS = {}, porEstado = {}, facturado = 0, cobrado = 0;
    turnos.forEach(function (t) {
      porProf[t.profesionalId] = (porProf[t.profesionalId] || 0) + 1;
      var esp = nombreEsp(t.especialidadId) || "(sin especialidad)"; porEsp[esp] = (porEsp[esp] || 0) + 1;
      var os = t.obraSocial || "(sin OS)"; porOS[os] = (porOS[os] || 0) + 1;
      porEstado[t.estado] = (porEstado[t.estado] || 0) + 1;
      facturado += Number(t.importe) || 0; if (t.pagado) cobrado += (Number(t.importe) || 0) + (Number(t.insumos) || 0);
    });
    var total = turnos.length;
    var atend = porEstado.atendido || 0, aus = (porEstado.ausente || 0) + (porEstado.ausente_aviso || 0);
    function tabla(titulo, obj, nombreFn) {
      var keys = Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a]; });
      return '<div class="lab-est-card"><h4>' + esc(titulo) + "</h4><table class=\"lab-table\"><tbody>" +
        keys.map(function (k) {
          var pct = Math.round(obj[k] / total * 100);
          return "<tr><td>" + esc(nombreFn ? nombreFn(k) : k) + '</td><td style="text-align:right"><b>' + obj[k] + '</b> <span class="lab-muted">' + pct + "%</span></td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    // Deudores: turnos con saldo (importe+insumos) sin cobrar, agrupados por paciente.
    var deud = {};
    turnos.forEach(function (t) {
      var saldo = (Number(t.importe) || 0) + (Number(t.insumos) || 0);
      if (!t.pagado && saldo > 0) {
        var k = t.pacienteNombre || "(sin nombre)";
        if (!deud[k]) deud[k] = { total: 0, n: 0 };
        deud[k].total += saldo; deud[k].n++;
      }
    });
    var deudKeys = Object.keys(deud).sort(function (a, b) { return deud[b].total - deud[a].total; });
    var deudTotal = deudKeys.reduce(function (a, k) { return a + deud[k].total; }, 0);
    var deudoresHtml = deudKeys.length ?
      '<div class="lab-est-card"><h4>Deudores · ' + fmt$(deudTotal) + '</h4><table class="lab-table"><tbody>' +
      deudKeys.map(function (k) { return "<tr><td>" + esc(k) + '</td><td style="text-align:right"><b>' + fmt$(deud[k].total) + '</b> <span class="lab-muted">' + deud[k].n + " turno" + (deud[k].n === 1 ? "" : "s") + "</span></td></tr>"; }).join("") +
      "</tbody></table></div>" : "";

    body.innerHTML =
      '<div class="lab-kpis">' +
        '<div class="lab-kpi"><span>Turnos</span><b>' + total + "</b></div>" +
        '<div class="lab-kpi"><span>Atendidos</span><b>' + atend + " <small>" + Math.round(atend / total * 100) + "%</small></b></div>" +
        '<div class="lab-kpi"><span>Ausentes</span><b>' + aus + " <small>" + Math.round(aus / total * 100) + "%</small></b></div>" +
        '<div class="lab-kpi"><span>Facturado</span><b>' + fmt$(facturado) + "</b></div>" +
        '<div class="lab-kpi"><span>Cobrado</span><b>' + fmt$(cobrado) + "</b></div>" +
        '<div class="lab-kpi"><span>Por cobrar</span><b>' + fmt$(deudTotal) + "</b></div>" +
      "</div>" +
      '<div class="lab-est-grid">' +
        tabla("Turnos por profesional", porProf, nombreProf) +
        tabla("Turnos por especialidad", porEsp) +
        tabla("Turnos por obra social", porOS) +
        tabla("Turnos por estado", porEstado, function (k) { return (ESTADOS[k] || { label: k }).label; }) +
        deudoresHtml +
      "</div>";
  }

  /* ========================== CSS ====================================== */
  function injectCss() {
    if (document.getElementById("lab-styles")) return;
    var css = document.createElement("style"); css.id = "lab-styles";
    css.textContent = [
      // Pegado a la izquierda, no centrado: con el menu de NS al costado, centrar
      // dejaba un hueco muerto entre los dos menus y el sistema parecia flotando.
      ".lab-wrap{display:block;margin:0}",
      ".lab-card{background:var(--card,#fff);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:14px}",
      ".lab-muted{color:var(--text-2,#64748b)}",
      ".lab-in{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg,#fff);color:var(--text);font-size:14px}",
      ".lab-btn{background:var(--card);border:1px solid var(--border);color:var(--text);padding:8px 14px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600}",
      ".lab-btn.primary{background:var(--accent,#2dd4bf);color:#04201c;border-color:transparent}",
      ".lab-btn.ghost{background:transparent}",
      ".lab-btn.danger{color:#ef4444}",
      ".lab-btn.xs{padding:4px 9px;font-size:12px}",
      ".lab-ag-controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center}",
      ".lab-ag-controls .lab-in{width:auto;min-width:180px}",
      ".lab-ag-fecha{display:flex;gap:6px;align-items:center;margin-left:auto}",
      ".lab-ag-fecha .lab-in{min-width:0}",
      ".lab-ag-info{margin-top:10px;color:var(--text-2);font-size:14px}",
      ".lab-leyenda{display:flex;gap:14px;flex-wrap:wrap;margin:0 2px 12px;font-size:12px;color:var(--text-2)}",
      ".lab-lg{display:flex;align-items:center;gap:5px}.lab-lg i{width:11px;height:11px;border-radius:3px;display:inline-block}",
      ".lab-slots{display:flex;flex-direction:column}",
      ".lab-slot{display:flex;align-items:center;gap:12px;padding:9px 10px;border-bottom:1px solid var(--border);border-left:4px solid transparent;cursor:pointer}",
      ".lab-slot:hover{background:rgba(45,212,191,.07)}",
      ".lab-slot-h{width:56px;font-weight:700;font-variant-numeric:tabular-nums}",
      ".lab-slot-main{flex:1;display:flex;flex-direction:column;min-width:0}",
      ".lab-slot-sub{font-size:12px;color:var(--text-2)}",
      ".lab-slot.libre{opacity:.75}.lab-slot.libre:hover{opacity:1}",
      ".lab-pill{color:#04201c;padding:2px 9px;border-radius:20px;font-size:12px;font-weight:700}",
      ".lab-badge{background:#f59e0b;color:#fff;font-size:10px;padding:1px 5px;border-radius:5px;vertical-align:middle}",
      ".lab-list-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px}",
      ".lab-list-head h3{margin:0}",
      ".lab-inline{display:flex;gap:6px}.lab-inline .lab-in{width:auto}",
      ".lab-table{width:100%;border-collapse:collapse;font-size:14px}",
      ".lab-table th{text-align:left;color:var(--text-2);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--border);font-size:12px}",
      ".lab-table td{padding:7px 8px;border-bottom:1px solid var(--border)}",
      ".lab-search{margin-bottom:10px}",
      ".lab-scrim{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;z-index:9999;padding:40px 16px;overflow:auto}",
      ".lab-modal{background:var(--card,#fff);border-radius:14px;width:100%;max-width:520px;box-shadow:0 20px 60px rgba(0,0,0,.3)}",
      ".lab-modal.ancho{max-width:760px}",
      ".lab-modal-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border)}",
      ".lab-x{background:transparent;border:0;font-size:18px;cursor:pointer;color:var(--text-2)}",
      ".lab-modal-body{padding:16px}",
      ".lab-form label{display:block;font-size:12px;color:var(--text-2);font-weight:600;margin-bottom:10px}",
      ".lab-form label input,.lab-form label select{margin-top:4px}",
      ".lab-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
      ".lab-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}",
      ".lab-res{max-height:150px;overflow:auto;margin-bottom:10px}",
      ".lab-res-item{padding:6px 8px;border-radius:6px;cursor:pointer}.lab-res-item:hover{background:rgba(45,212,191,.12)}",
      ".lab-horarios-head{display:flex;justify-content:space-between;align-items:center;margin:6px 0 8px}",
      ".lab-hrow{display:flex;gap:6px;align-items:center;margin-bottom:6px}.lab-hrow .lab-in{width:auto}.lab-hrow .dur{width:64px}",
      ".lab-estados{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}",
      ".lab-est-btn{border:1px solid var(--c);color:var(--c);background:transparent;padding:8px 12px;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px}",
      ".lab-est-btn.on{background:var(--c);color:#fff}",
      ".lab-turno-det{margin-bottom:6px}",
      ".lab-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#0f172a;color:#fff;padding:10px 18px;border-radius:10px;opacity:0;transition:.3s;z-index:10000;font-size:14px}",
      ".lab-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}",
      ".lab-toast.err{background:#b91c1c}",
      ".lab-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;align-items:end}",
      ".lab-chk{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text)}",
      ".lab-rec-msg{font-size:12px;color:var(--text-2);max-width:420px}",
      ".lab-rec-hecho{opacity:.55}",
      ".lab-rec-ok{color:#15803d;font-weight:800;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em}",
      ".lab-centro-sel{padding:8px 4px 4px}",
      ".lab-centro-sel .lab-in{width:100%;font-size:12.5px}",
      ".lab-bloqueo{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:rgba(239,68,68,.10);border:1px solid rgba(239,68,68,.35);color:var(--text);border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:13px}",
      ".lab-navlink{cursor:pointer}",
      ".lab-navlink .lab-tab-ic{width:18px;display:inline-flex;justify-content:center;font-size:14px;flex:0 0 auto}",
      ".lab-perms{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:2px 10px}",
      ".lab-perm{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text);padding:2px 0}",
      ".oculto{display:none}",
      ".lab-cta-nuevo{border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:12px}",
      ".lab-table td.num,.lab-table th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}",
      ".lab-edades{display:flex;align-items:flex-end;gap:14px;height:170px}",
      ".lab-edad{flex:1;display:flex;flex-direction:column;align-items:center;height:100%}",
      ".lab-edad-barras{flex:1;display:flex;align-items:flex-end;gap:3px;width:100%;justify-content:center}",
      ".lab-edad-b{width:22px;border-radius:4px 4px 0 0;min-height:2px}",
      ".lab-edad-b.f{background:#e879a6}.lab-edad-b.m{background:#38bdf8}.lab-edad-b.s{background:#cbd5e1}",
      ".lab-edad-rot{font-size:11.5px;color:var(--text-2);margin-top:6px}",
      ".lab-edad-tot{font-size:13px;font-weight:700}",
      ".lab-edad-ref{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-2);margin-top:10px}",
      ".lab-edad-ref .lab-edad-b{width:12px;height:12px;border-radius:3px;display:inline-block}",
      ".lab-link{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--surface-2,#f1f5f9);border:1px solid var(--border);border-radius:10px;padding:10px 12px}",
      ".lab-link code{font-size:13px;word-break:break-all;flex:1;min-width:200px}",
      ".lab-online-tag{display:inline-block;margin-top:6px;font-size:11.5px;font-weight:700;background:rgba(56,189,248,.15);color:#0369a1;border-radius:6px;padding:2px 8px}",
      ".lab-prep{background:rgba(234,179,8,.14);border:1px solid rgba(234,179,8,.45);border-radius:9px;padding:7px 11px;margin:8px 0;font-size:13px;color:var(--text)}",
      ".lab-repro{border:1px solid var(--border);border-radius:11px;padding:10px 12px;margin-bottom:8px}",
      ".lab-repro-cab{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}",
      ".lab-repro-libres:not(:empty){margin-top:10px;border-top:1px dashed var(--border);padding-top:8px}",
      ".lab-repro-dia{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:5px}",
      ".lab-repro-fecha{font-size:12px;font-weight:700;color:var(--text-2);min-width:78px}",
      ".lab-aviso{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:rgba(234,179,8,.12);border:1px solid rgba(234,179,8,.4);border-radius:10px;padding:8px 12px;font-size:13px;color:var(--text)}",
      ".lab-sala-kpis{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}",
      ".lab-sala-kpi{flex:1 1 100px;border:1px solid var(--border);border-radius:10px;padding:8px 12px;text-align:center}",
      ".lab-sala-kpi b{display:block;font-size:20px;line-height:1.1}",
      ".lab-sala-kpi span{font-size:11px;color:var(--text-2);text-transform:uppercase;letter-spacing:.04em}",
      ".lab-sala-kpi.amar b{color:#b45309}.lab-sala-kpi.verde b{color:#15803d}.lab-sala-kpi.roja b{color:#b91c1c}",
      ".lab-sala-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;align-items:start}",
      ".lab-sala-col{border:1px solid var(--border);border-radius:12px;padding:8px;background:var(--card,#fff)}",
      ".lab-sala-cab{padding:4px 6px 8px;border-bottom:1px solid var(--border);margin-bottom:6px}",
      ".lab-sala-turno{display:grid;grid-template-columns:46px 1fr auto;gap:8px;align-items:center;width:100%;text-align:left;background:transparent;border:0;border-left:3px solid var(--c);border-radius:8px;padding:6px 8px;margin-bottom:3px;cursor:pointer;color:var(--text)}",
      ".lab-sala-turno:hover{background:rgba(45,212,191,.10)}",
      ".lab-sala-hora{font-weight:700;font-size:12.5px;font-variant-numeric:tabular-nums}",
      ".lab-sala-pac{font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".lab-sala-sub{display:block;font-size:11px;color:var(--text-2)}",
      ".lab-sala-est{font-size:10.5px;font-weight:800;color:var(--c);text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}",
      ".lab-sala-espera{display:block;color:#b45309;font-weight:800}",
      ".lab-hc-tabs{display:flex;gap:6px;margin-bottom:10px}",
      ".lab-hc-tab{background:transparent;border:1px solid var(--border);color:var(--text-2);padding:5px 12px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600}",
      ".lab-hc-tab.on{background:var(--accent,#2dd4bf);color:#04201c;border-color:transparent}",
      ".lab-hc-item.es{border-left:3px solid var(--accent,#2dd4bf);padding-left:9px}",
      ".lab-hc-tipo{display:inline-block;background:var(--accent,#2dd4bf);color:#04201c;font-size:10px;font-weight:800;padding:1px 6px;border-radius:5px;letter-spacing:.03em}",
      ".lab-hc-archline{margin-top:5px}",
      ".lab-hc-arch{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--text);text-decoration:none;border:1px solid var(--border);border-radius:8px;padding:4px 9px}",
      ".lab-hc-arch:hover{background:rgba(45,212,191,.10)}",
      ".lab-sec-tit{font-size:12px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.04em;margin:14px 0 6px}",
      ".lab-cal-card{max-width:340px}",
      ".lab-cal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}",
      ".lab-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center}",
      ".lab-cal-w{font-size:11px;color:var(--text-2);padding:2px 0}",
      ".lab-cal-d{position:relative;border:0;background:transparent;color:var(--text);padding:7px 0;border-radius:7px;cursor:pointer;font-size:13px}",
      ".lab-cal-d:hover{background:rgba(45,212,191,.15)}",
      ".lab-cal-d.hoy{outline:1px solid var(--accent,#2dd4bf)}",
      ".lab-cal-d.sel{background:var(--accent,#2dd4bf);color:#04201c;font-weight:700}",
      ".lab-cal-dot{position:absolute;bottom:3px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:transparent}",
      ".lab-cal-dot.on{background:#f59e0b}.lab-cal-d.sel .lab-cal-dot.on{background:#04201c}",
      ".lab-pend{color:#ef4444;font-weight:600}",
      ".lab-tot td{border-top:2px solid var(--border);font-weight:600}",
      ".lab-kpis{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px}",
      ".lab-kpi{flex:1;min-width:120px;background:var(--bg,#f8fafc);border:1px solid var(--border);border-radius:10px;padding:10px 14px}",
      ".lab-kpi span{display:block;font-size:12px;color:var(--text-2)}.lab-kpi b{font-size:20px}.lab-kpi small{font-size:12px;color:var(--text-2);font-weight:600}",
      ".lab-est-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}",
      ".lab-est-card{border:1px solid var(--border);border-radius:10px;padding:12px}.lab-est-card h4{margin:0 0 8px}",
      "textarea.lab-in{resize:vertical;font-family:inherit}",
      ".lab-cierre{margin-top:14px;border-top:2px solid var(--border);padding-top:12px}",
      ".lab-cierre-head{font-size:15px;margin-bottom:8px}",
      ".lab-cierre-actions{display:flex;gap:8px;margin-top:10px}",
      ".lab-chips{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}",
      ".lab-chip{background:var(--bg,#f1f5f9);border:1px solid var(--border);border-radius:20px;padding:4px 12px;font-size:13px}",
      ".lab-dup-grupo{border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px}",
      ".lab-dup-clave{font-weight:700;margin-bottom:8px}",
      ".lab-dup-row{display:block;padding:5px 0;font-size:14px;cursor:pointer}",
      ".lab-presup-h,.lab-presup-row{display:grid;grid-template-columns:1fr 70px 120px 110px 34px;gap:8px;align-items:center}",
      ".lab-presup-h{font-size:11px;color:var(--text-2);text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px}",
      ".lab-presup-row{margin-bottom:6px}.lab-presup-row .pr-sub{text-align:right;font-variant-numeric:tabular-nums}",
      ".lab-presup-tot{text-align:right;font-size:18px;margin:12px 0}",
      "@media(max-width:640px){.lab-presup-h{display:none}.lab-presup-row{grid-template-columns:1fr 1fr}}",
      ".lab-hc-new{border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px}",
      ".lab-hc-item{border-left:3px solid var(--accent,#2dd4bf);padding:6px 0 6px 12px;margin-bottom:12px}",
      ".lab-hc-meta{font-size:13px;margin-bottom:3px}.lab-hc-txt{font-size:14px;white-space:pre-wrap}",
      "@media(max-width:640px){.lab-grid2,.lab-grid3,.lab-est-grid{grid-template-columns:1fr}.lab-ag-fecha{margin-left:0}}",
    ].join("\n");
    document.head.appendChild(css);
  }
})();
