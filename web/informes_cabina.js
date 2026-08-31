"use strict";
// Cabina de informes: adaptador de la bandeja cruda al shape que espera el matcher,
// y helpers de compactado. La orquestación (leer archivo, matchear, guardar) vive en
// server.js, que tiene los loaders de bandeja/padrón. Módulo puro y testeable.

function normTxt(v) {
  return String(v == null ? "" : v).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}
function digs(v) { return String(v == null ? "" : v).replace(/\D+/g, ""); }

// La bandeja se guarda con las columnas crudas del Excel de PAMI. La llevamos al
// shape { nOrden, beneficio, nombre, practica, turno, validada, transmitida } que
// usa informes_match. El beneficio puede venir en notación científica ("1.4E+13")
// si el Excel lo trajo como número → lo reconstruimos.
function bandejaParaMatcher(bandejaObj) {
  const rows = (bandejaObj && Array.isArray(bandejaObj.rows)) ? bandejaObj.rows : [];
  if (!rows.length) return [];
  const keys = Object.keys(rows[0] || {});
  const findKey = (re) => keys.find((k) => re.test(normTxt(k))) || "";
  const kPrac = findKey(/PRACTICA/), kTrasm = findKey(/TRASMITIDA|TRANSMITIDA/),
        kValid = findKey(/VALIDADA/), kBenef = findKey(/BENEFICIO/), kTurno = findKey(/TURNO/),
        kNombre = findKey(/APELLIDO/), kOme = findKey(/ORDEN/);
  return rows.map((r) => ({
    nOrden: digs(r[kOme]),
    beneficio: beneficioLimpio(r[kBenef]),
    nombre: String(r[kNombre] || "").trim(),
    practica: String(r[kPrac] || ""),
    turno: String(r[kTurno] || "").trim(),
    validada: String(r[kValid] || "").trim().toUpperCase() === "S",
    transmitida: String(r[kTrasm] || "").trim().toUpperCase() === "S",
  }));
}

// "1.4013819280900E+13" o "14013819280900" -> "14013819280900".
function beneficioLimpio(v) {
  const s = String(v == null ? "" : v).trim();
  if (/e\+?\d+/i.test(s)) {
    const n = Number(s);
    if (isFinite(n)) return String(Math.round(n));
  }
  return digs(s);
}

// El "reporte" (la bandeja transmitida de un mes cerrado que sube el user, ej.
// julio) guarda las filas ya sanitizadas. Las llevamos al MISMO shape del matcher,
// para poder cruzar informes de estudios de fin del mes anterior (que llegan a
// principio del mes en curso, ej. Otero: estudio 31/07 con informe en agosto).
function reporteParaMatcher(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    nOrden: digs(r.order),
    beneficio: beneficioLimpio(r.benefit),
    nombre: String(r.patientName || "").trim(),
    practica: [r.practiceCode, r.practiceDescription || r.practiceText].filter(Boolean).join(" - ").trim(),
    turno: String(r.appointmentLabel || r.appointmentAt || "").trim(),
    validada: !!r.validated,
    transmitida: !!r.transmitted,
  }));
}

// Deja un candidato liviano para el índice (no guardamos toda la fila de la bandeja).
function candidatoLiviano(p) {
  return { ome: p.nOrden || "", beneficio: p.beneficio || "", nombre: p.nombre || "", practica: p.practica || "",
           turno: p.turno || "", transmitida: !!p.transmitida, validada: !!p.validada };
}

// Etiqueta legible del estado para la UI (castellano llano).
const ETIQUETA_ESTADO = {
  ok: "Listo para subir",
  factura: "Factura",
  ya_transmitido: "Ya transmitido",
  revisar_practica: "Revisar cuál práctica",
  revisar_nombre: "Revisar nombre",
  sin_ome: "Sin OME en la bandeja",
  sin_match: "No se encontró",
};

module.exports = { bandejaParaMatcher, reporteParaMatcher, beneficioLimpio, candidatoLiviano, ETIQUETA_ESTADO, normTxt, digs };
