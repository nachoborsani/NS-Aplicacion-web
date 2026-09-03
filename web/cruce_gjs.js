"use strict";
// Motor de cruce Grupo Justo: cruza el "Listado de consultas" (AgendaPro) del
// centro contra la "bandeja_transmision" de PAMI para detectar pacientes
// atendidos sin OME facturada. Nace como script de escritorio (ver historial
// del chat) y se porta acá tal cual (v6, validado con datos reales del
// cliente) para ofrecerlo como herramienta web en "Cruzas".
//
// Reglas (todas confirmadas con el cliente sobre datos reales):
//  - Se excluyen del cruce: médico de cabecera (por Especialidad) y
//    particulares (Coseguro > 0).
//  - Cada especialidad/práctica de AgendaPro mapea a uno o más códigos PAMI
//    esperados (MAPA_CODIGO). Dos filas de AgendaPro pueden resolver al MISMO
//    código PAMI (ej. "Cardiología consulta" + "Electrocardiograma" -> 570129,
//    la OME de cardio ya incluye el ECG) - se dedupea por código resuelto.
//  - Por cada código esperado, el estado contra la bandeja es:
//      OK            Transmitida=S y Validada=S
//      FALTA_INFORME Transmitida=N y Validada=S (ya auditado, falta transmitir)
//      PENDIENTE     presente pero ni OK ni FALTA_INFORME (transmisión normal en curso)
//      ERROR_REGION  el código no aparece, pero SÍ aparece su "código hermano"
//                    de la región opuesta (ej. venoso MMSS en vez de MMII)
//      AUSENTE       no aparece ni el código ni su hermano
//  - El PEOR estado de todos los códigos esperados de un paciente define su
//    color: OK->VERDE, PENDIENTE->AMARILLO, FALTA_INFORME->NARANJA,
//    AUSENTE/ERROR_REGION->ROJO.
//  - Matching agenda<->bandeja: primero por N° de beneficio exacto. El
//    beneficio cargado a mano en AgendaPro casi nunca coincide dígito a dígito
//    con el de la bandeja (typos, sufijos de más/menos) así que si no
//    coincide se prueba por NOMBRE: exacto (mismos tokens, cualquier orden -
//    "RUIZ DIAZ RAMON" vs "RAMON RUIZ DIAZ") y si tampoco, por SIMILITUD
//    (cada componente/token >=80% de similitud estilo difflib
//    SequenceMatcher, y el promedio de todos los componentes >=90% - así
//    "MARTINEZ MERCEDES EVA" matchea con "MARTINEZ MERCEDES EV" truncado).
//    Un match por nombre ÚNICO (exacto o por similitud) colorea igual que si
//    el beneficio hubiera coincidido - el desfasaje de beneficio queda solo
//    como nota informativa en el detalle. GRIS queda RESERVADO para nombre
//    AMBIGUO (mismo nombre, más de un beneficio candidato: no hay forma de
//    elegir sin ayuda humana).

const XLSX = require("xlsx");

function soloDigitos(v) { return String(v == null ? "" : v).replace(/\D+/g, ""); }
function limpiar(v) {
  return String(v == null ? "" : v)
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&Uacute;/g, "Ú")
    .replace(/¿/g, "Ñ").replace(/\s+/g, " ").trim();
}
function claveComp(v) {
  return limpiar(v).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function claveNombre(v) {
  return claveComp(v).split(" ").filter(Boolean).sort().join(" ");
}
function tokensDe(v) { return claveComp(v).split(" ").filter(Boolean); }

// ---- Similitud de texto (estilo difflib.SequenceMatcher.ratio: 2*M/T) ----
function bloqueComunMasLargo(a, alo, ahi, b, blo, bhi) {
  let mejor = 0, mi = alo, mj = blo;
  for (let i = alo; i < ahi; i++) {
    for (let j = blo; j < bhi; j++) {
      let k = 0;
      while (i + k < ahi && j + k < bhi && a[i + k] === b[j + k]) k++;
      if (k > mejor) { mejor = k; mi = i; mj = j; }
    }
  }
  return [mi, mj, mejor];
}
function totalCoincidencias(a, alo, ahi, b, blo, bhi) {
  const [i, j, k] = bloqueComunMasLargo(a, alo, ahi, b, blo, bhi);
  if (!k) return 0;
  let total = k;
  if (alo < i && blo < j) total += totalCoincidencias(a, alo, i, b, blo, j);
  if (i + k < ahi && j + k < bhi) total += totalCoincidencias(a, i + k, ahi, j + k, bhi);
  return total;
}
function similitud(a, b) {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const m = totalCoincidencias(a, 0, a.length, b, 0, b.length);
  return (2 * m) / (a.length + b.length);
}
function similitudNombres(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return { ok: false, promedio: 0 };
  const [ref, otros] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  const disponibles = otros.slice();
  const scores = [];
  for (const t of ref) {
    let mejorScore = 0, mejorIdx = -1;
    disponibles.forEach((c, i) => { const r = similitud(t, c); if (r > mejorScore) { mejorScore = r; mejorIdx = i; } });
    scores.push(mejorScore);
    if (mejorIdx >= 0) disponibles.splice(mejorIdx, 1);
  }
  const pisoOk = scores.every((s) => s >= 0.80);
  const promedio = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { ok: pisoOk && promedio >= 0.90, promedio };
}

const MAPA_CODIGO_RAW = {
  "OTORRINOLARINGOLOGIA|CONSULTA": { codigo: "820168", nombre: "Consulta Otorrino" },
  "LAVAJE DE OIDO": { codigo: "717111", nombre: "Extraccion cerumen" },
  "DIABETOLOGIA|CONSULTA": { codigo: "820171", nombre: "Consulta Diabetologia" },
  "FLEBOLOGIA|CONSULTA": { codigo: "820143", nombre: "Consulta Flebologia" },
  "REUMATOLOGIA|CONSULTA": { codigo: "820163", nombre: "Consulta Reumatologia" },
  "ENDOCRINOLOGÍA|CONSULTA": { codigo: "820118", nombre: "Consulta Endocrinologia" },
  "CARDIOLOGIA|CONSULTA": { codigo: "570129", nombre: "Consulta Cardiologia (c/ECG)" },
  "ELECTROCARDIOGRAMA": { codigo: "570129", nombre: "Consulta Cardiologia (c/ECG)" },
  "DOPPLER CARDÍACO": { codigo: "180301", nombre: "Ecodoppler Cardiaco" },
  "DOPPLER VASOS DE CUELLO": { codigo: "180607", nombre: "Ecodoppler vasos del cuello" },
  "MAPA": { codigo: "570120", nombre: "Presurometria / MAPA" },
  "ERGOMETRIA": { codigo: "570124", nombre: "Ergometria" },
  "ESCLEROTERAPIA": { codigo: "487610", nombre: "Tto. esclerosante" },
  "ECO DOPPLER ARTERIAL DE MMII": { codigo: "180610", nombre: "Ecodoppler arterial MMII" },
  "ECO DOPPLER VENOSO DE MMII": { codigo: "180606", nombre: "Ecodoppler venoso MMII" },
  "ECO DOPPLER ARTERIAL DE MMSS": { codigo: "180611", nombre: "Ecodoppler arterial MMSS" },
  "ECO DOPPLER VENOSO DE MMSS": { codigo: "180612", nombre: "Ecodoppler venoso MMSS" },
  "DOPPLER ARTEREOVENOSO DE MMII": { nombre: "Ecodoppler arterial y venoso MMII (ambos)", ambos: ["180610", "180606"] },
  "ECO DOPPLER MMII VENOSO Y ARTERIAL": { nombre: "Ecodoppler arterial y venoso MMII (ambos)", ambos: ["180610", "180606"] },
};
const MAPA_CODIGO = new Map();
for (const [k, v] of Object.entries(MAPA_CODIGO_RAW)) MAPA_CODIGO.set(claveComp(k), v);
function buscarMapa(clave) { return MAPA_CODIGO.get(claveComp(clave)); }

const HERMANO_REGION = { "180610": "180611", "180611": "180610", "180606": "180612", "180612": "180606" };
const SEVERIDAD = { ERROR_REGION: 5, AUSENTE: 4, FALTA_INFORME: 3, PENDIENTE: 2, OK: 1 };
function peor(a, b) { return SEVERIDAD[a] >= SEVERIDAD[b] ? a : b; }

function readRows(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", raw: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
}

function estadoCodigo(rowsBand, codigo) {
  const filas = rowsBand.filter((b) => b.codigo === codigo);
  if (filas.length) {
    if (filas.some((b) => b.trasmitida === "S" && b.validada === "S")) return { estado: "OK" };
    if (filas.some((b) => b.trasmitida === "N" && b.validada === "S")) return { estado: "FALTA_INFORME" };
    return { estado: "PENDIENTE" };
  }
  const hermano = HERMANO_REGION[codigo];
  if (hermano && rowsBand.some((b) => b.codigo === hermano)) return { estado: "ERROR_REGION", hermano };
  return { estado: "AUSENTE" };
}

// agendaBuffer / bandejaBuffer: Buffer del .xls/.xlsx tal cual se sube.
// valorPorCodigo: Map(codigo -> monto $) o null si no hay nomenclador cargado.
function calcularCruce({ agendaBuffer, bandejaBuffer, valorPorCodigo }) {
  const valores = valorPorCodigo || new Map();
  const rows1 = readRows(agendaBuffer);
  const EXCLUIR_ESPECIALIDAD = new Set(["MEDICOS DE CABECERA PAMI"]);
  const cons = [];
  let excluidosCabecera = 0, excluidosParticular = 0;
  for (let i = 1; i < rows1.length; i++) {
    const r = rows1[i];
    if (!r || !r.length) continue;
    const beneficio = soloDigitos(r[10]);
    if (!beneficio) continue;
    const especialidadDisplay = limpiar(r[5]);
    const especialidad = claveComp(r[5]);
    const coseguro = Number(String(r[20]).replace(/[^\d.-]/g, "")) || 0;
    if (EXCLUIR_ESPECIALIDAD.has(especialidad)) { excluidosCabecera++; continue; }
    if (coseguro > 0) { excluidosParticular++; continue; }
    cons.push({
      beneficio, dni: soloDigitos(r[7]), nombre: limpiar(r[6]),
      fecha: limpiar(r[0]), hora: limpiar(r[1]), especialidad, especialidadDisplay,
      practica: claveComp(r[25]),
    });
  }

  const rows2 = readRows(bandejaBuffer);
  const band = [];
  for (let i = 1; i < rows2.length; i++) {
    const r = rows2[i];
    if (!r || !r.length) continue;
    const beneficio = soloDigitos(r[2]);
    if (!beneficio) continue;
    const practicaFull = limpiar(r[4]);
    const codigo = practicaFull.split(" - ")[0].trim();
    band.push({
      beneficio, nombre: limpiar(r[3]), nombreClave: claveNombre(r[3]), codigo, descripcion: practicaFull,
      turno: limpiar(r[5]), trasmitida: limpiar(r[8]).toUpperCase(), validada: limpiar(r[11]).toUpperCase(),
    });
  }
  const bandPorBeneficio = new Map();
  const bandPorNombre = new Map();
  const identidades = new Map();
  for (const b of band) {
    if (!bandPorBeneficio.has(b.beneficio)) bandPorBeneficio.set(b.beneficio, []);
    bandPorBeneficio.get(b.beneficio).push(b);
    if (!bandPorNombre.has(b.nombreClave)) bandPorNombre.set(b.nombreClave, new Map());
    const porBenef = bandPorNombre.get(b.nombreClave);
    if (!porBenef.has(b.beneficio)) porBenef.set(b.beneficio, []);
    porBenef.get(b.beneficio).push(b);
    if (!identidades.has(b.beneficio)) identidades.set(b.beneficio, { tokens: tokensDe(b.nombre), nombre: b.nombre, filas: bandPorBeneficio.get(b.beneficio) });
  }

  const porPaciente = new Map();
  for (const c of cons) {
    if (!porPaciente.has(c.beneficio)) porPaciente.set(c.beneficio, { nombre: c.nombre, dni: c.dni, filas: [] });
    porPaciente.get(c.beneficio).filas.push(c);
  }

  // Códigos que reconocemos (valores de MAPA_CODIGO): sirve para no traer al
  // pasar de "Ausentes" ruido de prácticas que no seguimos.
  const CODIGOS_TRACKEADOS = new Set();
  for (const v of Object.values(MAPA_CODIGO_RAW)) (v.ambos || [v.codigo]).forEach((c) => c && CODIGOS_TRACKEADOS.add(c));

  const pacientes = [];
  const faltaOmeAuto = []; // "atendido pero sin OME": lo que antes llamábamos AUSENTE/ERROR_REGION
  const faltaInforme = [];
  // beneficio(real, del lado bandeja)+código de cualquier atendido, aunque la
  // OME le falte o esté pendiente - así lo separamos del universo de
  // "Ausentes" (turno reservado que nadie de la agenda reclamó = no vino).
  const reclamados = new Set();

  for (const [beneficio, info] of porPaciente) {
    const filas = info.filas;
    let rowsBand = bandPorBeneficio.get(beneficio) || [];
    let matchPorNombre = null;

    if (!rowsBand.length) {
      const candidatos = bandPorNombre.get(claveNombre(info.nombre));
      if (candidatos && candidatos.size === 1) {
        const [beneficioBandeja, filasCand] = candidatos.entries().next().value;
        rowsBand = filasCand;
        matchPorNombre = { beneficioBandeja, exacto: true };
      } else if (candidatos && candidatos.size > 1) {
        matchPorNombre = { ambiguo: true };
      } else {
        const tokensAgenda = tokensDe(info.nombre);
        const candidatosSim = [];
        for (const [beneficioBandeja, ident] of identidades) {
          const sim = similitudNombres(tokensAgenda, ident.tokens);
          if (sim.ok) candidatosSim.push({ beneficioBandeja, filas: ident.filas, promedio: sim.promedio, nombreBandeja: ident.nombre });
        }
        if (candidatosSim.length === 1) {
          rowsBand = candidatosSim[0].filas;
          matchPorNombre = { beneficioBandeja: candidatosSim[0].beneficioBandeja, aproximado: true, promedio: candidatosSim[0].promedio, nombreBandeja: candidatosSim[0].nombreBandeja };
        } else if (candidatosSim.length > 1) {
          matchPorNombre = { ambiguo: true, aproximado: true };
        }
      }
    }

    const especialidades = [...new Set(filas.map((f) => f.especialidad))];
    const especialidadesDisplay = [...new Set(filas.map((f) => f.especialidadDisplay))];
    const esperados = [];
    let sinMapeo = false;

    for (const esp of especialidades) {
      const filasEsp = filas.filter((f) => f.especialidad === esp);
      const espDisplay = filasEsp.length ? filasEsp[0].especialidadDisplay : "";
      const turnoDe = (fs) => fs.length ? `${fs[0].fecha} ${fs[0].hora}`.trim() : "";
      if (esp === "OTORRINOLARINGOLOGIA") {
        const filaLavado = filasEsp.filter((f) => f.practica === "LAVAJE DE OIDO");
        esperados.push(Object.assign({ clave: "OTORRINOLARINGOLOGIA|CONSULTA", turno: turnoDe(filasEsp), especialidadDisplay: espDisplay }, buscarMapa("OTORRINOLARINGOLOGIA|CONSULTA")));
        if (filaLavado.length) esperados.push(Object.assign({ clave: "LAVAJE DE OIDO", turno: turnoDe(filaLavado), especialidadDisplay: espDisplay }, buscarMapa("LAVAJE DE OIDO")));
      } else if (esp === "CARDIO ESTUDIOS") {
        for (const f of filasEsp) {
          const m = buscarMapa(f.practica);
          if (m) esperados.push(Object.assign({ clave: f.practica, turno: `${f.fecha} ${f.hora}`.trim(), especialidadDisplay: espDisplay }, m));
          else sinMapeo = true;
        }
      } else {
        const filasConsulta = filasEsp.filter((f) => f.practica === "CONSULTA");
        if (filasConsulta.length) {
          const clave = esp + "|CONSULTA";
          const m = buscarMapa(clave);
          if (m) esperados.push(Object.assign({ clave, turno: turnoDe(filasConsulta), especialidadDisplay: espDisplay }, m));
          else sinMapeo = true;
        }
        for (const f of filasEsp) {
          if (f.practica === "CONSULTA") continue;
          const m = buscarMapa(f.practica);
          if (m) esperados.push(Object.assign({ clave: f.practica, turno: `${f.fecha} ${f.hora}`.trim(), especialidadDisplay: espDisplay }, m));
          else sinMapeo = true;
        }
      }
    }

    const vistos = new Set();
    const esperadosUnicos = esperados.filter((e) => {
      const k = e.ambos ? e.ambos.slice().sort().join("+") : e.codigo;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });

    // El beneficio "real" del lado bandeja: si matcheamos por nombre, es el de
    // la bandeja (distinto al de agenda); si no, es el mismo. Sirve para
    // marcar como "reclamado" (atendido) el turno correspondiente y así no
    // contarlo después como no-show en "Ausentes".
    const beneficioBandejaReal = (matchPorNombre && matchPorNombre.beneficioBandeja) || beneficio;

    const detalle = [];
    let peorEstado = "OK";
    for (const e of esperadosUnicos) {
      const codigos = e.ambos || [e.codigo];
      let estadoItem = "OK";
      const notas = [];
      for (const cod of codigos) {
        reclamados.add(beneficioBandejaReal + "|" + cod);
        const r = estadoCodigo(rowsBand, cod);
        estadoItem = peor(estadoItem, r.estado);
        if (r.estado === "ERROR_REGION") notas.push(`se encontró ${r.hermano} (región opuesta) en vez de ${cod}`);
      }
      peorEstado = peor(peorEstado, estadoItem);
      const textos = {
        OK: "OK",
        PENDIENTE: "presente pero no transmitida/validada",
        FALTA_INFORME: "falta informe (validada, pendiente de transmitir)",
        ERROR_REGION: "posible error de región" + (notas.length ? " - " + notas.join("; ") : ""),
        AUSENTE: "NO encontrado en bandeja",
      };
      detalle.push(`${e.nombre}: ${textos[estadoItem]}`);

      const codigoPrincipal = codigos[0];
      const descripcionItem = `${codigoPrincipal} - ${e.nombre}`;
      if (estadoItem === "FALTA_INFORME") {
        faltaInforme.push({ beneficio, nombre: info.nombre, practica: descripcionItem, turno: e.turno || "", valor: valores.get(codigoPrincipal) || 0 });
      } else if (estadoItem === "AUSENTE" || estadoItem === "ERROR_REGION") {
        faltaOmeAuto.push({ turno: e.turno || "", especialidad: e.especialidadDisplay || "", nombre: info.nombre, beneficio, obs: "Sin ome", valor: valores.get(codigoPrincipal) || 0 });
      }
    }
    if (sinMapeo) { peorEstado = peor(peorEstado, "PENDIENTE"); detalle.push("Especialidad/practica sin mapeo conocido (posible Holter u otra no catalogada) - revisar en CUP"); }
    if (!esperadosUnicos.length && !sinMapeo) { peorEstado = peor(peorEstado, "PENDIENTE"); detalle.push("Sin tipo de practica reconocido"); }

    let color;
    if (matchPorNombre && matchPorNombre.ambiguo) {
      color = "GRIS";
      detalle.unshift(`⚠ Nombre${matchPorNombre.aproximado ? " (por similitud)" : ""} encontrado en la bandeja con MÁS DE UN beneficio distinto - no se pudo elegir cuál es, revisar a mano.`);
    } else {
      color = { OK: "VERDE", PENDIENTE: "AMARILLO", FALTA_INFORME: "NARANJA", AUSENTE: "ROJO", ERROR_REGION: "ROJO" }[peorEstado];
      if (matchPorNombre && matchPorNombre.aproximado) {
        detalle.unshift(`ℹ Nombre distinto pero similar (${Math.round(matchPorNombre.promedio * 100)}% de coincidencia: agenda "${info.nombre}" vs bandeja "${matchPorNombre.nombreBandeja}") y beneficio no coincide (agenda ${beneficio} / bandeja ${matchPorNombre.beneficioBandeja}).`);
      } else if (matchPorNombre) {
        detalle.unshift(`ℹ Beneficio de agenda (${beneficio}) no coincide con el de la bandeja (${matchPorNombre.beneficioBandeja}) - matcheado por nombre.`);
      }
    }

    pacientes.push({
      beneficio, dni: info.dni, nombre: info.nombre, especialidades: especialidadesDisplay.join(", "),
      color, colorOriginal: color, detalle: detalle.join(" | "), detalleOriginal: detalle.join(" | "),
    });
  }

  const resumen = { verde: 0, amarillo: 0, naranja: 0, rojo: 0, gris: 0 };
  for (const p of pacientes) resumen[p.color.toLowerCase()] = (resumen[p.color.toLowerCase()] || 0) + 1;

  // "Ausentes" (no-shows): OME pinchada en la bandeja pero nunca validada, y
  // que ningún atendido de la agenda reclamó para ese mismo beneficio+código.
  // El listado de consultas de GJS solo trae atendidos, así que estos
  // pacientes directamente no aparecen ahí - se detectan mirando SOLO la
  // bandeja. Se dedupea por beneficio+código+turno (una fila por franja).
  const ausentesVistos = new Set();
  const ausentes = [];
  for (const b of band) {
    if (!CODIGOS_TRACKEADOS.has(b.codigo)) continue;
    if (b.validada === "S") continue; // ya se validó -> alguien vino (falta informe u OK)
    if (reclamados.has(b.beneficio + "|" + b.codigo)) continue; // atendido: no es no-show
    const k = b.beneficio + "|" + b.codigo + "|" + b.turno;
    if (ausentesVistos.has(k)) continue;
    ausentesVistos.add(k);
    ausentes.push({ beneficio: b.beneficio, nombre: b.nombre, practica: b.descripcion, turno: b.turno, valor: valores.get(b.codigo) || 0 });
  }

  return { excluidosCabecera, excluidosParticular, pacientes, ausentes, faltaOmeAuto, faltaInforme, resumen };
}

module.exports = { calcularCruce };
