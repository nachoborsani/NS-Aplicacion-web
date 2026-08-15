"use strict";
// Generador de informes médicos (PDF) — modelo Centro Médico Caballito / Cardiología-ECG.
// Usa pdf-lib para embeber el logo y la firma (imágenes) y armar el layout del modelo.
// Por ahora el modelo está hardcodeado; después se hace parametrizable por centro.

const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const ASSETS = path.join(__dirname, "assets", "informes");

const MODELOS = {
  "caballito-cardio-ecg": {
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    servicio: "SERVICIO DE CARDIOLOGÍA",
    codigoPractica: "570129",
    estudio: "Electrocardiograma",
    solicitanteDefault: "Dra. Naiara, Jacinto",
    textoDefault: "Ecg sin complicaciones, trazado sin valor patológico.",
    pie: ["Centro médico Caballito", "Av. directorio 1662", "Tel: 6338713 / 46330078 / 46324002"],
    firma: "firma-naiara.png", // incluye nombre + matrícula en la imagen
  },
};

function readAsset(name) {
  // Las firmas (dato sensible) viven en el volumen del servidor, no en el repo.
  // Buscamos primero en el volumen (<volumen>/informes/) y si no, en assets del
  // repo (donde va el logo). En local, todo sale de assets.
  const vol = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (vol) {
    try { return fs.readFileSync(path.join(vol, "informes", name)); } catch {}
  }
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

function informeFilename(modeloKey, paciente) {
  const modelo = MODELOS[modeloKey] || MODELOS["caballito-cardio-ecg"];
  const nombre = sanitizeFilename(paciente && paciente.nombre) || "Paciente";
  return `${nombre} - ${modelo.estudio}.pdf`;
}

async function buildInformePdf(modeloKey, input) {
  const modelo = MODELOS[modeloKey] || MODELOS["caballito-cardio-ecg"];
  const p = (input && input.paciente) || {};
  const texto = ((input && input.textoInforme) || "").trim() || modelo.textoDefault;
  const solicitante = ((input && input.solicitante) || "").trim() || modelo.solicitanteDefault;
  const firmar = !(input && input.firmar === false);

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 vertical
  const { width, height } = page.getSize();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.12, 0.12, 0.12);
  const soft = rgb(0.32, 0.32, 0.32);
  const navy = rgb(0.043, 0.121, 0.227);
  const petrol = rgb(0.055, 0.345, 0.333);
  const boxBg = rgb(0.98, 0.98, 0.98);
  const boxBorder = rgb(0.88, 0.88, 0.88);
  const M = 64;
  let y = height - 46;

  const T = (t, x, yy, o = {}) =>
    page.drawText(String(t), { x, y: yy, size: o.size || 10.5, font: o.bold ? bold : font, color: o.color || ink });
  const centerT = (t, yy, o = {}) => {
    const f = o.bold ? bold : font, s = o.size || 10.5;
    T(t, (width - f.widthOfTextAtSize(String(t), s)) / 2, yy, o);
  };
  const field = (label, value) => {
    T(label, M, y, { bold: true });
    T(value, M + bold.widthOfTextAtSize(label, 10.5) + 6, y);
    y -= 15;
  };

  // Logo centrado
  const logoBuf = readAsset(modelo.logo);
  if (logoBuf) {
    const logo = await doc.embedPng(logoBuf);
    const lw = 92, lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: (width - lw) / 2, y: y - lh, width: lw, height: lh });
    y -= lh + 14;
  }

  centerT(modelo.servicio, y, { bold: true, size: 12.5, color: petrol });
  y -= 26;

  T("Datos de paciente", M, y, { bold: true, size: 9.5, color: soft });
  y -= 16;
  field("Nombre:", p.nombre || "—");
  if ((p.documento || "").trim()) field("Documento:", p.documento.trim());
  field("N° Benef.:", p.benef || "—");
  y -= 6;
  field("Médico Solicitante:", solicitante);
  field("Estudio realizado:", modelo.estudio);
  y -= 12;

  T("INFORME", M, y, { bold: true, size: 9.5, color: soft });
  y -= 20;
  const lines = wrapText(texto, font, 10.5, width - 2 * M);
  for (const ln of lines) { T(ln, M, y); y -= 15; }
  y -= 34;

  // Fecha (izquierda) + Firma (derecha)
  const firmaColW = 170;
  const firmaColX = width - M - firmaColW;
  const firmaBuf = firmar ? readAsset(modelo.firma) : null;
  if (firmaBuf) {
    const firma = await doc.embedPng(firmaBuf);
    const fw = 150, fh = (firma.height / firma.width) * fw;
    page.drawImage(firma, { x: firmaColX + (firmaColW - fw) / 2, y: y - fh, width: fw, height: fh });
    T("FECHA:", M, y - fh + 16, { bold: true });
    T(p.fecha || "—", M + 46, y - fh + 16);
  } else {
    page.drawLine({ start: { x: firmaColX, y: y - 44 }, end: { x: width - M, y: y - 44 }, thickness: 0.8, color: ink });
    centerT2("Firma Médico", firmaColX, width - M, y - 56, { size: 10, font, page });
    T("FECHA:", M, y - 44, { bold: true });
    T(p.fecha || "—", M + 46, y - 44);
  }

  // Pie fijo abajo
  const pieBottom = 66;
  const lineY = pieBottom + modelo.pie.length * 13 + 6;
  page.drawLine({ start: { x: M, y: lineY }, end: { x: width - M, y: lineY }, thickness: 1.5, color: navy });
  let py = pieBottom + (modelo.pie.length - 1) * 13;
  for (const line of modelo.pie) { centerT(line, py, { bold: true, size: 9.5, color: navy }); py -= 13; }

  return await doc.save();

  function centerT2(t, x1, x2, yy, o) {
    const w = o.font.widthOfTextAtSize(String(t), o.size);
    o.page.drawText(String(t), { x: x1 + (x2 - x1 - w) / 2, y: yy, size: o.size, font: o.font, color: ink });
  }
}

module.exports = { MODELOS, buildInformePdf, informeFilename };
