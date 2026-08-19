// Avisos por Telegram. El token vive SOLO en la variable de entorno
// TELEGRAM_BOT_TOKEN (Railway) — nunca en el repo ni en disco. El chat_id (a quién
// le escribe el bot) se guarda en el volumen.
"use strict";

function token() {
  return String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
}
function hayToken() {
  return token().length > 0;
}

async function api(metodo, params) {
  const t = token();
  if (!t) throw new Error("Falta TELEGRAM_BOT_TOKEN en el entorno.");
  const url = `https://api.telegram.org/bot${t}/${metodo}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params || {}),
    signal: AbortSignal.timeout(20000),
  });
  const j = await resp.json().catch(() => ({}));
  if (!j || !j.ok) throw new Error((j && j.description) || `Telegram HTTP ${resp.status}`);
  return j.result;
}

// Datos del bot (para confirmar que el token es válido).
async function getMe() {
  return api("getMe", {});
}

// Últimos mensajes que recibió el bot — sirve para detectar el chat_id de quien
// le escribió /start. Devuelve la lista de chats distintos vistos.
async function chatsRecientes() {
  const updates = await api("getUpdates", { limit: 50, timeout: 0 });
  const vistos = new Map();
  for (const u of updates || []) {
    const msg = u.message || u.edited_message || u.channel_post;
    const chat = msg && msg.chat;
    if (!chat || vistos.has(chat.id)) continue;
    vistos.set(chat.id, {
      id: chat.id,
      tipo: chat.type,
      nombre: [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.title || "",
      usuario: chat.username || "",
    });
  }
  return [...vistos.values()];
}

async function enviar(chatId, texto) {
  return api("sendMessage", { chat_id: chatId, text: texto, parse_mode: "HTML", disable_web_page_preview: true });
}

module.exports = { hayToken, getMe, chatsRecientes, enviar };
