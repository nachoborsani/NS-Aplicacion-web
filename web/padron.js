"use strict";
// Padrón de afiliados por cliente: DNI ↔ Beneficio ↔ Nombre (+ N° Trámite).
// Se alimenta subiendo las turneras que los clientes nos mandan. Cada turnera
// crea pacientes nuevos o completa/actualiza los existentes (dedup por DNI).
// Sirve para matchear informes contra la bandeja por número exacto en vez de
// por nombre, y es reutilizable en generación de OME, activación y facturación.

const XLSX = require("xlsx");

function soloDigitos(v) {
  return String(v == null ? "" : v).replace(/\D+/g, "");
}
function limpiarNombre(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}
function norm(v) {
  return String(v == null ? "" : v)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim();
}

// La turnera trae: Beneficiario (benef PAMI 14 díg), Nombre ("APELLIDO NOMBRE"),
// Documento (DNI), Trámite DNI. Detectamos por encabezado, no por posición fija.
function detectarColumnas(header) {
  const idx = { benef: -1, nombre: -1, dni: -1, tramite: -1 };
  header.forEach((h, i) => {
    const t = norm(h);
    if (idx.benef < 0 && t.includes("benefici")) idx.benef = i;
    else if (idx.tramite < 0 && t.includes("tramite")) idx.tramite = i;
    else if (idx.dni < 0 && (t === "documento" || t === "dni" || t.includes("documento"))) idx.dni = i;
    else if (idx.nombre < 0 && t.includes("nombre")) idx.nombre = i;
  });
  return idx;
}

// Devuelve { rows: [{beneficio, dni, nombre, tramite}], total, sinDni }
function parseTurnera(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("El Excel no tiene hojas.");
  const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: "" });
  if (!matrix.length) throw new Error("El Excel está vacío.");

  const headerRow = matrix.findIndex((r) => {
    const t = norm((r || []).join(" "));
    return t.includes("benefici") && t.includes("documento");
  });
  if (headerRow < 0) throw new Error("No parece una turnera: faltan las columnas Beneficiario y Documento.");

  const idx = detectarColumnas(matrix[headerRow]);
  if (idx.dni < 0 || idx.benef < 0) {
    throw new Error("La turnera no tiene columna de Documento o de Beneficiario.");
  }

  const rows = [];
  let sinDni = 0;
  for (let i = headerRow + 1; i < matrix.length; i += 1) {
    const src = matrix[i] || [];
    const dni = soloDigitos(src[idx.dni]);
    const beneficio = soloDigitos(src[idx.benef]);
    const nombre = limpiarNombre(idx.nombre >= 0 ? src[idx.nombre] : "");
    const tramite = idx.tramite >= 0 ? soloDigitos(src[idx.tramite]) : "";
    if (!dni && !beneficio && !nombre) continue; // fila vacía
    if (!dni) { sinDni += 1; continue; }         // sin DNI no sirve para el padrón
    rows.push({ dni, beneficio, nombre, tramite });
  }
  return { rows, total: rows.length, sinDni };
}

// "APELLIDO NOMBRE(S)" -> {apellido, nombres} heurístico (primer token = apellido).
// El nombre completo se guarda tal cual; esto es solo para mostrarlo separado.
function partirNombre(nombreCompleto) {
  const partes = limpiarNombre(nombreCompleto).split(" ").filter(Boolean);
  if (!partes.length) return { apellido: "", nombres: "" };
  if (partes.length === 1) return { apellido: partes[0], nombres: "" };
  return { apellido: partes[0], nombres: partes.slice(1).join(" ") };
}

// Mergea las filas de una turnera dentro del padrón de un cliente (objeto por DNI).
// No pisa datos buenos con vacíos: solo completa o actualiza lo que viene con valor.
// Devuelve { creados, actualizados, sinCambio }.
function mergeRows(padronCliente, rows, sourceLabel, nowISO) {
  let creados = 0, actualizados = 0, sinCambio = 0;
  for (const r of rows) {
    const prev = padronCliente[r.dni];
    if (!prev) {
      padronCliente[r.dni] = {
        dni: r.dni,
        beneficio: r.beneficio || "",
        nombre: r.nombre || "",
        tramite: r.tramite || "",
        updatedAt: nowISO,
        sources: sourceLabel ? [sourceLabel] : [],
      };
      creados += 1;
      continue;
    }
    let cambio = false;
    if (r.beneficio && r.beneficio !== prev.beneficio) { prev.beneficio = r.beneficio; cambio = true; }
    if (r.tramite && r.tramite !== prev.tramite) { prev.tramite = r.tramite; cambio = true; }
    if (r.nombre && r.nombre !== prev.nombre) { prev.nombre = r.nombre; cambio = true; }
    if (cambio) {
      prev.updatedAt = nowISO;
      if (sourceLabel && !(prev.sources || []).includes(sourceLabel)) {
        prev.sources = [...(prev.sources || []), sourceLabel];
      }
      actualizados += 1;
    } else {
      sinCambio += 1;
    }
  }
  return { creados, actualizados, sinCambio };
}

module.exports = { parseTurnera, mergeRows, partirNombre, soloDigitos, normNombre: norm };
