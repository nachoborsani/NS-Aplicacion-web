"use strict";
// Export de la comparativa mes vs mes (Dashboard de reportes) a XLSX (con
// fórmulas, para que el cliente pueda editar y proyectar) y a PDF (para presentar).
const XLSX = require("xlsx");

// ---- Agregación: arma la estructura de comparación desde los datos del dashboard.
function agregar(data) {
  const cur = data.current || {}, prev = data.compare || {};
  const general = [
    { label: "Cantidad de prestaciones", a: Number(cur.totalRows || 0), b: Number(prev.totalRows || 0), money: false },
    { label: "Consultas", a: Number(cur.consultations || 0), b: Number(prev.consultations || 0), money: false },
    { label: "Prácticas / estudios", a: Number(cur.practices || 0), b: Number(prev.practices || 0), money: false },
    { label: "Importe total (neto)", a: Number(cur.net || 0), b: Number(prev.net || 0), money: true },
    { label: "Débitos", a: Number(cur.debit || 0), b: Number(prev.debit || 0), money: true },
    { label: "Falta informe", a: Number(cur.missingInformeAmount || 0), b: Number(prev.missingInformeAmount || 0), money: true },
    { label: "Próximo período por corte", a: Number(cur.nextPeriodCutoff || 0), b: Number(prev.nextPeriodCutoff || 0), money: true },
    { label: "Valor promedio por prestación", a: Number(cur.averageNet || 0), b: Number(prev.averageNet || 0), money: true },
  ];
  // Por especialidad (módulo)
  const modMap = new Map();
  const addMod = (m, key) => {
    if (!m) return;
    const code = String(m.moduleCode || "-");
    if (!modMap.has(code)) modMap.set(code, { code, desc: m.moduleDescription || "", a: null, b: null });
    const e = modMap.get(code);
    e[key] = m;
    if (!e.desc) e.desc = m.moduleDescription || "";
  };
  (cur.modules || []).forEach((m) => addMod(m, "a"));
  (prev.modules || []).forEach((m) => addMod(m, "b"));
  const especialidades = [...modMap.values()].map((e) => ({
    code: e.code, desc: e.desc,
    consA: Number((e.a && e.a.consultations) || 0), consB: Number((e.b && e.b.consultations) || 0),
    pracA: Number((e.a && e.a.practices) || 0), pracB: Number((e.b && e.b.practices) || 0),
    netA: Number((e.a && e.a.net) || 0), netB: Number((e.b && e.b.net) || 0),
  })).sort((x, y) => y.netA - x.netA);
  // Por código
  const codMap = new Map();
  const addCod = (modules, key) => {
    (modules || []).forEach((m) => (m.rows || []).forEach((r) => {
      const code = String(r.practiceCode || "-");
      if (!codMap.has(code)) codMap.set(code, { code, desc: r.practiceDescription || "", cntA: 0, cntB: 0, netA: 0, netB: 0, mod: m.moduleCode || "" });
      const e = codMap.get(code);
      if (!e.desc) e.desc = r.practiceDescription || "";
      e[key === "a" ? "cntA" : "cntB"] += 1;
      e[key === "a" ? "netA" : "netB"] += Number(r.net || 0);
    }));
  };
  addCod(cur.modules, "a");
  addCod(prev.modules, "b");
  const codigos = [...codMap.values()].sort((x, y) => (y.cntA + y.cntB) - (x.cntA + x.cntB) || y.netA - x.netA);
  return {
    labelA: cur.label || cur.period || "Actual",
    labelB: prev.label || prev.period || "Anterior",
    general, especialidades, codigos,
  };
}

// ---- XLSX con fórmulas ----
const MONEY = '#,##0.00';
const PCT = '0.0%';
function col(c) { return XLSX.utils.encode_col(c); }
function setF(ws, r, c, formula, cached, fmt) {
  const ref = XLSX.utils.encode_cell({ r, c });
  const cell = { t: "n", f: formula };
  if (cached !== undefined && cached !== null && isFinite(cached)) cell.v = cached;
  if (fmt) cell.z = fmt;
  ws[ref] = cell;
  return ref;
}
function fmtCells(ws, rows, cols, fmt) {
  rows.forEach((r) => cols.forEach((c) => {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (ws[ref]) ws[ref].z = fmt;
  }));
}
function buildXlsx(client, data) {
  const d = agregar(data);
  const wb = XLSX.utils.book_new();
  const A = d.labelA, B = d.labelB;

  // Hoja Resumen: Indicador | A | B | Δ (=B-C) | Δ% (=IFERROR(D/C,""))
  const resAoa = [
    ["Comparativa — " + (client.name || "")],
    [A + " vs " + B],
    [],
    ["Indicador", A, B, "Δ", "Δ %"],
  ];
  const resStart = resAoa.length;
  d.general.forEach((g) => resAoa.push([g.label, g.a, g.b, "", ""]));
  const wsR = XLSX.utils.aoa_to_sheet(resAoa);
  d.general.forEach((g, i) => {
    const r = resStart + i;
    setF(wsR, r, 3, col(1) + (r + 1) + "-" + col(2) + (r + 1), g.a - g.b, g.money ? MONEY : "0");
    setF(wsR, r, 4, 'IFERROR((' + col(1) + (r + 1) + "-" + col(2) + (r + 1) + ")/" + col(2) + (r + 1) + ',"")', g.b ? (g.a - g.b) / g.b : null, PCT);
    if (g.money) fmtCells(wsR, [r], [1, 2], MONEY);
  });
  wsR["!cols"] = [{ wch: 32 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsR, "Resumen");

  // Hoja Por especialidad
  const espAoa = [["Por especialidad — " + A + " vs " + B], [],
    ["Especialidad", "Consultas " + A, "Consultas " + B, "Δ", "Prácticas " + A, "Prácticas " + B, "Δ", "Neto " + A, "Neto " + B, "Δ Neto", "Δ % Neto"]];
  const espStart = espAoa.length;
  d.especialidades.forEach((e) => espAoa.push([e.code + " " + e.desc, e.consA, e.consB, "", e.pracA, e.pracB, "", e.netA, e.netB, "", ""]));
  const wsE = XLSX.utils.aoa_to_sheet(espAoa);
  d.especialidades.forEach((e, i) => {
    const r = espStart + i, n = r + 1;
    setF(wsE, r, 3, col(1) + n + "-" + col(2) + n, e.consA - e.consB, "0");
    setF(wsE, r, 6, col(4) + n + "-" + col(5) + n, e.pracA - e.pracB, "0");
    setF(wsE, r, 9, col(7) + n + "-" + col(8) + n, e.netA - e.netB, MONEY);
    setF(wsE, r, 10, 'IFERROR((' + col(7) + n + "-" + col(8) + n + ")/" + col(8) + n + ',"")', e.netB ? (e.netA - e.netB) / e.netB : null, PCT);
    fmtCells(wsE, [r], [7, 8], MONEY);
  });
  // Fila TOTAL con SUM (para que recalcule si editan)
  if (d.especialidades.length) {
    const first = espStart + 1, last = espStart + d.especialidades.length, tr = espStart + d.especialidades.length;
    const sumRow = ["TOTAL", "", "", "", "", "", "", "", "", "", ""];
    XLSX.utils.sheet_add_aoa(wsE, [sumRow], { origin: { r: tr, c: 0 } });
    [[1], [2], [4], [5], [7], [8]].forEach(([c]) => setF(wsE, tr, c, "SUM(" + col(c) + first + ":" + col(c) + last + ")", null, c >= 7 ? MONEY : "0"));
    setF(wsE, tr, 3, col(1) + (tr + 1) + "-" + col(2) + (tr + 1), null, "0");
    setF(wsE, tr, 6, col(4) + (tr + 1) + "-" + col(5) + (tr + 1), null, "0");
    setF(wsE, tr, 9, col(7) + (tr + 1) + "-" + col(8) + (tr + 1), null, MONEY);
    setF(wsE, tr, 10, 'IFERROR((' + col(7) + (tr + 1) + "-" + col(8) + (tr + 1) + ")/" + col(8) + (tr + 1) + ',"")', null, PCT);
  }
  wsE["!cols"] = [{ wch: 30 }].concat(Array(10).fill({ wch: 13 }));
  XLSX.utils.book_append_sheet(wb, wsE, "Por especialidad");

  // Hoja Por código
  const codAoa = [["Por código — " + A + " vs " + B], [],
    ["Código", "Prestación", "Cant " + A, "Cant " + B, "Δ", "Neto " + A, "Neto " + B, "Δ Neto", "Δ %"]];
  const codStart = codAoa.length;
  d.codigos.forEach((c) => codAoa.push([c.code, c.desc, c.cntA, c.cntB, "", c.netA, c.netB, "", ""]));
  const wsC = XLSX.utils.aoa_to_sheet(codAoa);
  d.codigos.forEach((c, i) => {
    const r = codStart + i, n = r + 1;
    setF(wsC, r, 4, col(2) + n + "-" + col(3) + n, c.cntA - c.cntB, "0");
    setF(wsC, r, 7, col(5) + n + "-" + col(6) + n, c.netA - c.netB, MONEY);
    setF(wsC, r, 8, 'IFERROR((' + col(5) + n + "-" + col(6) + n + ")/" + col(6) + n + ',"")', c.netB ? (c.netA - c.netB) / c.netB : null, PCT);
    fmtCells(wsC, [r], [5, 6], MONEY);
  });
  wsC["!cols"] = [{ wch: 10 }, { wch: 42 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 9 }];
  XLSX.utils.book_append_sheet(wb, wsC, "Por código");

  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
}

// ---- PDF ----
function money(n) { return "$ " + (Number(n) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct(a, b) { return b ? (((a - b) / Math.abs(b)) * 100).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%" : "-"; }
function signo(n) { return n > 0 ? "+" : ""; }
async function buildPdf(client, data) {
  const d = agregar(data);
  const { PDFDocument, StandardFonts, rgb } = require("./vendor/pdf-lib.min.js");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const PW = 595.28, PH = 841.89, M = 40;
  const ink = rgb(0.13, 0.13, 0.13), soft = rgb(0.42, 0.42, 0.42), head = rgb(0.07, 0.16, 0.28), line = rgb(0.82, 0.84, 0.87), band = rgb(0.93, 0.95, 0.97);
  let page, y;
  const T = (t, x, yy, o) => { o = o || {}; page.drawText(String(t == null ? "" : t), { x, y: yy, size: o.size || 8.5, font: o.bold ? bold : font, color: o.color || ink }); };
  const fit = (t, f, s, w) => { t = String(t == null ? "" : t); if (f.widthOfTextAtSize(t, s) <= w) return t; while (t.length > 1 && f.widthOfTextAtSize(t + "…", s) > w) t = t.slice(0, -1); return t + "…"; };
  const newPage = () => { page = doc.addPage([PW, PH]); y = PH - M; };
  const ensure = (h) => { if (y - h < 46) newPage(); };
  const rowCells = (cells, yy, o) => {
    o = o || {};
    cells.forEach((c) => {
      const size = o.size || 8.5, f = o.bold ? bold : font, w = c.w - 6;
      const txt = fit(c.t, f, size, w);
      let x = c.x + 3;
      if (c.al === "r") x = c.x + c.w - 3 - f.widthOfTextAtSize(txt, size);
      T(txt, x, yy, { size, bold: o.bold, color: o.color });
    });
  };
  const tabla = (titulo, cols, filas) => {
    ensure(40);
    T(titulo, M, y - 12, { bold: true, size: 11 }); y -= 24;
    ensure(16);
    page.drawRectangle({ x: M, y: y - 15, width: PW - 2 * M, height: 15, color: head });
    rowCells(cols.map((c) => ({ t: c.t, x: c.x, w: c.w, al: c.al })), y - 11, { bold: true, size: 8, color: rgb(1, 1, 1) });
    y -= 15;
    filas.forEach((f, i) => {
      ensure(14);
      if (f._band) page.drawRectangle({ x: M, y: y - 14, width: PW - 2 * M, height: 14, color: band });
      rowCells(f.cells, y - 10, { bold: !!f._bold });
      page.drawLine({ start: { x: M, y: y - 14 }, end: { x: PW - M, y: y - 14 }, thickness: 0.4, color: line });
      y -= 14;
    });
    y -= 14;
  };

  newPage();
  T("Comparativa de reportes", M, y - 15, { bold: true, size: 16 }); y -= 20;
  T(client.name || "", M, y - 13, { bold: true, size: 11, color: soft }); y -= 15;
  T(d.labelA + "  vs  " + d.labelB, M, y - 12, { size: 10, color: soft }); y -= 30;

  // Resumen general
  const c0 = M, w0 = 180, w1 = 88, w2 = 88, w3 = 159;
  tabla("Resumen general", [
    { t: "Indicador", x: c0, w: w0 }, { t: d.labelA, x: c0 + w0, w: w1, al: "r" }, { t: d.labelB, x: c0 + w0 + w1, w: w2, al: "r" }, { t: "Variación", x: c0 + w0 + w1 + w2, w: w3, al: "r" },
  ], d.general.map((g) => ({
    cells: [
      { t: g.label, x: c0, w: w0 },
      { t: g.money ? money(g.a) : g.a, x: c0 + w0, w: w1, al: "r" },
      { t: g.money ? money(g.b) : g.b, x: c0 + w0 + w1, w: w2, al: "r" },
      { t: signo(g.a - g.b) + (g.money ? money(g.a - g.b) : (g.a - g.b)) + " (" + pct(g.a, g.b) + ")", x: c0 + w0 + w1 + w2, w: w3, al: "r" },
    ],
  })));

  // Por especialidad
  const e = [M, M + 150, M + 210, M + 270, M + 330, M + 400, M + 475];
  tabla("Por especialidad", [
    { t: "Especialidad", x: e[0], w: 150 }, { t: "Cons.", x: e[1], w: 60, al: "r" }, { t: "Var.", x: e[2], w: 60, al: "r" }, { t: "Prác.", x: e[3], w: 60, al: "r" }, { t: "Var.", x: e[4], w: 70, al: "r" }, { t: "Neto", x: e[5], w: 75, al: "r" }, { t: "Var.", x: e[6], w: 40, al: "r" },
  ], d.especialidades.map((s) => ({
    cells: [
      { t: s.code + " " + s.desc, x: e[0], w: 150 },
      { t: s.consA, x: e[1], w: 60, al: "r" }, { t: signo(s.consA - s.consB) + (s.consA - s.consB), x: e[2], w: 60, al: "r" },
      { t: s.pracA, x: e[3], w: 60, al: "r" }, { t: signo(s.pracA - s.pracB) + (s.pracA - s.pracB), x: e[4], w: 70, al: "r" },
      { t: money(s.netA), x: e[5], w: 75, al: "r" }, { t: pct(s.netA, s.netB), x: e[6], w: 40, al: "r" },
    ],
  })));

  // Por código
  const k = [M, M + 46, M + 300, M + 360, M + 470];
  tabla("Por código", [
    { t: "Código", x: k[0], w: 46 }, { t: "Prestación", x: k[1], w: 254 }, { t: "Cant.", x: k[2], w: 60, al: "r" }, { t: "Neto", x: k[3], w: 110, al: "r" }, { t: "Var.", x: k[4], w: 45, al: "r" },
  ], d.codigos.map((c) => ({
    cells: [
      { t: c.code, x: k[0], w: 46 }, { t: c.desc, x: k[1], w: 254 },
      { t: c.cntA + " (" + signo(c.cntA - c.cntB) + (c.cntA - c.cntB) + ")", x: k[2], w: 60, al: "r" },
      { t: money(c.netA), x: k[3], w: 110, al: "r" }, { t: pct(c.netA, c.netB), x: k[4], w: 45, al: "r" },
    ],
  })));

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const t = (i + 1) + " / " + pages.length;
    pages[i].drawText(t, { x: PW - M - font.widthOfTextAtSize(t, 8), y: 26, size: 8, font, color: soft });
    pages[i].drawText("N&S Salud · gestion.nssalud@gmail.com", { x: M, y: 26, size: 8, font, color: soft });
  }
  return await doc.save();
}

module.exports = { buildXlsx, buildPdf };
