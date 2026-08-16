const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const XLSX = require("xlsx");
const informes = require("./informes");
const nomExport = require("./nomenclador_export");
const zipMin = require("./zip_min");

const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "public");

// Versión de assets: cambia cuando cambian styles.css o app.js. Se inyecta como
// ?v= en index.html para que ningún caché sirva una versión vieja tras un deploy.
function assetVersion() {
  let v = 0;
  for (const f of ["styles.css", "app.js"]) {
    try { v += fs.statSync(path.join(publicDir, f)).mtimeMs; } catch {}
  }
  return String(Math.round(v)) || "1";
}
const ASSET_VER = assetVersion();

// Persistencia: usa el volumen de Railway si esta montado; si no, ./data local.
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");
const usersFile = path.join(dataDir, "users.json");
const clientesFile = path.join(dataDir, "clientes.json");
const legacyNomencladorFile = path.join(dataDir, "nomenclador.json");
const nomencladoresFile = path.join(dataDir, "nomencladores.json");
const clientReportsFile = path.join(dataDir, "client_reports.json");
const clientCredsFile = path.join(dataDir, "client_credentials.json");
const clientBandejasFile = path.join(dataDir, "client_bandejas.json");
const pamiExclusionPairsFile = path.join(__dirname, "pami_exclusion_pairs.json");

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

// ---------- Credenciales PAMI por cliente (encriptadas) ----------
// La clave PAMI se guarda ENCRIPTADA (reversible, la app la necesita usable),
// nunca en texto plano. Llave AES derivada de CREDENTIAL_KEY (env) o de una
// guardada en el volumen. Los backups de la base asi no filtran las claves.
function getCredentialKey() {
  let hex = process.env.CREDENTIAL_KEY;
  if (!hex) {
    const f = path.join(dataDir, "credential_key");
    try { hex = fs.readFileSync(f, "utf8").trim(); } catch {}
    if (!hex) {
      hex = crypto.randomBytes(32).toString("hex");
      try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(f, hex); } catch {}
    }
  }
  return crypto.createHash("sha256").update(String(hex)).digest();
}
const CREDENTIAL_KEY = getCredentialKey();
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", CREDENTIAL_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain || ""), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}
function decryptSecret(stored) {
  const parts = String(stored || "").split(":");
  if (parts[0] !== "v1" || parts.length !== 4) return "";
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", CREDENTIAL_KEY, Buffer.from(parts[1], "hex"));
    decipher.setAuthTag(Buffer.from(parts[2], "hex"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "hex")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
function loadClientCreds() {
  try {
    const parsed = JSON.parse(fs.readFileSync(clientCredsFile, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function saveClientCreds(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(clientCredsFile, JSON.stringify(store, null, 2));
}
// Bandeja del mes por cliente (la sube la app cada noche desde PAMI).
function loadClientBandejas() {
  try {
    const parsed = JSON.parse(fs.readFileSync(clientBandejasFile, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function saveClientBandejas(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(clientBandejasFile, JSON.stringify(store, null, 2));
}
// Config de Informes: médicos (con su firma) y descripciones. Se guarda en el
// volumen; se siembra con los datos actuales (Naiara + descripciones base).
const informesConfigFile = path.join(dataDir, "informes_config.json");
// Presets "Normal" de cada Holter, con sus valores estándar (todos editables).
const HOLTER_SEED_PRESETS = [
  {
    id: "holter-normal", modelo: "caballito-holter", nombre: "Holter normal",
    texto: "Ritmo sinusal durante todo el estudio. Conducción AV dentro de límites fisiológicos. No se observaron arritmias supraventriculares ni ventriculares significativas. No se observaron cambios significativos del segmento ST-T. No se observaron pausas significativas. No refirió síntomas durante el estudio. Se analizó registro electrocardiográfico de 24 hs.",
    valores: { duracion: "24 hs", fcProm: "72 lpm", fcMin: "55 lpm", fcMax: "118 lpm", totalLatidos: "103.000 aprox.", latidosAnormales: "0", esv: "0", ev: "0", pausas: "0", stt: "sin cambios significativos", sintomas: "no refiere" },
  },
  {
    id: "cima-holter-normal", modelo: "cima-holter", nombre: "Holter normal",
    texto: "Se realizó Holter de tres canales. Ritmo sinusal permanente. Conducción AV dentro de límites normales. Conducción IV dentro de límites normales. No se detectaron ectópicos. No se detectaron alteraciones inespecíficas de la repolarización ventricular. Sin síntomas.",
    valores: { duracion: "24 hs", fcProm: "80 lpm", fcMin: "73 lpm", fcMax: "103 lpm", totalLatidos: "90.000 aprox.", latidosAnormales: "0", esv: "0", ev: "0", pausas: "0", pausaMasLarga: "0,0 seg", bradicardia: "0 episodios", stt: "sin cambios significativos", sintomas: "no refiere", motivo: "Control", medicacion: "—" },
  },
];
// Presets ORL. Los que llevan `ladoTextos` cambian el texto según el lado
// elegido (derecho/izquierdo/bilateral/noesp); `texto` es el default sin lado.
const ORL_SEED_PRESETS = [
  {
    id: "orl-cerumen-normal", modelo: "caballito-orl-cerumen", nombre: "Tapón de cerumen normal",
    texto: "SE REALIZA OTOMICROSCOPIA. SE EVIDENCIA TAPÓN DE CERUMEN EN CONDUCTO AUDITIVO EXTERNO, EL CUAL SE EXTRAE EN SU TOTALIDAD. POSTERIOR AL PROCEDIMIENTO SE CONSTATA CONDUCTO AUDITIVO PERMEABLE, CON MEMBRANA TIMPÁNICA NORMOLÚCIDA.",
    ladoTextos: {
      derecho: "SE REALIZA OTOMICROSCOPIA. SE EVIDENCIA TAPÓN DE CERUMEN EN OÍDO DERECHO, EL CUAL SE EXTRAE EN SU TOTALIDAD. POSTERIOR AL PROCEDIMIENTO SE CONSTATA CONDUCTO AUDITIVO DERECHO PERMEABLE, CON MEMBRANA TIMPÁNICA NORMOLÚCIDA.",
      izquierdo: "SE REALIZA OTOMICROSCOPIA. SE EVIDENCIA TAPÓN DE CERUMEN EN OÍDO IZQUIERDO, EL CUAL SE EXTRAE EN SU TOTALIDAD. POSTERIOR AL PROCEDIMIENTO SE CONSTATA CONDUCTO AUDITIVO IZQUIERDO PERMEABLE, CON MEMBRANA TIMPÁNICA NORMOLÚCIDA.",
      bilateral: "SE REALIZA OTOMICROSCOPIA. SE EVIDENCIAN TAPONES DE CERUMEN BILATERALES, LOS CUALES SE EXTRAEN EN SU TOTALIDAD. POSTERIOR AL PROCEDIMIENTO SE CONSTATA AMBOS CONDUCTOS AUDITIVOS PERMEABLES, CON MEMBRANAS TIMPÁNICAS NORMOLÚCIDAS.",
      noesp: "SE REALIZA OTOMICROSCOPIA. SE EVIDENCIA TAPÓN DE CERUMEN EN CONDUCTO AUDITIVO EXTERNO, EL CUAL SE EXTRAE EN SU TOTALIDAD. POSTERIOR AL PROCEDIMIENTO SE CONSTATA CONDUCTO AUDITIVO PERMEABLE, CON MEMBRANA TIMPÁNICA NORMOLÚCIDA.",
    },
  },
  {
    id: "orl-cerumen-cuerpo", modelo: "caballito-orl-cerumen", nombre: "Cuerpo extraño + tapón de cerumen",
    texto: "SE REALIZA OTOMICROSCOPIA. SE OBSERVA CUERPO EXTRAÑO EN CONDUCTO AUDITIVO EXTERNO, SE PROCEDE A SU EXTRACCIÓN. SE EVIDENCIA TAPÓN DE CERUMEN, EL CUAL SE EXTRAE EN SU TOTALIDAD. POSTERIOR AL PROCEDIMIENTO SE CONSTATA CONDUCTO AUDITIVO PERMEABLE, CON MEMBRANA TIMPÁNICA NORMOLÚCIDA.",
  },
  {
    id: "orl-quimico-epistaxis", modelo: "caballito-orl-quimico", nombre: "Cauterización / epistaxis anterior",
    texto: "SE REALIZA TRATAMIENTO QUÍMICO DE LESIÓN ANGIOMATOSA EN REGIÓN ANTERIOR SEPTAL, POR EPÍSTAXIS ANTERIOR RECURRENTE. PROCEDIMIENTO BIEN TOLERADO.",
  },
  {
    id: "orl-quimico-vaso", modelo: "caballito-orl-quimico", nombre: "Cauterización de vaso septal",
    texto: "SE REALIZA EXAMEN OTORRINOLARINGOLÓGICO. SE OBSERVA VASO SEPTAL PROMINENTE, SE PROCEDE A CAUTERIZACIÓN QUÍMICA POR EPÍSTAXIS RECURRENTE. PROCEDIMIENTO BIEN TOLERADO.",
  },
  {
    id: "orl-combinado-normal", modelo: "caballito-orl-combinado", nombre: "Cerumen + tratamiento químico",
    texto: "SE REALIZA OTOMICROSCOPIA. SE EVIDENCIA TAPÓN DE CERUMEN EN CONDUCTO AUDITIVO EXTERNO, EL CUAL SE EXTRAE EN SU TOTALIDAD. POSTERIOR AL PROCEDIMIENTO SE CONSTATA CONDUCTO AUDITIVO PERMEABLE, CON MEMBRANA TIMPÁNICA NORMOLÚCIDA. SE REALIZA ADEMÁS TRATAMIENTO QUÍMICO DE LESIÓN ANGIOMATOSA EN REGIÓN ANTERIOR SEPTAL, POR EPÍSTAXIS ANTERIOR RECURRENTE. PROCEDIMIENTOS BIEN TOLERADOS.",
    ladoTextos: {
      bilateral: "SE REALIZA OTOMICROSCOPIA. SE EVIDENCIAN TAPONES DE CERUMEN BILATERALES, LOS CUALES SE EXTRAEN EN SU TOTALIDAD. POSTERIOR AL PROCEDIMIENTO SE CONSTATA AMBOS CONDUCTOS AUDITIVOS PERMEABLES, CON MEMBRANAS TIMPÁNICAS NORMOLÚCIDAS. SE REALIZA ADEMÁS TRATAMIENTO QUÍMICO DE LESIÓN ANGIOMATOSA EN REGIÓN ANTERIOR SEPTAL, POR EPÍSTAXIS ANTERIOR RECURRENTE. PROCEDIMIENTOS BIEN TOLERADOS.",
    },
  },
  {
    id: "orl-videorino-normal", modelo: "caballito-orl-videorino", nombre: "Videorinofibrolaringoscopía normal",
    texto: "SE REALIZA VIDEO RINOFIBROLARINGOSCOPIA. SE OBSERVAN FOSAS NASALES PERMEABLES, CAVUM LIBRE, FARINGE Y LARINGE SIN LESIONES EVIDENTES. CUERDAS VOCALES MÓVILES Y SIMÉTRICAS, CON BUENA COAPTACIÓN GLÓTICA. PROCEDIMIENTO BIEN TOLERADO.",
  },
  {
    id: "cima-orl-videorino-normal", modelo: "cima-orl-videorino", nombre: "Videorinofibrolaringoscopía normal",
    texto: "SE REALIZA VIDEO RINOFIBROLARINGOSCOPIA. SE OBSERVAN FOSAS NASALES PERMEABLES, CAVUM LIBRE, FARINGE Y LARINGE SIN LESIONES EVIDENTES. CUERDAS VOCALES MÓVILES Y SIMÉTRICAS, CON BUENA COAPTACIÓN GLÓTICA. PROCEDIMIENTO BIEN TOLERADO.",
  },
  {
    id: "derma-crio-queratosis", modelo: "caballito-derma-crio", nombre: "Criocirugía de queratosis actínicas y seborreicas",
    texto: "SE REALIZA CRIOCIRUGÍA DE QUERATOSIS ACTÍNICAS Y SEBORREICAS EN CUERO CABELLUDO Y ROSTRO. PROCEDIMIENTO BIEN TOLERADO, SIN COMPLICACIONES INMEDIATAS.",
  },
  {
    id: "sibo-negativo", modelo: "caballito-sibo", nombre: "Estudio negativo para SIBO",
    texto: "Estudio negativo para SIBO",
    valores: { umbral: "25", ppm1: "5", ppm2: "7", ppm3: "7", ppm4: "6", ppm5: "4", ppm6: "6", ppm7: "7", ppm8: "11", ppm9: "3", ppm10: "4" },
  },
  {
    id: "sibo-positivo", modelo: "caballito-sibo", nombre: "Estudio compatible con SIBO",
    texto: "Estudio compatible con SIBO",
    valores: { umbral: "25", ppm1: "4", ppm2: "4", ppm3: "5", ppm4: "4", ppm5: "33", ppm6: "62", ppm7: "44", ppm8: "41", ppm9: "79", ppm10: "82" },
  },
  {
    id: "mapa-normal", modelo: "cima-mapa", nombre: "MAPA normal / técnicamente satisfactorio",
    texto: "PRESIÓN ARTERIAL SISTÓLICA MÁXIMA 156, MÍNIMA 96, MEDIA 126 MMHG.\nPRESIÓN ARTERIAL DIASTÓLICA MÁXIMA 84, MÍNIMA 52, MEDIA 72 MMHG.\nSE REALIZARON 62 MEDICIONES VALIDABLES. DEL PROMEDIO DE LAS MISMAS SE CONCLUYE:\nREGISTRO DE PRESIÓN ARTERIAL DENTRO DE PARÁMETROS CONSERVADOS.\nPATRÓN DIPPER CONSERVADO.\nESTUDIO TÉCNICAMENTE SATISFACTORIO.",
    valores: {
      nTot: "62", nVig: "42", nSue: "20",
      pasTP: "126", padTP: "72", fcTP: "72", pasTMin: "96", pasTMax: "156", padTMin: "52", padTMax: "84",
      pasVP: "131", padVP: "75", fcVP: "76", pasVMin: "100", pasVMax: "156", padVMin: "55", padVMax: "84",
      pasSP: "114", padSP: "64", fcSP: "66", pasSMin: "96", pasSMax: "132", padSMin: "52", padSMax: "72",
      horarioSueno: "22:00 - 08:00", patronDescenso: "13%", clasificacion: "dipper",
      cgTPas: "18%", cgTPad: "6%", cgVPas: "22%", cgVPad: "8%", cgSPas: "10%", cgSPad: "0%",
    },
  },
  {
    id: "mapa-hta-nondipper", modelo: "cima-mapa", nombre: "HTA sistólica / patrón non-dipper",
    texto: "SE OBSERVA HIPERTENSIÓN ARTERIAL SISTÓLICA, CON PREDOMINIO DURANTE TODO EL ESTUDIO.\nPATRÓN NON-DIPPER.\nESTUDIO TÉCNICAMENTE SATISFACTORIO.",
  },
  {
    id: "mapa-hipotension-dipper", modelo: "cima-mapa", nombre: "Hipotensión diastólica nocturna / patrón dipper",
    texto: "HIPOTENSIÓN ARTERIAL DIASTÓLICA NOCTURNA.\nPATRÓN DIPPER.\nESTUDIO TÉCNICAMENTE SATISFACTORIO.",
  },
  {
    id: "ergo-submax-suficiente", modelo: "cima-ergo", nombre: "Ergometría normal / submáxima suficiente",
    texto: "PRUEBA SUBMÁXIMA SUFICIENTE.\nDETENIDA A LOS 450 KGM POR FATIGA MUSCULAR.\nNO SE OBSERVÓ INFRADESNIVEL DEL ST HASTA LA CARGA ALCANZADA.\nNO REFIRIÓ ANGOR NI DISNEA.\nCOMPORTAMIENTO ADECUADO DE LA TENSIÓN ARTERIAL.\nNO PRESENTÓ ARRITMIAS SIGNIFICATIVAS.\nMETS 5.3. CF II B.",
    valores: { protocolo: "Astrand", fcPrevMax: "145 lpm", fcPrevSub: "123 lpm", fcAlcanzada: "126 lpm", pctFcMax: "87%", pctFcSub: "102%", taSis: "160 mmHg", taDia: "80 mmHg", mets: "5.3", dobleProd: "20160", vo2: "18.6", carga: "450 KGM", motivoDeten: "Fatiga muscular" },
  },
  {
    id: "ergo-max-suficiente", modelo: "cima-ergo", nombre: "Ergometría normal / máxima suficiente",
    texto: "PRUEBA MÁXIMA SUFICIENTE.\nDETENIDA A LOS 450 KGM POR AGOTAMIENTO MUSCULAR.\nNO SE OBSERVÓ INFRADESNIVEL DEL ST DURANTE EL ESFUERZO NI EN LA RECUPERACIÓN.\nNO REFIRIÓ ANGOR NI DISNEA.\nCOMPORTAMIENTO ADECUADO DE LA TENSIÓN ARTERIAL.\nNO PRESENTÓ ARRITMIAS SIGNIFICATIVAS.\nMETS 5.3. CF II B.",
    valores: { protocolo: "Astrand", fcPrevMax: "145 lpm", fcPrevSub: "123 lpm", fcAlcanzada: "138 lpm", pctFcMax: "95%", pctFcSub: "112%", taSis: "170 mmHg", taDia: "80 mmHg", mets: "5.3", dobleProd: "23460", vo2: "18.6", carga: "450 KGM", motivoDeten: "Agotamiento muscular" },
  },
  {
    id: "ergo-submax-insuficiente", modelo: "cima-ergo", nombre: "Ergometría submáxima insuficiente",
    texto: "PRUEBA SUBMÁXIMA INSUFICIENTE.\nDETENIDA A LOS 300 KGM POR FATIGA MUSCULAR.\nNO SE OBSERVÓ INFRADESNIVEL DEL ST HASTA LA CARGA ALCANZADA.\nNO REFIRIÓ ANGOR.\nCOMPORTAMIENTO ADECUADO DE LA TENSIÓN ARTERIAL.\nNO PRESENTÓ ARRITMIAS SIGNIFICATIVAS.\nBAJA CAPACIDAD FUNCIONAL PARA LA EDAD.",
    valores: { protocolo: "Astrand", fcPrevMax: "135 lpm", fcPrevSub: "115 lpm", fcAlcanzada: "82 lpm", pctFcMax: "61%", pctFcSub: "71%", taSis: "140 mmHg", taDia: "80 mmHg", mets: "4.6", dobleProd: "11480", vo2: "16.1", carga: "300 KGM", motivoDeten: "Fatiga muscular / baja tolerancia al esfuerzo" },
  },
];
function loadInformesConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(informesConfigFile, "utf8")); } catch {}
  if (!cfg || typeof cfg !== "object") cfg = {};
  if (!Array.isArray(cfg.medicos)) {
    cfg.medicos = [{ id: "naiara", nombre: "Dra. Naiara A. Jacinto", firma: "firma-naiara.png", modelos: ["caballito-consulta-570129", "caballito-electro", "caballito-holter"] }];
  }
  if (!Array.isArray(cfg.descripciones)) {
    cfg.descripciones = [
      { id: "normal", nombre: "ECG normal", texto: "Ecg sin complicaciones, trazado sin valor patológico.", modelos: ["caballito-consulta-570129", "caballito-electro", "cima-electro", "cima-consulta-570129"] },
      { id: "ritmo-sinusal", nombre: "Ritmo sinusal", texto: "Ritmo sinusal. Sin signos de isquemia aguda.", modelos: ["caballito-consulta-570129", "caballito-electro", "cima-electro", "cima-consulta-570129"] },
      ...HOLTER_SEED_PRESETS.map((s) => ({ id: s.id, nombre: s.nombre, texto: s.texto, modelos: [s.modelo], valores: s.valores })),
      ...ORL_SEED_PRESETS.map((s) => ({ id: s.id, nombre: s.nombre, texto: s.texto, modelos: [s.modelo], ladoTextos: s.ladoTextos || {}, valores: s.valores || {} })),
    ];
  }
  return cfg;
}
function saveInformesConfig(cfg) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(informesConfigFile, JSON.stringify(cfg, null, 2));
}
function slugId(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
// Valores de la caja técnica (Holter): mapa key->texto corto, saneado.
function sanitizarValores(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const k of Object.keys(obj)) {
    if (!/^[a-zA-Z0-9]{1,30}$/.test(k)) continue;
    const v = String(obj[k] == null ? "" : obj[k]).replace(/\s+/g, " ").trim().slice(0, 60);
    if (v) out[k] = v;
  }
  return out;
}
function firmaExiste(name) {
  if (!name) return false;
  try { fs.accessSync(path.join(dataDir, "informes", name)); return true; } catch {}
  try { fs.accessSync(path.join(__dirname, "assets", "informes", name)); return true; } catch {}
  return false;
}

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
function downloadName(value) {
  return String(value || "reporte")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "reporte";
}
function asciiText(value) {
  return String(value == null ? "" : value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, function(ch) {
      return ({ "Ñ": "N", "ñ": "n", "°": "o", "$": "$" })[ch] || " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}
function pdfLiteral(value) {
  return `(${asciiText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
}
function pdfMoney(value) {
  return "$ " + money(value).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    ugl: "UGL XXXV",
    sap: "",
    status: "Activo",
    activeModules: [
      { code: "546", name: "TRAUMATOLOGIA" },
      { code: "437", name: "OTORRINOLARINGOLOGIA" },
      { code: "432", name: "PEDIATRIA" },
      { code: "543", name: "CARDIOLOGIA" },
      { code: "557", name: "NUTRICION" },
      { code: "545", name: "UROLOGIA" },
    ],
  },
  {
    slug: "cima",
    name: "CIMA",
    businessName: "CEINTRAMED SRL",
    cuit: "30712382828",
    ugl: "UGL XXXV",
    sap: "110853",
    status: "Activo",
    activeModules: [
      { code: "543", name: "CARDIOLOGIA" },
      { code: "537", name: "DERMATOLOGIA" },
      { code: "555", name: "DIABETOLOGIA" },
      { code: "434", name: "ENDOCRINOLOGIA" },
      { code: "435", name: "FLEBOLOGIA" },
      { code: "552", name: "GASTROENTEROLOGIA" },
      { code: "551", name: "GINECOLOGIA Y OBSTETRICIA" },
      { code: "418", name: "HEMATOLOGIA" },
      { code: "432", name: "PEDIATRIA" },
      { code: "433", name: "REUMATOLOGIA" },
      { code: "546", name: "TRAUMATOLOGIA" },
      { code: "3", name: "ECODIAGNOSTICO DE NIVEL 1" },
      { code: "22", name: "ECODOPPLER EN AMBULATORIO" },
      { code: "557", name: "NUTRICION" },
      { code: "545", name: "UROLOGIA" },
      { code: "558", name: "LIC. EN NUTRICION" },
      { code: "549", name: "NEFROLOGIA" },
      { code: "548", name: "NEUMONOLOGIA" },
      { code: "541", name: "NEUROLOGIA" },
      { code: "437", name: "OTORRINOLARINGOLOGIA" },
      { code: "2", name: "RADIOLOGIA AMBULATORIA DE NIVEL 1" },
      { code: "553", name: "FONOAUDIOLOGIA" },
      { code: "36", name: "OFTALMOLOGIA - CONSULTAS Y PRACTICAS" },
    ],
  },
  {
    slug: "caballito-pediatrico",
    name: "Caballito Pediatrico",
    businessName: "CENTRO PEDIATRICO CABALLITO SRL",
    cuit: "30661318143",
    ugl: "UGL VI",
    sap: "119322",
    status: "Activo",
    activeModules: [
      { code: "3", name: "ECODIAGNOSTICO DE NIVEL 1" },
      { code: "22", name: "ECODOPPLER EN AMBULATORIO" },
      { code: "418", name: "HEMATOLOGIA" },
      { code: "432", name: "PEDIATRIA" },
      { code: "433", name: "REUMATOLOGIA" },
      { code: "434", name: "ENDOCRINOLOGIA" },
      { code: "435", name: "FLEBOLOGIA" },
      { code: "437", name: "OTORRINOLARINGOLOGIA" },
      { code: "537", name: "DERMATOLOGIA" },
      { code: "542", name: "ANATOMIA PATOLOGICA" },
      { code: "543", name: "CARDIOLOGIA" },
      { code: "544", name: "CIRUGIA GENERAL AMBULATORIA" },
      { code: "545", name: "UROLOGIA" },
      { code: "546", name: "TRAUMATOLOGIA" },
      { code: "548", name: "NEUMONOLOGIA" },
      { code: "549", name: "NEFROLOGIA" },
      { code: "551", name: "GINECOLOGIA Y OBSTETRICIA" },
      { code: "552", name: "GASTROENTEROLOGIA" },
      { code: "554", name: "FISIATRIA - CONSULTAS" },
      { code: "555", name: "DIABETOLOGIA" },
      { code: "558", name: "LIC. EN NUTRICION" },
    ],
  },
  {
    slug: "st-ignacio",
    name: "St Ignacio",
    businessName: "ST IGNACIO SRL",
    cuit: "30716016680",
    ugl: "UGL XXXV",
    sap: "112553",
    status: "Activo",
    activeModules: [
      { code: "540", name: "ALERGIA E INMUNOLOGIA" },
      { code: "543", name: "CARDIOLOGIA" },
      { code: "555", name: "DIABETOLOGIA" },
      { code: "22", name: "ECODOPPLER EN AMBULATORIO" },
      { code: "434", name: "ENDOCRINOLOGIA" },
      { code: "435", name: "FLEBOLOGIA" },
      { code: "553", name: "FONOAUDIOLOGIA" },
      { code: "437", name: "OTORRINOLARINGOLOGIA" },
      { code: "433", name: "REUMATOLOGIA" },
    ],
  },
];
// Slugs que vienen por código (seed). Borrar uno de estos deja un "tombstone"
// (status: "deleted") en el volumen para que no reaparezca al re-seedear.
const DEFAULT_CLIENT_SLUGS = new Set(DEFAULT_CLIENTS.map((c) => c.slug));
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
function clientSlugFromName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function normalizeCuit(value) {
  return String(value || "").replace(/\D/g, "");
}
function validCuit(value) {
  const cuit = normalizeCuit(value);
  if (!/^\d{11}$/.test(cuit)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, weight, index) => acc + Number(cuit[index]) * weight, 0);
  let digit = 11 - (sum % 11);
  if (digit === 11) digit = 0;
  if (digit === 10) digit = 9;
  return digit === Number(cuit[10]);
}
function normalizeClient(client, fallback) {
  const base = fallback || {};
  const modules = normalizeClientModules(client.activeModules);
  return {
    slug: String(client.slug || base.slug || "").trim(),
    name: String(client.name || base.name || "").trim(),
    businessName: String(client.businessName || base.businessName || "").trim(),
    cuit: String(client.cuit || base.cuit || "").trim(),
    ugl: String(client.ugl || base.ugl || "").trim(),
    sap: String(client.sap || base.sap || "").trim(),
    status: String(client.status || base.status || "Activo").trim() || "Activo",
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
  return Array.from(bySlug.values()).filter((client) => client.slug && client.name && client.status !== "deleted");
}
function loadClientOverrides() {
  try { const p = JSON.parse(fs.readFileSync(clientesFile, "utf8")); return Array.isArray(p) ? p : []; } catch { return []; }
}
function saveClientsStore(clients) {
  // Preservamos los tombstones (borrados) que no vuelvan a estar activos, para
  // que un alta/edición posterior no "reviva" un cliente eliminado.
  const activos = new Set(clients.map((c) => String(c.slug)));
  const tombs = loadClientOverrides()
    .filter((c) => c && c.status === "deleted" && !activos.has(String(c.slug)))
    .map((c) => ({ slug: String(c.slug), status: "deleted" }));
  const out = clients.map((client) => normalizeClient(client)).concat(tombs);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(clientesFile, JSON.stringify(out, null, 2));
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
function pairKey(a, b) {
  return [String(a || ""), String(b || "")].sort().join("|");
}
function loadPamiExclusionPairs() {
  try {
    const parsed = JSON.parse(fs.readFileSync(pamiExclusionPairsFile, "utf8"));
    return Array.isArray(parsed.pairs) ? parsed.pairs : [];
  } catch {
    return [];
  }
}
const pamiExclusionCodeAliases = {
  // Equivalencias entre codigos historicos del PDF y codigos actuales que aparecen en bandejas/nomencladores.
  "570121": ["170145", "177145"],
  "570124": ["170157", "177157"],
  "570126": ["170141", "177141"],
  "180114": ["187114"],
};
const pamiExclusionPairs = loadPamiExclusionPairs();
const pamiExclusionPairMap = new Map(pamiExclusionPairs.map((rule) => [pairKey(rule.codes && rule.codes[0], rule.codes && rule.codes[1]), rule]));
const pamiExclusionDescriptionCodes = new Map();
pamiExclusionPairs.forEach((rule) => {
  [
    [rule.codes && rule.codes[0], rule.descriptionA],
    [rule.codes && rule.codes[1], rule.descriptionB],
  ].forEach(([code, description]) => {
    const text = normalizeText(description);
    if (!code || text.length < 8) return;
    if (!pamiExclusionDescriptionCodes.has(text)) pamiExclusionDescriptionCodes.set(text, new Set());
    pamiExclusionDescriptionCodes.get(text).add(code);
  });
});
const pamiExclusionDescriptionCodeCache = new Map();
function pamiExclusionCodesByDescription(description) {
  const text = normalizeText(description);
  if (text.length < 8) return [];
  if (pamiExclusionDescriptionCodeCache.has(text)) return pamiExclusionDescriptionCodeCache.get(text);
  const found = new Set();
  for (const [pdfDescription, codes] of pamiExclusionDescriptionCodes.entries()) {
    if (pdfDescription === text || pdfDescription.includes(text) || text.includes(pdfDescription)) {
      codes.forEach((code) => found.add(code));
    }
  }
  const result = Array.from(found);
  pamiExclusionDescriptionCodeCache.set(text, result);
  return result;
}
function expandedPamiExclusionCodes(rowOrCode) {
  const row = typeof rowOrCode === "object" && rowOrCode ? rowOrCode : null;
  const clean = cleanIdentifier(row ? row.practiceCode : rowOrCode);
  const descriptionCodes = row ? pamiExclusionCodesByDescription(`${row.practiceDescription || ""} ${row.practiceText || ""}`) : [];
  return Array.from(new Set([clean, ...(pamiExclusionCodeAliases[clean] || []), ...descriptionCodes].filter(Boolean)));
}
function findPamiExclusionRule(rowA, rowB) {
  for (const a of expandedPamiExclusionCodes(rowA)) {
    for (const b of expandedPamiExclusionCodes(rowB)) {
      const rule = pamiExclusionPairMap.get(pairKey(a, b));
      if (rule) return { ...rule, matchedCodes: [a, b] };
    }
  }
  return null;
}
const automaticDebitRules = [
  {
    debitCodes: ["570124", "170157", "177157"],
    dominantCodes: ["570121", "170145", "177145"],
    debitLabel: "570124",
    dominantLabel: "570121",
    description: "Ergometria debitada por Holter en el mismo periodo",
  },
];
function rowMatchesAnyPracticeCode(row, codes) {
  const expanded = expandedPamiExclusionCodes(row);
  return codes.some((code) => expanded.includes(code));
}
function findAutomaticDebitRule(rowA, rowB) {
  for (const rule of automaticDebitRules) {
    const aIsDebit = rowMatchesAnyPracticeCode(rowA, rule.debitCodes);
    const bIsDebit = rowMatchesAnyPracticeCode(rowB, rule.debitCodes);
    const aIsDominant = rowMatchesAnyPracticeCode(rowA, rule.dominantCodes);
    const bIsDominant = rowMatchesAnyPracticeCode(rowB, rule.dominantCodes);
    if (aIsDebit && bIsDominant) return { rule, target: rowA, other: rowB };
    if (bIsDebit && aIsDominant) return { rule, target: rowB, other: rowA };
  }
  return null;
}
function reportRowExclusionGroupKey(row) {
  const benefit = cleanIdentifier(row && row.benefit);
  if (!benefit) return "";
  const period = normalizePeriod(row && row.period) || String(row && row.appointmentAt || "").slice(0, 7);
  return period ? `${benefit}|${period}` : "";
}
function applyAutomaticExclusionDebits(rows) {
  const groups = new Map();
  (rows || []).forEach((row) => {
    row.autoDebit = false;
    row.autoDebitReason = "";
    row.autoDebitPairCode = "";
    row.autoDebitRulePage = "";
    row.autoDebitRuleCodes = "";
    if (!row.billable || !row.practiceCode || reportRowGross(row) <= 0) return;
    const key = reportRowExclusionGroupKey(row);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  for (const groupRows of groups.values()) {
    for (let i = 0; i < groupRows.length; i += 1) {
      for (let j = i + 1; j < groupRows.length; j += 1) {
        const match = findAutomaticDebitRule(groupRows[i], groupRows[j]);
        if (!match) continue;
        const { rule, target, other } = match;
        target.manualDebit = true;
        target.debitType = "total";
        target.debitAmount = 0;
        target.autoDebit = true;
        target.autoDebitPairCode = other.practiceCode || "";
        target.autoDebitRulePage = "";
        target.autoDebitRuleCodes = `${rule.debitLabel} / ${rule.dominantLabel}`;
        target.autoDebitReason = `${rule.description}: ${target.practiceCode || rule.debitLabel} contra ${other.practiceCode || rule.dominantLabel}`;
      }
    }
  }
  return rows || [];
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
const clientPracticeValueOverrides = {
  "sala-millon": {
    "570126": {
      moduleCode: "543",
      moduleDescription: "CARDIOLOGIA",
      practiceCode: "570126",
      practiceDescription: "ELECTROCARDIOGRAMA",
      total: 6905.52,
      valueSourceCode: "570126",
    },
  },
};
function getClientPracticeOverride(clientSlug, practiceCode) {
  return ((clientPracticeValueOverrides[clientSlug] || {})[String(practiceCode || "")]) || null;
}
function findNomencladorMatch(payload, client, practice) {
  const activeModules = new Set((client.activeModules || []).map((module) => String(module.code)));
  const aliasCode = ((clientPracticeValueAliases[client.slug] || {})[practice.code]) || "";
  const override = getClientPracticeOverride(client.slug, practice.code);
  let valueSourceCode = practice.code;
  let candidates = (payload.rows || []).filter((row) => String(row.practiceCode || "") === practice.code);
  if (!candidates.length && aliasCode) {
    valueSourceCode = aliasCode;
    candidates = (payload.rows || []).filter((row) => String(row.practiceCode || "") === aliasCode);
  }
  if (!candidates.length && override) return { ...override };
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

  let rows = sourceRows.map((source, index) => {
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

  rows = applyAutomaticExclusionDebits(rows);

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
function reportRowNextPeriodCutoff(row) {
  return row && row.outsideCutoff ? money(row.valueGross) : 0;
}
function reportRowMissingInforme(row) {
  return !!(row && row.validated && !row.transmitted && !row.absent);
}
function reportRowMissingInformeAmount(row) {
  return reportRowMissingInforme(row) ? money(row.valueGross) : 0;
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
      autoDebit: !!row.autoDebit,
      autoDebitReason: String(row.autoDebitReason || "").trim(),
      autoDebitPairCode: cleanIdentifier(row.autoDebitPairCode),
      autoDebitRulePage: cleanIdentifier(row.autoDebitRulePage),
      autoDebitRuleCodes: String(row.autoDebitRuleCodes || "").trim(),
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
function applyClientPracticeOverrides(clientSlug, rows) {
  return (rows || []).map((row) => {
    const override = getClientPracticeOverride(clientSlug, row.practiceCode);
    if (!override || row.valueEdited) return row;
    const next = {
      ...row,
      moduleCode: row.moduleCode || override.moduleCode || "",
      moduleDescription: row.moduleDescription || override.moduleDescription || "",
      practiceDescription: row.practiceDescription || override.practiceDescription || "",
      valueGross: Number(row.valueGross || 0) > 0 ? row.valueGross : money(override.total),
      valueSourceCode: row.valueSourceCode || override.valueSourceCode || override.practiceCode || "",
      matchFound: true,
    };
    next.valueBillable = reportRowGross(next);
    next.debitTotal = reportRowDebit(next);
    next.netTotal = reportRowNet(next);
    return next;
  });
}
function reportRows(report) {
  return applyClientPracticeOverrides(report.clientSlug, report.rows || []);
}
function summarizeReportRows(rows) {
  return (rows || []).reduce((acc, row) => {
    acc.totalRows += 1;
    if (isConsultationRow(row)) acc.consultations += 1;
    else acc.practices += 1;
    if (row.validated) acc.validated += 1;
    if (row.transmitted) acc.transmitted += 1;
    if (row.facturable) acc.facturable += 1;
    if (row.billable) acc.billable += 1;
    if (row.absent) acc.absent += 1;
    if (row.outsideCutoff) acc.outsideCutoff += 1;
    if (reportRowMissingInforme(row)) acc.missingInforme += 1;
    if (!row.matchFound && !row.valueEdited) acc.unmatched += 1;
    acc.gross += reportRowGross(row);
    acc.debit += reportRowDebit(row);
    acc.net += reportRowNet(row);
    acc.nextPeriodCutoff += reportRowNextPeriodCutoff(row);
    acc.missingInformeAmount += reportRowMissingInformeAmount(row);
    if (isConsultationRow(row)) acc.consultationNet += reportRowNet(row);
    else acc.practiceNet += reportRowNet(row);
    return acc;
  }, { totalRows: 0, consultations: 0, practices: 0, validated: 0, transmitted: 0, facturable: 0, billable: 0, absent: 0, outsideCutoff: 0, missingInforme: 0, unmatched: 0, gross: 0, debit: 0, net: 0, nextPeriodCutoff: 0, missingInformeAmount: 0, consultationNet: 0, practiceNet: 0 });
}
function isConsultationRow(row) {
  const code = String(row && row.practiceCode || "");
  const text = normalizeText([row && row.practiceDescription, row && row.practiceText].join(" "));
  return code.startsWith("820") || text.includes("CONSULTA");
}
// Módulo de nivel 1 del nomenclador PAMI (ej. "RADIOLOGIA AMBULATORIA DE NIVEL 1").
// Acepta "NIVEL 1" y "NIVEL I", sin confundir con NIVEL 2/3 ni II/III.
function isNivel1Module(moduleDescription) {
  const s = normalizeText(String(moduleDescription || ""));
  return /\bNIVEL\s*1\b/.test(s) || /\bNIVEL\s*I\b/.test(s);
}
// Promedio de aumento (por practica presente en ambos meses) para general,
// consultas y modulos de nivel 1. Reusado por /comparar y /variaciones.
function computeNomencladorDelta(previous, current) {
  const prevTotal = new Map();
  for (const row of previous.rows || []) {
    const code = String(row.practiceCode || "").trim();
    if (code && !prevTotal.has(code)) prevTotal.set(code, money(row.total));
  }
  const general = [], consultas = [], nivel1 = [];
  for (const row of current.rows || []) {
    const code = String(row.practiceCode || "").trim();
    if (!code || !prevTotal.has(code)) continue;
    const before = prevTotal.get(code);
    if (!(before > 0)) continue;
    const pct = (money(row.total) - before) / before;
    general.push(pct);
    if (isConsultationRow(row)) consultas.push(pct);
    if (isNivel1Module(row.moduleDescription)) nivel1.push(pct);
  }
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    matched: general.length,
    general: { avgPct: avg(general), count: general.length },
    consultas: { avgPct: avg(consultas), count: consultas.length },
    nivel1: { avgPct: avg(nivel1), count: nivel1.length },
  };
}
function reportDashboardPeriod(report) {
  const counts = new Map();
  for (const row of report.rows || []) {
    const period = normalizePeriod(row.period || String(row.appointmentAt || "").slice(0, 7));
    if (period) counts.set(period, (counts.get(period) || 0) + 1);
  }
  if (counts.size) {
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0][0];
  }
  return inferPeriodFromText(report.title, report.sourceFilename, report.closedAt) || String(report.closedAt || "").slice(0, 7);
}
function emptyDashboardPeriod(period) {
  return {
    period,
    label: periodLabel(period),
    reportCount: 0,
    totalRows: 0,
    consultations: 0,
    practices: 0,
    validated: 0,
    transmitted: 0,
    facturable: 0,
    billable: 0,
    absent: 0,
    outsideCutoff: 0,
    nextPeriodCutoff: 0,
    unmatched: 0,
    gross: 0,
    debit: 0,
    net: 0,
    consultationNet: 0,
    practiceNet: 0,
    averageNet: 0,
    consultationShare: 0,
    modules: [],
  };
}
function addRowToDashboardPeriod(target, row) {
  target.totalRows += 1;
  const consultation = isConsultationRow(row);
  if (consultation) target.consultations += 1;
  else target.practices += 1;
  if (row.validated) target.validated += 1;
  if (row.transmitted) target.transmitted += 1;
  if (row.facturable) target.facturable += 1;
  if (row.billable) target.billable += 1;
  if (row.absent) target.absent += 1;
  if (row.outsideCutoff) target.outsideCutoff += 1;
  target.nextPeriodCutoff += reportRowNextPeriodCutoff(row);
  if (!row.matchFound && !row.valueEdited) target.unmatched += 1;
  const gross = reportRowGross(row);
  const debit = reportRowDebit(row);
  const net = reportRowNet(row);
  target.gross += gross;
  target.debit += debit;
  target.net += net;
  if (consultation) target.consultationNet += net;
  else target.practiceNet += net;
  const moduleCode = String(row.moduleCode || "Sin modulo");
  let module = target._modules[moduleCode];
  if (!module) {
    module = target._modules[moduleCode] = {
      moduleCode,
      moduleDescription: row.moduleDescription || "",
      totalRows: 0,
      consultations: 0,
      practices: 0,
      gross: 0,
      debit: 0,
      net: 0,
      rows: [],
    };
  }
  module.totalRows += 1;
  if (consultation) module.consultations += 1;
  else module.practices += 1;
  module.gross += gross;
  module.debit += debit;
  module.net += net;
  module.rows.push({
    patientName: row.patientName || "",
    benefit: row.benefit || "",
    order: row.order || "",
    practiceCode: row.practiceCode || "",
    practiceDescription: row.practiceDescription || row.practiceText || "",
    kind: consultation ? "Consulta" : "Practica",
    status: row.status || "",
    gross,
    debit,
    net,
    matchFound: !!row.matchFound,
    valueEdited: !!row.valueEdited,
  });
}
function finalizeDashboardPeriod(target) {
  target.gross = money(target.gross);
  target.debit = money(target.debit);
  target.net = money(target.net);
  target.consultationNet = money(target.consultationNet);
  target.practiceNet = money(target.practiceNet);
  target.averageNet = target.totalRows ? money(target.net / target.totalRows) : 0;
  target.consultationShare = target.totalRows ? target.consultations / target.totalRows : 0;
  target.modules = Object.values(target._modules || {})
    .map((module) => ({
      ...module,
      gross: money(module.gross),
      debit: money(module.debit),
      net: money(module.net),
      rows: (module.rows || []).sort((a, b) => String(a.patientName).localeCompare(String(b.patientName)) || String(a.practiceCode).localeCompare(String(b.practiceCode))),
    }))
    .sort((a, b) => b.net - a.net || String(a.moduleCode).localeCompare(String(b.moduleCode)));
  delete target._modules;
  return target;
}
function metricDelta(current, previous, key) {
  const a = Number(current && current[key] || 0);
  const b = Number(previous && previous[key] || 0);
  return { value: money(a - b), percent: b ? (a - b) / b : null };
}
function buildClientDashboard(slug, periodFilter, compareFilter) {
  const reports = (loadClientReportsStore().items || []).filter((report) => report.clientSlug === slug);
  const byPeriod = new Map();
  for (const report of reports) {
    const period = reportDashboardPeriod(report);
    if (!period) continue;
    if (!byPeriod.has(period)) {
      const item = emptyDashboardPeriod(period);
      item._modules = {};
      byPeriod.set(period, item);
    }
    const target = byPeriod.get(period);
    target.reportCount += 1;
    for (const row of reportRows(report)) addRowToDashboardPeriod(target, row);
  }
  const periods = Array.from(byPeriod.values()).map(finalizeDashboardPeriod).sort((a, b) => b.period.localeCompare(a.period));
  const selectedPeriod = normalizePeriod(periodFilter) || (periods[0] && periods[0].period) || "";
  const selectedIndex = periods.findIndex((item) => item.period === selectedPeriod);
  const comparePeriod = normalizePeriod(compareFilter) || (periods[selectedIndex + 1] && periods[selectedIndex + 1].period) || "";
  const current = periods.find((item) => item.period === selectedPeriod) || emptyDashboardPeriod(selectedPeriod);
  const previous = periods.find((item) => item.period === comparePeriod) || emptyDashboardPeriod(comparePeriod);
  return {
    periods: periods.map((item) => ({ period: item.period, label: item.label, reportCount: item.reportCount })),
    // serie para el mini-grafico de tendencia (ultimos 8 meses, ascendente)
    series: periods
      .slice(0, 8)
      .map((item) => ({ period: item.period, label: item.label, net: item.net, consultations: item.consultations }))
      .reverse(),
    current,
    compare: previous,
    deltas: {
      totalRows: metricDelta(current, previous, "totalRows"),
      consultations: metricDelta(current, previous, "consultations"),
      practices: metricDelta(current, previous, "practices"),
      absent: metricDelta(current, previous, "absent"),
      outsideCutoff: metricDelta(current, previous, "outsideCutoff"),
      gross: metricDelta(current, previous, "gross"),
      debit: metricDelta(current, previous, "debit"),
      net: metricDelta(current, previous, "net"),
      averageNet: metricDelta(current, previous, "averageNet"),
    },
  };
}
function reportListItem(report) {
  const summary = summarizeReportRows(reportRows(report));
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
    summary,
  };
}
function buildClientReportWorkbook(report) {
  const rowsForReport = reportRows(report);
  const summary = summarizeReportRows(rowsForReport);
  const wb = XLSX.utils.book_new();
  const resumen = [
    ["Reporte", report.title || ""],
    ["Cliente", report.clientName || ""],
    ["Archivo origen", report.sourceFilename || ""],
    ["Nomenclador", report.nomencladorLabel || report.nomencladorPeriod || ""],
    ["Cerrado", report.closedAt || ""],
    ["Cerrado por", report.closedBy || ""],
    ["Actualizado", report.updatedAt || ""],
    ["Actualizado por", report.updatedBy || ""],
    ["Monto esperado", money(report.expectedAmount)],
    ["Bruto facturable", money(summary.gross)],
    ["Debitos", money(summary.debit)],
    ["Neto estimado", money(summary.net)],
    ["Proximo periodo por corte", money(summary.nextPeriodCutoff)],
    ["Falta informe", money(summary.missingInformeAmount)],
    ["Cantidad falta informe", summary.missingInforme || 0],
    ["Cantidad de consultas", summary.consultations || 0],
    ["Importe consultas", money(summary.consultationNet)],
    ["Cantidad de practicas / estudios", summary.practices || 0],
    ["Importe practicas / estudios", money(summary.practiceNet)],
    ["Valor promedio por prestacion", summary.totalRows ? money(summary.net / summary.totalRows) : 0],
    ["% consultas sobre total", summary.totalRows ? (summary.consultations || 0) / summary.totalRows : 0],
    ["Ausentes / activas", summary.absent || 0],
    ["Fuera de corte", summary.outsideCutoff || 0],
    ["Sin valor", summary.unmatched || 0],
    [],
    ["Observaciones"],
    [report.observations || ""],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), "Resumen");
  const rows = rowsForReport.map((row) => ({
    Paciente: row.patientName || "",
    Beneficio: row.benefit || "",
    OME: row.order || "",
    "Codigo practica": row.practiceCode || "",
    Prestacion: row.practiceDescription || row.practiceText || "",
    Modulo: [row.moduleCode || "", row.moduleDescription || ""].filter(Boolean).join(" "),
    Turno: row.appointmentLabel || row.appointmentAt || "",
    Transmision: row.transmittedLabel || row.transmittedAt || "",
    Estado: row.status || "",
    Bruto: reportRowGross(row),
    Debito: reportRowDebit(row),
    Neto: reportRowNet(row),
    "Tipo debito": row.manualDebit ? (row.debitType === "pay40" ? "Paga 40%" : row.debitType === "pay60" ? "Paga 60%" : "Total") : "",
    "Debito automatico": row.autoDebit ? "Si" : "",
    "Motivo debito automatico": row.autoDebitReason || "",
    "Codigo excluyente": row.autoDebitPairCode || "",
    "Regla PDF": row.autoDebitRulePage ? `Pagina ${row.autoDebitRulePage}` : "",
    "Codigos regla": row.autoDebitRuleCodes || "",
    "Valor fuente": row.valueSourceCode || "",
    "Valor editado": row.valueEdited ? "Si" : "",
    "Sin valor": (!row.matchFound && !row.valueEdited) ? "Si" : "",
    "Fuera de corte": row.outsideCutoff ? "Si" : "",
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Practicas");
  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
}
const professionalReportModules = {
  "543": "CARDIOLOGIA",
  "546": "TRAUMATOLOGIA",
};
const reportSpecialPdfSections = {
  cutoff: {
    label: "PROXIMO PERIODO",
    filename: "PROXIMO-PERIODO",
  },
  missingInforme: {
    label: "FALTA INFORME",
    filename: "FALTA-INFORME",
  },
};
function wrapPdfText(text, maxChars) {
  const words = asciiText(text).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}
function pdfTextCommand(x, y, text, size = 8, font = "F1") {
  return `BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfLiteral(text)} Tj ET`;
}
function pdfLineCommand(x1, y1, x2, y2, width = 0.5) {
  return `${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;
}
function buildPdfBuffer(pageStreams, width = 842, height = 595) {
  const objects = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageIds = pageStreams.map((_, i) => 5 + i * 2);
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  pageStreams.forEach((stream, i) => {
    const pageObj = 5 + i * 2;
    const contentObj = pageObj + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
function professionalReportStatus(row) {
  const status = String(row && row.status || "").trim();
  if (reportRowDebit(row) > 0 && reportRowNet(row) <= 0.01) return "Debito";
  if (reportRowMissingInforme(row)) return "Falta informe";
  return normalizeText(status) === "FACTURABLE" ? "Cobrado" : (status || "-");
}
function sortPdfRows(rows) {
  return (rows || []).slice().sort((a, b) =>
    String(a.practiceCode || "").localeCompare(String(b.practiceCode || ""))
    || String(a.patientName || "").localeCompare(String(b.patientName || ""))
  );
}
function buildRowsPdf(options) {
  const sections = (options.sections || [{
    title: "",
    rows: options.rows || [],
    statusForRow: options.statusForRow,
    amountForRow: options.amountForRow,
    emptyText: options.emptyText,
  }]).map((section) => ({ ...section, rows: sortPdfRows(section.rows || []) }));
  const rows = sections.flatMap((section) => section.rows);
  const total = money(options.total || 0);
  const pageStreams = [];
  const width = 842;
  const height = 595;
  const margin = 28;
  const cols = { ome: 28, benef: 105, nombre: 208, practica: 330, turno: 610, estado: 690, neto: 760 };
  let y = 0;
  let commands = [];
  function drawTableHeader() {
    commands.push(pdfLineCommand(margin, y + 8, width - margin, y + 8));
    commands.push(pdfTextCommand(cols.ome, y, "OME", 7, "F2"));
    commands.push(pdfTextCommand(cols.benef, y, "BENEF", 7, "F2"));
    commands.push(pdfTextCommand(cols.nombre, y, "NOMBRE", 7, "F2"));
    commands.push(pdfTextCommand(cols.practica, y, "PRACTICA", 7, "F2"));
    commands.push(pdfTextCommand(cols.turno, y, "TURNO", 7, "F2"));
    commands.push(pdfTextCommand(cols.estado, y, "ESTADO", 7, "F2"));
    commands.push(pdfTextCommand(cols.neto, y, "NETO", 7, "F2"));
    commands.push(pdfLineCommand(margin, y - 5, width - margin, y - 5));
    y -= 18;
  }
  function drawProfessionalRow(row, statusText, amount) {
    const practiceLines = wrapPdfText(`${row.practiceCode || ""} - ${row.practiceDescription || row.practiceText || ""}`, 42).slice(0, 3);
    const nameLines = wrapPdfText(row.patientName || "-", 25).slice(0, 2);
    const lineCount = Math.max(practiceLines.length, nameLines.length, 1);
    const rowHeight = 9 + (lineCount - 1) * 8;
    if (y - rowHeight < 28) newPage();
    commands.push(pdfTextCommand(cols.ome, y, row.order || "-", 6.5));
    commands.push(pdfTextCommand(cols.benef, y, row.benefit || "-", 6.5));
    nameLines.forEach((line, i) => commands.push(pdfTextCommand(cols.nombre, y - i * 8, line, 6.5)));
    practiceLines.forEach((line, i) => commands.push(pdfTextCommand(cols.practica, y - i * 8, line, 6.5)));
    commands.push(pdfTextCommand(cols.turno, y, row.appointmentLabel || "-", 6.5));
    commands.push(pdfTextCommand(cols.estado, y, statusText, 6.5));
    commands.push(pdfTextCommand(cols.neto, y, pdfMoney(amount), 6.5, "F2"));
    y -= rowHeight + 4;
  }
  function newPage(withTableHeader = true) {
    if (commands.length) pageStreams.push(commands.join("\n"));
    commands = [];
    y = height - 30;
    commands.push(pdfTextCommand(margin, y, options.heading || "SALA MILLON - INFORME", 13, "F2"));
    commands.push(pdfTextCommand(610, y, `${options.totalLabel || "Total"}: ${pdfMoney(total)}`, 12, "F2"));
    y -= 16;
    commands.push(pdfTextCommand(margin, y, options.title || "Reporte", 8, "F1"));
    commands.push(pdfTextCommand(610, y, options.detailText || `Prestaciones: ${rows.length}`, 8, "F1"));
    y -= 18;
    if (withTableHeader) drawTableHeader();
  }
  newPage(!options.sections);
  sections.forEach((section, index) => {
    if (options.sections || section.title) {
      if (index > 0) y -= 10;
      if (y < 70) newPage(false);
      commands.push(pdfLineCommand(margin, y + 7, width - margin, y + 7));
      commands.push(pdfTextCommand(margin, y - 4, section.title || "Detalle", 9, "F2"));
      y -= 22;
      drawTableHeader();
    }
    if (!section.rows.length) {
      commands.push(pdfTextCommand(margin, y, section.emptyText || "Sin practicas para esta seccion.", 8, "F1"));
      y -= 14;
      return;
    }
    section.rows.forEach((row) => drawProfessionalRow(row, section.statusForRow(row), section.amountForRow(row)));
  });
  if (!rows.length && !options.sections) commands.push(pdfTextCommand(margin, y, options.emptyText || "No hay practicas para este reporte.", 9, "F1"));
  y -= 10;
  if (y < 45) newPage();
  commands.push(pdfLineCommand(margin, y, width - margin, y));
  y -= 14;
  commands.push(pdfTextCommand(margin, y, options.summaryText || `Resumen: prestaciones ${rows.length} - total ${pdfMoney(total)}`, 8, "F2"));
  pageStreams.push(commands.join("\n"));
  return buildPdfBuffer(pageStreams, width, height);
}
function buildProfessionalPdf(report, moduleCode) {
  const moduleLabel = professionalReportModules[String(moduleCode)] || `MODULO ${moduleCode}`;
  const rows = reportRows(report).filter((row) =>
    String(row.moduleCode || "") === String(moduleCode)
    && !row.outsideCutoff
    && !reportRowMissingInforme(row)
  );
  const summary = summarizeReportRows(rows);
  return buildRowsPdf({
    heading: `SALA MILLON - INFORME ${moduleLabel}`,
    title: report.title || "Reporte",
    rows,
    total: summary.net,
    totalLabel: "Total",
    detailText: `Prestaciones: ${rows.length} - Debitos: ${pdfMoney(summary.debit)}`,
    statusForRow: professionalReportStatus,
    amountForRow: reportRowNet,
    emptyText: "No hay practicas cobradas para este modulo en el reporte seleccionado.",
    summaryText: `Resumen: consultas ${summary.consultations || 0} - practicas ${summary.practices || 0} - bruto ${pdfMoney(summary.gross)} - debitos ${pdfMoney(summary.debit)} - neto ${pdfMoney(summary.net)}`,
  });
}
function buildSpecialReportPdf(report, section) {
  if (section === "cutoff") {
    const rows = reportRows(report).filter((row) => row.outsideCutoff);
    const total = rows.reduce((acc, row) => acc + reportRowNextPeriodCutoff(row), 0);
    return buildRowsPdf({
      heading: "SALA MILLON - PROXIMO PERIODO",
      title: report.title || "Reporte",
      rows,
      total,
      totalLabel: "A cobrar",
      detailText: `Para cobrar con el proximo periodo - Prestaciones: ${rows.length}`,
      statusForRow: () => "Proximo mes",
      amountForRow: reportRowNextPeriodCutoff,
      emptyText: "No hay practicas fuera de corte para el proximo periodo.",
      summaryText: `Resumen: prestaciones ${rows.length} - a cobrar proximo periodo ${pdfMoney(total)}`,
    });
  }
  const rows = reportRows(report).filter((row) => reportRowMissingInforme(row));
  const total = rows.reduce((acc, row) => acc + reportRowMissingInformeAmount(row), 0);
  return buildRowsPdf({
    heading: "SALA MILLON - FALTA INFORME",
    title: report.title || "Reporte",
    rows,
    total,
    totalLabel: "Valor recuperable",
    detailText: `Pendiente de informe / transmision - Prestaciones: ${rows.length}`,
    statusForRow: () => "A recuperar",
    amountForRow: reportRowMissingInformeAmount,
    emptyText: "No hay practicas con falta de informe.",
    summaryText: `Resumen: prestaciones ${rows.length} - valor recuperable ${pdfMoney(total)}`,
  });
}
function buildGeneralReportPdf(report) {
  const allRows = reportRows(report);
  const cardioRows = allRows.filter((row) => String(row.moduleCode || "") === "543" && !row.outsideCutoff && !reportRowMissingInforme(row));
  const traumatoRows = allRows.filter((row) => String(row.moduleCode || "") === "546" && !row.outsideCutoff && !reportRowMissingInforme(row));
  const cutoffRows = allRows.filter((row) => row.outsideCutoff);
  const missingInformeRows = allRows.filter((row) => reportRowMissingInforme(row));
  const cardioSummary = summarizeReportRows(cardioRows);
  const traumatoSummary = summarizeReportRows(traumatoRows);
  const cutoffTotal = cutoffRows.reduce((acc, row) => acc + reportRowNextPeriodCutoff(row), 0);
  const missingInformeTotal = missingInformeRows.reduce((acc, row) => acc + reportRowMissingInformeAmount(row), 0);
  const total = cardioSummary.net + traumatoSummary.net + cutoffTotal + missingInformeTotal;
  return buildRowsPdf({
    heading: "SALA MILLON - INFORME GENERAL",
    title: report.title || "Reporte",
    total,
    totalLabel: "Total general",
    detailText: `Cardio + traumato + proximo periodo + falta informe`,
    sections: [
      {
        title: `CARDIOLOGIA - ${pdfMoney(cardioSummary.net)}`,
        rows: cardioRows,
        statusForRow: professionalReportStatus,
        amountForRow: reportRowNet,
        emptyText: "Sin practicas cobradas de cardiologia.",
      },
      {
        title: `TRAUMATOLOGIA - ${pdfMoney(traumatoSummary.net)}`,
        rows: traumatoRows,
        statusForRow: professionalReportStatus,
        amountForRow: reportRowNet,
        emptyText: "Sin practicas cobradas de traumatologia.",
      },
      {
        title: `PROXIMO PERIODO - a cobrar - ${pdfMoney(cutoffTotal)}`,
        rows: cutoffRows,
        statusForRow: () => "Proximo mes",
        amountForRow: reportRowNextPeriodCutoff,
        emptyText: "Sin practicas fuera de corte para el proximo periodo.",
      },
      {
        title: `FALTA INFORME NO COBRADO - valor recuperable - ${pdfMoney(missingInformeTotal)}`,
        rows: missingInformeRows,
        statusForRow: () => "A recuperar",
        amountForRow: reportRowMissingInformeAmount,
        emptyText: "Sin practicas con falta de informe.",
      },
    ],
    summaryText: `Resumen: cardio ${pdfMoney(cardioSummary.net)} - traumato ${pdfMoney(traumatoSummary.net)} - proximo periodo ${pdfMoney(cutoffTotal)} - falta informe ${pdfMoney(missingInformeTotal)} - total ${pdfMoney(total)}`,
  });
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

  if (p === "/api/clientes" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador puede crear clientes." });
    const body = await readBody(req);
    const name = String(body.name || "").replace(/\s+/g, " ").trim();
    const businessName = String(body.businessName || "").replace(/\s+/g, " ").trim();
    const cuit = normalizeCuit(body.cuit);
    const ugl = String(body.ugl || "").replace(/\s+/g, " ").trim();
    const sap = String(body.sap || "").replace(/\s+/g, " ").trim();
    const slug = clientSlugFromName(name);
    const modules = normalizeClientModules(body.activeModules);
    if (!name) return json(res, 400, { error: "Ingresa el nombre del cliente." });
    if (!businessName) return json(res, 400, { error: "Ingresa la razon social." });
    if (!validCuit(cuit)) return json(res, 400, { error: "Ingresa un CUIT valido." });
    if (!slug) return json(res, 400, { error: "El nombre no permite generar un slug valido." });
    if (!modules.length) return json(res, 400, { error: "Selecciona al menos un modulo activo." });
    const clients = loadClientsStore();
    if (clients.some((client) => client.slug === slug)) return json(res, 409, { error: "Ya existe un cliente con ese nombre." });
    const client = normalizeClient({ slug, name, businessName, cuit, ugl, sap, status: "Activo", activeModules: modules });
    clients.push(client);
    saveClientsStore(clients);
    return json(res, 201, { client, clients });
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

  // Editar datos básicos del cliente (no cambia el slug, para no romper referencias).
  const clientEditMatch = p.match(/^\/api\/clientes\/([^/]+)$/);
  if (clientEditMatch && req.method === "PATCH") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador puede modificar clientes." });
    const slug = decodeURIComponent(clientEditMatch[1]);
    const clients = loadClientsStore();
    const idx = clients.findIndex((client) => client.slug === slug);
    if (idx < 0) return json(res, 404, { error: "Cliente no encontrado." });
    const body = await readBody(req);
    const name = String(body.name || "").replace(/\s+/g, " ").trim();
    const businessName = String(body.businessName || "").replace(/\s+/g, " ").trim();
    const cuit = normalizeCuit(body.cuit);
    if (!name) return json(res, 400, { error: "Ingresá el nombre del cliente." });
    if (!businessName) return json(res, 400, { error: "Ingresá la razón social." });
    if (!validCuit(cuit)) return json(res, 400, { error: "Ingresá un CUIT válido." });
    clients[idx] = normalizeClient({
      slug: clients[idx].slug,
      name, businessName, cuit,
      ugl: String(body.ugl || "").replace(/\s+/g, " ").trim(),
      sap: String(body.sap || "").replace(/\s+/g, " ").trim(),
      status: clients[idx].status,
      activeModules: clients[idx].activeModules,
    });
    saveClientsStore(clients);
    return json(res, 200, { client: clients[idx], clients });
  }
  // Eliminar cliente. Los que vienen por código dejan un tombstone en el volumen.
  if (clientEditMatch && req.method === "DELETE") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador puede eliminar clientes." });
    const slug = decodeURIComponent(clientEditMatch[1]);
    if (!loadClientsStore().some((c) => c.slug === slug)) return json(res, 404, { error: "Cliente no encontrado." });
    let raw = loadClientOverrides().filter((c) => String(c.slug) !== slug);
    if (DEFAULT_CLIENT_SLUGS.has(slug)) raw.push({ slug, status: "deleted" });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(clientesFile, JSON.stringify(raw, null, 2));
    return json(res, 200, { ok: true, clients: loadClientsStore() });
  }

  const clientDashboardMatch = p.match(/^\/api\/clientes\/([^/]+)\/dashboard$/);
  if (clientDashboardMatch && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientDashboardMatch[1]);
    const client = loadClientsStore().find((item) => item.slug === slug);
    if (!client) return json(res, 404, { error: "Cliente no encontrado." });
    return json(res, 200, buildClientDashboard(slug, url.searchParams.get("period"), url.searchParams.get("compare")));
  }

  // Acceso PAMI del cliente (usuario + clave encriptada) — solo admin.
  // La app lee la clave desencriptada por /pami/credenciales para loguearse.
  const clientPamiCredMatch = p.match(/^\/api\/clientes\/([^/]+)\/pami\/credenciales$/);
  if (clientPamiCredMatch && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "forbidden" });
    const slug = decodeURIComponent(clientPamiCredMatch[1]);
    const cred = loadClientCreds()[slug] || {};
    return json(res, 200, { pamiUser: cred.pamiUser || "", pamiPassword: decryptSecret(cred.pamiPassEnc) });
  }

  const clientPamiMatch = p.match(/^\/api\/clientes\/([^/]+)\/pami$/);
  if (clientPamiMatch && (req.method === "GET" || req.method === "POST")) {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador puede ver o cambiar el acceso PAMI." });
    const slug = decodeURIComponent(clientPamiMatch[1]);
    const client = loadClientsStore().find((item) => item.slug === slug);
    if (!client) return json(res, 404, { error: "Cliente no encontrado." });
    const store = loadClientCreds();
    if (req.method === "GET") {
      const cred = store[slug] || {};
      return json(res, 200, { pamiUser: cred.pamiUser || "", hasPassword: !!cred.pamiPassEnc });
    }
    const body = await readBody(req);
    const pamiUser = String(body.pamiUser || "").trim();
    const pamiPassword = body.pamiPassword;
    const cred = store[slug] || {};
    cred.pamiUser = pamiUser;
    // Solo se re-encripta si mandaron una clave nueva; vacio = se deja la que estaba.
    if (typeof pamiPassword === "string" && pamiPassword.length) cred.pamiPassEnc = encryptSecret(pamiPassword);
    if (!pamiUser && !cred.pamiPassEnc) delete store[slug];
    else store[slug] = cred;
    saveClientCreds(store);
    return json(res, 200, { ok: true, pamiUser, hasPassword: !!(store[slug] && store[slug].pamiPassEnc) });
  }

  // Bandeja del mes (la sube la app; la lee el panel "Dashboard mes en curso").
  const clientBandejaMatch = p.match(/^\/api\/clientes\/([^/]+)\/bandeja$/);
  if (clientBandejaMatch && (req.method === "GET" || req.method === "POST")) {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientBandejaMatch[1]);
    const client = loadClientsStore().find((item) => item.slug === slug);
    if (!client) return json(res, 404, { error: "Cliente no encontrado." });
    const store = loadClientBandejas();
    if (req.method === "GET") {
      const bodyStr = JSON.stringify({ bandeja: store[slug] || null });
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(bodyStr),
        "cache-control": "no-store",
      });
      res.end(bodyStr);
      return;
    }
    // POST: la app sube la bandeja parseada. Puede ser grande -> readBuffer.
    let body = {};
    try { body = JSON.parse((await readBuffer(req)).toString("utf8") || "{}"); } catch {}
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 20000) : [];
    const columns = Array.isArray(body.columns) && body.columns.length
      ? body.columns.map(String)
      : (rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]) : []);
    store[slug] = {
      month: String(body.month || "").trim(),
      monthLabel: String(body.monthLabel || "").trim(),
      generatedAt: String(body.generatedAt || "").trim(),
      uploadedAt: new Date().toISOString(),
      uploadedBy: me.username,
      count: rows.length,
      columns,
      rows,
    };
    saveClientBandejas(store);
    return json(res, 200, { ok: true, count: rows.length });
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
  const clientReportDownloadMatch = p.match(/^\/api\/clientes\/([^/]+)\/reportes\/([^/]+)\/download$/);
  if (clientReportDownloadMatch && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientReportDownloadMatch[1]);
    const id = decodeURIComponent(clientReportDownloadMatch[2]);
    const report = (loadClientReportsStore().items || []).find((item) => item.clientSlug === slug && item.id === id);
    if (!report) return json(res, 404, { error: "Reporte no encontrado." });
    const buffer = buildClientReportWorkbook(report);
    const filename = `${downloadName(report.title || report.sourceFilename || report.id)}.xlsx`;
    res.writeHead(200, {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    });
    return res.end(buffer);
  }

  const clientProfessionalReportMatch = p.match(/^\/api\/clientes\/([^/]+)\/reportes\/([^/]+)\/professional-pdf\/([^/]+)$/);
  if (clientProfessionalReportMatch && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientProfessionalReportMatch[1]);
    const id = decodeURIComponent(clientProfessionalReportMatch[2]);
    const moduleCode = decodeURIComponent(clientProfessionalReportMatch[3]);
    const moduleLabel = professionalReportModules[String(moduleCode)];
    if (!moduleLabel) return json(res, 400, { error: "Modulo sin informe profesional configurado." });
    const report = (loadClientReportsStore().items || []).find((item) => item.clientSlug === slug && item.id === id);
    if (!report) return json(res, 404, { error: "Reporte no encontrado." });
    const buffer = buildProfessionalPdf(report, moduleCode);
    const filename = `${downloadName(report.title || report.sourceFilename || report.id)}-${downloadName(moduleLabel)}.pdf`;
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    });
    return res.end(buffer);
  }

  const clientSpecialPdfMatch = p.match(/^\/api\/clientes\/([^/]+)\/reportes\/([^/]+)\/special-pdf\/([^/]+)$/);
  if (clientSpecialPdfMatch && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientSpecialPdfMatch[1]);
    const id = decodeURIComponent(clientSpecialPdfMatch[2]);
    const section = decodeURIComponent(clientSpecialPdfMatch[3]);
    const sectionConfig = reportSpecialPdfSections[section];
    if (!sectionConfig) return json(res, 400, { error: "Informe PDF no configurado." });
    const report = (loadClientReportsStore().items || []).find((item) => item.clientSlug === slug && item.id === id);
    if (!report) return json(res, 404, { error: "Reporte no encontrado." });
    const buffer = buildSpecialReportPdf(report, section);
    const filename = `${downloadName(report.title || report.sourceFilename || report.id)}-${downloadName(sectionConfig.filename)}.pdf`;
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    });
    return res.end(buffer);
  }

  const clientGeneralPdfMatch = p.match(/^\/api\/clientes\/([^/]+)\/reportes\/([^/]+)\/general-pdf$/);
  if (clientGeneralPdfMatch && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientGeneralPdfMatch[1]);
    const id = decodeURIComponent(clientGeneralPdfMatch[2]);
    const report = (loadClientReportsStore().items || []).find((item) => item.clientSlug === slug && item.id === id);
    if (!report) return json(res, 404, { error: "Reporte no encontrado." });
    const buffer = buildGeneralReportPdf(report);
    const filename = `${downloadName(report.title || report.sourceFilename || report.id)}-GENERAL.pdf`;
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    });
    return res.end(buffer);
  }

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
    return json(res, 200, { report: { ...report, rows: reportRows(report), summary: summarizeReportRows(reportRows(report)) } });
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

  // Export del nomenclador YA FILTRADO por los módulos activos del cliente
  // (la vista resumida que se ve en la web), en Excel o PDF para el cliente.
  const nomClientExport = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/nomenclador\/export$/);
  if (nomClientExport && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const client = loadClientsStore().find((c) => c.slug === nomClientExport[1]);
    if (!client) return json(res, 404, { error: "Cliente no encontrado." });
    const store = loadNomencladorStore();
    const payload = getNomencladorByPeriod(store, url.searchParams.get("period"));
    if (!payload) return json(res, 404, { error: "Todavia no hay nomenclador cargado." });
    const moduleCodes = new Set((client.activeModules || []).map((m) => String(m.code)));
    const query = normalizeText(url.searchParams.get("q") || "");
    let rows = payload.rows || [];
    if (moduleCodes.size) rows = rows.filter((r) => moduleCodes.has(String(r.moduleCode || r.moduleDescription)));
    if (query) rows = rows.filter((r) => r.search.includes(query));
    rows = rows.map(({ search, ...row }) => row);
    const label = payload.label || periodLabel(payload.period);
    const format = String(url.searchParams.get("format") || "xlsx").toLowerCase();
    const base = downloadName("Nomenclador " + client.name + " " + label) || "nomenclador";
    try {
      if (format === "pdf") {
        const bytes = await nomExport.buildPdf(client, label, rows);
        const buf = Buffer.from(bytes);
        res.writeHead(200, {
          "content-type": "application/pdf",
          "content-length": buf.length,
          "content-disposition": `attachment; filename="${base}.pdf"`,
          "cache-control": "no-store",
        });
        return res.end(buf);
      }
      const buf = nomExport.buildXlsx(client, label, rows);
      res.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-length": buf.length,
        "content-disposition": `attachment; filename="${base}.xlsx"`,
        "cache-control": "no-store",
      });
      return res.end(buf);
    } catch (error) {
      console.log("[nom-export] error:", error && error.message);
      return json(res, 500, { error: "No se pudo generar el archivo." });
    }
  }

  // Aumento de un nomenclador vs el mes anterior (general, consultas, nivel 1).
  if (p === "/api/nomencladores/comparar" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const store = loadNomencladorStore();
    const current = getNomencladorByPeriod(store, url.searchParams.get("period"));
    if (!current) return json(res, 404, { error: "Todavia no hay nomenclador cargado." });
    // "against" = comparar contra un mes concreto (ej. el mes que se compara en
    // el dashboard); si no viene, se usa el mes anterior adyacente.
    const againstParam = normalizePeriod(url.searchParams.get("against")) || String(url.searchParams.get("against") || "").trim();
    let prevPeriod = "";
    let previous = null;
    if (againstParam && store.items[againstParam] && againstParam !== current.period) {
      prevPeriod = againstParam;
      previous = store.items[againstParam];
    } else {
      const periodsAsc = Object.keys(store.items || {}).sort();
      const idx = periodsAsc.indexOf(current.period);
      prevPeriod = idx > 0 ? periodsAsc[idx - 1] : "";
      previous = prevPeriod ? store.items[prevPeriod] : null;
    }
    if (!previous) {
      return json(res, 200, { hasPrevious: false, period: current.period, label: current.label || periodLabel(current.period) });
    }
    return json(res, 200, Object.assign({
      hasPrevious: true,
      period: current.period,
      label: current.label || periodLabel(current.period),
      previousPeriod: prevPeriod,
      previousLabel: previous.label || periodLabel(prevPeriod),
    }, computeNomencladorDelta(previous, current)));
  }

  // Variaciones entre cada par de meses consecutivos (para las banderas de la tendencia).
  if (p === "/api/nomencladores/variaciones" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const store = loadNomencladorStore();
    const periods = Object.keys(store.items || {}).sort();
    const variaciones = [];
    for (let i = 1; i < periods.length; i += 1) {
      const d = computeNomencladorDelta(store.items[periods[i - 1]], store.items[periods[i]]);
      variaciones.push({
        from: periods[i - 1],
        to: periods[i],
        general: d.general.avgPct,
        consultas: d.consultas.avgPct,
        nivel1: d.nivel1.avgPct,
      });
    }
    return json(res, 200, { variaciones });
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

  // ---- Informes: generar PDF de un paciente ----
  if (p === "/api/informes/generar" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const body = await readBody(req);
    const modelo = String(body.modelo || "caballito-consulta-570129");
    if (!informes.MODELOS[modelo]) return json(res, 400, { error: "No se encontró la plantilla del modelo seleccionado." });
    const pac = body.paciente || {};
    const faltan = [];
    if (!String(pac.nombre || "").trim()) faltan.push("el nombre");
    if (!String(pac.benef || "").trim()) faltan.push("el N° de beneficiario");
    if (!String(pac.fecha || "").trim()) faltan.push("la fecha");
    if (faltan.length) return json(res, 400, { error: "Falta completar " + faltan.join(", ") + "." });
    try {
      const cfg = loadInformesConfig();
      const medico = (cfg.medicos || []).find((m) => m.id === body.medicoId);
      const bytes = await informes.buildInformePdf(modelo, {
        paciente: body.paciente || {},
        textoInforme: body.textoInforme,
        solicitante: body.solicitante,
        valores: sanitizarValores(body.valores),
        firmaArchivo: medico ? medico.firma : "",
      });
      const filename = informes.informeFilename(modelo, body.paciente || {});
      const buf = Buffer.from(bytes);
      res.writeHead(200, {
        "content-type": "application/pdf",
        "content-length": buf.length,
        "content-disposition": `attachment; filename="${filename.replace(/[^\x20-\x7E]/g, "_")}"`,
        "cache-control": "no-store",
      });
      res.end(buf);
      return;
    } catch (error) {
      console.log("[informes] error:", error && error.message);
      const falta = error && error.code === "MODULE_NOT_FOUND" && /pdf-lib/.test(String(error.message));
      return json(res, 500, {
        error: falta
          ? "Falta instalar pdf-lib en el servidor. Hacé un Redeploy (build limpio) en Railway."
          : "Error al generar el PDF del informe.",
      });
    }
  }

  // Lote: genera 1 PDF por paciente y devuelve un ZIP. Cada item viene resuelto
  // desde el front (modelo, paciente, textoInforme final, medicoId, valores).
  if (p === "/api/informes/lote" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return json(res, 400, { error: "No hay pacientes para generar." });
    if (items.length > 200) return json(res, 400, { error: "Demasiados informes en un lote (máx 200)." });
    try {
      const cfg = loadInformesConfig();
      const archivos = [];
      const usados = {};
      for (const it of items) {
        const modelo = String(it.modelo || "");
        if (!informes.MODELOS[modelo]) continue;
        const pac = it.paciente || {};
        if (!String(pac.nombre || "").trim() || !String(pac.fecha || "").trim()) continue;
        const medico = (cfg.medicos || []).find((m) => m.id === it.medicoId);
        const bytes = await informes.buildInformePdf(modelo, {
          paciente: pac,
          textoInforme: it.textoInforme,
          solicitante: it.solicitante,
          valores: sanitizarValores(it.valores),
          firmaArchivo: medico ? medico.firma : "",
        });
        let nombre = informes.informeFilename(modelo, pac).replace(/[\\/:*?"<>|]+/g, " ");
        if (usados[nombre]) { const n = ++usados[nombre]; nombre = nombre.replace(/\.pdf$/i, "") + " (" + n + ").pdf"; }
        else usados[nombre] = 1;
        archivos.push({ name: nombre, data: Buffer.from(bytes) });
      }
      if (!archivos.length) return json(res, 400, { error: "Ningún paciente tenía plantilla y datos válidos para generar." });
      const zbuf = zipMin.zip(archivos);
      res.writeHead(200, {
        "content-type": "application/zip",
        "content-length": zbuf.length,
        "content-disposition": 'attachment; filename="Informes_lote.zip"',
        "cache-control": "no-store",
      });
      res.end(zbuf);
      return;
    } catch (error) {
      console.log("[informes-lote] error:", error && error.message);
      const falta = error && error.code === "MODULE_NOT_FOUND" && /pdf-lib/.test(String(error.message));
      return json(res, 500, { error: falta ? "Falta pdf-lib en el servidor. Redeploy en Railway." : "Error al generar el lote." });
    }
  }

  // ---- Informes: config (médicos con firma + descripciones) ----
  if (p === "/api/informes/config" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const cfg = loadInformesConfig();
    return json(res, 200, {
      modelos: informes.listarModelos(),
      medicos: (cfg.medicos || []).map((m) => ({
        id: m.id, nombre: m.nombre, hasFirma: firmaExiste(m.firma), modelos: m.modelos || [],
      })),
      descripciones: (cfg.descripciones || []).map((d) => ({
        id: d.id, nombre: d.nombre || "", texto: d.texto, modelos: d.modelos || [], valores: d.valores || {}, ladoTextos: d.ladoTextos || {},
      })),
    });
  }
  // Diagnóstico (admin): confirma si la config vive en el volumen persistente
  // y qué scope hay guardado. Sirve para descartar "se borra en cada deploy".
  if (p === "/api/informes/_diag" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const cfg = loadInformesConfig();
    let existe = false, tam = 0;
    try { const st = fs.statSync(informesConfigFile); existe = true; tam = st.size; } catch {}
    return json(res, 200, {
      usaVolumenPersistente: !!process.env.RAILWAY_VOLUME_MOUNT_PATH,
      dataDir,
      configArchivo: informesConfigFile,
      configExiste: existe,
      configTamBytes: tam,
      modelosValidos: informes.listarModelos().map((m) => m.key),
      medicos: (cfg.medicos || []).map((m) => ({ id: m.id, modelos: m.modelos || [] })),
      resultados: (cfg.descripciones || []).map((d) => ({ id: d.id, modelos: d.modelos || [] })),
    });
  }
  if (p === "/api/informes/medicos" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const { nombre } = await readBody(req);
    const nm = String(nombre || "").trim();
    if (!nm) return json(res, 400, { error: "Escribí el nombre del médico." });
    const cfg = loadInformesConfig();
    let id = slugId(nm) || ("m" + Object.keys(cfg.medicos).length);
    while (cfg.medicos.some((m) => m.id === id)) id += "-1";
    cfg.medicos.push({ id, nombre: nm, firma: "firma-" + id + ".png", modelos: [] });
    saveInformesConfig(cfg);
    return json(res, 201, { ok: true, id });
  }
  // Asignar informes (modelos) a un médico (si queda vacío = disponible para todos).
  const medScopeMatch = p.match(/^\/api\/informes\/medicos\/([a-z0-9-]+)\/scope$/);
  if (medScopeMatch && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const body = await readBody(req);
    const modelosOK = new Set(informes.listarModelos().map((m) => m.key));
    const cfg = loadInformesConfig();
    const medico = cfg.medicos.find((m) => m.id === medScopeMatch[1]);
    if (!medico) return json(res, 404, { error: "Médico no encontrado." });
    medico.modelos = (Array.isArray(body.modelos) ? body.modelos : []).map(String).filter((k) => modelosOK.has(k));
    saveInformesConfig(cfg);
    return json(res, 200, { ok: true });
  }
  const medFirmaMatch = p.match(/^\/api\/informes\/medicos\/([a-z0-9-]+)\/firma$/);
  if (medFirmaMatch && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const cfg = loadInformesConfig();
    const medico = cfg.medicos.find((m) => m.id === medFirmaMatch[1]);
    if (!medico) return json(res, 404, { error: "Médico no encontrado." });
    try {
      const raw = await readBuffer(req);
      const mp = extractMultipart(raw, req.headers["content-type"]);
      if (path.extname(mp.file.filename).toLowerCase() !== ".png") {
        return json(res, 400, { error: "La firma tiene que ser un PNG (mejor con fondo transparente)." });
      }
      const nombreArchivo = medico.firma || ("firma-" + medico.id + ".png");
      const dir = path.join(dataDir, "informes");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, nombreArchivo), mp.file.data);
      medico.firma = nombreArchivo;
      saveInformesConfig(cfg);
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message || "No se pudo subir la firma." });
    }
  }
  const medDelMatch = p.match(/^\/api\/informes\/medicos\/([a-z0-9-]+)$/);
  if (medDelMatch && req.method === "DELETE") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const cfg = loadInformesConfig();
    cfg.medicos = cfg.medicos.filter((m) => m.id !== medDelMatch[1]);
    saveInformesConfig(cfg);
    return json(res, 200, { ok: true });
  }
  if (p === "/api/informes/descripciones" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const body = await readBody(req);
    const tx = String(body.texto || "").replace(/\s+/g, " ").trim();
    if (!tx) return json(res, 400, { error: "Escribí el texto del resultado." });
    const cfg = loadInformesConfig();
    let id = slugId(tx) || ("d" + cfg.descripciones.length);
    while (cfg.descripciones.some((d) => d.id === id)) id += "-1";
    const nombre = String(body.nombre || "").replace(/\s+/g, " ").trim().slice(0, 60);
    cfg.descripciones.push({ id, nombre, texto: tx, modelos: [], valores: sanitizarValores(body.valores) });
    saveInformesConfig(cfg);
    return json(res, 201, { ok: true, id });
  }
  // Editar un resultado: texto y/o valores estándar (Holter). No toca el scope.
  const descEditMatch = p.match(/^\/api\/informes\/descripciones\/([a-z0-9-]+)$/);
  if (descEditMatch && req.method === "PUT") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const body = await readBody(req);
    const cfg = loadInformesConfig();
    const desc = cfg.descripciones.find((d) => d.id === descEditMatch[1]);
    if (!desc) return json(res, 404, { error: "Resultado no encontrado." });
    if (typeof body.texto === "string") {
      const tx = body.texto.replace(/\s+/g, " ").trim();
      if (tx) desc.texto = tx;
    }
    if (typeof body.nombre === "string") desc.nombre = body.nombre.replace(/\s+/g, " ").trim().slice(0, 60);
    if (body.valores && typeof body.valores === "object") desc.valores = sanitizarValores(body.valores);
    saveInformesConfig(cfg);
    return json(res, 200, { ok: true });
  }
  // Asignar informes (modelos) a un resultado (vacío = disponible para todos).
  const descScopeMatch = p.match(/^\/api\/informes\/descripciones\/([a-z0-9-]+)\/scope$/);
  if (descScopeMatch && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const body = await readBody(req);
    const modelosOK = new Set(informes.listarModelos().map((m) => m.key));
    const cfg = loadInformesConfig();
    const desc = cfg.descripciones.find((d) => d.id === descScopeMatch[1]);
    if (!desc) return json(res, 404, { error: "Resultado no encontrado." });
    desc.modelos = (Array.isArray(body.modelos) ? body.modelos : []).map(String).filter((k) => modelosOK.has(k));
    saveInformesConfig(cfg);
    return json(res, 200, { ok: true });
  }
  const descDelMatch = p.match(/^\/api\/informes\/descripciones\/([a-z0-9-]+)$/);
  if (descDelMatch && req.method === "DELETE") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const cfg = loadInformesConfig();
    cfg.descripciones = cfg.descripciones.filter((d) => d.id !== descDelMatch[1]);
    saveInformesConfig(cfg);
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
  // index.html: inyectamos la versión de assets para bustear cachés viejos.
  if (cleanPath === "/index.html") {
    fs.readFile(resolved, "utf8", (error, html) => {
      if (error) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("No encontrado"); return; }
      html = html
        .replace('href="/styles.css"', 'href="/styles.css?v=' + ASSET_VER + '"')
        .replace('src="/app.js"', 'src="/app.js?v=' + ASSET_VER + '"');
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
    });
    return;
  }
  sendFile(res, resolved);
});

// Migración suave: deja el Holter de Caballito listo para usar aunque la config
// ya exista (producción). Idempotente: solo actúa si el Holter no tiene resultados.
function ensureHolterSeed() {
  try {
    const cfg = loadInformesConfig();
    if (!Array.isArray(cfg.descripciones) || !Array.isArray(cfg.medicos)) return;
    let cambio = false;
    // Precargar el preset "Normal" de cada Holter si ese modelo no tiene resultados.
    for (const s of HOLTER_SEED_PRESETS) {
      if (!cfg.descripciones.some((d) => (d.modelos || []).includes(s.modelo))) {
        cfg.descripciones.push({ id: s.id, nombre: s.nombre, texto: s.texto, modelos: [s.modelo], valores: s.valores });
        cambio = true;
      }
    }
    // El/los médicos que ya firman electro de Caballito, que también firmen el Holter.
    // (CIMA queda sin firma a propósito, no se asigna médico.)
    for (const m of cfg.medicos) {
      if (Array.isArray(m.modelos) && m.modelos.includes("caballito-electro") && !m.modelos.includes("caballito-holter")) {
        m.modelos.push("caballito-holter");
        cambio = true;
      }
    }
    if (cambio) saveInformesConfig(cfg);
  } catch (e) { console.log("[holter-seed] omitido:", e && e.message); }
}
ensureHolterSeed();

// Precarga los presets ORL en configs ya existentes (idempotente: solo agrega
// el preset de una práctica ORL si esa práctica todavía no tiene resultados).
function ensureOrlSeed() {
  try {
    const cfg = loadInformesConfig();
    if (!Array.isArray(cfg.descripciones)) return;
    let cambio = false;
    for (const s of ORL_SEED_PRESETS) {
      // Por id (no por modelo): un modelo puede tener varios presets (ej. SIBO).
      if (!cfg.descripciones.some((d) => d.id === s.id)) {
        cfg.descripciones.push({ id: s.id, nombre: s.nombre, texto: s.texto, modelos: [s.modelo], ladoTextos: s.ladoTextos || {}, valores: s.valores || {} });
        cambio = true;
      }
    }
    // Las dos otorrinos de Caballito, ya con sus prácticas ORL asignadas.
    // Quedan "sin firma" hasta que el admin suba el PNG (no va en el repo público).
    const orlCaballito = ["caballito-orl-cerumen", "caballito-orl-quimico", "caballito-orl-combinado", "caballito-orl-videorino"];
    const orlMedicos = [
      { id: "lopez-meza-yuliana", nombre: "Dra. Lopez Meza Yuliana", modelos: orlCaballito },
      { id: "carchiolo-glenda", nombre: "Dra. Glenda Carchiolo", modelos: orlCaballito },
      { id: "lagrava-luis-fernando", nombre: "Dr. Luis Fernando Lagrava", modelos: ["cima-orl-videorino"] },
      { id: "ossipoff-florencia", nombre: "Dra. Florencia Ossipoff", modelos: ["caballito-derma-crio"] },
    ];
    if (Array.isArray(cfg.medicos)) {
      for (const m of orlMedicos) {
        if (!cfg.medicos.some((x) => x.id === m.id)) {
          cfg.medicos.push({ id: m.id, nombre: m.nombre, firma: "firma-" + m.id + ".png", modelos: m.modelos.slice() });
          cambio = true;
        }
      }
    }
    if (cambio) saveInformesConfig(cfg);
  } catch (e) { console.log("[orl-seed] omitido:", e && e.message); }
}
ensureOrlSeed();

// Rellena el nombre corto en presets ya existentes (configs previas al cambio).
function ensureNombresPresets() {
  try {
    const cfg = loadInformesConfig();
    if (!Array.isArray(cfg.descripciones)) return;
    const nombres = { normal: "ECG normal", "ritmo-sinusal": "Ritmo sinusal" };
    for (const s of HOLTER_SEED_PRESETS) nombres[s.id] = s.nombre;
    for (const s of ORL_SEED_PRESETS) nombres[s.id] = s.nombre;
    // Valores por preset (para rellenar claves faltantes en configs existentes).
    const valsSeed = {};
    for (const s of [...HOLTER_SEED_PRESETS, ...ORL_SEED_PRESETS]) if (s.valores) valsSeed[s.id] = s.valores;
    let cambio = false;
    for (const d of cfg.descripciones) {
      if (!d.nombre && nombres[d.id]) { d.nombre = nombres[d.id]; cambio = true; }
      const sv = valsSeed[d.id];
      if (sv) {
        d.valores = d.valores || {};
        // Solo rellena lo que falta: no pisa valores ya cargados/editados.
        for (const k of Object.keys(sv)) {
          if (d.valores[k] == null || String(d.valores[k]).trim() === "") { d.valores[k] = sv[k]; cambio = true; }
        }
      }
    }
    if (cambio) saveInformesConfig(cfg);
  } catch (e) { console.log("[nombres-seed] omitido:", e && e.message); }
}
ensureNombresPresets();

server.listen(port, "0.0.0.0", () => {
  console.log(`NS Web escuchando en puerto ${port} | datos en ${dataDir}`);
});
