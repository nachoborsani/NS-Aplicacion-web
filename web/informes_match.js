"use strict";
// Matcher de informes contra la bandeja, usando el padrón de afiliados.
//
// Estrategia (en orden de confianza):
//   1. Beneficio exacto: del informe, o resuelto vía padrón (DNI -> beneficio).
//      Clava el paciente sin ambigüedad. Entre sus OMEs se elige la práctica.
//   2. Nombre (fallback): fuzzy contra la bandeja cuando no hay beneficio.
// Todo lo dudoso queda marcado para revisión manual (nunca se matchea en silencio).

function soloDigitos(v) { return String(v == null ? "" : v).replace(/\D+/g, ""); }
function norm(v) {
  return String(v == null ? "" : v)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(v) { return norm(v).split(" ").filter((t) => t.length >= 2); }

// Similitud de nombres por tokens: cuántos tokens del informe están en el de la
// bandeja (el informe suele ser prefijo del nombre completo). 0..1.
function scoreNombre(a, b) {
  const ta = tokens(a), tb = new Set(tokens(b));
  if (!ta.length || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit / ta.length;
}

const CODIGO_CONSULTA = /(^|\D)(8201\d\d|4201\d\d|consulta)/i;
function esConsulta(practica) { return CODIGO_CONSULTA.test(String(practica || "")); }

// Equivalencias de práctica: un informe de una práctica también vale para otra.
// ECG: un electrocardiograma sirve para una CONSULTA DE CARDIOLOGÍA (que incluye
// electro). Se prueban solo si no hubo match directo por texto (se prefiere la
// práctica específica; si no está, cae a la consulta de cardio). norm() ya devuelve
// mayúsculas sin acentos, así que las patterns van en mayúscula.
const _EQUIV_PRACTICA = {
  ELECTROCARDIOGRAMA: [/ELECTROCARDIOGRAMA/, /CARDIOLOG/, /\b570129\b/, /\b820113\b/],
};

// Resuelve el beneficio de un informe: el que trae, o el del padrón por DNI.
function resolverBeneficio(informe, padronCliente) {
  const b = soloDigitos(informe.beneficio);
  if (b) return { beneficio: b, via: "informe" };
  const dni = soloDigitos(informe.dni);
  if (dni && padronCliente && padronCliente[dni] && padronCliente[dni].beneficio) {
    return { beneficio: soloDigitos(padronCliente[dni].beneficio), via: "padron" };
  }
  return { beneficio: "", via: null };
}

// Cuando el informe SOLO trae nombre (MAPA, escaneados): lo cruza contra el padrón
// por nombre para recuperar el beneficio. Exige que TODOS los tokens del informe
// estén en un ÚNICO afiliado (sin empate) — si hay dos candidatos, no adivina.
function resolverPorNombre(nombre, padronCliente) {
  if (!tokens(nombre).length) return null;
  let mejor = null, mejorScore = 0, empate = false;
  for (const it of Object.values(padronCliente || {})) {
    if (!it || !it.beneficio) continue;
    const s = scoreNombre(nombre, it.nombre);
    if (s > mejorScore) { mejorScore = s; mejor = it; empate = false; }
    else if (s === mejorScore && s > 0 && it.nombre !== (mejor && mejor.nombre)) empate = true;
  }
  if (mejor && mejorScore >= 1 && !empate) {
    return { beneficio: soloDigitos(mejor.beneficio), via: "padron_nombre" };
  }
  return null;
}

// Elige, entre las prestaciones de un mismo paciente, la que corresponde al
// informe. practicaHint = código/keywords detectados del informe (opcional).
function elegirPractica(prestaciones, practicaHint) {
  if (prestaciones.length === 1) return { elegida: prestaciones[0], ambiguo: false };
  const hint = norm(practicaHint);
  if (hint) {
    const porCodigo = prestaciones.filter((p) => soloDigitos(practicaHint) && String(p.practica || "").includes(soloDigitos(practicaHint)));
    if (porCodigo.length === 1) return { elegida: porCodigo[0], ambiguo: false };
    const porTexto = prestaciones.filter((p) => hint && norm(p.practica).includes(hint));
    if (porTexto.length === 1) return { elegida: porTexto[0], ambiguo: false };
    // Equivalencias (ej. ECG → consulta cardio): solo si no hubo match directo.
    const equivs = _EQUIV_PRACTICA[hint];
    if (equivs && porTexto.length === 0) {
      const porEquiv = prestaciones.filter((p) => equivs.some((re) => re.test(norm(p.practica))));
      if (porEquiv.length === 1) return { elegida: porEquiv[0], ambiguo: false };
    }
  }
  const noConsulta = prestaciones.filter((p) => !esConsulta(p.practica));
  if (noConsulta.length === 1) return { elegida: noConsulta[0], ambiguo: false };
  return { elegida: null, ambiguo: true };
}

// informe: { dni, beneficio, nombre, practicaHint }
// bandeja: [ { nOrden, beneficio, nombre, practica, turno, validada, transmitida } ]
// padronCliente: { [dni]: { beneficio, ... } }
// Devuelve { estado, ome, prestacion, via, confianza, candidatos }
function matchInforme(informe, bandeja, padronCliente) {
  let { beneficio, via } = resolverBeneficio(informe, padronCliente || {});
  // Si no hay beneficio por informe ni por DNI, probar por NOMBRE contra el padrón.
  if (!beneficio && informe.nombre) {
    const porNom = resolverPorNombre(informe.nombre, padronCliente || {});
    if (porNom) { beneficio = porNom.beneficio; via = porNom.via; }
  }

  // 1) Camino exacto por beneficio
  if (beneficio) {
    const delPaciente = bandeja.filter((p) => soloDigitos(p.beneficio) === beneficio);
    if (delPaciente.length) {
      const { elegida, ambiguo } = elegirPractica(delPaciente, informe.practicaHint);
      if (elegida) {
        return {
          estado: elegida.transmitida ? "ya_transmitido" : "ok",
          ome: elegida.nOrden || "",
          prestacion: elegida,
          via: "beneficio_" + via,
          confianza: "alta",
          candidatos: delPaciente,
        };
      }
      // paciente clavado pero con varias prácticas posibles -> revisar cuál
      return { estado: "revisar_practica", ome: "", prestacion: null,
        via: "beneficio_" + via,
        confianza: "media", candidatos: delPaciente };
    }
    // tiene beneficio pero no está en la bandeja de este período
    return { estado: "sin_ome", ome: "", prestacion: null, via: "beneficio", confianza: "media", candidatos: [] };
  }

  // 2) Fallback por nombre
  const conScore = bandeja
    .map((p) => ({ p, s: scoreNombre(informe.nombre, p.nombre) }))
    .filter((x) => x.s >= 0.6)
    .sort((a, b) => b.s - a.s);
  if (!conScore.length) {
    return { estado: "sin_match", ome: "", prestacion: null, via: null, confianza: "baja", candidatos: [] };
  }
  const top = conScore[0].s;
  const mejores = conScore.filter((x) => x.s >= Math.max(0.6, top - 0.01)).map((x) => x.p);
  const { elegida, ambiguo } = elegirPractica(mejores, informe.practicaHint);
  if (elegida && top >= 0.8) {
    return { estado: elegida.transmitida ? "ya_transmitido" : "ok", ome: elegida.nOrden || "",
      prestacion: elegida, via: "nombre", confianza: top >= 0.99 ? "media" : "baja", candidatos: mejores };
  }
  return { estado: "revisar_nombre", ome: "", prestacion: null, via: "nombre", confianza: "baja",
    candidatos: mejores.slice(0, 8) };
}

module.exports = { matchInforme, resolverBeneficio, scoreNombre, soloDigitos, normNombre: norm };
