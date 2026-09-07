"use strict";
// Bot de Telegram para generar OMEs. Token en la variable de entorno
// TELEGRAM_OME_BOT_TOKEN (Railway) — nunca en el repo ni en disco. Es un bot
// SEPARADO del de avisos (telegram.js), por eso tiene su propio token.

function token() {
  return String(process.env.TELEGRAM_OME_BOT_TOKEN || "").trim();
}
function hayToken() { return token().length > 0; }

async function api(metodo, params) {
  const t = token();
  if (!t) throw new Error("Falta TELEGRAM_OME_BOT_TOKEN en el entorno.");
  const resp = await fetch(`https://api.telegram.org/bot${t}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params || {}),
    signal: AbortSignal.timeout(20000),
  });
  const j = await resp.json().catch(() => ({}));
  if (!j || !j.ok) throw new Error((j && j.description) || `Telegram HTTP ${resp.status}`);
  return j.result;
}

function getMe() { return api("getMe", {}); }

// Envía texto. `botones` opcional: matriz de filas de { text, data } -> inline_keyboard.
async function enviar(chatId, texto, botones) {
  const params = { chat_id: chatId, text: texto, parse_mode: "HTML", disable_web_page_preview: true };
  if (botones) params.reply_markup = { inline_keyboard: botones.map((fila) => fila.map((b) => ({ text: b.text, callback_data: b.data }))) };
  return api("sendMessage", params);
}
// Edita el texto de un mensaje ya enviado (para sacar los botones tras confirmar).
async function editar(chatId, messageId, texto) {
  return api("editMessageText", { chat_id: chatId, message_id: messageId, text: texto, parse_mode: "HTML", disable_web_page_preview: true });
}
async function responderCallback(callbackId, texto) {
  return api("answerCallbackQuery", { callback_query_id: callbackId, text: texto || "" });
}
// Registra el webhook (una sola vez). secret viaja en un header y lo verificamos.
async function setWebhook(url, secret) {
  return api("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
}

module.exports = { hayToken, getMe, enviar, editar, responderCallback, setWebhook };
