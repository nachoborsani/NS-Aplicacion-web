// ============================================================================
// Laboratorio — Sistema de gestión para centros médicos (en desarrollo).
// Mini-app aislada del resto de NS: rutas /api/lab/*, almacén propio
// (lab_gestion.json). Pensado para replicar/mejorar GestionSalud: agenda de
// turnos, pacientes, caja, estadística. Solo admin.
//
// Arranca por la AGENDA (el corazón del sistema). El resto de los módulos se
// van sumando sobre este mismo almacén.
// ============================================================================
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const clean = (v) => String(v == null ? "" : v).trim();
const soloDigitos = (v) => clean(v).replace(/\D/g, "");
const money = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
const normNombre = (v) => clean(v).toLowerCase().normalize("NFD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function storeFile(dataDir) { return path.join(dataDir, "lab_gestion.json"); }
// Los archivos de los estudios NO van adentro del JSON: se guardan al lado, uno por
// archivo, con el id del estudio como nombre. Un PDF de ecografia pesa 10 MB.
function estudiosDir(dataDir) { return path.join(dataDir, "lab_estudios"); }

// Tipos de estudio. Sale del mapa de Global App, que es el que usan los centros de
// verdad: la ficha de la historia clinica dice QUE es antes de abrir el archivo.
const TIPOS_ESTUDIO = [
  { cod: "CONS", nombre: "Consulta / evolución" },
  { cod: "EC", nombre: "Ecografía" },
  { cod: "EDC", nombre: "Ecodoppler cardíaco" },
  { cod: "EVC", nombre: "Ecodoppler de vasos de cuello" },
  { cod: "EDA", nombre: "Ecodoppler arterial" },
  { cod: "EDV", nombre: "Ecodoppler venoso" },
  { cod: "ECG", nombre: "Electrocardiograma" },
  { cod: "HOL", nombre: "Holter" },
  { cod: "MAP", nombre: "Presurometría (MAPA)" },
  { cod: "ERG", nombre: "Ergometría" },
  { cod: "ESP", nombre: "Espirometría" },
  { cod: "LAB", nombre: "Laboratorio" },
  { cod: "RX", nombre: "Radiología" },
  { cod: "INF", nombre: "Otro informe" },
  { cod: "DOC", nombre: "Documentación (orden, carnet)" },
];
const EXT_OK = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png" };

// Cache en memoria con invalidación por mtime (igual patrón que los otros stores
// de NS): el archivo puede ser grande y se lee en cada request.
let _cache = null;
let _cacheMtime = -1;
function emptyStore() {
  return {
    especialidades: [],
    profesionales: [],
    consultorios: [],
    obrasSociales: [],
    pacientes: [],
    turnos: [],
    practicas: [],
    evoluciones: [],
    estudios: [],
    cierres: [],
    presupuestos: [],
    seqPresup: 0,
    version: 1,
  };
}
function seedStore() {
  const s = emptyStore();
  // Especialidades frecuentes en un centro ambulatorio argentino.
  ["Clínica Médica", "Cardiología", "Ginecología", "Pediatría", "Dermatología",
   "Traumatología", "Oftalmología", "Otorrinolaringología", "Urología",
   "Neurología", "Diagnóstico por Imágenes", "Kinesiología"]
    .forEach((nombre) => s.especialidades.push({ id: uid(), nombre, activo: true }));
  // Obras sociales base (las que usa el centro real).
  ["PARTICULAR", "PAMI", "IOMA"].forEach((nombre) =>
    s.obrasSociales.push({ id: uid(), nombre, activo: true }));
  ["Consultorio 1", "Consultorio 2", "Consultorio 3"].forEach((nombre) =>
    s.consultorios.push({ id: uid(), nombre, activo: true }));
  return s;
}
function loadStore(dataDir) {
  try {
    const mtime = fs.statSync(storeFile(dataDir)).mtimeMs;
    if (_cache && mtime === _cacheMtime) return _cache;
    const parsed = JSON.parse(fs.readFileSync(storeFile(dataDir), "utf8"));
    _cache = Object.assign(emptyStore(), parsed);
    _cacheMtime = mtime;
    return _cache;
  } catch {
    // No existe todavía: sembramos y guardamos.
    const s = seedStore();
    try { saveStore(dataDir, s); } catch { /* ro fs */ }
    return s;
  }
}
function saveStore(dataDir, store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(storeFile(dataDir), JSON.stringify(store, null, 2));
  try { _cacheMtime = fs.statSync(storeFile(dataDir)).mtimeMs; _cache = store; } catch { _cacheMtime = -1; }
}

// Colecciones simples con CRUD genérico (las que son catálogo plano).
const COLECCIONES = {
  especialidades: { campos: ["nombre", "activo"] },
  consultorios: { campos: ["nombre", "activo"] },
  obrasSociales: { campos: ["nombre", "codigo", "activo"] },
};

function sanitizeGenerico(campos, body, previo) {
  const out = Object.assign({}, previo || {});
  campos.forEach((c) => {
    if (c === "activo") out.activo = body.activo === undefined ? (previo ? previo.activo : true) : !!body.activo;
    else if (body[c] !== undefined) out[c] = clean(body[c]);
    else if (previo) out[c] = previo[c];
    else out[c] = "";
  });
  return out;
}

// --- Profesionales ----------------------------------------------------------
// horarios: bloques de atención por día de semana (0=Dom..6=Sáb). De cada bloque
// se generan los turnos: desde/hasta + duración en minutos.
function sanitizeProfesional(body, previo) {
  const p = Object.assign({}, previo || {});
  p.nombre = body.nombre !== undefined ? clean(body.nombre) : (p.nombre || "");
  p.matricula = body.matricula !== undefined ? clean(body.matricula) : (p.matricula || "");
  p.especialidadId = body.especialidadId !== undefined ? clean(body.especialidadId) : (p.especialidadId || "");
  p.consultorioId = body.consultorioId !== undefined ? clean(body.consultorioId) : (p.consultorioId || "");
  p.color = body.color !== undefined ? clean(body.color) : (p.color || "#2dd4bf");
  p.valorConsulta = body.valorConsulta !== undefined ? (Math.round((parseFloat(body.valorConsulta) || 0) * 100) / 100) : (previo && previo.valorConsulta || 0);
  p.activo = body.activo === undefined ? (previo ? previo.activo : true) : !!body.activo;
  if (body.horarios !== undefined) {
    p.horarios = (Array.isArray(body.horarios) ? body.horarios : []).map((h) => ({
      dow: Math.max(0, Math.min(6, parseInt(h.dow, 10) || 0)),
      desde: clean(h.desde) || "08:00",
      hasta: clean(h.hasta) || "12:00",
      duracionMin: Math.max(5, Math.min(240, parseInt(h.duracionMin, 10) || 15)),
    }));
  } else if (!p.horarios) p.horarios = [];
  return p;
}

// --- Pacientes --------------------------------------------------------------
function sanitizePaciente(body, previo) {
  const p = Object.assign({}, previo || {});
  const set = (k, def) => { p[k] = body[k] !== undefined ? clean(body[k]) : (previo ? previo[k] : (def || "")); };
  set("apellido"); set("nombre"); set("documento"); set("fechaNac"); set("sexo");
  set("celular"); set("email"); set("obraSocial"); set("nroAfiliado"); set("plan");
  set("localidad"); set("direccion"); set("observaciones");
  return p;
}

// Genera los slots de un profesional para una fecha (YYYY-MM-DD) a partir de sus
// horarios, y superpone los turnos ya dados. Devuelve la grilla de la agenda.
function generarSlots(prof, fecha, turnosDelDia) {
  const dow = new Date(fecha + "T00:00:00").getDay();
  const bloques = (prof.horarios || []).filter((h) => h.dow === dow);
  const porHora = {};
  turnosDelDia.forEach((t) => { porHora[t.hora] = t; });
  const slots = [];
  bloques.forEach((b) => {
    const [hd, md] = b.desde.split(":").map((x) => parseInt(x, 10));
    const [hh, mh] = b.hasta.split(":").map((x) => parseInt(x, 10));
    let min = hd * 60 + md;
    const fin = hh * 60 + mh;
    const dur = b.duracionMin || 15;
    let guard = 0;
    while (min < fin && guard++ < 500) {
      const hora = String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
      slots.push({ hora, turno: porHora[hora] || null });
      min += dur;
    }
  });
  // Turnos fuera de los bloques (sobreturnos) igual se muestran.
  turnosDelDia.forEach((t) => {
    if (!slots.some((s) => s.hora === t.hora)) slots.push({ hora: t.hora, turno: t, sobreturno: true });
  });
  slots.sort((a, b) => a.hora.localeCompare(b.hora));
  return slots;
}

const ESTADOS_TURNO = ["dado", "esperando", "atendido", "ausente", "ausente_aviso", "cancelado"];
function sanitizeTurno(body, previo, store) {
  const t = Object.assign({}, previo || {});
  t.profesionalId = body.profesionalId !== undefined ? clean(body.profesionalId) : (t.profesionalId || "");
  t.especialidadId = body.especialidadId !== undefined ? clean(body.especialidadId) : (t.especialidadId || "");
  t.fecha = body.fecha !== undefined ? clean(body.fecha) : (t.fecha || "");
  t.hora = body.hora !== undefined ? clean(body.hora) : (t.hora || "");
  t.pacienteId = body.pacienteId !== undefined ? clean(body.pacienteId) : (t.pacienteId || "");
  t.pacienteNombre = body.pacienteNombre !== undefined ? clean(body.pacienteNombre) : (t.pacienteNombre || "");
  t.documento = body.documento !== undefined ? soloDigitos(body.documento) : (t.documento || "");
  t.celular = body.celular !== undefined ? clean(body.celular) : (t.celular || "");
  t.obraSocial = body.obraSocial !== undefined ? clean(body.obraSocial) : (t.obraSocial || "");
  t.nroAfiliado = body.nroAfiliado !== undefined ? clean(body.nroAfiliado) : (t.nroAfiliado || "");
  t.practicaId = body.practicaId !== undefined ? clean(body.practicaId) : (t.practicaId || "");
  // El nombre se copia al turno a proposito: si despues renombran o borran la
  // practica, el turno viejo tiene que seguir diciendo que se hizo.
  t.practicaNombre = body.practicaNombre !== undefined ? clean(body.practicaNombre) : (t.practicaNombre || "");
  t.motivo = body.motivo !== undefined ? clean(body.motivo) : (t.motivo || "");
  t.observaciones = body.observaciones !== undefined ? clean(body.observaciones) : (t.observaciones || "");
  t.estado = ESTADOS_TURNO.includes(body.estado) ? body.estado : (t.estado || "dado");
  // Cobro (para Caja): importe de la consulta, seña, insumos, si se cobró y medio.
  const money = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
  if (body.importe !== undefined) t.importe = money(body.importe); else if (t.importe === undefined) t.importe = 0;
  if (body.sena !== undefined) t.sena = money(body.sena); else if (t.sena === undefined) t.sena = 0;
  if (body.insumos !== undefined) t.insumos = money(body.insumos); else if (t.insumos === undefined) t.insumos = 0;
  if (body.pagado !== undefined) t.pagado = !!body.pagado; else if (t.pagado === undefined) t.pagado = false;
  t.medioPago = body.medioPago !== undefined ? clean(body.medioPago) : (t.medioPago || "");
  // Si viene pacienteId, completamos nombre/doc/OS desde la ficha.
  if (t.pacienteId) {
    const pac = (store.pacientes || []).find((x) => x.id === t.pacienteId);
    if (pac) {
      t.pacienteNombre = t.pacienteNombre || [pac.apellido, pac.nombre].filter(Boolean).join(", ");
      t.documento = t.documento || pac.documento;
      t.celular = t.celular || pac.celular;
      t.obraSocial = t.obraSocial || pac.obraSocial;
      t.nroAfiliado = t.nroAfiliado || pac.nroAfiliado;
    }
  }
  return t;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function handleLab(ctx) {
  const { req, res, method, p, url, me, json, readBody, dataDir } = ctx;
  if (!me) { json(res, 401, { error: "no-auth" }); return true; }
  if (me.role !== "admin") { json(res, 403, { error: "El Laboratorio es solo para administradores." }); return true; }

  const seg = p.slice("/api/lab/".length).split("/").filter(Boolean); // ["turnos", "<id>"]
  const recurso = seg[0] || "";
  const idPath = seg[1] || "";
  const store = loadStore(dataDir);

  // -- Bootstrap: todo lo que la UI necesita para arrancar --
  if (recurso === "bootstrap" && method === "GET") {
    return json(res, 200, {
      especialidades: store.especialidades,
      profesionales: store.profesionales,
      consultorios: store.consultorios,
      obrasSociales: store.obrasSociales,
      practicas: store.practicas || [],
      totales: { pacientes: (store.pacientes || []).length, turnos: (store.turnos || []).length },
    }), true;
  }

  // -- Practicas del centro, con su valor por obra social --
  // Va aparte del CRUD generico porque `valores` no es un campo de texto: es un mapa
  // { idObraSocial: importe } y hay que validarlo contra el catalogo.
  if (recurso === "practicas") {
    const lista = store.practicas || (store.practicas = []);
    if (method === "GET") return json(res, 200, { items: lista, obrasSociales: store.obrasSociales || [] }), true;
    if (method === "POST" || (method === "PUT" && idPath)) {
      const body = await readBody(req);
      const previo = method === "PUT" ? lista.find((x) => x.id === idPath) : null;
      if (method === "PUT" && !previo) return json(res, 404, { error: "Esa práctica no existe." }), true;
      const item = Object.assign({ id: uid(), valores: {} }, previo || {});
      if (body.nombre !== undefined) item.nombre = clean(body.nombre);
      if (body.codigo !== undefined) item.codigo = clean(body.codigo);
      if (body.especialidadId !== undefined) item.especialidadId = clean(body.especialidadId);
      item.activo = body.activo === undefined ? (previo ? previo.activo !== false : true) : !!body.activo;
      if (!item.nombre) return json(res, 400, { error: "Ponele un nombre a la práctica." }), true;
      // Ojo con el vacio: una obra social SIN valor cargado no es lo mismo que una en
      // cero. Solo se guarda lo que tiene importe, asi el turno puede decir "todavia
      // no hay valor para IOMA" en vez de poner $0 y que alguien lo cobre asi.
      if (body.valores && typeof body.valores === "object") {
        const vals = {};
        Object.keys(body.valores).forEach((k) => {
          if (!(store.obrasSociales || []).some((o) => o.id === k)) return;
          const crudo = body.valores[k];
          if (crudo === "" || crudo === null || crudo === undefined) return;
          const n = money(crudo);
          if (n > 0) vals[k] = n;
        });
        item.valores = vals;
      }
      if (previo) Object.assign(previo, item); else lista.unshift(item);
      saveStore(dataDir, store);
      return json(res, 200, { item }), true;
    }
    if (method === "DELETE" && idPath) {
      store.practicas = lista.filter((x) => x.id !== idPath);
      saveStore(dataDir, store);
      return json(res, 200, { ok: true }), true;
    }
  }

  // -- Colecciones catálogo (especialidades, consultorios, obrasSociales) --
  if (COLECCIONES[recurso]) {
    const def = COLECCIONES[recurso];
    const lista = store[recurso] || (store[recurso] = []);
    if (method === "GET") return json(res, 200, { items: lista }), true;
    if (method === "POST") {
      const body = await readBody(req);
      const item = Object.assign({ id: uid() }, sanitizeGenerico(def.campos, body));
      lista.unshift(item); saveStore(dataDir, store);
      return json(res, 200, { item }), true;
    }
    if (method === "PUT" && idPath) {
      const idx = lista.findIndex((x) => x.id === idPath);
      if (idx < 0) return json(res, 404, { error: "No encontrado." }), true;
      const body = await readBody(req);
      lista[idx] = Object.assign({}, lista[idx], sanitizeGenerico(def.campos, body, lista[idx]));
      saveStore(dataDir, store);
      return json(res, 200, { item: lista[idx] }), true;
    }
    if (method === "DELETE" && idPath) {
      store[recurso] = lista.filter((x) => x.id !== idPath); saveStore(dataDir, store);
      return json(res, 200, { ok: true }), true;
    }
  }

  // -- Caja: cierre diario formal (arqueo) --
  if (recurso === "caja" && idPath === "cierre") {
    const fecha = clean(url.searchParams.get("fecha"));
    if (!fecha) return json(res, 400, { error: "Falta la fecha." }), true;
    const cierres = store.cierres || (store.cierres = []);
    const calcular = () => {
      const delDia = (store.turnos || []).filter((t) => t.fecha === fecha && t.estado !== "cancelado");
      const cobrados = delDia.filter((t) => t.pagado);
      const porMedio = {}; const porProf = {};
      let cobrado = 0, sena = 0, insumos = 0;
      cobrados.forEach((t) => {
        const monto = (Number(t.importe) || 0) + (Number(t.insumos) || 0);
        cobrado += monto; sena += Number(t.sena) || 0; insumos += Number(t.insumos) || 0;
        const medio = t.medioPago || "Sin especificar";
        porMedio[medio] = money((porMedio[medio] || 0) + monto);
        const pid = t.profesionalId || "-";
        if (!porProf[pid]) porProf[pid] = { profesionalId: pid, monto: 0, turnos: 0 };
        porProf[pid].monto = money(porProf[pid].monto + monto); porProf[pid].turnos++;
      });
      return { cobrado: money(cobrado), sena: money(sena), insumos: money(insumos),
        turnos: delDia.length, turnosCobrados: cobrados.length, porMedio, porProfesional: Object.values(porProf) };
    };
    const existente = cierres.find((c) => c.fecha === fecha);
    if (method === "GET") return json(res, 200, { cerrado: !!existente, cierre: existente || null, preview: calcular() }), true;
    if (method === "POST") {
      if (existente) return json(res, 409, { error: "La caja de ese día ya está cerrada." }), true;
      const cierre = { id: uid(), fecha, totales: calcular(), cerradoPor: me.username, cerradoEl: nowIso() };
      cierres.unshift(cierre); saveStore(dataDir, store);
      return json(res, 200, { cierre }), true;
    }
    if (method === "DELETE") { store.cierres = cierres.filter((c) => c.fecha !== fecha); saveStore(dataDir, store); return json(res, 200, { ok: true }), true; }
  }

  // -- Profesionales --
  if (recurso === "profesionales") {
    const lista = store.profesionales;
    if (method === "GET") return json(res, 200, { items: lista }), true;
    if (method === "POST") {
      const body = await readBody(req);
      const item = Object.assign({ id: uid(), creadoEl: nowIso() }, sanitizeProfesional(body));
      lista.unshift(item); saveStore(dataDir, store);
      return json(res, 200, { item }), true;
    }
    if (method === "PUT" && idPath) {
      const idx = lista.findIndex((x) => x.id === idPath);
      if (idx < 0) return json(res, 404, { error: "No encontrado." }), true;
      const body = await readBody(req);
      lista[idx] = sanitizeProfesional(body, lista[idx]);
      saveStore(dataDir, store);
      return json(res, 200, { item: lista[idx] }), true;
    }
    if (method === "DELETE" && idPath) {
      store.profesionales = lista.filter((x) => x.id !== idPath); saveStore(dataDir, store);
      return json(res, 200, { ok: true }), true;
    }
  }

  // -- Historia clínica (evoluciones) de un paciente: /pacientes/:id/evoluciones --
  if (recurso === "pacientes" && seg[2] === "evoluciones") {
    const pacId = idPath;
    if (!store.evoluciones) store.evoluciones = [];
    if (method === "GET") {
      const items = store.evoluciones.filter((x) => x.pacienteId === pacId)
        .sort((a, b) => String(b.fecha + b.creadoEl).localeCompare(String(a.fecha + a.creadoEl)));
      return json(res, 200, { items }), true;
    }
    if (method === "POST") {
      const body = await readBody(req);
      const ev = {
        id: uid(), pacienteId: pacId,
        fecha: clean(body.fecha) || nowIso().slice(0, 10),
        profesionalId: clean(body.profesionalId),
        motivo: clean(body.motivo),
        texto: clean(body.texto),
        creadoEl: nowIso(), creadoPor: me.username,
      };
      if (!ev.texto) return json(res, 400, { error: "La evolución no puede estar vacía." }), true;
      store.evoluciones.push(ev); saveStore(dataDir, store);
      return json(res, 200, { item: ev }), true;
    }
  }

  // -- Estudios del paciente: /pacientes/:id/estudios --
  // Un estudio es una ficha de la historia clinica: fecha, tipo, profesional, el
  // texto del informe y (opcional) el archivo. El archivo se sube aparte, porque va
  // como multipart y no entra en el JSON.
  if (recurso === "pacientes" && seg[2] === "estudios") {
    if (!store.estudios) store.estudios = [];
    const pacId = idPath;
    if (method === "GET") {
      const items = store.estudios.filter((x) => x.pacienteId === pacId)
        .sort((a, b) => String(b.fecha + b.creadoEl).localeCompare(String(a.fecha + a.creadoEl)));
      return json(res, 200, { items, tipos: TIPOS_ESTUDIO }), true;
    }
    if (method === "POST") {
      const body = await readBody(req);
      if (!(store.pacientes || []).some((x) => x.id === pacId)) {
        return json(res, 404, { error: "Ese paciente no existe." }), true;
      }
      const cod = clean(body.tipo).toUpperCase();
      const tipo = TIPOS_ESTUDIO.find((t) => t.cod === cod) || TIPOS_ESTUDIO[0];
      const est = {
        id: uid(), pacienteId: pacId,
        turnoId: clean(body.turnoId),
        fecha: clean(body.fecha) || nowIso().slice(0, 10),
        tipo: tipo.cod, tipoNombre: tipo.nombre,
        profesionalId: clean(body.profesionalId),
        especialidadId: clean(body.especialidadId),
        practica: clean(body.practica),
        texto: clean(body.texto),
        archivo: null,
        creadoEl: nowIso(), creadoPor: me.username,
      };
      store.estudios.push(est); saveStore(dataDir, store);
      return json(res, 200, { item: est }), true;
    }
  }

  // -- El archivo de un estudio: /estudios/:id/archivo --
  if (recurso === "estudios" && seg[2] === "archivo") {
    const est = (store.estudios || []).find((x) => x.id === idPath);
    if (!est) return json(res, 404, { error: "Ese estudio no existe." }), true;
    if (method === "POST") {
      try {
        const raw = await ctx.readBuffer(req);
        const mp = ctx.extractMultipart(raw, req.headers["content-type"]);
        const mime = clean(mp.file.contentType || "").toLowerCase().split(";")[0];
        const ext = EXT_OK[mime] || path.extname(mp.file.filename || "").toLowerCase();
        if (![".pdf", ".jpg", ".jpeg", ".png"].includes(ext)) {
          return json(res, 400, { error: "El estudio se adjunta como PDF o imagen." }), true;
        }
        const dir = estudiosDir(dataDir);
        fs.mkdirSync(dir, { recursive: true });
        const guardadoComo = est.id + ext;
        fs.writeFileSync(path.join(dir, guardadoComo), mp.file.data);
        est.archivo = {
          nombre: clean(mp.file.filename) || ("estudio" + ext),
          mime: mime || "application/pdf",
          tamano: mp.file.data.length,
          guardadoComo,
          subidoEl: nowIso(), subidoPor: me.username,
        };
        saveStore(dataDir, store);
        return json(res, 200, { item: est }), true;
      } catch (error) {
        return json(res, 400, { error: error.message || "No se pudo subir el archivo." }), true;
      }
    }
    if (method === "GET") {
      if (!est.archivo) return json(res, 404, { error: "Ese estudio no tiene archivo." }), true;
      const file = path.join(estudiosDir(dataDir), est.archivo.guardadoComo);
      if (!fs.existsSync(file)) return json(res, 404, { error: "El archivo no está en el servidor." }), true;
      const buf = fs.readFileSync(file);
      res.writeHead(200, {
        "content-type": est.archivo.mime || "application/pdf",
        "content-length": buf.length,
        // inline: se abre en el visor, que es como se mira un informe.
        "content-disposition": 'inline; filename="' + String(est.archivo.nombre).replace(/[^\x20-\x7E]/g, "_") + '"',
        "cache-control": "no-store",
      });
      res.end(buf);
      return true;
    }
  }

  // -- Borrar un estudio (se lleva su archivo) --
  if (recurso === "estudios" && idPath && !seg[2] && method === "DELETE") {
    const est = (store.estudios || []).find((x) => x.id === idPath);
    if (!est) return json(res, 404, { error: "Ese estudio no existe." }), true;
    if (est.archivo) {
      try { fs.unlinkSync(path.join(estudiosDir(dataDir), est.archivo.guardadoComo)); } catch { /* ya no estaba */ }
    }
    store.estudios = store.estudios.filter((x) => x.id !== idPath);
    saveStore(dataDir, store);
    return json(res, 200, { ok: true }), true;
  }

  // -- Pacientes: detectar duplicados y unificar --
  if (recurso === "pacientes" && idPath === "duplicados" && method === "GET") {
    const pacientes = store.pacientes || [];
    const grupos = [];
    const porDoc = {};
    pacientes.forEach((p) => { const d = soloDigitos(p.documento); if (d) (porDoc[d] = porDoc[d] || []).push(p); });
    Object.keys(porDoc).forEach((d) => { if (porDoc[d].length > 1) grupos.push({ clave: "DNI " + d, pacientes: porDoc[d] }); });
    const yaEn = new Set(grupos.flatMap((g) => g.pacientes.map((p) => p.id)));
    const porNom = {};
    pacientes.forEach((p) => { if (yaEn.has(p.id)) return; const n = normNombre([p.apellido, p.nombre].join(" ")); if (n && n.length > 3) (porNom[n] = porNom[n] || []).push(p); });
    Object.keys(porNom).forEach((n) => { if (porNom[n].length > 1) grupos.push({ clave: [porNom[n][0].apellido, porNom[n][0].nombre].filter(Boolean).join(", "), pacientes: porNom[n] }); });
    return json(res, 200, { grupos }), true;
  }
  if (recurso === "pacientes" && idPath === "unificar" && method === "POST") {
    const body = await readBody(req);
    const mantener = clean(body.mantener);
    const fusionar = (Array.isArray(body.fusionar) ? body.fusionar : []).map(clean).filter((x) => x && x !== mantener);
    if (!mantener || !fusionar.length) return json(res, 400, { error: "Elegí a quién mantener y cuáles fusionar." }), true;
    const set = new Set(fusionar);
    let turnosMov = 0, evolMov = 0, estMov = 0;
    (store.turnos || []).forEach((t) => { if (set.has(t.pacienteId)) { t.pacienteId = mantener; turnosMov++; } });
    (store.evoluciones || []).forEach((e) => { if (set.has(e.pacienteId)) { e.pacienteId = mantener; evolMov++; } });
    // Los estudios (con su archivo) van con la historia clinica: si no, el informe
    // queda colgado de una ficha que dejo de existir.
    (store.estudios || []).forEach((x) => { if (set.has(x.pacienteId)) { x.pacienteId = mantener; estMov++; } });
    store.pacientes = (store.pacientes || []).filter((p) => !set.has(p.id));
    saveStore(dataDir, store);
    return json(res, 200, { ok: true, fusionados: fusionar.length, turnosMovidos: turnosMov, evolucionesMovidas: evolMov, estudios: estMov }), true;
  }

  // -- Pacientes --
  if (recurso === "pacientes") {
    const lista = store.pacientes;
    if (method === "GET" && !idPath) {
      const q = clean(url.searchParams.get("q")).toLowerCase();
      const qd = soloDigitos(q);
      let items = lista;
      if (q) {
        items = lista.filter((x) => {
          const nom = [x.apellido, x.nombre].filter(Boolean).join(" ").toLowerCase();
          return nom.includes(q) || (qd && soloDigitos(x.documento).includes(qd)) ||
            (qd && soloDigitos(x.celular).includes(qd)) || (qd && soloDigitos(x.nroAfiliado).includes(qd));
        });
      }
      return json(res, 200, { items: items.slice(0, 50), total: lista.length }), true;
    }
    if (method === "GET" && idPath) {
      const pac = lista.find((x) => x.id === idPath);
      return pac ? (json(res, 200, { item: pac }), true) : (json(res, 404, { error: "No encontrado." }), true);
    }
    if (method === "POST") {
      const body = await readBody(req);
      const item = Object.assign({ id: uid(), creadoEl: nowIso() }, sanitizePaciente(body));
      lista.unshift(item); saveStore(dataDir, store);
      return json(res, 200, { item }), true;
    }
    if (method === "PUT" && idPath) {
      const idx = lista.findIndex((x) => x.id === idPath);
      if (idx < 0) return json(res, 404, { error: "No encontrado." }), true;
      const body = await readBody(req);
      lista[idx] = sanitizePaciente(body, lista[idx]);
      saveStore(dataDir, store);
      return json(res, 200, { item: lista[idx] }), true;
    }
    if (method === "DELETE" && idPath) {
      const turnosFuturos = (store.turnos || []).filter((t) => t.pacienteId === idPath && t.estado !== "cancelado" && t.fecha >= nowIso().slice(0, 10)).length;
      store.pacientes = lista.filter((x) => x.id !== idPath);
      // La historia clínica del paciente se va con él; los turnos conservan el nombre.
      store.evoluciones = (store.evoluciones || []).filter((e) => e.pacienteId !== idPath);
      saveStore(dataDir, store);
      return json(res, 200, { ok: true, turnosFuturos }), true;
    }
  }

  // -- Turnos / Agenda --
  if (recurso === "turnos") {
    const lista = store.turnos;
    // GET ?desde=&hasta=[&profesionalId=]  -> lista cruda de turnos en el rango
    // (para Caja y Estadística). Se prioriza sobre el modo agenda.
    if (method === "GET" && !idPath && (url.searchParams.get("desde") || url.searchParams.get("pacienteId"))) {
      const desde = clean(url.searchParams.get("desde"));
      const hasta = clean(url.searchParams.get("hasta")) || desde;
      const profId = clean(url.searchParams.get("profesionalId"));
      const pacId = clean(url.searchParams.get("pacienteId"));
      const items = lista.filter((t) => t.estado !== "cancelado" &&
        (!desde || (t.fecha >= desde && t.fecha <= hasta)) &&
        (!profId || t.profesionalId === profId) &&
        (!pacId || t.pacienteId === pacId))
        .sort((a, b) => String(b.fecha + b.hora).localeCompare(String(a.fecha + a.hora)));
      return json(res, 200, { items }), true;
    }
    // GET ?profesionalId=&fecha=  -> agenda del profesional ese día (con slots)
    if (method === "GET" && !idPath) {
      const profId = clean(url.searchParams.get("profesionalId"));
      const fecha = clean(url.searchParams.get("fecha"));
      if (!profId || !fecha) return json(res, 400, { error: "Falta profesionalId y fecha." }), true;
      const prof = store.profesionales.find((x) => x.id === profId);
      if (!prof) return json(res, 404, { error: "Profesional no encontrado." }), true;
      const delDia = lista.filter((t) => t.profesionalId === profId && t.fecha === fecha && t.estado !== "cancelado");
      const slots = generarSlots(prof, fecha, delDia);
      return json(res, 200, { profesional: prof, fecha, slots, cantidad: delDia.length }), true;
    }
    if (method === "POST") {
      const body = await readBody(req);
      const t = sanitizeTurno(body, null, store);
      if (!t.profesionalId || !t.fecha || !t.hora) return json(res, 400, { error: "Falta profesional, fecha u hora." }), true;
      // Evitar doble turno en el mismo slot (salvo sobreturno explícito).
      const ocupado = lista.find((x) => x.profesionalId === t.profesionalId && x.fecha === t.fecha && x.hora === t.hora && x.estado !== "cancelado");
      if (ocupado && !body.permitirSobreturno) return json(res, 409, { error: "Ya hay un turno en ese horario." }), true;
      t.id = uid(); t.creadoEl = nowIso(); t.creadoPor = me.username;
      lista.push(t); saveStore(dataDir, store);
      return json(res, 200, { item: t }), true;
    }
    if (method === "PUT" && idPath) {
      const idx = lista.findIndex((x) => x.id === idPath);
      if (idx < 0) return json(res, 404, { error: "No encontrado." }), true;
      const body = await readBody(req);
      lista[idx] = sanitizeTurno(body, lista[idx], store);
      saveStore(dataDir, store);
      return json(res, 200, { item: lista[idx] }), true;
    }
    if (method === "DELETE" && idPath) {
      store.turnos = lista.filter((x) => x.id !== idPath); saveStore(dataDir, store);
      return json(res, 200, { ok: true }), true;
    }
  }

  // -- Presupuestos --
  if (recurso === "presupuestos") {
    const lista = store.presupuestos || (store.presupuestos = []);
    if (method === "GET" && !idPath) {
      const pacId = clean(url.searchParams.get("pacienteId"));
      const items = (pacId ? lista.filter((x) => x.pacienteId === pacId) : lista).slice(0, 100);
      return json(res, 200, { items }), true;
    }
    if (method === "GET" && idPath) {
      const it = lista.find((x) => x.id === idPath);
      return it ? (json(res, 200, { item: it }), true) : (json(res, 404, { error: "No encontrado." }), true);
    }
    if (method === "POST") {
      const body = await readBody(req);
      const items = (Array.isArray(body.items) ? body.items : []).map((it) => {
        const cantidad = Math.max(1, parseInt(it.cantidad, 10) || 1);
        const precioUnitario = money(it.precioUnitario);
        return { concepto: clean(it.concepto), cantidad, precioUnitario, subtotal: money(cantidad * precioUnitario) };
      }).filter((it) => it.concepto);
      if (!items.length) return json(res, 400, { error: "Agregá al menos un ítem con concepto." }), true;
      const total = money(items.reduce((a, it) => a + it.subtotal, 0));
      store.seqPresup = (store.seqPresup || 0) + 1;
      const presup = { id: uid(), numero: store.seqPresup, fecha: clean(body.fecha) || nowIso().slice(0, 10),
        pacienteId: clean(body.pacienteId), pacienteNombre: clean(body.pacienteNombre), obraSocial: clean(body.obraSocial),
        items, total, observaciones: clean(body.observaciones), creadoPor: me.username, creadoEl: nowIso() };
      lista.unshift(presup); saveStore(dataDir, store);
      return json(res, 200, { item: presup }), true;
    }
    if (method === "DELETE" && idPath) { store.presupuestos = lista.filter((x) => x.id !== idPath); saveStore(dataDir, store); return json(res, 200, { ok: true }), true; }
  }

  json(res, 404, { error: "Ruta de laboratorio no encontrada: " + p });
  return true;
}

module.exports = { handleLab };
