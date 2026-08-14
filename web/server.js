const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const XLSX = require("xlsx");

const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "public");

// Persistencia: usa el volumen de Railway si esta montado; si no, ./data local.
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");
const usersFile = path.join(dataDir, "users.json");
const clientesFile = path.join(dataDir, "clientes.json");
const legacyNomencladorFile = path.join(dataDir, "nomenclador.json");
const nomencladoresFile = path.join(dataDir, "nomencladores.json");
const clientReportsFile = path.join(dataDir, "client_reports.json");

// Secreto para firmar la cookie de sesion. Si no viene por env, se guarda uno
// en el volumen y se reutiliza: asi las sesiones (y el "Recordarme") sobreviven
// a los redeploys en vez de invalidarse en cada uno.
function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(dataDir, "session_secret");
  try { return fs.readFileSync(f, "utf8").trim(); } catch {}
  const s = crypto.randomBytes(32).toString("hex");
  try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(f, s); } catch {}
  return s;
}
const SESSION_SECRET = getSessionSecret();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
};

// ---------- Passwords (scrypt, sin dependencias) ----------
function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(test, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Store de usuarios ----------
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(usersFile, "utf8"));
  } catch {
    return null;
  }
}
function saveUsers(users) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}
function seedUsers() {
  let users = loadUsers();
  if (!Array.isArray(users) || users.length === 0) {
    users = [
      { username: "nacho", name: "Ignacio Borsani", role: "admin", password: hashPassword("123456"), mustChange: true, active: true },
      { username: "seba", name: "Sebastian", role: "admin", password: hashPassword("123456"), mustChange: true, active: true },
    ];
    saveUsers(users);
    console.log("Usuarios semilla creados: nacho, seba (clave 123456, deben cambiarla)");
  }
  return users;
}
seedUsers();

// ---------- Envio de mails (Gmail via nodemailer) ----------
// Se configura con dos variables de entorno en Railway:
//   GMAIL_USER          -> la casilla (ej. blanqueos@gaussbio.com o una @gmail.com de NS)
//   GMAIL_APP_PASSWORD  -> "contraseña de aplicacion" de Google (16 letras, sin espacios)
// Sin esas variables el sistema sigue funcionando, pero no manda el mail de blanqueo.
let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch { console.log("[mail] nodemailer no instalado"); }
let _transport = null;
function mailConfigured() {
  return !!(nodemailer && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}
function getTransport() {
  if (!mailConfigured()) return null;
  if (!_transport) {
    _transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return _transport;
}
async function sendResetEmail(to, name, link) {
  const t = getTransport();
  if (!t) { console.log("[mail] sin configurar; no envio blanqueo a", to); return false; }
  const saludo = name ? `Hola ${name},` : "Hola,";
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;color:#1D2939">
      <div style="background:#0B1F3A;color:#fff;padding:20px;border-radius:12px 12px 0 0;text-align:center">
        <div style="font-size:22px;font-weight:800;letter-spacing:1px">NS</div>
        <div style="font-size:11px;letter-spacing:2px;color:#9fb3c8">GESTIÓN INTEGRAL EN SALUD</div>
      </div>
      <div style="border:1px solid #D9E1E8;border-top:0;border-radius:0 0 12px 12px;padding:24px">
        <p>${saludo}</p>
        <p>Recibimos un pedido para restablecer la contraseña de tu cuenta. Tocá el botón para elegir una clave nueva:</p>
        <p style="text-align:center;margin:26px 0">
          <a href="${link}" style="background:#18B7B2;color:#04302f;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px;display:inline-block">Elegir nueva contraseña</a>
        </p>
        <p style="font-size:12.5px;color:#667085">El enlace vence en 1 hora. Si no pediste esto, ignorá este mail: tu contraseña no cambia.</p>
        <p style="font-size:11.5px;color:#98a2b3;word-break:break-all">Si el botón no funciona, copiá este enlace:<br>${link}</p>
      </div>
    </div>`;
  const text = `${saludo}\n\nPara restablecer tu contraseña entrá a:\n${link}\n\nEl enlace vence en 1 hora. Si no lo pediste, ignorá este mail.`;
  await t.sendMail({
    from: `NS · Gestión Integral en Salud <${process.env.GMAIL_USER}>`,
    to,
    subject: "Restablecer tu contraseña — NS",
    text,
    html,
  });
  console.log("[mail] blanqueo enviado a", to);
  return true;
}
function validEmail(e) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}

// ---------- Sesion (cookie firmada HMAC) ----------
function sign(value) {
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  return `${value}.${sig}`;
}
function unsign(signed) {
  if (!signed) return null;
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const sig = signed.slice(i + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}
function getSessionUser(req) {
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)ns_session=([^;]+)/);
  if (!m) return null;
  const username = unsign(decodeURIComponent(m[1]));
  if (!username) return null;
  const users = loadUsers() || [];
  return users.find((u) => u.username === username && u.active) || null;
}
function setSessionCookie(res, username, remember) {
  const val = encodeURIComponent(sign(username));
  let cookie = `ns_session=${val}; HttpOnly; Path=/; SameSite=Lax`;
  // Con "Recordarme": cookie persistente 30 dias. Sin el tilde: cookie de
  // sesion (se borra al cerrar el navegador).
  if (remember) cookie += `; Max-Age=${60 * 60 * 24 * 30}`;
  res.setHeader("Set-Cookie", cookie);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "ns_session=; HttpOnly; Path=/; Max-Age=0");
}

// ---------- Helpers ----------
function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => {
      d += c;
      if (d.length > 10e6) req.destroy();
    });
    req.on("end", () => {
      try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); }
    });
  });
}
function publicUser(u) {
  return { username: u.username, name: u.name, role: u.role, mustChange: !!u.mustChange };
}

// Perfiles validos y reglas de nombre de usuario
const ROLES = new Set(["admin", "operador", "medico", "clinica"]);
const DEFAULT_CLIENTS = [
  {
    slug: "sala-millon",
    name: "Sala Millon",
    businessName: "SALA DE AUXILIO DE LOMAS DEL MILLON",
    cuit: "30545942123",
    activeModules: [
      { code: "546", name: "TRAUMATOLOGIA" },
      { code: "437", name: "OTORRINOLARINGOLOGIA" },
      { code: "432", name: "PEDIATRIA" },
      { code: "543", name: "CARDIOLOGIA" },
      { code: "557", name: "NUTRICION" },
      { code: "545", name: "UROLOGIA" },
    ],
  },
];
function normalizeClientModules(modules) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(modules) ? modules : []) {
    const rawCode = typeof item === "object" ? item.code : item;
    const rawName = typeof item === "object" ? item.name : "";
    const code = String(rawCode || "").trim();
    const name = String(rawName || "").replace(/\s+/g, " ").trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    result.push({ code, name });
  }
  return result;
}
function normalizeClient(client, fallback) {
  const base = fallback || {};
  const modules = normalizeClientModules(client.activeModules);
  return {
    slug: String(client.slug || base.slug || "").trim(),
    name: String(client.name || base.name || "").trim(),
    businessName: String(client.businessName || base.businessName || "").trim(),
    cuit: String(client.cuit || base.cuit || "").trim(),
    activeModules: modules.length ? modules : normalizeClientModules(base.activeModules),
  };
}
function loadClientsStore() {
  let saved = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(clientesFile, "utf8"));
    saved = Array.isArray(parsed) ? parsed : [];
  } catch {}

  const bySlug = new Map();
  for (const client of DEFAULT_CLIENTS) bySlug.set(client.slug, normalizeClient(client));
  for (const client of saved) {
    const slug = String(client.slug || "").trim();
    if (!slug) continue;
    bySlug.set(slug, normalizeClient(client, bySlug.get(slug)));
  }
  return Array.from(bySlug.values()).filter((client) => client.slug && client.name);
}
function saveClientsStore(clients) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(clientesFile, JSON.stringify(clients.map((client) => normalizeClient(client)), null, 2));
}
function createClientReportsStore() {
  return { items: [] };
}
function loadClientReportsStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(clientReportsFile, "utf8"));
    if (parsed && Array.isArray(parsed.items)) return parsed;
    if (Array.isArray(parsed)) return { items: parsed };
  } catch {}
  return createClientReportsStore();
}
function saveClientReportsStore(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(clientReportsFile, JSON.stringify({ items: store.items || [] }, null, 2));
}
function validUsername(u) {
  return /^[a-z0-9._-]{3,20}$/.test(u);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const clean = String(value || "").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}
function money(value) {
  return Math.round(toNumber(value) * 100) / 100;
}
function clampMoney(value, min, max) {
  const n = money(value);
  return Math.max(min, Math.min(max, n));
}
function formatExcelDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleDateString("es-AR");
  }
  if (typeof value === "number" && value > 25000 && value < 70000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${String(parsed.d).padStart(2, "0")}/${String(parsed.m).padStart(2, "0")}/${parsed.y}`;
    }
  }
  return String(value).trim();
}
function inferScope(moduleDescription, type, practiceDescription) {
  const text = normalizeText(`${moduleDescription} ${type} ${practiceDescription}`);
  if (text.includes("INTERNACION") || text.includes("SANATORIAL")) return "internacion";
  if (text.includes("AMBULATOR") || text.includes("CONSULTA") || text.includes("DOMICILI")) return "ambulatorio";
  return "otros";
}
function displayScope(scope) {
  return { ambulatorio: "Ambulatorio", internacion: "Internacion", otros: "Otros" }[scope] || scope;
}
function cleanIdentifier(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return String(value || "").replace(/\.0$/, "").trim();
}
function getRowValue(row, aliases) {
  for (const [key, value] of Object.entries(row || {})) {
    const normalized = normalizeText(key);
    if (aliases.some((alias) => normalized === alias || normalized.includes(alias))) return value;
  }
  return "";
}
function parseDateTime(value, options = {}) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && value > 25000 && value < 70000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const hour = parsed.H || 0;
      const minute = parsed.M || 0;
      const second = Math.floor(parsed.S || 0);
      if (options.preferDayMonth && parsed.d >= 1 && parsed.d <= 12) {
        const swapped = new Date(parsed.y, parsed.d - 1, parsed.m, hour, minute, second);
        if (swapped.getMonth() === parsed.d - 1 && swapped.getDate() === parsed.m) return swapped;
      }
      return new Date(parsed.y, parsed.m - 1, parsed.d, hour, minute, second);
    }
  }
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s*(?:-|,)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const month = Number(match[2]);
  const day = Number(match[1]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  const date = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(date.getTime()) ? null : date;
}
function isoDateTime(date) {
  if (!date) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function displayDateTime(date) {
  if (!date) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = date.getHours() || date.getMinutes() ? ` ${pad(date.getHours())}:${pad(date.getMinutes())}` : "";
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}${hhmm}`;
}
function prestationPeriod(date) {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function cutoffForPrestacion(date) {
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth() + 1, 15, 23, 59, 59);
}
function normalizePeriod(value) {
  const raw = String(value || "").trim();
  let match = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (match) {
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return `${match[1]}-${String(month).padStart(2, "0")}`;
  }
  match = raw.match(/^(\d{1,2})[/-](\d{4})$/);
  if (match) {
    const month = Number(match[1]);
    if (month >= 1 && month <= 12) return `${match[2]}-${String(month).padStart(2, "0")}`;
  }
  match = raw.match(/^(\d{4})(\d{2})$/);
  if (match) {
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return `${match[1]}-${match[2]}`;
  }
  return "";
}
function inferPeriodFromText(...values) {
  const text = values.map((v) => String(v || "")).join(" ");
  let match = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (match) return normalizePeriod(`${match[2]}/${match[3]}`);
  match = text.match(/(20\d{2})[-_ ]?(\d{2})/);
  if (match) return normalizePeriod(`${match[1]}-${match[2]}`);
  match = text.match(/(\d{2})[-_ ](20\d{2})/);
  if (match) return normalizePeriod(`${match[1]}/${match[2]}`);
  const months = {
    enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
    julio: "07", agosto: "08", septiembre: "09", setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
  };
  const normalized = normalizeText(text).toLowerCase();
  for (const [name, month] of Object.entries(months)) {
    if (normalized.includes(name)) {
      const year = normalized.match(/20\d{2}/);
      if (year) return `${year[0]}-${month}`;
    }
  }
  return "";
}
function periodLabel(period) {
  const normalized = normalizePeriod(period);
  if (!normalized) return "Sin periodo";
  const [year, month] = normalized.split("-");
  const labels = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  return `${labels[Number(month)] || month} ${year}`;
}
function getHeaderIndexMap(headerRow) {
  const map = {};
  headerRow.forEach((header, index) => {
    const h = normalizeText(header);
    if (h.includes("CODIGO DE MODULO")) map.moduleCode = index;
    else if (h.includes("DESCRIPCION DE MODULO")) map.moduleDescription = index;
    else if (h.includes("CODIGO DE PRACTICA")) map.practiceCode = index;
    else if (h.includes("DESCRIPCION DE PRACTICA")) map.practiceDescription = index;
    else if (h.includes("INICIO DE VIGENCIA")) map.effectiveDate = index;
    else if (h.includes("HONORARIOS")) map.honorarios = index;
    else if (h.includes("GASTOS")) map.gastos = index;
    else if (h === "TIPO" || h.includes(" TIPO")) map.type = index;
    else if (h.includes("NIVEL DE AUTORIZACION")) map.authLevel = index;
    else if (h.includes("OBSERVACIONES")) map.observations = index;
    else if (h.includes("TOTAL EN")) map.total = index;
  });
  return map;
}
function createNomencladorStore() {
  return { activePeriod: "", items: {} };
}
function loadNomencladorStore() {
  try {
    const store = JSON.parse(fs.readFileSync(nomencladoresFile, "utf8"));
    if (store && store.items && typeof store.items === "object") return store;
  } catch {}

  try {
    const legacy = JSON.parse(fs.readFileSync(legacyNomencladorFile, "utf8"));
    if (legacy && Array.isArray(legacy.rows)) {
      const period = normalizePeriod(legacy.period) || inferPeriodFromText(legacy.vigencia, legacy.filename, legacy.uploadedAt) || "legacy";
      legacy.period = period;
      legacy.label = legacy.label || periodLabel(period);
      return { activePeriod: period, items: { [period]: legacy } };
    }
  } catch {}

  return createNomencladorStore();
}
function saveNomencladorStore(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(nomencladoresFile, JSON.stringify(store, null, 2));
}
function getNomencladorByPeriod(store, period) {
  const selected = normalizePeriod(period) || String(period || "").trim();
  if (selected && store.items[selected]) return store.items[selected];
  if (store.activePeriod && store.items[store.activePeriod]) return store.items[store.activePeriod];
  const first = Object.keys(store.items).sort().reverse()[0];
  return first ? store.items[first] : null;
}
function listNomencladores(store) {
  return Object.values(store.items || {})
    .map((item) => ({
      value: item.period,
      label: item.label || periodLabel(item.period),
      filename: item.filename,
      rowCount: item.rowCount,
      uploadedAt: item.uploadedAt,
      vigencia: item.vigencia,
    }))
    .sort((a, b) => String(b.value).localeCompare(String(a.value)));
}
function buildNomencladorFilters(rows) {
  const moduleMap = new Map();
  const typeMap = new Map();
  const scopeMap = new Map();
  for (const row of rows) {
    if (row.moduleCode || row.moduleDescription) {
      const key = String(row.moduleCode || row.moduleDescription);
      if (!moduleMap.has(key)) moduleMap.set(key, { value: key, label: `${row.moduleCode || "-"} - ${row.moduleDescription || "Sin descripcion"}` });
    }
    if (row.type) typeMap.set(row.type, { value: row.type, label: row.type });
    if (row.scope) scopeMap.set(row.scope, { value: row.scope, label: displayScope(row.scope) });
  }
  return {
    modules: Array.from(moduleMap.values()).sort((a, b) => Number(a.value) - Number(b.value) || a.label.localeCompare(b.label)),
    types: Array.from(typeMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
    scopes: Array.from(scopeMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
  };
}
function parseNomencladorWorkbook(buffer, filename, periodInput) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = wb.SheetNames.find((name) => normalizeText(name).includes("NOMENCLADOR")) || wb.SheetNames[0];
  if (!sheetName) throw new Error("El Excel no tiene hojas.");
  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  const headerRowIndex = matrix.findIndex((row) => {
    const text = normalizeText(row.join(" "));
    return text.includes("CODIGO DE MODULO") && text.includes("DESCRIPCION DE PRACTICA");
  });
  if (headerRowIndex < 0) throw new Error("No pude encontrar encabezados de nomenclador en el Excel.");
  const headerMap = getHeaderIndexMap(matrix[headerRowIndex]);
  if (headerMap.practiceCode === undefined || headerMap.practiceDescription === undefined) {
    throw new Error("Faltan columnas de practica/prestacion.");
  }

  const vigencia = matrix.slice(0, headerRowIndex).flat().map((v) => String(v || "").trim()).find((v) => normalizeText(v).includes("VIGENTE")) || "";
  const rows = [];
  for (let i = headerRowIndex + 1; i < matrix.length; i += 1) {
    const source = matrix[i] || [];
    const practiceCode = String(source[headerMap.practiceCode] || "").trim();
    const practiceDescription = String(source[headerMap.practiceDescription] || "").replace(/\s+/g, " ").trim();
    if (!practiceCode && !practiceDescription) continue;

    const moduleCode = String(source[headerMap.moduleCode] || "").trim();
    const moduleDescription = String(source[headerMap.moduleDescription] || "").replace(/\s+/g, " ").trim();
    const type = String(source[headerMap.type] || "").replace(/\s+/g, " ").trim();
    const honorarios = money(source[headerMap.honorarios]);
    const gastos = money(source[headerMap.gastos]);
    const total = headerMap.total !== undefined ? money(source[headerMap.total]) : money(honorarios + gastos);
    const scope = inferScope(moduleDescription, type, practiceDescription);

    rows.push({
      moduleCode,
      moduleDescription,
      practiceCode,
      practiceDescription,
      effectiveDate: formatExcelDate(source[headerMap.effectiveDate]),
      honorarios,
      gastos,
      total,
      type,
      authLevel: String(source[headerMap.authLevel] || "").replace(/\s+/g, " ").trim(),
      observations: String(source[headerMap.observations] || "").replace(/\s+/g, " ").trim(),
      scope,
      search: normalizeText(`${moduleCode} ${moduleDescription} ${practiceCode} ${practiceDescription} ${type}`),
    });
  }

  const period = normalizePeriod(periodInput) || inferPeriodFromText(vigencia, filename);
  if (!period) throw new Error("Indica el mes del nomenclador antes de cargarlo.");

  const payload = {
    period,
    label: periodLabel(period),
    filename,
    sheetName,
    vigencia,
    uploadedAt: new Date().toISOString(),
    rowCount: rows.length,
    columns: {
      moduleCode: "CODIGO DE MODULO",
      moduleDescription: "DESCRIPCION DE MODULO",
      practiceCode: "CODIGO DE PRACTICA",
      practiceDescription: "DESCRIPCION DE PRACTICA",
      effectiveDate: "INICIO DE VIGENCIA",
      honorarios: "HONORARIOS",
      gastos: "GASTOS",
      total: headerMap.total !== undefined ? "TOTAL EN $" : "HONORARIOS + GASTOS",
      type: "TIPO",
      authLevel: "NIVEL DE AUTORIZACION",
      observations: "OBSERVACIONES",
    },
    filters: buildNomencladorFilters(rows),
    rows,
  };
  return payload;
}
function nomencladorSummary(store, payload) {
  const items = listNomencladores(store);
  if (!payload) return { loaded: false, activePeriod: store.activePeriod || "", nomencladores: items };
  return {
    loaded: true,
    activePeriod: payload.period,
    label: payload.label || periodLabel(payload.period),
    nomencladores: items,
    filename: payload.filename,
    sheetName: payload.sheetName,
    vigencia: payload.vigencia,
    uploadedAt: payload.uploadedAt,
    rowCount: payload.rowCount,
    columns: payload.columns,
    filters: payload.filters,
  };
}
function splitPractice(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const match = text.match(/^(\d+)\s*-\s*(.+)$/);
  return {
    code: match ? match[1] : "",
    description: match ? match[2].trim() : text,
    text,
  };
}
const clientPracticeValueAliases = {
  "sala-millon": {
    "820113": "570129",
  },
};
function findNomencladorMatch(payload, client, practice) {
  const activeModules = new Set((client.activeModules || []).map((module) => String(module.code)));
  const aliasCode = ((clientPracticeValueAliases[client.slug] || {})[practice.code]) || "";
  let valueSourceCode = practice.code;
  let candidates = (payload.rows || []).filter((row) => String(row.practiceCode || "") === practice.code);
  if (!candidates.length && aliasCode) {
    valueSourceCode = aliasCode;
    candidates = (payload.rows || []).filter((row) => String(row.practiceCode || "") === aliasCode);
  }
  const activeCandidates = candidates.filter((row) => !activeModules.size || activeModules.has(String(row.moduleCode || "")));
  if (activeCandidates.length) candidates = activeCandidates;
  if (!candidates.length) return null;
  const wanted = normalizeText(practice.description);
  const match = candidates.find((row) => normalizeText(row.practiceDescription) === wanted)
    || candidates.find((row) => normalizeText(row.practiceDescription).includes(wanted) || wanted.includes(normalizeText(row.practiceDescription)))
    || candidates[0];
  return { ...match, valueSourceCode };
}
function parseTransmisionWorkbook(buffer, filename, payload, client) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("El archivo no tiene hojas.");
  const ws = wb.Sheets[sheetName];
  const sourceRows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
  if (!sourceRows.length) throw new Error("El archivo no tiene filas para procesar.");

  const rows = sourceRows.map((source, index) => {
    const practice = splitPractice(getRowValue(source, ["PRACTICA"]));
    const appointmentAt = parseDateTime(getRowValue(source, ["TURNO"]));
    const transmittedAt = parseDateTime(getRowValue(source, ["F TRANSMITIDA"]), { preferDayMonth: true });
    const validatedAt = parseDateTime(getRowValue(source, ["F VALIDACION"]), { preferDayMonth: true });
    const transmitted = normalizeText(getRowValue(source, ["TRASMITIDA"])) === "S";
    const validated = normalizeText(getRowValue(source, ["VALIDADA"])) === "S";
    const cutoff = cutoffForPrestacion(appointmentAt);
    const outsideCutoff = !!(validated && transmitted && transmittedAt && cutoff && transmittedAt > cutoff);
    const match = practice.code ? findNomencladorMatch(payload, client, practice) : null;
    const valueGross = match ? Number(match.total || 0) : 0;
    const facturable = validated && transmitted;
    const billable = facturable && !outsideCutoff;
    const absent = !validated;
    let status = "Pendiente";
    if (absent) status = "Ausente/activa";
    else if (!transmitted) status = "Validada sin transmitir";
    else if (outsideCutoff) status = "Fuera de corte";
    else status = "Facturable";
    return {
      id: `${cleanIdentifier(getRowValue(source, ["NRO. ORDEN", "NRO ORDEN"])) || index + 1}-${index}`,
      order: cleanIdentifier(getRowValue(source, ["NRO. ORDEN", "NRO ORDEN"])),
      benefit: cleanIdentifier(getRowValue(source, ["NRO. BENEFICIO", "NRO BENEFICIO", "BENEFICIO"])),
      patientName: String(getRowValue(source, ["APELLIDO Y NOMBRE", "NOMBRE"]) || "").trim(),
      practiceText: practice.text,
      practiceCode: practice.code,
      practiceDescription: practice.description,
      appointmentAt: isoDateTime(appointmentAt),
      appointmentLabel: displayDateTime(appointmentAt),
      transmitted,
      transmittedAt: isoDateTime(transmittedAt),
      transmittedLabel: displayDateTime(transmittedAt),
      validated,
      validatedAt: isoDateTime(validatedAt),
      validatedLabel: displayDateTime(validatedAt),
      period: prestationPeriod(appointmentAt),
      cutoffLabel: displayDateTime(cutoff),
      outsideCutoff,
      facturable,
      billable,
      absent,
      status,
      valueGross,
      valueBillable: billable ? valueGross : 0,
      moduleCode: match ? match.moduleCode : "",
      moduleDescription: match ? match.moduleDescription : "",
      valueSourceCode: match ? match.valueSourceCode : "",
      matchFound: !!match,
    };
  }).filter((row) => row.order || row.practiceText || row.patientName);

  const summary = rows.reduce((acc, row) => {
    acc.totalRows += 1;
    if (row.validated) acc.validated += 1;
    if (row.transmitted) acc.transmitted += 1;
    if (row.facturable) acc.facturable += 1;
    if (row.billable) acc.billable += 1;
    if (row.absent) acc.absent += 1;
    if (row.outsideCutoff) acc.outsideCutoff += 1;
    if (!row.matchFound) acc.unmatched += 1;
    acc.gross += row.valueGross;
    acc.billableGross += row.valueBillable;
    return acc;
  }, { totalRows: 0, validated: 0, transmitted: 0, facturable: 0, billable: 0, absent: 0, outsideCutoff: 0, unmatched: 0, gross: 0, billableGross: 0 });

  return {
    filename,
    sheetName,
    nomencladorPeriod: payload.period,
    nomencladorLabel: payload.label || periodLabel(payload.period),
    rowCount: rows.length,
    summary,
    rows,
  };
}
function reportRowGross(row) {
  return row && row.billable ? money(row.valueGross) : 0;
}
function reportRowDebit(row) {
  const gross = reportRowGross(row);
  if (!row || !row.manualDebit || gross <= 0) return 0;
  if (row.debitType === "pay40") return money(gross - (gross * 0.4));
  if (row.debitType === "pay60") return money(gross - (gross * 0.6));
  if (row.debitType === "partial") return clampMoney(row.debitAmount, 0, gross);
  return gross;
}
function reportRowNet(row) {
  return Math.max(0, money(reportRowGross(row) - reportRowDebit(row)));
}
function sanitizeReportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const valueGross = money(row.valueGross);
    const manualDebit = !!row.manualDebit;
    const debitType = ["pay40", "pay60", "partial"].includes(row.debitType) ? row.debitType : "total";
    const sanitized = {
      id: String(row.id || `${cleanIdentifier(row.order) || index + 1}-${index}`),
      order: cleanIdentifier(row.order),
      benefit: cleanIdentifier(row.benefit),
      patientName: String(row.patientName || "").trim(),
      practiceText: String(row.practiceText || "").trim(),
      practiceCode: cleanIdentifier(row.practiceCode),
      practiceDescription: String(row.practiceDescription || "").trim(),
      appointmentAt: String(row.appointmentAt || ""),
      appointmentLabel: String(row.appointmentLabel || ""),
      transmitted: !!row.transmitted,
      transmittedAt: String(row.transmittedAt || ""),
      transmittedLabel: String(row.transmittedLabel || ""),
      validated: !!row.validated,
      validatedAt: String(row.validatedAt || ""),
      validatedLabel: String(row.validatedLabel || ""),
      period: String(row.period || ""),
      cutoffLabel: String(row.cutoffLabel || ""),
      outsideCutoff: !!row.outsideCutoff,
      facturable: !!row.facturable,
      billable: !!row.billable,
      absent: !!row.absent,
      status: String(row.status || ""),
      valueGross,
      manualDebit,
      debitType,
      debitAmount: debitType === "partial" ? clampMoney(row.debitAmount, 0, Math.max(0, valueGross)) : 0,
      valueEdited: !!row.valueEdited,
      moduleCode: cleanIdentifier(row.moduleCode),
      moduleDescription: String(row.moduleDescription || "").trim(),
      valueSourceCode: cleanIdentifier(row.valueSourceCode),
      matchFound: !!row.matchFound,
    };
    sanitized.valueBillable = reportRowGross(sanitized);
    sanitized.debitTotal = reportRowDebit(sanitized);
    sanitized.netTotal = reportRowNet(sanitized);
    return sanitized;
  }).filter((row) => row.order || row.practiceText || row.patientName);
}
function summarizeReportRows(rows) {
  return (rows || []).reduce((acc, row) => {
    acc.totalRows += 1;
    if (row.validated) acc.validated += 1;
    if (row.transmitted) acc.transmitted += 1;
    if (row.facturable) acc.facturable += 1;
    if (row.billable) acc.billable += 1;
    if (row.absent) acc.absent += 1;
    if (row.outsideCutoff) acc.outsideCutoff += 1;
    if (!row.matchFound && !row.valueEdited) acc.unmatched += 1;
    acc.gross += reportRowGross(row);
    acc.debit += reportRowDebit(row);
    acc.net += reportRowNet(row);
    return acc;
  }, { totalRows: 0, validated: 0, transmitted: 0, facturable: 0, billable: 0, absent: 0, outsideCutoff: 0, unmatched: 0, gross: 0, debit: 0, net: 0 });
}
function reportListItem(report) {
  return {
    id: report.id,
    clientSlug: report.clientSlug,
    title: report.title,
    sourceFilename: report.sourceFilename,
    nomencladorPeriod: report.nomencladorPeriod,
    nomencladorLabel: report.nomencladorLabel,
    rowCount: report.rowCount,
    closedAt: report.closedAt,
    closedBy: report.closedBy,
    updatedAt: report.updatedAt,
    updatedBy: report.updatedBy,
    expectedAmount: report.expectedAmount,
    observations: report.observations,
    summary: report.summary,
  };
}
function readBuffer(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("El archivo supera el limite permitido."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function extractMultipart(buffer, contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error("No se recibio un archivo valido.");
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const result = { fields: {}, file: null };
  let cursor = buffer.indexOf(boundary);
  while (cursor >= 0) {
    const headerStart = cursor + boundary.length + 2;
    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd < 0) break;
    const headers = buffer.slice(headerStart, headerEnd).toString("latin1");
    const fieldNameMatch = headers.match(/name="([^"]+)"/i);
    const fileNameMatch = headers.match(/filename="([^"]+)"/i);
    const dataStart = headerEnd + 4;
    const dataEnd = buffer.indexOf(Buffer.from(`\r\n--${match[1] || match[2]}`), dataStart);
    if (dataEnd >= 0 && fieldNameMatch) {
      const data = buffer.slice(dataStart, dataEnd);
      if (fileNameMatch) result.file = { filename: path.basename(fileNameMatch[1]), data };
      else result.fields[fieldNameMatch[1]] = data.toString("utf8").trim();
    }
    cursor = buffer.indexOf(boundary, headerEnd + 4);
  }
  if (!result.file) throw new Error("No encontre ningun archivo en la carga.");
  return result;
}
function sendFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "content-type": contentTypes[ext] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  });
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === "/health") return json(res, 200, { ok: true, service: "ns-web" });

  // ---- API ----
  if (p === "/api/me") {
    const u = getSessionUser(req);
    if (!u) return json(res, 401, { error: "no-auth" });
    return json(res, 200, { user: publicUser(u) });
  }

  if (p === "/api/users" && (req.method === "GET" || !req.method)) {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "forbidden" });
    const users = loadUsers() || [];
    return json(res, 200, {
      users: users.map((u) => ({
        username: u.username,
        name: u.name,
        role: u.role,
        email: u.email || "",
        active: u.active !== false,
        mustChange: !!u.mustChange,
      })),
    });
  }

  // Crear usuario (admin)
  if (p === "/api/users" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "forbidden" });
    const { username, name, role, password, email } = await readBody(req);
    const uname = String(username || "").trim().toLowerCase();
    const nm = String(name || "").trim();
    const rl = String(role || "").trim();
    const pw = String(password || "");
    const em = String(email || "").trim().toLowerCase();
    if (!validUsername(uname)) return json(res, 400, { error: "El usuario debe tener entre 3 y 20 caracteres: letras, números, punto, guion o guion bajo." });
    if (!nm) return json(res, 400, { error: "Escribí el nombre y apellido." });
    if (!ROLES.has(rl)) return json(res, 400, { error: "Elegí un perfil válido." });
    if (pw.length < 6) return json(res, 400, { error: "La contraseña inicial debe tener al menos 6 caracteres." });
    if (em && !validEmail(em)) return json(res, 400, { error: "El email no parece válido." });
    const users = loadUsers() || [];
    if (users.some((x) => x.username === uname)) return json(res, 409, { error: "Ya existe un usuario con ese nombre." });
    users.push({ username: uname, name: nm, role: rl, email: em, password: hashPassword(pw), mustChange: true, active: true });
    saveUsers(users);
    return json(res, 201, { ok: true });
  }

  // Editar / resetear clave / eliminar un usuario (admin)
  const um = p.match(/^\/api\/users\/([a-z0-9._-]+)(\/password)?$/);
  if (um) {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "forbidden" });
    const target = um[1].toLowerCase();
    const isPwd = !!um[2];
    const users = loadUsers() || [];
    const idx = users.findIndex((x) => x.username === target);
    if (idx < 0) return json(res, 404, { error: "No existe ese usuario." });

    // Resetear clave -> queda con "debe cambiar" en el proximo ingreso
    if (isPwd && req.method === "POST") {
      const { password } = await readBody(req);
      const pw = String(password || "");
      if (pw.length < 6) return json(res, 400, { error: "La clave debe tener al menos 6 caracteres." });
      users[idx].password = hashPassword(pw);
      users[idx].mustChange = true;
      saveUsers(users);
      return json(res, 200, { ok: true });
    }

    // Editar nombre / perfil / activo
    if (!isPwd && (req.method === "PATCH" || req.method === "PUT")) {
      const body = await readBody(req);
      if (body.name !== undefined) {
        const nm = String(body.name).trim();
        if (!nm) return json(res, 400, { error: "El nombre no puede quedar vacío." });
        users[idx].name = nm;
      }
      if (body.role !== undefined) {
        const rl = String(body.role).trim();
        if (!ROLES.has(rl)) return json(res, 400, { error: "Elegí un perfil válido." });
        if (target === me.username && rl !== "admin") return json(res, 400, { error: "No podés quitarte a vos mismo el perfil de administrador." });
        users[idx].role = rl;
      }
      if (body.active !== undefined) {
        const act = !!body.active;
        if (target === me.username && !act) return json(res, 400, { error: "No podés desactivar tu propio usuario." });
        users[idx].active = act;
      }
      if (body.email !== undefined) {
        const em = String(body.email).trim().toLowerCase();
        if (em && !validEmail(em)) return json(res, 400, { error: "El email no parece válido." });
        users[idx].email = em;
      }
      saveUsers(users);
      return json(res, 200, { ok: true });
    }

    // Eliminar
    if (!isPwd && req.method === "DELETE") {
      if (target === me.username) return json(res, 400, { error: "No podés eliminar tu propio usuario." });
      users.splice(idx, 1);
      saveUsers(users);
      return json(res, 200, { ok: true });
    }
  }

  if (p === "/api/login" && req.method === "POST") {
    const { username, password, remember } = await readBody(req);
    const uname = String(username || "").trim().toLowerCase();
    const users = loadUsers() || [];
    const u = users.find((x) => x.username === uname && x.active);
    if (!u || !verifyPassword(password, u.password)) {
      return json(res, 401, { error: "Usuario o contraseña incorrectos" });
    }
    setSessionCookie(res, u.username, !!remember);
    return json(res, 200, { user: publicUser(u) });
  }

  if (p === "/api/change-password" && req.method === "POST") {
    const u = getSessionUser(req);
    if (!u) return json(res, 401, { error: "no-auth" });
    const { newPassword } = await readBody(req);
    const np = String(newPassword || "");
    if (np.length < 6) return json(res, 400, { error: "La clave debe tener al menos 6 caracteres" });
    if (np === "123456") return json(res, 400, { error: "Elegí una clave distinta a la inicial" });
    const users = loadUsers() || [];
    const idx = users.findIndex((x) => x.username === u.username);
    if (idx < 0) return json(res, 404, { error: "no-user" });
    users[idx].password = hashPassword(np);
    users[idx].mustChange = false;
    saveUsers(users);
    return json(res, 200, { ok: true });
  }

  if (p === "/api/logout" && req.method === "POST") {
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  // ---- Clientes ----
  if (p === "/api/clientes" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    return json(res, 200, { clients: loadClientsStore() });
  }

  const clientModulesMatch = p.match(/^\/api\/clientes\/([^/]+)\/modules$/);
  if (clientModulesMatch && req.method === "PATCH") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador puede modificar clientes." });
    const slug = decodeURIComponent(clientModulesMatch[1]);
    const clients = loadClientsStore();
    const idx = clients.findIndex((client) => client.slug === slug);
    if (idx < 0) return json(res, 404, { error: "Cliente no encontrado." });
    const body = await readBody(req);
    const modules = normalizeClientModules(body.activeModules);
    if (!modules.length) return json(res, 400, { error: "Selecciona al menos un modulo activo." });
    clients[idx].activeModules = modules;
    saveClientsStore(clients);
    return json(res, 200, { client: clients[idx], clients });
  }

  const clientReportsMatch = p.match(/^\/api\/clientes\/([^/]+)\/reportes$/);
  if (clientReportsMatch && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientReportsMatch[1]);
    const client = loadClientsStore().find((item) => item.slug === slug);
    if (!client) return json(res, 404, { error: "Cliente no encontrado." });
    const store = loadClientReportsStore();
    const reports = (store.items || [])
      .filter((report) => report.clientSlug === slug)
      .sort((a, b) => String(b.closedAt || "").localeCompare(String(a.closedAt || "")))
      .map(reportListItem);
    return json(res, 200, { reports });
  }

  if (clientReportsMatch && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientReportsMatch[1]);
    const client = loadClientsStore().find((item) => item.slug === slug);
    if (!client) return json(res, 404, { error: "Cliente no encontrado." });
    const body = await readBody(req);
    const rows = sanitizeReportRows(body.rows);
    if (!rows.length) return json(res, 400, { error: "No hay practicas para guardar." });
    const summary = summarizeReportRows(rows);
    const closedAt = new Date().toISOString();
    const period = String(body.nomencladorPeriod || "").trim();
    const expectedAmount = money(body.expectedAmount);
    const report = {
      id: crypto.randomUUID(),
      clientSlug: slug,
      clientName: client.name,
      title: String(body.title || "").trim() || `${client.name} - ${periodLabel(rows[0].period || period)} - ${rows.length} practicas`,
      sourceFilename: path.basename(String(body.sourceFilename || "bandeja_transmision.xls")),
      nomencladorPeriod: period,
      nomencladorLabel: String(body.nomencladorLabel || periodLabel(period)),
      rowCount: rows.length,
      closedAt,
      closedBy: me.username,
      expectedAmount,
      observations: String(body.observations || "").trim(),
      summary,
      rows,
    };
    const store = loadClientReportsStore();
    store.items = [report, ...(store.items || [])];
    saveClientReportsStore(store);
    return json(res, 200, { report: reportListItem(report) });
  }

  const clientReportDetailMatch = p.match(/^\/api\/clientes\/([^/]+)\/reportes\/([^/]+)$/);
  if (clientReportDetailMatch && req.method === "PUT") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientReportDetailMatch[1]);
    const id = decodeURIComponent(clientReportDetailMatch[2]);
    const store = loadClientReportsStore();
    const idx = (store.items || []).findIndex((item) => item.clientSlug === slug && item.id === id);
    if (idx < 0) return json(res, 404, { error: "Reporte no encontrado." });
    const body = await readBody(req);
    const rows = sanitizeReportRows(body.rows);
    if (!rows.length) return json(res, 400, { error: "No hay practicas para guardar." });
    const current = store.items[idx];
    const summary = summarizeReportRows(rows);
    const period = String(body.nomencladorPeriod || current.nomencladorPeriod || "").trim();
    const expectedAmount = money(body.expectedAmount);
    const updated = {
      ...current,
      title: String(body.title || "").trim() || current.title || `${current.clientName || "Cliente"} - ${periodLabel(rows[0].period || period)} - ${rows.length} practicas`,
      sourceFilename: path.basename(String(body.sourceFilename || current.sourceFilename || "bandeja_transmision.xls")),
      nomencladorPeriod: period,
      nomencladorLabel: String(body.nomencladorLabel || current.nomencladorLabel || periodLabel(period)),
      rowCount: rows.length,
      expectedAmount,
      observations: String(body.observations || "").trim(),
      summary,
      rows,
      updatedAt: new Date().toISOString(),
      updatedBy: me.username,
    };
    store.items[idx] = updated;
    saveClientReportsStore(store);
    return json(res, 200, { report: reportListItem(updated) });
  }

  if (clientReportDetailMatch && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientReportDetailMatch[1]);
    const id = decodeURIComponent(clientReportDetailMatch[2]);
    const report = (loadClientReportsStore().items || []).find((item) => item.clientSlug === slug && item.id === id);
    if (!report) return json(res, 404, { error: "Reporte no encontrado." });
    return json(res, 200, { report });
  }

  const clientReportPreviewMatch = p.match(/^\/api\/clientes\/([^/]+)\/reportes\/preview$/);
  if (clientReportPreviewMatch && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientReportPreviewMatch[1]);
    const client = loadClientsStore().find((item) => item.slug === slug);
    if (!client) return json(res, 404, { error: "Cliente no encontrado." });
    const store = loadNomencladorStore();
    const requestedRawPeriod = String(url.searchParams.get("period") || "").trim();
    const requestedPeriod = normalizePeriod(requestedRawPeriod) || requestedRawPeriod;
    if (requestedPeriod && !store.items[requestedPeriod]) {
      return json(res, 404, { error: `No esta cargado el nomenclador ${requestedPeriod}.` });
    }
    const payload = getNomencladorByPeriod(store, requestedPeriod);
    if (!payload) return json(res, 404, { error: "Todavia no hay nomenclador cargado." });
    try {
      const raw = await readBuffer(req);
      const multipart = extractMultipart(raw, req.headers["content-type"]);
      const ext = path.extname(multipart.file.filename).toLowerCase();
      if (![".xls", ".xlsx", ".xlsm"].includes(ext)) {
        return json(res, 400, { error: "Subi una bandeja Excel .xls, .xlsx o .xlsm." });
      }
      return json(res, 200, parseTransmisionWorkbook(multipart.file.data, multipart.file.filename, payload, client));
    } catch (error) {
      return json(res, 400, { error: error.message || "No se pudo procesar la bandeja." });
    }
  }

  // ---- Nomencladores ----
  if (p === "/api/nomencladores" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const store = loadNomencladorStore();
    const payload = getNomencladorByPeriod(store, url.searchParams.get("period"));
    return json(res, 200, nomencladorSummary(store, payload));
  }

  if (p === "/api/nomencladores/search" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const store = loadNomencladorStore();
    const payload = getNomencladorByPeriod(store, url.searchParams.get("period"));
    if (!payload) return json(res, 404, { error: "Todavia no hay nomenclador cargado." });

    const query = normalizeText(url.searchParams.get("q") || "");
    const moduleValues = [
      ...url.searchParams.getAll("module"),
      ...String(url.searchParams.get("modules") || "").split(","),
    ].map((value) => String(value || "").trim()).filter(Boolean);
    const typeValue = String(url.searchParams.get("type") || "").trim();
    const scopeValue = String(url.searchParams.get("scope") || "").trim();
    const limit = Math.max(1, Math.min(300, Number(url.searchParams.get("limit") || 120)));

    let rows = payload.rows || [];
    if (query) rows = rows.filter((row) => row.search.includes(query));
    if (moduleValues.length) rows = rows.filter((row) => moduleValues.includes(String(row.moduleCode || row.moduleDescription)));
    if (typeValue) rows = rows.filter((row) => row.type === typeValue);
    if (scopeValue) rows = rows.filter((row) => row.scope === scopeValue);

    return json(res, 200, {
      total: rows.length,
      rows: rows.slice(0, limit).map(({ search, ...row }) => row),
    });
  }

  // Export completo de un periodo, en una sola request (lo usa la app de
  // escritorio para bajar el nomenclador entero; el search corta en 300).
  if (p === "/api/nomencladores/export" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const store = loadNomencladorStore();
    const payload = getNomencladorByPeriod(store, url.searchParams.get("period"));
    if (!payload) return json(res, 404, { error: "Todavia no hay nomenclador cargado." });
    // Respondemos con Content-Length explicito (no el chunked del helper json):
    // en respuestas grandes, sin Content-Length el cliente hace un recv de mas
    // tras los datos y en Windows eso termina en un reset (ECONNRESET 10054).
    const bodyStr = JSON.stringify({
      period: payload.period,
      label: payload.label || periodLabel(payload.period),
      vigencia: payload.vigencia || "",
      uploadedAt: payload.uploadedAt || "",
      rowCount: payload.rowCount,
      columns: payload.columns,
      rows: (payload.rows || []).map(({ search, ...row }) => row),
    });
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(bodyStr),
      "cache-control": "no-store",
    });
    res.end(bodyStr);
    return;
  }

  if (p === "/api/nomencladores/upload" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador puede cargar nomencladores." });
    try {
      const raw = await readBuffer(req);
      const multipart = extractMultipart(raw, req.headers["content-type"]);
      const ext = path.extname(multipart.file.filename).toLowerCase();
      if (![".xls", ".xlsx", ".xlsm"].includes(ext)) {
        return json(res, 400, { error: "Subi un archivo Excel .xls, .xlsx o .xlsm." });
      }
      const payload = parseNomencladorWorkbook(multipart.file.data, multipart.file.filename, multipart.fields.period);
      const store = loadNomencladorStore();
      store.items[payload.period] = payload;
      store.activePeriod = payload.period;
      saveNomencladorStore(store);
      return json(res, 200, nomencladorSummary(store, payload));
    } catch (error) {
      return json(res, 400, { error: error.message || "No se pudo procesar el nomenclador." });
    }
  }

  // ---- Olvide mi contraseña: pedir enlace ----
  if (p === "/api/nomencladores" && req.method === "DELETE") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador puede eliminar nomencladores." });
    const period = normalizePeriod(url.searchParams.get("period")) || String(url.searchParams.get("period") || "").trim();
    if (!period) return json(res, 400, { error: "Elegi el nomenclador que queres eliminar." });
    const store = loadNomencladorStore();
    if (!store.items[period]) return json(res, 404, { error: "No existe ese nomenclador." });
    delete store.items[period];
    const remaining = Object.keys(store.items).sort().reverse();
    store.activePeriod = remaining[0] || "";
    saveNomencladorStore(store);
    return json(res, 200, nomencladorSummary(store, getNomencladorByPeriod(store, store.activePeriod)));
  }

  if (p === "/api/forgot" && req.method === "POST") {
    const { identifier } = await readBody(req);
    const id = String(identifier || "").trim().toLowerCase();
    if (id) {
      const users = loadUsers() || [];
      const u = users.find((x) => x.active !== false && (x.username === id || String(x.email || "").toLowerCase() === id));
      if (u && u.email) {
        const token = crypto.randomBytes(24).toString("hex");
        const idx = users.findIndex((x) => x.username === u.username);
        users[idx].reset = { token, exp: Date.now() + 60 * 60 * 1000 }; // 1 hora
        saveUsers(users);
        const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
        const base = process.env.APP_URL || `${proto}://${req.headers.host}`;
        const link = `${base}/?reset=${token}`;
        try { await sendResetEmail(u.email, u.name, link); } catch (e) { console.log("[mail] error al enviar:", e && e.message); }
      }
    }
    // Respuesta uniforme: no revelamos si el usuario o el mail existen.
    return json(res, 200, { ok: true });
  }

  // ---- Restablecer con el token del mail ----
  if (p === "/api/reset" && req.method === "POST") {
    const { token, newPassword } = await readBody(req);
    const tk = String(token || "");
    const np = String(newPassword || "");
    const users = loadUsers() || [];
    const idx = users.findIndex((x) => x.reset && x.reset.token === tk);
    if (idx < 0 || !users[idx].reset || users[idx].reset.exp < Date.now()) {
      return json(res, 400, { error: "El enlace no es válido o ya venció. Pedí uno nuevo desde 'Olvidaste tu contraseña'." });
    }
    if (np.length < 6) return json(res, 400, { error: "La clave debe tener al menos 6 caracteres." });
    if (np === "123456") return json(res, 400, { error: "Elegí una clave más segura." });
    users[idx].password = hashPassword(np);
    users[idx].mustChange = false;
    delete users[idx].reset;
    saveUsers(users);
    return json(res, 200, { ok: true });
  }

  // ---- Estatico ----
  const cleanPath = p === "/" ? "/index.html" : p;
  const resolved = path.normalize(path.join(publicDir, cleanPath));
  if (!resolved.startsWith(publicDir)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Acceso denegado");
    return;
  }
  sendFile(res, resolved);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`NS Web escuchando en puerto ${port} | datos en ${dataDir}`);
});
