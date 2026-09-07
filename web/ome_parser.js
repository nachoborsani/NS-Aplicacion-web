"use strict";
// Parseo de pedidos de OME (texto de WhatsApp -> datos de la orden). Reglas puras,
// sin IA: mismas que el autocompletado de la web (ver omeLeerPedido en app.js).
// Cada especialidad: cómo la nombran en el mensaje (rx), cómo figura en el médico
// (med) y el código de consulta del nomenclador (codigo).

const ESPECIALIDADES = [
  { key: "Cardiología",       codigo: "570129", rx: /cardiolog/,           med: /cardiolog/ },
  { key: "Neumonología",      codigo: "820157", rx: /neumonolog|neumolog/, med: /neumonolog|neumolog/ },
  { key: "Urología",          codigo: "820167", rx: /urolog/,              med: /urolog/ },
  { key: "Traumatología",     codigo: "820165", rx: /traumato|ortopedia/,  med: /traumatolog|ortopedia/ },
  { key: "Ginecología",       codigo: "820145", rx: /ginec/,               med: /ginecolog/ },
  { key: "Gastroenterología", codigo: "820139", rx: /gastro/,              med: /gastroenterolog/ },
  { key: "ORL",               codigo: "820168", rx: /\borl\b|otorrino/,    med: /otorrinolaring/ },
];

function norm(s) {
  return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// texto -> { especialidad, nombre, dni, beneficio, raw }
function parsePedido(texto) {
  const raw = String(texto == null ? "" : texto).trim();
  if (!raw) return null;
  const n = norm(raw);
  let dni = "";
  const mDni = n.match(/dni\s*[:.\-]?\s*(\d{6,9})/);
  if (mDni) dni = mDni[1];
  let beneficio = "";
  const mBen = n.match(/\b(\d{11,14})\b/);
  if (mBen) beneficio = mBen[1];
  let especialidad = null;
  for (const e of ESPECIALIDADES) { if (e.rx.test(n)) { especialidad = e; break; } }
  // Nombre por resta: saco números, "dni", relleno y las palabras de especialidad.
  let t = " " + raw.replace(/[,.;]/g, " ") + " ";
  t = t.replace(/\d+/g, " ");
  const ESPSTRIP = /\b(cardiolog|neumonolog|neumolog|urolog|traumato|ortopedia|ginec|gastro|otorrino|orl)[a-zñáéíóúü]*/gi;
  const STRIP = /\b(hola|buen|buenas|buenos|dia|dias|día|días|tarde|tardes|noche|noches|necesito|necesita|necesitamos|queria|quería|quisiera|solicitar|solicito|solicitamos|pedir|pido|una|un|unas|unos|ome|omes|orden|ordenes|órden|de|del|para|el|la|los|las|al|con|sin|pcte|paciente|pac|favor|por|derivacion|derivación|me|y|se|su|le|es|este|esta|dni)\b/gi;
  t = t.replace(ESPSTRIP, " ").replace(STRIP, " ");
  const nombre = t.replace(/\s+/g, " ").trim();
  return { especialidad, nombre, dni, beneficio, raw };
}

// Elige el médico de una especialidad entre los del cliente. Prioridad:
// preferido con clave > preferido > con clave > el primero. Excluye implícitamente
// nada (el llamador decide qué hacer si el elegido no tiene clave).
function resolverMedico(especialidad, medicos) {
  if (!especialidad) return { medico: null, varios: false };
  const conClave = (m) => !!(m.tieneClave || m.claveEnc);
  const dela = (Array.isArray(medicos) ? medicos : []).filter((m) => especialidad.med.test(norm(m.especialidad)));
  if (!dela.length) return { medico: null, varios: false };
  const pick = dela.find((m) => m.preferido && conClave(m))
    || dela.find((m) => m.preferido)
    || dela.find((m) => conClave(m))
    || dela[0];
  return { medico: pick, varios: dela.length > 1 };
}

module.exports = { ESPECIALIDADES, norm, parsePedido, resolverMedico };
