"use strict";
// Generador de informes médicos (PDF) — modelo Centro Médico Caballito / Cardiología-ECG.
// Usa pdf-lib para embeber el logo y la firma (imágenes) y armar el layout del modelo.
// Por ahora el modelo está hardcodeado; después se hace parametrizable por centro.

const fs = require("fs");
const path = require("path");
// pdf-lib se carga de forma perezosa dentro de buildInformePdf: si por algún
// motivo no está instalado, el server igual arranca (solo falla generar el PDF),
// en vez de tumbar toda la web al importar este módulo.

const ASSETS = path.join(__dirname, "assets", "informes");

const PIE_CABALLITO = ["Centro médico Caballito", "Av. directorio 1662", "Tel: 6338713 / 46330078 / 46324002"];
const MODELOS = {
  // --- Centro Médico Caballito: misma doctora, cambia el estudio realizado ---
  "caballito-consulta-570129": {
    label: "Caballito — Consulta cardiología c/ ECG (570129)",
    short: "Caballito · Consulta ECG",
    practica: "Consulta cardiológica c/ ECG — 570129",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "570129",
    estudio: "Consulta con especialista en cardiología (incluye ECG)",
    estudioArchivo: "Consulta Cardiologia ECG",
    solicitanteDefault: "Dra. Naiara, Jacinto",
    textoDefault: "Ecg sin complicaciones, trazado sin valor patológico.",
    pie: PIE_CABALLITO,
  },
  "caballito-electro": {
    label: "Caballito — Electrocardiograma simple",
    short: "Caballito · ECG",
    practica: "ECG simple",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "",
    estudio: "Electrocardiograma",
    solicitanteDefault: "Dra. Naiara, Jacinto",
    textoDefault: "Ecg sin complicaciones, trazado sin valor patológico.",
    pie: PIE_CABALLITO,
  },
  // --- CIMA (Innovación en Medicina): electro, firma Dr. Savia ---
  "cima-electro": {
    label: "CIMA — Electrocardiograma",
    short: "CIMA · ECG",
    practica: "Electrocardiograma",
    centro: "CIMA",
    logo: "cima_logo.png",
    logoW: 150,
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "",
    estudio: "Electrocardiograma",
    solicitanteDefault: "Gerardo Savia",
    textoDefault: "Trazado sin valor patológico.",
    pie: ["CIMA - Innovación en Medicina", "Islas Malvinas 2722 - Isidro Casanova"],
  },
};
// Para el desplegable del front (una sola fuente de verdad).
function listarModelos() {
  return Object.keys(MODELOS).map((k) => ({
    key: k,
    label: MODELOS[k].label || k,
    short: MODELOS[k].short || MODELOS[k].label || k,
    practica: MODELOS[k].practica || MODELOS[k].estudio || k,
    centro: MODELOS[k].centro || "",
    especialidad: MODELOS[k].especialidad || "",
  }));
}

// Las firmas (dato sensible) viven en <datos>/informes/ (el volumen en producción,
// o web/data en local) — ahí las sube el admin. El logo va en assets del repo.
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");
function readAsset(name) {
  try { return fs.readFileSync(path.join(DATA_DIR, "informes", name)); } catch {}
  try { return fs.readFileSync(path.join(ASSETS, name)); } catch { return null; }
}

function wrapText(text, font, size, maxW) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function sanitizeFilename(value) {
  return String(value || "informe")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "informe";
}

const DEFAULT_MODELO = "caballito-consulta-570129";

function informeFilename(modeloKey, paciente) {
  const modelo = MODELOS[modeloKey] || MODELOS[DEFAULT_MODELO];
  const nombre = sanitizeFilename(paciente && paciente.nombre) || "Paciente";
  const estudio = sanitizeFilename(modelo.estudioArchivo || modelo.estudio);
  return `${nombre} - ${estudio}.pdf`;
}

async function buildInformePdf(modeloKey, input) {
  // pdf-lib va vendorizado en el repo (bundle auto-contenido) para no depender
  // del npm install de Railway (su cache no instalaba el paquete).
  const { PDFDocument, StandardFonts, rgb } = require("./vendor/pdf-lib.min.js");
  const modelo = MODELOS[modeloKey] || MODELOS[DEFAULT_MODELO];
  const p = (input && input.paciente) || {};
  const texto = ((input && input.textoInforme) || "").trim() || modelo.textoDefault;
  const solicitante = ((input && input.solicitante) || "").trim() || modelo.solicitanteDefault;
  // La firma la define el médico elegido (input.firmaArchivo). Sin archivo -> borrador.
  const firmaArchivo = (input && input.firmaArchivo) || "";

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 vertical
  const { width, height } = page.getSize();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBoldOblique);

  const ink = rgb(0.12, 0.12, 0.12);
  const soft = rgb(0.3, 0.3, 0.3);
  const border = rgb(0.13, 0.13, 0.13);
  const Mx = 46;
  const boxX = Mx;
  const boxW = width - 2 * Mx;
  const PADX = 14;
  const LBLX = boxX + PADX;
  const VALX = boxX + 128;

  const T = (t, x, yy, o = {}) =>
    page.drawText(String(t), { x, y: yy, size: o.size || 10.5, font: o.font || (o.bold ? bold : font), color: o.color || ink });
  const centerT = (t, yy, o = {}) => {
    const f = o.font || (o.bold ? bold : font), s = o.size || 10.5;
    T(t, (width - f.widthOfTextAtSize(String(t), s)) / 2, yy, o);
  };
  const centerIn = (t, x1, x2, yy, o = {}) => {
    const f = o.font || (o.bold ? bold : font), s = o.size || 10.5;
    T(t, x1 + (x2 - x1 - f.widthOfTextAtSize(String(t), s)) / 2, yy, o);
  };
  const drawBox = (topY, h) => page.drawRectangle({ x: boxX, y: topY - h, width: boxW, height: h, borderColor: border, borderWidth: 1 });

  // Borde de página
  page.drawRectangle({ x: 28, y: 28, width: width - 56, height: height - 56, borderColor: border, borderWidth: 1 });

  let y = height - 50;

  // Logo centrado (fondo blanco)
  const logoBuf = readAsset(modelo.logo);
  if (logoBuf) {
    const logo = await doc.embedPng(logoBuf);
    const lw = modelo.logoW || 84, lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: (width - lw) / 2, y: y - lh, width: lw, height: lh });
    y -= lh + 6;
  }

  // Título (bold itálica)
  const ts = 17;
  centerT(modelo.servicio, y - ts, { font: titleFont, size: ts, color: border });
  y -= ts + 22;

  // Caja: Datos de paciente
  {
    const hasDoc = (p.documento || "").trim();
    const innerLines = 1 + 2 + (hasDoc ? 1 : 0);
    const h = innerLines * 15 + 14;
    drawBox(y, h);
    let iy = y - 18;
    T("Datos de paciente", LBLX, iy, { bold: true, size: 11 }); iy -= 16;
    T("Nombre:", LBLX, iy, { bold: true }); T(p.nombre || "—", VALX, iy); iy -= 15;
    if (hasDoc) { T("Documento:", LBLX, iy, { bold: true }); T(hasDoc, VALX, iy); iy -= 15; }
    T("N° Benef.:", LBLX, iy, { bold: true }); T(p.benef || "—", VALX, iy);
    y -= h + 12;
  }

  // Caja: Médico Solicitante
  { const h = 34; drawBox(y, h); T("Médico Solicitante:", LBLX, y - 22, { bold: true }); T(solicitante, VALX + 30, y - 22); y -= h + 12; }

  // Caja: Estudio realizado
  { const h = 34; drawBox(y, h); T("Estudio realizado:", LBLX, y - 22, { bold: true }); T(modelo.estudio, VALX + 30, y - 22, { bold: true }); y -= h + 22; }

  // INFORME (sin caja)
  T("INFORME", LBLX, y, { bold: true, size: 10.5, color: soft });
  y -= 20;
  const lines = wrapText(texto, font, 10.5, boxW - 2 * PADX);
  for (const ln of lines) { T(ln, LBLX, y); y -= 15; }

  // FECHA + Firma (posición fija)
  const fy = 248;
  T("FECHA:", LBLX, fy, { bold: true, size: 11 });
  T(p.fecha || "—", LBLX + 56, fy, { size: 11 });
  const firmaAreaW = 200, firmaAreaX = width - Mx - firmaAreaW;
  const firmaBuf = firmaArchivo ? readAsset(firmaArchivo) : null;
  if (firmaBuf) {
    const firma = await doc.embedPng(firmaBuf);
    const fw = 150, fh = (firma.height / firma.width) * fw;
    page.drawImage(firma, { x: firmaAreaX + (firmaAreaW - fw) / 2, y: fy - 22, width: fw, height: fh });
  } else {
    centerIn("Firma Médico", firmaAreaX, width - Mx, fy, { bold: true, size: 11 });
    page.drawLine({ start: { x: firmaAreaX + 12, y: fy - 34 }, end: { x: width - Mx - 12, y: fy - 34 }, thickness: 0.8, color: border });
  }

  // Caja: pie del centro (abajo)
  {
    const top = 100, h = 52;
    drawBox(top, h);
    let py = top - 18;
    centerT(modelo.pie[0], py, { bold: true, size: 12 }); py -= 15;
    for (let i = 1; i < modelo.pie.length; i++) { centerT(modelo.pie[i], py, { bold: true, size: 10.5 }); py -= 14; }
  }

  return await doc.save();
}

module.exports = { MODELOS, buildInformePdf, informeFilename, listarModelos };
