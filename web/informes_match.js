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

// ¿Dos tokens están a lo sumo a UN error de tipeo (una sustitución, inserción o
// borrado)? Sirve para typos de una letra en apellidos: CECHINI ≈ CECCHINI,
// GONZALES ≈ GONZALEZ. Solo se usa en tokens de 5+ letras (los cortos, como nombres
// de pila, se exigen exactos para no confundir ANA/ANO).
function _unError(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) { let d = 0; for (let i = 0; i < la; i++) if (a[i] !== b[i] && ++d > 1) return false; return true; }
  const s = la < lb ? a : b, l = la < lb ? b : a;   // s = el más corto
  let i = 0, j = 0, saltos = 0;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) { i++; j++; }
    else if (++saltos > 1) return false;
    else j++;
  }
  return true;
}
function _tokenPega(t, tb) {
  if (tb.has(t)) return true;
  if (t.length < 5) return false;
  for (const x of tb) if (x.length >= 5 && _unError(t, x)) return true;
  return false;
}
// Similitud de nombres por tokens: cuántos tokens del informe están en el de la
// bandeja (el informe suele ser prefijo del nombre completo). 0..1. Un token pega
// si coincide exacto o a un error de tipeo (apellidos con una letra de más/menos).
function scoreNombre(a, b) {
  const ta = tokens(a), tb = new Set(tokens(b));
  if (!ta.length || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (_tokenPega(t, tb)) hit += 1;
  let sc = hit / ta.length;
  // Nombre PEGADO sin espacios ("FERNANDEZCLEIA" por OCR) contra el padrón con
  // espacios: si la concatenación de uno es prefijo de la del otro, es la misma
  // persona (el informe suele ser prefijo del nombre completo). Se exige 8+ letras
  // para no pegar apellidos sueltos por casualidad; la unicidad la garantiza quien
  // llama (resolverPorNombre exige un único afiliado, sin empate).
  if (sc < 1) {
    const ca = ta.join(""), cb = tokens(b).join("");
    if (ca.length >= 8 && cb.length >= 8 && (cb.startsWith(ca) || ca.startsWith(cb))) sc = 1;
  }
  return sc;
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
  // Muy poco para desambiguar: menos de 2 tokens. Excepción: un nombre PEGADO por OCR
  // ("FERNANDEZCLEIA") es un solo token pero trae apellido+nombre; si es largo (10+
  // letras) se deja pasar y lo resuelve el match sin espacios (con la unicidad de abajo).
  if (tokens(nombre).length < 2 && norm(nombre).replace(/ /g, "").length < 10) return null;
  let mejor = null, mejorScore = 0, empate = false;
  for (const it of Object.values(padronCliente || {})) {
    const tp = tokens(it.nombre);
    if (!it || !it.beneficio || tp.length < 2) continue;
    // Dirección segura: todos los tokens del INFORME están en el padrón (el informe
    // suele ser prefijo del nombre completo — "GOTTIG ERMINIA" ⊆ "GOTTIG ERMINIA
    // CELESTINA"). Dirección con ruido: todos los del PADRÓN en el informe (el
    // informe trae el estudio pegado — "OTERO CARLOS ALBERTO VENOSO"), pero SOLO si
    // el padrón tiene nombre completo (≥3 tokens); si no, un "GOMEZ ANA" matchearía
    // cualquier "Gomez Ana ...".
    let s = scoreNombre(nombre, it.nombre);
    if (s < 1 && tp.length >= 3) s = Math.max(s, scoreNombre(it.nombre, nombre));
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

// Un informe puede cubrir VARIAS prácticas (otorrino: "OTOMICROSCOPIA +
// RINOMANOMETRÍA" son dos OMEs distintas). Busca una prestación para CADA pista.
// Es conservador a propósito: si alguna pista no encuentra exactamente una
// prestación libre, devuelve vacío y se cae al camino de siempre (elegir una sola
// o mandar a revisar). Preferimos no resolver antes que resolver mal.
// Devuelve { elegidas, todas }: `todas` dice si CADA práctica del informe encontró
// su OME. Si alguna no aparece o es ambigua, igual se devuelven las que sí
// resolvieron (para dejarlas tildadas) pero `todas` queda en false y el informe se
// manda a revisar: sirve de ayuda, sin afirmar que está completo.
function elegirPracticas(prestaciones, hints) {
  const usados = new Set();
  const out = [];
  let todas = true, ambiguo = false;
  for (const h of (Array.isArray(hints) ? hints : [])) {
    const hint = norm(h);
    if (!hint) continue;
    // Las CONSULTAS quedan afuera de este camino. Un informe que cubre varias
    // prácticas cubre ESTUDIOS, no consultas; y como la consulta de cardiología
    // "incluye electrocardiograma", el cuerpo de un Holter ("registro
    // electrocardiográfico de 24 hs") se llevaba puesta la consulta del paciente.
    const idxs = prestaciones
      .map((_, i) => i)
      .filter((i) => !usados.has(i) && !esConsulta(prestaciones[i].practica)
        && norm(prestaciones[i].practica).includes(hint));
    // 1 candidato = práctica resuelta. 0 = esa práctica NO tiene OME en la bandeja
    // (no es facturable acá, ej. "video rinofibrolaringoscopía" que va incluida): no
    // es algo para revisar, se ignora. ≥2 = ambigua de verdad → hay que mirar cuál.
    if (idxs.length === 1) { usados.add(idxs[0]); out.push(prestaciones[idxs[0]]); }
    else { todas = false; if (idxs.length > 1) ambiguo = true; }
  }
  return { elegidas: out, todas, ambiguo };
}

// informe: { dni, beneficio, nombre, practicaHint, practicaHints }
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
      // Primero: ¿el informe nombra VARIAS prácticas y cada una tiene su OME?
      const hints = Array.isArray(informe.practicaHints) ? informe.practicaHints : [];
      if (hints.length > 1) {
        const { elegidas: varias, todas, ambiguo } = elegirPracticas(delPaciente, hints);
        if (varias.length > 1) {
          const pendientes = varias.filter((p) => !p.transmitida);
          const principal = pendientes[0] || varias[0];
          // Se da por completo salvo que alguna práctica quede AMBIGUA (2+ OMEs
          // posibles). Que una práctica del informe no tenga OME en la bandeja NO
          // bloquea: no es facturable acá, no hay nada para revisar. `todas` (todas con
          // OME) baja la confianza a media, pero igual resuelve.
          const completo = !ambiguo;
          return {
            estado: completo ? (pendientes.length ? "ok" : "ya_transmitido") : "revisar_practica",
            ome: completo ? (principal.nOrden || "") : "",
            omes: varias.map((p) => p.nOrden).filter(Boolean),
            prestacion: completo ? principal : null,
            prestaciones: varias,
            via: "beneficio_" + via,
            confianza: (completo && todas) ? "alta" : "media",
            candidatos: delPaciente,
          };
        }
      }
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

// Para los que NO matchean confiado: sugiere los afiliados del padrón con el
// nombre más parecido (bidireccional), para que el operador confirme en 1 clic.
// Devuelve [{ nombre, dni, beneficio, score }] ordenado por parecido.
function sugerirPadron(nombre, padronCliente, limite) {
  if (!tokens(nombre).length) return [];
  const arr = [];
  for (const it of Object.values(padronCliente || {})) {
    if (!it || !it.beneficio) continue;
    const s = Math.max(scoreNombre(nombre, it.nombre), scoreNombre(it.nombre, nombre));
    if (s >= 0.5) arr.push({ nombre: it.nombre || "", dni: it.dni || "", beneficio: soloDigitos(it.beneficio), score: Math.round(s * 100) / 100 });
  }
  arr.sort((a, b) => b.score - a.score || a.nombre.localeCompare(b.nombre));
  return arr.slice(0, limite || 5);
}

module.exports = { matchInforme, resolverBeneficio, sugerirPadron, scoreNombre, soloDigitos, normNombre: norm };
