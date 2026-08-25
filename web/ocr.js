"use strict";
// OCR de informes escaneados (imágenes / PDF sin texto). Full-npm, sin binarios de sistema.
// Render de PDF: mupdf (WASM autocontenido — no comparte estado con el pdfjs de pdf-parse).
// OCR: tesseract.js (español). El wasm del core y el idioma se sirven locales (node_modules /
// carpeta ocr_data), NO de internet, para que en Railway no dependa de una descarga en runtime.
const fs = require("fs");
const path = require("path");

const LANG_DIR = path.join(__dirname, "ocr_data"); // spa.traineddata.gz bundleado

let _mupdf = null;
async function mupdf() {
  if (!_mupdf) _mupdf = await import("mupdf"); // ESM con top-level await -> import()
  return _mupdf;
}

let _worker = null;
async function worker() {
  if (!_worker) {
    const { createWorker } = require("tesseract.js");
    // corePath local -> no baja el wasm de un CDN en runtime (deploy-safe en Railway).
    const opts = { corePath: path.dirname(require.resolve("tesseract.js-core/package.json")) };
    if (fs.existsSync(path.join(LANG_DIR, "spa.traineddata")) ||
        fs.existsSync(path.join(LANG_DIR, "spa.traineddata.gz"))) {
      opts.langPath = LANG_DIR; // idioma bundleado -> tampoco baja de internet
      opts.gzip = fs.existsSync(path.join(LANG_DIR, "spa.traineddata.gz"));
      opts.cachePath = LANG_DIR;
    }
    _worker = await createWorker("spa", 1, opts);
  }
  return _worker;
}

// Renderiza las primeras páginas de un PDF a PNG (buffers).
async function pdfAImagenes(filePath, { scale = 2.0, maxPag = 3 } = {}) {
  const m = await mupdf();
  const doc = m.Document.openDocument(new Uint8Array(fs.readFileSync(filePath)), "application/pdf");
  const n = Math.min(doc.countPages(), maxPag);
  const out = [];
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    const pix = page.toPixmap(m.Matrix.scale(scale, scale), m.ColorSpace.DeviceRGB, false, true);
    out.push(Buffer.from(pix.asPNG()));
    if (pix.destroy) pix.destroy();
    if (page.destroy) page.destroy();
  }
  if (doc.destroy) doc.destroy();
  return out;
}

async function ocrBuffer(pngBuffer) {
  const w = await worker();
  const { data } = await w.recognize(pngBuffer);
  return (data.text || "").trim();
}

// OCR de un archivo escaneado -> texto de sus páginas concatenado.
async function ocrArchivo(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const imgs = ext === ".pdf" ? await pdfAImagenes(filePath) : [fs.readFileSync(filePath)];
  let texto = "";
  for (const img of imgs) texto += (await ocrBuffer(img)) + "\n";
  return texto.trim();
}

async function cerrar() {
  if (_worker) { await _worker.terminate(); _worker = null; }
}

module.exports = { ocrArchivo, pdfAImagenes, ocrBuffer, cerrar };
