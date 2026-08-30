"use strict";
// Extracción de texto y datos de paciente de un informe, en Node (Etapa 2 web).
// Formatos: .docx (mammoth), .pdf con texto (pdf-parse), .doc viejo (word-extractor).
// Los escaneados (imágenes / pdf sin texto) van por OCR aparte (Etapa 2b).
const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse"); // v2: clase, no función
const mammoth = require("mammoth");
const WordExtractor = require("word-extractor");
const _wx = new WordExtractor();

const IMG_EXT = new Set([".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"]);

// Devuelve { texto, necesitaOcr } — necesitaOcr=true si es imagen o pdf sin texto.
async function extraerTexto(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".docx") {
      const r = await mammoth.extractRawText({ path: filePath });
      return { texto: (r.value || "").trim(), necesitaOcr: false };
    }
    if (ext === ".doc") {
      const doc = await _wx.extract(filePath);
      return { texto: (doc.getBody() || "").trim(), necesitaOcr: false };
    }
    if (ext === ".pdf") {
      const parser = new PDFParse({ data: fs.readFileSync(filePath) });
      const r = await parser.getText();
      const texto = (r.text || "").trim();
      return { texto, necesitaOcr: texto.length < 15 }; // pdf escaneado -> sin texto
    }
    if (IMG_EXT.has(ext)) return { texto: "", necesitaOcr: true };
  } catch (e) {
    return { texto: "", necesitaOcr: false, error: String((e && e.message) || e) };
  }
  return { texto: "", necesitaOcr: false };
}

const dig = (s) => String(s == null ? "" : s).replace(/\D+/g, "");
const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

// Sigla del estudio (en el nombre del archivo o el texto) -> palabra clave con la
// que aparece en la bandeja, para que el matcher elija la práctica correcta. Solo
// las inequívocas; "doppler"/"ecografía"/"cardio" son ambiguas (varias prácticas)
// y se dejan para revisión a mano.
const _PRACTICA_MAP = [
  [/\bETT\b|ECOCARDIOGRAMA|ECODOPPLER\s+CARDIACO/i, "ECODOPPLER CARDIACO"],
  [/\bMAPA\b|PRESUROMETR|MONITOREO\s+AMBULATORIO\s+DE\s+PRESION|PRESION\s+ARTERIAL\s+24/i, "PRESUROMETRIA"],
  [/\bHOLTER\b/i, "HOLTER"],
  [/ECO\s*VC\b|VASOS\s+DEL?\s+CUELLO/i, "VASOS DEL CUELLO"],
  [/\bESPIRO\w*|SPIROMETR/i, "ESPIROMETRIA"],
  [/\bECG\b|ELECTROCARDIOGRAMA|ELECTRO\s*CARDIO/i, "ELECTROCARDIOGRAMA"],
  [/VENOSO\s+DE\s+(MIEMBROS|MMII)|ECODOPPLER\s+VENOSO/i, "VENOSO DE MIEMBROS INFERIORES"],
  [/ARTERIAL\s+DE\s+(MIEMBROS|MMII)|ECODOPPLER\s+ARTERIAL/i, "ARTERIAL DE MIEMBROS INFERIORES"],
  // Otorrino: un mismo informe suele traer las dos juntas ("OTOMICROSCOPIA +
  // RINOMANOMETRÍA") y son DOS prácticas distintas de la bandeja.
  [/OTOMICROSCOP[IÍ]A/i, "OTOMICROSCOPIA"],
  [/RINOMANOMETR[IÍ]A/i, "RINOMANOMETRIA"],
  [/VIDEO\s*RINOFIBROLARINGOSCOP[IÍ]A|RINOFIBROLARINGOSCOP[IÍ]A/i, "RINOFIBROLARINGOSCOPIA"],
  [/VIDEO\s*ESTROBOSCOP[IÍ]A|ESTROBOSCOP[IÍ]A/i, "VIDEOESTROBOSCOPIA"],
  // "TRATAMIENTO DE LESIONES ORL POR MEDIOS FÍSICOS O QUÍMICOS" (717125). En el
  // informe aparece como "tratamiento químico de lesión" o "cauterización química".
  [/TRATAMIENTOS?\s+(QU[IÍ]MICOS?|F[IÍ]SICOS?)\s+DE\s+LESI[OÓ]N|CAUTERIZACI[OÓ]N\s+QU[IÍ]MICA/i, "TRATAMIENTO DE LESIONES"],
];
// Todas las prácticas nombradas en el informe (un informe puede cubrir varias).
function practicasDe(fuente) {
  const out = [];
  for (const [re, kw] of _PRACTICA_MAP) if (re.test(fuente) && !out.includes(kw)) out.push(kw);
  return out;
}
function practicaDe(fuente) {
  return practicasDe(fuente)[0] || "";
}

// Extrae {dni, beneficio, nombre, nombreKey} del texto + nombre de archivo.
// Porta los patrones que probamos en el motor Python (varios formatos de Caballito).
function extraerDatos(texto, filename) {
  const t = String(texto || "");
  const fn = String(filename || "");
  let dni = "", beneficio = "", nombre = "";

  // Beneficio PAMI (14 díg): "N° Benef: 14013819280900" o "PAMI: 1400..."
  let m = t.match(/N[°º]?\s*Benef\.?\s*:?\s*(?:PAMI\s*)?(\d{10,})/i);
  if (m) beneficio = dig(m[1]);
  if (!beneficio) { m = t.match(/\bPAMI\s*[:\-]?\s*(\d{10,})/i); if (m) beneficio = dig(m[1]); }

  // DNI / Documento
  m = t.match(/\b(?:documento|D\.?N\.?I)\s*:?\s*([\d.]{6,10})/i);
  if (m) dni = dig(m[1]);
  // Espirometría: número antes de "ID" en el texto ("11178682ID")
  if (!dni) { m = t.match(/\b(\d{7,9})\s*ID\b/); if (m) dni = dig(m[1]); }
  // Espirometría: benef/dni en el nombre del archivo ("11178682~Ramundo~...")
  if (!dni) { m = fn.match(/^(\d{6,})~/); if (m) dni = dig(m[1]); }
  // HOLTER: etiquetas y valores pegados en filas distintas -> DNI suelto si hay "Documento"
  if (!dni && /(?:documento|d\.?n\.?i)/i.test(t)) {
    m = t.match(/(?<!\d)(\d{7,8})(?!\d)/);
    if (m) dni = dig(m[1]);
  }

  // Nombre — cardio "NOMBRE: X EDAD"
  m = t.match(/NOMBRE\s*:\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]{2,}?)\s+EDAD/i);
  if (m) nombre = m[1];
  // espirometría en texto: "Apellidos Ramundo Nombre Daniel"
  if (!nombre) { m = t.match(/Apellidos?\s+([A-Za-zÁÉÍÓÚÑñ]+)\s+Nombre\s+([A-Za-zÁÉÍÓÚÑñ]+)/i); if (m) nombre = m[1] + " " + m[2]; }
  // "Paciente: X" / "Nombre: X" acotado (se corta antes de Edad/Sexo/Fecha/Documento)
  if (!nombre) { m = t.match(/(?:Paciente|Nombre)\s*:\s*([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑñ, ]{3,}?)(?=\s{2,}|\s*\||\s+(?:Edad|Sexo|Fecha|Documento|Tipo|N[°º]|DNI)|\s*$)/im); if (m) nombre = m[1]; }
  if (/^(NOMBRE|FECHA|PACIENTE|EDAD|SEXO|DOCUMENTO|HOMBRE|MUJER|MASCULINO|FEMENINO|VAR[OÓ]N)\b/i.test(nombre.trim())) nombre = "";
  // fallback: el nombre del archivo (Caballito nombra los archivos por paciente)
  if (!nombre.trim()) {
    let base = path.basename(fn, path.extname(fn));
    const sp = base.match(/^\d+~([^~]+)~([^~]*)~/); // espirometría "benef~Apellido~Inicial~..."
    if (sp) {
      base = `${sp[1]} ${sp[2]}`;
    } else {
      base = base
        .replace(/^\d+[_\-\s]+/, "")   // prefijo numérico (ej. "04JUN_01_")
        .replace(/[_]+/g, " ")          // guiones bajos -> espacios (nombre en varias partes)
        .replace(/\s*-\s*.*$/, "")      // corta en " - <estudio>" (ej. "RODRIGUEZ LUIS - MAPA")
        // corta cuando arranca el tipo de estudio o una fecha/número (ej. "... HOLTER 10 08 2025")
        .replace(/\s+(HOLTER|MAPA|ETT|ECG|ECO|DOPPLER|ESPIRO\w*|RMN|TAC|RX|LAB|ID\d+|N?\d).*$/i, "");
    }
    nombre = base;
  }
  nombre = nombre.replace(/\b(PAMI|RENAL|VESICAL|HOLTER|ETT|ECO|VC)\b/gi, "").replace(/[,;]+/g, " ").replace(/\s+/g, " ").trim();

  // Práctica / estudio (pista para elegir la OME cuando el paciente tiene varias).
  // 1º la sigla del estudio mapeada a la palabra con que figura en la bandeja
  // (ETT→ECODOPPLER CARDIACO, MAPA→PRESUROMETRIA, HOLTER); si no, el texto libre.
  // Un informe puede cubrir VARIAS prácticas (otorrino: otomicroscopía +
  // rinomanometría). Guardamos todas: el matcher busca una OME para cada una.
  // Se busca en TODO el texto, no solo en el encabezado: el "Estudio realizado" a
  // veces enumera cuatro prácticas y el cuerpo ("SE REALIZA TRATAMIENTO QUÍMICO
  // DE LESIÓN...") nombra las que faltan. Con una ventana de 400 caracteres se
  // perdían las últimas — el caso ARAOZ tenía el tratamiento en la posición 647.
  const practicas = practicasDe((fn + " " + t).replace(/_/g, " "));
  let practica = practicas[0] || "";
  if (!practica) {
    m = t.match(/(?:Estudio|Pr[áa]ctica|Prestaci[óo]n|Informe de)\s*:?\s*([^\n\r]{4,200})/i);
    if (m) practica = m[1].replace(/\s+/g, " ").trim();
  }

  return { dni, beneficio, nombre, nombreKey: norm(nombre), practica, practicas };
}

// Procesa un informe de punta a punta: lee el texto (o lo saca por OCR si está
// escaneado) y devuelve {dni, beneficio, nombre, nombreKey, necesitaOcr, ocrUsado, texto}.
// El módulo de OCR se carga en diferido para no exigir sus libs si no hace falta.
async function procesar(filePath, nombreArchivo) {
  let { texto, necesitaOcr, error } = await extraerTexto(filePath);
  let ocrUsado = false;
  if (necesitaOcr && !error) {
    try {
      const ocr = require("./ocr");
      texto = await ocr.ocrArchivo(filePath);
      ocrUsado = true;
    } catch (e) {
      error = "OCR: " + String((e && e.message) || e);
    }
  }
  // El nombre del archivo GUARDADO es un id (id.pdf); para el fallback de nombre y
  // los patrones que miran el filename hay que usar el ORIGINAL (ej. "RODRIGUEZ LUIS - MAPA.pdf").
  const datos = extraerDatos(texto || "", nombreArchivo || filePath);
  return { ...datos, necesitaOcr, ocrUsado, error: error || null, texto: texto || "" };
}

module.exports = { extraerTexto, extraerDatos, procesar, practicasDe };
