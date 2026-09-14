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

// UN ALMACEN POR CENTRO. Cada centro tiene su archivo: sus pacientes, su agenda y su
// caja no se cruzan con los de otro. Separarlo ahora costo una ruta distinta; hacerlo
// con tres centros cargados habria sido una migracion.
const CENTRO_RE = /^[a-z0-9-]{2,40}$/;
function storeFile(dataDir, centro) { return path.join(dataDir, "lab_" + centro + ".json"); }
// Los archivos de los estudios NO van adentro del JSON: se guardan al lado, uno por
// archivo, con el id del estudio como nombre. Un PDF de ecografia pesa 10 MB.
function estudiosDir(dataDir, centro) { return path.join(dataDir, "lab_estudios", centro); }
// Lo que ya estaba cargado (un solo almacen) pasa a ser el centro "demo": es data de
// prueba y meterla adentro de un centro real seria ensuciarlo.
function migrarAlMulticentro(dataDir) {
  try {
    const viejo = path.join(dataDir, "lab_gestion.json");
    const nuevo = storeFile(dataDir, "demo");
    if (!fs.existsSync(viejo) || fs.existsSync(nuevo)) return;
    fs.copyFileSync(viejo, nuevo);
    fs.renameSync(viejo, viejo + ".migrado");
    const estViejo = path.join(dataDir, "lab_estudios");
    const estNuevo = estudiosDir(dataDir, "demo");
    if (fs.existsSync(estViejo) && !fs.existsSync(estNuevo)) {
      fs.mkdirSync(estNuevo, { recursive: true });
      fs.readdirSync(estViejo).forEach((f) => {
        const de = path.join(estViejo, f);
        try { if (fs.statSync(de).isFile()) fs.renameSync(de, path.join(estNuevo, f)); } catch { /* carpeta */ }
      });
    }
    console.log("[lab] el almacen unico paso a ser el centro demo");
  } catch (e) { console.log("[lab] migracion omitida:", e && e.message); }
}

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
const _cache = new Map();   // centro -> { store, mtime }
function emptyStore() {
  return {
    especialidades: [],
    profesionales: [],
    consultorios: [],
    obrasSociales: [],
    pacientes: [],
    turnos: [],
    practicas: [],
    bloqueos: [],
    movimientos: [],
    registro: [],
    config: {},
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
function loadStore(dataDir, centro) {
  try {
    const mtime = fs.statSync(storeFile(dataDir, centro)).mtimeMs;
    const hit = _cache.get(centro);
    if (hit && hit.mtime === mtime) return hit.store;
    const parsed = JSON.parse(fs.readFileSync(storeFile(dataDir, centro), "utf8"));
    const store = Object.assign(emptyStore(), parsed);
    _cache.set(centro, { store, mtime });
    return store;
  } catch {
    // Centro nuevo: arranca con los catálogos de siempre, no en blanco.
    const s = seedStore();
    try { saveStore(dataDir, centro, s); } catch { /* ro fs */ }
    return s;
  }
}
function saveStore(dataDir, centro, store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(storeFile(dataDir, centro), JSON.stringify(store, null, 2));
  try { _cache.set(centro, { store, mtime: fs.statSync(storeFile(dataDir, centro)).mtimeMs }); } catch { _cache.delete(centro); }
}

// Permisos del sistema de turnos, de a uno. El centro habilita los que quiera para
// cada persona: las plantillas de abajo son un punto de partida, no una jaula.
const LAB_PERMISOS_CAT = [
  { cod: "agenda", label: "Agenda y turnos" },
  { cod: "sala", label: "Sala de espera" },
  { cod: "recordatorios", label: "Recordatorios" },
  { cod: "pacientes", label: "Pacientes" },
  { cod: "hc", label: "Historia clínica" },
  { cod: "caja", label: "Caja: cobrar" },
  { cod: "cierre", label: "Caja: cerrar el día" },
  { cod: "liquidacion", label: "Liquidación de profesionales" },
  { cod: "estadistica", label: "Estadística" },
  { cod: "config", label: "Configuración (profesionales, prácticas, valores)" },
  { cod: "usuarios", label: "Usuarios y permisos" },
];
const LAB_TODOS = LAB_PERMISOS_CAT.map((x) => x.cod);
// Los puestos que de verdad existen en un centro. Al elegir uno se tildan sus
// permisos, y despues se agrega o saca lo que haga falta.
const LAB_PLANTILLAS = {
  recepcionista: ["agenda", "sala", "recordatorios", "pacientes"],
  cajero: ["agenda", "pacientes", "caja"],
  profesional: ["agenda", "sala", "pacientes", "hc"],
  coordinador: ["agenda", "sala", "recordatorios", "pacientes", "hc", "caja", "cierre", "liquidacion", "estadistica", "config"],
  admin: LAB_TODOS.slice(),
};
// Que permiso pide cada recurso de la API.
const LAB_RECURSO_PERMISO = {
  turnos: "agenda",
  bloqueos: "agenda",
  reprogramar: "agenda",
  liquidacion: "liquidacion",
  registro: "usuarios",
  inicio: "agenda",
  movimientos: "caja",
  sala: "sala",
  recordatorios: "recordatorios",
  config: "config",
  pacientes: "pacientes",
  estudios: "hc",
  caja: "caja",
  estadistica: "estadistica",
  presupuestos: "caja",
  practicas: "config",
  especialidades: "config",
  consultorios: "config",
  obrasSociales: "config",
  profesionales: "config",
  usuarios: "usuarios",
};
// Las cuentas que SON un centro (el cliente de NS) no son personas que atienden: no
// tienen nada que hacer en la lista de usuarios del sistema de turnos.
const LAB_ROLES_NS_FUERA = new Set(["clinica", "demo"]);
function labPermisosDe(me) {
  if (!me) return [];
  // El admin de NS entra a todo: es el dueno del sistema, no un usuario del centro.
  if (me.role === "admin") return LAB_TODOS.slice();
  const lab = me.lab && typeof me.lab === "object" ? me.lab : null;
  if (!lab) return [];
  // Manda la lista de permisos; la plantilla es solo con que arranco.
  if (Array.isArray(lab.permisos)) return lab.permisos.filter((x) => LAB_TODOS.includes(x));
  return (LAB_PLANTILLAS[lab.rol] || []).slice();
}
function labRolDe(me) {
  if (!me) return null;
  if (me.role === "admin") return "admin";
  return labPermisosDe(me).length ? ((me.lab && me.lab.rol) || "personalizado") : null;
}
function labPuede(me, permiso) {
  return labPermisosDe(me).includes(permiso);
}

// El texto del recordatorio. Las llaves se reemplazan con los datos del turno; el
// centro lo puede cambiar entero desde la pantalla.
const PLANTILLA_DEFAULT =
  "Hola {paciente}, le recordamos su turno el {fecha} a las {hora} con {profesional}. " +
  "Si no puede venir, avisenos asi se lo damos a otra persona. Gracias.";
function armarRecordatorio(plantilla, t, prof, config) {
  const f = String(t.fecha || "").split("-");
  const partes = {
    "{paciente}": String(t.pacienteNombre || "").split(",")[0].trim() || "paciente",
    "{fecha}": f.length === 3 ? f[2] + "/" + f[1] : (t.fecha || ""),
    "{hora}": t.hora || "",
    "{profesional}": prof.nombre || "",
    "{practica}": t.practicaNombre || "",
    "{centro}": config.centroNombre || "",
    "{direccion}": config.centroDireccion || "",
    "{preparacion}": t.preparacion || "",
  };
  let out = String(plantilla || PLANTILLA_DEFAULT);
  const teniaToken = out.indexOf("{preparacion}") >= 0;
  Object.keys(partes).forEach((k) => { out = out.split(k).join(partes[k]); });
  // Si el centro no puso {preparacion} en su texto, la preparacion se agrega igual al
  // final. Depender de que se acuerden de editar la plantilla es perder el estudio:
  // el paciente viene sin ayuno y hay que reprogramarlo.
  if (!teniaToken && t.preparacion) out += " IMPORTANTE: " + t.preparacion;
  return out.replace(/\s{2,}/g, " ").trim();
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
// Registro del sistema: queda anotado quien toco que. Se guardan las cosas que
// alguien puede preguntar despues ("quien borro este turno?"), no cada clic: un
// registro que anota todo no lo lee nadie.
const REGISTRO_TOPE = 3000;
function anotar(store, me, accion, detalle) {
  if (!store.registro) store.registro = [];
  store.registro.push({
    id: uid(), at: nowIso(), usuario: (me && me.username) || "sistema",
    accion, detalle: String(detalle || "").slice(0, 200),
  });
  // Se queda con los ultimos: es para mirar lo reciente, no un archivo historico.
  if (store.registro.length > REGISTRO_TOPE) store.registro = store.registro.slice(-REGISTRO_TOPE);
}

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
  // Contrato: como se le paga. `porcentaje` sobre lo facturado o lo cobrado del mes,
  // o `fijo` por turno atendido. Se guarda en el profesional porque es SUYO, no del
  // mes: la liquidacion lo lee, no lo copia.
  if (body.contrato !== undefined && body.contrato && typeof body.contrato === "object") {
    const tipo = ["porcentaje", "fijo"].includes(clean(body.contrato.tipo)) ? clean(body.contrato.tipo) : "";
    p.contrato = tipo ? {
      tipo,
      valor: money(body.contrato.valor),
      sobre: clean(body.contrato.sobre) === "facturado" ? "facturado" : "cobrado",
    } : null;
  }
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
// Vacaciones, congresos, feriados. Un bloqueo sin profesional es de todo el centro
// (un feriado); con profesional, es la ausencia de ese.
// Horas que un profesional tiene OFRECIDAS un dia (segun sus horarios). Es la base
// de dos cuentas: cuanto rinde la agenda y cuanto se pierde al anular un dia.
function horasDelDia(prof, fecha) {
  const dow = new Date(fecha + "T00:00:00").getDay();
  return (prof.horarios || []).filter((h) => h.dow === dow).reduce((a, h) => {
    const [hd, md] = String(h.desde || "0:0").split(":").map((x) => parseInt(x, 10) || 0);
    const [hh, mh] = String(h.hasta || "0:0").split(":").map((x) => parseInt(x, 10) || 0);
    return a + Math.max(0, (hh * 60 + mh) - (hd * 60 + md)) / 60;
  }, 0);
}
// Los dias de un rango que caen adentro del periodo pedido.
function diasEnRango(desde, hasta, desdeTope, hastaTope) {
  const out = [];
  let d = new Date((desde < desdeTope ? desdeTope : desde) + "T12:00:00");
  const fin = new Date((hasta > hastaTope ? hastaTope : hasta) + "T12:00:00");
  let guard = 0;
  while (d <= fin && guard++ < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
function bloqueoDe(store, profId, fecha) {
  return (store.bloqueos || []).find((b) =>
    (!b.profesionalId || b.profesionalId === profId) && fecha >= b.desde && fecha <= b.hasta) || null;
}
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
  t.online = body.online !== undefined ? !!body.online : !!t.online;
  t.avisadoEl = body.avisadoEl !== undefined ? clean(body.avisadoEl) : (t.avisadoEl || "");
  t.avisadoPor = body.avisadoPor !== undefined ? clean(body.avisadoPor) : (t.avisadoPor || "");
  t.practicaId = body.practicaId !== undefined ? clean(body.practicaId) : (t.practicaId || "");
  // El nombre se copia al turno a proposito: si despues renombran o borran la
  // practica, el turno viejo tiene que seguir diciendo que se hizo.
  t.practicaNombre = body.practicaNombre !== undefined ? clean(body.practicaNombre) : (t.practicaNombre || "");
  // La preparacion se COPIA al turno: si despues cambia la de la practica, el
  // turno ya dado tiene que seguir diciendo lo que se le indico al paciente.
  if (body.practicaId !== undefined && store) {
    const prac = (store.practicas || []).find((x) => x.id === t.practicaId);
    t.preparacion = prac ? (prac.preparacion || "") : "";
  }
  t.motivo = body.motivo !== undefined ? clean(body.motivo) : (t.motivo || "");
  t.observaciones = body.observaciones !== undefined ? clean(body.observaciones) : (t.observaciones || "");
  const estadoAntes = t.estado;
  t.estado = ESTADOS_TURNO.includes(body.estado) ? body.estado : (t.estado || "dado");
  if (t.estado !== estadoAntes) {
    if (t.estado === "esperando" && !t.esperandoDesde) t.esperandoDesde = nowIso();
    if (t.estado === "atendido" && !t.atendidoEl) t.atendidoEl = nowIso();
  }
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
// PUBLICO: turnos online. Sin sesion, asi que todo lo de aca se escribe pensando
// en que lo llama cualquiera desde internet.
//
// Reglas que se respetan en todo el modulo:
//   - Solo sale lo imprescindible: especialidades, nombre del profesional y las
//     HORAS LIBRES. Nunca quien esta en las ocupadas ni cuantos turnos hay.
//   - Se reserva dentro de una ventana (config.online.dias); ni hoy ni para 2029.
//   - El turno entra como cualquier otro pero marcado `online`, para que la
//     recepcion lo mire antes de darlo por bueno.
//   - Tope por documento y por dia, para que no lo usen de juguete.
// ---------------------------------------------------------------------------
const ONLINE_TOPE_POR_DOC = 3;

function onlineConfig(store) {
  const c = (store.config && store.config.online) || {};
  return { activo: !!c.activo, dias: c.dias || 30, mensaje: c.mensaje || "" };
}
function sumarDias(fecha, n) {
  const d = new Date(fecha + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
async function handleLabPublico(ctx) {
  const { req, res, method, p, url, json, readBody, dataDir } = ctx;
  const seg = p.slice("/api/turnos-online/".length).split("/").filter(Boolean);
  const centro = clean(seg[0]).toLowerCase();
  const que = seg[1] || "";
  if (!centro || !CENTRO_RE.test(centro)) { json(res, 404, { error: "No encontramos lo que buscabas." }); return true; }
  // Ojo: loadStore CREA el centro si no existe. Aca se mira el archivo primero, asi
  // una direccion inventada no siembra un centro nuevo desde afuera.
  if (!fs.existsSync(storeFile(dataDir, centro))) { json(res, 404, { error: "No encontramos lo que buscabas." }); return true; }
  const store = loadStore(dataDir, centro);
  const cfg = onlineConfig(store);
  if (!cfg.activo) { json(res, 403, { error: "Este centro no toma turnos por internet." }); return true; }
  const hoy = nowIso().slice(0, 10);

  // Con que puede arrancar la pantalla: nombre del centro, especialidades y hasta
  // cuando se puede pedir.
  if (que === "info" && method === "GET") {
    const conProf = new Set((store.profesionales || []).filter((x) => x.activo !== false).map((x) => x.especialidadId));
    return json(res, 200, {
      centro: (store.config && store.config.centroNombre) || "",
      mensaje: cfg.mensaje,
      desde: sumarDias(hoy, 1), hasta: sumarDias(hoy, cfg.dias),
      especialidades: (store.especialidades || [])
        .filter((e2) => e2.activo !== false && conProf.has(e2.id))
        .map((e2) => ({ id: e2.id, nombre: e2.nombre })),
    }), true;
  }

  // Los horarios LIBRES de un dia. No se dice cuales estan ocupados ni por quien.
  if (que === "libres" && method === "GET") {
    const fecha = clean(url.searchParams.get("fecha"));
    const espId = clean(url.searchParams.get("especialidadId"));
    if (!fecha || fecha < sumarDias(hoy, 1) || fecha > sumarDias(hoy, cfg.dias)) {
      return json(res, 400, { error: "Elegí una fecha dentro del período disponible." }), true;
    }
    const profs = (store.profesionales || [])
      .filter((x) => x.activo !== false && (!espId || x.especialidadId === espId));
    const salida = profs.map((prof) => {
      if (bloqueoDe(store, prof.id, fecha)) return null;
      const delDia = (store.turnos || []).filter((t) => t.profesionalId === prof.id && t.fecha === fecha && t.estado !== "cancelado");
      const libres = generarSlots(prof, fecha, delDia).filter((sl) => !sl.turno).map((sl) => sl.hora);
      if (!libres.length) return null;
      return { profesionalId: prof.id, profesional: prof.nombre, horarios: libres };
    }).filter(Boolean);
    return json(res, 200, { fecha, profesionales: salida }), true;
  }

  // Reservar. Lo que llega de afuera no se usa tal cual: se toman SOLO estos campos.
  if (que === "reservar" && method === "POST") {
    const body = await readBody(req);
    const fecha = clean(body.fecha), hora = clean(body.hora), profId = clean(body.profesionalId);
    const nombre = clean(body.nombre).slice(0, 80);
    const documento = soloDigitos(body.documento).slice(0, 12);
    const celular = clean(body.celular).slice(0, 30);
    if (!nombre || !documento || !celular) return json(res, 400, { error: "Completá nombre, documento y celular." }), true;
    if (!fecha || fecha < sumarDias(hoy, 1) || fecha > sumarDias(hoy, cfg.dias)) {
      return json(res, 400, { error: "Esa fecha no está disponible." }), true;
    }
    const prof = (store.profesionales || []).find((x) => x.id === profId && x.activo !== false);
    if (!prof) return json(res, 404, { error: "Ese profesional no está disponible." }), true;
    if (bloqueoDe(store, prof.id, fecha)) return json(res, 409, { error: "Ese día no se atiende." }), true;
    const delDia = (store.turnos || []).filter((t) => t.profesionalId === prof.id && t.fecha === fecha && t.estado !== "cancelado");
    // El horario tiene que ser uno de los que la agenda ofrece Y estar libre. Sin
    // esto, alguien manda "03:00" y se mete fuera de horario.
    const slots = generarSlots(prof, fecha, delDia);
    const slot = slots.find((sl) => sl.hora === hora);
    // Se distingue "ese horario no existe" de "ya lo tomaron": el primero es una
    // direccion armada a mano, el segundo le pasa a cualquiera que tardo en completar.
    if (!slot) return json(res, 400, { error: "Ese horario no está disponible." }), true;
    if (slot.turno) return json(res, 409, { error: "Ese horario ya fue tomado. Elegí otro." }), true;
    // Tope por documento: que no se use de juguete ni se tape la agenda.
    const suyos = (store.turnos || []).filter((t) => t.online && t.documento === documento &&
      t.estado !== "cancelado" && t.fecha >= hoy).length;
    if (suyos >= ONLINE_TOPE_POR_DOC) {
      return json(res, 429, { error: "Ya tenés varios turnos pedidos. Llamá al centro para sacar otro." }), true;
    }
    const t = {
      id: uid(), profesionalId: prof.id, especialidadId: prof.especialidadId || "",
      fecha, hora, pacienteId: "", pacienteNombre: nombre, documento, celular,
      obraSocial: clean(body.obraSocial).slice(0, 60), motivo: clean(body.motivo).slice(0, 120),
      estado: "dado", online: true, importe: 0, sena: 0, insumos: 0, pagado: false,
      creadoEl: nowIso(), creadoPor: "online",
    };
    store.turnos.push(t); saveStore(dataDir, centro, store);
    return json(res, 200, { ok: true, turno: { fecha: t.fecha, hora: t.hora, profesional: prof.nombre } }), true;
  }
  json(res, 404, { error: "No encontramos lo que buscabas." });
  return true;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function handleLab(ctx) {
  const { req, res, method, p, url, me, json, readBody, dataDir } = ctx;
  if (!me) { json(res, 401, { error: "no-auth" }); return true; }
  const labRol = labRolDe(me);
  if (!labRol) { json(res, 403, { error: "Tu usuario no tiene acceso al sistema del centro." }); return true; }

  migrarAlMulticentro(dataDir);
  // De que centro son los datos que se piden. El admin de NS elige (viaja en la URL);
  // el usuario del centro NO puede elegir: es el suyo y punto, aunque cambie la URL.
  const pedido = clean(url.searchParams.get("centro")).toLowerCase();
  const propio = clean(me.lab && me.lab.centro).toLowerCase();
  let centro = me.role === "admin" ? (pedido || propio || "demo") : propio;
  if (!centro || !CENTRO_RE.test(centro)) {
    if (me.role !== "admin") { json(res, 403, { error: "Tu usuario no tiene un centro asignado." }); return true; }
    centro = "demo";
  }
  const seg = p.slice("/api/lab/".length).split("/").filter(Boolean); // ["turnos", "<id>"]
  const recurso = seg[0] || "";
  const idPath = seg[1] || "";
  const store = loadStore(dataDir, centro);

  // Cada recurso pide su permiso. El cierre de caja pide uno propio: la
  // recepcionista cobra todo el dia pero el arqueo no lo cierra ella.
  // La cuenta corriente es plata, no ficha: pide el permiso de caja aunque cuelgue
  // de /pacientes. Si no, la recepcion que no cobra veria lo que cada uno debe.
  const permisoPedido =
    (recurso === "caja" && idPath === "cierre") ? "cierre"
    : (recurso === "pacientes" && (seg[2] === "cuenta" || seg[2] === "movimientos")) ? "caja"
    : LAB_RECURSO_PERMISO[recurso];
  if (permisoPedido && !labPuede(me, permisoPedido)) {
    return json(res, 403, { error: "Tu usuario no tiene permiso para esta parte del sistema." }), true;
  }

  // -- Bootstrap: todo lo que la UI necesita para arrancar --
  if (recurso === "bootstrap" && method === "GET") {
    return json(res, 200, {
      especialidades: store.especialidades,
      profesionales: store.profesionales,
      consultorios: store.consultorios,
      obrasSociales: store.obrasSociales,
      practicas: store.practicas || [],
      // Con esto el front arma el menu: no se muestra lo que despues va a dar 403.
      rol: labRol, permisos: labPermisosDe(me),
      config: Object.assign({ plantillaRecordatorio: PLANTILLA_DEFAULT }, store.config || {}),
      centro,
      // El admin de NS puede moverse entre centros; el del centro ve solo el suyo.
      centros: me.role === "admin" && ctx.loadClientes ? ctx.loadClientes() : [],
      profesionalId: (me.lab && me.lab.profesionalId) || "",
      totales: { pacientes: (store.pacientes || []).length, turnos: (store.turnos || []).length },
    }), true;
  }

  // -- Config del centro (nombre y texto del recordatorio) --
  if (recurso === "config") {
    if (!store.config) store.config = {};
    if (method === "GET") return json(res, 200, { config: Object.assign({ plantillaRecordatorio: PLANTILLA_DEFAULT }, store.config) }), true;
    if (method === "POST") {
      const body = await readBody(req);
      if (body.centroNombre !== undefined) store.config.centroNombre = clean(body.centroNombre);
      if (body.centroDireccion !== undefined) store.config.centroDireccion = clean(body.centroDireccion);
      if (body.plantillaRecordatorio !== undefined) store.config.plantillaRecordatorio = clean(body.plantillaRecordatorio) || PLANTILLA_DEFAULT;
      // Turnos online: apagado hasta que el centro lo prenda. `dias` es con cuanta
      // anticipacion se puede reservar; sin tope, alguien saca turno para 2029.
      if (body.online !== undefined && body.online && typeof body.online === "object") {
        store.config.online = {
          activo: !!body.online.activo,
          dias: Math.min(120, Math.max(1, parseInt(body.online.dias, 10) || 30)),
          mensaje: clean(body.online.mensaje).slice(0, 300),
        };
      }
      saveStore(dataDir, centro, store);
      return json(res, 200, { config: store.config }), true;
    }
  }

  // -- Recordatorios: a quien hay que avisarle el turno de un dia --
  // No manda nada por su cuenta: arma el mensaje y deja el link para mandarlo desde
  // el WhatsApp del centro. Contratar un envio automatico es plata y una cuenta
  // aprobada; esto anda hoy y hace lo que de verdad cuesta: saber a quien, con que
  // texto y no repetirle al que ya se le aviso.
  if (recurso === "recordatorios" && method === "GET") {
    const fecha = clean(url.searchParams.get("fecha")) || nowIso().slice(0, 10);
    const plantilla = (store.config && store.config.plantillaRecordatorio) || PLANTILLA_DEFAULT;
    const items = (store.turnos || [])
      .filter((t) => t.fecha === fecha && t.estado === "dado")
      .sort((a, b) => String(a.hora).localeCompare(String(b.hora)))
      .map((t) => {
        const prof = (store.profesionales || []).find((x) => x.id === t.profesionalId) || {};
        const tel = soloDigitos(t.celular);
        return {
          id: t.id, hora: t.hora, paciente: t.pacienteNombre, celular: t.celular,
          telefonoOk: tel.length >= 8,
          profesional: prof.nombre || "",
          avisadoEl: t.avisadoEl || "", avisadoPor: t.avisadoPor || "",
          mensaje: armarRecordatorio(plantilla, t, prof, store.config || {}),
          // wa.me quiere el numero con pais y sin nada mas. Argentina: 54.
          whatsapp: tel ? "https://wa.me/" + (tel.startsWith("54") ? tel : "54" + tel.replace(/^0+/, "")) : "",
        };
      });
    return json(res, 200, {
      fecha, items, plantilla,
      totales: { turnos: items.length, avisados: items.filter((x) => x.avisadoEl).length,
                 sinTelefono: items.filter((x) => !x.telefonoOk).length },
    }), true;
  }
  // Marcar (o desmarcar) que ya se le aviso.
  if (recurso === "turnos" && seg[2] === "aviso" && method === "POST") {
    const t = (store.turnos || []).find((x) => x.id === idPath);
    if (!t) return json(res, 404, { error: "Ese turno ya no está." }), true;
    const body = await readBody(req);
    if (body.avisado === false) { t.avisadoEl = ""; t.avisadoPor = ""; }
    else { t.avisadoEl = nowIso(); t.avisadoPor = me.username; }
    saveStore(dataDir, centro, store);
    return json(res, 200, { item: t }), true;
  }

  // -- Cuenta corriente del paciente --
  // No se lleva un libro aparte: los cargos salen de los turnos, que es donde ya se
  // anota lo que se cobra. Un libro paralelo obliga a mantener dos verdades y a la
  // semana no coinciden. Los movimientos sueltos son para lo que NO es un turno: un
  // pago a cuenta, un certificado, un ajuste.
  if (recurso === "pacientes" && seg[2] === "cuenta" && method === "GET") {
    const pacId = idPath;
    const movs = [];
    (store.turnos || []).filter((t) => t.pacienteId === pacId && t.estado !== "cancelado").forEach((t) => {
      const cargo = money((t.importe || 0) + (t.insumos || 0));
      // Lo que entro por ese turno: si quedo pagado, todo; si no, la sena.
      const pagado = t.pagado ? cargo : money(t.sena || 0);
      const prof = (store.profesionales || []).find((x) => x.id === t.profesionalId) || {};
      if (cargo) movs.push({ id: "t-" + t.id, fecha: t.fecha, tipo: "cargo", turnoId: t.id,
        concepto: t.practicaNombre || "Consulta" + (prof.nombre ? " · " + prof.nombre : ""), importe: cargo });
      if (pagado) movs.push({ id: "p-" + t.id, fecha: t.fecha, tipo: "pago", turnoId: t.id,
        concepto: (t.pagado ? "Cobrado" : "Seña") + (t.medioPago ? " · " + t.medioPago : ""), importe: pagado });
    });
    (store.movimientos || []).filter((m2) => m2.pacienteId === pacId).forEach((m2) => movs.push(m2));
    movs.sort((a, b) => String(b.fecha + (b.creadoEl || "")).localeCompare(String(a.fecha + (a.creadoEl || ""))));
    const suma = (tipo) => money(movs.filter((x) => x.tipo === tipo).reduce((a, x) => a + (x.importe || 0), 0));
    const cargos = suma("cargo"), pagos = suma("pago"), ajustes = suma("ajuste");
    return json(res, 200, { items: movs, totales: { cargos, pagos, ajustes, saldo: money(cargos + ajustes - pagos) } }), true;
  }
  // Movimientos que NO salen de un turno.
  if (recurso === "pacientes" && seg[2] === "movimientos" && method === "POST") {
    const pacId = idPath;
    if (!(store.pacientes || []).some((x) => x.id === pacId)) return json(res, 404, { error: "Ese paciente no existe." }), true;
    const body = await readBody(req);
    const tipo = ["cargo", "pago", "ajuste"].includes(clean(body.tipo)) ? clean(body.tipo) : "pago";
    const importe = money(body.importe);
    if (!importe) return json(res, 400, { error: "Poné el importe." }), true;
    const m2 = {
      id: uid(), pacienteId: pacId, fecha: clean(body.fecha) || nowIso().slice(0, 10),
      tipo, concepto: clean(body.concepto) || (tipo === "pago" ? "Pago a cuenta" : "Movimiento"),
      medioPago: clean(body.medioPago), importe,
      creadoEl: nowIso(), creadoPor: me.username,
    };
    if (!store.movimientos) store.movimientos = [];
    store.movimientos.push(m2); saveStore(dataDir, centro, store);
    return json(res, 200, { item: m2 }), true;
  }
  if (recurso === "movimientos" && idPath && method === "DELETE") {
    const antes = (store.movimientos || []).length;
    store.movimientos = (store.movimientos || []).filter((x) => x.id !== idPath);
    if (store.movimientos.length === antes) return json(res, 404, { error: "Ese movimiento no existe (los de un turno se corrigen desde el turno)." }), true;
    saveStore(dataDir, centro, store);
    return json(res, 200, { ok: true }), true;
  }

  // -- Inicio: los indicadores del mes y lo de hoy --
  if (recurso === "inicio" && method === "GET") {
    const hoy = nowIso().slice(0, 10);
    const periodo = clean(url.searchParams.get("periodo")) || hoy.slice(0, 7);
    const delMes = (store.turnos || []).filter((t) => String(t.fecha || "").startsWith(periodo) && t.estado !== "cancelado");
    const cuenta = (lista, est) => lista.filter((t) => t.estado === est).length;
    const ausentes = (lista) => cuenta(lista, "ausente") + cuenta(lista, "ausente_aviso");
    // Ausentismo sobre los turnos YA TRANSCURRIDOS: si se mide sobre todo el mes, el
    // dia 3 da 2% siempre y no sirve para nada. Misma definicion que usa Global App.
    const transcurridos = delMes.filter((t) => t.fecha <= hoy);
    const atendidosMes = delMes.filter((t) => t.estado === "atendido");

    // Pacientes: unicos del mes, y cuantos de esos vinieron por primera vez.
    const vistos = new Set(atendidosMes.map((t) => t.pacienteId || ("s:" + t.pacienteNombre)).filter(Boolean));
    const antes = new Set((store.turnos || [])
      .filter((t) => t.estado !== "cancelado" && String(t.fecha || "") < periodo + "-01")
      .map((t) => t.pacienteId || ("s:" + t.pacienteNombre)).filter(Boolean));
    let nuevos = 0;
    vistos.forEach((k) => { if (!antes.has(k)) nuevos++; });

    // Plata del mes: lo facturado es lo que se cobra por los turnos; lo cobrado, lo
    // que efectivamente entro (pagado completo o la sena).
    // Facturado = lo ATENDIDO, no todo lo agendado. Contar los turnos que todavia no
    // pasaron (y los ausentes, que no se cobran) inflaba el mes y dejaba un "por
    // cobrar" enorme que parecia deuda. Ademas la liquidacion ya contaba solo los
    // atendidos: las dos pantallas decian numeros distintos de lo mismo.
    const facturado = money(atendidosMes.reduce((a, t) => a + (t.importe || 0) + (t.insumos || 0), 0));
    const cobrado = money(atendidosMes.reduce((a, t) => a + (t.pagado ? (t.importe || 0) + (t.insumos || 0) : (t.sena || 0)), 0));

    const agrupar = (lista, clave) => {
      const m2 = {};
      lista.forEach((t) => {
        const k = clave(t) || "—";
        const g = m2[k] || (m2[k] = { nombre: k, turnos: 0, atendidos: 0, ausentes: 0 });
        g.turnos++;
        if (t.estado === "atendido") g.atendidos++;
        if (t.estado === "ausente" || t.estado === "ausente_aviso") g.ausentes++;
      });
      return Object.values(m2).sort((a, b) => b.turnos - a.turnos);
    };
    const nombreProf = (id) => ((store.profesionales || []).find((x) => x.id === id) || {}).nombre || "—";

    // --- Cancelaciones de agenda: dias anulados y horas que se perdieron ---
    const desdeTope = periodo + "-01";
    const finMes = new Date(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7)), 0);
    const ultimoDelMes = periodo + "-" + String(finMes.getDate()).padStart(2, "0");
    // En el mes en curso se cuenta hasta hoy: sumar la agenda que todavia no paso
    // ensucia el rendimiento y la comparacion entre meses.
    const hastaTope = ultimoDelMes > hoy ? hoy : ultimoDelMes;
    const cancel = {};
    (store.bloqueos || []).forEach((b) => {
      const dias = diasEnRango(b.desde, b.hasta, desdeTope, ultimoDelMes);
      if (!dias.length) return;
      // Un bloqueo sin profesional es de todo el centro: se le imputa a cada uno.
      const afectados = b.profesionalId
        ? (store.profesionales || []).filter((x) => x.id === b.profesionalId)
        : (store.profesionales || []);
      afectados.forEach((prof) => {
        const g = cancel[prof.id] || (cancel[prof.id] = { nombre: prof.nombre, dias: 0, horas: 0, motivos: [] });
        dias.forEach((f) => { const hs = horasDelDia(prof, f); if (hs) { g.dias++; g.horas += hs; } });
        if (b.motivo && g.motivos.indexOf(b.motivo) < 0) g.motivos.push(b.motivo);
      });
    });
    const cancelaciones = Object.values(cancel)
      .filter((g) => g.dias)
      .map((g) => ({ nombre: g.nombre, dias: g.dias, horas: Math.round(g.horas * 10) / 10, motivo: g.motivos.join(" · ") }))
      .sort((a, b) => b.horas - a.horas);

    // --- Rendimiento por especialidad: pacientes, horas ofrecidas y turnos por hora ---
    const rend = {};
    (store.profesionales || []).forEach((prof) => {
      const esp = (store.especialidades || []).find((e2) => e2.id === prof.especialidadId);
      const k = (esp && esp.nombre) || "Sin especialidad";
      const g = rend[k] || (rend[k] = { nombre: k, turnos: 0, pacientes: new Set(), horas: 0 });
      diasEnRango(desdeTope, hastaTope, desdeTope, hastaTope).forEach((f) => {
        // Un dia anulado no ofrecio horas: si se cuentan, el rendimiento del que se
        // tomo vacaciones se desploma sin que haya hecho nada mal.
        if (bloqueoDe(store, prof.id, f)) return;
        g.horas += horasDelDia(prof, f);
      });
    });
    delMes.forEach((t) => {
      const prof = (store.profesionales || []).find((x) => x.id === t.profesionalId);
      const esp = prof && (store.especialidades || []).find((e2) => e2.id === prof.especialidadId);
      const k = (esp && esp.nombre) || "Sin especialidad";
      const g = rend[k] || (rend[k] = { nombre: k, turnos: 0, pacientes: new Set(), horas: 0 });
      g.turnos++;
      if (t.estado === "atendido") g.pacientes.add(t.pacienteId || ("s:" + t.pacienteNombre));
    });
    const rendimiento = Object.values(rend)
      .filter((g) => g.turnos || g.horas)
      .map((g) => ({
        nombre: g.nombre, turnos: g.turnos, pacientes: g.pacientes.size,
        horas: Math.round(g.horas * 10) / 10,
        // Sin agenda cargada no es cero: es que no se puede calcular.
        turnosHora: g.horas ? Math.round((g.turnos / g.horas) * 100) / 100 : null,
      }))
      .sort((a, b) => b.turnos - a.turnos);

    // --- Pacientes por sexo y edad ---
    // Unicos con turno en el mes: el que vino tres veces suma uno. La edad se calcula
    // a hoy, no a la fecha del turno: es un padron, no una estadistica del momento.
    const TRAMOS = [[0, 17], [18, 35], [36, 50], [51, 65], [66, 200]];
    const etiquetas = ["0-17", "18-35", "36-50", "51-65", "65+"];
    const demo = { F: new Array(TRAMOS.length).fill(0), M: new Array(TRAMOS.length).fill(0), "?": new Array(TRAMOS.length).fill(0) };
    let sinFecha = 0;
    const yaContado = new Set();
    delMes.forEach((t) => {
      if (!t.pacienteId || yaContado.has(t.pacienteId)) return;
      yaContado.add(t.pacienteId);
      const pac = (store.pacientes || []).find((x) => x.id === t.pacienteId);
      if (!pac) return;
      const sexo = pac.sexo === "F" || pac.sexo === "M" ? pac.sexo : "?";
      if (!pac.fechaNac) { sinFecha++; return; }
      const nac = new Date(pac.fechaNac + "T12:00:00");
      if (isNaN(nac)) { sinFecha++; return; }
      let edad = new Date(hoy + "T12:00:00").getFullYear() - nac.getFullYear();
      const m3 = new Date(hoy + "T12:00:00").getMonth() - nac.getMonth();
      if (m3 < 0 || (m3 === 0 && new Date(hoy + "T12:00:00").getDate() < nac.getDate())) edad--;
      const i = TRAMOS.findIndex((r) => edad >= r[0] && edad <= r[1]);
      if (i >= 0) demo[sexo][i]++;
    });
    const porSexoEdad = {
      tramos: etiquetas,
      femenino: demo.F, masculino: demo.M, sinSexo: demo["?"],
      unicos: yaContado.size, sinFecha,
    };

    // Lo de hoy: es lo unico accionable de la pantalla, por eso va primero.
    const deHoy = (store.turnos || []).filter((t) => t.fecha === hoy && t.estado !== "cancelado");
    const manana = new Date(hoy + "T12:00:00");
    manana.setDate(manana.getDate() + 1);
    const finMan = manana.toISOString().slice(0, 10);
    const turnosManana = (store.turnos || []).filter((t) => t.fecha === finMan && t.estado === "dado");

    return json(res, 200, {
      periodo, hoy,
      hoyResumen: {
        turnos: deHoy.length, esperando: cuenta(deHoy, "esperando"), atendidos: cuenta(deHoy, "atendido"),
        ausentes: ausentes(deHoy), porVenir: cuenta(deHoy, "dado"),
        porCobrar: money(deHoy.filter((t) => !t.pagado).reduce((a, t) => a + (t.importe || 0) + (t.insumos || 0) - (t.sena || 0), 0)),
      },
      manana: { fecha: finMan, turnos: turnosManana.length, sinAvisar: turnosManana.filter((t) => !t.avisadoEl).length },
      citas: {
        total: delMes.length, atendidos: atendidosMes.length, ausentes: ausentes(delMes),
        ausentismo: transcurridos.length ? Math.round((ausentes(transcurridos) / transcurridos.length) * 1000) / 10 : 0,
      },
      pacientes: {
        atendidos: vistos.size, nuevos,
        nuevosPct: vistos.size ? Math.round((nuevos / vistos.size) * 1000) / 10 : 0,
      },
      plata: { facturado, cobrado, porCobrar: money(facturado - cobrado) },
      porObraSocial: agrupar(delMes, (t) => t.obraSocial),
      porProfesional: agrupar(delMes, (t) => nombreProf(t.profesionalId)),
      porPractica: agrupar(delMes.filter((t) => t.practicaNombre), (t) => t.practicaNombre).slice(0, 10),
      cancelaciones,
      rendimiento,
      porSexoEdad,
      // Hasta que dia se conto la agenda: en el mes en curso no tiene sentido sumar
      // las horas que todavia no pasaron, darian un rendimiento falso para abajo.
      agendaHasta: hastaTope,
    }), true;
  }

  // -- Liquidacion de profesionales --
  // Cuanto le toca a cada uno en el mes, segun su contrato. Se calcula al vuelo: no se
  // guarda un numero que despues quede viejo cuando alguien corrige un cobro.
  // Igual que en reprogramar: sin el !idPath, esta ruta se come
  // /liquidacion/<profesional> y el detalle devuelve el listado.
  if (recurso === "liquidacion" && !idPath && method === "GET") {
    const periodo = clean(url.searchParams.get("periodo")) || nowIso().slice(0, 7);
    const delMes = (store.turnos || []).filter((t) => String(t.fecha || "").startsWith(periodo) && t.estado !== "cancelado");
    const items = (store.profesionales || []).map((prof) => {
      const suyos = delMes.filter((t) => t.profesionalId === prof.id);
      const atendidos = suyos.filter((t) => t.estado === "atendido");
      const facturado = money(atendidos.reduce((a, t) => a + (t.importe || 0) + (t.insumos || 0), 0));
      const cobrado = money(atendidos.reduce((a, t) => a + (t.pagado ? (t.importe || 0) + (t.insumos || 0) : (t.sena || 0)), 0));
      const c = prof.contrato || null;
      let aPagar = null, base = "";
      if (c && c.tipo === "porcentaje") {
        base = c.sobre === "facturado" ? "facturado" : "cobrado";
        aPagar = money(((base === "facturado" ? facturado : cobrado) * (c.valor || 0)) / 100);
      } else if (c && c.tipo === "fijo") {
        base = "por turno atendido";
        aPagar = money(atendidos.length * (c.valor || 0));
      }
      return {
        profesionalId: prof.id, profesional: prof.nombre,
        turnos: suyos.length, atendidos: atendidos.length,
        facturado, cobrado,
        // null = no tiene contrato cargado. NO es cero: cero se lee como "no le
        // corresponde nada" y lo que pasa es que nadie cargo como se le paga.
        contrato: c ? { tipo: c.tipo, valor: c.valor, sobre: c.sobre } : null,
        base, aPagar,
      };
    }).filter((x) => x.turnos || x.contrato);
    const total = money(items.reduce((a, x) => a + (x.aPagar || 0), 0));
    const sinContrato = items.filter((x) => !x.contrato).length;
    return json(res, 200, { periodo, items, total, sinContrato }), true;
  }
  // El detalle de uno, para mandarselo o imprimirlo.
  if (recurso === "liquidacion" && idPath && method === "GET") {
    const periodo = clean(url.searchParams.get("periodo")) || nowIso().slice(0, 7);
    const prof = (store.profesionales || []).find((x) => x.id === idPath);
    if (!prof) return json(res, 404, { error: "Ese profesional ya no está en el sistema." }), true;
    const suyos = (store.turnos || []).filter((t) => String(t.fecha || "").startsWith(periodo) &&
      t.estado === "atendido" && t.profesionalId === prof.id)
      .sort((a, b) => String(a.fecha + a.hora).localeCompare(String(b.fecha + b.hora)))
      .map((t) => ({
        fecha: t.fecha, hora: t.hora, paciente: t.pacienteNombre, obraSocial: t.obraSocial || "",
        practica: t.practicaNombre || "", importe: money((t.importe || 0) + (t.insumos || 0)),
        cobrado: money(t.pagado ? (t.importe || 0) + (t.insumos || 0) : (t.sena || 0)),
      }));
    return json(res, 200, { periodo, profesional: prof.nombre, contrato: prof.contrato || null, items: suyos }), true;
  }

  // -- Registro del sistema --
  if (recurso === "registro" && method === "GET") {
    const desde = clean(url.searchParams.get("desde"));
    const hasta = clean(url.searchParams.get("hasta"));
    const usuario = clean(url.searchParams.get("usuario")).toLowerCase();
    const q = clean(url.searchParams.get("q")).toLowerCase();
    const items = (store.registro || [])
      .filter((x) => {
        const dia = String(x.at || "").slice(0, 10);
        if (desde && dia < desde) return false;
        if (hasta && dia > hasta) return false;
        if (usuario && String(x.usuario || "").toLowerCase() !== usuario) return false;
        if (q && (String(x.accion) + " " + String(x.detalle)).toLowerCase().indexOf(q) < 0) return false;
        return true;
      })
      .slice(-500).reverse();
    const usuarios = [...new Set((store.registro || []).map((x) => x.usuario))].sort();
    return json(res, 200, { items, usuarios, total: (store.registro || []).length }), true;
  }

  // -- Transferir agenda: los turnos de uno pasan a otro --
  // Cubre el caso de siempre: el profesional no viene y otro lo reemplaza. Los
  // pacientes conservan SU horario, que es lo que ya tienen anotado.
  if (recurso === "turnos" && idPath === "transferir" && method === "POST") {
    const body = await readBody(req);
    const deId = clean(body.deProfesionalId), aId = clean(body.aProfesionalId);
    const desde = clean(body.desde), hasta = clean(body.hasta) || desde;
    const de = (store.profesionales || []).find((x) => x.id === deId);
    const a = (store.profesionales || []).find((x) => x.id === aId);
    if (!de || !a) return json(res, 404, { error: "Elegí de qué profesional y a cuál." }), true;
    if (deId === aId) return json(res, 400, { error: "Es el mismo profesional." }), true;
    if (!desde) return json(res, 400, { error: "Elegí desde qué día." }), true;
    if (hasta < desde) return json(res, 400, { error: "El día final no puede ser anterior al inicial." }), true;
    const candidatos = (store.turnos || []).filter((t) => t.profesionalId === deId &&
      t.estado !== "cancelado" && t.fecha >= desde && t.fecha <= hasta);
    const movidos = [], chocaron = [];
    candidatos.forEach((t) => {
      // Si el que recibe ya tiene algo a esa hora, NO se pisa: se informa para que
      // alguien decida. Mover dos pacientes al mismo horario es peor que no mover.
      const ocupado = (store.turnos || []).find((x) => x.profesionalId === aId && x.fecha === t.fecha &&
        x.hora === t.hora && x.estado !== "cancelado");
      if (ocupado) {
        chocaron.push({ fecha: t.fecha, hora: t.hora, paciente: t.pacienteNombre, contra: ocupado.pacienteNombre });
        return;
      }
      t.transferidoDe = { profesionalId: t.profesionalId, el: nowIso(), por: me.username };
      t.profesionalId = aId;
      if (a.especialidadId) t.especialidadId = a.especialidadId;
      // El aviso que se le habia mandado decia otro nombre: ya no sirve.
      t.avisadoEl = ""; t.avisadoPor = "";
      movidos.push(t.id);
    });
    if (movidos.length) {
      anotar(store, me, "Agenda transferida", `${movidos.length} turno(s) de ${de.nombre} a ${a.nombre} (${desde} al ${hasta})`);
      saveStore(dataDir, centro, store);
    }
    return json(res, 200, {
      movidos: movidos.length, chocaron,
      // Si el que recibe no atiende esos dias, los turnos quedan igual pero fuera de
      // su grilla: se avisa para que no sorprenda.
      fueraDeHorario: candidatos.filter((t) => t.profesionalId === aId && !horasDelDia(a, t.fecha)).length,
    }), true;
  }

  // -- Reprogramar: la cola de los que quedaron sin turno --
  // Ojo con el orden: esta ruta tiene que pedir que NO venga nada despues, o se
  // come /reprogramar/libres y la pantalla se queda sin horarios que ofrecer.
  if (recurso === "reprogramar" && !idPath && method === "GET") {
    const items = (store.turnos || [])
      .filter((t) => t.aReprogramar && t.estado !== "cancelado")
      .sort((a, b) => String(a.fecha + a.hora).localeCompare(String(b.fecha + b.hora)))
      .map((t) => {
        const prof = (store.profesionales || []).find((x) => x.id === t.profesionalId) || {};
        const tel = soloDigitos(t.celular);
        return {
          id: t.id, fecha: t.fecha, hora: t.hora, paciente: t.pacienteNombre, celular: t.celular,
          profesionalId: t.profesionalId, profesional: prof.nombre || "",
          especialidadId: t.especialidadId || prof.especialidadId || "",
          practicaNombre: t.practicaNombre || "", motivo: t.motivoReprogramar || "",
          whatsapp: tel ? "https://wa.me/" + (tel.startsWith("54") ? tel : "54" + tel.replace(/^0+/, "")) : "",
        };
      });
    return json(res, 200, { items }), true;
  }
  // Horarios libres para ofrecerle al paciente, de aca a `dias` dias.
  if (recurso === "reprogramar" && idPath === "libres" && method === "GET") {
    const profId = clean(url.searchParams.get("profesionalId"));
    const prof = (store.profesionales || []).find((x) => x.id === profId);
    if (!prof) return json(res, 404, { error: "Ese profesional ya no está en el sistema." }), true;
    const hoy = nowIso().slice(0, 10);
    const dias = Math.min(60, Math.max(1, parseInt(url.searchParams.get("dias"), 10) || 21));
    const out = [];
    for (let i = 1; i <= dias && out.length < 12; i++) {
      const f = sumarDias(hoy, i);
      if (bloqueoDe(store, prof.id, f)) continue;
      const delDia = (store.turnos || []).filter((t) => t.profesionalId === prof.id && t.fecha === f && t.estado !== "cancelado");
      const libres = generarSlots(prof, f, delDia).filter((sl) => !sl.turno).map((sl) => sl.hora);
      if (libres.length) out.push({ fecha: f, horarios: libres.slice(0, 14) });
    }
    return json(res, 200, { dias: out }), true;
  }
  // Mover un turno. Vale para cualquiera, no solo los de la cola: cambiar un turno de
  // dia es de lo que mas se hace en un mostrador.
  if (recurso === "turnos" && seg[2] === "mover" && method === "POST") {
    const t = (store.turnos || []).find((x) => x.id === idPath);
    if (!t) return json(res, 404, { error: "Ese turno ya no está." }), true;
    const body = await readBody(req);
    const fecha = clean(body.fecha), hora = clean(body.hora);
    const profId = clean(body.profesionalId) || t.profesionalId;
    const prof = (store.profesionales || []).find((x) => x.id === profId);
    if (!prof) return json(res, 404, { error: "Ese profesional ya no está en el sistema." }), true;
    if (!fecha || !hora) return json(res, 400, { error: "Elegí el día y el horario nuevos." }), true;
    if (bloqueoDe(store, prof.id, fecha)) return json(res, 409, { error: "Ese día tampoco se atiende." }), true;
    const ocupado = (store.turnos || []).find((x) => x.id !== t.id && x.profesionalId === profId &&
      x.fecha === fecha && x.hora === hora && x.estado !== "cancelado");
    if (ocupado) return json(res, 409, { error: "Ya hay un turno en ese horario." }), true;
    // De donde venia, para poder decirselo al paciente y para saber que se movio.
    anotar(store, me, "Turno movido", `${t.pacienteNombre || ""} · de ${t.fecha} ${t.hora} a ${fecha} ${hora}`);
    t.reprogramadoDe = { fecha: t.fecha, hora: t.hora, profesionalId: t.profesionalId, el: nowIso(), por: me.username };
    t.fecha = fecha; t.hora = hora; t.profesionalId = profId;
    t.estado = "dado";
    // Se movio el turno: el aviso que se le habia mandado ya no sirve.
    t.avisadoEl = ""; t.avisadoPor = "";
    delete t.aReprogramar; delete t.motivoReprogramar;
    saveStore(dataDir, centro, store);
    return json(res, 200, { item: t }), true;
  }
  // Sacarlo de la cola sin moverlo (se lo llamo y no puede, o se cancela).
  if (recurso === "turnos" && seg[2] === "sin-reprogramar" && method === "POST") {
    const t = (store.turnos || []).find((x) => x.id === idPath);
    if (!t) return json(res, 404, { error: "Ese turno ya no está." }), true;
    delete t.aReprogramar; delete t.motivoReprogramar;
    saveStore(dataDir, centro, store);
    return json(res, 200, { ok: true }), true;
  }

  // -- Ausencias y feriados --
  if (recurso === "bloqueos") {
    const lista = store.bloqueos || (store.bloqueos = []);
    if (method === "GET") {
      const desde = clean(url.searchParams.get("desde"));
      const items = lista
        .filter((b) => !desde || b.hasta >= desde)
        .sort((a, b) => String(a.desde).localeCompare(String(b.desde)));
      return json(res, 200, { items }), true;
    }
    if (method === "POST") {
      const body = await readBody(req);
      const desde = clean(body.desde);
      const hasta = clean(body.hasta) || desde;
      if (!desde) return json(res, 400, { error: "Poné desde qué día." }), true;
      if (hasta < desde) return json(res, 400, { error: "El día de vuelta no puede ser anterior al de salida." }), true;
      const b = {
        id: uid(), profesionalId: clean(body.profesionalId), desde, hasta,
        motivo: clean(body.motivo), creadoEl: nowIso(), creadoPor: me.username,
      };
      lista.push(b);
      // Los turnos que YA estaban dados no se cancelan solos —eso lo decide una
      // persona— pero quedan marcados para reprogramar, que es una cola de trabajo:
      // si no, dependen de que alguien se acuerde.
      const chocan = (store.turnos || []).filter((t) => t.estado !== "cancelado" &&
        t.fecha >= desde && t.fecha <= hasta && (!b.profesionalId || t.profesionalId === b.profesionalId));
      chocan.forEach((t) => { t.aReprogramar = true; t.motivoReprogramar = b.motivo || "El profesional no atiende ese día"; });
      anotar(store, me, "Agenda anulada", `${b.profesionalId ? (store.profesionales.find((x) => x.id === b.profesionalId) || {}).nombre : "todo el centro"} · ${desde} al ${hasta}${b.motivo ? " · " + b.motivo : ""}`);
      saveStore(dataDir, centro, store);
      return json(res, 200, { item: b, turnosEnElRango: chocan.length }), true;
    }
    if (method === "DELETE" && idPath) {
      store.bloqueos = lista.filter((x) => x.id !== idPath);
      saveStore(dataDir, centro, store);
      return json(res, 200, { ok: true }), true;
    }
  }

  // -- Sala de espera: el dia entero, todos los profesionales de una --
  // La agenda es de a un profesional; la recepcion necesita ver el centro completo
  // para saber a quien le toca y quien esta esperando hace rato.
  if (recurso === "sala" && method === "GET") {
    const fecha = clean(url.searchParams.get("fecha")) || nowIso().slice(0, 10);
    const delDia = (store.turnos || []).filter((t) => t.fecha === fecha && t.estado !== "cancelado");
    // El profesional ve SU columna, igual que en la agenda.
    const soloMio = labRol === "profesional" && me.lab && me.lab.profesionalId ? me.lab.profesionalId : "";
    const profs = (store.profesionales || [])
      .filter((pr) => !soloMio || pr.id === soloMio)
      .map((pr) => {
        const suyos = delDia.filter((t) => t.profesionalId === pr.id)
          .sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
        return {
          id: pr.id, nombre: pr.nombre,
          especialidad: (store.especialidades.find((e2) => e2.id === pr.especialidadId) || {}).nombre || "",
          consultorio: (store.consultorios.find((c2) => c2.id === pr.consultorioId) || {}).nombre || "",
          turnos: suyos,
        };
      })
      .filter((pr) => pr.turnos.length);
    const cuenta = (est) => delDia.filter((t) => t.estado === est).length;
    return json(res, 200, {
      fecha,
      profesionales: profs,
      totales: {
        turnos: delDia.length, esperando: cuenta("esperando"), atendidos: cuenta("atendido"),
        ausentes: cuenta("ausente") + cuenta("ausente_aviso"), porVenir: cuenta("dado"),
      },
    }), true;
  }

  // -- Usuarios del centro: a quien de NS se le da acceso y con que rol --
  // No hay padron propio: se le pone el rol al usuario de NS que ya existe. Un solo
  // login, un solo lugar donde dar de baja a alguien.
  if (recurso === "usuarios") {
    if (!ctx.loadUsers || !ctx.saveUsers) return json(res, 500, { error: "No se pudo abrir la lista de usuarios." }), true;
    const users = ctx.loadUsers() || [];
    if (method === "GET") {
      const items = users
        .filter((u) => u.active !== false && !LAB_ROLES_NS_FUERA.has(u.role))
        .map((u) => ({
          username: u.username, nombre: u.name || u.username, rolNs: u.role,
          rol: u.role === "admin" ? "admin" : ((u.lab && u.lab.rol) || ""),
          permisos: u.role === "admin" ? LAB_TODOS.slice() : labPermisosDe(u),
          profesionalId: (u.lab && u.lab.profesionalId) || "",
          esAdminNs: u.role === "admin",
        }));
      return json(res, 200, {
        items,
        catalogo: LAB_PERMISOS_CAT,
        plantillas: LAB_PLANTILLAS,
      }), true;
    }
    if (method === "POST") {
      const body = await readBody(req);
      const uname = clean(body.username).toLowerCase();
      const rol = clean(body.rol);
      const u = users.find((x) => String(x.username).toLowerCase() === uname);
      if (!u) return json(res, 404, { error: "Ese usuario ya no existe." }), true;
      if (u.role === "admin") return json(res, 400, { error: "Un administrador ya entra a todo: no hace falta darle un puesto." }), true;
      if (rol && rol !== "personalizado" && !LAB_PLANTILLAS[rol]) return json(res, 400, { error: "Ese puesto no existe. Elegí uno de la lista." }), true;
      // Lo que manda es la lista de permisos. Si no viene, se toman los de la
      // plantilla del puesto elegido.
      const permisos = Array.isArray(body.permisos)
        ? body.permisos.map(clean).filter((x) => LAB_TODOS.includes(x))
        : (LAB_PLANTILLAS[rol] || []).slice();
      // Sin permisos = se le saca el acceso. Se borra el campo entero para no dejar
      // basura que despues confunda al leer el usuario.
      if (!permisos.length) delete u.lab;
      // El CENTRO es el que se esta administrando en ese momento. Sin esto, el usuario
      // quedaba con permisos pero sin centro y no podia entrar a nada: el sistema le
      // decia "tu usuario no tiene un centro asignado" y no habia donde cargarlo.
      else u.lab = { rol: rol || "personalizado", permisos, centro, profesionalId: clean(body.profesionalId) };
      anotar(store, me, "Permisos cambiados",
        `${u.name || u.username}: ${permisos.length ? permisos.join(", ") : "sin acceso"}`);
      saveStore(dataDir, centro, store);
      ctx.saveUsers(users);
      return json(res, 200, { ok: true, username: u.username, rol: (u.lab && u.lab.rol) || "", permisos: (u.lab && u.lab.permisos) || [] }), true;
    }
  }

  // -- Practicas del centro, con su valor por obra social --
  // Va aparte del CRUD generico porque `valores` no es un campo de texto: es un mapa
  // { idObraSocial: importe } y hay que validarlo contra el catalogo.
  // -- Valores de UNA obra social para TODAS las practicas --
  // La obra social manda su lista de precios entera; cargarla practica por practica
  // es inusable. Tambien aplica el aumento anual en %, que es como llegan despues.
  if (recurso === "practicas" && idPath === "valores" && method === "POST") {
    const body = await readBody(req);
    const osId = clean(body.obraSocialId);
    if (!(store.obrasSociales || []).some((o) => o.id === osId)) {
      return json(res, 400, { error: "Elegí una obra social." }), true;
    }
    const lista = store.practicas || (store.practicas = []);
    let cargados = 0, borrados = 0;
    const pct = parseFloat(body.aumentoPct);
    if (!isNaN(pct) && pct !== 0) {
      // Aumento: SOLO sobre lo que ya tiene valor. Una practica sin valor no se
      // inventa con el aumento.
      lista.forEach((pr) => {
        const v = (pr.valores || {})[osId];
        if (!v) return;
        pr.valores[osId] = money(v * (1 + pct / 100));
        cargados++;
      });
    } else {
      const valores = (body.valores && typeof body.valores === "object") ? body.valores : {};
      Object.keys(valores).forEach((pracId) => {
        const pr = lista.find((x) => x.id === pracId);
        if (!pr) return;
        if (!pr.valores) pr.valores = {};
        const crudo = valores[pracId];
        if (crudo === "" || crudo === null || crudo === undefined) {
          if (pr.valores[osId] !== undefined) { delete pr.valores[osId]; borrados++; }
          return;
        }
        const n = money(crudo);
        if (n > 0) { pr.valores[osId] = n; cargados++; }
        else if (pr.valores[osId] !== undefined) { delete pr.valores[osId]; borrados++; }
      });
    }
    saveStore(dataDir, centro, store);
    return json(res, 200, { ok: true, cargados, borrados, items: lista }), true;
  }

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
      // Lo que hay que hacer antes del estudio: ayuno, vejiga llena, traer estudios
      // previos. Viaja al recordatorio, que es cuando de verdad sirve.
      if (body.preparacion !== undefined) item.preparacion = clean(body.preparacion).slice(0, 400);
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
      saveStore(dataDir, centro, store);
      return json(res, 200, { item }), true;
    }
    if (method === "DELETE" && idPath) {
      store.practicas = lista.filter((x) => x.id !== idPath);
      saveStore(dataDir, centro, store);
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
      lista.unshift(item); saveStore(dataDir, centro, store);
      return json(res, 200, { item }), true;
    }
    if (method === "PUT" && idPath) {
      const idx = lista.findIndex((x) => x.id === idPath);
      if (idx < 0) return json(res, 404, { error: "No encontramos lo que buscabas." }), true;
      const body = await readBody(req);
      lista[idx] = Object.assign({}, lista[idx], sanitizeGenerico(def.campos, body, lista[idx]));
      saveStore(dataDir, centro, store);
      return json(res, 200, { item: lista[idx] }), true;
    }
    if (method === "DELETE" && idPath) {
      store[recurso] = lista.filter((x) => x.id !== idPath); saveStore(dataDir, centro, store);
      return json(res, 200, { ok: true }), true;
    }
  }

  // -- Caja: cierre diario formal (arqueo) --
  if (recurso === "caja" && idPath === "cierre") {
    const fecha = clean(url.searchParams.get("fecha"));
    if (!fecha) return json(res, 400, { error: "Elegí una fecha." }), true;
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
      cierres.unshift(cierre);
      anotar(store, me, "Caja cerrada", `${fecha} · ${cierre.totales.cobrado}`);
      saveStore(dataDir, centro, store);
      return json(res, 200, { cierre }), true;
    }
    if (method === "DELETE") {
      anotar(store, me, "Caja reabierta", fecha);
      store.cierres = cierres.filter((c) => c.fecha !== fecha);
      saveStore(dataDir, centro, store);
      return json(res, 200, { ok: true }), true;
    }
  }

  // -- Profesionales --
  if (recurso === "profesionales") {
    const lista = store.profesionales;
    if (method === "GET") return json(res, 200, { items: lista }), true;
    if (method === "POST") {
      const body = await readBody(req);
      const item = Object.assign({ id: uid(), creadoEl: nowIso() }, sanitizeProfesional(body));
      lista.unshift(item); saveStore(dataDir, centro, store);
      return json(res, 200, { item }), true;
    }
    if (method === "PUT" && idPath) {
      const idx = lista.findIndex((x) => x.id === idPath);
      if (idx < 0) return json(res, 404, { error: "No encontramos lo que buscabas." }), true;
      const body = await readBody(req);
      lista[idx] = sanitizeProfesional(body, lista[idx]);
      saveStore(dataDir, centro, store);
      return json(res, 200, { item: lista[idx] }), true;
    }
    if (method === "DELETE" && idPath) {
      store.profesionales = lista.filter((x) => x.id !== idPath); saveStore(dataDir, centro, store);
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
      store.evoluciones.push(ev); saveStore(dataDir, centro, store);
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
      store.estudios.push(est); saveStore(dataDir, centro, store);
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
        const dir = estudiosDir(dataDir, centro);
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
        saveStore(dataDir, centro, store);
        return json(res, 200, { item: est }), true;
      } catch (error) {
        return json(res, 400, { error: error.message || "No se pudo subir el archivo." }), true;
      }
    }
    if (method === "GET") {
      if (!est.archivo) return json(res, 404, { error: "Ese estudio no tiene archivo." }), true;
      const file = path.join(estudiosDir(dataDir, centro), est.archivo.guardadoComo);
      if (!fs.existsSync(file)) return json(res, 404, { error: "El archivo del estudio no aparece. Volvé a adjuntarlo." }), true;
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
      try { fs.unlinkSync(path.join(estudiosDir(dataDir, centro), est.archivo.guardadoComo)); } catch { /* ya no estaba */ }
    }
    store.estudios = store.estudios.filter((x) => x.id !== idPath);
    saveStore(dataDir, centro, store);
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
    anotar(store, me, "Pacientes unificados", `${fusionar.length} ficha(s) fusionada(s)`);
    store.pacientes = (store.pacientes || []).filter((p) => !set.has(p.id));
    saveStore(dataDir, centro, store);
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
      return pac ? (json(res, 200, { item: pac }), true) : (json(res, 404, { error: "No encontramos lo que buscabas." }), true);
    }
    if (method === "POST") {
      const body = await readBody(req);
      const item = Object.assign({ id: uid(), creadoEl: nowIso() }, sanitizePaciente(body));
      lista.unshift(item); saveStore(dataDir, centro, store);
      return json(res, 200, { item }), true;
    }
    if (method === "PUT" && idPath) {
      const idx = lista.findIndex((x) => x.id === idPath);
      if (idx < 0) return json(res, 404, { error: "No encontramos lo que buscabas." }), true;
      const body = await readBody(req);
      lista[idx] = sanitizePaciente(body, lista[idx]);
      saveStore(dataDir, centro, store);
      return json(res, 200, { item: lista[idx] }), true;
    }
    if (method === "DELETE" && idPath) {
      const turnosFuturos = (store.turnos || []).filter((t) => t.pacienteId === idPath && t.estado !== "cancelado" && t.fecha >= nowIso().slice(0, 10)).length;
      const borrado = lista.find((x) => x.id === idPath);
      anotar(store, me, "Paciente eliminado", borrado ? `${borrado.apellido || ""} ${borrado.nombre || ""} ${borrado.documento || ""}`.trim() : idPath);
      store.pacientes = lista.filter((x) => x.id !== idPath);
      // La historia clínica del paciente se va con él; los turnos conservan el nombre.
      store.evoluciones = (store.evoluciones || []).filter((e) => e.pacienteId !== idPath);
      saveStore(dataDir, centro, store);
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
      let profId = clean(url.searchParams.get("profesionalId"));
      const fecha = clean(url.searchParams.get("fecha"));
      // Un profesional ve SU agenda y nada mas, aunque pida otra por la URL.
      if (labRol === "profesional" && me.lab && me.lab.profesionalId) profId = me.lab.profesionalId;
      if (!profId || !fecha) return json(res, 400, { error: "Elegí un profesional para ver su agenda." }), true;
      const prof = store.profesionales.find((x) => x.id === profId);
      if (!prof) return json(res, 404, { error: "Ese profesional ya no está en el sistema." }), true;
      const delDia = lista.filter((t) => t.profesionalId === profId && t.fecha === fecha && t.estado !== "cancelado");
      // Si ese dia no se atiende, no se ofrecen horarios: dar un turno para el dia que
      // el profesional no esta es el error que despues se paga en el mostrador. Los
      // turnos YA dados se siguen mostrando — hay que poder reprogramarlos.
      const bloqueo = bloqueoDe(store, profId, fecha);
      const slots = bloqueo ? delDia.map((t) => ({ hora: t.hora, turno: t })) : generarSlots(prof, fecha, delDia);
      return json(res, 200, { profesional: prof, fecha, slots, cantidad: delDia.length, bloqueo }), true;
    }
    if (method === "POST") {
      const body = await readBody(req);
      const t = sanitizeTurno(body, null, store);
      if (!t.profesionalId || !t.fecha || !t.hora) return json(res, 400, { error: "Falta elegir el profesional, el día o el horario." }), true;
      // Evitar doble turno en el mismo slot (salvo sobreturno explícito).
      const ocupado = lista.find((x) => x.profesionalId === t.profesionalId && x.fecha === t.fecha && x.hora === t.hora && x.estado !== "cancelado");
      if (ocupado && !body.permitirSobreturno) return json(res, 409, { error: "Ya hay un turno en ese horario." }), true;
      t.id = uid(); t.creadoEl = nowIso(); t.creadoPor = me.username;
      lista.push(t);
      anotar(store, me, "Turno dado", `${t.pacienteNombre || "sin nombre"} · ${t.fecha} ${t.hora}`);
      saveStore(dataDir, centro, store);
      return json(res, 200, { item: t }), true;
    }
    if (method === "PUT" && idPath) {
      const idx = lista.findIndex((x) => x.id === idPath);
      if (idx < 0) return json(res, 404, { error: "No encontramos lo que buscabas." }), true;
      const body = await readBody(req);
      lista[idx] = sanitizeTurno(body, lista[idx], store);
      saveStore(dataDir, centro, store);
      return json(res, 200, { item: lista[idx] }), true;
    }
    if (method === "DELETE" && idPath) {
      // Se anota ANTES de sacarlo (despues ya no hay de donde leer el nombre) y antes
      // de guardar, o la anotacion no llega al archivo.
      const cancelado = lista.find((x) => x.id === idPath);
      anotar(store, me, "Turno cancelado",
        cancelado ? `${cancelado.pacienteNombre || "sin nombre"} · ${cancelado.fecha} ${cancelado.hora}` : idPath);
      store.turnos = lista.filter((x) => x.id !== idPath);
      saveStore(dataDir, centro, store);
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
      return it ? (json(res, 200, { item: it }), true) : (json(res, 404, { error: "No encontramos lo que buscabas." }), true);
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
      lista.unshift(presup); saveStore(dataDir, centro, store);
      return json(res, 200, { item: presup }), true;
    }
    if (method === "DELETE" && idPath) { store.presupuestos = lista.filter((x) => x.id !== idPath); saveStore(dataDir, centro, store); return json(res, 200, { ok: true }), true; }
  }

  json(res, 404, { error: "Esa parte del sistema no existe." }), true;
  return true;
}

module.exports = { handleLab, handleLabPublico };
