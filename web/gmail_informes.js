"use strict";
// Descarga de informes desde el mail (informesnssalud@gmail.com) en Node.
// Porta la lógica de desktop-app/gmail_informes.py: busca mails con adjuntos en un
// rango de fechas y baja los PDF/Word/imagen. Usa el refresh_token ya autorizado.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TIPOS_ACEPTADOS = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg", "image/png", "image/bmp", "image/tiff",
]);

// Busca el token en: variable de entorno, volumen de datos, o el repo (desktop-app).
// Devuelve el objeto del token o null si no hay.
function cargarToken(dataDir) {
  const env = process.env.GMAIL_INFORMES_TOKEN;
  if (env) { try { return JSON.parse(env); } catch { /* sigue */ } }
  const candidatos = [
    dataDir && path.join(dataDir, "token_gmail_informes.json"),
    path.join(__dirname, "..", "desktop-app", "token_gmail_informes.json"),
  ].filter(Boolean);
  for (const c of candidatos) {
    try { if (fs.existsSync(c)) return JSON.parse(fs.readFileSync(c, "utf8")); } catch { /* sigue */ }
  }
  return null;
}

function clienteGmail(token) {
  const { google } = require("googleapis");
  const o = new google.auth.OAuth2(token.client_id, token.client_secret);
  o.setCredentials({ refresh_token: token.refresh_token });
  return google.gmail({ version: "v1", auth: o });
}

// Mail de la casilla conectada (para mostrar en la UI).
async function emailConectado(token) {
  const gmail = clienteGmail(token);
  const r = await gmail.users.getProfile({ userId: "me" });
  return (r.data && r.data.emailAddress) || "";
}

function* iterarPartes(payload) {
  for (const part of (payload && payload.parts) || []) {
    yield part;
    yield* iterarPartes(part);
  }
}

// Baja los adjuntos aceptados en [desde, hasta) (formato YYYY/MM/DD, before exclusivo).
// Saltea lo que ya está en la cabina. `filtros` es:
//   yaPorNombre(filename, size) -> true  (barato: NO baja el adjunto)
//   yaPorHash(sha256)           -> true  (seguro: ya lo bajó, compara contenido)
//
// Son dos pasadas a propósito. Comparar solo por NOMBRE pierde archivos:
// dos adjuntos distintos que se llaman igual ("informe.pdf", de dos
// pacientes) hacían que el segundo no entrara nunca, y eso no se nota —
// no aparece un duplicado, falta un informe. Comparar solo por CONTENIDO
// obliga a bajar todos los adjuntos del rango en cada corrida.
//
// Entonces: el nombre corta gratis cuando ADEMÁS coincide el tamaño (el
// caso normal, volver a pedir un mes ya traído), y el hash decide en el
// resto. Un mismo archivo reenviado con otro nombre tampoco entra dos
// veces, que antes sí pasaba.
//
// Devuelve [{ filename, buffer, hash, fecha, asunto }].
async function descargarAdjuntos(token, desde, hasta, filtros) {
  const yaPorNombre = (filtros && filtros.yaPorNombre) || (() => false);
  const yaPorHash = (filtros && filtros.yaPorHash) || (() => false);
  const gmail = clienteGmail(token);
  const q = `has:attachment after:${desde} before:${hasta}`;
  // Listar todos los mensajes del rango (paginado).
  const ids = [];
  let pageToken = undefined;
  do {
    const r = await gmail.users.messages.list({ userId: "me", q, maxResults: 500, pageToken });
    for (const m of (r.data.messages || [])) ids.push(m.id);
    pageToken = r.data.nextPageToken;
  } while (pageToken);

  const bajados = [];
  const vistos = new Set();
  for (const id of ids) {
    let msg;
    try { msg = await gmail.users.messages.get({ userId: "me", id, format: "full" }); }
    catch { continue; }
    // Fecha del mail (YYYY-MM-DD) para poder filtrar los informes por período.
    let fecha = "";
    try { const d = new Date(Number(msg.data.internalDate)); if (!isNaN(d)) fecha = d.toISOString().slice(0, 10); } catch { /* sin fecha */ }
    // Asunto del mail (para mostrarlo como columna en la cabina).
    let asunto = "";
    try {
      const hs = (msg.data.payload && msg.data.payload.headers) || [];
      const h = hs.find((x) => String(x.name || "").toLowerCase() === "subject");
      asunto = h ? String(h.value || "").trim().slice(0, 300) : "";
    } catch { /* sin asunto */ }
    for (const part of iterarPartes(msg.data.payload || {})) {
      const filename = String(part.filename || "").trim();
      if (!filename || !TIPOS_ACEPTADOS.has(part.mimeType)) continue;
      const safe = path.basename(filename);
      const tam = Number((part.body && part.body.size) || 0);
      // Corte barato: mismo nombre Y mismo tamaño es, con toda
      // probabilidad, el mismo archivo. Se salta sin bajarlo.
      if (yaPorNombre(safe, tam)) continue;
      let data = part.body && part.body.data;
      const attId = part.body && part.body.attachmentId;
      if (attId && !data) {
        try {
          const a = await gmail.users.messages.attachments.get({ userId: "me", messageId: id, id: attId });
          data = a.data && a.data.data;
        } catch { continue; }
      }
      if (!data) continue;
      const buffer = Buffer.from(data, "base64");
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      // Ahora sí, por contenido: cubre el mismo archivo con otro nombre
      // y el mismo mail reenviado.
      if (vistos.has(hash)) continue;   // repetido dentro de esta corrida
      if (yaPorHash(hash)) continue;    // ya está en la cabina
      vistos.add(hash);
      bajados.push({ filename: safe, buffer, hash, fecha, asunto });
    }
  }
  return bajados;
}

module.exports = { cargarToken, emailConectado, descargarAdjuntos, TIPOS_ACEPTADOS };
