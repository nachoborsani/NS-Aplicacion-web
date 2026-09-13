// ============================================================================
// PERMISOS — matriz centralizada de quién puede ver/hacer qué.
// ============================================================================
// Principio: TODO LO QUE NO ESTÁ EXPLÍCITAMENTE PERMITIDO ACÁ, ESTÁ PROHIBIDO
// (default-deny / fail-closed). Antes esto vivía repartido en `if (me.role
// === ...)` sueltos por server.js y app.js — a partir de ahora, cualquier
// regla nueva sobre "quién ve/puede tocar qué" se agrega ACÁ, no donde se
// necesite. server.js llama a `aplicarGateDeRol()` una sola vez, antes de
// despachar cualquier ruta.
//
// Los NOMBRES DE ROL no se tocan (siguen siendo los mismos strings que ya
// están guardados en users.json: admin, operador, medico, clinica, demo,
// colaborador, operador_clinica). Renombrarlos sería un refactor de altísimo
// riesgo sin beneficio real — lo que cambia es que la LÓGICA de permisos deja
// de estar repartida, no los nombres.
//
// Roles y su alcance de cliente (cliente_id scope):
//   admin             -> todos los clientes, todo.
//   operador          -> todos los clientes por defecto; SI se le carga una
//                        lista puntual (me.clientes), queda restringido a
//                        esos (caso raro: alguien de NS que solo trabaja en
//                        ciertos centros).
//   medico            -> no navega por "cliente" de esta forma (firma
//                        informes; su propio alcance vive en
//                        medicosVisiblesPara, atado a m.clientes).
//   clinica           -> SOLO su centro (me.centro), SOLO LECTURA salvo un
//                        puñado de excepciones puntuales (ver más abajo).
//   operador_clinica  -> SOLO su centro (me.centro), SOLO LECTURA, y encima
//                        arranca sin ninguna pantalla — se le habilitan de a
//                        un módulo (ver OPERADOR_CLINICA_MODULOS).
//   demo, colaborador -> SOLO los clientes de su lista (me.clientes), SOLO
//                        LECTURA de punta a punta.
//
// CÓMO AGREGAR UNA RUTA NUEVA (leer antes de sumar un endpoint):
//   - Si es de admin/operador sin restricción: no hace falta tocar este
//     archivo, ya pasan por default (no están en ninguna lista de acá).
//   - Si la ruta es de un cliente puntual (`/api/clientes/:slug/...`) y la
//     tiene que poder ver un rol restringido (clinica/operador_clinica/demo/
//     colaborador/operador-con-lista), sumala a la lista `permitido` de esa
//     rama en `aplicarGateDeRol`. Si NO la sumás, ese rol se queda afuera con
//     403 — es el comportamiento seguro por defecto, no un bug.

// "demo" y "colaborador": ven datos reales, pueden descargar, pero no crean/
// modifican/borran nada, y solo entran a los clientes de su lista.
const SOLO_LECTURA = new Set(["demo", "colaborador"]);

// Operativo = admin u operador. Hace el trabajo diario (afiliados, informes,
// cabina, nomenclador) pero NO toca plata, cierre de mes ni clientes.
function esOperativo(me) { return !!(me && (me.role === "admin" || me.role === "operador")); }
function puedeCanalInicio(me, canal) { return canal === "operadores" ? esOperativo(me) : (!!me && me.role === "admin"); }

// Visibilidad de clientes restringida a una lista puntual (me.clientes) o a
// un único centro (me.centro):
// - "demo"/"colaborador" SIEMPRE están restringidos (por eso se exige al
//   menos un cliente al crearlos/editarlos).
// - "operador" está restringido SOLO si se le cargó una lista a mano (ej.
//   alguien que trabaja para NS pero solo en ciertos centros). Un operador
//   SIN lista (el caso de siempre) sigue viendo todos los clientes — no
//   romper ese comportamiento por defecto es la razón de que esto sea
//   condicional y no un rol aparte.
// - "operador_clinica" y "clinica" (el dueño) están atados a UN centro
//   (me.centro), nunca ven el resto.
function tieneClientesRestringidos(me) {
  if (!me) return false;
  if (SOLO_LECTURA.has(me.role)) return true;
  if (me.role === "operador") return Array.isArray(me.clientes) && me.clientes.length > 0;
  if (me.role === "operador_clinica" || me.role === "clinica") return true;
  return false;
}
// Slugs que un usuario restringido puede ver: la lista a mano (me.clientes)
// para demo/colaborador/operador-con-lista, o su único centro para
// operador_clinica y clinica (el dueño), que vienen atados a me.centro.
function clientesPermitidosSet(me) {
  if (me.role === "operador_clinica" || me.role === "clinica") return new Set(me.centro ? [me.centro] : []);
  return new Set(Array.isArray(me.clientes) ? me.clientes : []);
}
function clientesVisiblesPara(me, clientes) {
  if (!tieneClientesRestringidos(me)) return clientes;
  const permitidos = clientesPermitidosSet(me);
  return clientes.filter((c) => permitidos.has(c.slug));
}
// Mismo criterio que clientesVisiblesPara, pero para médicos de la config de
// Informes (cada médico puede estar atado a uno o más clientes en m.clientes;
// vacío = médico "global", se muestra siempre). Un usuario con clientes
// restringidos no debe ver médicos/firmas de una clínica que no le asignamos.
function medicosVisiblesPara(me, medicos) {
  if (!tieneClientesRestringidos(me)) return medicos;
  const permitidos = clientesPermitidosSet(me);
  return medicos.filter((m) => !Array.isArray(m.clientes) || m.clientes.length === 0 || m.clientes.some((c) => permitidos.has(c)));
}

// operador_clinica: empleado de recepción del centro (NO el dueño). Arranca
// SIN ninguna pantalla de datos habilitada — se le suman de a un módulo (ver
// PDF "Empleado Cliente"). Nivel básico siempre: nada de dashboards,
// honorarios ni reportes, tenga los módulos que tenga.
const OPERADOR_CLINICA_MODULOS = new Set(["mescurso", "padron", "informes", "liberarcupo"]);
function opClinicaTieneModulo(me, modulo) {
  return !!(me && me.role === "operador_clinica" && Array.isArray(me.modulos) && me.modulos.includes(modulo));
}

// Capacidades del rol "clinica" (dueño): qué secciones/herramientas ve el
// centro, por usuario (lo configura el admin al editar el usuario clínica).
// Claves = las secciones del menú de la clínica + "omes" (Crear informes y
// crear/subir informe). DEFAULT cuando el usuario no tiene nada guardado: TODO
// menos "omes" (un centro nuevo no hace informes/OMEs hasta que NS lo habilite).
const CLINICA_CAPACIDADES = ["dashboard", "reportes", "omes", "liberarcupo", "credencial", "honorarios", "usuarios", "datos", "nomencladores"];
// Default: TODO menos las herramientas de acción que NS habilita a mano por
// centro ("omes" = crear/subir informes, y "liberarcupo"), y menos
// "nomencladores" (12/09/2026: se suma como capacidad nueva, apagada por
// default - se habilita centro por centro, no se le prende a nadie solo).
const CLINICA_CAP_DEFAULT = CLINICA_CAPACIDADES.filter((c) => c !== "omes" && c !== "liberarcupo" && c !== "nomencladores");
function capacidadesClinica(u) {
  if (!u) return [];
  if (Array.isArray(u.capacidades)) return u.capacidades.filter((c) => CLINICA_CAPACIDADES.includes(c));
  return CLINICA_CAP_DEFAULT.slice();
}
function clinicaTieneCap(me, cap) {
  return !!(me && me.role === "clinica" && capacidadesClinica(me).includes(cap));
}

// ============================================================================
// GATE ÚNICO por rol — se llama una sola vez, antes de despachar cualquier
// ruta bajo /api/. Devuelve null si está permitido (seguir), o { status,
// body } con el error a devolver si no. server.js no decide nada acá adentro:
// solo llama y, si vuelve algo, corta con json(res, status, body).
// ============================================================================
function aplicarGateDeRol(req, meGate, p) {
  const esGet = (req.method === "GET" || !req.method);

  // --- Gate del rol "clinica" (dueño del centro): SOLO LECTURA y SOLO su
  // centro. Puede: ver su sesión, cambiar su clave, salir, y hacer GET de
  // /api/clientes (scopeado en el handler) y de /api/clientes/{su-centro}/...
  // Todo lo demás: 403.
  if (meGate.role === "clinica") {
    const permitidoSiempre = (p === "/api/me" || p === "/api/logout" || p === "/api/change-password" || p === "/api/version" || p === "/api/login");
    const mCli = p.match(/^\/api\/clientes\/([^/]+)(\/.*)?$/);
    const suCentro = mCli && decodeURIComponent(mCli[1]) === meGate.centro;
    let permitido = false;
    if (permitidoSiempre) permitido = true;
    else if (esGet && p === "/api/clientes") permitido = true;
    else if (esGet && suCentro) permitido = true;
    // Única excepción de escritura: guardar SUS honorarios (y bajar la
    // liquidación en PDF, que se pide por POST). Y exportar PDF (lectura).
    else if (!esGet && suCentro && /\/honorarios(\/liquidacion)?$/.test(p)) permitido = true;
    else if (p === "/api/mescurso/export") permitido = true;
    // Nomenclador: es data de REFERENCIA (no de un centro), solo lectura. Van
    // las 5 lecturas que arma la pantalla: el resumen (lista de períodos +
    // filtros, que es LO PRIMERO que pide al abrir), la búsqueda, el export,
    // la calculadora y el banner de aumento vs el mes anterior. Escribir
    // (subir/activar/borrar un nomenclador) nunca: eso sigue siendo de NS.
    else if (esGet && (p === "/api/nomencladores"
                    || p === "/api/nomencladores/search"
                    || p === "/api/nomencladores/export"
                    || p === "/api/nomencladores/calc-data"
                    || p === "/api/nomencladores/comparar")) permitido = true;
    // Credencial provisoria de PAMI (mismo permiso que su empleado operador_clinica).
    else if (req.method === "POST" && p === "/api/credencial-provisoria") permitido = true;
    // Crear informes: config + generar/lote, sin generar-y-subir (subir a PAMI
    // sigue siendo tarea de NS).
    else if (esGet && p === "/api/informes/config") permitido = true;
    else if (req.method === "POST" && (p === "/api/informes/generar" || p === "/api/informes/lote")) permitido = true;
    // Autogestión de usuarios del centro: crea/edita/borra SOLO a sus
    // empleados (operador_clinica de SU centro). El handler fuerza rol y
    // centro, así que no puede crear un admin ni tocar otro centro.
    else if (suCentro && ["POST", "PATCH", "PUT", "DELETE"].includes(req.method)
             && /^\/api\/clientes\/[^/]+\/usuarios(?:\/[a-z0-9._-]+(?:\/password)?)?$/.test(p)) permitido = true;
    // Liberar cupo: GET candidatos/reporte ya entra por "esGet && suCentro"; acá
    // se habilita la acción (POST /liberar-cupo/liberar) — la gatea la capacidad.
    else if (suCentro && req.method === "POST" && /\/liberar-cupo\/liberar$/.test(p)) permitido = true;
    // Capacidades del usuario (qué habilitó el admin): aunque el path esté
    // permitido arriba, si esa capacidad está apagada para ESTE usuario, se
    // bloquea. Es un "deny": la lista de arriba da el permiso base y esto solo
    // puede sacarlo. Cubre las herramientas con endpoint propio (informes/OMEs,
    // credencial, honorarios+liquidación, usuarios, liberar cupo); las secciones
    // de solo lectura del propio centro (dashboard/reportes/datos) se ocultan en el front.
    const capReq = /^\/api\/informes\//.test(p) ? "omes"
      : (p === "/api/credencial-provisoria") ? "credencial"
      : /\/honorarios(\/liquidacion)?$/.test(p) ? "honorarios"
      : /\/liberar-cupo(\/|$)/.test(p) ? "liberarcupo"
      : /^\/api\/clientes\/[^/]+\/usuarios(\/|$)/.test(p) ? "usuarios"
      : /^\/api\/nomencladores(\/|$)/.test(p) ? "nomencladores"
      : null;
    if (permitido && capReq && !clinicaTieneCap(meGate, capReq)) {
      return { status: 403, body: { error: "Tu centro no tiene habilitada esa herramienta. Pedísela a NS." } };
    }
    if (!permitido) return { status: 403, body: { error: "Tu usuario solo puede ver su propio centro (solo lectura)." } };
    return null;
  }

  // --- Gate del rol "operador_clinica" (empleado de recepción, NO el
  // dueño): SOLO LECTURA, SOLO su centro, y sin dashboards/honorarios/
  // reportes (nada con plata ni gráficas). Se van sumando permisos puntuales
  // acá a medida que se construye cada pantalla nueva para este rol.
  if (meGate.role === "operador_clinica") {
    const permitidoSiempre = (p === "/api/me" || p === "/api/logout" || p === "/api/change-password" || p === "/api/version" || p === "/api/login");
    const centroCod = encodeURIComponent(meGate.centro);
    let permitido = permitidoSiempre || (esGet && p === "/api/clientes")
      || (esGet && p === `/api/clientes/${centroCod}/pendientes-centro`)
      // Pendientes del centro con el detalle de pacientes (su pantalla de
      // Inicio). El endpoint ya devuelve las filas sin montos.
      || (esGet && p === `/api/clientes/${centroCod}/pendientes-centro/detalle`);
    // Dashboard mes en curso: el MISMO tablero que ve un operador de NS (que ya
    // se renderiza sin plata para los dos roles, ver ROLES_SIN_VALORES en
    // app.js), pero solo de SU centro. Son las 6 lecturas que arma
    // loadClientMesCurso() - todas GET, ninguna escribe. "Transmitir y
    // actualizar" (POST) queda AFUERA a propósito: transmitir a PAMI sigue
    // siendo tarea de NS, no del centro.
    if (!permitido && opClinicaTieneModulo(meGate, "mescurso") && esGet) {
      permitido = p === `/api/clientes/${centroCod}/dashboard`
        || p === `/api/clientes/${centroCod}/bandeja/resumen`
        || p === `/api/clientes/${centroCod}/reportes`
        || p === `/api/clientes/${centroCod}/informes/omes-generadas`
        || p === `/api/clientes/${centroCod}/faltantes-desestimados`
        || p === "/api/bandeja/refresco/estado";
    }
    if (!permitido && opClinicaTieneModulo(meGate, "padron") && esGet) {
      permitido = p === `/api/clientes/${centroCod}/padron` || p === `/api/clientes/${centroCod}/padron/lookup`;
    }
    if (!permitido && opClinicaTieneModulo(meGate, "padron") && req.method === "POST") {
      permitido = p === "/api/pami/capita" || p === "/api/credencial-provisoria";
    }
    // Ojo: NO incluye /api/informes/generar-y-subir - encola una tarea que
    // escribe en el store de la Cabina (terreno de Nacho en paralelo). Este
    // módulo solo genera/descarga el PDF; subirlo a PAMI sigue siendo de NS.
    if (!permitido && opClinicaTieneModulo(meGate, "informes")) {
      permitido = (esGet && p === "/api/informes/config")
        || (req.method === "POST" && (p === "/api/informes/generar" || p === "/api/informes/lote"));
    }
    if (!permitido && opClinicaTieneModulo(meGate, "liberarcupo")) {
      permitido = (esGet && (p === `/api/clientes/${centroCod}/liberar-cupo/candidatos` || p === `/api/clientes/${centroCod}/liberar-cupo/reporte.xlsx`))
        || (req.method === "POST" && p === `/api/clientes/${centroCod}/liberar-cupo/liberar`);
    }
    if (!permitido) {
      // El mensaje tiene que decir QUÉ pasó: este 403 tenía dos causas muy
      // distintas y el texto genérico ("no tenés esa pantalla habilitada")
      // mandaba a revisar los módulos del usuario aunque estuvieran bien.
      // El caso real que costó caro: los módulos estaban OK y la pantalla
      // estaba pidiendo OTRO centro (un selector que quedó apuntando mal).
      const mCli = p.match(/^\/api\/clientes\/([^/]+)(\/.*)?$/);
      const pedido = mCli ? decodeURIComponent(mCli[1]) : "";
      if (pedido && pedido !== meGate.centro) {
        return { status: 403, body: { error: `Esta pantalla trabaja solo sobre tu centro (${meGate.centro}), y se pidió "${pedido}". Recargá la página.` } };
      }
      const pantalla = /\/liberar-cupo(\/|$)/.test(p) ? "Liberar cupo"
        : /\/padron(\/|$)/.test(p) ? "Afiliados"
        : /^\/api\/informes\//.test(p) ? "Generar informes"
        : "";
      if (pantalla) {
        return { status: 403, body: { error: `Tu usuario no tiene habilitada la pantalla "${pantalla}". Pedísela a NS.` } };
      }
      return { status: 403, body: { error: "Tu usuario todavía no tiene esa pantalla habilitada." } };
    }
    return null;
  }

  // --- Gate de los roles de SOLO LECTURA ("demo" y "colaborador"). Ven los
  // datos reales y pueden descargar, pero no crean, no modifican y no borran
  // NADA; y solo entran a los clientes de su lista. Fail-closed a propósito:
  // se permite lo que está listado, todo lo demás se niega — así no depende
  // de acordarse de proteger cada endpoint nuevo.
  if (SOLO_LECTURA.has(meGate.role)) {
    const permitidoSiempre = (p === "/api/me" || p === "/api/logout" || p === "/api/change-password" || p === "/api/version" || p === "/api/login");
    const mCli = p.match(/^\/api\/clientes\/([^/]+)(\/.*)?$/);
    const permitidos = Array.isArray(meGate.clientes) ? meGate.clientes : [];
    const suCliente = !mCli || permitidos.includes(decodeURIComponent(mCli[1]));
    // Los accesos PAMI del cliente (usuario/clave) NUNCA, ni de lectura: es
    // justamente lo que no queremos que se lleve.
    const esCredencial = /\/pami(\/|$)/.test(p) || /\/credenciales(\/|$)/.test(p) || /\/claves(\/|$)/.test(p);
    let permitido = false;
    if (permitidoSiempre) permitido = true;
    else if (esCredencial) permitido = false;
    else if (esGet && suCliente) permitido = true;
    // Descarga que se pide por POST: solo arma el archivo con las filas que ya
    // están en pantalla (no lee la base), así que es segura.
    else if (p === "/api/mescurso/export") permitido = true;
    if (!permitido) {
      return { status: 403, body: { error: (mCli && !suCliente)
        ? "Tu usuario no tiene acceso a ese cliente."
        : "Te faltan permisos: tu usuario es de solo lectura (podés ver y descargar, pero no modificar)." } };
    }
    return null;
  }

  // --- Gate del operador CON lista propia (caso raro: alguien de NS que
  // solo trabaja en ciertos centros). Es una capa de RESPALDO sobre los
  // chequeos que ya tiene cada endpoint puntual (clientesVisiblesPara): si
  // alguno se olvidó de chequear el cliente del body/query, esto corta antes
  // para cualquier ruta que tenga el slug en la URL. Un operador SIN lista
  // (el caso de siempre) no entra acá: tieneClientesRestringidos da false.
  if (meGate.role === "operador" && tieneClientesRestringidos(meGate)) {
    const mCli = p.match(/^\/api\/clientes\/([^/]+)(\/.*)?$/);
    if (mCli) {
      const permitidos = clientesPermitidosSet(meGate);
      if (!permitidos.has(decodeURIComponent(mCli[1]))) {
        return { status: 403, body: { error: "Tu usuario no tiene acceso a ese cliente." } };
      }
    }
    return null;
  }

  // admin, operador sin lista, medico: sin restricción acá (cada endpoint
  // puntual que necesite admin exclusivo ya lo chequea por su cuenta).
  return null;
}

module.exports = {
  SOLO_LECTURA,
  esOperativo,
  puedeCanalInicio,
  tieneClientesRestringidos,
  clientesPermitidosSet,
  clientesVisiblesPara,
  medicosVisiblesPara,
  OPERADOR_CLINICA_MODULOS,
  opClinicaTieneModulo,
  CLINICA_CAPACIDADES,
  capacidadesClinica,
  clinicaTieneCap,
  aplicarGateDeRol,
};
