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
    cat: { especialidades: [], profesionales: [], consultorios: [], obrasSociales: [] },
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

  async function api(path, body) { return window.api(path, body); }
  async function req(method, path, body) { return window.req(method, path, body); }

  // ---- init + shell --------------------------------------------------------
  window.labInit = async function () {
    injectCss();
    var root = document.getElementById("view-lab");
    if (!root) return;
    if (!LAB.booted) {
      root.innerHTML = "";
      root.appendChild(shell());
      await cargarBootstrap();
      LAB.booted = true;
    }
    labGo(LAB.modulo || "agenda");
  };

  function shell() {
    var wrap = e("div", { class: "lab-wrap" });
    var nav = e("div", { class: "lab-nav" });
    [["agenda", "📅 Agenda"], ["caja", "💵 Caja"], ["estadistica", "📊 Estadística"], ["pacientes", "👤 Pacientes"], ["profesionales", "🩺 Profesionales"],
     ["especialidades", "🏷️ Especialidades"], ["consultorios", "🚪 Consultorios"], ["obrasSociales", "🩹 Obras Sociales"]]
      .forEach(function (m) {
        var b = e("button", { class: "lab-tab", "data-mod": m[0] }, m[1]);
        b.onclick = function () { labGo(m[0]); };
        nav.appendChild(b);
      });
    wrap.appendChild(nav);
    wrap.appendChild(e("div", { class: "lab-content", id: "lab-content" }));
    return wrap;
  }

  async function cargarBootstrap() {
    var r = await api("/api/lab/bootstrap");
    if (r.ok && r.data) {
      LAB.cat.especialidades = r.data.especialidades || [];
      LAB.cat.profesionales = r.data.profesionales || [];
      LAB.cat.consultorios = r.data.consultorios || [];
      LAB.cat.obrasSociales = r.data.obrasSociales || [];
    }
  }

  function labGo(mod) {
    LAB.modulo = mod;
    document.querySelectorAll(".lab-tab").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-mod") === mod);
    });
    var c = document.getElementById("lab-content");
    if (!c) return;
    if (mod === "agenda") viewAgenda(c);
    else if (mod === "caja") viewCaja(c);
    else if (mod === "estadistica") viewEstadistica(c);
    else if (mod === "pacientes") viewPacientes(c);
    else if (mod === "profesionales") viewProfesionales(c);
    else if (mod === "especialidades") viewCatalogo(c, "especialidades", "Especialidades");
    else if (mod === "consultorios") viewCatalogo(c, "consultorios", "Consultorios");
    else if (mod === "obrasSociales") viewCatalogo(c, "obrasSociales", "Obras Sociales");
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
          '<button class="lab-btn" id="lab-ag-hoy">Hoy</button>' +
        "</div>" +
      "</div>" +
      '<div class="lab-ag-info" id="lab-ag-info"></div>';
    c.appendChild(head);

    c.appendChild(e("div", { class: "lab-card lab-cal-card", id: "lab-ag-cal" }));

    var leyenda = e("div", { class: "lab-leyenda" }, Object.keys(ESTADOS).filter(function (k) { return k !== "cancelado"; }).map(function (k) {
      return '<span class="lab-lg"><i style="background:' + ESTADOS[k].color + '"></i>' + esc(ESTADOS[k].label) + "</span>";
    }).join(""));
    c.appendChild(leyenda);

    c.appendChild(e("div", { class: "lab-card", id: "lab-ag-grid" }, '<div class="lab-muted" style="padding:20px">Cargando…</div>'));

    // eventos
    document.getElementById("lab-ag-esp").onchange = function () { LAB.ag.especialidadId = this.value; LAB.ag.profesionalId = ""; viewAgenda(c); };
    document.getElementById("lab-ag-prof").onchange = function () { LAB.ag.profesionalId = this.value; agLoad(); };
    document.getElementById("lab-ag-date").onchange = function () { LAB.ag.fecha = this.value; agLoad(); };
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

  async function agLoad() {
    var grid = document.getElementById("lab-ag-grid");
    var info = document.getElementById("lab-ag-info");
    if (!grid) return;
    grid.innerHTML = '<div class="lab-muted" style="padding:20px">Cargando…</div>';
    var r = await api("/api/lab/turnos?profesionalId=" + encodeURIComponent(LAB.ag.profesionalId) + "&fecha=" + encodeURIComponent(LAB.ag.fecha));
    if (!r.ok) { grid.innerHTML = '<div class="lab-muted" style="padding:20px">' + esc((r.data && r.data.error) || "Error") + "</div>"; return; }
    var d = new Date(LAB.ag.fecha + "T00:00:00");
    if (info) info.innerHTML = "<b>" + DOW[d.getDay()] + "</b> " + LAB.ag.fecha.split("-").reverse().join("/") +
      " · " + esc(r.data.profesional.nombre) + (r.data.profesional.consultorioId ? " · " + esc(nombreCons(r.data.profesional.consultorioId)) : "") +
      " · <b>" + r.data.cantidad + "</b> turno" + (r.data.cantidad === 1 ? "" : "s");
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
          '<label>Importe consulta<input class="lab-in" id="bk-importe" type="number" min="0" step="100" value="' + valorDef + '" placeholder="0"></label>' +
        "</div>" +
        '<label>Motivo<input class="lab-in" id="bk-motivo" placeholder="Consulta, control, estudio…"></label>' +
      "</div>" +
      '<div class="lab-modal-actions"><button class="lab-btn ghost" id="bk-cancel">Cancelar</button><button class="lab-btn primary" id="bk-ok">Dar turno</button></div>';
    var selPacId = "";
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
      };
      var r = await api("/api/lab/turnos", payload);
      if (!r.ok) { toast((r.data && r.data.error) || "No se pudo dar el turno.", true); this.disabled = false; return; }
      labClose(); toast("Turno dado ✓"); agLoad();
    };
    setTimeout(function () { buscar.focus(); }, 50);
  }

  // Detalle de un turno: cambiar estado / editar / cancelar.
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
        '<div class="lab-muted">' + [esc(t.documento), esc(t.obraSocial), esc(t.motivo)].filter(Boolean).join(" · ") + "</div>" +
      "</div>" +
      '<div class="lab-sec-tit">Estado</div>' +
      '<div class="lab-estados">' + Object.keys(ESTADOS).filter(function (k) { return k !== "cancelado"; }).map(function (k) {
        return '<button class="lab-est-btn' + (t.estado === k ? " on" : "") + '" data-est="' + k + '" style="--c:' + ESTADOS[k].color + '">' + esc(ESTADOS[k].label) + "</button>";
      }).join("") + "</div>" +
      '<div class="lab-sec-tit">Cobro</div>' +
      '<div class="lab-grid3">' +
        '<label>Importe<input class="lab-in" id="tn-imp" type="number" min="0" step="100" value="' + (t.importe || 0) + '"></label>' +
        '<label>Seña<input class="lab-in" id="tn-sena" type="number" min="0" step="100" value="' + (t.sena || 0) + '"></label>' +
        '<label>Insumos<input class="lab-in" id="tn-ins" type="number" min="0" step="100" value="' + (t.insumos || 0) + '"></label>' +
        '<label>Medio<select class="lab-in" id="tn-medio"><option value="">—</option>' + ["Efectivo", "Débito", "Crédito", "Transferencia", "Mercado Pago"].map(function (x) { return "<option" + (t.medioPago === x ? " selected" : "") + ">" + x + "</option>"; }).join("") + "</select></label>" +
        '<label class="lab-chk"><input type="checkbox" id="tn-pag"' + (t.pagado ? " checked" : "") + "> Cobrado</label>" +
      "</div>" +
      '<div class="lab-modal-actions"><button class="lab-btn ghost danger" id="tn-cancel">Cancelar turno</button><button class="lab-btn primary" id="tn-guardar">Guardar cobro</button></div>';
    m.body.querySelectorAll(".lab-est-btn").forEach(function (b) {
      b.onclick = async function () {
        var est = b.getAttribute("data-est");
        var rr = await req("PUT", "/api/lab/turnos/" + id, { estado: est });
        if (!rr.ok) { toast("No se pudo cambiar el estado.", true); return; }
        m.body.querySelectorAll(".lab-est-btn").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on"); t.estado = est; toast("Estado: " + ESTADOS[est].label); agLoad();
      };
    });
    m.body.querySelector("#tn-guardar").onclick = async function () {
      var rr = await req("PUT", "/api/lab/turnos/" + id, {
        importe: m.body.querySelector("#tn-imp").value, sena: m.body.querySelector("#tn-sena").value,
        insumos: m.body.querySelector("#tn-ins").value, medioPago: m.body.querySelector("#tn-medio").value,
        pagado: m.body.querySelector("#tn-pag").checked,
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
      var payload = { nombre: nombre, matricula: m.body.querySelector("#pf-mat").value, especialidadId: m.body.querySelector("#pf-esp").value, consultorioId: m.body.querySelector("#pf-cons").value, valorConsulta: m.body.querySelector("#pf-valor").value, horarios: horarios };
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
          '<td style="white-space:nowrap"><button class="lab-btn xs ghost lab-pac-turnos" title="Turnos">📅</button> <button class="lab-btn xs ghost lab-pac-presup" title="Presupuesto">💰</button> <button class="lab-btn xs ghost lab-pac-hc">📋 H.C.</button> <button class="lab-btn xs ghost lab-pac-edit">Editar</button></td></tr>';
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

  // Historia clínica: evoluciones del paciente (timeline + alta).
  async function hcModal(p) {
    if (!p) return;
    var m = modal("Historia clínica · " + [p.apellido, p.nombre].filter(Boolean).join(", "), { ancho: "ancho" });
    var profOpts = '<option value="">— Profesional —</option>' + LAB.cat.profesionales.map(function (o) { return '<option value="' + o.id + '">' + esc(o.nombre) + "</option>"; }).join("");
    m.body.innerHTML =
      '<div class="lab-hc-new"><div class="lab-grid3">' +
        '<label>Fecha<input class="lab-in" type="date" id="hc-fecha" value="' + hoyISO() + '"></label>' +
        '<label>Profesional<select class="lab-in" id="hc-prof">' + profOpts + "</select></label>" +
        '<label>Motivo<input class="lab-in" id="hc-motivo" placeholder="Consulta, control…"></label>' +
      "</div>" +
      '<label>Evolución<textarea class="lab-in" id="hc-texto" rows="3" placeholder="Escribí la evolución del paciente…"></textarea></label>' +
      '<div style="text-align:right"><button class="lab-btn primary" id="hc-add">Agregar evolución</button></div></div>' +
      '<div class="lab-sec-tit">Evoluciones</div><div id="hc-list"><div class="lab-muted">Cargando…</div></div>';
    async function load() {
      var r = await api("/api/lab/pacientes/" + p.id + "/evoluciones");
      var items = (r.data && r.data.items) || [];
      var box = m.body.querySelector("#hc-list");
      box.innerHTML = items.length ? items.map(function (ev) {
        return '<div class="lab-hc-item"><div class="lab-hc-meta"><b>' + esc((ev.fecha || "").split("-").reverse().join("/")) + "</b>" +
          (ev.profesionalId ? " · " + esc(nombreProf(ev.profesionalId)) : "") + (ev.motivo ? " · " + esc(ev.motivo) : "") +
          ' <span class="lab-muted">(' + esc(ev.creadoPor || "") + ")</span></div>" +
          '<div class="lab-hc-txt">' + esc(ev.texto).replace(/\n/g, "<br>") + "</div></div>";
      }).join("") : '<div class="lab-muted">Sin evoluciones todavía.</div>';
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
    load();
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
      ".lab-wrap{max-width:1200px;margin:0 auto}",
      ".lab-nav{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:10px}",
      ".lab-tab{background:transparent;border:1px solid var(--border);color:var(--text-2);padding:7px 14px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600}",
      ".lab-tab.on{background:var(--accent,#2dd4bf);color:#04201c;border-color:transparent}",
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
