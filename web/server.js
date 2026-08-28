const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const XLSX = require("xlsx");
const XLSXStyle = require("xlsx-js-style"); // solo para el Excel con estilo del reporte
const informes = require("./informes");
const padronLib = require("./padron");
const cabinaLib = require("./informes_cabina");
const informeMatch = require("./informes_match");
// El motor de extracción usa libs (pdf-parse/mammoth/word-extractor; OCR en diferido
// con mupdf+tesseract). Se carga GUARDADO: si una dependencia falla al instalar en
// Railway, el server igual arranca y solo queda deshabilitada la cabina de informes.
let informeExtract = null;
try { informeExtract = require("./informe_extract"); }
catch (e) { console.warn("[informes] motor de extracción no disponible:", e && e.message); }
let gmailInformes = null;
try { gmailInformes = require("./gmail_informes"); }
catch (e) { console.warn("[informes] descarga de Gmail no disponible:", e && e.message); }
const nomExport = require("./nomenclador_export");
const comparativaExport = require("./comparativa_export");
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
// Usuarios médicos por cliente consultorio (para generar OME de especialista más
// adelante). La clave va encriptada, igual que las claves PAMI del cliente.
const clientMedicosFile = path.join(dataDir, "client_medicos.json");
// Facturación por cliente (panel Administración → Facturas): % de comisión y nº
// de socios por cliente, más los registros de facturas cargadas por período.
const facturasFile = path.join(dataDir, "facturas.json");
// Gastos fijos de NS (panel Administración → Gastos).
const gastosFile = path.join(dataDir, "gastos.json");
// Honorarios: cuánto le paga el centro a los médicos por cada código de práctica.
// { [slug]: { [practiceCode]: { tipo: "monto"|"pct", valor: number } } }
const honorariosFile = path.join(dataDir, "honorarios.json");
function loadHonorarios() { try { const j = JSON.parse(fs.readFileSync(honorariosFile, "utf8")); return j && typeof j === "object" ? j : {}; } catch { return {}; } }
function saveHonorarios(store) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(honorariosFile, JSON.stringify(store, null, 2)); }
const clientBandejasFile = path.join(dataDir, "client_bandejas.json");
// Bandeja "hacia adelante" (turnos futuros del mes: mañana → fin de mes), para
// detectar posibles débitos por adelantado. Separada de la del mes en curso.
const clientBandejasAdelanteFile = path.join(dataDir, "client_bandejas_adelante.json");
const clientBandejaEstadoFile = path.join(dataDir, "client_bandeja_estado.json");
// Pedido de refresco on-demand desde la web (la PC lo sondea y corre la bajada).
const bandejaRefrescoFile = path.join(dataDir, "bandeja_refresco.json");
function loadBandejaRefresco() {
  try { const j = JSON.parse(fs.readFileSync(bandejaRefrescoFile, "utf8")); return (j && typeof j === "object") ? j : {}; }
  catch { return {}; }
}
function saveBandejaRefresco(o) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(bandejaRefrescoFile, JSON.stringify(o || {}, null, 2));
}
const clientPracticeValuesFile = path.join(dataDir, "client_practice_values.json");
const pamiExclusionPairsFile = path.join(__dirname, "pami_exclusion_pairs.json");
const workerStateFile = path.join(dataDir, "worker_state.json");
const workerTokenFile = path.join(dataDir, "worker_api_token");

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
function loadClientMedicos() {
  try { const parsed = JSON.parse(fs.readFileSync(clientMedicosFile, "utf8")); return parsed && typeof parsed === "object" ? parsed : {}; }
  catch { return {}; }
}
function saveClientMedicos(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(clientMedicosFile, JSON.stringify(store, null, 2));
}
// Vista pública de un médico (sin la clave; solo si tiene una guardada).
function medicoPublico(m) {
  return { id: m.id, nombre: m.nombre || "", especialidad: m.especialidad || "", usuario: m.usuario || "", telefono: m.telefono || "", tieneClave: !!m.claveEnc };
}
function loadFacturas() {
  try {
    const j = JSON.parse(fs.readFileSync(facturasFile, "utf8"));
    const registros = Array.isArray(j.registros) ? j.registros : [];
    // Lista ordenada de períodos. Migra formatos viejos (periodo string / periodos
    // objeto) y suma cualquier período que aparezca en los registros.
    let periodos = Array.isArray(j.periodos) ? j.periodos.filter(Boolean).map(String) : [];
    if (!periodos.length && j.periodo) periodos = [String(j.periodo)];
    if (!periodos.length && j.periodos && typeof j.periodos === "object") periodos = Object.values(j.periodos).filter(Boolean).map(String);
    const archivados = Array.isArray(j.archivados) ? j.archivados.filter(Boolean).map(String) : [];
    for (const r of registros) { if (r.periodo && periodos.indexOf(r.periodo) < 0 && archivados.indexOf(r.periodo) < 0) periodos.push(r.periodo); }
    // Mínimo no imponible mensual de Ganancias (se resta antes del 2%).
    const minimoGanancias = j.minimoGanancias != null ? Number(j.minimoGanancias) : 67170;
    return { config: j.config || {}, registros, periodos, archivados, minimoGanancias };
  } catch { return { config: {}, registros: [], periodos: [], archivados: [], minimoGanancias: 67170 }; }
}
function saveFacturas(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(facturasFile, JSON.stringify(store, null, 2));
}
// Ingreso de NS (Nacho+Seba) de las facturas con fecha de cobro en un mes (YYYY-MM).
// Devuelve el ingreso de cada socio y el detalle por cliente.
function ingresoNSDelMes(fstore, mes, nombreCliente) {
  let ingresoNacho = 0, ingresoSeba = 0, facturasContadas = 0;
  const detalle = [];
  for (const r of fstore.registros) {
    if (!r.fechaCobro || String(r.fechaCobro).slice(0, 7) !== mes) continue;
    const cfg = facturaConfigCliente(fstore, r.slug);
    const total = (r.items || []).reduce((a, it) => a + (Number(it.monto) || 0), 0);
    if (total <= 0) continue;
    const ret = Math.max(0, total - (Number(fstore.minimoGanancias) || 0)) * (cfg.retencionPct || 0) / 100;
    const base = cfg.baseComision === "neto" ? (total - ret) : total;
    const com = base * (cfg.comisionPct || 0) / 100;
    const socios = cfg.socios || 2;
    const cadaUno = com / socios;
    const nsShares = Math.min(2, socios);
    ingresoNacho += cadaUno;
    if (socios >= 2) ingresoSeba += cadaUno;
    detalle.push({ id: r.id, slug: r.slug, name: (nombreCliente && nombreCliente[r.slug]) || r.slug, monto: cadaUno * nsShares, fechaCobro: r.fechaCobro, cobrado: !!r.cobrado });
    facturasContadas++;
  }
  detalle.sort((a, b) => b.monto - a.monto);
  return { ingresoNacho, ingresoSeba, detalle, facturasContadas };
}
// Avanza en 1 el mes de patrones MM-YY / MM/YYYY dentro de un texto (para clonar
// las descripciones de facturas al período siguiente). "FACTURA 06-26" -> "07-26".
function avanzarMesEnTexto(t) {
  return String(t == null ? "" : t).replace(/\b(0[1-9]|1[0-2])([-/])(\d{4}|\d{2})\b/g, (m, mm, sep, yy) => {
    let mes = parseInt(mm, 10) + 1;
    let anio = parseInt(yy, 10);
    if (mes > 12) { mes = 1; anio += 1; }
    const mmStr = String(mes).padStart(2, "0");
    const yyStr = yy.length === 2 ? String(anio % 100).padStart(2, "0") : String(anio);
    return mmStr + sep + yyStr;
  });
}
// Config de facturación por cliente, con defaults: Caballito reparte en 3 (entra
// el Dr Dubezarsky), el resto en 2 (Nacho/Seba).
function facturaConfigCliente(store, slug) {
  const c = store.config[slug] || {};
  const sociosDefault = slug === "caballito-pediatrico" ? 3 : 2;
  return {
    comisionPct: Number(c.comisionPct) || 0,
    socios: Number(c.socios) || sociosDefault,
    // Retención que PAMI descuenta antes de acreditar (Ganancias inscripto = 2%).
    // Confirmado con cupones de GJS y Sala Millon. Editable si algún cliente difiere.
    retencionPct: c.retencionPct != null ? Number(c.retencionPct) : 2,
    // Sobre qué base se cobra la comisión: 'neto' (tras retención) o 'bruto'. GJS neto.
    baseComision: (c.baseComision === "neto" || c.baseComision === "bruto") ? c.baseComision : (slug === "st-ignacio" ? "neto" : "bruto"),
  };
}
// --- Gastos fijos de NS ---
// Semilla inicial (se crea solo la primera vez): sueldo empleado (15 y 30) + Claude.
const GASTOS_SEMILLA = [
  { concepto: "Empleado (1ra quincena)", dia: 15, monto: 350000, moneda: "ARS" },
  { concepto: "Empleado (2da quincena)", dia: 30, monto: 350000, moneda: "ARS" },
  { concepto: "Claude (suscripción)", dia: 10, monto: 20, moneda: "USD" },
];
function loadGastos() {
  try {
    const j = JSON.parse(fs.readFileSync(gastosFile, "utf8"));
    return { gastos: Array.isArray(j.gastos) ? j.gastos : [], pagos: j.pagos || {} };
  } catch { return null; }
}
function saveGastos(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(gastosFile, JSON.stringify(store, null, 2));
}
// Devuelve el store, creándolo con la semilla la primera vez.
function loadGastosOSemilla() {
  const s = loadGastos();
  if (s) return s;
  const store = { gastos: GASTOS_SEMILLA.map((g) => ({ id: crypto.randomUUID(), ...g })), pagos: {} };
  saveGastos(store);
  return store;
}
// Ingresos EXTRA (fuera de las comisiones PAMI): entradas por-mes que suman a
// "En bolsillo". Se reparten 50/50 entre los socios, igual que las comisiones.
const ingresosFile = path.join(dataDir, "ingresos_extra.json");
function loadIngresos() {
  try { const j = JSON.parse(fs.readFileSync(ingresosFile, "utf8")); return { ingresos: Array.isArray(j.ingresos) ? j.ingresos : [] }; }
  catch { return { ingresos: [] }; }
}
function saveIngresos(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(ingresosFile, JSON.stringify(store || { ingresos: [] }, null, 2));
}
// Total de ingresos extra de un mes (YYYY-MM), convertido a ARS. Devuelve SOLO la
// parte de NS: se divide en `partes` iguales y NS se queda con 2 (Nacho + Seba).
// partes=2 → NS se queda con todo; partes=3 → NS se queda con 2/3.
function ingresoNSShare(g, dolarValor) {
  const bruto = g.moneda === "USD" ? (Number(g.monto) || 0) * (dolarValor || 0) : (Number(g.monto) || 0);
  const partes = Math.max(2, Math.round(Number(g.partes) || 2));
  return bruto * 2 / partes;
}
function ingresosExtraDelMes(mes, dolarValor) {
  const store = loadIngresos();
  let total = 0;
  for (const g of store.ingresos) {
    if (String(g.mes || "") !== mes) continue;
    total += ingresoNSShare(g, dolarValor);
  }
  return total;
}
// Cotización del dólar oficial (venta), cacheada 3h para no golpear la API.
let _DOLAR_CACHE = { valor: 0, fecha: "", ts: 0 };
async function getDolarOficial() {
  const ahora = Date.now();
  if (_DOLAR_CACHE.valor && ahora - _DOLAR_CACHE.ts < 3 * 3600 * 1000) return _DOLAR_CACHE;
  try {
    const resp = await fetch("https://dolarapi.com/v1/dolares/oficial", { signal: AbortSignal.timeout(8000) });
    const j = await resp.json();
    const valor = Number(j && (j.venta || j.compra)) || 0;
    if (valor > 0) _DOLAR_CACHE = { valor, fecha: String((j && j.fechaActualizacion) || "").slice(0, 10), ts: ahora };
  } catch (e) { /* si falla, devolvemos lo último que haya (aunque sea 0) */ }
  return _DOLAR_CACHE;
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
function loadClientBandejasAdelante() {
  try {
    const parsed = JSON.parse(fs.readFileSync(clientBandejasAdelanteFile, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function saveClientBandejasAdelante(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(clientBandejasAdelanteFile, JSON.stringify(store, null, 2));
}
// Bandejas de MESES FUTUROS (septiembre, octubre…), bajadas por separado para no
// hacer explotar el export. Estructura: { slug: { "2026-09": {rows,columns,...} } }.
const clientBandejasFuturasFile = path.join(dataDir, "client_bandejas_futuras.json");
function loadClientBandejasFuturas() {
  try { const j = JSON.parse(fs.readFileSync(clientBandejasFuturasFile, "utf8")); return (j && typeof j === "object") ? j : {}; }
  catch { return {}; }
}
function saveClientBandejasFuturas(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(clientBandejasFuturasFile, JSON.stringify(store, null, 2));
}
// Padrón de afiliados por cliente: { [slug]: { [dni]: {dni, beneficio, nombre, tramite, ...} } }.
// Se alimenta subiendo turneras. Es la base para matchear informes por número exacto.
const padronFile = path.join(dataDir, "padron.json");
function loadPadron() {
  try { const j = JSON.parse(fs.readFileSync(padronFile, "utf8")); return (j && typeof j === "object") ? j : {}; }
  catch { return {}; }
}
function savePadron(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(padronFile, JSON.stringify(store, null, 2));
}

// Cabina de informes: índice por cliente + archivos originales en disco.
// { [slug]: { items: [ {id, filename, ext, stored, origen, storedAt, extract, match, resuelto, error} ], updatedAt } }
const informesDir = path.join(dataDir, "informes");
const informesIndexFile = path.join(dataDir, "informes_index.json");
function loadInformes() {
  try { const j = JSON.parse(fs.readFileSync(informesIndexFile, "utf8")); return (j && typeof j === "object") ? j : {}; }
  catch { return {}; }
}
function saveInformes(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(informesIndexFile, JSON.stringify(store, null, 2));
}
// Mes anterior de un período "YYYY-MM" -> "YYYY-MM".
function mesAnteriorYM(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  if (!m) return "";
  let y = Number(m[1]), mo = Number(m[2]) - 1;
  if (mo < 1) { mo = 12; y -= 1; }
  return y + "-" + String(mo).padStart(2, "0");
}

// Corre el match de un informe ya extraído contra la bandeja + padrón del cliente.
function matchearInforme(slug, extract) {
  const bandeja = loadClientBandejas()[slug];
  let bandejaRows = cabinaLib.bandejaParaMatcher(bandeja);
  // + el reporte del MES ANTERIOR (bandeja cerrada que subió el user): los informes
  // que llegan a principio de mes suelen ser de estudios de fin del mes pasado, y su
  // OME está en la bandeja anterior. Solo para matchear; la facturación no se toca.
  const prevPeriodo = mesAnteriorYM(bandeja && bandeja.month);
  if (prevPeriodo) {
    const rep = (loadClientReportsStore().items || []).find(
      (r) => r.clientSlug === slug && String(r.nomencladorPeriod) === prevPeriodo);
    if (rep && Array.isArray(rep.rows)) {
      bandejaRows = bandejaRows.concat(cabinaLib.reporteParaMatcher(rep.rows));
    }
  }
  const padronCliente = loadPadron()[slug] || {};
  const informe = { dni: extract.dni, beneficio: extract.beneficio, nombre: extract.nombre, practicaHint: extract.practica };
  const m = informeMatch.matchInforme(informe, bandejaRows, padronCliente);
  // Cuando no matcheó confiado, sugerir afiliados del padrón con nombre parecido
  // (para confirmar en 1 clic los typos / abreviados / nombres con ruido).
  let sugerencias = [];
  if (["sin_match", "revisar_nombre", "sin_ome", "revisar_practica"].includes(m.estado) && extract.nombre) {
    sugerencias = informeMatch.sugerirPadron(extract.nombre, padronCliente, 5);
  }
  return {
    estado: m.estado, ome: m.ome, via: m.via, confianza: m.confianza,
    etiqueta: cabinaLib.ETIQUETA_ESTADO[m.estado] || m.estado,
    prestacion: m.prestacion ? cabinaLib.candidatoLiviano(m.prestacion) : null,
    candidatos: (m.candidatos || []).slice(0, 8).map(cabinaLib.candidatoLiviano),
    sugerencias,
  };
}
// Procesa un informe ya guardado en disco: extrae datos (con OCR si hace falta) y matchea.
async function procesarInforme(slug, storedPath, id, stored, filename, origen, fecha) {
  let extract = { dni: "", beneficio: "", nombre: "", practica: "", ocrUsado: false, necesitaOcr: false };
  let error = null;
  if (informeExtract) {
    const r = await informeExtract.procesar(storedPath, filename);
    extract = { dni: r.dni || "", beneficio: r.beneficio || "", nombre: r.nombre || "",
                practica: r.practica || "", ocrUsado: !!r.ocrUsado, necesitaOcr: !!r.necesitaOcr };
    error = r.error || null;
  } else {
    error = "El motor de lectura de informes no está disponible en el servidor.";
  }
  const match = matchearInforme(slug, extract);
  return { id, filename, ext: path.extname(filename).toLowerCase(), stored, origen,
           storedAt: new Date().toISOString(), fecha: fecha || "", extract, match, resuelto: null, error };
}
// Filas para exportar la cabina (PDF/Excel): un renglón por informe con su match.
function informesExportRows(items) {
  return (items || []).map((it) => {
    const m = it.match || {};
    const ex = it.extract || {};
    const pr = m.prestacion || {};
    const ome = (it.resuelto && it.resuelto.omes ? it.resuelto.omes.join(", ") : (it.resuelto && it.resuelto.ome)) || m.ome || pr.ome || "";
    const practica = pr.practica || ex.practica || "";
    const beneficio = ex.beneficio || (it.resuelto && it.resuelto.beneficio) || pr.beneficio || "";
    const estado = it.resuelto ? "Resuelto a mano" : (cabinaLib.ETIQUETA_ESTADO[m.estado] || m.estado || "");
    return { archivo: it.filename || "", paciente: ex.nombre || "", dni: ex.dni || "",
             beneficio, practica, estado, ome };
  });
}

// Excel de la cabina (estilo del reporte: header teal, negrita).
function buildInformesWorkbook(items, clientName) {
  const XS = XLSXStyle;
  const rows = informesExportRows(items);
  const aoa = [
    [`Informes recibidos - ${clientName}`],
    [`${rows.length} informe(s)`],
    [],
    ["Archivo", "Paciente", "DNI", "Beneficio", "Practica", "Estado", "N OME"],
    ...rows.map((r) => [r.archivo, r.paciente, r.dni, r.beneficio, r.practica, r.estado, r.ome]),
  ];
  const ws = XS.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 34 }, { wch: 24 }, { wch: 12 }, { wch: 16 }, { wch: 26 }, { wch: 18 }, { wch: 16 }];
  const head = { font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 }, fill: { fgColor: { rgb: "1F4E5F" } }, alignment: { vertical: "center" } };
  if (ws["A1"]) ws["A1"].s = { font: { bold: true, sz: 16, color: { rgb: "1F4E5F" } } };
  if (ws["A2"]) ws["A2"].s = { font: { italic: true, color: { rgb: "667079" } } };
  ["A4", "B4", "C4", "D4", "E4", "F4", "G4"].forEach((a) => { if (ws[a]) ws[a].s = head; });
  const wb = XS.utils.book_new();
  XS.utils.book_append_sheet(wb, ws, "Informes");
  return XS.write(wb, { type: "buffer", bookType: "xlsx" });
}

// PDF de la cabina (tabla simple).
async function buildInformesPdf(items, clientName) {
  const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
  const rows = informesExportRows(items);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(0.12, 0.31, 0.37), gris = rgb(0.4, 0.44, 0.47), negro = rgb(0.1, 0.1, 0.1);
  const cols = [{ k: "paciente", w: 150, t: "Paciente" }, { k: "practica", w: 175, t: "Practica" },
                { k: "estado", w: 95, t: "Estado" }, { k: "ome", w: 100, t: "N OME" }];
  let page = doc.addPage([595, 842]);
  const M = 36; let y = 800;
  const put = (t, x, yy, f, sz, col) => page.drawText(asciiText(String(t == null ? "" : t)).slice(0, 46), { x, y: yy, size: sz, font: f, color: col || negro });
  put(`Informes recibidos - ${clientName}`, M, y, bold, 15, teal); y -= 17;
  put(`${rows.length} informe(s)`, M, y, font, 10, gris); y -= 20;
  const head = () => {
    page.drawRectangle({ x: M, y: y - 4, width: 523, height: 17, color: teal });
    let x = M + 4; cols.forEach((c) => { page.drawText(c.t, { x, y, size: 9, font: bold, color: rgb(1, 1, 1) }); x += c.w; }); y -= 21;
  };
  head();
  for (const r of rows) {
    if (y < 42) { page = doc.addPage([595, 842]); y = 800; head(); }
    let x = M + 4; cols.forEach((c) => { put(r[c.k], x, y, font, 8.5); x += c.w; }); y -= 14;
  }
  return Buffer.from(await doc.save());
}

// Resumen de cada mes futuro guardado (ordenados por período). Cada uno reusa el
// mismo cálculo que "hacia adelante".
function buildBandejasFuturasResumen(slug) {
  const store = loadClientBandejasFuturas()[slug] || {};
  // "Hacia adelante" son meses POSTERIORES al mes en curso. Si se sincronizó un mes
  // pasado (ej. para bajar su reporte) y después se volvió al mes actual, las futuras
  // viejas (ese mes y el propio mes en curso) quedaban guardadas y se colaban acá
  // como si fueran turnos futuros. Filtramos por > mes en curso (period es "YYYY-MM",
  // el orden alfabético coincide con el cronológico).
  const actual = String((loadClientBandejas()[slug] || {}).month || "");
  return Object.keys(store).sort().filter((period) => !actual || period > actual).map((period) => {
    const b = store[period];
    const r = buildAdelanteResumenDe(b);
    if (r) return { ...r, period };
    // Mes futuro SIN turnos: lo mostramos igual (count 0) para dejar claro que se
    // analizó y todavía no hay nada agendado (no que "falta").
    return {
      period, label: (b && b.monthLabel) || periodLabel(period) || "",
      count: 0, consultations: 0, practices: 0,
      posiblesDebitos: 0, posiblesDebitosCount: 0, posiblesDebitosRows: [],
      coversFrom: "", coversTo: "", uploadedAt: (b && b.uploadedAt) || "",
    };
  });
}

// ---------- Credencial provisoria de PAMI (consulta en vivo) ----------
// Replica el POST al formulario público de PAMI (el mismo que hace la app de
// escritorio): 4 datos → PDF. Sin login. Ver desktop-app/credencial_scraper.py.
const CRED_PROV_URL = "https://www.pami.org.ar/credencial-provisoria";
function credNormBenef(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length < 13 || d.length > 14) throw new Error("El beneficio debe tener 13 o 14 dígitos.");
  return d;
}
function credNormDni(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length < 5 || d.length > 8) throw new Error("El DNI debe tener entre 5 y 8 dígitos.");
  return d;
}
function credNormTramite(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (!d) throw new Error("El número de trámite es obligatorio.");
  return d.slice(0, 11).padStart(11, "0");
}
function credGeneroForm(v) {
  const t = String(v || "").trim().toUpperCase();
  if (["M", "MASC", "MASCULINO"].includes(t)) return "m";
  if (["F", "FEM", "FEMENINO"].includes(t)) return "f";
  if (["O", "OTRO"].includes(t)) return "o";
  return "";
}
async function credConsultarPami(benef, dni, tramite, genero) {
  const body = new URLSearchParams({
    el_afiliacion: benef, el_dni: dni, el_tramite: tramite, el_genero: genero,
  }).toString();
  const resp = await fetch(CRED_PROV_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" },
    body,
    signal: AbortSignal.timeout(45000),
  });
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  const buf = Buffer.from(await resp.arrayBuffer());
  return { ok: ct.includes("application/pdf") && buf.slice(0, 5).toString("latin1") === "%PDF-", status: resp.status, ct, buf };
}
// PAMI devuelve la credencial chica arriba de un A4 casi vacío. Recortamos la hoja
// a la franja superior (donde vive el contenido) para que se vea grande en la
// vista previa. Si algo falla, devolvemos el PDF original (nunca romper la descarga).
async function credRecortarCredencial(buf) {
  try {
    const { PDFDocument } = require("pdf-lib");
    const doc = await PDFDocument.load(buf);
    const page = doc.getPages()[0];
    if (!page) return buf;
    const { width, height } = page.getSize();
    const alto = 255; // franja superior con las tarjetas completas (contenido en Y 600-842)
    const y = Math.max(0, height - alto);
    page.setCropBox(0, y, width, height - y);
    return Buffer.from(await doc.save());
  } catch (e) {
    return buf;
  }
}
// Descarga la credencial probando géneros (el explícito primero, luego m/f/o).
// La planilla de Scheffelaar suele traer el sexo vacío → hay que probar. Lanza si
// los datos son inválidos; devuelve { ok, buf, genero } o { ok:false, error }.
async function credDescargar(benef, dni, tramite, generoExplicito) {
  const bN = credNormBenef(benef), dN = credNormDni(dni), tN = credNormTramite(tramite);
  const exp = credGeneroForm(generoExplicito);
  const cands = [...new Set([exp, "m", "f", "o"].filter(Boolean))];
  let last = null, hubo200 = false, huboError = false;
  for (const g of cands) {
    try {
      const r = await credConsultarPami(bN, dN, tN, g);
      last = r;
      if (r.ok) return { ok: true, buf: r.buf, genero: g };
      if (r.status === 200) hubo200 = true; else huboError = true;
    } catch (e) { huboError = true; last = { error: String((e && e.message) || e) }; }
  }
  // Definitivo = PAMI respondió 200 en todos los géneros pero nunca dio PDF → no
  // hay credencial provisoria con esos datos (o los datos están mal). Eso se marca
  // en la planilla para no reintentarlo. Un error de red/PAMI caído NO es definitivo.
  const definitivo = hubo200 && !huboError;
  const error = definitivo
    ? "Sin credencial en PAMI (datos incorrectos o no tiene provisoria)"
    : ((last && last.error) || ("PAMI respondió " + (last && last.status) + " (reintentable)"));
  return { ok: false, error, definitivo };
}
function credNombreArchivo(nombre, dni) {
  const clean = String(nombre || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim();
  return (clean ? clean + "_" + dni : "credencial_" + dni) + ".pdf";
}
// Token de Google (Sheets+Drive) de gestion.nssalud, guardado ENCRIPTADO en el
// volumen: { client_id, client_secret, refresh_token }.
const googleOauthFile = path.join(dataDir, "google_oauth.json");
function loadGoogleCfg() {
  try { const raw = JSON.parse(fs.readFileSync(googleOauthFile, "utf8")); const dec = decryptSecret(raw.enc); return dec ? JSON.parse(dec) : null; } catch { return null; }
}
function saveGoogleCfg(cfg) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(googleOauthFile, JSON.stringify({ enc: encryptSecret(JSON.stringify(cfg)) }, null, 2));
}
// Planilla + carpeta de Scheffelaar (columnas 0-based: B=1 nombre, C=2 sexo,
// D=3 benef, F=5 dni, G=6 trámite, I=8 credencial/resultado).
// Config del módulo de credenciales por cliente (Médico de cabecera). Cada uno
// con su planilla, su carpeta de Drive y el mapeo de columnas (0-based). El
// "sexo" es opcional: si no está, se prueban m/f/o.
const CRED_CONFIGS = {
  "scheffelaar-mc": {
    spreadsheetId: "1sZP1NuVzyzjc17lrFFePy6IVQNUB3epNXJIXoBJI334",
    tab: "Schefelar",
    folderId: "1dVeF4i89jbGlZqu_7qrajUgonDFWMoGJ",
    startRow: 2,
    cols: { nombre: 1, sexo: 2, benef: 3, dni: 5, tramite: 6, credencial: 8 },
  },
  "dubesarky-ezequiel": {
    spreadsheetId: "1CJHJz2iR32aknMKwtMsivpjhdIQ3n1T-iUaMt7iENGo",
    tab: "Mc Dube",
    folderId: "1aQ94-mQ3utVHcka6ldKRt83Cg_5c8zE4",
    startRow: 2,
    cols: { benef: 0, dni: 1, tramite: 2, nombre: 3, credencial: 13 }, // N: columna nueva "CREDENCIAL"
  },
};
// Resuelve la config por clave. "scheffelaar" (legacy, de la app y el front) mapea
// al slug scheffelaar-mc.
function credCfg(key) {
  if (key === "scheffelaar") key = "scheffelaar-mc";
  const c = CRED_CONFIGS[key];
  return c ? { slug: key, ...c } : null;
}
const gcreds = require("./google_creds.js");
const telegram = require("./telegram.js");
// Config de Telegram: solo el chat_id (a quién le escribe el bot). El token vive
// en la variable de entorno TELEGRAM_BOT_TOKEN. Nunca guardamos el token en disco.
const telegramFile = path.join(dataDir, "telegram.json");
function loadTelegramCfg() {
  try {
    const j = JSON.parse(fs.readFileSync(telegramFile, "utf8"));
    let chats = Array.isArray(j.chats) ? j.chats.filter((c) => c && c.chatId) : [];
    if (!chats.length && j.chatId) chats = [{ chatId: String(j.chatId), nombre: j.nombre || "" }]; // migra formato viejo
    return { chats };
  } catch { return { chats: [] }; }
}
function saveTelegramCfg(cfg) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(telegramFile, JSON.stringify({ chats: cfg.chats || [] }, null, 2)); }
// Manda un aviso a TODOS los destinatarios. NUNCA lanza: un aviso que falla no
// puede tumbar el proceso que lo reportaba.
async function avisarTelegram(texto) {
  try {
    if (!telegram.hayToken()) return false;
    const cfg = loadTelegramCfg();
    if (!cfg.chats.length) return false;
    let algo = false;
    for (const c of cfg.chats) {
      try { await telegram.enviar(c.chatId, texto); algo = true; }
      catch (e) { try { console.error("[telegram] no pude avisar a", c.chatId, (e && e.message) || e); } catch {} }
    }
    return algo;
  } catch (e) { try { console.error("[telegram] no pude avisar:", (e && e.message) || e); } catch {} return false; }
}
// Lee las filas pendientes de la planilla de un cliente (con datos y sin
// credencial), opcionalmente desde una fila.
async function leerPendientesCred(auth, C, desde) {
  const cc = C.cols;
  const rows = await gcreds.readValues(auth, C.spreadsheetId, C.tab, `A${C.startRow}:${gcreds.indexToCol(cc.credencial)}`);
  const pendientes = []; let hechas = 0, faltanDatos = 0;
  rows.forEach((r, i) => {
    const g = (idx) => (idx == null ? "" : String((r[idx] != null ? r[idx] : "")).trim());
    const nombre = g(cc.nombre), sexo = g(cc.sexo), benef = g(cc.benef), dni = g(cc.dni), tramite = g(cc.tramite), cred = g(cc.credencial);
    if (!nombre && !benef && !dni && !tramite) return;
    if (cred) { hechas++; return; }
    if (!benef || !dni || !tramite) { faltanDatos++; return; }
    const sheetRow = C.startRow + i;
    if (desde && sheetRow < desde) return;
    pendientes.push({ sheetRow, nombre, sexo, benef, dni, tramite });
  });
  return { pendientes, hechas, faltanDatos };
}
// Filas con DNI pero SIN benef (y sin credencial): las que el barrido de la app
// tiene que resolver en el padrón. Devuelve DNI para buscar.
async function leerFaltanBenefCred(auth, C) {
  const cc = C.cols;
  const rows = await gcreds.readValues(auth, C.spreadsheetId, C.tab, `A${C.startRow}:${gcreds.indexToCol(cc.credencial)}`);
  const faltan = [];
  rows.forEach((r, i) => {
    const g = (idx) => (idx == null ? "" : String((r[idx] != null ? r[idx] : "")).trim());
    const dni = g(cc.dni), benef = g(cc.benef), cred = g(cc.credencial), nombre = g(cc.nombre), tramite = g(cc.tramite);
    if (cred || benef || !dni) return;   // ya hecha, ya tiene benef, o no hay DNI para buscar
    faltan.push({ sheetRow: C.startRow + i, dni, nombre, tramite });
  });
  return faltan;
}
// Procesa UNA fila: baja, sube a Drive, marca la planilla (o marca el error
// definitivo). Reusado por el endpoint manual y por la corrida programada.
async function procesarCredencialFila(auth, C, row) {
  const sheetRow = Number(row.sheetRow) || 0;
  const marcar = async (t) => { if (sheetRow) { try { await gcreds.writeCell(auth, C.spreadsheetId, C.tab, gcreds.indexToCol(C.cols.credencial) + sheetRow, t); } catch {} } };
  let dl;
  try { dl = await credDescargar(row.benef, row.dni, row.tramite, row.sexo); }
  catch (e) { await marcar("DATOS INVÁLIDOS"); return { ok: false, sheetRow, error: e.message, definitivo: true }; }
  if (!dl.ok) { if (dl.definitivo) await marcar("SIN CREDENCIAL"); return { ok: false, sheetRow, error: dl.error, definitivo: !!dl.definitivo }; }
  try {
    const fname = credNombreArchivo(row.nombre, credNormDni(row.dni));
    const up = await gcreds.uploadPdf(auth, C.folderId, fname, dl.buf);
    if (sheetRow) await gcreds.writeCell(auth, C.spreadsheetId, C.tab, gcreds.indexToCol(C.cols.credencial) + sheetRow, `=HYPERLINK("${up.webViewLink}";"DESCARGADA")`);
    return { ok: true, sheetRow, archivo: up.name, url: up.webViewLink, genero: dl.genero };
  } catch (e) { return { ok: false, sheetRow, error: "Bajó la credencial pero falló Drive/planilla: " + ((e && e.message) || e) }; }
}
// Programador de la corrida diaria de credenciales (hora Argentina), POR CLIENTE.
// El archivo guarda un objeto { slug: {enabled, hora, ...} }. Migra el formato
// viejo (flat = scheffelaar).
const credScheduleFile = path.join(dataDir, "cred_schedule.json");
function loadCredSchedules() {
  try {
    const j = JSON.parse(fs.readFileSync(credScheduleFile, "utf8"));
    if (j && typeof j === "object" && !j["scheffelaar-mc"] &&
        (j.enabled !== undefined || j.hora !== undefined || j.lastRun !== undefined || j.benefRun !== undefined)) {
      return { "scheffelaar-mc": j };   // formato viejo (flat) = schedule de scheffelaar
    }
    return j && typeof j === "object" ? j : {};
  } catch { return {}; }
}
function loadCredSchedule(slug) {
  const j = loadCredSchedules()[slug] || {};
  return { enabled: !!j.enabled, hora: String(j.hora || ""), desdeFila: Number(j.desdeFila) || 2, lastRunDate: j.lastRunDate || "", lastRun: j.lastRun || null, benefRun: j.benefRun || null };
}
function saveCredSchedule(slug, obj) { const all = loadCredSchedules(); all[slug] = obj; fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(credScheduleFile, JSON.stringify(all, null, 2)); }
function ahoraAR() {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = {}; for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
  return { fecha: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour}:${parts.minute}` };
}
// Estado de corrida en memoria, por cliente.
const CRED_RUN_STATES = {};
function credState(slug) {
  if (!CRED_RUN_STATES[slug]) CRED_RUN_STATES[slug] = { corriendo: false, stop: false, origen: "", inicio: "", total: 0, hechas: 0, ok: 0, sinCred: 0, err: 0 };
  return CRED_RUN_STATES[slug];
}
// origen: etiqueta para el log. soloFilas: si viene un array de sheetRow, baja
// SOLO esas filas (modo quirúrgico). limite: tanda acotada.
async function correrLoteCredenciales(slug, origen, soloFilas, limite) {
  const C = credCfg(slug);
  if (!C) return;
  const st = credState(slug);
  if (st.corriendo) return;
  const gcfg = loadGoogleCfg();
  if (!gcfg) { const s = loadCredSchedule(slug); s.lastRun = { at: new Date().toISOString(), origen, error: "Google no está conectado." }; saveCredSchedule(slug, s); return; }
  Object.assign(st, { corriendo: true, stop: false, origen, inicio: new Date().toISOString(), total: 0, hechas: 0, ok: 0, sinCred: 0, err: 0 });
  try {
    const auth = gcreds.makeAuth(gcfg);
    const sch = loadCredSchedule(slug);
    const filtro = Array.isArray(soloFilas) && soloFilas.length ? new Set(soloFilas.map(Number)) : null;
    let { pendientes } = await leerPendientesCred(auth, C, filtro ? 0 : (sch.desdeFila || 2));
    if (filtro) pendientes = pendientes.filter((p) => filtro.has(Number(p.sheetRow)));
    const lim = Number(limite) || 0;
    if (lim > 0) pendientes = pendientes.slice(0, lim);
    st.total = pendientes.length;
    for (const row of pendientes) {
      if (st.stop) break;
      const r = await procesarCredencialFila(auth, C, row);
      if (r.ok) st.ok++; else if (r.definitivo) st.sinCred++; else st.err++;
      st.hechas = st.ok + st.sinCred + st.err;
      await new Promise((rs) => setTimeout(rs, 400));
    }
    const s = loadCredSchedule(slug);
    s.lastRun = { at: new Date().toISOString(), origen, total: st.total, ok: st.ok, sinCred: st.sinCred, err: st.err };
    saveCredSchedule(slug, s);
  } catch (e) {
    const s = loadCredSchedule(slug); s.lastRun = { at: new Date().toISOString(), origen, error: String((e && e.message) || e) }; saveCredSchedule(slug, s);
  } finally { st.corriendo = false; }
}
setInterval(() => {
  try {
    const { fecha, hhmm } = ahoraAR();
    for (const slug of Object.keys(CRED_CONFIGS)) {
      const sch = loadCredSchedule(slug);
      if (!sch.enabled || !sch.hora || credState(slug).corriendo) continue;
      if (sch.lastRunDate === fecha) continue;
      if (hhmm >= sch.hora) {
        sch.lastRunDate = fecha; saveCredSchedule(slug, sch);
        correrLoteCredenciales(slug, "programada");
      }
    }
  } catch {}
}, 60000);
// Resultado del último sync de bandeja por cliente (para el indicador de salud
// en la card: avisa solo cuando falla o queda desactualizada, sin ruido).
function loadBandejaEstado() {
  try {
    const parsed = JSON.parse(fs.readFileSync(clientBandejaEstadoFile, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function saveBandejaEstado(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(clientBandejaEstadoFile, JSON.stringify(store, null, 2));
}
// Config de Informes: médicos (con su firma) y descripciones. Se guarda en el
// volumen; se siembra con los datos actuales (Naiara + descripciones base).
const informesConfigFile = path.join(dataDir, "informes_config.json");
const debitoReglasFile = path.join(dataDir, "debito_reglas.json");
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
    id: "derma-crio-lesiones", modelo: "caballito-derma-crio", nombre: "Criocirugía de lesiones cutáneas",
    texto: "SE REALIZA CRIOCIRUGÍA DE LESIONES CUTÁNEAS EN REGIÓN A ESPECIFICAR. PROCEDIMIENTO BIEN TOLERADO, SIN COMPLICACIONES INMEDIATAS. SE INDICAN PAUTAS DE CUIDADO LOCAL Y CONTROL EVOLUTIVO.",
  },
  {
    id: "derma-electro-tca-queratosis", modelo: "caballito-derma-electro", nombre: "Topicación con TCA por queratosis seborreicas en rostro",
    texto: "PREVIA ANTISEPSIA SE REALIZA TOPICACIÓN CON TCA AL 50% DE QUERATOSIS SEBORREICAS EN ROSTRO. TOLERA PROCEDIMIENTO, SIN COMPLICACIONES.",
  },
  {
    id: "derma-electro-tca-multiples", modelo: "caballito-derma-electro", nombre: "Topicación con TCA por múltiples queratosis seborreicas en rostro",
    texto: "PREVIA ANTISEPSIA SE REALIZA TOPICACIÓN CON TCA AL 50% DE MÚLTIPLES QUERATOSIS SEBORREICAS EN ROSTRO. TOLERA PROCEDIMIENTO, SIN COMPLICACIONES.",
  },
  {
    id: "derma-electro-electrocoag", modelo: "caballito-derma-electro", nombre: "Electrocoagulación de queratosis seborreicas",
    texto: "PREVIA ANTISEPSIA SE REALIZA ELECTROCOAGULACIÓN DE QUERATOSIS SEBORREICAS EN REGIÓN A ESPECIFICAR. TOLERA PROCEDIMIENTO, SIN COMPLICACIONES.",
  },
  {
    id: "derma-biopsia-losange", modelo: "caballito-derma-biopsia", nombre: "Biopsia losange",
    texto: "PREVIA ANTISEPSIA SE REALIZA INFILTRACIÓN CON LIDOCAÍNA SIN EPINEFRINA AL 2%, SE PROCEDE A TOMA DE BIOPSIA LOSANGE EN REGIÓN A ESPECIFICAR. SE LOGRA HEMOSTASIA. TOLERA PROCEDIMIENTO SIN COMPLICACIONES.\nPACIENTE SE LLEVA MUESTRA EN FORMOL AL 10% ROTULADA Y CON RESUMEN DE HISTORIA CLÍNICA.",
  },
  {
    id: "derma-biopsia-losange-brazo", modelo: "caballito-derma-biopsia", nombre: "Biopsia losange en brazo derecho",
    texto: "PREVIA ANTISEPSIA SE REALIZA INFILTRACIÓN CON LIDOCAÍNA SIN EPINEFRINA AL 2%, SE PROCEDE A TOMA DE BIOPSIA LOSANGE EN BRAZO DERECHO. SE LOGRA HEMOSTASIA. TOLERA PROCEDIMIENTO SIN COMPLICACIONES.\nPACIENTE SE LLEVA MUESTRA EN FORMOL AL 10% ROTULADA Y CON RESUMEN DE HISTORIA CLÍNICA.",
  },
  {
    id: "derma-biopsia-shaving", modelo: "caballito-derma-biopsia", nombre: "Biopsia mediante shaving",
    texto: "PACIENTE CON IDG DE LESIÓN CUTÁNEA A DETERMINAR EN REGIÓN A ESPECIFICAR.\nPREVIA ANTISEPSIA, SE INFILTRA CON LIDOCAÍNA SIN EPINEFRINA AL 2%, SE PROCEDE A TOMA DE BIOPSIA MEDIANTE SHAVING. SE LOGRA HEMOSTASIA. TOLERA PROCEDIMIENTO.\nMUESTRA ENTREGADA A PACIENTE EN FORMOL AL 10% ROTULADA Y CON INFORME DE PROCEDIMIENTO.",
  },
  {
    id: "derma-biopsia-shaving-cuello", modelo: "caballito-derma-biopsia", nombre: "Shaving cuello derecho — CEC vs queratoacantoma",
    texto: "PACIENTE CON IDG DE CEC VS QUERATOACANTOMA DE REGIÓN LATERAL DE CUELLO DERECHO.\nPREVIA ANTISEPSIA, SE INFILTRA CON LIDOCAÍNA SIN EPINEFRINA AL 2%, SE PROCEDE A TOMA DE BIOPSIA MEDIANTE SHAVING. SE LOGRA HEMOSTASIA. TOLERA PROCEDIMIENTO.\nMUESTRA ENTREGADA A PACIENTE EN FORMOL AL 10% ROTULADA Y CON INFORME DE PROCEDIMIENTO.",
  },
  {
    id: "eco-partes-blandas-normal", modelo: "caballito-eco-musculo", nombre: "Partes blandas normal",
    estudio: "Ecografía de partes blandas", medicoId: "sanchez-jamilyn",
    texto: "EXPLORADA LA REGIÓN SOLICITADA CON TRANSDUCTOR DE PARTES BLANDAS, EN RELACIÓN A SITIO DOLOROSO REFERIDO POR EL/LA PACIENTE, NO SE OBSERVAN ALTERACIONES ECOGRÁFICAS AL MOMENTO DEL ESTUDIO.",
  },
  {
    id: "eco-partes-blandas-planta", modelo: "caballito-eco-musculo", nombre: "Partes blandas normal — planta del pie derecho",
    estudio: "Ecografía de partes blandas", medicoId: "sanchez-jamilyn",
    texto: "EXPLORADA LA REGIÓN SOLICITADA (PLANTA DEL PIE DERECHO) CON TRANSDUCTOR DE PARTES BLANDAS, EN RELACIÓN A SITIO DOLOROSO REFERIDO POR EL/LA PACIENTE, NO SE OBSERVAN ALTERACIONES ECOGRÁFICAS AL MOMENTO DEL ESTUDIO.",
  },
  {
    id: "eco-hombro-derecho", modelo: "caballito-eco-musculo", nombre: "Hombro derecho — líquido peritendinoso supraespinoso",
    estudio: "Ecografía de hombro derecho", medicoId: "nirenberg-alberto",
    texto: "SE EVALUÓ EL HOMBRO DERECHO, OBSERVÁNDOSE LÍQUIDO PERITENDINOSO DEL SUPRAESPINOSO, LO QUE SUGIERE PROBABLE ETIOLOGÍA INFLAMATORIA.",
  },
  {
    id: "eco-ambos-hombros", modelo: "caballito-eco-musculo", nombre: "Ambos hombros — líquido peritendinoso supraespinoso",
    estudio: "Ecografía de ambos hombros", medicoId: "nirenberg-alberto",
    texto: "SE EVALUARON AMBOS HOMBROS, OBSERVÁNDOSE EN LOS DOS, MÁS DEL LADO IZQUIERDO, LÍQUIDO PERITENDINOSO DEL SUPRAESPINOSO, LO QUE SUGIERE PROBABLE ETIOLOGÍA INFLAMATORIA.",
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
// Presets de la Flujometría urinaria (ECUD / Urología Caballito). Cada uno pisa
// los 12 valores de uroflujometría + posición (y el diag. clínico en el normal).
// Los valores NUMÉRICOS son iguales para hombre y mujer. Lo que cambia con el sexo
// es la posición —va en el TEXTO del informe (Pte parado / Pte sentada), como en
// el ECUD original— y el diagnóstico clínico (Prostatismo / Síndrome miccional).
// La posición va por textoPorSexo; el diagnóstico por valoresPorSexo.
const FLUJO_SEED_PRESETS = [
  {
    id: "flujo-normal", modelo: "caballito-flujometria", nombre: "Flujometría normal",
    texto: "Pte parado\nMicción espontánea\nCurva de forma y amplitud normal\n\nEstudio normal",
    textoPorSexo: {
      masculino: "Pte parado\nMicción espontánea\nCurva de forma y amplitud normal\n\nEstudio normal",
      femenino: "Pte sentada\nMicción espontánea\nCurva de forma y amplitud normal\n\nEstudio normal",
    },
    valores: {
      tipoEstudio: "Uroflujometría", operador: "Dr. Lisandro Veliz",
      qMax: "25.4 ml/s", qMed90: "18.2 ml/s", qProm: "12.3 ml/s", qA2s: "22.4 ml/s",
      tAQmax: "3.4 seg", t90: "15.8 seg", volTotal: "319.8 ml", volQmax: "73.2 ml",
      tiempoTotal: "25.9 seg", tiempoNeto: "22.3 seg", tiempoDescenso: "22.5 seg", tiempoEntrePausas: "3.6 seg",
    },
    valoresPorSexo: {
      masculino: { diagClinico: "Prostatismo" },
      femenino: { diagClinico: "Síndrome miccional" },
    },
  },
  {
    id: "flujo-oiv", modelo: "caballito-flujometria", nombre: "Flujometría con retardo / compatible con OIV",
    texto: "Pte parado\nRetardo en el inicio\nCurva prolongada con intermitencia.\n\nCompatible con OIV",
    textoPorSexo: {
      masculino: "Pte parado\nRetardo en el inicio\nCurva prolongada con intermitencia.\n\nCompatible con OIV",
      femenino: "Pte sentada\nRetardo en el inicio\nCurva prolongada con intermitencia.\n\nCompatible con OIV",
    },
    valores: {
      tipoEstudio: "Uroflujometría", operador: "Dr. Lisandro Veliz",
      qMax: "10.4 ml/s", qMed90: "3.1 ml/s", qProm: "3.1 ml/s", qA2s: "5.0 ml/s",
      tAQmax: "52.3 seg", t90: "63.5 seg", volTotal: "216.8 ml", volQmax: "105.5 ml",
      tiempoTotal: "70.2 seg", tiempoNeto: "36.7 seg", tiempoDescenso: "17.9 seg", tiempoEntrePausas: "33.5 seg",
    },
    valoresPorSexo: {},
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
      ...ORL_SEED_PRESETS.map((s) => ({ id: s.id, nombre: s.nombre, texto: s.texto, modelos: [s.modelo], ladoTextos: s.ladoTextos || {}, valores: s.valores || {}, estudio: s.estudio || "", medicoId: s.medicoId || "" })),
      ...FLUJO_SEED_PRESETS.map((s) => ({ id: s.id, nombre: s.nombre, texto: s.texto, textoPorSexo: s.textoPorSexo || {}, modelos: [s.modelo], valores: s.valores, valoresPorSexo: s.valoresPorSexo || {} })),
    ];
  }
  return cfg;
}
function saveInformesConfig(cfg) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(informesConfigFile, JSON.stringify(cfg, null, 2));
}
// Reglas de débito de PAMI (cruces): dos estudios que se pisan el mismo día → PAMI debita uno.
// Confirmadas contra bandejas reales (Caballito 05/06 y GJS 06 2026). Ver memoria pami-debitos-regla-mismo-dia.
const DEBITO_REGLAS_SEED_VERSION = 2;
const DEBITO_REGLAS_SEED = [
  { id: "prostatica-vesical", activa: true, tipo: "inclusion", monto: "total",
    debita: "180114", debitaNombre: "Ecografía prostática / vesicoprostática",
    conCodigos: ["180123"], conNombre: "Ecografía vesical c/ medición de residuo",
    nota: "El mismo día que la vesical con residuo, PAMI debita la prostática al 100%. Confirmado Caballito 05 y 06/2026." },
  { id: "renal-abdominal", activa: true, tipo: "inclusion", monto: "total",
    debita: "180116", debitaNombre: "Ecografía renal bilateral",
    conCodigos: ["180112"], conNombre: "Ecografía abdominal completa",
    nota: "La abdominal completa ya incluye los riñones. Confirmado Caballito 05 y 06/2026." },
  { id: "hepatica-abdominal", activa: true, tipo: "inclusion", monto: "total",
    debita: "180113", debitaNombre: "Ecografía hepática / biliar / esplénica / torácica",
    conCodigos: ["180112"], conNombre: "Ecografía abdominal completa",
    nota: "La abdominal completa incluye los estudios ecográficos parciales de abdomen. Alta desde PDF de prácticas excluyentes PAMI." },
  { id: "pancreatica-abdominal", activa: true, tipo: "inclusion", monto: "total",
    debita: "180118", debitaNombre: "Ecografía pancreática o suprarrenal",
    conCodigos: ["180112"], conNombre: "Ecografía abdominal completa",
    nota: "La abdominal completa incluye páncreas/suprarrenales. Alta desde PDF de prácticas excluyentes PAMI." },
  { id: "flujometria-urodinamia", activa: true, tipo: "inclusion", monto: "total",
    debita: "507315", debitaNombre: "Flujometría urinaria computarizada",
    conCodigos: ["507313"], conNombre: "Estudio urodinámico completo",
    nota: "El urodinámico completo ya incluye la flujometría. Confirmado Caballito 05 y 06/2026." },
  { id: "arterial-venoso-mmii", activa: true, tipo: "par", monto: "pay40",
    codigos: ["180610", "180606"],
    codigosNombre: "Ecodoppler arterial + venoso de miembros inferiores",
    nota: "Hechos el mismo día, PAMI paga uno de los dos al 40%. Confirmado GJS 06 y Caballito 06/2026." },
];
function normalizarReglaDebito(r) {
  if (!r || typeof r !== "object") return null;
  const tipo = r.tipo === "par" ? "par" : "inclusion";
  const monto = r.monto === "pay40" ? "pay40" : "total";
  // Alcance del cruce: 'dia' (mismo día, default) o 'periodo' (en cualquier
  // momento del mes). PAMI debita algunos cruces aunque no sean el mismo día.
  const alcance = r.alcance === "periodo" ? "periodo" : "dia";
  const base = { id: slugId(r.id || r.debitaNombre || r.codigosNombre || "regla") || `regla-${Math.abs(String(r.id||"").length)}`,
    activa: r.activa !== false, tipo, monto, alcance, nota: String(r.nota || "").trim() };
  if (tipo === "par") {
    base.codigos = (Array.isArray(r.codigos) ? r.codigos : []).map((c) => cleanIdentifier(c)).filter(Boolean).slice(0, 4);
    base.codigosNombre = String(r.codigosNombre || "").trim();
  } else {
    base.debita = cleanIdentifier(r.debita);
    base.debitaNombre = String(r.debitaNombre || "").trim();
    base.conCodigos = (Array.isArray(r.conCodigos) ? r.conCodigos : []).map((c) => cleanIdentifier(c)).filter(Boolean).slice(0, 6);
    base.conNombre = String(r.conNombre || "").trim();
  }
  return base;
}
const UMBRAL_PAGA_PCT_DEFAULT = 60; // "valorización parcial por umbrales" (Resol 2713): PAMI paga este %.
function sanearUmbralPct(v) {
  const n = Number(v);
  return (n > 0 && n <= 100) ? n : UMBRAL_PAGA_PCT_DEFAULT;
}
function mergeDebitoSeed(reglasRaw) {
  const actuales = (Array.isArray(reglasRaw) ? reglasRaw : []).map(normalizarReglaDebito).filter(Boolean);
  const ids = new Set(actuales.map((r) => r.id));
  for (const seed of DEBITO_REGLAS_SEED) {
    const regla = normalizarReglaDebito(seed);
    if (regla && !ids.has(regla.id)) {
      actuales.push(regla);
      ids.add(regla.id);
    }
  }
  return actuales;
}
// El archivo puede ser un array (formato viejo, solo reglas) o un objeto
// { reglas, umbralPagaPct }. loadDebitoStore normaliza ambos.
function loadDebitoStore() {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(debitoReglasFile, "utf8")); } catch {}
  let reglasRaw, umbral, seedVersion = 0;
  if (Array.isArray(raw)) { reglasRaw = raw; umbral = UMBRAL_PAGA_PCT_DEFAULT; }
  else if (raw && typeof raw === "object") { reglasRaw = Array.isArray(raw.reglas) ? raw.reglas : DEBITO_REGLAS_SEED; umbral = sanearUmbralPct(raw.umbralPagaPct); seedVersion = Number(raw.seedVersion || 0); }
  else { reglasRaw = DEBITO_REGLAS_SEED; umbral = UMBRAL_PAGA_PCT_DEFAULT; seedVersion = DEBITO_REGLAS_SEED_VERSION; }
  const reglas = seedVersion < DEBITO_REGLAS_SEED_VERSION
    ? mergeDebitoSeed(reglasRaw)
    : reglasRaw.map(normalizarReglaDebito).filter(Boolean);
  const store = { reglas, umbralPagaPct: umbral, seedVersion: DEBITO_REGLAS_SEED_VERSION };
  if (raw && (Array.isArray(raw) || seedVersion < DEBITO_REGLAS_SEED_VERSION)) {
    try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(debitoReglasFile, JSON.stringify(store, null, 2)); } catch {}
  }
  return store;
}
function loadDebitoReglas() { return loadDebitoStore().reglas; }
function saveDebitoStore(reglas, umbralPagaPct) {
  fs.mkdirSync(dataDir, { recursive: true });
  const limpio = (Array.isArray(reglas) ? reglas : []).map(normalizarReglaDebito).filter(Boolean);
  const store = { reglas: limpio, umbralPagaPct: sanearUmbralPct(umbralPagaPct), seedVersion: DEBITO_REGLAS_SEED_VERSION };
  fs.writeFileSync(debitoReglasFile, JSON.stringify(store, null, 2));
  return store;
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

// ---------- Worker Linux / servidor externo ----------
function getWorkerToken() {
  const envToken = String(process.env.NS_WORKER_TOKEN || process.env.WORKER_API_TOKEN || "").trim();
  if (envToken) return envToken;
  try {
    const stored = fs.readFileSync(workerTokenFile, "utf8").trim();
    if (stored) return stored;
  } catch {}
  const token = crypto.randomBytes(32).toString("hex");
  try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(workerTokenFile, token); } catch {}
  return token;
}
const WORKER_TOKEN = getWorkerToken();
function workerTokenFromReq(req) {
  const auth = String(req.headers.authorization || "").trim();
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  return String(req.headers["x-ns-worker-token"] || "").trim();
}
function isWorkerAuth(req) {
  const got = workerTokenFromReq(req);
  if (!got || !WORKER_TOKEN) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(WORKER_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function emptyWorkerState() {
  return { workers: {}, tasks: [] };
}
function loadWorkerState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(workerStateFile, "utf8"));
    return {
      workers: parsed && typeof parsed.workers === "object" && !Array.isArray(parsed.workers) ? parsed.workers : {},
      tasks: Array.isArray(parsed && parsed.tasks) ? parsed.tasks : [],
    };
  } catch {
    return emptyWorkerState();
  }
}
function saveWorkerState(state) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(workerStateFile, JSON.stringify(state || emptyWorkerState(), null, 2));
}
function publicWorkerTask(t) {
  return {
    id: String(t.id || ""),
    type: String(t.type || ""),
    label: String(t.label || ""),
    status: String(t.status || "pending"),
    clientSlug: String(t.clientSlug || ""),
    workerId: String(t.workerId || ""),
    createdAt: String(t.createdAt || ""),
    startedAt: String(t.startedAt || ""),
    finishedAt: String(t.finishedAt || ""),
    attempts: Number(t.attempts || 0),
    error: String(t.error || ""),
    result: t.result && typeof t.result === "object" ? t.result : null,
    logs: Array.isArray(t.logs) ? t.logs.slice(-100) : [],
  };
}
function appendWorkerTaskLog(task, level, message) {
  if (!Array.isArray(task.logs)) task.logs = [];
  task.logs.push({
    at: new Date().toISOString(),
    level: String(level || "info").slice(0, 20),
    message: String(message || "").slice(0, 1000),
  });
  if (task.logs.length > 300) task.logs = task.logs.slice(-300);
}
function staleWorkerTask(t, nowMs) {
  if (t.status !== "running") return false;
  const started = Date.parse(t.startedAt || "");
  return Number.isFinite(started) && nowMs - started > 30 * 60 * 1000;
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
  return { username: u.username, name: u.name, role: u.role, centro: u.centro || "", mustChange: !!u.mustChange };
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
  {
    slug: "scheffelaar-mc",
    name: "SCHEFFELAAR MC",
    businessName: "SCHEFFELAAR KLOTZ SABRINA ALEJANDRA",
    cuit: "20281907531",
    ugl: "UGL XXIX",
    sap: "116986",
    status: "Activo",
    tipo: "med_cabecera",
    activeModules: [{ code: "1", name: "MEDICO CABECERA" }],
  },
  {
    slug: "navarro-mc",
    name: "Navarro",
    businessName: "NAVARRO VIOLINTZIS OSVALDO DANIEL",
    cuit: "20211389592",
    ugl: "",
    sap: "115673",
    status: "Activo",
    tipo: "med_cabecera",
    activeModules: [{ code: "1", name: "MEDICO CABECERA" }],
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
    // Tipo de cliente: "consultorio" (default) o "med_cabecera" (médico de cabecera).
    tipo: (String(client.tipo || base.tipo || "consultorio").trim() === "med_cabecera") ? "med_cabecera" : "consultorio",
    // Cliente EN ANÁLISIS (potencial): va a la sección "Potenciales clientes", se le
    // baja la bandeja para analizar pero NUNCA se transmite (no somos su facturador).
    enAnalisis: !!(client.enAnalisis !== undefined ? client.enAnalisis : base.enAnalisis),
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
// El archivo de reportes trae TODOS los reportes de todos los clientes con sus
// filas embebidas (varios MB). Leerlo + parsearlo en cada request (dashboard,
// lista de reportes, etc.) trababa el cambio de cliente. Lo cacheamos en memoria
// y solo re-leemos si el archivo cambió (fecha de modificación). El único que
// escribe es este server, así que el mtime alcanza para invalidar.
let _reportsStoreCache = null;
let _reportsStoreMtime = -1;
function loadClientReportsStore() {
  try {
    const mtime = fs.statSync(clientReportsFile).mtimeMs;
    if (_reportsStoreCache && mtime === _reportsStoreMtime) return _reportsStoreCache;
    const parsed = JSON.parse(fs.readFileSync(clientReportsFile, "utf8"));
    let store;
    if (parsed && Array.isArray(parsed.items)) store = parsed;
    else if (Array.isArray(parsed)) store = { items: parsed };
    else store = createClientReportsStore();
    _reportsStoreCache = store;
    _reportsStoreMtime = mtime;
    return store;
  } catch {
    return _reportsStoreCache || createClientReportsStore();
  }
}
function saveClientReportsStore(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  const normalized = { items: store.items || [] };
  fs.writeFileSync(clientReportsFile, JSON.stringify(normalized, null, 2));
  // Refrescamos el cache con lo recién escrito (evita re-leer el archivo grande).
  _reportsStoreCache = normalized;
  try { _reportsStoreMtime = fs.statSync(clientReportsFile).mtimeMs; } catch { _reportsStoreMtime = -1; }
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
  "180112": ["187112"],
  "180113": ["187113"],
  "180114": ["187114"],
  "180116": ["187116"],
  "180118": ["187118"],
  "180123": ["187120"],
  "507313": ["360111"],
  "507315": ["360116"],
};
const pamiExclusionReverseAliases = {};
for (const [actual, historicos] of Object.entries(pamiExclusionCodeAliases)) {
  for (const historico of historicos || []) {
    if (!pamiExclusionReverseAliases[historico]) pamiExclusionReverseAliases[historico] = [];
    pamiExclusionReverseAliases[historico].push(actual);
  }
}
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
  return Array.from(new Set([clean, ...(pamiExclusionCodeAliases[clean] || []), ...(pamiExclusionReverseAliases[clean] || []), ...descriptionCodes].filter(Boolean)));
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
  // Regla ergo-por-holter DESACTIVADA: contra datos reales (bandeja 05/2026)
  // PAMI no debitó ninguna ergometría pese a co-ocurrir con holter, en ningún
  // orden de fechas. La teoría de co-ocurrencia (y la de secuencia) daban falsos
  // positivos. Hasta tener la regla real, el débito se aplica a mano / desde la
  // validación de PAMI. Ver charla 2026-08.
  // {
  //   debitCodes: ["570124", "170157", "177157"],
  //   dominantCodes: ["570121", "170145", "177145"],
  //   debitLabel: "570124",
  //   dominantLabel: "570121",
  //   description: "Ergometria debitada por Holter en el mismo periodo",
  // },
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
function reportRowDay(row) {
  const iso = String((row && row.appointmentAt) || "");
  return iso ? iso.slice(0, 10) : "";
}
// Aplica las reglas de débito configurables (panel Débitos): dos estudios que se
// pisan EL MISMO DÍA al mismo afiliado → PAMI debita uno. Es una proyección: no
// pisa un débito cargado a mano ni de la validación de PAMI (debitSource).
function applyAutomaticExclusionDebits(rows) {
  (rows || []).forEach((row) => {
    if (row.debitSource === "regla") {
      // limpiar una proyección anterior antes de recalcular
      row.manualDebit = false;
      row.debitType = "total";
      row.debitAmount = 0;
      row.debitSource = "";
    }
    row.autoDebit = false;
    row.autoDebitReason = "";
    row.autoDebitRuleId = "";
    row.autoDebitPairCode = "";
    row.autoDebitRuleCodes = "";
    row.debitWarning = "";
  });
  const reglas = loadDebitoReglas().filter((r) => r && r.activa);
  if (!reglas.length) return rows || [];
  // Dos agrupaciones: por afiliado+día (reglas de "mismo día") y por afiliado
  // solo (reglas de "mismo período"/mes). Cada regla se aplica en la que le toca.
  const dayGroups = new Map();
  const periodGroups = new Map();
  const push = (map, key, row) => { if (!map.has(key)) map.set(key, []); map.get(key).push(row); };
  (rows || []).forEach((row) => {
    if (!row.billable || !cleanIdentifier(row.practiceCode) || reportRowGross(row) <= 0) return;
    const benefit = cleanIdentifier(row.benefit);
    if (!benefit) return;
    const day = reportRowDay(row);
    if (day) push(dayGroups, `${benefit}|${day}`, row);
    push(periodGroups, benefit, row);
  });
  const yaCargado = (row) => row.debitSource === "validacion" || row.debitSource === "manual";
  const marcar = (row, monto, regla, reason, pairCodes) => {
    if (yaCargado(row)) return false;
    row.manualDebit = true;
    row.debitType = monto === "pay40" ? "pay40" : "total";
    row.debitAmount = 0;
    row.autoDebit = true;
    row.autoDebitRuleId = regla.id;
    row.autoDebitReason = reason;
    row.autoDebitRuleCodes = pairCodes || "";
    row.debitSource = "regla";
    return true;
  };
  const aplicar = (groups, reglasSet) => {
    for (const groupRows of groups.values()) {
      const codes = new Set(groupRows.flatMap((r) => expandedPamiExclusionCodes(r)));
      for (const regla of reglasSet) {
        const cuando = regla.alcance === "periodo" ? "en el mes" : "el mismo día";
        if (regla.tipo === "inclusion") {
          const hayGrande = (regla.conCodigos || []).some((c) => codes.has(cleanIdentifier(c)));
          if (!hayGrande) continue;
          const dc = cleanIdentifier(regla.debita);
          const reason = `${regla.debitaNombre || dc} debitada: ${cuando} se hizo ${regla.conNombre || (regla.conCodigos || []).join("/")}.`;
          groupRows.filter((r) => expandedPamiExclusionCodes(r).includes(dc))
            .forEach((r) => marcar(r, "total", regla, reason, (regla.conCodigos || []).join("/")));
        } else if (regla.tipo === "par") {
          const cods = (regla.codigos || []).map((c) => cleanIdentifier(c));
          const presentes = new Set(cods.filter((c) => codes.has(c)));
          if (presentes.size < 2) continue;
          const candidatos = groupRows.filter((r) => expandedPamiExclusionCodes(r).some((c) => cods.includes(c)) && !yaCargado(r));
          if (candidatos.length < 2) continue;
          // PAMI debita UNO solo del par: proyectamos el débito en una práctica.
          const reason = `${regla.codigosNombre || "Par de estudios"} ${cuando}: PAMI paga uno al 40%.`;
          marcar(candidatos[candidatos.length - 1], regla.monto || "pay40", regla, reason, cods.join("/"));
        }
      }
    }
  };
  aplicar(dayGroups, reglas.filter((r) => r.alcance !== "periodo"));
  aplicar(periodGroups, reglas.filter((r) => r.alcance === "periodo"));
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
    "570123": {
      moduleCode: "543",
      moduleDescription: "CARDIOLOGIA",
      practiceCode: "570123",
      practiceDescription: "ERGOMETRIA COMPUTARIZADA DE DOCE DERIVACIONES",
      total: 28861.07,
      valueSourceCode: "570123",
    },
  },
  "st-ignacio": {
    "570126": {
      moduleCode: "543",
      moduleDescription: "CARDIOLOGIA",
      practiceCode: "570126",
      practiceDescription: "ELECTROCARDIOGRAMA",
      total: 6905.52,
      valueSourceCode: "570126",
    },
    "570123": {
      moduleCode: "543",
      moduleDescription: "CARDIOLOGIA",
      practiceCode: "570123",
      practiceDescription: "ERGOMETRIA COMPUTARIZADA DE DOCE DERIVACIONES",
      total: 28861.07,
      valueSourceCode: "570123",
    },
  },
};
// Códigos viejos que se siguen transmitiendo pero caen en "Sin módulo": se
// reasignan a su módulo y se marcan "(Cod. Viejo)" en el dashboard. Solo tocan el
// módulo y la descripción, NO el valor (ese sale del nomenclador / valores).
// Son relaciones del nomenclador PAMI (código → módulo), iguales para todos los
// clientes, así que se aplican global. Por-cliente solo si alguno necesita algo
// distinto.
const GLOBAL_OLD_CODE_MODULES = {
  "570126": { moduleCode: "543", moduleDescription: "CARDIOLOGIA" },       // Electrocardiograma
  "570123": { moduleCode: "543", moduleDescription: "CARDIOLOGIA" },       // Ergometría (código viejo, hoy 570124)
  "820113": { moduleCode: "543", moduleDescription: "CARDIOLOGIA" },       // Consulta cardiología (código viejo, hoy 570129)
  "607137": { moduleCode: "552", moduleDescription: "GASTROENTEROLOGIA" }, // Videoendoscopia digestiva baja
};
const clientOldCodeModules = {};
// Valores de práctica cargados por el operador desde la web (persistidos en el
// volumen), que se suman a los hardcodeados. Cache en memoria; se recarga al guardar.
let _clientPracticeValuesCache = null;
function loadClientPracticeValues() {
  if (_clientPracticeValuesCache) return _clientPracticeValuesCache;
  try { _clientPracticeValuesCache = JSON.parse(fs.readFileSync(clientPracticeValuesFile, "utf8")) || {}; } catch { _clientPracticeValuesCache = {}; }
  return _clientPracticeValuesCache;
}
function saveClientPracticeValues(store) {
  _clientPracticeValuesCache = store;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(clientPracticeValuesFile, JSON.stringify(store, null, 2));
}
function getClientPracticeOverride(clientSlug, practiceCode) {
  const code = String(practiceCode || "");
  const values = loadClientPracticeValues();
  // Prioridad: valor guardado por-cliente (legacy) → valor GLOBAL asignado desde
  // el panel (aplica a TODOS los clientes, porque el valor PAMI es el mismo) →
  // override hardcodeado por cliente.
  const stored = (values[clientSlug] || {})[code] || (values["__global__"] || {})[code];
  if (stored && Number(stored.total) > 0) {
    return {
      moduleCode: stored.moduleCode || "",
      moduleDescription: stored.moduleDescription || "",
      practiceCode: code,
      practiceDescription: stored.practiceDescription || "",
      total: Number(stored.total),
      valueSourceCode: code,
    };
  }
  return ((clientPracticeValueOverrides[clientSlug] || {})[code]) || null;
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
  if (row.debitType === "pay80") return money(gross - (gross * 0.8));
  if (row.debitType === "partial") return clampMoney(row.debitAmount, 0, gross);
  return gross;
}
function reportRowNet(row) {
  return Math.max(0, money(reportRowGross(row) - reportRowDebit(row)));
}
// Detalle de posibles débitos de un reporte (para el desplegable del mes anterior):
// por cada fila con débito, arma el cruce (otra OME del mismo afiliado y día).
function buildDebitoDetalle(rows) {
  const grupo = new Map();
  for (const r of rows) {
    const benef = cleanIdentifier(r.benefit);
    const day = reportRowDay(r);
    if (!benef || !day) continue;
    const k = benef + "|" + day;
    if (!grupo.has(k)) grupo.set(k, []);
    grupo.get(k).push(r);
  }
  const estadoDe = (r) => r.transmitted ? "Transmitida" : (r.validated ? "Validada" : "Turno asignado");
  const out = [];
  for (const r of rows) {
    const d = reportRowDebit(r);
    if (d <= 0) continue;
    const ruleCodes = String(r.autoDebitRuleCodes || "").split("/").map((c) => cleanIdentifier(c)).filter(Boolean);
    const g = grupo.get(cleanIdentifier(r.benefit) + "|" + reportRowDay(r)) || [];
    const cruce = g
      .filter((x) => x !== r && (ruleCodes.length ? ruleCodes.includes(cleanIdentifier(x.practiceCode)) : true))
      .map((x) => [x.practiceCode, x.practiceDescription].filter(Boolean).join(" - ") + (x.appointmentLabel ? " · " + x.appointmentLabel : "") + " · " + estadoDe(x))
      .filter(Boolean);
    if (out.length < 2000) out.push({
      benef: String(r.benefit || ""),
      nombre: String(r.patientName || ""),
      turno: String(r.appointmentLabel || r.appointmentAt || ""),
      practica: [r.practiceCode, r.practiceDescription].filter(Boolean).join(" - "),
      estado: estadoDe(r),
      cruce: cruce.join(" + "),
      monto: money(d),
    });
  }
  return out;
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
    const debitType = ["pay40", "pay60", "pay80", "partial"].includes(row.debitType) ? row.debitType : "total";
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
      autoDebitRuleId: cleanIdentifier(row.autoDebitRuleId),
      debitSource: ["regla", "validacion", "manual"].includes(row.debitSource) ? row.debitSource : "",
      debitMotivo: ["umbral", "excluyente", "incluyente", "inactivo", "parcial"].includes(row.debitMotivo) ? row.debitMotivo : "",
      debitWarning: String(row.debitWarning || "").trim(),
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
  const oldMap = { ...GLOBAL_OLD_CODE_MODULES, ...(clientOldCodeModules[clientSlug] || {}) };
  return (rows || []).map((row) => {
    let next = row;
    const override = getClientPracticeOverride(clientSlug, row.practiceCode);
    if (override && !row.valueEdited) {
      next = {
        ...row,
        moduleCode: row.moduleCode || override.moduleCode || "",
        moduleDescription: row.moduleDescription || override.moduleDescription || "",
        practiceDescription: row.practiceDescription || override.practiceDescription || "",
        valueGross: Number(row.valueGross || 0) > 0 ? row.valueGross : money(override.total),
        valueSourceCode: row.valueSourceCode || override.valueSourceCode || override.practiceCode || "",
        matchFound: true,
      };
    }
    const old = oldMap[cleanIdentifier(row.practiceCode)];
    if (old) {
      const desc = String(next.practiceDescription || "");
      next = {
        ...next,
        moduleCode: old.moduleCode,
        moduleDescription: old.moduleDescription,
        practiceDescription: /cod\.?\s*viejo/i.test(desc) ? desc : (desc ? `${desc} (Cod. Viejo)` : "(Cod. Viejo)"),
      };
    }
    if (next === row) return row;
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
// Resumen valorizado de la bandeja del mes en curso (para el "Dashboard mes en
// curso"). La bandeja de PAMI trae la práctica como "CODIGO - DESCRIPCION" pero
// NINGÚN importe; el $ estimado sale de matchear cada código contra el
// nomenclador del período y sumar el neto. Además cuenta consultas/prácticas y
// validadas/transmitidas. Es una ESTIMACIÓN del mes en curso, sin débitos.
// Agrupa las prácticas de la bandeja del mes por CÓDIGO: cantidad y facturado
// (neto del nomenclador), con la especialidad (módulo) y el nombre de la práctica.
// Base del módulo de honorarios (ganancia = facturado − lo que paga el centro).
function buildHonorariosCodigos(slug) {
  const bandeja = loadClientBandejas()[slug];
  if (!bandeja || !Array.isArray(bandeja.rows) || !bandeja.rows.length) return { periodo: "", codigos: [] };
  const nomStore = loadNomencladorStore();
  let nom = (nomStore.items || {})[bandeja.month] || null;
  if (!nom) {
    const periodos = Object.keys(nomStore.items || {}).sort();
    const noPost = periodos.filter((p) => p <= String(bandeja.month || ""));
    const elegido = noPost.length ? noPost[noPost.length - 1] : periodos[periodos.length - 1];
    nom = elegido ? nomStore.items[elegido] : null;
  }
  const byCode = new Map();
  if (nom && Array.isArray(nom.rows)) for (const r of nom.rows) { const c = cleanIdentifier(r.practiceCode); if (c && !byCode.has(c)) byCode.set(c, r); }
  const keys = Object.keys(bandeja.rows[0] || {});
  const kPrac = keys.find((k) => /PRACTICA/.test(normalizeText(k))) || "";
  const agr = new Map();
  for (const row of bandeja.rows) {
    const pracRaw = String(row[kPrac] || "");
    const code = cleanIdentifier((pracRaw.split(" - ")[0] || "").trim());
    if (!code) continue;
    const nomRow = byCode.get(code) || null;
    let a = agr.get(code);
    if (!a) { a = { code, nombre: nomRow ? nomRow.practiceDescription : (pracRaw.split(" - ").slice(1).join(" - ").trim() || pracRaw), especialidad: (nomRow && nomRow.moduleDescription) || "Sin especialidad", cantidad: 0, facturado: 0 }; agr.set(code, a); }
    a.cantidad++; a.facturado += nomRow ? Number(nomRow.total || 0) : 0;
  }
  const codigos = [...agr.values()]
    .map((a) => ({ code: a.code, nombre: a.nombre, especialidad: a.especialidad, cantidad: a.cantidad, facturado: money(a.facturado) }))
    .sort((x, y) => (x.especialidad || "").localeCompare(y.especialidad || "") || (y.facturado - x.facturado));
  return { periodo: bandeja.month || "", codigos };
}
// Igual que arriba pero desde un REPORTE CERRADO (lo que el centro realmente
// cobra: neto tras débitos). Los honorarios se liquidan sobre lo cerrado.
function buildHonorariosDeReporte(slug, reportId) {
  const store = loadClientReportsStore();
  const report = (store.items || []).find((r) => r.clientSlug === slug && String(r.id) === String(reportId));
  if (!report || !Array.isArray(report.rows)) return null;
  const agr = new Map();
  for (const row of report.rows) {
    const code = cleanIdentifier(row.practiceCode);
    if (!code) continue;
    let a = agr.get(code);
    if (!a) { a = { code, nombre: String(row.practiceText || row.practiceDescription || "").trim(), especialidad: String(row.moduleDescription || "").trim() || "Sin especialidad", cantidad: 0, facturado: 0 }; agr.set(code, a); }
    if (!a.nombre && row.practiceText) a.nombre = String(row.practiceText).trim();
    a.cantidad++; a.facturado += reportRowNet(row);
  }
  const codigos = [...agr.values()]
    .map((a) => ({ code: a.code, nombre: a.nombre, especialidad: a.especialidad, cantidad: a.cantidad, facturado: money(a.facturado) }))
    .sort((x, y) => (x.especialidad || "").localeCompare(y.especialidad || "") || (y.facturado - x.facturado));
  return { periodo: report.period || "", reporteNombre: report.name || "", codigos };
}
function buildBandejaResumen(slug) {
  const bandeja = loadClientBandejas()[slug];
  if (!bandeja || !Array.isArray(bandeja.rows) || !bandeja.rows.length) return null;
  // Elegimos el nomenclador del mes de la bandeja; si no está cargado, el MÁS
  // NUEVO disponible que no sea posterior a ese mes (no el "activo", que puede
  // haber quedado en un mes viejo). Ej: bandeja de Agosto sin nomenclador de
  // agosto → usa Julio (el último), no Abril por estar marcado activo.
  const nomStore = loadNomencladorStore();
  let nom = (nomStore.items || {})[bandeja.month] || null;
  if (!nom) {
    const periodos = Object.keys(nomStore.items || {}).sort();
    const noPosteriores = periodos.filter((p) => p <= String(bandeja.month || ""));
    const elegido = noPosteriores.length ? noPosteriores[noPosteriores.length - 1] : periodos[periodos.length - 1];
    nom = elegido ? nomStore.items[elegido] : null;
  }
  const byCode = new Map();
  if (nom && Array.isArray(nom.rows)) {
    for (const r of nom.rows) {
      const c = cleanIdentifier(r.practiceCode);
      if (c && !byCode.has(c)) byCode.set(c, r);
    }
  }
  const keys = Object.keys(bandeja.rows[0] || {});
  const findKey = (re) => keys.find((k) => re.test(normalizeText(k))) || "";
  const kPrac = findKey(/PRACTICA/);
  const kTrasm = findKey(/TRASMITIDA|TRANSMITIDA/);
  const kValid = findKey(/VALIDADA/);
  const kBenef = findKey(/BENEFICIO/);
  const kTurno = findKey(/TURNO/);
  const kNombre = findKey(/APELLIDO/);
  const kOme = findKey(/ORDEN/);
  // Afiliados inactivos: OMEs que el bot no pudo transmitir porque PAMI las
  // rechazó (afiliado dado de baja/inactivo al momento de la prestación). Esas
  // NO se cobran → son débito del 100%. Las tomamos de la última corrida de
  // transmisión (client_bandeja_estado) y las cruzamos por NRO. ORDEN.
  const estadoSync = (loadBandejaEstado() || {})[slug] || {};
  const esMotivoInactivo = (m) =>
    /INACTIV|NO ?ACTIV|DE BAJA|\bBAJA\b|NO VIGENTE|SIN COBERTURA|DESAFILIAD|FALLEC|NO AFILIAD/.test(normalizeText(m || ""));
  const inactivoByOme = new Map();
  for (const d of (Array.isArray(estadoSync.omitidosDetalle) ? estadoSync.omitidosDetalle : [])) {
    const ome = cleanIdentifier(d && d.nroOrden);
    if (ome && esMotivoInactivo(d && d.motivo)) inactivoByOme.set(ome, String((d && d.motivo) || "").trim());
  }
  let consultations = 0, practices = 0, validated = 0, transmitted = 0, absent = 0;
  let matched = 0, unmatched = 0, grossEstimado = 0;
  // Desglose por estado: transmitido (cobro real), falta informe (validado sin
  // transmitir) y ausentes (con turno pero SIN validar → el paciente no vino;
  // no facturan, van aparte, no suman al estimado).
  let grossTransmitido = 0, grossTurno = 0;
  let ausentesConsultas = 0, ausentesPracticas = 0;
  let missingInforme = 0, missingInformeAmount = 0;
  // Rango de fechas que abarca la bandeja (del 01 al último turno con datos).
  let coversMin = "", coversMax = "";
  // Detalle copiable de las que faltan informe (validadas sin transmitir).
  const missingInformeRows = [];
  // Detalle de ausentes (con turno pero sin validar → el paciente no vino).
  const ausentesRows = [];
  // Filas sintéticas con el shape que esperan las reglas de débito
  // (para reusar applyAutomaticExclusionDebits).
  const synth = [];
  for (const row of bandeja.rows) {
    const pracRaw = String(row[kPrac] || "");
    const code = cleanIdentifier((pracRaw.split(" - ")[0] || "").trim());
    const esConsulta = code.startsWith("820") || normalizeText(pracRaw).includes("CONSULTA");
    if (esConsulta) consultations++;
    else practices++;
    const esValidada = String(row[kValid] || "").trim().toUpperCase() === "S";
    const esTransmitida = String(row[kTrasm] || "").trim().toUpperCase() === "S";
    const ome = kOme ? cleanIdentifier(row[kOme]) : "";
    const esInactivo = ome && inactivoByOme.has(ome);
    if (esTransmitida) transmitted++;
    if (esValidada) validated++;
    else {
      absent++;
      if (esConsulta) ausentesConsultas++;
      else ausentesPracticas++;
    }
    const nomRow = code ? byCode.get(code) : null;
    const valueGross = nomRow ? Number(nomRow.total || 0) : 0;
    if (nomRow) { matched++; grossEstimado += valueGross; }
    else unmatched++;
    if (!esValidada && ausentesRows.length < 2000) ausentesRows.push({
      benef: String(row[kBenef] || "").trim(),
      nombre: String(row[kNombre] || "").trim(),
      practica: pracRaw,
      turno: String(row[kTurno] || "").trim(),
      valor: money(valueGross),
    });
    if (esTransmitida) grossTransmitido += valueGross;
    else if (!esValidada) grossTurno += valueGross; // el caso validada+sin-transmitir va a missingInformeAmount
    // Falta informe: validada pero NO transmitida (le debemos el informe). Un
    // afiliado inactivo NO es falta de informe (el informe está): es débito, va
    // aparte en posibles débitos.
    if (esValidada && !esTransmitida && !esInactivo) {
      missingInforme++;
      missingInformeAmount += valueGross;
      if (missingInformeRows.length < 2000) missingInformeRows.push({
        benef: String(row[kBenef] || "").trim(),
        nombre: String(row[kNombre] || "").trim(),
        practica: pracRaw,
        turno: String(row[kTurno] || "").trim(),
        valor: money(valueGross),
      });
    }
    // TURNO: "01/08/2026 - 08:15 - P" -> appointmentAt "2026-08-01" (para el mismo-día).
    const md = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(row[kTurno] || ""));
    if (md) {
      const iso = `${md[3]}-${md[2]}-${md[1]}`;
      if (!coversMin || iso < coversMin) coversMin = iso;
      if (!coversMax || iso > coversMax) coversMax = iso;
    }
    synth.push({
      practiceCode: code,
      valueGross,
      // Solo entran al cruce las OMEs que REALMENTE pasaron (validada o
      // transmitida). Un "turno asignado" sin validar no cruza: si el paciente
      // no vino es ausente, no débito. (Planteo del socio, correcto.)
      billable: valueGross > 0 && (esValidada || esTransmitida),
      benefit: String(row[kBenef] || "").trim(),
      appointmentAt: md ? `${md[3]}-${md[2]}-${md[1]}` : "",
      validated: esValidada,
      transmitted: esTransmitida,
      absent: !esValidada,
      debitSource: "",
      manualDebit: false,
      debitType: "total",
      debitAmount: 0,
      // Campos de display (los ignoran las reglas) para el detalle copiable.
      _nombre: String(row[kNombre] || "").trim(),
      _practica: pracRaw,
      _turno: String(row[kTurno] || "").trim(),
      _inactivo: !!esInactivo,
      _inactivoMotivo: esInactivo ? (inactivoByOme.get(ome) || "") : "",
    });
  }
  // Posibles débitos: proyección de las reglas de cruce mismo-día (Panel Débitos).
  applyAutomaticExclusionDebits(synth);
  // Grupos afiliado+día para reconstruir con qué OME(s) cruza cada débito.
  const grupoMap = new Map();
  for (const s of synth) {
    if (!s.benefit || !s.appointmentAt) continue;
    const k = s.benefit + "|" + s.appointmentAt;
    if (!grupoMap.has(k)) grupoMap.set(k, []);
    grupoMap.get(k).push(s);
  }
  let posiblesDebitos = 0, posiblesDebitosCount = 0;
  const posiblesDebitosRows = [];
  for (const r of synth) {
    const d = reportRowDebit(r);
    if (d <= 0) continue;
    posiblesDebitos += d;
    posiblesDebitosCount++;
    // Estado de una práctica en la bandeja del mes en vivo.
    const estadoDe = (s) => s.transmitted ? "Transmitida" : (s.validated ? "Validada" : "Turno asignado");
    const ruleCodes = String(r.autoDebitRuleCodes || "").split("/").map((c) => cleanIdentifier(c)).filter(Boolean);
    const grupo = grupoMap.get(r.benefit + "|" + r.appointmentAt) || [];
    // Incluimos el turno de la OME con la que cruza (la que se debita ya lo tiene
    // en su columna). Hoy siempre es el mismo día, pero deja ver ambas fechas por
    // si a futuro hay una regla de cruce que no sea mismo día.
    const cruce = grupo
      .filter((g) => g !== r && (ruleCodes.length ? ruleCodes.includes(g.practiceCode) : true))
      .map((g) => g._practica + (g._turno ? " · " + g._turno : "") + " · " + estadoDe(g))
      .filter(Boolean);
    if (posiblesDebitosRows.length < 2000) posiblesDebitosRows.push({
      benef: r.benefit,
      nombre: r._nombre || "",
      turno: r._turno || "",
      practica: r._practica || "",
      estado: estadoDe(r),
      cruce: cruce.join(" + "),
      motivo: r.autoDebitReason || "",
      monto: money(d),
    });
  }
  // Débitos por afiliado inactivo (100% de la práctica). No es un cruce mismo-día:
  // PAMI rechazó la transmisión porque el afiliado estaba inactivo. Se suma acá y
  // se evita doble conteo si además cayó en un cruce.
  let inactivosCount = 0;
  for (const r of synth) {
    if (!r._inactivo || reportRowDebit(r) > 0) continue;
    const monto = Number(r.valueGross || 0);
    if (monto <= 0) continue;
    posiblesDebitos += monto;
    posiblesDebitosCount++;
    inactivosCount++;
    if (posiblesDebitosRows.length < 2000) posiblesDebitosRows.push({
      benef: r.benefit,
      nombre: r._nombre || "",
      turno: r._turno || "",
      practica: r._practica || "",
      estado: "Afiliado inactivo",
      cruce: r._inactivoMotivo || "Afiliado inactivo al momento de la prestación",
      motivo: "Afiliado inactivo",
      monto: money(monto),
    });
  }
  return {
    period: bandeja.month || "",
    label: bandeja.monthLabel || periodLabel(bandeja.month) || "",
    count: bandeja.rows.length,
    consultations, practices, validated, transmitted, absent,
    matched, unmatched,
    grossEstimado: money(grossEstimado),
    grossTransmitido: money(grossTransmitido), grossTurno: money(grossTurno),
    ausentesConsultas, ausentesPracticas,
    missingInforme, missingInformeAmount: money(missingInformeAmount),
    missingInformeRows, ausentesRows,
    posiblesDebitos: money(posiblesDebitos), posiblesDebitosCount,
    posiblesDebitosRows, inactivosCount,
    coversFrom: coversMin ? `${coversMin.slice(8, 10)}/${coversMin.slice(5, 7)}` : "",
    coversTo: coversMax ? `${coversMax.slice(8, 10)}/${coversMax.slice(5, 7)}` : "",
    nomencladorPeriod: nom ? (nom.period || "") : "",
    nomencladorLabel: nom ? (nom.label || periodLabel(nom.period)) : "",
    uploadedAt: bandeja.uploadedAt || "",
  };
}
// Resumen "hacia adelante": bandeja de turnos futuros (día siguiente al corte del
// mes en curso → fin de mes). El objetivo es DETECTAR POSIBLES DÉBITOS por
// adelantado, no estimar facturación (los turnos futuros no deberían faltar pero
// faltan → un estimado sería irreal). Es el ÚNICO caso donde el cruce se proyecta
// sobre turnos ASIGNADOS (sin validar); la lógica del mes en curso no cambia.
function buildBandejaAdelanteResumen(slug) {
  return buildAdelanteResumenDe(loadClientBandejasAdelante()[slug]);
}
// Resumen "hacia adelante" a partir de una bandeja (turnos futuros). Reusado por
// el mes en curso (resto del mes) y por los meses futuros (septiembre, octubre…).
function buildAdelanteResumenDe(bandeja) {
  if (!bandeja || !Array.isArray(bandeja.rows) || !bandeja.rows.length) return null;
  const nomStore = loadNomencladorStore();
  let nom = (nomStore.items || {})[bandeja.month] || null;
  if (!nom) {
    const periodos = Object.keys(nomStore.items || {}).sort();
    const noPosteriores = periodos.filter((p) => p <= String(bandeja.month || ""));
    const elegido = noPosteriores.length ? noPosteriores[noPosteriores.length - 1] : periodos[periodos.length - 1];
    nom = elegido ? nomStore.items[elegido] : null;
  }
  const byCode = new Map();
  if (nom && Array.isArray(nom.rows)) for (const r of nom.rows) { const c = cleanIdentifier(r.practiceCode); if (c && !byCode.has(c)) byCode.set(c, r); }
  const keys = Object.keys(bandeja.rows[0] || {});
  const findKey = (re) => keys.find((k) => re.test(normalizeText(k))) || "";
  const kPrac = findKey(/PRACTICA/);
  const kBenef = findKey(/BENEFICIO/);
  const kTurno = findKey(/TURNO/);
  const kNombre = findKey(/APELLIDO/);
  let consultations = 0, practices = 0;
  let coversMin = "", coversMax = "";
  const synth = [];
  for (const row of bandeja.rows) {
    const pracRaw = String(row[kPrac] || "");
    const code = cleanIdentifier((pracRaw.split(" - ")[0] || "").trim());
    const esConsulta = code.startsWith("820") || normalizeText(pracRaw).includes("CONSULTA");
    if (esConsulta) consultations++; else practices++;
    const nomRow = code ? byCode.get(code) : null;
    const valueGross = nomRow ? Number(nomRow.total || 0) : 0;
    const md = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(row[kTurno] || ""));
    if (md) { const iso = `${md[3]}-${md[2]}-${md[1]}`; if (!coversMin || iso < coversMin) coversMin = iso; if (!coversMax || iso > coversMax) coversMax = iso; }
    synth.push({
      practiceCode: code, valueGross,
      // Turnos futuros: se proyecta el cruce aunque NO estén validados (solo acá).
      billable: valueGross > 0,
      benefit: String(row[kBenef] || "").trim(),
      appointmentAt: md ? `${md[3]}-${md[2]}-${md[1]}` : "",
      debitSource: "", manualDebit: false, debitType: "total", debitAmount: 0,
      _nombre: String(row[kNombre] || "").trim(),
      _practica: pracRaw,
      _turno: String(row[kTurno] || "").trim(),
    });
  }
  applyAutomaticExclusionDebits(synth);
  const grupoMap = new Map();
  for (const s of synth) { if (!s.benefit || !s.appointmentAt) continue; const k = s.benefit + "|" + s.appointmentAt; if (!grupoMap.has(k)) grupoMap.set(k, []); grupoMap.get(k).push(s); }
  let posiblesDebitos = 0, posiblesDebitosCount = 0;
  const posiblesDebitosRows = [];
  for (const r of synth) {
    const d = reportRowDebit(r);
    if (d <= 0) continue;
    posiblesDebitos += d; posiblesDebitosCount++;
    const ruleCodes = String(r.autoDebitRuleCodes || "").split("/").map((c) => cleanIdentifier(c)).filter(Boolean);
    const grupo = grupoMap.get(r.benefit + "|" + r.appointmentAt) || [];
    const cruce = grupo.filter((g) => g !== r && (ruleCodes.length ? ruleCodes.includes(g.practiceCode) : true))
      .map((g) => g._practica + (g._turno ? " · " + g._turno : "")).filter(Boolean);
    if (posiblesDebitosRows.length < 2000) posiblesDebitosRows.push({
      benef: r.benefit, nombre: r._nombre || "", turno: r._turno || "", practica: r._practica || "",
      estado: "Turno asignado", cruce: cruce.join(" + "), motivo: r.autoDebitReason || "", monto: money(d),
    });
  }
  return {
    period: bandeja.month || "", label: bandeja.monthLabel || periodLabel(bandeja.month) || "",
    count: bandeja.rows.length, consultations, practices,
    posiblesDebitos: money(posiblesDebitos), posiblesDebitosCount, posiblesDebitosRows,
    coversFrom: coversMin ? `${coversMin.slice(8, 10)}/${coversMin.slice(5, 7)}` : "",
    coversTo: coversMax ? `${coversMax.slice(8, 10)}/${coversMax.slice(5, 7)}` : "",
    nomencladorLabel: nom ? (nom.label || periodLabel(nom.period)) : "",
    uploadedAt: bandeja.uploadedAt || "",
  };
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
    absentAmount: 0,
    outsideCutoff: 0,
    nextPeriodCutoff: 0,
    missingInforme: 0,
    missingInformeAmount: 0,
    missingInformeRows: [],
    posiblesDebitosRows: [],
    unmatched: 0,
    gross: 0,
    debit: 0,
    debitCount: 0,
    debitUmbral: 0,
    debitExcluyente: 0,
    debitOtros: 0,
    net: 0,
    consultationNet: 0,
    practiceNet: 0,
    averageNet: 0,
    consultationShare: 0,
    modules: [],
  };
}
// Categoría del débito de una fila (umbral / excluyente / otro), para el desglose.
function debitoCategoria(row) {
  const m = row && row.debitMotivo;
  if (m === "umbral") return "umbral";
  if (m === "excluyente" || m === "incluyente") return "excluyente";
  if (m) return "otro";
  // Débito de REGLA (cruce mismo día, ej. ecodoppler art+ven al 40%): NO es umbral
  // aunque sea pay40. El umbral es otra cosa (Resol 2713).
  if (row && row.debitSource === "regla") return "otro";
  // Sin motivo (reporte viejo): parcial = umbral, total = otro.
  return ["pay40", "pay60", "pay80"].includes(row && row.debitType) ? "umbral" : "otro";
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
  if (row.absent) { target.absent += 1; target.absentAmount += money(row.valueGross); }
  if (row.outsideCutoff) target.outsideCutoff += 1;
  target.nextPeriodCutoff += reportRowNextPeriodCutoff(row);
  if (reportRowMissingInforme(row)) {
    target.missingInforme += 1;
    target.missingInformeAmount += reportRowMissingInformeAmount(row);
    if (target.missingInformeRows.length < 2000) target.missingInformeRows.push({
      benef: String(row.benefit || ""),
      nombre: String(row.patientName || ""),
      practica: [row.practiceCode, row.practiceDescription].filter(Boolean).join(" - "),
      turno: String(row.appointmentLabel || row.appointmentAt || ""),
      valor: money(row.valueGross),
    });
  }
  if (!row.matchFound && !row.valueEdited) target.unmatched += 1;
  const gross = reportRowGross(row);
  const debit = reportRowDebit(row);
  const net = reportRowNet(row);
  target.gross += gross;
  target.debit += debit;
  if (debit > 0) {
    target.debitCount += 1;
    const cat = debitoCategoria(row);
    if (cat === "umbral") target.debitUmbral += debit;
    else if (cat === "excluyente") target.debitExcluyente += debit;
    else target.debitOtros += debit;
  }
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
  target.absentAmount = money(target.absentAmount);
  target.debit = money(target.debit);
  target.debitUmbral = money(target.debitUmbral);
  target.debitExcluyente = money(target.debitExcluyente);
  target.debitOtros = money(target.debitOtros);
  target.net = money(target.net);
  target.consultationNet = money(target.consultationNet);
  target.practiceNet = money(target.practiceNet);
  target.averageNet = target.totalRows ? money(target.net / target.totalRows) : 0;
  target.consultationShare = target.totalRows ? target.consultations / target.totalRows : 0;
  target.nextPeriodCutoff = money(target.nextPeriodCutoff);
  target.missingInformeAmount = money(target.missingInformeAmount);
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
// Clave única de práctica para deduplicar entre reportes del mismo período.
function dashboardRowKey(row) {
  const order = cleanIdentifier(row && row.order);
  if (order) return "o:" + order;
  return "p:" + cleanIdentifier(row && row.benefit) + "|" + cleanIdentifier(row && row.practiceCode) + "|" + String((row && row.appointmentAt) || "");
}
function buildClientDashboard(slug, periodFilter, compareFilter) {
  const reports = (loadClientReportsStore().items || []).filter((report) => report.clientSlug === slug);
  const byPeriod = new Map();
  // Ordenamos por fecha de cierre asc: si dos reportes del mismo período comparten
  // una práctica (OME), el más reciente pisa (no se cuenta dos veces). Las prácticas
  // distintas sí se suman -> permite comparar por quincenas sin duplicar.
  const sortedReports = [...reports].sort((a, b) => String(a.closedAt || "").localeCompare(String(b.closedAt || "")));
  for (const report of sortedReports) {
    const period = reportDashboardPeriod(report);
    if (!period) continue;
    if (!byPeriod.has(period)) {
      const item = emptyDashboardPeriod(period);
      item._modules = {};
      item._rowsByKey = new Map();
      byPeriod.set(period, item);
    }
    const target = byPeriod.get(period);
    target.reportCount += 1;
    for (const row of reportRows(report)) target._rowsByKey.set(dashboardRowKey(row), row);
  }
  for (const item of byPeriod.values()) {
    const periodRows = [...item._rowsByKey.values()];
    for (const row of periodRows) addRowToDashboardPeriod(item, row);
    item.posiblesDebitosRows = buildDebitoDetalle(periodRows);
    delete item._rowsByKey;
  }
  const periods = Array.from(byPeriod.values()).map(finalizeDashboardPeriod).sort((a, b) => b.period.localeCompare(a.period));
  const selectedPeriod = normalizePeriod(periodFilter) || (periods[0] && periods[0].period) || "";
  const selectedIndex = periods.findIndex((item) => item.period === selectedPeriod);
  // compareFilter === "none" = el usuario eligió NO comparar (aunque haya más
  // reportes). Solo cuando el parámetro está ausente caemos por default al mes
  // anterior.
  let comparePeriod;
  if (compareFilter === "none") comparePeriod = "";
  else comparePeriod = normalizePeriod(compareFilter) || (periods[selectedIndex + 1] && periods[selectedIndex + 1].period) || "";
  // No comparar un período contra sí mismo (variaciones darían 0, no aporta).
  if (comparePeriod === selectedPeriod) comparePeriod = "";
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
// Un reporte "ya tiene débitos cargados" si alguna fila tiene un débito real
// aplicado (a mano o de validación PAMI). Los débitos que son solo proyección de
// las reglas (debitSource === "regla") NO cuentan: son estimación, falta confirmar.
function reportHasRealDebits(rows) {
  return (rows || []).some((r) => r && r.manualDebit && r.debitSource !== "regla" && reportRowDebit(r) > 0);
}
function reportDebitStatus(report) {
  if (report && (report.debitStatus === "confirmado" || report.debitStatus === "pendiente")) return report.debitStatus;
  return reportHasRealDebits(report && report.rows) ? "confirmado" : "pendiente";
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
    // Período dominante del reporte (por fecha de prestación). Sirve para
    // ubicar el reporte de un mes puntual desde el front (ej. mes anterior).
    dashboardPeriod: reportDashboardPeriod(report),
    rowCount: report.rowCount,
    closedAt: report.closedAt,
    closedBy: report.closedBy,
    updatedAt: report.updatedAt,
    updatedBy: report.updatedBy,
    expectedAmount: report.expectedAmount,
    observations: report.observations,
    debitStatus: reportDebitStatus(report),
    summary,
  };
}
// Excel del reporte, client-facing y CON ESTILO (encabezados con color, negrita,
// bordes, moneda formateada). Usa xlsx-js-style (misma base que xlsx + estilos).
function buildClientReportWorkbook(report) {
  const XS = XLSXStyle;
  const rowsForReport = reportRows(report);
  const summaryAll = summarizeReportRows(rowsForReport);
  const modulos = reportCobradoModules(report);
  const cob = summarizeReportRows(modulos.flatMap((m) => m.rows));
  const totalCobrado = modulos.reduce((a, m) => a + m.net, 0);
  const ausentes = rowsForReport.filter((r) => r.absent && !r.outsideCutoff).length;
  const clientName = String(clientDisplayName(report.clientSlug) || report.clientName || "");
  const periodo = String(report.nomencladorLabel || report.nomencladorPeriod || "");
  const MONEY = '"$"#,##0.00';
  const bd = { style: "thin", color: { rgb: "D9DEE1" } };
  const BORDER = { top: bd, bottom: bd, left: bd, right: bd };
  const HEAD = { font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 }, fill: { fgColor: { rgb: "1F4E5F" } }, alignment: { vertical: "center" }, border: BORDER };
  const wb = XS.utils.book_new();
  const setS = (ws, ref, s) => { if (ws[ref]) ws[ref].s = Object.assign({}, ws[ref].s, s); };
  const styleRow = (ws, rowIdx, ncols, s) => { for (let c = 0; c < ncols; c += 1) setS(ws, XS.utils.encode_cell({ r: rowIdx, c }), s); };
  const money = (ws, r, c, extra) => {
    const ref = XS.utils.encode_cell({ r, c });
    if (ws[ref] && typeof ws[ref].v === "number") { ws[ref].z = MONEY; ws[ref].s = Object.assign({ numFmt: MONEY, alignment: { horizontal: "right" } }, extra || {}); }
  };

  // ---- Resumen (client-facing) ----
  const resumen = [
    [clientName.toUpperCase()],
    [[report.title, periodo].filter(Boolean).join("  ·  ") || "Reporte"],
    [],
    ["Cantidad de prestaciones", cob.totalRows],
    ["Consultas", cob.consultations],
    ["Practicas / estudios", cob.practices],
    [],
    ["Bruto facturable", cob.gross],
    ["Debitos", cob.debit],
    ["NETO COBRADO", totalCobrado],
    [],
    ["Proximo periodo (a cobrar)", summaryAll.nextPeriodCutoff],
    ["Falta informe (a recuperar)", summaryAll.missingInformeAmount],
    ["Ausentes (no cobrado)", ausentes],
    ["Valor promedio por prestacion", cob.totalRows ? totalCobrado / cob.totalRows : 0],
  ];
  if (report.observations) resumen.push([], ["Observaciones"], [String(report.observations)]);
  const wsR = XS.utils.aoa_to_sheet(resumen);
  wsR["!cols"] = [{ wch: 34 }, { wch: 20 }];
  wsR["!merges"] = [XS.utils.decode_range("A1:B1"), XS.utils.decode_range("A2:B2")];
  setS(wsR, "A1", { font: { bold: true, sz: 16, color: { rgb: "1F4E5F" } } });
  setS(wsR, "A2", { font: { italic: true, color: { rgb: "667079" } } });
  [7, 8, 11, 12, 14].forEach((r) => money(wsR, r, 1));
  money(wsR, 9, 1, { font: { bold: true }, fill: { fgColor: { rgb: "E8F1EA" } } });
  setS(wsR, "A10", { font: { bold: true }, fill: { fgColor: { rgb: "E8F1EA" } } });
  XS.utils.book_append_sheet(wb, wsR, "Resumen");

  // ---- Por especialidad (módulos reales + total) ----
  const porEsp = [["Codigo", "Especialidad", "Consultas", "Practicas / estudios", "Neto cobrado"]];
  let tc = 0, tp = 0;
  for (const m of modulos) {
    const s = summarizeReportRows(m.rows);
    porEsp.push([m.code, m.name, s.consultations || 0, s.practices || 0, m.net]);
    tc += s.consultations || 0; tp += s.practices || 0;
  }
  porEsp.push([], ["", "TOTAL COBRADO", tc, tp, totalCobrado]);
  const wsE = XS.utils.aoa_to_sheet(porEsp);
  wsE["!cols"] = [{ wch: 10 }, { wch: 36 }, { wch: 12 }, { wch: 16 }, { wch: 18 }];
  styleRow(wsE, 0, 5, HEAD);
  for (let r = 1; r <= modulos.length; r += 1) money(wsE, r, 4);
  const trIdx = modulos.length + 2;
  styleRow(wsE, trIdx, 5, { font: { bold: true }, border: { top: { style: "double", color: { rgb: "1F4E5F" } } } });
  money(wsE, trIdx, 4, { font: { bold: true } });
  XS.utils.book_append_sheet(wb, wsE, "Por especialidad");

  // ---- Detalle (columnas útiles, sin campos internos) ----
  const det = [["Paciente", "Beneficio", "OME", "Codigo", "Prestacion", "Modulo", "Turno", "Estado", "Bruto", "Debito", "Neto"]];
  for (const row of rowsForReport) {
    det.push([
      row.patientName || "",
      row.benefit || "",
      row.order || "",
      row.practiceCode || "",
      row.practiceDescription || row.practiceText || "",
      [row.moduleCode || "", row.moduleDescription || ""].filter(Boolean).join(" "),
      row.appointmentLabel || row.appointmentAt || "",
      professionalReportStatus(row),
      reportRowGross(row),
      reportRowDebit(row),
      reportRowNet(row),
    ]);
  }
  const wsD = XS.utils.aoa_to_sheet(det);
  wsD["!cols"] = [{ wch: 26 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 42 }, { wch: 26 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  wsD["!autofilter"] = { ref: "A1:K1" };
  wsD["!freeze"] = { xSplit: 0, ySplit: 1 };
  styleRow(wsD, 0, 11, HEAD);
  for (let r = 1; r < det.length; r += 1) { money(wsD, r, 8); money(wsD, r, 9); money(wsD, r, 10); }
  XS.utils.book_append_sheet(wb, wsD, "Detalle");

  return XS.write(wb, { bookType: "xlsx", type: "buffer" });
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
  debitos: {
    label: "DEBITOS",
    filename: "DEBITOS",
  },
};
// Pie fijo en cada hoja de todos los PDF: identifica a la gestora.
const PDF_PIE_CONTACTO = "N&S Salud - Gestion de prestaciones  |  gestion.nssalud@gmail.com";
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
    // Pie con el mail de la gestora, fijo abajo de cada hoja.
    commands.push(pdfLineCommand(margin, 26, width - margin, 26, 0.3));
    commands.push(pdfTextCommand(margin, 16, PDF_PIE_CONTACTO, 7, "F1"));
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
      if (index > 0 && section.pageBreakBefore) newPage(false);
      else if (index > 0) y -= 10;
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
  const rows = reportRows(report).filter((row) =>
    String(row.moduleCode || "") === String(moduleCode)
    && !row.outsideCutoff
    && !reportRowMissingInforme(row)
  );
  // Nombre del módulo desde las filas reales (o el dict viejo, o "MODULO x").
  const moduleLabel = (rows.find((r) => r.moduleDescription) || {}).moduleDescription
    || professionalReportModules[String(moduleCode)] || `MODULO ${moduleCode}`;
  const summary = summarizeReportRows(rows);
  return buildRowsPdf({
    heading: `${asciiText(clientDisplayName(report.clientSlug))} - INFORME ${asciiText(moduleLabel)}`,
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
  if (section === "debitos") {
    const rows = reportRows(report).filter((row) => reportRowDebit(row) > 0);
    const total = rows.reduce((acc, row) => acc + reportRowDebit(row), 0);
    return buildRowsPdf({
      heading: "SALA MILLON - DEBITOS",
      title: report.title || "Reporte",
      rows,
      total,
      totalLabel: "Total debitado",
      detailText: `Practicas debitadas - Prestaciones: ${rows.length}`,
      statusForRow: professionalReportStatus,
      amountForRow: reportRowDebit,
      emptyText: "No hay debitos en este reporte.",
      summaryText: `Resumen: practicas debitadas ${rows.length} - total debitado ${pdfMoney(total)}`,
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
// Nombre visible del cliente a partir del slug (para encabezados de PDF).
function clientDisplayName(slug) {
  try {
    const c = loadClientsStore().find((x) => x.slug === slug);
    return (c && c.name) || slug || "";
  } catch { return slug || ""; }
}
// Módulos (especialidades) REALES presentes en lo cobrado del reporte: transmitido,
// dentro de corte y con informe. Cada uno con sus filas y su neto. Ordenados por neto.
// Reemplaza el hardcodeo cardio(543)+traumato(546): sirve para cualquier cliente.
function reportCobradoModules(report) {
  const rows = reportRows(report).filter((row) => !row.outsideCutoff && !reportRowMissingInforme(row) && !row.absent);
  const map = new Map();
  for (const row of rows) {
    const code = String(row.moduleCode || "").trim() || "otros";
    const name = String(row.moduleDescription || "").trim() || code || "OTROS";
    if (!map.has(code)) map.set(code, { code, name, rows: [], net: 0 });
    const m = map.get(code);
    m.rows.push(row);
    m.net += reportRowNet(row);
  }
  return Array.from(map.values()).sort((a, b) => b.net - a.net);
}
function buildGeneralReportPdf(report) {
  const allRows = reportRows(report);
  const modules = reportCobradoModules(report);
  const cutoffRows = allRows.filter((row) => row.outsideCutoff);
  const missingInformeRows = allRows.filter((row) => reportRowMissingInforme(row));
  const cutoffTotal = cutoffRows.reduce((acc, row) => acc + reportRowNextPeriodCutoff(row), 0);
  const missingInformeTotal = missingInformeRows.reduce((acc, row) => acc + reportRowMissingInformeAmount(row), 0);
  // Ausentes (pacientes que faltaron al turno): no se cobran ($0). Van aparte para
  // no ensuciar lo cobrado. Fuera de corte se muestra en su propia seccion.
  const absentRows = allRows.filter((row) => row.absent && !row.outsideCutoff);
  const cobradoRows = modules.flatMap((m) => m.rows);
  const cobradoSummary = summarizeReportRows(cobradoRows);
  // El TOTAL cobrado es la suma de TODOS los módulos transmitidos (no solo 2).
  // Próximo período y falta informe NO están cobrados: van como secciones aparte.
  const totalCobrado = modules.reduce((acc, m) => acc + m.net, 0);
  const clientName = clientDisplayName(report.clientSlug);
  const moduleSections = modules.map((m, i) => ({
    title: `${m.name} - ${pdfMoney(m.net)}`,
    rows: m.rows,
    statusForRow: professionalReportStatus,
    amountForRow: reportRowNet,
    emptyText: `Sin practicas cobradas de ${m.name}.`,
    pageBreakBefore: i > 0,
  }));
  return buildRowsPdf({
    heading: `${asciiText(clientName)} - INFORME GENERAL`.toUpperCase(),
    title: report.title || "Reporte",
    total: totalCobrado,
    totalLabel: "Total cobrado",
    detailText: `Modulos ${modules.length} - Bruto ${pdfMoney(cobradoSummary.gross)} - Debitos ${pdfMoney(cobradoSummary.debit)} = Neto cobrado ${pdfMoney(totalCobrado)}.`,
    sections: [
      ...moduleSections,
      {
        title: `PROXIMO PERIODO - a cobrar - ${pdfMoney(cutoffTotal)}`,
        rows: cutoffRows,
        statusForRow: () => "Proximo mes",
        amountForRow: reportRowNextPeriodCutoff,
        emptyText: "Sin practicas fuera de corte para el proximo periodo.",
        pageBreakBefore: true,
      },
      {
        title: `FALTA INFORME NO COBRADO - valor recuperable - ${pdfMoney(missingInformeTotal)}`,
        rows: missingInformeRows,
        statusForRow: () => "A recuperar",
        amountForRow: reportRowMissingInformeAmount,
        emptyText: "Sin practicas con falta de informe.",
        pageBreakBefore: true,
      },
      {
        title: `AUSENTES - no cobrado (${absentRows.length})`,
        rows: absentRows,
        statusForRow: () => "Ausente",
        amountForRow: () => 0,
        emptyText: "Sin ausentes.",
        pageBreakBefore: true,
      },
    ],
    summaryText: `Cobrado (${modules.length} modulos): Bruto ${pdfMoney(cobradoSummary.gross)} - Debitos ${pdfMoney(cobradoSummary.debit)} = Neto ${pdfMoney(totalCobrado)}. Aparte (no cobrado): proximo periodo ${pdfMoney(cutoffTotal)} - falta informe ${pdfMoney(missingInformeTotal)} - ausentes ${absentRows.length}.`,
  });
}
// PDF genérico de una tabla (título + columnas + filas). Reparte el ancho en
// partes iguales, envuelve el texto largo y formatea como $ las columnas de
// dinero (moneyCols). Lo usan las descargas del detalle de "Mes en curso".
function buildGenericTablePdf(titulo, columnas, filas, moneyCols) {
  const width = 842, height = 595, margin = 28;
  const money = new Set((moneyCols || []).map(Number));
  const n = Math.max(1, columnas.length);
  const colW = (width - margin * 2) / n;
  const chars = Math.max(6, Math.floor(colW / 3.4));
  const xs = columnas.map((_, i) => margin + i * colW + 2);
  const fmtCell = (v, i) => money.has(i) ? pdfMoney(Number(v) || 0) : asciiText(String(v == null ? "" : v));
  const pageStreams = [];
  let commands = [], y = 0;
  const footer = () => {
    commands.push(pdfLineCommand(margin, 26, width - margin, 26, 0.3));
    commands.push(pdfTextCommand(margin, 16, PDF_PIE_CONTACTO, 7, "F1"));
  };
  const drawHead = () => {
    commands.push(pdfLineCommand(margin, y + 8, width - margin, y + 8));
    columnas.forEach((c, i) => commands.push(pdfTextCommand(xs[i], y, asciiText(String(c)), 7, "F2")));
    commands.push(pdfLineCommand(margin, y - 5, width - margin, y - 5));
    y -= 16;
  };
  const newPage = () => {
    if (commands.length) pageStreams.push(commands.join("\n"));
    commands = [];
    footer();
    y = height - 34;
    commands.push(pdfTextCommand(margin, y, asciiText(String(titulo || "Detalle")), 12, "F2"));
    y -= 18;
    drawHead();
  };
  newPage();
  (filas || []).forEach((fila) => {
    const cellLines = columnas.map((_, i) => wrapPdfText(fmtCell((fila || [])[i], i), chars).slice(0, 4));
    const lc = Math.max(1, ...cellLines.map((l) => l.length));
    const rh = 8 + (lc - 1) * 7;
    if (y - rh < 34) newPage();
    cellLines.forEach((lines, i) => lines.forEach((ln, li) =>
      commands.push(pdfTextCommand(xs[i], y - li * 7, ln, 6.5, money.has(i) ? "F2" : "F1"))));
    y -= rh + 3;
  });
  commands.push(pdfLineCommand(margin, y, width - margin, y, 0.5));
  y -= 12;
  commands.push(pdfTextCommand(margin, y, `Total de filas: ${(filas || []).length}`, 8, "F2"));
  pageStreams.push(commands.join("\n"));
  return buildPdfBuffer(pageStreams, width, height);
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

// Igual que extractMultipart pero junta TODOS los archivos (subida de varios informes).
function extractMultipartFiles(buffer, contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error("No se recibió un archivo válido.");
  const bnd = match[1] || match[2];
  const boundary = Buffer.from(`--${bnd}`);
  const result = { fields: {}, files: [] };
  let cursor = buffer.indexOf(boundary);
  while (cursor >= 0) {
    const headerStart = cursor + boundary.length + 2;
    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd < 0) break;
    const headers = buffer.slice(headerStart, headerEnd).toString("latin1");
    const fieldNameMatch = headers.match(/name="([^"]+)"/i);
    const fileNameMatch = headers.match(/filename="([^"]+)"/i);
    const dataStart = headerEnd + 4;
    const dataEnd = buffer.indexOf(Buffer.from(`\r\n--${bnd}`), dataStart);
    if (dataEnd >= 0 && fieldNameMatch) {
      const data = buffer.slice(dataStart, dataEnd);
      if (fileNameMatch) { if (fileNameMatch[1]) result.files.push({ filename: path.basename(fileNameMatch[1]), data }); }
      else result.fields[fieldNameMatch[1]] = data.toString("utf8").trim();
    }
    cursor = buffer.indexOf(boundary, headerEnd + 4);
  }
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

  // Versión de los assets (para avisar "hay versión nueva, recargá" sin depender
  // de que el usuario recargue el index.html — la SPA no lo hace al navegar por hash).
  if (p === "/api/version") return json(res, 200, { version: String(ASSET_VER) });

  // ---- Worker externo: autenticación por token, sin cookie de navegador ----
  if (p === "/api/worker/ping" && req.method === "GET") {
    if (!isWorkerAuth(req)) return json(res, 401, { error: "worker-auth" });
    return json(res, 200, { ok: true, service: "ns-web", at: new Date().toISOString() });
  }
  if (p === "/api/worker/heartbeat" && req.method === "POST") {
    if (!isWorkerAuth(req)) return json(res, 401, { error: "worker-auth" });
    const body = await readBody(req);
    const workerId = String((body && body.workerId) || "").trim().slice(0, 80);
    if (!workerId) return json(res, 400, { error: "falta workerId" });
    const state = loadWorkerState();
    state.workers[workerId] = {
      workerId,
      hostname: String((body && body.hostname) || "").slice(0, 120),
      version: String((body && body.version) || "").slice(0, 40),
      platform: String((body && body.platform) || "").slice(0, 120),
      status: String((body && body.status) || "online").slice(0, 40),
      message: String((body && body.message) || "").slice(0, 500),
      lastSeenAt: new Date().toISOString(),
    };
    saveWorkerState(state);
    return json(res, 200, { ok: true });
  }
  if (p === "/api/worker/tasks/next" && req.method === "GET") {
    if (!isWorkerAuth(req)) return json(res, 401, { error: "worker-auth" });
    const workerId = String(url.searchParams.get("workerId") || "").trim().slice(0, 80);
    if (!workerId) return json(res, 400, { error: "falta workerId" });
    const state = loadWorkerState();
    const now = Date.now();
    for (const t of state.tasks) {
      if (staleWorkerTask(t, now)) {
        t.status = "pending";
        t.workerId = "";
        appendWorkerTaskLog(t, "warn", "La tarea volvió a pendiente porque el worker no la cerró a tiempo.");
      }
    }
    const task = state.tasks.find((t) => t.status === "pending");
    if (!task) {
      saveWorkerState(state);
      return json(res, 200, { task: null });
    }
    task.status = "running";
    task.workerId = workerId;
    task.startedAt = new Date().toISOString();
    task.attempts = Number(task.attempts || 0) + 1;
    appendWorkerTaskLog(task, "info", `Tomada por ${workerId}.`);
    saveWorkerState(state);
    return json(res, 200, { task: { id: task.id, type: task.type, label: task.label, payload: task.payload || {}, clientSlug: task.clientSlug || "" } });
  }
  const workerLogMatch = p.match(/^\/api\/worker\/tasks\/([^/]+)\/log$/);
  if (workerLogMatch && req.method === "POST") {
    if (!isWorkerAuth(req)) return json(res, 401, { error: "worker-auth" });
    const body = await readBody(req);
    const state = loadWorkerState();
    const task = state.tasks.find((t) => t.id === decodeURIComponent(workerLogMatch[1]));
    if (!task) return json(res, 404, { error: "task-not-found" });
    appendWorkerTaskLog(task, body && body.level, body && body.message);
    saveWorkerState(state);
    return json(res, 200, { ok: true });
  }
  const workerCompleteMatch = p.match(/^\/api\/worker\/tasks\/([^/]+)\/complete$/);
  if (workerCompleteMatch && req.method === "POST") {
    if (!isWorkerAuth(req)) return json(res, 401, { error: "worker-auth" });
    const body = await readBody(req);
    const state = loadWorkerState();
    const task = state.tasks.find((t) => t.id === decodeURIComponent(workerCompleteMatch[1]));
    if (!task) return json(res, 404, { error: "task-not-found" });
    const ok = !(body && body.ok === false);
    task.status = ok ? "done" : "error";
    task.finishedAt = new Date().toISOString();
    task.error = ok ? "" : String((body && body.error) || "Error del worker.").slice(0, 1000);
    task.result = body && body.result && typeof body.result === "object" ? body.result : null;
    appendWorkerTaskLog(task, ok ? "info" : "error", ok ? "Tarea finalizada." : task.error);
    saveWorkerState(state);
    return json(res, 200, { ok: true, task: publicWorkerTask(task) });
  }

  // ---- API ----
  if (p === "/api/me") {
    const u = getSessionUser(req);
    if (!u) return json(res, 401, { error: "no-auth" });
    return json(res, 200, { user: publicUser(u) });
  }

  // --- Gate del rol "clinica" (dueño del centro): SOLO LECTURA y SOLO su centro.
  // Puede: ver su sesión, cambiar su clave, salir, y hacer GET de /api/clientes
  // (scopeado abajo) y de /api/clientes/{su-centro}/... Todo lo demás: 403.
  if (p.startsWith("/api/")) {
    const meGate = getSessionUser(req);
    // Gate GLOBAL de acceso: toda ruta que no sea pública exige sesión ACTIVA.
    // getSessionUser ya filtra por `active`, así que desactivar a un usuario lo deja
    // afuera al instante — no puede loguearse NI usar una sesión ya abierta, y no
    // llega a ningún endpoint aunque alguno se olvidara de chequear. Corte de
    // servicio impenetrable (si dejan de pagar, active=false y quedan bloqueados).
    const RUTAS_PUBLICAS = new Set(["/api/login", "/api/logout", "/api/me", "/api/version", "/api/forgot", "/api/reset"]);
    if (!RUTAS_PUBLICAS.has(p) && !meGate) return json(res, 401, { error: "no-auth" });
    if (meGate && meGate.role === "clinica") {
      const esGet = (req.method === "GET" || !req.method);
      const permitidoSiempre = (p === "/api/me" || p === "/api/logout" || p === "/api/change-password" || p === "/api/version" || p === "/api/login");
      const mCli = p.match(/^\/api\/clientes\/([^/]+)(\/.*)?$/);
      const suCentro = mCli && decodeURIComponent(mCli[1]) === meGate.centro;
      let permitido = false;
      if (permitidoSiempre) permitido = true;
      else if (esGet && p === "/api/clientes") permitido = true;
      else if (esGet && suCentro) permitido = true;
      // Única excepción de escritura: guardar SUS honorarios. Y exportar PDF (lectura).
      else if (!esGet && suCentro && /\/honorarios$/.test(p)) permitido = true;
      else if (p === "/api/mescurso/export") permitido = true;
      if (!permitido) return json(res, 403, { error: "Tu usuario solo puede ver su propio centro (solo lectura)." });
    }
  }

  if (p === "/api/admin/worker/status" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const state = loadWorkerState();
    const workers = Object.values(state.workers || {}).sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")));
    const tasks = (state.tasks || []).slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 100).map(publicWorkerTask);
    return json(res, 200, {
      ok: true,
      tokenConfigured: !!WORKER_TOKEN,
      tokenFromEnv: !!String(process.env.NS_WORKER_TOKEN || process.env.WORKER_API_TOKEN || "").trim(),
      workers,
      tasks,
    });
  }
  if (p === "/api/admin/worker/tasks" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const state = loadWorkerState();
    return json(res, 200, { tasks: (state.tasks || []).map(publicWorkerTask) });
  }
  // El worker se autoconfigura: logueado como admin obtiene el token de la cola.
  if (p === "/api/admin/worker/token" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    return json(res, 200, { token: WORKER_TOKEN || "" });
  }
  if (p === "/api/admin/worker/tasks" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const body = await readBody(req);
    const type = String((body && body.type) || "healthcheck").trim().toLowerCase();
    const allowed = new Set(["healthcheck", "bandeja-sync", "auditar-informes", "subir-informes"]);
    if (!allowed.has(type)) return json(res, 400, { error: "Tipo de tarea no soportado todavía." });
    const LABELS = {
      healthcheck: "Prueba de worker", "bandeja-sync": "Sincronizar bandeja",
      "auditar-informes": "Verificar informes en PAMI", "subir-informes": "Subir informes a PAMI",
    };
    const state = loadWorkerState();
    const task = {
      id: crypto.randomUUID(),
      type,
      label: String((body && body.label) || LABELS[type] || type).slice(0, 120),
      status: "pending",
      clientSlug: String((body && body.clientSlug) || "").trim().slice(0, 80),
      payload: body && body.payload && typeof body.payload === "object" ? body.payload : {},
      createdAt: new Date().toISOString(),
      createdBy: me.username,
      attempts: 0,
      logs: [],
    };
    appendWorkerTaskLog(task, "info", `Creada por ${me.username}.`);
    state.tasks.unshift(task);
    state.tasks = state.tasks.slice(0, 500);
    saveWorkerState(state);
    return json(res, 201, { ok: true, task: publicWorkerTask(task) });
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
        centro: u.centro || "",
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
    const { username, name, role, password, email, centro } = await readBody(req);
    const uname = String(username || "").trim().toLowerCase();
    const nm = String(name || "").trim();
    const rl = String(role || "").trim();
    const pw = String(password || "");
    const em = String(email || "").trim().toLowerCase();
    const ce = String(centro || "").trim();
    if (!validUsername(uname)) return json(res, 400, { error: "El usuario debe tener entre 3 y 20 caracteres: letras, números, punto, guion o guion bajo." });
    if (!nm) return json(res, 400, { error: "Escribí el nombre y apellido." });
    if (!ROLES.has(rl)) return json(res, 400, { error: "Elegí un perfil válido." });
    // El rol "clinica" (dueño del centro) DEBE estar atado a un centro existente.
    if (rl === "clinica" && !loadClientsStore().some((c) => c.slug === ce)) return json(res, 400, { error: "Elegí a qué centro pertenece el usuario clínica." });
    if (pw.length < 6) return json(res, 400, { error: "La contraseña inicial debe tener al menos 6 caracteres." });
    if (em && !validEmail(em)) return json(res, 400, { error: "El email no parece válido." });
    const users = loadUsers() || [];
    if (users.some((x) => x.username === uname)) return json(res, 409, { error: "Ya existe un usuario con ese nombre." });
    users.push({ username: uname, name: nm, role: rl, email: em, centro: rl === "clinica" ? ce : "", password: hashPassword(pw), mustChange: true, active: true });
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
      if (body.centro !== undefined) users[idx].centro = String(body.centro).trim();
      // Un usuario clínica siempre debe tener un centro válido.
      if (users[idx].role === "clinica" && !loadClientsStore().some((c) => c.slug === users[idx].centro)) {
        return json(res, 400, { error: "El usuario clínica tiene que estar atado a un centro válido." });
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
    let clients = loadClientsStore();
    // El rol clínica solo ve SU centro.
    if (me.role === "clinica") clients = clients.filter((c) => c.slug === me.centro);
    return json(res, 200, { clients });
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
    const tipo = String(body.tipo || "consultorio").trim();
    const enAnalisis = !!body.enAnalisis;
    const slug = clientSlugFromName(name);
    const modules = normalizeClientModules(body.activeModules);
    if (!name) return json(res, 400, { error: "Ingresa el nombre del cliente." });
    if (!businessName) return json(res, 400, { error: "Ingresa la razon social." });
    if (!validCuit(cuit)) return json(res, 400, { error: "Ingresa un CUIT valido." });
    if (!slug) return json(res, 400, { error: "El nombre no permite generar un slug valido." });
    if (!modules.length) return json(res, 400, { error: "Selecciona al menos un modulo activo." });
    const clients = loadClientsStore();
    if (clients.some((client) => client.slug === slug)) return json(res, 409, { error: "Ya existe un cliente con ese nombre." });
    const client = normalizeClient({ slug, name, businessName, cuit, ugl, sap, status: "Activo", tipo, enAnalisis, activeModules: modules });
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
      // Si la edición no manda tipo, conservamos el que tenía (no forzar a
      // "consultorio", que fue el bug que devolvía a la dra a Consultorios).
      tipo: body.tipo !== undefined ? body.tipo : clients[idx].tipo,
      enAnalisis: body.enAnalisis !== undefined ? body.enAnalisis : clients[idx].enAnalisis,
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

  // Asignar valor a un código de práctica que vino "sin valor" (persistido).
  const cpvMatch = p.match(/^\/api\/clientes\/([^/]+)\/practice-values$/);
  if (cpvMatch && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(cpvMatch[1]);
    if (!loadClientsStore().some((c) => c.slug === slug)) return json(res, 404, { error: "Cliente no encontrado." });
    const body = await readBody(req);
    const code = cleanIdentifier(body.code);
    const total = money(body.total);
    if (!code) return json(res, 400, { error: "Falta el código de práctica." });
    if (!(total > 0)) return json(res, 400, { error: "Ingresá un valor mayor a 0." });
    const store = loadClientPracticeValues();
    // Se guarda GLOBAL: el valor de un código PAMI es el mismo para todos los
    // clientes, así que asignarlo una vez aplica a todos y a las próximas bandejas.
    if (!store["__global__"]) store["__global__"] = {};
    store["__global__"][code] = {
      total,
      practiceDescription: String(body.practiceDescription || "").replace(/\s+/g, " ").trim(),
      moduleCode: cleanIdentifier(body.moduleCode),
      moduleDescription: String(body.moduleDescription || "").replace(/\s+/g, " ").trim(),
    };
    saveClientPracticeValues(store);
    return json(res, 200, { ok: true, code, total, scope: "global" });
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

  // Export de la comparativa mes vs mes (XLSX con fórmulas o PDF).
  const compExportMatch = p.match(/^\/api\/clientes\/([^/]+)\/dashboard\/comparativa\/export$/);
  if (compExportMatch && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(compExportMatch[1]);
    const client = loadClientsStore().find((item) => item.slug === slug);
    if (!client) return json(res, 404, { error: "Cliente no encontrado." });
    const data = buildClientDashboard(slug, url.searchParams.get("period"), url.searchParams.get("compare"));
    if (!data.current || !data.current.period) return json(res, 400, { error: "No hay mes seleccionado para comparar." });
    if (!data.compare || !data.compare.period) return json(res, 400, { error: "Elegí un mes para comparar antes de exportar." });
    const format = String(url.searchParams.get("format") || "xlsx").toLowerCase();
    const base = downloadName("Comparativa " + client.name + " " + (data.current.label || "") + " vs " + (data.compare.label || "")) || "comparativa";
    try {
      if (format === "pdf") {
        const buf = Buffer.from(await comparativaExport.buildPdf(client, data));
        res.writeHead(200, { "content-type": "application/pdf", "content-length": buf.length, "content-disposition": `attachment; filename="${base}.pdf"`, "cache-control": "no-store" });
        return res.end(buf);
      }
      const buf = comparativaExport.buildXlsx(client, data);
      res.writeHead(200, { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-length": buf.length, "content-disposition": `attachment; filename="${base}.xlsx"`, "cache-control": "no-store" });
      return res.end(buf);
    } catch (error) {
      console.log("[comparativa-export] error:", error && error.message);
      return json(res, 500, { error: "No se pudo generar el archivo." });
    }
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

  // Usuarios médicos del cliente (consultorio). Admin-only: manejan usuario/clave.
  // La clave se guarda encriptada y nunca se devuelve en el listado.
  const clientMedicosMatch = p.match(/^\/api\/clientes\/([^/]+)\/medicos$/);
  if (clientMedicosMatch && (req.method === "GET" || req.method === "POST")) {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador puede ver o cambiar los usuarios médicos." });
    const slug = decodeURIComponent(clientMedicosMatch[1]);
    const client = loadClientsStore().find((item) => item.slug === slug);
    if (!client) return json(res, 404, { error: "Cliente no encontrado." });
    const store = loadClientMedicos();
    const lista = Array.isArray(store[slug]) ? store[slug] : [];
    if (req.method === "GET") {
      return json(res, 200, { medicos: lista.map(medicoPublico) });
    }
    const body = await readBody(req);
    const nombre = String(body.nombre || "").trim();
    if (!nombre) return json(res, 400, { error: "El nombre y apellido es obligatorio." });
    const datos = {
      nombre,
      especialidad: String(body.especialidad || "").trim(),
      usuario: String(body.usuario || "").trim(),
      telefono: String(body.telefono || "").trim(),
    };
    const id = String(body.id || "").trim();
    if (id) {
      const m = lista.find((x) => x.id === id);
      if (!m) return json(res, 404, { error: "Médico no encontrado." });
      Object.assign(m, datos);
      // Clave vacía en edición = se deja la que estaba.
      if (typeof body.clave === "string" && body.clave.length) m.claveEnc = encryptSecret(body.clave);
    } else {
      const nuevo = Object.assign({ id: crypto.randomUUID() }, datos);
      if (typeof body.clave === "string" && body.clave.length) nuevo.claveEnc = encryptSecret(body.clave);
      lista.push(nuevo);
    }
    store[slug] = lista;
    saveClientMedicos(store);
    return json(res, 200, { ok: true, medicos: lista.map(medicoPublico) });
  }
  // Borrar un médico.
  const clientMedicoDelMatch = p.match(/^\/api\/clientes\/([^/]+)\/medicos\/([^/]+)$/);
  if (clientMedicoDelMatch && req.method === "DELETE") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador puede borrar usuarios médicos." });
    const slug = decodeURIComponent(clientMedicoDelMatch[1]);
    const id = decodeURIComponent(clientMedicoDelMatch[2]);
    const store = loadClientMedicos();
    const lista = Array.isArray(store[slug]) ? store[slug] : [];
    const idx = lista.findIndex((x) => x.id === id);
    if (idx < 0) return json(res, 404, { error: "Médico no encontrado." });
    lista.splice(idx, 1);
    store[slug] = lista;
    saveClientMedicos(store);
    return json(res, 200, { ok: true, medicos: lista.map(medicoPublico) });
  }
  // Credenciales de un médico (usuario + clave desencriptada) — admin, para que la
  // app genere OME de especialista. Análogo a /pami/credenciales del cliente.
  const clientMedicoCredMatch = p.match(/^\/api\/clientes\/([^/]+)\/medicos\/([^/]+)\/credenciales$/);
  if (clientMedicoCredMatch && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "forbidden" });
    const slug = decodeURIComponent(clientMedicoCredMatch[1]);
    const id = decodeURIComponent(clientMedicoCredMatch[2]);
    const lista = loadClientMedicos()[slug] || [];
    const m = (Array.isArray(lista) ? lista : []).find((x) => x.id === id);
    if (!m) return json(res, 404, { error: "Médico no encontrado." });
    return json(res, 200, { nombre: m.nombre || "", especialidad: m.especialidad || "", usuario: m.usuario || "", clave: decryptSecret(m.claveEnc), telefono: m.telefono || "" });
  }

  // --- Facturas (panel Pagos) — admin-only ---
  if (p === "/api/facturas" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const store = loadFacturas();
    const creds = loadClientCreds();
    const clientes = loadClientsStore().map((c) => ({ slug: c.slug, name: c.name, tipo: c.tipo || "", pamiUser: (creds[c.slug] || {}).pamiUser || "", tieneClave: !!(creds[c.slug] || {}).pamiPassEnc, ...facturaConfigCliente(store, c.slug) }));
    return json(res, 200, { clientes, registros: store.registros, periodos: store.periodos, archivados: store.archivados, minimoGanancias: store.minimoGanancias });
  }
  // Archivar / desarchivar un período (lo saca de la lista activa).
  if (p === "/api/facturas/periodo/archivar" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const b = await readBody(req);
    const valor = String((b && b.valor) || "").trim();
    const store = loadFacturas();
    store.archivados = store.archivados || [];
    if (b && b.archivar) {
      store.periodos = store.periodos.filter((x) => x !== valor);
      if (store.archivados.indexOf(valor) < 0) store.archivados.push(valor);
    } else {
      store.archivados = store.archivados.filter((x) => x !== valor);
      if (store.periodos.indexOf(valor) < 0) store.periodos.push(valor);
    }
    saveFacturas(store);
    return json(res, 200, { ok: true, periodos: store.periodos, archivados: store.archivados });
  }
  // Mínimo no imponible de Ganancias (global del panel).
  if (p === "/api/facturas/minimo" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const b = await readBody(req);
    const store = loadFacturas();
    store.minimoGanancias = Math.max(0, Number(b && b.valor) || 0);
    saveFacturas(store);
    return json(res, 200, { ok: true, minimoGanancias: store.minimoGanancias });
  }
  // Agregar un período nuevo. Si viene copiarDe, clona las facturas de ese período
  // (mismas descripciones con el mes +1, montos vacíos) para arrancar el mes.
  if (p === "/api/facturas/periodo" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const b = await readBody(req);
    const valor = String((b && b.valor) || "").trim();
    if (!valor) return json(res, 400, { error: "Poné un nombre de período." });
    const store = loadFacturas();
    if (store.periodos.indexOf(valor) < 0) store.periodos.push(valor);
    const copiarDe = String((b && b.copiarDe) || "").trim();
    if (copiarDe && copiarDe !== valor) {
      const fuente = store.registros.filter((r) => r.periodo === copiarDe);
      for (const r of fuente) {
        // Evita duplicar si ya existe ese cliente en el nuevo período.
        if (store.registros.find((x) => x.slug === r.slug && x.periodo === valor)) continue;
        store.registros.push({
          id: crypto.randomUUID(), creado: new Date().toISOString(),
          slug: r.slug, periodo: valor,
          items: (r.items || []).map((it) => ({ label: avanzarMesEnTexto(it.label || ""), monto: 0 })),
          fechaCobro: "", subida: false,
        });
      }
    }
    saveFacturas(store);
    return json(res, 200, { ok: true, periodos: store.periodos, registros: store.registros });
  }
  // Renombrar un período (en la lista y en todos sus registros).
  if (p === "/api/facturas/periodo/renombrar" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const b = await readBody(req);
    const viejo = String((b && b.viejo) || "").trim();
    const nuevo = String((b && b.nuevo) || "").trim();
    if (!nuevo) return json(res, 400, { error: "Poné un nombre." });
    const store = loadFacturas();
    store.periodos = store.periodos.map((x) => (x === viejo ? nuevo : x));
    store.archivados = (store.archivados || []).map((x) => (x === viejo ? nuevo : x));
    store.registros.forEach((r) => { if (r.periodo === viejo) r.periodo = nuevo; });
    saveFacturas(store);
    return json(res, 200, { ok: true, periodos: store.periodos, archivados: store.archivados, registros: store.registros });
  }
  // Borrar un período (y sus facturas de ese período).
  if (p === "/api/facturas/periodo/borrar" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const b = await readBody(req);
    const valor = String((b && b.valor) || "").trim();
    const store = loadFacturas();
    store.periodos = store.periodos.filter((x) => x !== valor);
    store.archivados = (store.archivados || []).filter((x) => x !== valor);
    store.registros = store.registros.filter((r) => r.periodo !== valor);
    saveFacturas(store);
    return json(res, 200, { ok: true, periodos: store.periodos, archivados: store.archivados, registros: store.registros });
  }
  // Guardar la config de facturación de un cliente (% comisión, nº de socios).
  if (p === "/api/facturas/config" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const b = await readBody(req);
    const slug = String((b && b.slug) || "").trim();
    if (!slug) return json(res, 400, { error: "falta slug" });
    const store = loadFacturas();
    const prev = store.config[slug] || {};
    store.config[slug] = {
      comisionPct: Math.max(0, Number(b.comisionPct) || 0),
      socios: Math.max(1, Math.round(Number(b.socios) || 2)),
      retencionPct: b.retencionPct != null ? Math.max(0, Number(b.retencionPct) || 0) : (prev.retencionPct != null ? prev.retencionPct : 2),
      baseComision: (b.baseComision === "neto" || b.baseComision === "bruto") ? b.baseComision : (prev.baseComision || (slug === "st-ignacio" ? "neto" : "bruto")),
    };
    saveFacturas(store);
    return json(res, 200, { ok: true, ...facturaConfigCliente(store, slug) });
  }
  // Crear o actualizar un registro de factura (1 o 2 ítems por período).
  if (p === "/api/facturas" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const b = await readBody(req);
    const slug = String((b && b.slug) || "").trim();
    if (!slug) return json(res, 400, { error: "falta slug" });
    const items = (Array.isArray(b.items) ? b.items : [])
      .map((it) => ({ label: String((it && it.label) || "").trim(), monto: Math.max(0, Number(it && it.monto) || 0) }))
      .filter((it) => it.label || it.monto);
    const reg = {
      slug,
      periodo: String((b && b.periodo) || "").trim(),
      items,
      fechaCobro: String((b && b.fechaCobro) || "").trim(),
      subida: !!(b && b.subida),
    };
    const store = loadFacturas();
    if (reg.periodo && store.periodos.indexOf(reg.periodo) < 0) store.periodos.push(reg.periodo);
    const id = String((b && b.id) || "").trim();
    if (id) {
      const r = store.registros.find((x) => x.id === id);
      if (!r) return json(res, 404, { error: "Factura no encontrada." });
      Object.assign(r, reg);
    } else {
      // Upsert por (cliente + período): la grilla edita "la factura de ese mes".
      const existente = reg.periodo ? store.registros.find((x) => x.slug === slug && x.periodo === reg.periodo) : null;
      if (existente) Object.assign(existente, reg);
      else store.registros.push({ id: crypto.randomUUID(), creado: new Date().toISOString(), ...reg });
    }
    saveFacturas(store);
    return json(res, 200, { ok: true, registros: store.registros });
  }
  // Marcar una factura como cobrada / no cobrada (desde el dashboard).
  if (p === "/api/facturas/cobrado" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const b = await readBody(req);
    const id = String((b && b.id) || "").trim();
    const store = loadFacturas();
    const r = store.registros.find((x) => x.id === id);
    if (!r) return json(res, 404, { error: "Factura no encontrada." });
    r.cobrado = !!(b && b.cobrado);
    saveFacturas(store);
    return json(res, 200, { ok: true });
  }
  // Borrar un registro de factura.
  const facturaDelMatch = p.match(/^\/api\/facturas\/([^/]+)$/);
  if (facturaDelMatch && req.method === "DELETE") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const id = decodeURIComponent(facturaDelMatch[1]);
    const store = loadFacturas();
    const idx = store.registros.findIndex((x) => x.id === id);
    if (idx < 0) return json(res, 404, { error: "Factura no encontrada." });
    store.registros.splice(idx, 1);
    saveFacturas(store);
    return json(res, 200, { ok: true, registros: store.registros });
  }

  // --- Gastos fijos (panel Administración) — admin-only ---
  if (p === "/api/gastos" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const store = loadGastosOSemilla();
    const dolar = await getDolarOficial();
    return json(res, 200, { gastos: store.gastos, pagos: store.pagos, dolar: { valor: dolar.valor, fecha: dolar.fecha } });
  }
  // Crear o actualizar un gasto.
  if (p === "/api/gastos" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const b = await readBody(req);
    const concepto = String((b && b.concepto) || "").trim();
    if (!concepto) return json(res, 400, { error: "Falta el concepto." });
    const datos = {
      concepto,
      dia: Math.min(31, Math.max(1, Math.round(Number(b && b.dia) || 1))),
      monto: Math.max(0, Number(b && b.monto) || 0),
      moneda: (b && b.moneda) === "USD" ? "USD" : "ARS",
    };
    const store = loadGastosOSemilla();
    const id = String((b && b.id) || "").trim();
    if (id) {
      const g = store.gastos.find((x) => x.id === id);
      if (!g) return json(res, 404, { error: "Gasto no encontrado." });
      Object.assign(g, datos);
    } else {
      store.gastos.push({ id: crypto.randomUUID(), ...datos });
    }
    saveGastos(store);
    return json(res, 200, { ok: true, gastos: store.gastos });
  }
  // Borrar un gasto.
  const gastoDelMatch = p.match(/^\/api\/gastos\/([^/]+)$/);
  if (gastoDelMatch && req.method === "DELETE") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const id = decodeURIComponent(gastoDelMatch[1]);
    const store = loadGastosOSemilla();
    const idx = store.gastos.findIndex((x) => x.id === id);
    if (idx < 0) return json(res, 404, { error: "Gasto no encontrado." });
    store.gastos.splice(idx, 1);
    saveGastos(store);
    return json(res, 200, { ok: true, gastos: store.gastos });
  }
  // Marcar un gasto como pagado/no pagado en un período (mes). Al pagar en USD,
  // fija la cotización del dólar de ese momento para que el ARS quede histórico.
  if (p === "/api/gastos/pagado" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const b = await readBody(req);
    const periodo = String((b && b.periodo) || "").trim();
    const gastoId = String((b && b.gastoId) || "").trim();
    if (!periodo || !gastoId) return json(res, 400, { error: "faltan datos" });
    const store = loadGastosOSemilla();
    const gasto = store.gastos.find((x) => x.id === gastoId);
    if (!gasto) return json(res, 404, { error: "Gasto no encontrado." });
    store.pagos = store.pagos || {};
    store.pagos[periodo] = store.pagos[periodo] || {};
    if (b && b.pagado) {
      const reg = { pagado: true };
      if (gasto.moneda === "USD") { const d = await getDolarOficial(); reg.rate = d.valor || 0; }
      store.pagos[periodo][gastoId] = reg;
    } else {
      delete store.pagos[periodo][gastoId];
    }
    saveGastos(store);
    return json(res, 200, { ok: true, pagos: store.pagos });
  }

  // --- Ingresos EXTRA (fuera de comisiones), por mes — admin-only ---
  if (p === "/api/ingresos" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const mes = String(url.searchParams.get("mes") || "").trim();
    const store = loadIngresos();
    const dolar = await getDolarOficial();
    const lista = (mes ? store.ingresos.filter((g) => String(g.mes || "") === mes) : store.ingresos)
      .map((g) => ({ ...g, partes: Math.max(2, Math.round(Number(g.partes) || 2)), nsShareArs: ingresoNSShare(g, dolar.valor) }));
    return json(res, 200, { ingresos: lista, dolar: { valor: dolar.valor, fecha: dolar.fecha } });
  }
  if (p === "/api/ingresos" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const b = await readBody(req);
    const descripcion = String((b && b.descripcion) || "").trim();
    const mes = String((b && b.mes) || "").trim();
    if (!descripcion) return json(res, 400, { error: "Falta la descripción." });
    if (!/^\d{4}-\d{2}$/.test(mes)) return json(res, 400, { error: "Falta el mes (YYYY-MM)." });
    const datos = {
      descripcion, mes,
      monto: Math.max(0, Number(b && b.monto) || 0),
      moneda: (b && b.moneda) === "USD" ? "USD" : "ARS",
      partes: Math.max(2, Math.min(10, Math.round(Number(b && b.partes) || 2))),
    };
    const store = loadIngresos();
    const id = String((b && b.id) || "").trim();
    if (id) {
      const g = store.ingresos.find((x) => x.id === id);
      if (!g) return json(res, 404, { error: "Ingreso no encontrado." });
      Object.assign(g, datos);
    } else {
      store.ingresos.push({ id: crypto.randomUUID(), ...datos });
    }
    saveIngresos(store);
    return json(res, 200, { ok: true, ingresos: store.ingresos });
  }
  const ingresoDelMatch = p.match(/^\/api\/ingresos\/([^/]+)$/);
  if (ingresoDelMatch && req.method === "DELETE") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const id = decodeURIComponent(ingresoDelMatch[1]);
    const store = loadIngresos();
    const idx = store.ingresos.findIndex((x) => x.id === id);
    if (idx < 0) return json(res, 404, { error: "Ingreso no encontrado." });
    store.ingresos.splice(idx, 1);
    saveIngresos(store);
    return json(res, 200, { ok: true, ingresos: store.ingresos });
  }

  // Resultado económico del mes (Inicio): ingresos NS (Nacho+Seba) por fecha de
  // cobro, gastos del mes, en bolsillo (total y por socio) + serie mensual. Admin.
  if (p === "/api/resultado" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const mes = String(url.searchParams.get("mes") || "").trim() || ahoraAR().fecha.slice(0, 7); // YYYY-MM
    const fstore = loadFacturas();
    const nombreCliente = {};
    loadClientsStore().forEach((c) => { nombreCliente[c.slug] = c.name; });
    const gstore = loadGastosOSemilla();
    const dolar = await getDolarOficial();
    let gastos = 0;
    for (const g of gstore.gastos) gastos += g.moneda === "USD" ? (Number(g.monto) || 0) * (dolar.valor || 0) : (Number(g.monto) || 0);
    const del = ingresoNSDelMes(fstore, mes, nombreCliente);
    // Ingresos extra (otros, fuera de comisiones): suman a NS y se reparten 50/50.
    const extra = ingresosExtraDelMes(mes, dolar.valor);
    const extraMitad = extra / 2;
    const ingresoComisiones = del.ingresoNacho + del.ingresoSeba;
    const ingresoNS = ingresoComisiones + extra;
    const gastosMitad = gastos / 2;
    // Serie mes contra mes: desde el inicio del sistema (ago-2026) hasta el mes
    // elegido, sin pasar de los últimos 12. No mostramos meses previos al arranque.
    const INICIO_SISTEMA = "2026-08";
    const serie = [];
    let [yy, mm] = mes.split("-").map(Number);
    for (let i = 11; i >= 0; i--) {
      let m = mm - i, y = yy;
      while (m <= 0) { m += 12; y -= 1; }
      const mStr = y + "-" + String(m).padStart(2, "0");
      if (mStr < INICIO_SISTEMA || mStr > mes) continue;
      const d = ingresoNSDelMes(fstore, mStr, nombreCliente);
      const ing = d.ingresoNacho + d.ingresoSeba + ingresosExtraDelMes(mStr, dolar.valor);
      serie.push({ mes: mStr, ingresoNS: ing, gastos, bolsilloNS: ing - gastos });
    }
    return json(res, 200, {
      mes,
      ingresoNS, ingresoComisiones, ingresoExtra: extra,
      ingresoNacho: del.ingresoNacho + extraMitad, ingresoSeba: del.ingresoSeba + extraMitad,
      gastos, dolar: { valor: dolar.valor, fecha: dolar.fecha },
      bolsilloNS: ingresoNS - gastos,
      bolsilloNacho: del.ingresoNacho + extraMitad - gastosMitad,
      bolsilloSeba: del.ingresoSeba + extraMitad - gastosMitad,
      facturasContadas: del.facturasContadas,
      detalle: del.detalle,
      serie,
    });
  }

  // Bandeja del mes (la sube la app; la lee el panel "Dashboard mes en curso").
  // Honorarios del centro: prácticas por código (cantidad + facturado) + config
  // (cuánto paga por cada código). GET admin o clínica del centro; POST guarda.
  const clientHonorariosMatch = p.match(/^\/api\/clientes\/([^/]+)\/honorarios$/);
  if (clientHonorariosMatch && (req.method === "GET" || req.method === "POST")) {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientHonorariosMatch[1]);
    const permitido = me.role === "admin" || (me.role === "clinica" && me.centro === slug);
    if (!permitido) return json(res, 403, { error: "forbidden" });
    const store = loadHonorarios();
    if (req.method === "GET") {
      // Los honorarios se liquidan sobre lo CERRADO. Listamos los reportes cerrados
      // y calculamos sobre el elegido (o el más nuevo). Si no hay reportes, cae al
      // mes en curso como referencia.
      const rstore = loadClientReportsStore();
      const reportes = (rstore.items || []).filter((r) => r.clientSlug === slug)
        .sort((a, b) => String(b.closedAt || "").localeCompare(String(a.closedAt || ""))).map(reportListItem);
      const reporteId = String(url.searchParams.get("reporte") || "").trim() || (reportes[0] && reportes[0].id) || "";
      let data = reporteId ? buildHonorariosDeReporte(slug, reporteId) : null;
      const fuente = data ? "reporte" : "mescurso";
      if (!data) data = buildHonorariosCodigos(slug);
      return json(res, 200, { fuente, reportes, reporteId, periodo: data.periodo, reporteNombre: data.reporteNombre || "", codigos: data.codigos, config: store[slug] || {} });
    }
    const b = await readBody(req);
    const code = cleanIdentifier(b && b.code);
    if (!code) return json(res, 400, { error: "Falta el código." });
    store[slug] = store[slug] || {};
    const valorVacio = !b || b.valor === "" || b.valor == null;
    const valor = Math.max(0, Number(b && b.valor) || 0);
    if (valorVacio || valor === 0) delete store[slug][code];
    else store[slug][code] = { tipo: (b && b.tipo) === "pct" ? "pct" : "monto", valor };
    saveHonorarios(store);
    return json(res, 200, { ok: true, config: store[slug] });
  }

  // Resumen valorizado de la bandeja del mes en curso (liviano: no devuelve las
  // filas crudas, solo los totales tipo Julio). Va ANTES del match de /bandeja.
  const clientBandejaResumenMatch = p.match(/^\/api\/clientes\/([^/]+)\/bandeja\/resumen$/);
  if (clientBandejaResumenMatch && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientBandejaResumenMatch[1]);
    const client = loadClientsStore().find((item) => item.slug === slug);
    if (!client) return json(res, 404, { error: "Cliente no encontrado." });
    return json(res, 200, { resumen: buildBandejaResumen(slug), adelante: buildBandejaAdelanteResumen(slug), futuros: buildBandejasFuturasResumen(slug), estado: loadBandejaEstado()[slug] || null });
  }

  // Estados de sync de TODOS los clientes (para el reintento nocturno: saber
  // quiénes quedaron con error en la última corrida). Solo admin/operador.
  if (p === "/api/bandeja/estados" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin" && me.role !== "operador") return json(res, 403, { error: "sin permiso" });
    return json(res, 200, { estados: loadBandejaEstado() || {} });
  }

  // Refresco on-demand: la web deja un "pedido"; la PC lo sondea y corre la bajada.
  if (p === "/api/bandeja/refresco/pedir" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin" && me.role !== "operador") return json(res, 403, { error: "sin permiso" });
    const st = loadBandejaRefresco();
    st.pedidoAt = new Date().toISOString();
    st.pedidoPor = me.username || "";
    saveBandejaRefresco(st);
    return json(res, 200, { ok: true, pedidoAt: st.pedidoAt });
  }
  if (p === "/api/bandeja/refresco/estado" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const st = loadBandejaRefresco();
    const pendiente = !!st.pedidoAt && st.pedidoAt !== st.ackAt;
    return json(res, 200, {
      pedidoAt: st.pedidoAt || null, ackAt: st.ackAt || null,
      corriendo: !!st.corriendo, pendiente, terminadoAt: st.terminadoAt || null,
    });
  }
  // La PC avisa que arrancó (corriendo=true) o que terminó (ack del pedido).
  if (p === "/api/bandeja/refresco/ack" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin" && me.role !== "operador") return json(res, 403, { error: "sin permiso" });
    const b = await readBody(req);
    const st = loadBandejaRefresco();
    if (b && b.corriendo) { st.corriendo = true; }
    else {
      st.corriendo = false;
      st.terminadoAt = new Date().toISOString();
      st.ackAt = (b && b.pedidoAt) ? String(b.pedidoAt) : (st.pedidoAt || st.ackAt);
    }
    saveBandejaRefresco(st);
    return json(res, 200, { ok: true, pendiente: !!st.pedidoAt && st.pedidoAt !== st.ackAt });
  }

  // La app reporta el resultado del último sync de cada cliente (ok/error + hora).
  const clientBandejaEstadoMatch = p.match(/^\/api\/clientes\/([^/]+)\/bandeja\/estado$/);
  // Borrar el estado de sync de un cliente (ej. un médico de cabecera que no baja
  // bandeja y quedó con un error viejo). Solo admin.
  if (clientBandejaEstadoMatch && req.method === "DELETE") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const slug = decodeURIComponent(clientBandejaEstadoMatch[1]);
    const store = loadBandejaEstado();
    if (store[slug]) { delete store[slug]; saveBandejaEstado(store); }
    return json(res, 200, { ok: true });
  }
  if (clientBandejaEstadoMatch && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientBandejaEstadoMatch[1]);
    let body = {};
    try { body = JSON.parse((await readBuffer(req)).toString("utf8") || "{}"); } catch {}
    const store = loadBandejaEstado();
    const prev = store[slug] || {};
    const estado = {
      ok: !!body.ok,
      count: Number(body.count) || 0,
      error: String(body.error || "").slice(0, 300),
      at: new Date().toISOString(),
    };
    // Info de transmisión: solo se incluye en la corrida que transmite (1x/día);
    // en las otras corridas se conserva la última conocida.
    if (body.transmitidas !== undefined || body.transmitErrores !== undefined || body.transmitError) {
      estado.transmitidas = Number(body.transmitidas) || 0;
      estado.transmitErrores = Number(body.transmitErrores) || 0;
      estado.transmitError = String(body.transmitError || "").slice(0, 300);
      estado.transmitAt = estado.at;
      // Detalle de las OMEs que no se pudieron transmitir + su leyenda de PAMI.
      estado.omitidosDetalle = Array.isArray(body.omitidosDetalle)
        ? body.omitidosDetalle.slice(0, 100).map((d) => ({
            nroOrden: String((d && d.nroOrden) || "").slice(0, 20),
            motivo: String((d && d.motivo) || "").slice(0, 200),
          }))
        : [];
    } else if (prev.transmitAt) {
      estado.transmitidas = prev.transmitidas || 0;
      estado.transmitErrores = prev.transmitErrores || 0;
      estado.transmitError = prev.transmitError || "";
      estado.transmitAt = prev.transmitAt;
      estado.omitidosDetalle = Array.isArray(prev.omitidosDetalle) ? prev.omitidosDetalle : [];
    }
    store[slug] = estado;
    saveBandejaEstado(store);
    return json(res, 200, { ok: true });
  }

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

  // Bandeja "hacia adelante" (turnos futuros) — la sube la app, la lee la card
  // "Hacia adelante" del Dashboard mes en curso vía /bandeja/resumen (adelante).
  const clientBandejaAdelanteMatch = p.match(/^\/api\/clientes\/([^/]+)\/bandeja-adelante$/);
  if (clientBandejaAdelanteMatch && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientBandejaAdelanteMatch[1]);
    const client = loadClientsStore().find((item) => item.slug === slug);
    if (!client) return json(res, 404, { error: "Cliente no encontrado." });
    let body = {};
    try { body = JSON.parse((await readBuffer(req)).toString("utf8") || "{}"); } catch {}
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 20000) : [];
    const columns = Array.isArray(body.columns) && body.columns.length
      ? body.columns.map(String)
      : (rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]) : []);
    const store = loadClientBandejasAdelante();
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
    saveClientBandejasAdelante(store);
    return json(res, 200, { ok: true, count: rows.length });
  }

  // Bandeja de un MES FUTURO (septiembre, octubre…), bajada por separado.
  const clientBandejaFuturaMatch = p.match(/^\/api\/clientes\/([^/]+)\/bandeja-futura$/);
  if (clientBandejaFuturaMatch && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientBandejaFuturaMatch[1]);
    const client = loadClientsStore().find((item) => item.slug === slug);
    if (!client) return json(res, 404, { error: "Cliente no encontrado." });
    let body = {};
    try { body = JSON.parse((await readBuffer(req)).toString("utf8") || "{}"); } catch {}
    const period = String(body.month || "").trim();
    if (!/^\d{4}-\d{2}$/.test(period)) return json(res, 400, { error: "Falta el período (YYYY-MM)." });
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 20000) : [];
    const columns = Array.isArray(body.columns) && body.columns.length
      ? body.columns.map(String)
      : (rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]) : []);
    const store = loadClientBandejasFuturas();
    if (!store[slug] || typeof store[slug] !== "object") store[slug] = {};
    store[slug][period] = {
      month: period,
      monthLabel: String(body.monthLabel || "").trim(),
      generatedAt: String(body.generatedAt || "").trim(),
      uploadedAt: new Date().toISOString(),
      uploadedBy: me.username,
      count: rows.length,
      columns,
      rows,
    };
    saveClientBandejasFuturas(store);
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
      debitStatus: ["pendiente", "confirmado"].includes(body.debitStatus) ? body.debitStatus : (reportHasRealDebits(rows) ? "confirmado" : "pendiente"),
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
    const report = (loadClientReportsStore().items || []).find((item) => item.clientSlug === slug && item.id === id);
    if (!report) return json(res, 404, { error: "Reporte no encontrado." });
    const mod = reportCobradoModules(report).find((m) => String(m.code) === String(moduleCode));
    if (!mod) return json(res, 400, { error: "El reporte no tiene ese modulo." });
    const buffer = buildProfessionalPdf(report, moduleCode);
    const filename = `${downloadName(report.title || report.sourceFilename || report.id)}-${downloadName(mod.name)}.pdf`;
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

  // Módulos (especialidades) reales de un reporte, para armar el modal de descarga
  // por-especialidad dinámico (en vez del hardcodeo cardio/traumato).
  const clientReportModulesMatch = p.match(/^\/api\/clientes\/([^/]+)\/reportes\/([^/]+)\/modulos$/);
  if (clientReportModulesMatch && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientReportModulesMatch[1]);
    const id = decodeURIComponent(clientReportModulesMatch[2]);
    const report = (loadClientReportsStore().items || []).find((item) => item.clientSlug === slug && item.id === id);
    if (!report) return json(res, 404, { error: "Reporte no encontrado." });
    const modules = reportCobradoModules(report).map((m) => ({ code: m.code, name: m.name, net: m.net, count: m.rows.length }));
    return json(res, 200, { modules });
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
      debitStatus: ["pendiente", "confirmado"].includes(body.debitStatus) ? body.debitStatus : (current.debitStatus || (reportHasRealDebits(rows) ? "confirmado" : "pendiente")),
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
  if (clientReportDetailMatch && req.method === "DELETE") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientReportDetailMatch[1]);
    const id = decodeURIComponent(clientReportDetailMatch[2]);
    const store = loadClientReportsStore();
    const idx = (store.items || []).findIndex((item) => item.clientSlug === slug && item.id === id);
    if (idx < 0) return json(res, 404, { error: "Reporte no encontrado." });
    store.items.splice(idx, 1);
    saveClientReportsStore(store);
    return json(res, 200, { ok: true });
  }

  // Marcar débitos como pendientes de confirmar / confirmados, sin re-guardar el
  // reporte entero. Útil cuando recién al subir la factura llega la validación real.
  const clientReportDebitStatusMatch = p.match(/^\/api\/clientes\/([^/]+)\/reportes\/([^/]+)\/debitos-estado$/);
  if (clientReportDebitStatusMatch && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = decodeURIComponent(clientReportDebitStatusMatch[1]);
    const id = decodeURIComponent(clientReportDebitStatusMatch[2]);
    const body = await readBody(req);
    const estado = body.estado === "confirmado" ? "confirmado" : "pendiente";
    const store = loadClientReportsStore();
    const idx = (store.items || []).findIndex((item) => item.clientSlug === slug && item.id === id);
    if (idx < 0) return json(res, 404, { error: "Reporte no encontrado." });
    store.items[idx] = { ...store.items[idx], debitStatus: estado, updatedAt: new Date().toISOString(), updatedBy: me.username };
    saveClientReportsStore(store);
    return json(res, 200, { report: reportListItem(store.items[idx]) });
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

  // ---- Padrón de afiliados por cliente (solo admin) ----
  // Subir una turnera -> crea/actualiza pacientes (dedup por DNI).
  const padronUpload = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/padron\/upload$/);
  if (padronUpload && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador puede cargar el padrón." });
    const slug = padronUpload[1];
    if (!loadClientsStore().find((c) => c.slug === slug)) return json(res, 404, { error: "Cliente no encontrado." });
    try {
      const raw = await readBuffer(req);
      const multipart = extractMultipart(raw, req.headers["content-type"]);
      const ext = path.extname(multipart.file.filename).toLowerCase();
      if (![".xls", ".xlsx", ".xlsm"].includes(ext)) {
        return json(res, 400, { error: "Subí un archivo Excel .xls, .xlsx o .xlsm." });
      }
      const { rows, total, sinDni } = padronLib.parseTurnera(multipart.file.data);
      const store = loadPadron();
      if (!store[slug]) store[slug] = {};
      const resumen = padronLib.mergeRows(store[slug], rows, "turnera:" + multipart.file.filename, new Date().toISOString());
      savePadron(store);
      return json(res, 200, {
        archivo: multipart.file.filename,
        filas: total, sinDni,
        creados: resumen.creados, actualizados: resumen.actualizados, sinCambio: resumen.sinCambio,
        totalPadron: Object.keys(store[slug]).length,
      });
    } catch (error) {
      return json(res, 400, { error: error.message || "No se pudo procesar la turnera." });
    }
  }

  // Listar / buscar el padrón de un cliente.
  const padronList = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/padron$/);
  if (padronList && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const slug = padronList[1];
    const store = loadPadron();
    const cli = store[slug] || {};
    const q = padronLib.normNombre(url.searchParams.get("q") || "");
    let items = Object.values(cli);
    if (q) {
      const qd = q.replace(/\D+/g, "");
      items = items.filter((it) =>
        padronLib.normNombre(it.nombre).includes(q) ||
        (qd && (it.dni.includes(qd) || (it.beneficio || "").includes(qd)))
      );
    }
    items.sort((a, b) => padronLib.normNombre(a.nombre).localeCompare(padronLib.normNombre(b.nombre)));
    const total = items.length;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "2000", 10) || 2000, 1), 10000);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
    const totalPadron = Object.keys(cli).length;
    const conBeneficio = Object.values(cli).filter((it) => it.beneficio).length;
    return json(res, 200, { total, totalPadron, conBeneficio, items: items.slice(offset, offset + limit) });
  }

  // Buscar un afiliado puntual por DNI o beneficio (para el matcher / búsqueda manual).
  const padronLookup = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/padron\/lookup$/);
  if (padronLookup && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const slug = padronLookup[1];
    const cli = loadPadron()[slug] || {};
    const dni = (url.searchParams.get("dni") || "").replace(/\D+/g, "");
    const benef = (url.searchParams.get("beneficio") || "").replace(/\D+/g, "");
    if (dni && cli[dni]) return json(res, 200, { encontrado: true, afiliado: cli[dni] });
    if (benef) {
      const hit = Object.values(cli).find((it) => it.beneficio === benef);
      if (hit) return json(res, 200, { encontrado: true, afiliado: hit });
    }
    return json(res, 200, { encontrado: false, afiliado: null });
  }

  // Borrar un afiliado del padrón.
  const padronDel = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/padron\/(\d+)$/);
  if (padronDel && req.method === "DELETE") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const [, slug, dni] = padronDel;
    const store = loadPadron();
    if (store[slug] && store[slug][dni]) {
      delete store[slug][dni];
      savePadron(store);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: "No está en el padrón." });
  }

  // DNIs que necesitan que les busquen el beneficio en PAMI: afiliados del padrón
  // con DNI y sin beneficio + informes sin resolver que traen DNI. Lo consume el
  // barrido de la PC (completar_padron_pami.py).
  const padronFaltan = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/padron\/faltan-beneficio$/);
  if (padronFaltan && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const slug = padronFaltan[1];
    const pad = loadPadron()[slug] || {};
    const faltan = new Map(); // dni -> nombre
    for (const it of Object.values(pad)) {
      if (it.dni && !it.beneficio) faltan.set(it.dni, it.nombre || "");
    }
    const infs = ((loadInformes()[slug] || {}).items) || [];
    for (const it of infs) {
      const dni = ((it.extract && it.extract.dni) || "").replace(/\D+/g, "");
      const ben = ((it.extract && it.extract.beneficio) || "").replace(/\D+/g, "");
      const est = it.match && it.match.estado;
      if (!dni || ben || est === "ok" || est === "ya_transmitido") continue;
      if (pad[dni] && pad[dni].beneficio) continue;
      if (!faltan.has(dni)) faltan.set(dni, (it.extract && it.extract.nombre) || "");
    }
    return json(res, 200, { total: faltan.size, items: [...faltan].map(([dni, nombre]) => ({ dni, nombre })) });
  }

  // Carga masiva de beneficios al padrón (lo que trae el barrido de PAMI).
  const padronCompletar = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/padron\/completar$/);
  if (padronCompletar && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const slug = padronCompletar[1];
    let body = {};
    try { body = JSON.parse((await readBuffer(req)).toString("utf8") || "{}"); } catch {}
    const rows = (Array.isArray(body.items) ? body.items : []).map((x) => ({
      dni: String(x.dni || "").replace(/\D+/g, ""),
      beneficio: String(x.beneficio || "").replace(/\D+/g, ""),
      nombre: String(x.nombre || "").trim(),
      tramite: String(x.tramite || "").replace(/\D+/g, ""),
    })).filter((r) => r.dni && r.beneficio);
    const store = loadPadron();
    if (!store[slug]) store[slug] = {};
    const r = padronLib.mergeRows(store[slug], rows, "pami-sweep", new Date().toISOString());
    savePadron(store);
    return json(res, 200, { creados: r.creados, actualizados: r.actualizados, sinCambio: r.sinCambio, recibidos: rows.length });
  }

  // ---- Cabina de informes por cliente (solo admin) ----
  // Subir informes a mano -> los lee (texto/OCR) y los matchea contra bandeja + padrón.
  const informesUp = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/informes\/upload$/);
  if (informesUp && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const slug = informesUp[1];
    if (!loadClientsStore().find((c) => c.slug === slug)) return json(res, 404, { error: "Cliente no encontrado." });
    if (!informeExtract) return json(res, 503, { error: "El motor de lectura de informes no está disponible en el servidor." });
    try {
      const raw = await readBuffer(req, 80 * 1024 * 1024);
      const mp = extractMultipartFiles(raw, req.headers["content-type"]);
      if (!mp.files.length) return json(res, 400, { error: "No subiste ningún informe." });
      const store = loadInformes();
      if (!store[slug]) store[slug] = { items: [], updatedAt: "" };
      const destDir = path.join(informesDir, slug);
      fs.mkdirSync(destDir, { recursive: true });
      const nuevos = [];
      for (const f of mp.files) {
        const ext = path.extname(f.filename).toLowerCase();
        const id = crypto.randomBytes(8).toString("hex");
        const stored = id + ext;
        fs.writeFileSync(path.join(destDir, stored), f.data);
        const rec = await procesarInforme(slug, path.join(destDir, stored), id, stored, f.filename, "upload");
        store[slug].items.unshift(rec);
        nuevos.push(rec);
      }
      store[slug].updatedAt = new Date().toISOString();
      saveInformes(store);
      return json(res, 200, { procesados: nuevos.length, items: nuevos });
    } catch (error) {
      return json(res, 400, { error: error.message || "No se pudieron procesar los informes." });
    }
  }

  // Estado de la casilla de mail conectada (para el botón "Traer del mail").
  if (p === "/api/informes-gmail-estado" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    if (!gmailInformes) return json(res, 200, { conectado: false, motivo: "Descarga de mail no disponible." });
    const token = gmailInformes.cargarToken(dataDir);
    if (!token) return json(res, 200, { conectado: false, motivo: "Falta autorizar la casilla de informes." });
    try {
      const email = await gmailInformes.emailConectado(token);
      return json(res, 200, { conectado: true, email });
    } catch (e) {
      return json(res, 200, { conectado: false, motivo: "No se pudo conectar: " + (e && e.message || e) });
    }
  }

  // Traer informes del mail (rango de fechas) -> los baja, los lee y los matchea.
  const informesGmail = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/informes\/gmail$/);
  if (informesGmail && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const slug = informesGmail[1];
    if (!loadClientsStore().find((c) => c.slug === slug)) return json(res, 404, { error: "Cliente no encontrado." });
    if (!informeExtract) return json(res, 503, { error: "El motor de lectura de informes no está disponible." });
    if (!gmailInformes) return json(res, 503, { error: "La descarga de mail no está disponible." });
    const token = gmailInformes.cargarToken(dataDir);
    if (!token) return json(res, 400, { error: "Falta autorizar la casilla de informes (token_gmail_informes.json)." });
    let body = {};
    try { body = JSON.parse((await readBuffer(req)).toString("utf8") || "{}"); } catch {}
    // Rango en formato YYYY/MM/DD (before es exclusivo). Por defecto: solo hoy.
    const fmt = (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    const hoy = new Date();
    const manana = new Date(hoy.getTime() + 24 * 3600 * 1000);
    const desde = /^\d{4}\/\d{2}\/\d{2}$/.test(body.desde || "") ? body.desde : fmt(hoy);
    const hasta = /^\d{4}\/\d{2}\/\d{2}$/.test(body.hasta || "") ? body.hasta : fmt(manana);
    const TOPE = 40; // por corrida, para no pasar el timeout HTTP de Railway (60s)
    try {
      const store = loadInformes();
      if (!store[slug]) store[slug] = { items: [], updatedAt: "" };
      const existentes = new Set((store[slug].items || []).map((x) => x.filename));
      let bajados = await gmailInformes.descargarAdjuntos(token, desde, hasta, (fn) => existentes.has(fn));
      const hayMas = bajados.length > TOPE;
      bajados = bajados.slice(0, TOPE);
      const destDir = path.join(informesDir, slug);
      fs.mkdirSync(destDir, { recursive: true });
      const nuevos = [];
      for (const f of bajados) {
        const ext = path.extname(f.filename).toLowerCase();
        const id = crypto.randomBytes(8).toString("hex");
        const stored = id + ext;
        fs.writeFileSync(path.join(destDir, stored), f.buffer);
        const rec = await procesarInforme(slug, path.join(destDir, stored), id, stored, f.filename, "mail", f.fecha);
        store[slug].items.unshift(rec);
        nuevos.push(rec);
      }
      store[slug].updatedAt = new Date().toISOString();
      saveInformes(store);
      return json(res, 200, { procesados: nuevos.length, hayMas, desde, hasta, items: nuevos });
    } catch (error) {
      return json(res, 400, { error: (error && error.message) || "No se pudieron traer los informes del mail." });
    }
  }

  // Exportar la cabina a Excel o PDF (para compartir: "esto se subió / se va a subir").
  const informesExport = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/informes\/export\.(xlsx|pdf)$/);
  if (informesExport && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const [, slug, fmt] = informesExport;
    const items = ((loadInformes()[slug] || {}).items) || [];
    const nombre = clientDisplayName(slug);
    if (fmt === "xlsx") {
      const buf = buildInformesWorkbook(items, nombre);
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="informes_${slug}.xlsx"`,
      });
      return res.end(buf);
    }
    const buf = await buildInformesPdf(items, nombre);
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="informes_${slug}.pdf"` });
    return res.end(buf);
  }

  // Listar los informes de un cliente (con su estado de match).
  const informesList = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/informes$/);
  if (informesList && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const slug = informesList[1];
    const cli = loadInformes()[slug] || { items: [], updatedAt: "" };
    const items = cli.items || [];
    // Contadores por estado para el encabezado.
    const resumen = {};
    for (const it of items) {
      const e = (it.resuelto ? "resuelto" : (it.match && it.match.estado) || "sin_match");
      resumen[e] = (resumen[e] || 0) + 1;
    }
    return json(res, 200, { total: items.length, updatedAt: cli.updatedAt || "", resumen, items });
  }

  // Servir el archivo original de un informe (para verlo en la cabina).
  const informeArch = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/informes\/([a-f0-9]+)\/archivo$/);
  if (informeArch && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const [, slug, id] = informeArch;
    const it = ((loadInformes()[slug] || {}).items || []).find((x) => x.id === id);
    if (!it) return json(res, 404, { error: "Informe no encontrado." });
    const file = path.join(informesDir, slug, it.stored);
    if (!fs.existsSync(file)) return json(res, 404, { error: "Archivo no encontrado." });
    const MIME = { ".pdf": "application/pdf", ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".tif": "image/tiff", ".tiff": "image/tiff" };
    const mime = MIME[it.ext] || "application/octet-stream";
    const inline = /pdf|image/.test(mime);
    const buf = fs.readFileSync(file);
    res.writeHead(200, {
      "content-type": mime,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(it.filename)}"`,
      "content-length": buf.length,
      "cache-control": "no-store",
    });
    return res.end(buf);
  }

  // Texto del informe para previsualizar en pantalla. Los .doc/.docx el navegador no
  // los dibuja como al PDF; devolvemos el texto ya extraído (word-extractor/mammoth)
  // para poder leer el contenido sin abrir Word. Se re-lee del archivo guardado (no
  // guardamos el texto entero por informe). Para escaneados corre OCR, que puede tardar.
  const informeTxt = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/informes\/([a-f0-9]+)\/texto$/);
  if (informeTxt && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const [, slug, id] = informeTxt;
    const it = ((loadInformes()[slug] || {}).items || []).find((x) => x.id === id);
    if (!it) return json(res, 404, { error: "Informe no encontrado." });
    if (!informeExtract) return json(res, 503, { error: "El motor de lectura no está disponible." });
    const file = path.join(informesDir, slug, it.stored);
    if (!fs.existsSync(file)) return json(res, 404, { error: "Archivo no encontrado." });
    try {
      const r = await informeExtract.procesar(file, it.filename);
      return json(res, 200, { texto: r.texto || "", ocrUsado: !!r.ocrUsado, error: r.error || null });
    } catch (e) {
      return json(res, 500, { error: String((e && e.message) || e) });
    }
  }

  // Re-matchear un informe (después de actualizar padrón/bandeja) sin volver a leerlo.
  const informeRe = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/informes\/([a-f0-9]+)\/rematch$/);
  if (informeRe && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const [, slug, id] = informeRe;
    const store = loadInformes();
    const it = ((store[slug] || {}).items || []).find((x) => x.id === id);
    if (!it) return json(res, 404, { error: "Informe no encontrado." });
    it.match = matchearInforme(slug, it.extract);
    it.resuelto = null;
    saveInformes(store);
    return json(res, 200, { item: it });
  }

  // Resolver a mano: fijar la OME (y opcionalmente el beneficio) que el operador eligió.
  const informeResolver = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/informes\/([a-f0-9]+)\/resolver$/);
  if (informeResolver && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const [, slug, id] = informeResolver;
    let body = {};
    try { body = JSON.parse((await readBuffer(req)).toString("utf8") || "{}"); } catch {}
    const store = loadInformes();
    const it = ((store[slug] || {}).items || []).find((x) => x.id === id);
    if (!it) return json(res, 404, { error: "Informe no encontrado." });
    // Un informe puede cubrir VARIAS OMEs (típico en otorrino: otomicroscopía +
    // rinomanometría en el mismo estudio). Aceptamos una lista `omes`; `ome` suelto
    // sigue andando para la subida de una sola. El archivo se sube a cada OME.
    let omes = Array.isArray(body.omes) ? body.omes.map((o) => cabinaLib.digs(o)).filter(Boolean) : [];
    const single = cabinaLib.digs(body.ome);
    if (single) omes.push(single);
    omes = [...new Set(omes)]; // sin repetidos, respetando el orden en que se tildaron
    if (!omes.length) return json(res, 400, { error: "Indicá el número de OME." });
    const benef = cabinaLib.digs(body.beneficio) || "";
    it.resuelto = { ome: omes[0], omes, beneficio: benef, por: me.username || me.name || "", at: new Date().toISOString() };
    // Al resolver con "Usar", aprendemos el DNI↔beneficio en el padrón: la próxima
    // vez ese paciente matchea solo (sin volver a resolver a mano).
    const dniR = cabinaLib.digs(it.extract && it.extract.dni);
    if (dniR && benef) {
      const pad = loadPadron();
      if (!pad[slug]) pad[slug] = {};
      padronLib.mergeRows(pad[slug], [{ dni: dniR, beneficio: benef, nombre: (it.extract && it.extract.nombre) || "", tramite: "" }],
        "cabina:" + (me.username || me.name || "admin"), new Date().toISOString());
      savePadron(pad);
    }
    saveInformes(store);
    return json(res, 200, { item: it });
  }

  // Cargarle el beneficio a un informe: lo aprende en el padrón (por DNI, si lo
  // tiene) y re-matchea. Sirve para los "No se encontró": el operador busca el
  // paciente en PAMI, trae el beneficio y con esto queda cargado para siempre.
  const informeBenef = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/informes\/([a-f0-9]+)\/beneficio$/);
  if (informeBenef && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const [, slug, id] = informeBenef;
    let body = {};
    try { body = JSON.parse((await readBuffer(req)).toString("utf8") || "{}"); } catch {}
    const ben = cabinaLib.digs(body.beneficio);
    if (!ben || ben.length < 10) return json(res, 400, { error: "El beneficio tiene que tener al menos 10 dígitos." });
    const store = loadInformes();
    const it = ((store[slug] || {}).items || []).find((x) => x.id === id);
    if (!it) return json(res, 404, { error: "Informe no encontrado." });
    const dni = cabinaLib.digs(it.extract && it.extract.dni);
    let padronActualizado = false;
    if (dni) {
      const pad = loadPadron();
      if (!pad[slug]) pad[slug] = {};
      const r = padronLib.mergeRows(pad[slug], [{ dni, beneficio: ben, nombre: (it.extract && it.extract.nombre) || "", tramite: "" }],
        "cabina:" + (me.username || me.name || "admin"), new Date().toISOString());
      savePadron(pad);
      padronActualizado = (r.creados + r.actualizados) > 0;
    }
    // También lo dejamos en el propio informe, así matchea aunque no tenga DNI.
    it.extract = { ...(it.extract || {}), beneficio: ben };
    it.match = matchearInforme(slug, it.extract);
    saveInformes(store);
    return json(res, 200, { item: it, padronActualizado, dni });
  }

  // Borrar un informe (y su archivo).
  const informeDel = p.match(/^\/api\/clientes\/([a-z0-9-]+)\/informes\/([a-f0-9]+)$/);
  if (informeDel && req.method === "DELETE") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const [, slug, id] = informeDel;
    const store = loadInformes();
    const cli = store[slug] || { items: [] };
    const idx = (cli.items || []).findIndex((x) => x.id === id);
    if (idx < 0) return json(res, 404, { error: "Informe no encontrado." });
    const [it] = cli.items.splice(idx, 1);
    try { fs.unlinkSync(path.join(informesDir, slug, it.stored)); } catch {}
    saveInformes(store);
    return json(res, 200, { ok: true });
  }

  // ---- Credencial provisoria: consulta en vivo a PAMI y devuelve el PDF ----
  if (p === "/api/credencial-provisoria" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    let body = {};
    try { body = JSON.parse((await readBuffer(req)).toString("utf8") || "{}"); } catch {}
    let benef, dni, tramite;
    try {
      benef = credNormBenef(body.benef);
      dni = credNormDni(body.dni);
      tramite = credNormTramite(body.tramite);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
    // Género: el que mandan primero; si falla, probamos los otros (PAMI lo exige
    // exacto). Así no hace falta saberlo con certeza.
    const explicit = credGeneroForm(body.genero);
    const candidatos = [...new Set([explicit, "m", "f", "o"].filter(Boolean))];
    let last = null;
    for (const g of candidatos) {
      try {
        const r = await credConsultarPami(benef, dni, tramite, g);
        last = r;
        if (r.ok) {
          const pdf = await credRecortarCredencial(r.buf);
          res.writeHead(200, {
            "content-type": "application/pdf",
            "content-disposition": `inline; filename="credencial_${dni}.pdf"`,
            "content-length": pdf.length,
            "cache-control": "no-store",
            "x-genero": g,
          });
          return res.end(pdf);
        }
      } catch (e) {
        last = { error: String((e && e.message) || e) };
      }
    }
    const detalle = last && (last.error || `HTTP ${last.status} (${last.ct || "sin tipo"})`);
    return json(res, 502, {
      error: "PAMI no devolvió la credencial. Revisá los datos, o puede que PAMI bloquee la consulta desde el servidor.",
      detalle,
    });
  }

  // Guardar el token de Google (admin). Body: { client_id, client_secret, refresh_token }.
  if (p === "/api/admin/google/token" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    let body = {};
    try { body = JSON.parse((await readBuffer(req)).toString("utf8") || "{}"); } catch {}
    if (!body.client_id || !body.client_secret || !body.refresh_token) return json(res, 400, { error: "Faltan client_id, client_secret o refresh_token." });
    saveGoogleCfg({ client_id: String(body.client_id), client_secret: String(body.client_secret), refresh_token: String(body.refresh_token) });
    try {
      const email = await gcreds.connectedEmail(gcreds.makeAuth(loadGoogleCfg()));
      return json(res, 200, { ok: true, email });
    } catch (e) {
      return json(res, 200, { ok: true, email: "", aviso: "Guardado, pero no pude confirmar el email: " + ((e && e.message) || e) });
    }
  }

  // Estado de la conexión con Google (admin).
  if (p === "/api/admin/google/estado" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const cfg = loadGoogleCfg();
    if (!cfg) return json(res, 200, { connected: false });
    try {
      const email = await gcreds.connectedEmail(gcreds.makeAuth(cfg));
      return json(res, 200, { connected: true, email });
    } catch (e) {
      return json(res, 200, { connected: true, email: "", error: (e && e.message) || String(e) });
    }
  }

  // --- Módulo de credenciales por cliente (Médico de cabecera). ---
  // clientKey en la URL: "scheffelaar" (legacy, app+front) o el slug (ej.
  // dubesarky-ezequiel). Un solo handler para todas las acciones.
  const credM = p.match(/^\/api\/credenciales\/([^/]+)\/([a-z-]+)$/);
  if (credM) {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const C = credCfg(credM[1]);
    if (!C) return json(res, 404, { error: "Cliente sin módulo de credenciales." });
    const slug = C.slug, action = credM[2], st = credState(slug);
    const gcfg = loadGoogleCfg();
    const needGoogle = () => (gcfg ? null : json(res, 400, { error: "Google no está conectado (falta cargar el token, admin)." }));

    if (action === "pendientes" && req.method === "GET") {
      const g = needGoogle(); if (g) return g;
      try { return json(res, 200, await leerPendientesCred(gcreds.makeAuth(gcfg), C, 0)); }
      catch (e) { return json(res, 502, { error: "No pude leer la planilla: " + ((e && e.message) || e) }); }
    }
    if (action === "faltan-benef" && req.method === "GET") {
      const g = needGoogle(); if (g) return g;
      try { return json(res, 200, { faltan: await leerFaltanBenefCred(gcreds.makeAuth(gcfg), C) }); }
      catch (e) { return json(res, 502, { error: "No pude leer la planilla: " + ((e && e.message) || e) }); }
    }
    if (action === "procesar-fila" && req.method === "POST") {
      const g = needGoogle(); if (g) return g;
      const body = await readBody(req);
      return json(res, 200, await procesarCredencialFila(gcreds.makeAuth(gcfg), C, body));
    }
    if (action === "set-benef" && req.method === "POST") {
      const g = needGoogle(); if (g) return g;
      const body = await readBody(req);
      const sheetRow = Number(body.sheetRow) || 0;
      let benef; try { benef = credNormBenef(body.benef); } catch (e) { return json(res, 400, { error: e.message }); }
      if (!sheetRow) return json(res, 400, { error: "Falta la fila." });
      try { await gcreds.writeCell(gcreds.makeAuth(gcfg), C.spreadsheetId, C.tab, gcreds.indexToCol(C.cols.benef) + sheetRow, benef); return json(res, 200, { ok: true, sheetRow, benef }); }
      catch (e) { return json(res, 502, { error: "No pude escribir la planilla: " + ((e && e.message) || e) }); }
    }
    if (action === "schedule" && req.method === "GET") {
      const s = loadCredSchedule(slug);
      return json(res, 200, {
        enabled: s.enabled, hora: s.hora, desdeFila: s.desdeFila, lastRun: s.lastRun, benefRun: s.benefRun,
        corriendo: st.corriendo,
        progreso: st.corriendo ? { total: st.total, hechas: st.hechas, ok: st.ok, sinCred: st.sinCred, err: st.err } : null,
      });
    }
    if (action === "schedule" && req.method === "PUT") {
      if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador puede configurar la corrida." });
      const body = await readBody(req);
      const s = loadCredSchedule(slug);
      s.enabled = !!body.enabled;
      if (typeof body.hora === "string" && /^\d{1,2}:\d{2}$/.test(body.hora.trim())) { const [h, m] = body.hora.trim().split(":"); s.hora = String(h).padStart(2, "0") + ":" + m; }
      if (body.desdeFila !== undefined) s.desdeFila = Math.max(2, Number(body.desdeFila) || 2);
      saveCredSchedule(slug, s);
      return json(res, 200, { ok: true, enabled: s.enabled, hora: s.hora, desdeFila: s.desdeFila });
    }
    if (action === "benef-estado" && req.method === "POST") {
      const body = await readBody(req);
      const s = loadCredSchedule(slug);
      s.benefRun = {
        at: new Date().toISOString(), revisadas: Number(body.revisadas) || 0, completados: Number(body.completados) || 0,
        sinBenef: Number(body.sinBenef) || 0, errores: Number(body.errores) || 0, error: body.error ? String(body.error).slice(0, 200) : "",
      };
      saveCredSchedule(slug, s);
      return json(res, 200, { ok: true });
    }
    if (action === "correr-ahora" && req.method === "POST") {
      if (st.corriendo) return json(res, 200, { ok: false, error: "Ya hay una corrida en curso." });
      correrLoteCredenciales(slug, "manual");
      return json(res, 200, { ok: true });
    }
    if (action === "correr-tanda" && req.method === "POST") {
      if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
      const b = await readBody(req);
      const limite = Math.max(1, Math.min(2000, Number((b && b.limite) || 500)));
      if (st.corriendo) return json(res, 200, { ok: false, error: "Ya hay una corrida en curso." });
      correrLoteCredenciales(slug, "tanda", null, limite);
      return json(res, 200, { ok: true, limite });
    }
    if (action === "correr-filas" && req.method === "POST") {
      const b = await readBody(req);
      const rows = Array.isArray(b && b.rows) ? b.rows.map(Number).filter((n) => n > 0) : [];
      if (!rows.length) return json(res, 400, { error: "sin filas" });
      if (st.corriendo) return json(res, 200, { ok: false, error: "Ya hay una corrida en curso." });
      correrLoteCredenciales(slug, "barrido", rows);
      return json(res, 200, { ok: true, filas: rows.length });
    }
    if (action === "detener" && req.method === "POST") {
      st.stop = true;
      return json(res, 200, { ok: true, corriendo: st.corriendo });
    }
    return json(res, 404, { error: "Acción de credenciales desconocida." });
  }
  // --- Telegram (avisos) ---
  // Estado: si el token llegó al entorno, datos del bot y chat configurado.
  if (p === "/api/admin/telegram/estado" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const cfg = loadTelegramCfg();
    let bot = null, errorBot = "";
    if (telegram.hayToken()) { try { const m = await telegram.getMe(); bot = { usuario: m.username, nombre: m.first_name }; } catch (e) { errorBot = String((e && e.message) || e); } }
    return json(res, 200, { tokenPresente: telegram.hayToken(), varUsada: telegram.nombreVarUsada(), bot, errorBot, chats: cfg.chats });
  }
  // Detecta a quién le escribió el bot (para tomar el chat_id).
  if (p === "/api/admin/telegram/detectar" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    try { const chats = await telegram.chatsRecientes(); return json(res, 200, { ok: true, chats }); }
    catch (e) { return json(res, 200, { ok: false, error: String((e && e.message) || e) }); }
  }
  // Agrega un destinatario a la lista (dedup) y opcionalmente le manda un saludo.
  if ((p === "/api/admin/telegram/guardar-chat" || p === "/api/admin/telegram/agregar-chat") && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const b = await readBody(req);
    const chatId = String((b && b.chatId) || "").trim();
    if (!chatId) return json(res, 400, { error: "falta chatId" });
    const cfg = loadTelegramCfg();
    if (!cfg.chats.find((c) => String(c.chatId) === chatId)) cfg.chats.push({ chatId, nombre: String((b && b.nombre) || "") });
    else if (b && b.nombre) cfg.chats.find((c) => String(c.chatId) === chatId).nombre = String(b.nombre);
    saveTelegramCfg(cfg);
    let saludoOk = null;
    if (b && b.saludo) { try { await telegram.enviar(chatId, String(b.saludo)); saludoOk = true; } catch (e) { saludoOk = false; } }
    return json(res, 200, { ok: true, chats: cfg.chats, saludoOk });
  }
  // Quita un destinatario de la lista.
  if (p === "/api/admin/telegram/quitar-chat" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const b = await readBody(req);
    const chatId = String((b && b.chatId) || "").trim();
    const cfg = loadTelegramCfg();
    cfg.chats = cfg.chats.filter((c) => String(c.chatId) !== chatId);
    saveTelegramCfg(cfg);
    return json(res, 200, { ok: true, chats: cfg.chats });
  }
  // Aviso genérico: cualquier proceso autenticado (ej. el barrido de bandeja de la
  // app) manda su resumen por Telegram sin conocer el token.
  if (p === "/api/avisar" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const b = await readBody(req);
    const texto = String((b && b.texto) || "").trim();
    if (!texto) return json(res, 400, { error: "falta texto" });
    const ok = await avisarTelegram(texto.slice(0, 3500));
    return json(res, 200, { ok });
  }
  // Manda un mensaje de prueba al chat guardado.
  if (p === "/api/admin/telegram/probar" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me || me.role !== "admin") return json(res, 401, { error: "no-auth" });
    const ok = await avisarTelegram("✅ NS Salud: aviso de prueba. El bot está conectado.");
    return json(res, 200, { ok });
  }

  // (faltan-benef y set-benef ahora los maneja el handler paramétrico de arriba.)

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
        estudio: body.estudio,
        valores: sanitizarValores(body.valores),
        firmaArchivo: medico ? medico.firma : "",
        medicoNombre: medico ? medico.nombre : "",
        medicoMatricula: medico ? (medico.matricula || "") : "",
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
          estudio: it.estudio,
          valores: sanitizarValores(it.valores),
          firmaArchivo: medico ? medico.firma : "",
          medicoNombre: medico ? medico.nombre : "",
          medicoMatricula: medico ? (medico.matricula || "") : "",
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
  // Panel Débitos: reglas de cruce (dos estudios el mismo día → PAMI debita uno).
  if (p === "/api/debito-reglas" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    return json(res, 200, loadDebitoStore());
  }
  if (p === "/api/debito-reglas" && req.method === "PUT") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "Solo un administrador." });
    const body = await readBody(req);
    if (!body || !Array.isArray(body.reglas)) return json(res, 400, { error: "Falta la lista de reglas." });
    const guardado = saveDebitoStore(body.reglas, body.umbralPagaPct);
    return json(res, 200, guardado);
  }
  // Descarga genérica del detalle de "Mes en curso" (faltan informes / posibles
  // débitos) en PDF o Excel. Recibe columnas + filas ya armadas por el front.
  if (p === "/api/mescurso/export" && req.method === "POST") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const body = await readBody(req);
    const titulo = String((body && body.titulo) || "Detalle").slice(0, 120);
    const columnas = Array.isArray(body && body.columnas) ? body.columnas.map((c) => String(c).slice(0, 60)) : [];
    const filas = Array.isArray(body && body.filas) ? body.filas.slice(0, 5000).map((f) => Array.isArray(f) ? f : []) : [];
    const moneyCols = Array.isArray(body && body.moneyCols) ? body.moneyCols.map(Number).filter((n) => n >= 0) : [];
    const fmt = (body && body.fmt) === "pdf" ? "pdf" : "xlsx";
    if (!columnas.length) return json(res, 400, { error: "Sin columnas para exportar." });
    const base = downloadName(titulo) || "detalle";
    if (fmt === "pdf") {
      const buf = buildGenericTablePdf(titulo, columnas, filas, moneyCols);
      res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `attachment; filename="${base}.pdf"`, "cache-control": "no-store" });
      return res.end(buf);
    }
    const aoa = [[titulo], [], columnas].concat(filas);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Detalle");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.writeHead(200, { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${base}.xlsx"`, "cache-control": "no-store" });
    return res.end(buf);
  }
  if (p === "/api/informes/config" && req.method === "GET") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    const cfg = loadInformesConfig();
    return json(res, 200, {
      modelos: informes.listarModelos(),
      medicos: (cfg.medicos || []).map((m) => ({
        id: m.id, nombre: m.nombre, hasFirma: firmaExiste(m.firma), matricula: m.matricula || "", modelos: m.modelos || [],
      })),
      descripciones: (cfg.descripciones || []).map((d) => ({
        id: d.id, nombre: d.nombre || "", texto: d.texto, modelos: d.modelos || [], valores: d.valores || {}, ladoTextos: d.ladoTextos || {}, valoresPorSexo: d.valoresPorSexo || {}, textoPorSexo: d.textoPorSexo || {}, estudio: d.estudio || "", medicoId: d.medicoId || "",
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
        cfg.descripciones.push({ id: s.id, nombre: s.nombre, texto: s.texto, modelos: [s.modelo], ladoTextos: s.ladoTextos || {}, valores: s.valores || {}, estudio: s.estudio || "", medicoId: s.medicoId || "" });
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
      { id: "henriquez-gomez-leydy", nombre: "Dra. Leydy Henriquez Gomez", modelos: ["caballito-derma-electro", "caballito-derma-biopsia"] },
      { id: "sanchez-jamilyn", nombre: "Dra. Jamilyn Sánchez", matricula: "MN 189.271", modelos: ["caballito-eco-musculo"] },
      { id: "nirenberg-alberto", nombre: "Dr. Alberto Nirenberg", matricula: "MN 54398", modelos: ["caballito-eco-musculo"] },
    ];
    if (Array.isArray(cfg.medicos)) {
      for (const m of orlMedicos) {
        const ex = cfg.medicos.find((x) => x.id === m.id);
        if (!ex) {
          cfg.medicos.push({ id: m.id, nombre: m.nombre, firma: "firma-" + m.id + ".png", matricula: m.matricula || "", modelos: m.modelos.slice() });
          cambio = true;
        } else {
          if (m.matricula && !ex.matricula) { ex.matricula = m.matricula; cambio = true; }
          // Sumar modelos nuevos a un médico ya sembrado (ej. Leydy: electro + biopsia).
          ex.modelos = Array.isArray(ex.modelos) ? ex.modelos : [];
          for (const k of m.modelos) { if (!ex.modelos.includes(k)) { ex.modelos.push(k); cambio = true; } }
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

// Mantiene al día los presets de Flujometría (son plantillas del seed). Idempotente:
// solo escribe cuando el preset guardado difiere del seed. Fuerza la estructura
// nueva (texto + textoPorSexo + valores + valoresPorSexo) por si venía de una
// versión anterior (donde la posición/diagnóstico iban fijos en `valores`).
function ensureFlujoSeed() {
  try {
    const cfg = loadInformesConfig();
    if (!Array.isArray(cfg.descripciones)) return;
    let cambio = false;
    for (const s of FLUJO_SEED_PRESETS) {
      let d = cfg.descripciones.find((x) => x.id === s.id);
      if (!d) { d = { id: s.id }; cfg.descripciones.push(d); cambio = true; }
      const nd = { nombre: s.nombre, texto: s.texto, textoPorSexo: s.textoPorSexo || {}, modelos: [s.modelo], valores: s.valores, valoresPorSexo: s.valoresPorSexo || {} };
      const antes = JSON.stringify([d.nombre, d.texto, d.textoPorSexo, d.valores, d.valoresPorSexo]);
      const desp = JSON.stringify([nd.nombre, nd.texto, nd.textoPorSexo, nd.valores, nd.valoresPorSexo]);
      if (antes !== desp) { Object.assign(d, nd); if ("ladoTextos" in d) delete d.ladoTextos; cambio = true; }
    }
    if (cambio) saveInformesConfig(cfg);
  } catch (e) { console.log("[flujo-seed] omitido:", e && e.message); }
}
ensureFlujoSeed();

server.listen(port, "0.0.0.0", () => {
  console.log(`NS Web escuchando en puerto ${port} | datos en ${dataDir}`);
});
