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
const PIE_CIMA = ["CIMA - Innovación en Medicina", "Islas Malvinas 2722 - Isidro Casanova"];

// Campos de la caja técnica del Holter. Base = Caballito; CIMA suma 4 más.
const HOLTER_CAMPOS = [
  { key: "duracion", label: "Duración", default: "24 hs" },
  { key: "fcProm", label: "FC promedio", default: "72 lpm" },
  { key: "fcMin", label: "FC mínima", default: "55 lpm" },
  { key: "fcMax", label: "FC máxima", default: "118 lpm" },
  { key: "totalLatidos", label: "Total de latidos", default: "103.000 aprox." },
  { key: "latidosAnormales", label: "Latidos anormales", default: "0" },
  { key: "esv", label: "ESV", default: "0" },
  { key: "ev", label: "EV", default: "0" },
  { key: "pausas", label: "Pausas significativas", default: "0" },
  { key: "stt", label: "ST-T", default: "sin cambios significativos", wide: true },
  { key: "sintomas", label: "Síntomas", default: "no refiere" },
];
const HOLTER_CAMPOS_CIMA = [
  ...HOLTER_CAMPOS,
  { key: "pausaMasLarga", label: "Pausa más larga", default: "0,0 seg" },
  { key: "bradicardia", label: "Bradicardia", default: "0 episodios" },
  { key: "motivo", label: "Motivo", default: "Control" },
  { key: "medicacion", label: "Medicación", default: "—", wide: true },
];
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
  "caballito-holter": {
    label: "Caballito — Holter cardíaco 24 hs",
    short: "Caballito · Holter",
    practica: "Holter cardíaco 24 hs",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "",
    estudio: "Holter cardíaco de 3 canales 24 hs.",
    estudioArchivo: "Holter 24 hs",
    solicitanteDefault: "Dra. Naiara, Jacinto",
    textoDefault: "Ritmo sinusal durante todo el estudio. Conducción AV dentro de límites fisiológicos. No se observaron arritmias supraventriculares ni ventriculares significativas. No se observaron cambios significativos del segmento ST-T. No se observaron pausas significativas. No refirió síntomas durante el estudio. Se analizó registro electrocardiográfico de 24 hs.",
    pie: PIE_CABALLITO,
    // Caja "DATOS TÉCNICOS DEL REGISTRO": valores estándar precargados, todos editables.
    tecnicosTitulo: "DATOS TÉCNICOS DEL REGISTRO",
    campos: HOLTER_CAMPOS,
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
    pie: PIE_CIMA,
  },
  "cima-consulta-570129": {
    label: "CIMA — Consulta cardiología c/ ECG (570129)",
    short: "CIMA · Consulta ECG",
    practica: "Consulta cardiológica c/ ECG — 570129",
    centro: "CIMA",
    logo: "cima_logo.png",
    logoW: 150,
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "570129",
    estudio: "Consulta con especialista en cardiología (incluye ECG)",
    estudioArchivo: "Consulta Cardiologia ECG",
    solicitanteDefault: "Gerardo Savia",
    textoDefault: "Trazado sin valor patológico.",
    pie: PIE_CIMA,
  },
  "cima-holter": {
    label: "CIMA — Holter cardíaco 24 hs",
    short: "CIMA · Holter",
    practica: "Holter cardíaco 24 hs",
    centro: "CIMA",
    logo: "cima_logo.png",
    logoW: 150,
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "",
    estudio: "Holter cardíaco de 3 canales 24 hs.",
    estudioArchivo: "Holter 24 hs",
    solicitanteDefault: "Gerardo Savia",
    textoDefault: "Se realizó Holter de tres canales. Ritmo sinusal permanente. Conducción AV dentro de límites normales. Conducción IV dentro de límites normales. No se detectaron ectópicos. No se detectaron alteraciones inespecíficas de la repolarización ventricular. Sin síntomas.",
    pie: PIE_CIMA,
    tecnicosTitulo: "DATOS TÉCNICOS DEL REGISTRO",
    campos: HOLTER_CAMPOS_CIMA,
  },
  // ===================== ORL / Otorrinolaringología =====================
  // Mismo layout que cardiología (sin caja técnica). Cambia el servicio y, en
  // algunas prácticas, se elige el lado (el texto del preset cambia según el lado).
  "caballito-orl-cerumen": {
    label: "Caballito — Extracción tapón de cerumen / cuerpo extraño (717111)",
    short: "Caballito · Cerumen",
    practica: "717111 - Extracción de tapón de cerumen / cuerpo extraño",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717111",
    estudio: "EXTRACCIÓN DE CUERPO EXTRAÑO EN OÍDO + EXTRACCIÓN DE TAPÓN DE CERUMEN",
    estudioArchivo: "Extraccion tapon cerumen",
    solicitanteDefault: "",
    textoDefault: "SE REALIZA OTOMICROSCOPIA. SE EVIDENCIA TAPÓN DE CERUMEN EN CONDUCTO AUDITIVO EXTERNO, EL CUAL SE EXTRAE EN SU TOTALIDAD. POSTERIOR AL PROCEDIMIENTO SE CONSTATA CONDUCTO AUDITIVO PERMEABLE, CON MEMBRANA TIMPÁNICA NORMOLÚCIDA.",
    pie: PIE_CABALLITO,
    requiereLado: true,
  },
  "caballito-orl-quimico": {
    label: "Caballito — Tratamiento químico ORL (717125)",
    short: "Caballito · Trat. químico",
    practica: "717125 - Tratamiento de lesiones ORL por medios físicos o químicos",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717125",
    estudio: "TRATAMIENTO DE LESIONES OTORRINOLARINGOLÓGICAS POR MEDIOS FÍSICOS O QUÍMICOS",
    estudioArchivo: "Tratamiento quimico ORL",
    solicitanteDefault: "",
    textoDefault: "SE REALIZA TRATAMIENTO QUÍMICO DE LESIÓN ANGIOMATOSA EN REGIÓN ANTERIOR SEPTAL, POR EPÍSTAXIS ANTERIOR RECURRENTE. PROCEDIMIENTO BIEN TOLERADO.",
    pie: PIE_CABALLITO,
  },
  "caballito-orl-combinado": {
    label: "Caballito — Cerumen + Tratamiento químico (717111 + 717125)",
    short: "Caballito · Combinado",
    practica: "717111 + 717125 - Cerumen + Tratamiento químico (combinado)",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717111 + 717125",
    estudio: "EXTRACCIÓN DE CUERPO EXTRAÑO EN OÍDO + EXTRACCIÓN DE TAPÓN DE CERUMEN + TRATAMIENTO DE LESIONES OTORRINOLARINGOLÓGICAS POR MEDIOS FÍSICOS O QUÍMICOS",
    estudioArchivo: "Cerumen y tratamiento quimico",
    solicitanteDefault: "",
    textoDefault: "SE REALIZA OTOMICROSCOPIA. SE EVIDENCIA TAPÓN DE CERUMEN EN CONDUCTO AUDITIVO EXTERNO, EL CUAL SE EXTRAE EN SU TOTALIDAD. POSTERIOR AL PROCEDIMIENTO SE CONSTATA CONDUCTO AUDITIVO PERMEABLE, CON MEMBRANA TIMPÁNICA NORMOLÚCIDA. SE REALIZA ADEMÁS TRATAMIENTO QUÍMICO DE LESIÓN ANGIOMATOSA EN REGIÓN ANTERIOR SEPTAL, POR EPÍSTAXIS ANTERIOR RECURRENTE. PROCEDIMIENTOS BIEN TOLERADOS.",
    pie: PIE_CABALLITO,
    requiereLado: true,
  },
  "caballito-orl-videorino": {
    label: "Caballito — Video rinofibrolaringoscopia (717132)",
    short: "Caballito · Videorino",
    practica: "717132 - Video rinofibrolaringoscopia",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717132",
    estudio: "VIDEO RINOFIBROLARINGOSCOPIA",
    estudioArchivo: "Video rinofibrolaringoscopia",
    solicitanteDefault: "",
    textoDefault: "SE REALIZA VIDEO RINOFIBROLARINGOSCOPIA. SE OBSERVAN FOSAS NASALES PERMEABLES, CAVUM LIBRE, FARINGE Y LARINGE SIN LESIONES EVIDENTES. CUERDAS VOCALES MÓVILES Y SIMÉTRICAS, CON BUENA COAPTACIÓN GLÓTICA. PROCEDIMIENTO BIEN TOLERADO.",
    pie: PIE_CABALLITO,
  },
  "cima-orl-videorino": {
    label: "CIMA — Video rinofibrolaringoscopia (717132)",
    short: "CIMA · Videorino",
    practica: "717132 - Video rinofibrolaringoscopia",
    centro: "CIMA",
    logo: "cima_logo.png",
    logoW: 150,
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717132",
    estudio: "VIDEO RINOFIBROLARINGOSCOPIA",
    estudioArchivo: "Video rinofibrolaringoscopia",
    solicitanteDefault: "",
    textoDefault: "SE REALIZA VIDEO RINOFIBROLARINGOSCOPIA. SE OBSERVAN FOSAS NASALES PERMEABLES, CAVUM LIBRE, FARINGE Y LARINGE SIN LESIONES EVIDENTES. CUERDAS VOCALES MÓVILES Y SIMÉTRICAS, CON BUENA COAPTACIÓN GLÓTICA. PROCEDIMIENTO BIEN TOLERADO.",
    pie: PIE_CIMA,
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
    campos: MODELOS[k].campos || [],
    requiereLado: !!MODELOS[k].requiereLado,
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

  // Caja: Estudio realizado. Los títulos largos (ORL, combinados) envuelven:
  // si entra en una línea va inline; si no, la etiqueta arriba y el título
  // a lo ancho debajo, para que no se corte dentro del recuadro.
  {
    const vx = VALX + 30;
    const rightX = boxX + boxW - PADX;
    const estudio = modelo.estudio || "";
    if (bold.widthOfTextAtSize(estudio, 10.5) <= rightX - vx) {
      const h = 34; drawBox(y, h);
      T("Estudio realizado:", LBLX, y - 22, { bold: true });
      T(estudio, vx, y - 22, { bold: true });
      y -= h + 22;
    } else {
      const lines = wrapText(estudio, bold, 10.5, boxW - 2 * PADX);
      const h = 20 + lines.length * 14 + 8;
      drawBox(y, h);
      T("Estudio realizado:", LBLX, y - 18, { bold: true });
      let iy = y - 34;
      for (const ln of lines) { T(ln, LBLX, iy, { bold: true, size: 10.5 }); iy -= 14; }
      y -= h + 22;
    }
  }

  // Caja: DATOS TÉCNICOS DEL REGISTRO (solo modelos con campos, ej. Holter)
  if (modelo.campos && modelo.campos.length) {
    const valores = (input && input.valores) || {};
    const campos = modelo.campos;
    const cols = 3;
    const rows = Math.ceil(campos.length / cols);
    const rowH = 14, titleH = 20;
    const h = titleH + rows * rowH + 5;
    drawBox(y, h);
    T(modelo.tecnicosTitulo || "DATOS TÉCNICOS", LBLX, y - 16, { bold: true, size: 11 });
    const grid = rgb(0.75, 0.77, 0.8);
    const gridTop = y - titleH;
    const colW = boxW / cols;
    for (let i = 0; i < campos.length; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const cx = boxX + c * colW + 8;
      const cy = gridTop - r * rowH - 11;
      const lbl = campos[i].label + ": ";
      T(lbl, cx, cy, { bold: true, size: 8.5 });
      const lblW = bold.widthOfTextAtSize(lbl, 8.5);
      let val = String((valores[campos[i].key] == null ? "" : valores[campos[i].key])).trim() || campos[i].default || "";
      const maxVW = colW - 12 - lblW;
      if (font.widthOfTextAtSize(val, 8.5) > maxVW) {
        while (val.length > 1 && font.widthOfTextAtSize(val + "…", 8.5) > maxVW) val = val.slice(0, -1);
        val += "…";
      }
      T(val, cx + lblW, cy, { size: 8.5 });
    }
    for (let r = 0; r <= rows; r++) {
      const ly = gridTop - r * rowH;
      page.drawLine({ start: { x: boxX, y: ly }, end: { x: boxX + boxW, y: ly }, thickness: 0.5, color: grid });
    }
    for (let c = 1; c < cols; c++) {
      const lx = boxX + c * colW;
      page.drawLine({ start: { x: lx, y: gridTop }, end: { x: lx, y: gridTop - rows * rowH }, thickness: 0.5, color: grid });
    }
    y -= h + 18;
  }

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
