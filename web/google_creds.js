"use strict";
// Integración de Google (Sheets + Drive) para la web, reusando el OAuth de la
// cuenta gestion.nssalud (la misma que usa la app). El token (refresh_token +
// client id/secret) se guarda ENCRIPTADO en el volumen; acá solo se usa para
// autenticar. Sirve para el flujo de "credencial provisoria" de Scheffelaar:
// leer la planilla, subir los PDF a Drive y marcar la planilla.
const { google } = require("googleapis");
const { Readable } = require("stream");

// cfg = { client_id, client_secret, refresh_token }
function makeAuth(cfg) {
  const o = new google.auth.OAuth2(cfg.client_id, cfg.client_secret);
  o.setCredentials({ refresh_token: cfg.refresh_token });
  return o;
}

async function connectedEmail(auth) {
  const oauth2 = google.oauth2({ version: "v2", auth });
  const r = await oauth2.userinfo.get();
  return (r.data && r.data.email) || "";
}

// Índice 0-based de una letra de columna ("A"→0, "I"→8). Soporta AA, AB…
function colToIndex(letter) {
  let n = 0;
  for (const ch of String(letter || "").toUpperCase()) {
    if (ch < "A" || ch > "Z") continue;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}
function indexToCol(idx) {
  let s = "", n = idx + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s || "A";
}

async function getSheetMeta(auth, spreadsheetId) {
  const sheets = google.sheets({ version: "v4", auth });
  const r = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties(title),sheets(properties(title))" });
  return {
    title: (r.data.properties && r.data.properties.title) || "",
    tabs: (r.data.sheets || []).map((s) => s.properties && s.properties.title).filter(Boolean),
  };
}

async function readValues(auth, spreadsheetId, tab, range) {
  const sheets = google.sheets({ version: "v4", auth });
  const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'!${range}` });
  return r.data.values || [];
}

// Escribe un valor en una celda (A1). USER_ENTERED para que interprete fórmulas
// (=HYPERLINK(...)) como la app de escritorio.
async function writeCell(auth, spreadsheetId, tab, a1, value) {
  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `'${tab}'!${a1}`,
    valueInputOption: "USER_ENTERED", requestBody: { values: [[value]] },
  });
}

// Sube un PDF a una carpeta. Si ya existe uno con ese nombre, lo reemplaza.
async function uploadPdf(auth, folderId, filename, buffer) {
  const drive = google.drive({ version: "v3", auth });
  const safe = String(filename).replace(/'/g, "\\'");
  const q = `name = '${safe}' and '${folderId}' in parents and trashed = false`;
  const found = await drive.files.list({
    q, fields: "files(id,name)", spaces: "drive",
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  const media = { mimeType: "application/pdf", body: Readable.from(buffer) };
  let file;
  if (found.data.files && found.data.files.length) {
    file = await drive.files.update({
      fileId: found.data.files[0].id, media,
      fields: "id,name,webViewLink", supportsAllDrives: true,
    });
  } else {
    file = await drive.files.create({
      requestBody: { name: filename, parents: [folderId] }, media,
      fields: "id,name,webViewLink", supportsAllDrives: true,
    });
  }
  return file.data; // { id, name, webViewLink }
}

// Verifica que la carpeta exista y sea accesible.
async function getFolder(auth, folderId) {
  const drive = google.drive({ version: "v3", auth });
  const r = await drive.files.get({ fileId: folderId, fields: "id,name,mimeType,driveId", supportsAllDrives: true });
  return r.data;
}

module.exports = {
  makeAuth, connectedEmail, colToIndex, indexToCol,
  getSheetMeta, readValues, writeCell, uploadPdf, getFolder,
};
