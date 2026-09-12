"use strict";
// ---- Vínculo médico ↔ centro ↔ práctica ----
// Un médico sirve SOLO en el centro donde el admin lo asignó y SOLO para las
// prácticas que le tildó. Lista vacía = NINGUNO, no "todos" (que era el default
// viejo: un médico recién creado - se crea solo con el nombre - aparecía en
// todos los centros firmando cualquier práctica, y como todos los clientes usan
// el mismo nomenclador de PAMI, el médico de un centro se ofrecía en otro).
//
// Ojo: esto es el vínculo del NEGOCIO, distinto de medicosVisiblesPara() de
// permissions.js, que es el permiso del USUARIO logueado. Hay que pasar los dos.
//
// El mismo criterio está duplicado en public/app.js (medicoHabilitado), porque
// el front es JS plano sin bundler - si cambia acá, cambiarlo allá.

function medicoHabilitado(m, clienteSlug, modeloKey) {
  if (!m || !clienteSlug) return false;
  const clientes = Array.isArray(m.clientes) ? m.clientes : [];
  if (!clientes.includes(clienteSlug)) return false;
  if (!modeloKey) return true;
  const modelos = Array.isArray(m.modelos) ? m.modelos : [];
  return modelos.includes(modeloKey);
}

// ¿El centro tiene AL MENOS un médico para esa práctica? Si no, esa práctica no
// se ofrece para ese centro (ni siquiera "sin firma"): no la hacemos ahí.
function hayMedicoPara(medicos, clienteSlug, modeloKey) {
  return (medicos || []).some((m) => medicoHabilitado(m, clienteSlug, modeloKey));
}

// Chequeo común de los 3 endpoints que arman informes (generar, generar-y-subir,
// lote). Devuelve el mensaje de error a mostrar, o "" si está todo bien.
function validarMedicoDeInforme(medicos, clienteSlug, modeloKey, medicoId, nombreCliente) {
  if (!hayMedicoPara(medicos, clienteSlug, modeloKey)) {
    return `${nombreCliente || "Este centro"} no tiene ningún médico asignado para esa práctica, así que no se pueden hacer informes de esa práctica para ese centro.`;
  }
  if (!medicoId) return ""; // "Sin firma" (se firma a mano) en un centro que sí hace la práctica.
  const medico = (medicos || []).find((m) => m.id === medicoId);
  if (!medico) return "No se encontró el médico elegido.";
  if (!medicoHabilitado(medico, clienteSlug, modeloKey)) {
    return `${medico.nombre} no está asignado a ${nombreCliente || "ese centro"} para esa práctica.`;
  }
  return "";
}

module.exports = { medicoHabilitado, hayMedicoPara, validarMedicoDeInforme };
