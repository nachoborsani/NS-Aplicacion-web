"use strict";
// Export del nomenclador del cliente (la vista resumida, ya filtrada por sus
// módulos activos) a Excel o PDF, limpio para mandarle al cliente.
const XLSX = require("xlsx");

function cleanType(v) { const t = String(v || "").trim(); return (!t || t === "0") ? "-" : t; }
function scopeLabel(s) { return s === "internacion" ? "Internación" : s === "ambulatorio" ? "Ambulatorio" : "Otros"; }
function money(n) { return "$ " + (Number(n) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Agrupa las filas por módulo, ordenadas por código de módulo.
function agrupar(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const code = String(r.moduleCode || r.moduleDescription || "-");
    if (!map.has(code)) map.set(code, { code: r.moduleCode || "-", name: r.moduleDescription || "", rows: [] });
    map.get(code).rows.push(r);
  }
  return [...map.values()].sort((a, b) => {
    const na = Number(a.code), nb = Number(b.code);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a.code).localeCompare(String(b.code));
  });
}

function buildXlsx(client, label, rows) {
  const aoa = [
    ["Nomenclador de prácticas - " + (client.name || "")],
    ["Período: " + label],
    ["Módulos activos: " + (client.activeModules || []).length],
    [],
    ["Módulo", "Módulo (detalle)", "Código", "Prestación", "Tipo", "Ámbito", "Honorarios", "Gastos", "Total", "Autorización"],
  ];
  for (const g of agrupar(rows)) {
    for (const r of g.rows) {
      aoa.push([
        r.moduleCode || "", r.moduleDescription || "",
        r.practiceCode || "", r.practiceDescription || "",
        cleanType(r.type), scopeLabel(r.scope),
        Number(r.honorarios) || 0, Number(r.gastos) || 0, Number(r.total) || 0,
        r.authLevel || "",
      ]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 9 }, { wch: 26 }, { wch: 10 }, { wch: 48 }, { wch: 16 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Nomenclador");
  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
}

async function buildPdf(client, label, rows) {
  const { PDFDocument, StandardFonts, rgb } = require("./vendor/pdf-lib.min.js");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PW = 841.89, PH = 595.28, M = 40;
  const ink = rgb(0.13, 0.13, 0.13), soft = rgb(0.42, 0.42, 0.42), lineC = rgb(0.82, 0.84, 0.87);
  const band = rgb(0.92, 0.95, 0.97), headBg = rgb(0.07, 0.16, 0.28), headTx = rgb(1, 1, 1);
  const cols = [
    { k: "code", t: "Código", x: M, w: 52, al: "l" },
    { k: "desc", t: "Prestación", x: M + 52, w: 360, al: "l" },
    { k: "type", t: "Tipo", x: M + 412, w: 80, al: "l" },
    { k: "scope", t: "Ámbito", x: M + 492, w: 78, al: "l" },
    { k: "total", t: "Total", x: M + 570, w: 95, al: "r" },
    { k: "auth", t: "Autoriz.", x: M + 665, w: 96, al: "l" },
  ];
  const bottom = 46;
  let page, y;
  const T = (t, x, yy, o) => { o = o || {}; page.drawText(String(t == null ? "" : t), { x, y: yy, size: o.size || 8.5, font: o.bold ? bold : font, color: o.color || ink }); };
  const fit = (text, f, size, w) => {
    text = String(text == null ? "" : text);
    if (f.widthOfTextAtSize(text, size) <= w) return text;
    let t = text;
    while (t.length > 1 && f.widthOfTextAtSize(t + "…", size) > w) t = t.slice(0, -1);
    return t + "…";
  };
  const cellText = (col, value, yy, o) => {
    o = o || {}; const size = o.size || 8.5, f = o.bold ? bold : font;
    const txt = fit(value, f, size, col.w - 6);
    let x = col.x + 3;
    if (col.al === "r") x = col.x + col.w - 3 - f.widthOfTextAtSize(txt, size);
    T(txt, x, yy, o);
  };
  const drawHeader = () => {
    page.drawRectangle({ x: M, y: y - 17, width: PW - 2 * M, height: 17, color: headBg });
    for (const c of cols) cellText(c, c.t, y - 12, { bold: true, size: 8.5, color: headTx });
    y -= 17;
  };
  const newPage = (first) => {
    page = doc.addPage([PW, PH]);
    y = PH - M;
    if (first) {
      T("Nomenclador de prácticas", M, y - 14, { bold: true, size: 15 });
      T(client.name || "", M, y - 32, { bold: true, size: 11, color: soft });
      T("Período: " + label, PW - M - font.widthOfTextAtSize("Período: " + label, 10), y - 14, { size: 10, color: soft });
      y -= 46;
    }
    drawHeader();
  };
  const ensure = (h) => { if (y - h < bottom) newPage(false); };

  newPage(true);
  const grupos = agrupar(rows);
  if (!grupos.length) {
    T("Este cliente no tiene prácticas en el nomenclador para sus módulos activos.", M, y - 20, { color: soft });
  }
  for (const g of grupos) {
    ensure(20 + 15);
    // banda del módulo
    page.drawRectangle({ x: M, y: y - 16, width: PW - 2 * M, height: 16, color: band });
    T("Módulo " + (g.code || "-") + (g.name ? " · " + g.name : ""), M + 4, y - 11.5, { bold: true, size: 9 });
    y -= 16;
    for (const r of g.rows) {
      ensure(14);
      cellText(cols[0], r.practiceCode || "-", y - 10);
      cellText(cols[1], r.practiceDescription || "", y - 10);
      cellText(cols[2], cleanType(r.type), y - 10);
      cellText(cols[3], scopeLabel(r.scope), y - 10);
      cellText(cols[4], money(r.total), y - 10);
      cellText(cols[5], r.authLevel || "-", y - 10);
      page.drawLine({ start: { x: M, y: y - 14 }, end: { x: PW - M, y: y - 14 }, thickness: 0.4, color: lineC });
      y -= 14;
    }
  }
  // Números de página
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    const txt = (i + 1) + " / " + pages.length;
    pg.drawText(txt, { x: PW - M - font.widthOfTextAtSize(txt, 8), y: 26, size: 8, font, color: soft });
    pg.drawText("N&S Salud · gestion.nssalud@gmail.com", { x: M, y: 26, size: 8, font, color: soft });
  }
  return await doc.save();
}

module.exports = { buildXlsx, buildPdf };
