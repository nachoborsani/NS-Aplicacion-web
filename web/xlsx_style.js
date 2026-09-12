"use strict";
// Estilo compartido para TODOS los Excel que exporta la web: mismo look que
// el Reporte de cliente (encabezado navy con texto blanco, título grande
// navy, subtítulo gris itálica, bordes finos). Antes cada export tenía su
// propio nivel de terminación (algunos con color y bordes, otros texto
// plano sin ancho de columna) - esto es para que todos salgan iguales.
//
// OJO: estos estilos solo sobreviven si el workbook se escribe con
// `xlsx-js-style` (`require("xlsx-js-style")`), no con `xlsx` a secas -
// la librería base ignora `cell.s` al escribir.

const NAVY = "1F4E5F";
const BORDER_COLOR = "D9DEE1";
const MUTED = "667079";
const MONEY_FMT = '"$"#,##0.00';

const BORDER_THIN = { style: "thin", color: { rgb: BORDER_COLOR } };
const CELL_BORDER = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: NAVY } },
  alignment: { vertical: "center" },
  border: CELL_BORDER,
};
const TITLE_STYLE = { font: { bold: true, sz: 16, color: { rgb: NAVY } } };
const SUBTITLE_STYLE = { font: { italic: true, color: { rgb: MUTED } } };

function styleCell(ws, ref, s) {
  if (ws[ref]) ws[ref].s = Object.assign({}, ws[ref].s, s);
}
function styleTitle(ws, ref) { styleCell(ws, ref, TITLE_STYLE); }
function styleSubtitle(ws, ref) { styleCell(ws, ref, SUBTITLE_STYLE); }

// Pinta de navy/blanco/negrita toda una fila de encabezados (rowIdx es
// 0-based, igual que XS.utils.encode_cell).
function styleHeaderRow(XS, ws, rowIdx, ncols, extra) {
  for (let c = 0; c < ncols; c += 1) {
    styleCell(ws, XS.utils.encode_cell({ r: rowIdx, c }), extra ? Object.assign({}, HEADER_STYLE, extra) : HEADER_STYLE);
  }
}

// Dos filas de título + fila en blanco + encabezado, todo mergeado a lo
// ancho de la tabla - el mismo patrón que ya usaba buildCruzasListaSheet.
// Devuelve el índice (0-based) de la fila de encabezados, para que quien
// llama pueda seguir agregando filas de datos después.
function tituloYEncabezado(XS, ws, ncols, headerRowIdx) {
  const lastCol = XS.utils.encode_col(ncols - 1);
  ws["!merges"] = (ws["!merges"] || []).concat([
    XS.utils.decode_range(`A1:${lastCol}1`),
    XS.utils.decode_range(`A2:${lastCol}2`),
  ]);
  styleTitle(ws, "A1");
  styleSubtitle(ws, "A2");
  styleHeaderRow(XS, ws, headerRowIdx, ncols);
}

// Formatea como moneda las celdas numéricas de una columna, filas
// [rowStart, rowEnd) (0-based, ambas puntas del rango de datos, sin
// encabezado).
function styleMoneyColumn(XS, ws, col, rowStart, rowEnd, extra) {
  for (let r = rowStart; r < rowEnd; r += 1) {
    const ref = XS.utils.encode_cell({ r, c: col });
    if (ws[ref] && typeof ws[ref].v === "number") {
      ws[ref].z = MONEY_FMT;
      styleCell(ws, ref, Object.assign({ numFmt: MONEY_FMT, alignment: { horizontal: "right" } }, extra));
    }
  }
}

module.exports = {
  NAVY, BORDER_COLOR, MUTED, MONEY_FMT, CELL_BORDER, HEADER_STYLE, TITLE_STYLE, SUBTITLE_STYLE,
  styleCell, styleTitle, styleSubtitle, styleHeaderRow, tituloYEncabezado, styleMoneyColumn,
};
