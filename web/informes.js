"use strict";
// Generador de informes médicos (PDF) — modelo Centro Médico Caballito / Cardiología-ECG.
// Usa pdf-lib para embeber el logo y la firma (imágenes) y armar el layout del modelo.
// Por ahora el modelo está hardcodeado; después se hace parametrizable por centro.

const fs = require("fs");
const path = require("path");
// pdf-lib se carga de forma perezosa dentro de buildInformePdf: si por algún
// motivo no está instalado, el server igual arranca (solo falla generar el PDF),
// en vez de tumbar toda la web al importar este módulo.

const ASSETS = path.join(__dirname, "assets", "informes");

// El membrete (logo arriba + nombre/dirección/teléfono al pie) YA NO se
// hardcodea por cliente acá: sale del Cliente elegido al generar. server.js
// arma `logoName` / `pieLines` a partir de los datos "Logo, Dirección,
// Teléfono" de ese cliente y se los pasa a buildInformePdf en `input`. Así
// cualquier modelo sirve para cualquier cliente sin duplicar nada acá.
//
// Única excepción: un estudio que sale siempre desde una sede propia sin
// importar de qué cliente sea la cuenta — Ecografía musculoesquelética usa el
// membrete de "Centro de Medicina Ambulatoria" (otra sede, Av. Directorio
// 1658) en vez del cliente. Por eso ese modelo fija su propio membreteTexto/pie.
const PIE_CABALLITO_AMB = ["Caballito. Centro de Medicina Ambulatoria.", "Av. Directorio 1658. 1406 Cap. Fed.", "TE: 4633-8713 / 4633-9320"];

// Campos de la caja técnica del Holter. Base = Caballito; CIMA suma 4 más.
const HOLTER_CAMPOS = [
  { key: "duracion", label: "Duración", default: "24 hs" },
  { key: "fcProm", label: "FC promedio", default: "72 lpm" },
  { key: "fcMin", label: "FC mínima", default: "55 lpm" },
  { key: "fcMax", label: "FC máxima", default: "118 lpm" },
  { key: "totalLatidos", label: "Total de latidos", default: "103.000 aprox." },
  { key: "latidosAnormales", label: "Latidos anormales", default: "0" },
  { key: "esv", label: "ESV", default: "0" },
  { key: "ev", label: "EV", default: "0" },
  { key: "pausas", label: "Pausas significativas", default: "0" },
  { key: "stt", label: "ST-T", default: "sin cambios significativos", wide: true },
  { key: "sintomas", label: "Síntomas", default: "no refiere" },
];
const HOLTER_CAMPOS_CIMA = [
  ...HOLTER_CAMPOS,
  { key: "pausaMasLarga", label: "Pausa más larga", default: "0,0 seg" },
  { key: "bradicardia", label: "Bradicardia", default: "0 episodios" },
  { key: "motivo", label: "Motivo", default: "Control" },
  { key: "medicacion", label: "Medicación", default: "—", wide: true },
];
// Campos del Test de SIBO: fecha de nacimiento, umbral y las 10 mediciones PPM.
const SIBO_CAMPOS = [
  { key: "fechaNac", label: "Fecha nacimiento", default: "" },
  { key: "umbral", label: "Umbral PPM", default: "25" },
  { key: "ppm1", label: "PPM 1", default: "" },
  { key: "ppm2", label: "PPM 2", default: "" },
  { key: "ppm3", label: "PPM 3", default: "" },
  { key: "ppm4", label: "PPM 4", default: "" },
  { key: "ppm5", label: "PPM 5", default: "" },
  { key: "ppm6", label: "PPM 6", default: "" },
  { key: "ppm7", label: "PPM 7", default: "" },
  { key: "ppm8", label: "PPM 8", default: "" },
  { key: "ppm9", label: "PPM 9", default: "" },
  { key: "ppm10", label: "PPM 10", default: "" },
];
// Campos del MAPA / Presurometría 24 hs (página resumen). Muchos, todos editables.
const MAPA_CAMPOS = [
  { key: "edad", label: "Edad", default: "" },
  { key: "sexo", label: "Sexo", default: "" },
  { key: "medico", label: "Médico", default: "", wide: true },
  { key: "medicacion", label: "Medicación", default: "", wide: true },
  { key: "nTot", label: "N total", default: "" },
  { key: "nVig", label: "N vigilia", default: "" },
  { key: "nSue", label: "N sueño", default: "" },
  { key: "pasTP", label: "PAS tot prom", default: "" },
  { key: "pasTMin", label: "PAS tot mín", default: "" },
  { key: "pasTMax", label: "PAS tot máx", default: "" },
  { key: "padTP", label: "PAD tot prom", default: "" },
  { key: "padTMin", label: "PAD tot mín", default: "" },
  { key: "padTMax", label: "PAD tot máx", default: "" },
  { key: "fcTP", label: "FC tot prom", default: "" },
  { key: "pasVP", label: "PAS vig prom", default: "" },
  { key: "pasVMin", label: "PAS vig mín", default: "" },
  { key: "pasVMax", label: "PAS vig máx", default: "" },
  { key: "padVP", label: "PAD vig prom", default: "" },
  { key: "padVMin", label: "PAD vig mín", default: "" },
  { key: "padVMax", label: "PAD vig máx", default: "" },
  { key: "fcVP", label: "FC vig prom", default: "" },
  { key: "pasSP", label: "PAS sue prom", default: "" },
  { key: "pasSMin", label: "PAS sue mín", default: "" },
  { key: "pasSMax", label: "PAS sue máx", default: "" },
  { key: "padSP", label: "PAD sue prom", default: "" },
  { key: "padSMin", label: "PAD sue mín", default: "" },
  { key: "padSMax", label: "PAD sue máx", default: "" },
  { key: "fcSP", label: "FC sue prom", default: "" },
  { key: "horarioSueno", label: "Horario de sueño", default: "", wide: true },
  { key: "patronDescenso", label: "Descenso nocturno", default: "", wide: true },
  { key: "clasificacion", label: "Clasificación", default: "" },
  { key: "cgTPas", label: "Carga tot PAS", default: "" },
  { key: "cgTPad", label: "Carga tot PAD", default: "" },
  { key: "cgVPas", label: "Carga vig PAS", default: "" },
  { key: "cgVPad", label: "Carga vig PAD", default: "" },
  { key: "cgSPas", label: "Carga sue PAS", default: "" },
  { key: "cgSPad", label: "Carga sue PAD", default: "" },
];
// Campos de la Ergometría (página resumen). Todos editables, precargables por preset.
const ERGO_CAMPOS = [
  { key: "sexo", label: "Sexo", default: "" },
  { key: "edad", label: "Edad", default: "" },
  { key: "peso", label: "Peso", default: "" },
  { key: "estatura", label: "Estatura", default: "" },
  { key: "imc", label: "IMC", default: "" },
  { key: "indicacion", label: "Indicación / motivo", default: "", wide: true },
  { key: "medicacion", label: "Medicación / tratamiento", default: "", wide: true },
  { key: "fechaHoraInicio", label: "Inicio de la prueba", default: "", wide: true },
  { key: "protocolo", label: "Protocolo", default: "", wide: true },
  { key: "fcPrevMax", label: "FC prev. máx", default: "" },
  { key: "fcPrevSub", label: "FC prev. submáx", default: "" },
  { key: "fcAlcanzada", label: "FC alcanzada", default: "" },
  { key: "pctFcMax", label: "% FC máx", default: "" },
  { key: "pctFcSub", label: "% FC submáx", default: "" },
  { key: "taSis", label: "TA sistólica máx", default: "" },
  { key: "taDia", label: "TA diastólica máx", default: "" },
  { key: "mets", label: "METS", default: "" },
  { key: "dobleProd", label: "Doble producto", default: "" },
  { key: "vo2", label: "VO2", default: "" },
  { key: "carga", label: "Carga alcanzada", default: "" },
  { key: "motivoDeten", label: "Motivo de detención", default: "", wide: true },
];
// Campos de la Flujometría urinaria computarizada (ECUD / Urología Caballito).
// Datos de ficha + estudio + los 12 valores de uroflujometría. Los presets pisan
// los numéricos; nombre/fecha/sexo se cargan por paciente.
const FLUJO_CAMPOS = [
  // Sexo obligatorio (desplegable): evita, ej., un diagnóstico de próstata en una
  // paciente mujer. Sin sexo elegido, el front no genera la vista previa ni el PDF.
  { key: "sexo", label: "Sexo", default: "", tipo: "select", opciones: ["Masculino", "Femenino", "Otro"], requerido: true },
  { key: "edad", label: "Edad", default: "" },
  { key: "tipoEstudio", label: "Tipo de estudio", default: "Uroflujometría" },
  { key: "numeroEstudio", label: "N° de estudio", default: "" },
  { key: "operador", label: "Operador", default: "Dr. Lisandro Veliz", wide: true },
  { key: "motivo", label: "Motivo", default: "", wide: true },
  { key: "requeridoPor", label: "Requerido por", default: "", wide: true },
  { key: "diagClinico", label: "Diagnóstico clínico", default: "" },
  { key: "diagUrodinamico", label: "Diagnóstico urodinámico", default: "", wide: true },
  { key: "qMax", label: "Q máximo", default: "" },
  { key: "qMed90", label: "Q medio 90%", default: "" },
  { key: "qProm", label: "Q promedio", default: "" },
  { key: "qA2s", label: "Q a 2 seg", default: "" },
  { key: "tAQmax", label: "T a Qmax", default: "" },
  { key: "t90", label: "T de 90%", default: "" },
  { key: "volTotal", label: "Volumen total", default: "" },
  { key: "volQmax", label: "Volumen hasta Qmax", default: "" },
  { key: "tiempoTotal", label: "Tiempo total", default: "" },
  { key: "tiempoNeto", label: "Tiempo neto", default: "" },
  { key: "tiempoDescenso", label: "Tiempo de descenso", default: "" },
  { key: "tiempoEntrePausas", label: "Tiempo entre pausas", default: "" },
];
// Campos del Ecocardiograma doppler color (página de datos técnicos). Extraídos
// de la planilla real de referencia de CIMA (Informe de Ecocardio.xlsx). Los
// valores por defecto son los de un estudio normal, dentro de los rangos de
// referencia que trae esa misma planilla (FE ≥55%, raíz aorta hasta 40 mm,
// AI hasta 54 mm, fracción de acortamiento >28%, septum/pared ≤11 mm).
const ECOCARDIO_CAMPOS = [
  { key: "apertura", label: "Apertura valvular mitral", default: "Conservada" },
  { key: "raizAorta", label: "Raíz de aorta (mm)", default: "30" },
  { key: "auriculaIzq", label: "Aurícula izquierda (mm)", default: "34" },
  { key: "diamSistolicoVI", label: "Diámetro sistólico VI (mm)", default: "28" },
  { key: "diamDiastolicoVI", label: "Diámetro diastólico VI (mm)", default: "46" },
  { key: "fraccionAcortamiento", label: "Fracción de acortamiento (%)", default: "36" },
  { key: "fraccionEyeccion", label: "Fracción de eyección (%)", default: "62" },
  { key: "septumIV", label: "Septum interventricular (mm)", default: "9" },
  { key: "paredPosterior", label: "Pared posterior (mm)", default: "9" },
  { key: "pericardio", label: "Pericardio", default: "Libre" },
  { key: "funcionSistolicaVI", label: "Función sistólica VI", default: "Conservada" },
  { key: "motilidadParietal", label: "Motilidad parietal", default: "Conservada" },
  { key: "espesorParietal", label: "Espesor parietal", default: "Conservado" },
  { key: "diametroAI", label: "Diámetro AI (mm)", default: "34" },
  { key: "diametroAD", label: "Diámetro AD (mm)", default: "32" },
  { key: "diametroVD", label: "Diámetro VD (mm)", default: "24" },
  { key: "morfologiaValvular", label: "Morfología valvular", default: "Normal" },
  { key: "diagnostico", label: "Diagnóstico", default: "", wide: true },
];
// Campos de la Espirometría computarizada (curva flujo-volumen, pre y post
// broncodilatador). Extraídos de estudios reales de CIMA (equipo Minispir II /
// winspiroPRO) — se toman los parámetros clínicamente relevantes del reporte
// completo del equipo, no la totalidad de columnas crudas que imprime.
const ESPIRO_CAMPOS = [
  { key: "fvcPre", label: "FVC PRE (L)", default: "3,36" },
  { key: "fvcPost", label: "FVC POST (L)", default: "3,36" },
  { key: "pctTeorFvc", label: "% teórico FVC", default: "80" },
  { key: "fev1Pre", label: "FEV1 PRE (L)", default: "2,45" },
  { key: "fev1Post", label: "FEV1 POST (L)", default: "2,45" },
  { key: "pctTeorFev1", label: "% teórico FEV1", default: "86" },
  { key: "fev1fvcPre", label: "FEV1/FVC PRE (%)", default: "70,9" },
  { key: "fev1fvcPost", label: "FEV1/FVC POST (%)", default: "70,9" },
  { key: "pef", label: "PEF (L/s)", default: "5,86" },
  { key: "fef2575", label: "FEF25-75 (L/s)", default: "2,07" },
  { key: "fet", label: "FET (s)", default: "6,00" },
  { key: "broncodilatador", label: "Broncodilatador usado", default: "Salbutamol" },
  { key: "equipo", label: "Equipo", default: "Minispir II" },
];
// Campos de la Ecografía ginecológica transvaginal (datos del útero). Extraídos
// de la planilla fielded real de CIMA ("modelo ecografia.doc").
const GINECO_CAMPOS = [
  { key: "posicion", label: "Posición uterina", default: "Anteroversoflexión" },
  { key: "forma", label: "Forma", default: "Conservada" },
  { key: "ecoestructura", label: "Ecoestructura", default: "Homogénea" },
  { key: "diamLongitudinal", label: "Diámetro longitudinal (mm)", default: "" },
  { key: "diamAP", label: "Diámetro anteroposterior (mm)", default: "" },
  { key: "diamTransverso", label: "Diámetro transverso (mm)", default: "" },
  { key: "endometrio", label: "Endometrio", default: "Lineal, de espesor conservado" },
  { key: "anexos", label: "Anexos", default: "Sin imágenes anexiales patológicas" },
  { key: "douglas", label: "Fondo de saco de Douglas", default: "Libre" },
];
// Catálogo de estudios (modelos), UNO por tipo de estudio — ya no uno por
// cliente. Lo que cambiaba solo por cliente (logo, nombre/dirección/teléfono
// al pie, y qué médico firma) sale ahora del Cliente elegido al generar, no
// de acá. Agregar un cliente nuevo no requiere tocar este archivo: alcanza
// con cargarle Logo/Dirección/Teléfono y asignarle médicos.
const MODELOS = {
  "consulta-570129": {
    label: "Consulta cardiología c/ ECG (570129)",
    short: "Consulta ECG",
    practica: "Consulta cardiológica c/ ECG — 570129",
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "570129",
    estudio: "Consulta con especialista en cardiología (incluye ECG)",
    estudioArchivo: "Consulta Cardiologia ECG",
    textoDefault: "Ecg sin complicaciones, trazado sin valor patológico.",
  },
  "electro": {
    label: "Electrocardiograma simple",
    short: "ECG",
    practica: "ECG simple",
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "",
    estudio: "Electrocardiograma",
    textoDefault: "Ecg sin complicaciones, trazado sin valor patológico.",
  },
  "holter": {
    label: "Holter cardíaco 24 hs",
    short: "Holter",
    practica: "Holter cardíaco 24 hs",
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "",
    estudio: "Holter cardíaco de 3 canales 24 hs.",
    estudioArchivo: "Holter 24 hs",
    textoDefault: "Ritmo sinusal durante todo el estudio. Conducción AV dentro de límites fisiológicos. No se observaron arritmias supraventriculares ni ventriculares significativas. No se observaron cambios significativos del segmento ST-T. No se observaron pausas significativas. No refirió síntomas durante el estudio. Se analizó registro electrocardiográfico de 24 hs.",
    // Caja "DATOS TÉCNICOS DEL REGISTRO": valores estándar precargados, todos
    // editables. Usa el set completo (antes solo lo tenía el modelo de CIMA) —
    // son campos opcionales de más, no le quitan nada a nadie.
    tecnicosTitulo: "DATOS TÉCNICOS DEL REGISTRO",
    campos: HOLTER_CAMPOS_CIMA,
  },
  // ===================== ORL / Otorrinolaringología =====================
  // Mismo layout que cardiología (sin caja técnica). Cambia el servicio y, en
  // algunas prácticas, se elige el lado (el texto del preset cambia según el lado).
  "orl-cerumen": {
    label: "Extracción tapón de cerumen / cuerpo extraño (717111)",
    short: "Cerumen",
    practica: "717111 - Extracción de tapón de cerumen / cuerpo extraño",
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717111",
    estudio: "EXTRACCIÓN DE CUERPO EXTRAÑO EN OÍDO + EXTRACCIÓN DE TAPÓN DE CERUMEN",
    estudioArchivo: "Extraccion tapon cerumen",
    textoDefault: "SE REALIZA OTOMICROSCOPIA. SE EVIDENCIA TAPÓN DE CERUMEN EN CONDUCTO AUDITIVO EXTERNO, EL CUAL SE EXTRAE EN SU TOTALIDAD. POSTERIOR AL PROCEDIMIENTO SE CONSTATA CONDUCTO AUDITIVO PERMEABLE, CON MEMBRANA TIMPÁNICA NORMOLÚCIDA.",
    requiereLado: true,
  },
  "orl-quimico": {
    label: "Tratamiento químico ORL (717125)",
    short: "Trat. químico",
    practica: "717125 - Tratamiento de lesiones ORL por medios físicos o químicos",
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717125",
    estudio: "TRATAMIENTO DE LESIONES OTORRINOLARINGOLÓGICAS POR MEDIOS FÍSICOS O QUÍMICOS",
    estudioArchivo: "Tratamiento quimico ORL",
    textoDefault: "SE REALIZA TRATAMIENTO QUÍMICO DE LESIÓN ANGIOMATOSA EN REGIÓN ANTERIOR SEPTAL, POR EPÍSTAXIS ANTERIOR RECURRENTE. PROCEDIMIENTO BIEN TOLERADO.",
  },
  "orl-combinado": {
    label: "Cerumen + Tratamiento químico (717111 + 717125)",
    short: "Combinado",
    practica: "717111 + 717125 - Cerumen + Tratamiento químico (combinado)",
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717111 + 717125",
    estudio: "EXTRACCIÓN DE CUERPO EXTRAÑO EN OÍDO + EXTRACCIÓN DE TAPÓN DE CERUMEN + TRATAMIENTO DE LESIONES OTORRINOLARINGOLÓGICAS POR MEDIOS FÍSICOS O QUÍMICOS",
    estudioArchivo: "Cerumen y tratamiento quimico",
    textoDefault: "SE REALIZA OTOMICROSCOPIA. SE EVIDENCIA TAPÓN DE CERUMEN EN CONDUCTO AUDITIVO EXTERNO, EL CUAL SE EXTRAE EN SU TOTALIDAD. POSTERIOR AL PROCEDIMIENTO SE CONSTATA CONDUCTO AUDITIVO PERMEABLE, CON MEMBRANA TIMPÁNICA NORMOLÚCIDA. SE REALIZA ADEMÁS TRATAMIENTO QUÍMICO DE LESIÓN ANGIOMATOSA EN REGIÓN ANTERIOR SEPTAL, POR EPÍSTAXIS ANTERIOR RECURRENTE. PROCEDIMIENTOS BIEN TOLERADOS.",
    requiereLado: true,
  },
  "orl-videorino": {
    label: "Video rinofibrolaringoscopia (717132)",
    short: "Videorino",
    practica: "717132 - Video rinofibrolaringoscopia",
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717132",
    estudio: "VIDEO RINOFIBROLARINGOSCOPIA",
    estudioArchivo: "Video rinofibrolaringoscopia",
    textoDefault: "SE REALIZA VIDEO RINOFIBROLARINGOSCOPIA. SE OBSERVAN FOSAS NASALES PERMEABLES, CAVUM LIBRE, FARINGE Y LARINGE SIN LESIONES EVIDENTES. CUERDAS VOCALES MÓVILES Y SIMÉTRICAS, CON BUENA COAPTACIÓN GLÓTICA. PROCEDIMIENTO BIEN TOLERADO.",
  },
  // --- Dermatología ---
  "derma-crio": {
    label: "Criocirugía de piel (510320)",
    short: "Criocirugía",
    practica: "510320 - Ablación de lesiones de piel por criocirugía",
    servicio: "SERVICIO DE DERMATOLOGÍA",
    especialidad: "Dermatología",
    codigoPractica: "510320",
    estudio: "ABLACIÓN DE LESIONES DE PIEL EN GENERAL POR CRIOCIRUGÍA",
    estudioArchivo: "Ablacion de piel por criocirugia",
    textoDefault: "SE REALIZA CRIOCIRUGÍA DE QUERATOSIS ACTÍNICAS Y SEBORREICAS EN CUERO CABELLUDO Y ROSTRO. PROCEDIMIENTO BIEN TOLERADO, SIN COMPLICACIONES INMEDIATAS.",
  },
  "derma-electro": {
    label: "Destrucción de lesión de piel (537106)",
    short: "TCA/Electro",
    practica: "537106 - Destrucción de lesión de piel por electrocoagulación o TCA",
    servicio: "SERVICIO DE DERMATOLOGÍA",
    especialidad: "Dermatología",
    codigoPractica: "537106",
    estudio: "TOPICACION CON TCA",
    estudioArchivo: "Destruccion de lesion de piel",
    textoDefault: "PREVIA ANTISEPSIA SE REALIZA TOPICACIÓN CON TCA AL 50% DE QUERATOSIS SEBORREICAS EN ROSTRO. TOLERA PROCEDIMIENTO, SIN COMPLICACIONES.",
  },
  "derma-biopsia": {
    label: "Biopsia de piel (537108)",
    short: "Biopsia de piel",
    practica: "537108 - Biopsia de piel y/o tejido celular subcutáneo y/o muscular",
    servicio: "SERVICIO DE DERMATOLOGÍA",
    especialidad: "Dermatología",
    codigoPractica: "537108",
    estudio: "BIOPSIA DE PIEL",
    estudioArchivo: "Biopsia de piel",
    textoDefault: "PREVIA ANTISEPSIA SE REALIZA INFILTRACIÓN CON LIDOCAÍNA SIN EPINEFRINA AL 2%, SE PROCEDE A TOMA DE BIOPSIA LOSANGE EN REGIÓN A ESPECIFICAR. SE LOGRA HEMOSTASIA. TOLERA PROCEDIMIENTO SIN COMPLICACIONES.\nPACIENTE SE LLEVA MUESTRA EN FORMOL AL 10% ROTULADA Y CON RESUMEN DE HISTORIA CLÍNICA.",
  },
  // --- Ecografía musculoesquelética: sale siempre desde la sede de Medicina
  // Ambulatoria, sin importar de qué cliente sea la cuenta (ver comentario
  // arriba de PIE_CABALLITO_AMB) — por eso es el único que fija su membrete.
  "eco-musculo": {
    label: "Ecografía musculoesquelética (186001)",
    short: "Eco musculoesquelética",
    practica: "186001 - Ecografía musculoesquelética",
    membreteTexto: PIE_CABALLITO_AMB,   // encabezado de texto (no servicio grande)
    mostrarCobertura: true,             // muestra "Cobertura:" (default PAMI)
    estudioEditable: true,              // "Estudio solicitado" se edita / lo pisa el preset
    firmaConMatricula: true,            // muestra nombre + matrícula del médico en la firma
    especialidad: "Diagnóstico por imágenes / Ecografía",
    codigoPractica: "186001",
    estudio: "Ecografía de partes blandas",
    estudioLabel: "Estudio solicitado:",
    estudioArchivo: "Ecografia musculoesqueletica",
    textoDefault: "EXPLORADA LA REGIÓN SOLICITADA CON TRANSDUCTOR DE PARTES BLANDAS, EN RELACIÓN A SITIO DOLOROSO REFERIDO POR EL/LA PACIENTE, NO SE OBSERVAN ALTERACIONES ECOGRÁFICAS AL MOMENTO DEL ESTUDIO.",
    pie: PIE_CABALLITO_AMB,
  },
  // --- Test de SIBO (aire espirado) — layout propio ---
  "sibo": {
    label: "Test de SIBO (607130)",
    short: "SIBO",
    practica: "607130 - Test de aire espirado (SIBO)",
    especialidad: "Gastroenterología / Estudios funcionales",
    codigoPractica: "607130",
    estudio: "TEST DE AIRE ESPIRADO PARA SOBRECRECIMIENTO BACTERIANO",
    estudioArchivo: "Test de SIBO",
    tipo: "sibo",
    testType: "SIBO 2026",
    // Se usa solo si no se eligió médico al generar (ver buildSiboPdf).
    profesionalDefault: ["DR. RAMIRO CALCAGNO", "MN 149098   MP 232961"],
    campos: SIBO_CAMPOS,
    textoDefault: "Estudio negativo para SIBO",
  },
  // --- MAPA / Presurometría 24 hs — layout propio (página resumen) ---
  "mapa": {
    label: "MAPA / Presurometría 24 hs (570120)",
    short: "MAPA",
    practica: "570120 - Presurometría 24 hs / MAPA",
    especialidad: "Cardiología",
    codigoPractica: "570120",
    estudio: "PRESUROMETRÍA POR 24 HS / MAPA",
    estudioArchivo: "MAPA Presurometria 24hs",
    tipo: "mapa",
    campos: MAPA_CAMPOS,
    textoDefault: "REGISTRO DE PRESIÓN ARTERIAL DENTRO DE PARÁMETROS CONSERVADOS. ESTUDIO TÉCNICAMENTE SATISFACTORIO.",
  },
  // --- Ergometría computarizada — layout propio (página resumen) ---
  "ergo": {
    label: "Ergometría (570124)",
    short: "Ergometría",
    practica: "570124 - Ergometría computarizada 12 derivaciones",
    especialidad: "Cardiología",
    codigoPractica: "570124",
    estudio: "ERGOMETRÍA COMPUTARIZADA DE DOCE DERIVACIONES CON OXIMETRÍA",
    estudioArchivo: "Ergometria",
    tipo: "ergo",
    depto: "Dpto. de Cardiología",
    titulo: "Estudio CardioVex Ergometría",
    campos: ERGO_CAMPOS,
    textoDefault: "PRUEBA SUBMÁXIMA SUFICIENTE. ESTUDIO TÉCNICAMENTE SATISFACTORIO.",
  },
  // --- Flujometría urinaria computarizada (ECUD) — layout propio ---
  "flujometria": {
    label: "Flujometría urinaria computarizada (507315)",
    short: "Flujometría",
    practica: "507315 - Flujometría urinaria computarizada",
    especialidad: "Urología",
    codigoPractica: "507315",
    estudio: "FLUJOMETRÍA URINARIA COMPUTARIZADA",
    estudioArchivo: "Flujometria urinaria",
    tipo: "flujo",
    campos: FLUJO_CAMPOS,
    textoDefault: "Estudio normal",
  },
  // --- Tratamiento esclerosante (Flebología / Cirugía vascular) ---
  "esclerosante": {
    label: "Tratamiento esclerosante",
    short: "Esclerosante",
    practica: "Tratamiento esclerosante",
    servicio: "SERVICIO DE FLEBOLOGÍA",
    especialidad: "Flebología / Cirugía vascular",
    codigoPractica: "",
    estudio: "TRATAMIENTO ESCLEROSANTE",
    estudioArchivo: "Tratamiento esclerosante",
    textoDefault: "PACIENTE QUE CONSULTA POR VARICES. CLASIFICACIÓN CEAP III CON TRAYECTORIA VARICOSA QUE PROVOCA PRURITO, LO QUE DETERMINÓ FLEBITIS REACTIVA. SE INDICÓ TRATAMIENTO ESCLEROSANTE SOBRE TRAYECTO AFECTADO.",
  },
  // ===================== Ecografía general / Ecodoppler (CIMA) =====================
  // Un modelo por tipo de estudio (13, según el listado real de prácticas de
  // CIMA: "Informes ecografias/ecografias informes.txt"), no un modelo genérico
  // — cada tipo tiene su propio texto/hallazgos estándar, editables por el
  // operador al generar. Los de Doppler MMII y venoso/arterial reproducen la
  // metodología real del Dr. Peltz; renal/tiroides/mamaria/partes blandas la de
  // planillas y modelos reales del Dr. Novelli. Sin "requeridoPor"/tipo de
  // hallazgo específico salvo que haya fuente real (evita inventar patología).
  "eco-abdominal": {
    label: "Ecografía abdominal completa",
    short: "Eco abdominal",
    practica: "Ecografía abdominal completa",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecografía",
    codigoPractica: "",
    estudio: "ECOGRAFÍA ABDOMINAL COMPLETA",
    estudioArchivo: "Ecografia abdominal completa",
    textoDefault: "HÍGADO DE TAMAÑO, FORMA Y ECOESTRUCTURA CONSERVADOS, SIN IMÁGENES FOCALES. VESÍCULA BILIAR DE PAREDES FINAS, SIN IMÁGENES LITIÁSICAS EN SU INTERIOR. VÍA BILIAR NO DILATADA. PÁNCREAS DE ECOESTRUCTURA HOMOGÉNEA. BAZO DE TAMAÑO Y ECOESTRUCTURA CONSERVADOS. AMBOS RIÑONES DE FORMA, TAMAÑO Y ECOESTRUCTURA CONSERVADOS, SIN SIGNOS DE UROPATÍA OBSTRUCTIVA NI LITIASIS. NO SE OBSERVA LÍQUIDO LIBRE EN CAVIDAD.",
  },
  "eco-renal": {
    label: "Ecografía renal",
    short: "Eco renal",
    practica: "Ecografía renal",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecografía",
    codigoPractica: "",
    estudio: "ECOGRAFÍA RENAL",
    estudioArchivo: "Ecografia renal",
    textoDefault: "RIÑÓN DERECHO: FORMA CONSERVADA. ECOESTRUCTURA HOMOGÉNEA. RELACIÓN CORTICOMEDULAR CONSERVADA. NO SE OBSERVAN SIGNOS DE URONEFROSIS NI MACROLITIASIS. TAMAÑO: DL 103 MM X AP 46 MM X DT 37 MM, EP 15 MM.\nRIÑÓN IZQUIERDO: FORMA CONSERVADA. ECOESTRUCTURA HOMOGÉNEA. RELACIÓN CORTICOMEDULAR CONSERVADA. NO SE OBSERVAN SIGNOS DE URONEFROSIS NI MACROLITIASIS. TAMAÑO: DL 102 MM X AP 55 MM X DT 49 MM, EP 24 MM.",
  },
  "eco-vesical": {
    label: "Ecografía vesical",
    short: "Eco vesical",
    practica: "Ecografía vesical",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecografía",
    codigoPractica: "",
    estudio: "ECOGRAFÍA VESICAL",
    estudioArchivo: "Ecografia vesical",
    textoDefault: "VEJIGA EN REPLECIÓN, DE PAREDES FINAS Y REGULARES, CON CONTENIDO ANECOICO, SIN IMÁGENES COMPATIBLES CON LITIASIS NI FORMACIONES SÓLIDAS EN SU INTERIOR.",
  },
  "eco-vesical-residuo": {
    label: "Ecografía vesical con residuo posmiccional",
    short: "Eco vesical c/ residuo",
    practica: "Ecografía vesical con residuo posmiccional",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecografía",
    codigoPractica: "",
    estudio: "ECOGRAFÍA VESICAL CON RESIDUO POSMICCIONAL",
    estudioArchivo: "Ecografia vesical con residuo",
    textoDefault: "VEJIGA EN REPLECIÓN, DE PAREDES FINAS Y REGULARES, SIN IMÁGENES COMPATIBLES CON LITIASIS NI FORMACIONES SÓLIDAS EN SU INTERIOR. LUEGO DE LA MICCIÓN ESPONTÁNEA SE CONSTATA RESIDUO POSMICCIONAL ESTIMADO EN — ML.",
  },
  "eco-prostatica": {
    label: "Ecografía prostática",
    short: "Eco prostática",
    practica: "Ecografía prostática",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecografía",
    codigoPractica: "",
    estudio: "ECOGRAFÍA PROSTÁTICA",
    estudioArchivo: "Ecografia prostatica",
    textoDefault: "PRÓSTATA DE TAMAÑO Y ECOESTRUCTURA CONSERVADOS PARA LA EDAD, DE CONTORNOS REGULARES, SIN IMÁGENES NODULARES EN SU INTERIOR.",
  },
  "eco-partes-blandas-general": {
    label: "Ecografía de partes blandas (hernia / región quirúrgica)",
    short: "Eco partes blandas",
    practica: "Ecografía de partes blandas",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecografía",
    codigoPractica: "",
    estudio: "ECOGRAFÍA DE PARTES BLANDAS: REGIÓN INGUINAL DERECHA/IZQUIERDA",
    estudioArchivo: "Ecografia de partes blandas",
    textoDefault: "SE EXPLORA CON TRANSDUCTOR DE ALTA FRECUENCIA EN CONCORDANCIA CON ÁREA REFERIDA POR EL/LA PACIENTE, EVIDENCIÁNDOSE AL MOMENTO DEL ESTUDIO:\nREGIÓN INGUINAL: ANILLO HERNIARIO DE — MM CON SACO HERNIARIO DE — MM X — MM, SIENDO SU CONTENIDO ASAS INTESTINALES Y TEJIDO ADIPOSO PROTRUYENDO EL MISMO ANTE MANIOBRA DE VALSALVA Y CON REDUCCIÓN TOTAL/PARCIAL ANTE LA RELAJACIÓN.",
  },
  "eco-tiroides": {
    label: "Ecografía de tiroides",
    short: "Eco tiroides",
    practica: "Ecografía de tiroides",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecografía",
    codigoPractica: "",
    estudio: "ECOGRAFÍA DE TIROIDES",
    estudioArchivo: "Ecografia de tiroides",
    textoDefault: "LÓBULO DERECHO: FORMA CONSERVADA, ECOESTRUCTURA HOMOGÉNEA, SIN IMÁGENES NODULARES.\nLÓBULO IZQUIERDO: FORMA CONSERVADA, ECOESTRUCTURA HOMOGÉNEA, SIN IMÁGENES NODULARES.\nISTMO DE ESPESOR CONSERVADO, HOMOGÉNEO.",
  },
  "eco-mamaria": {
    label: "Ecografía mamaria",
    short: "Eco mamaria",
    practica: "Ecografía mamaria",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecografía",
    codigoPractica: "",
    estudio: "ECOGRAFÍA MAMARIA",
    estudioArchivo: "Ecografia mamaria",
    textoDefault: "PARÉNQUIMA HETEROGÉNEO FIBROGLANDULAR.\nMAMA DERECHA: NO SE OBSERVAN IMÁGENES SÓLIDAS NI QUÍSTICAS AGREGADAS.\nMAMA IZQUIERDA: NO SE OBSERVAN IMÁGENES SÓLIDAS NI QUÍSTICAS AGREGADAS.\nBIRADS ECOGRÁFICO: 1.",
  },
  "eco-ginecologica-tv": {
    label: "Ecografía ginecológica transvaginal",
    short: "Eco gineco TV",
    practica: "Ecografía ginecológica transvaginal",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecografía",
    codigoPractica: "",
    estudio: "ECOGRAFÍA GINECOLÓGICA TRANSVAGINAL",
    estudioArchivo: "Ecografia ginecologica TV",
    tecnicosTitulo: "DATOS DEL ÚTERO",
    campos: GINECO_CAMPOS,
    textoDefault: "ÚTERO Y ANEXOS DE CARACTERÍSTICAS ECOGRÁFICAS CONSERVADAS PARA LA EDAD. NO SE OBSERVAN IMÁGENES PATOLÓGICAS AL MOMENTO DEL ESTUDIO.",
  },
  "eco-doppler-cuello": {
    label: "Ecodoppler de vasos de cuello",
    short: "Doppler cuello",
    practica: "Ecodoppler de vasos de cuello",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecodoppler",
    codigoPractica: "",
    estudio: "ECODOPPLER DE VASOS DE CUELLO",
    estudioArchivo: "Ecodoppler vasos de cuello",
    textoDefault: "SE ESTUDIAN CON TRANSDUCTOR LINEAL ARTERIAS CARÓTIDAS COMUNES, BULBOS CAROTÍDEOS, CARÓTIDAS INTERNAS Y EXTERNAS, Y ARTERIAS VERTEBRALES DE AMBOS LADOS.\nDOPPLER: FLUJO CONSERVADO CON ONDAS DE MORFOLOGÍA NORMAL. NO SE OBSERVAN PLACAS ATEROMATOSAS NI ESTENOSIS SIGNIFICATIVAS.\nCONCLUSIÓN: ESTUDIO DENTRO DE LÍMITES FISIOLÓGICOS.",
  },
  "eco-doppler-arterial-mmss": {
    label: "Ecodoppler arterial de miembros superiores",
    short: "Doppler art. MMSS",
    practica: "Ecodoppler arterial de miembros superiores",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecodoppler",
    codigoPractica: "",
    estudio: "ECODOPPLER ARTERIAL DE MIEMBROS SUPERIORES",
    estudioArchivo: "Ecodoppler arterial MMSS",
    textoDefault: "SE REALIZÓ UNA EXPLORACIÓN DE LAS ARTERIAS DE AMBOS MIEMBROS SUPERIORES CON ECÓGRAFO PHILIPS PURE WAVE CON TRANSDUCTOR DE 5-10 MHZ. SE UTILIZARON LOS MODOS: BIDIMENSIONAL, DOPPLER PULSADO EN DIFERENTES DECÚBITOS PARA UNA VALORACIÓN COMPLETA DE LOS PARÁMETROS QUE SE DESCRIBEN A CONTINUACIÓN.\nECOTOMOGRAFÍA: ARTERIAS DE PAREDES LISAS Y DIÁMETRO NORMAL.\nDOPPLER: FLUJO TRIFÁSICO (NORMAL) A NIVEL BILATERAL.\nCONCLUSIÓN: ESTUDIO DENTRO DE LÍMITES FISIOLÓGICOS.",
  },
  "eco-doppler-venoso-mmss": {
    label: "Ecodoppler venoso de miembros superiores",
    short: "Doppler ven. MMSS",
    practica: "Ecodoppler venoso de miembros superiores",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecodoppler",
    codigoPractica: "",
    estudio: "ECODOPPLER VENOSO DE MIEMBROS SUPERIORES",
    estudioArchivo: "Ecodoppler venoso MMSS",
    textoDefault: "SE REALIZÓ UNA EXPLORACIÓN DEL SISTEMA VENOSO SUPERFICIAL Y PROFUNDO DE AMBOS MIEMBROS SUPERIORES CON ECÓGRAFO PHILIPS PURE WAVE CON TRANSDUCTOR DE 5-10 MHZ. SE UTILIZARON LOS MODOS: BIDIMENSIONAL, DOPPLER PULSADO EN DIFERENTES DECÚBITOS PARA UNA VALORACIÓN COMPLETA DE LOS PARÁMETROS QUE SE DESCRIBEN A CONTINUACIÓN.\nECOTOMOGRAFÍA: VENAS DE PAREDES LISAS QUE COAPTAN CON LA COMPRESIÓN EXTERNA.\nDOPPLER: FLUJO VENOSO ESPONTÁNEO, FÁSICO CON LA RESPIRACIÓN Y COMPETENTE DURANTE LA MANIOBRA DE VALSALVA.\nCONCLUSIÓN: SISTEMA VENOSO PROFUNDO PERMEABLE Y COMPETENTE A NIVEL BILATERAL. NO SE DETECTAN PERFORANTES INCOMPETENTES.",
  },
  // --- Doppler MMII: metodología real del Dr. Guillermo Peltz (CIMA) ---
  "eco-doppler-arterial-mmii": {
    label: "Ecodoppler arterial de miembros inferiores",
    short: "Doppler art. MMII",
    practica: "Ecodoppler arterial de miembros inferiores",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecodoppler",
    codigoPractica: "",
    estudio: "ECO-DOPPLER ARTERIAL DE MIEMBROS INFERIORES",
    estudioArchivo: "Ecodoppler arterial MMII",
    textoDefault: "SE REALIZÓ UNA EXPLORACIÓN DE LAS ARTERIAS DE AMBOS MIEMBROS INFERIORES CON ECÓGRAFO PHILIPS PURE WAVE CON TRANSDUCTOR DE 5-10 MHZ. SE UTILIZARON LOS MODOS: BIDIMENSIONAL, DOPPLER PULSADO EN DIFERENTES DECÚBITOS PARA UNA VALORACIÓN COMPLETA DE LOS PARÁMETROS QUE SE DESCRIBEN A CONTINUACIÓN.\nECOTOMOGRAFÍA: ARTERIAS DE PAREDES LISAS Y DIÁMETRO NORMAL.\nDOPPLER: FLUJO TRIFÁSICO (NORMAL) A NIVEL BILATERAL.\nCONCLUSIÓN: ESTUDIO DENTRO DE LÍMITES FISIOLÓGICOS.",
  },
  "eco-doppler-venoso-mmii": {
    label: "Ecodoppler venoso de miembros inferiores",
    short: "Doppler ven. MMII",
    practica: "Ecodoppler venoso de miembros inferiores",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecodoppler",
    codigoPractica: "",
    estudio: "ECO-DOPPLER VENOSO DE MIEMBROS INFERIORES",
    estudioArchivo: "Ecodoppler venoso MMII",
    textoDefault: "SE REALIZÓ UNA EXPLORACIÓN DEL SISTEMA VENOSO SUPERFICIAL Y PROFUNDO DE AMBOS MIEMBROS INFERIORES CON ECÓGRAFO PHILIPS PURE WAVE CON TRANSDUCTOR DE 5-10 MHZ. SE UTILIZARON LOS MODOS: BIDIMENSIONAL, DOPPLER PULSADO EN DIFERENTES DECÚBITOS PARA UNA VALORACIÓN COMPLETA DE LOS PARÁMETROS QUE SE DESCRIBEN A CONTINUACIÓN.\nECOTOMOGRAFÍA: VENAS DE PAREDES LISAS QUE COAPTAN CON LA COMPRESIÓN EXTERNA.\nDOPPLER: FLUJO VENOSO ESPONTÁNEO, FÁSICO CON LA RESPIRACIÓN Y COMPETENTE DURANTE LA MANIOBRA DE VALSALVA.\nCONCLUSIÓN: SISTEMA VENOSO PROFUNDO Y SAFENA PERMEABLE Y COMPETENTE A NIVEL BILATERAL. NO SE DETECTAN PERFORANTES INCOMPETENTES.",
  },
  "eco-doppler-aorta-abdominal": {
    label: "Ecodoppler de arteria aorta abdominal",
    short: "Doppler aorta abd.",
    practica: "Ecodoppler de arteria aorta abdominal",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecodoppler",
    codigoPractica: "",
    estudio: "ECODOPPLER DE ARTERIA AORTA ABDOMINAL",
    estudioArchivo: "Ecodoppler aorta abdominal",
    textoDefault: "SE REALIZA ESTUDIO DOPPLER COLOR ARTERIAL DE ARTERIA AORTA ABDOMINAL CON EQUIPO DE ALTA RESOLUCIÓN COLOR Y CON TRANSDUCTORES DE 3,5 MHZ.\nARTERIA AORTA ABDOMINAL: EN SU TRAYECTO EVALUADO SE OBSERVA DIÁMETRO ANTEROPOSTERIOR DE 13 MM A NIVEL SUPRAUMBILICAL Y DE CALIBRE CONSERVADO, MÁXIMO INFRAUMBILICAL DE 16 MM. ONDAS DE TIPO TRIFÁSICA CON VELOCIDADES CONSERVADAS.\nSE MENCIONAN AISLADAS PLACAS ATEROMATOSAS FIBROCALCÍCICAS QUE NO GENERAN ALTERACIÓN HEMODINÁMICA SIGNIFICATIVA.",
  },
  "eco-doppler-tiroides": {
    label: "Ecodoppler de tiroides",
    short: "Doppler tiroides",
    practica: "Ecodoppler de tiroides",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecodoppler",
    codigoPractica: "",
    estudio: "ECODOPPLER DE TIROIDES",
    estudioArchivo: "Ecodoppler tiroides",
    textoDefault: "SE ESTUDIA GLÁNDULA TIROIDES CON DOPPLER COLOR Y ESPECTRAL. VASCULARIZACIÓN INTRAPARENQUIMATOSA DE DISTRIBUCIÓN Y PATRÓN NORMAL, SIN SIGNOS DE HIPERVASCULARIZACIÓN FOCAL NI DIFUSA.\nCONCLUSIÓN: ESTUDIO DENTRO DE LÍMITES FISIOLÓGICOS.",
  },
  // --- Ecocardiograma doppler color — campos técnicos (sin layout propio) ---
  "ecocardiograma": {
    label: "Ecocardiograma doppler color",
    short: "Ecocardiograma",
    practica: "Ecocardiograma doppler color",
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología / Diagnóstico por imágenes",
    codigoPractica: "",
    estudio: "ECOCARDIOGRAMA DOPPLER COLOR",
    estudioArchivo: "Ecocardiograma",
    tecnicosTitulo: "DATOS TÉCNICOS DEL ECOCARDIOGRAMA",
    campos: ECOCARDIO_CAMPOS,
    textoDefault: "ECOCARDIOGRAMA DOPPLER COLOR: CAVIDADES DE DIMENSIONES CONSERVADAS. FUNCIÓN SISTÓLICA DEL VENTRÍCULO IZQUIERDO CONSERVADA. NO SE OBSERVARON IMÁGENES COMPATIBLES CON VEGETACIONES. PERICARDIO LIBRE. MORFOLOGÍA VALVULAR NORMAL. ESTUDIO TÉCNICAMENTE SATISFACTORIO.",
  },
  // --- Espirometría computarizada — campos técnicos (sin layout propio) ---
  "espirometria": {
    label: "Espirometría computarizada",
    short: "Espirometría",
    practica: "Espirometría computarizada",
    servicio: "SERVICIO DE NEUMONOLOGÍA",
    especialidad: "Neumonología / Estudios funcionales respiratorios",
    codigoPractica: "",
    estudio: "ESPIROMETRÍA COMPUTARIZADA CURVA FLUJO-VOLUMEN, PRE Y POST BRONCODILATADORES",
    estudioArchivo: "Espirometria",
    tecnicosTitulo: "RESULTADOS DE LA PRUEBA DE FUNCIÓN PULMONAR",
    campos: ESPIRO_CAMPOS,
    textoDefault: "ESPIROMETRÍA COMPUTARIZADA, CURVA FLUJO-VOLUMEN, PRE Y POST BRONCODILATADORES, DENTRO DE LÍMITES NORMALES. EL B2 AGONISTA NO PRODUCE CAMBIOS SIGNIFICATIVOS.",
  },
};
// Modelo -> modelo viejo, para migrar configuraciones guardadas (médicos y
// resultados asignados a un modelo puntual, cargados con la clave anterior).
// Ver ensureModelosUnificados() en server.js.
const MODELO_RENOMBRADOS = {
  "caballito-consulta-570129": "consulta-570129",
  "cima-consulta-570129": "consulta-570129",
  "caballito-electro": "electro",
  "cima-electro": "electro",
  "caballito-holter": "holter",
  "cima-holter": "holter",
  "caballito-orl-cerumen": "orl-cerumen",
  "caballito-orl-quimico": "orl-quimico",
  "caballito-orl-combinado": "orl-combinado",
  "caballito-orl-videorino": "orl-videorino",
  "cima-orl-videorino": "orl-videorino",
  "caballito-derma-crio": "derma-crio",
  "caballito-derma-electro": "derma-electro",
  "caballito-derma-biopsia": "derma-biopsia",
  "caballito-eco-musculo": "eco-musculo",
  "caballito-sibo": "sibo",
  "cima-mapa": "mapa",
  "cima-ergo": "ergo",
  "caballito-flujometria": "flujometria",
};
// Clientes a los que pertenecía cada modelo viejo, para inferir a qué cliente
// scopear a los médicos que ya estaban asignados a ese modelo (una sola vez).
const MODELO_VIEJO_CLIENTE = {
  "caballito-consulta-570129": "caballito-pediatrico", "cima-consulta-570129": "cima",
  "caballito-electro": "caballito-pediatrico", "cima-electro": "cima",
  "caballito-holter": "caballito-pediatrico", "cima-holter": "cima",
  "caballito-orl-cerumen": "caballito-pediatrico", "caballito-orl-quimico": "caballito-pediatrico",
  "caballito-orl-combinado": "caballito-pediatrico",
  "caballito-orl-videorino": "caballito-pediatrico", "cima-orl-videorino": "cima",
  "caballito-derma-crio": "caballito-pediatrico", "caballito-derma-electro": "caballito-pediatrico",
  "caballito-derma-biopsia": "caballito-pediatrico", "caballito-eco-musculo": "caballito-pediatrico",
  "caballito-sibo": "caballito-pediatrico", "cima-mapa": "cima", "cima-ergo": "cima",
  "caballito-flujometria": "caballito-pediatrico",
};
// Para el desplegable del front (una sola fuente de verdad).
function listarModelos() {
  return Object.keys(MODELOS).map((k) => ({
    key: k,
    label: MODELOS[k].label || k,
    short: MODELOS[k].short || MODELOS[k].label || k,
    practica: MODELOS[k].practica || MODELOS[k].estudio || k,
    especialidad: MODELOS[k].especialidad || "",
    codigoPractica: MODELOS[k].codigoPractica || "",
    campos: MODELOS[k].campos || [],
    requiereLado: !!MODELOS[k].requiereLado,
    mostrarCobertura: !!MODELOS[k].mostrarCobertura,
    estudioEditable: !!MODELOS[k].estudioEditable,
    estudio: MODELOS[k].estudio || "",
    estudioLabel: MODELOS[k].estudioLabel || "Estudio realizado:",
  }));
}

// Las firmas (dato sensible) viven en <datos>/informes/ (el volumen en producción,
// o web/data en local) — ahí las sube el admin. El logo va en assets del repo.
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");
function readAsset(name) {
  try { return fs.readFileSync(path.join(DATA_DIR, "informes", name)); } catch {}
  try { return fs.readFileSync(path.join(ASSETS, name)); } catch { return null; }
}
// Encaja una imagen (logo o firma) dentro de un ancho x alto máximo, sin
// deformarla. Antes se fijaba solo el ancho y el alto quedaba libre según la
// proporción real del PNG — si el archivo subido no tenía la proporción
// esperada (más cuadrado o vertical de lo previsto, típico en un sello
// escaneado), el alto se disparaba y terminaba tapando texto de arriba o de
// abajo. Ahora gana la dimensión que más achica, así nunca se pasa de la caja.
function encajarImagen(img, maxW, maxH) {
  let w = maxW, h = (img.height / img.width) * w;
  if (h > maxH) { h = maxH; w = (img.width / img.height) * h; }
  return { w, h };
}

function wrapText(text, font, size, maxW) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function sanitizeFilename(value) {
  return String(value || "informe")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "informe";
}

const DEFAULT_MODELO = "consulta-570129";

function informeFilename(modeloKey, paciente) {
  const modelo = MODELOS[modeloKey] || MODELOS[DEFAULT_MODELO];
  const nombre = sanitizeFilename(paciente && paciente.nombre) || "Paciente";
  const estudio = sanitizeFilename(modelo.estudioArchivo || modelo.estudio);
  return `${nombre} - ${estudio}.pdf`;
}

async function buildInformePdf(modeloKey, input) {
  // pdf-lib va vendorizado en el repo (bundle auto-contenido) para no depender
  // del npm install de Railway (su cache no instalaba el paquete).
  const { PDFDocument, StandardFonts, rgb } = require("./vendor/pdf-lib.min.js");
  const modelo = MODELOS[modeloKey] || MODELOS[DEFAULT_MODELO];
  // Modelos con layout propio (ej. SIBO: tabla PPM + gráfico) van por otro builder.
  if (modelo.tipo === "sibo") return buildSiboPdf(modelo, input || {}, { PDFDocument, StandardFonts, rgb });
  if (modelo.tipo === "mapa") return buildMapaPdf(modelo, input || {});
  if (modelo.tipo === "ergo") return buildErgoPdf(modelo, input || {});
  if (modelo.tipo === "flujo") return buildFlujoPdf(modelo, input || {});
  const p = (input && input.paciente) || {};
  const texto = ((input && input.textoInforme) || "").trim() || modelo.textoDefault;
  // El solicitante ya no es un default fijo por modelo: server.js lo completa
  // con el nombre del médico elegido si el operador no escribió uno propio.
  const solicitante = ((input && input.solicitante) || "").trim() || modelo.solicitanteDefault || "";
  // "Estudio realizado/solicitado": del input si el modelo lo deja editar; si no, fijo.
  const estudioTxt = ((input && input.estudio) || "").trim() || modelo.estudio || "";
  // Cobertura (default PAMI) solo si el modelo la muestra.
  const cobertura = ((p.cobertura || "").trim()) || (modelo.mostrarCobertura ? "PAMI" : "");
  // La firma la define el médico elegido (input.firmaArchivo). Sin archivo -> borrador.
  const firmaArchivo = (input && input.firmaArchivo) || "";
  // Nombre + matrícula del médico que firma (para modelos que los muestran).
  const medicoNombre = ((input && input.medicoNombre) || "").trim();
  const medicoMatricula = ((input && input.medicoMatricula) || "").trim();

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 vertical
  const { width, height } = page.getSize();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBoldOblique);

  const ink = rgb(0.12, 0.12, 0.12);
  const soft = rgb(0.3, 0.3, 0.3);
  const border = rgb(0.13, 0.13, 0.13);
  const Mx = 46;
  const boxX = Mx;
  const boxW = width - 2 * Mx;
  const PADX = 14;
  const LBLX = boxX + PADX;
  const VALX = boxX + 128;

  const T = (t, x, yy, o = {}) =>
    page.drawText(String(t), { x, y: yy, size: o.size || 10.5, font: o.font || (o.bold ? bold : font), color: o.color || ink });
  const centerT = (t, yy, o = {}) => {
    const f = o.font || (o.bold ? bold : font), s = o.size || 10.5;
    T(t, (width - f.widthOfTextAtSize(String(t), s)) / 2, yy, o);
  };
  const centerIn = (t, x1, x2, yy, o = {}) => {
    const f = o.font || (o.bold ? bold : font), s = o.size || 10.5;
    T(t, x1 + (x2 - x1 - f.widthOfTextAtSize(String(t), s)) / 2, yy, o);
  };
  const drawBox = (topY, h) => page.drawRectangle({ x: boxX, y: topY - h, width: boxW, height: h, borderColor: border, borderWidth: 1 });

  // Borde de página
  page.drawRectangle({ x: 28, y: 28, width: width - 56, height: height - 56, borderColor: border, borderWidth: 1 });

  let y = height - 50;

  // Logo centrado (fondo blanco). Sale del cliente elegido al generar
  // (input.logoName); el modelo solo lo fija si necesita uno propio fijo.
  const logoBuf = readAsset(modelo.logo || (input && input.logoName));
  if (logoBuf) {
    const logo = await doc.embedPng(logoBuf);
    const { w: lw, h: lh } = encajarImagen(logo, modelo.logoW || (input && input.logoW) || 100, 90);
    page.drawImage(logo, { x: (width - lw) / 2, y: y - lh, width: lw, height: lh });
    y -= lh + 6;
  }

  // Título. Modelos con membreteTexto (ej. Ecografía / Centro de Medicina
  // Ambulatoria) usan un encabezado de líneas de texto; el resto, el servicio
  // en bold itálica.
  if (modelo.membreteTexto && modelo.membreteTexto.length) {
    centerT(modelo.membreteTexto[0], y - 13, { bold: true, size: 13, color: border });
    let hy = y - 13 - 15;
    for (let i = 1; i < modelo.membreteTexto.length; i++) { centerT(modelo.membreteTexto[i], hy, { bold: true, size: 10 }); hy -= 13; }
    y = hy - 12;
  } else {
    const ts = 17;
    centerT(modelo.servicio, y - ts, { font: titleFont, size: ts, color: border });
    y -= ts + 22;
  }

  // Caja: Datos de paciente
  {
    const hasDoc = (p.documento || "").trim();
    const hasCob = !!cobertura;
    const innerLines = 1 + 2 + (hasDoc ? 1 : 0) + (hasCob ? 1 : 0);
    const h = innerLines * 15 + 14;
    drawBox(y, h);
    let iy = y - 18;
    T("Datos de paciente", LBLX, iy, { bold: true, size: 11 }); iy -= 16;
    T("Nombre:", LBLX, iy, { bold: true }); T(p.nombre || "—", VALX, iy); iy -= 15;
    if (hasDoc) { T("Documento:", LBLX, iy, { bold: true }); T(hasDoc, VALX, iy); iy -= 15; }
    T("N° Benef.:", LBLX, iy, { bold: true }); T(p.benef || "—", VALX, iy); iy -= 15;
    if (hasCob) { T("Cobertura:", LBLX, iy, { bold: true }); T(cobertura, VALX, iy); }
    y -= h + 12;
  }

  // Caja: Médico Solicitante
  { const h = 34; drawBox(y, h); T("Médico Solicitante:", LBLX, y - 22, { bold: true }); T(solicitante, VALX + 30, y - 22); y -= h + 12; }

  // Caja: Estudio realizado. Los títulos largos (ORL, combinados) envuelven:
  // si entra en una línea va inline; si no, la etiqueta arriba y el título
  // a lo ancho debajo, para que no se corte dentro del recuadro.
  {
    const vx = VALX + 30;
    const rightX = boxX + boxW - PADX;
    const estudio = estudioTxt;
    const estLabel = modelo.estudioLabel || "Estudio realizado:";
    if (bold.widthOfTextAtSize(estudio, 10.5) <= rightX - vx) {
      const h = 34; drawBox(y, h);
      T(estLabel, LBLX, y - 22, { bold: true });
      T(estudio, vx, y - 22, { bold: true });
      y -= h + 22;
    } else {
      const lines = wrapText(estudio, bold, 10.5, boxW - 2 * PADX);
      const h = 20 + lines.length * 14 + 8;
      drawBox(y, h);
      T(estLabel, LBLX, y - 18, { bold: true });
      let iy = y - 34;
      for (const ln of lines) { T(ln, LBLX, iy, { bold: true, size: 10.5 }); iy -= 14; }
      y -= h + 22;
    }
  }

  // Caja: DATOS TÉCNICOS DEL REGISTRO (solo modelos con campos, ej. Holter)
  if (modelo.campos && modelo.campos.length) {
    const valores = (input && input.valores) || {};
    const campos = modelo.campos;
    const cols = 3;
    const rows = Math.ceil(campos.length / cols);
    const rowH = 14, titleH = 20;
    const h = titleH + rows * rowH + 5;
    drawBox(y, h);
    T(modelo.tecnicosTitulo || "DATOS TÉCNICOS", LBLX, y - 16, { bold: true, size: 11 });
    const grid = rgb(0.75, 0.77, 0.8);
    const gridTop = y - titleH;
    const colW = boxW / cols;
    for (let i = 0; i < campos.length; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const cx = boxX + c * colW + 8;
      const cy = gridTop - r * rowH - 11;
      const lbl = campos[i].label + ": ";
      T(lbl, cx, cy, { bold: true, size: 8.5 });
      const lblW = bold.widthOfTextAtSize(lbl, 8.5);
      let val = String((valores[campos[i].key] == null ? "" : valores[campos[i].key])).trim() || campos[i].default || "";
      const maxVW = colW - 12 - lblW;
      if (font.widthOfTextAtSize(val, 8.5) > maxVW) {
        while (val.length > 1 && font.widthOfTextAtSize(val + "…", 8.5) > maxVW) val = val.slice(0, -1);
        val += "…";
      }
      T(val, cx + lblW, cy, { size: 8.5 });
    }
    for (let r = 0; r <= rows; r++) {
      const ly = gridTop - r * rowH;
      page.drawLine({ start: { x: boxX, y: ly }, end: { x: boxX + boxW, y: ly }, thickness: 0.5, color: grid });
    }
    for (let c = 1; c < cols; c++) {
      const lx = boxX + c * colW;
      page.drawLine({ start: { x: lx, y: gridTop }, end: { x: lx, y: gridTop - rows * rowH }, thickness: 0.5, color: grid });
    }
    y -= h + 18;
  }

  // INFORME (sin caja)
  T("INFORME", LBLX, y, { bold: true, size: 10.5, color: soft });
  y -= 20;
  const lines = wrapText(texto, font, 10.5, boxW - 2 * PADX);
  for (const ln of lines) { T(ln, LBLX, y); y -= 15; }

  // FECHA + Firma (posición fija)
  const fy = 248;
  T("FECHA:", LBLX, fy, { bold: true, size: 11 });
  T(p.fecha || "—", LBLX + 56, fy, { size: 11 });
  const firmaAreaW = 200, firmaAreaX = width - Mx - firmaAreaW;
  const firmaBuf = firmaArchivo ? readAsset(firmaArchivo) : null;
  if (firmaBuf) {
    const firma = await doc.embedPng(firmaBuf);
    const { w: fw, h: fh } = encajarImagen(firma, 150, 55);
    page.drawImage(firma, { x: firmaAreaX + (firmaAreaW - fw) / 2, y: fy - 22, width: fw, height: fh });
  } else {
    centerIn("Firma Médico", firmaAreaX, width - Mx, fy, { bold: true, size: 11 });
    page.drawLine({ start: { x: firmaAreaX + 12, y: fy - 34 }, end: { x: width - Mx - 12, y: fy - 34 }, thickness: 0.8, color: border });
  }
  // Nombre + matrícula del médico que firma (regla: aunque no haya firma cargada,
  // se muestra el nombre y la matrícula debajo del espacio de firma).
  if (modelo.firmaConMatricula && (medicoNombre || medicoMatricula)) {
    let my = fy - 44;
    if (medicoNombre) { centerIn(medicoNombre, firmaAreaX, width - Mx, my, { bold: true, size: 10 }); my -= 13; }
    if (medicoMatricula) { centerIn(medicoMatricula, firmaAreaX, width - Mx, my, { size: 9.5, color: soft }); }
  }

  // Caja: pie del centro (abajo). Nombre/dirección/teléfono salen del cliente
  // elegido al generar (input.pieLines); el modelo solo lo fija si necesita
  // un pie propio fijo (ver comentario de PIE_CABALLITO_AMB, arriba de todo).
  // Si el cliente todavía no cargó esos datos ("de a poco"), no dibujamos una
  // caja vacía — el informe sale igual, sin ese renglón.
  const pieLines = modelo.pie || (input && input.pieLines) || [];
  if (pieLines.length) {
    const top = 100, h = 52;
    drawBox(top, h);
    let py = top - 18;
    centerT(pieLines[0], py, { bold: true, size: 12 }); py -= 15;
    for (let i = 1; i < pieLines.length; i++) { centerT(pieLines[i], py, { bold: true, size: 10.5 }); py -= 14; }
  }

  return await doc.save();
}

// ---- Builder propio del Test de SIBO (cajas + tabla PPM + gráfico de línea) ----
async function buildSiboPdf(modelo, input, lib) {
  const { PDFDocument, StandardFonts, rgb, degrees } = require("./vendor/pdf-lib.min.js");
  const p = input.paciente || {};
  const val = input.valores || {};
  const ppm = [];
  for (let i = 1; i <= 10; i++) { const n = Number(String(val["ppm" + i]).replace(",", ".")); ppm.push(isFinite(n) ? n : 0); }
  const umbral = (() => { const n = Number(String(val.umbral).replace(",", ".")); return isFinite(n) && n > 0 ? n : 25; })();
  const interpretacion = ((input.textoInforme || "").trim()) || modelo.textoDefault || "";
  // El médico sale del elegido al generar; si no se eligió ninguno (o no tiene
  // matrícula cargada), se usa el profesional fijo del modelo como respaldo.
  const medNombre = (input.medicoNombre || "").trim();
  const medMatricula = (input.medicoMatricula || "").trim();
  const profes = (medNombre || medMatricula)
    ? [medNombre, medMatricula].filter(Boolean)
    : (modelo.profesionalDefault || []);

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const W = 595.28, H = 841.89, M = 40;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.12, 0.12), line = rgb(0.25, 0.25, 0.25), grid = rgb(0.85, 0.85, 0.85);
  const blue = rgb(0.15, 0.2, 0.85), red = rgb(0.9, 0.35, 0.4);

  const T = (t, x, y, o) => { o = o || {}; page.drawText(String(t == null ? "" : t), { x, y, size: o.size || 9, font: o.bold ? bold : font, color: o.color || ink }); };
  const wsize = (t, f, s) => f.widthOfTextAtSize(String(t == null ? "" : t), s);
  const centerIn = (t, x1, x2, y, o) => { o = o || {}; const f = o.bold ? bold : font, s = o.size || 9; T(t, x1 + (x2 - x1 - wsize(t, f, s)) / 2, y, o); };
  const wrap = (text, f, s, maxW) => {
    const words = String(text || "").split(/\s+/).filter(Boolean); const lines = []; let cur = "";
    for (const w of words) { const test = cur ? cur + " " + w : w; if (wsize(test, f, s) > maxW && cur) { lines.push(cur); cur = w; } else cur = test; }
    if (cur) lines.push(cur); return lines;
  };
  // Caja tipo fieldset: recuadro con el título "cortando" el borde superior.
  const fieldset = (x, topY, w, h, title) => {
    page.drawRectangle({ x, y: topY - h, width: w, height: h, borderColor: line, borderWidth: 1 });
    const s = 9, tw = wsize(title, bold, s);
    page.drawRectangle({ x: x + (w - tw) / 2 - 4, y: topY - s / 2 - 3, width: tw + 8, height: s + 2, color: rgb(1, 1, 1) });
    T(title, x + (w - tw) / 2, topY - s + 1, { bold: true, size: s });
  };

  let y = H - M;
  // Logo centrado (del cliente elegido al generar)
  const logoBuf = readAsset(modelo.logo || input.logoName);
  if (logoBuf) { try { const img = await doc.embedPng(logoBuf); const { w: lw, h: lh } = encajarImagen(img, modelo.logoW || input.logoW || 100, 90); page.drawImage(img, { x: (W - lw) / 2, y: y - lh, width: lw, height: lh }); y -= lh + 16; } catch {} }

  const colGap = 20, colW = (W - 2 * M - colGap) / 2;
  const c1 = M, c2 = M + colW + colGap;
  const rowTop = y;
  // Fila 1: Test Type + Patient Information (izq) / Health Care Professional (der)
  const ttH = 34, piH = 78, hcpH = ttH + 6 + piH;
  fieldset(c1, rowTop, colW, ttH, "Test Type");
  centerIn(modelo.testType || "SIBO", c1, c1 + colW, rowTop - 22, { bold: true, size: 11 });
  const piTop = rowTop - ttH - 6;
  fieldset(c1, piTop, colW, piH, "Patient Information");
  {
    let iy = piTop - 20;
    T(p.nombre || "—", c1 + 8, iy, { bold: true, size: 9.5 }); iy -= 15;
    if ((p.documento || "").trim()) { T("Documento: " + p.documento, c1 + 8, iy); iy -= 13; }
    if ((p.benef || "").trim()) { T("N° Benef.: " + p.benef, c1 + 8, iy); iy -= 13; }
    if ((val.fechaNac || "").trim()) { T("Nacimiento: " + val.fechaNac, c1 + 8, iy); iy -= 13; }
    if ((p.fecha || "").trim()) { T("Fecha: " + p.fecha, c1 + 8, iy); }
  }
  fieldset(c2, rowTop, colW, hcpH, "Health Care Professional");
  {
    let iy = rowTop - 20;
    (Array.isArray(profes) ? profes : [profes]).forEach((ln) => { T(ln, c2 + 8, iy); iy -= 14; });
  }
  y = rowTop - hcpH - 16;

  // Fila 2: tabla PPM (izq) + Interpretation (der)
  const rowH = 17, tblH = rowH * 11, row2Top = y;
  const idxW = 42;
  // grilla tabla
  page.drawRectangle({ x: c1, y: row2Top - tblH, width: colW, height: tblH, borderColor: line, borderWidth: 1 });
  for (let r = 1; r < 11; r++) page.drawLine({ start: { x: c1, y: row2Top - r * rowH }, end: { x: c1 + colW, y: row2Top - r * rowH }, thickness: 0.5, color: grid });
  page.drawLine({ start: { x: c1 + idxW, y: row2Top }, end: { x: c1 + idxW, y: row2Top - tblH }, thickness: 0.5, color: grid });
  T("PPM", c1 + idxW + 6, row2Top - 12, { bold: true });
  for (let i = 0; i < 10; i++) {
    const ry = row2Top - (i + 1) * rowH - 12;
    T(String(i + 1), c1 + 6, ry);
    T(String(val["ppm" + (i + 1)] != null && String(val["ppm" + (i + 1)]).trim() !== "" ? val["ppm" + (i + 1)] : ppm[i]), c1 + idxW + 6, ry);
  }
  fieldset(c2, row2Top, colW, tblH, "Interpretation");
  { let iy = row2Top - 20; for (const ln of wrap(interpretacion, font, 9.5, colW - 16)) { T(ln, c2 + 8, iy, { size: 9.5 }); iy -= 14; } }
  y = row2Top - tblH - 18;

  // Gráfico (ancho completo)
  const gx0 = M, gx1 = W - M, gTop = y, gBottom = 54;
  page.drawRectangle({ x: gx0, y: gBottom, width: gx1 - gx0, height: gTop - gBottom, borderColor: line, borderWidth: 1 });
  const px0 = gx0 + 34, px1 = gx1 - 46, py0 = gBottom + 30, py1 = gTop - 14; // área de ploteo
  const maxV = Math.max(umbral, ...ppm, 10);
  let yMax = Math.ceil((maxV + 5) / 10) * 10; if (yMax < 30) yMax = 30;
  const yFor = (v) => py0 + (Math.max(0, Math.min(v, yMax)) / yMax) * (py1 - py0);
  const xFor = (i) => px0 + (px1 - px0) * (i / 9);
  // grilla + labels Y
  for (let v = 0; v <= yMax; v += 10) {
    const gy = yFor(v);
    page.drawLine({ start: { x: px0, y: gy }, end: { x: px1, y: gy }, thickness: 0.4, color: grid });
    T(String(v), px0 - 6 - wsize(String(v), font, 8), gy - 3, { size: 8, color: line });
  }
  // ejes
  page.drawLine({ start: { x: px0, y: py0 }, end: { x: px1, y: py0 }, thickness: 0.8, color: line });
  page.drawLine({ start: { x: px0, y: py0 }, end: { x: px0, y: py1 }, thickness: 0.8, color: line });
  // umbral (rojo)
  const uy = yFor(umbral);
  page.drawLine({ start: { x: px0, y: uy }, end: { x: px1, y: uy }, thickness: 1, color: red });
  // curva PPM (azul)
  for (let i = 0; i < 9; i++) page.drawLine({ start: { x: xFor(i), y: yFor(ppm[i]) }, end: { x: xFor(i + 1), y: yFor(ppm[i + 1]) }, thickness: 1.3, color: blue });
  // labels X (número de test)
  for (let i = 0; i < 10; i++) { const lbl = String(i + 1); T(lbl, xFor(i) - wsize(lbl, font, 8) / 2, py0 - 12, { size: 8, color: line }); }
  centerIn("Tests", px0, px1, gBottom + 6, { size: 8, color: line });
  page.drawText("PPM", { x: gx0 + 10, y: (py0 + py1) / 2 - 8, size: 8, font, color: line, rotate: degrees(90) });
  // leyenda
  page.drawRectangle({ x: px1 + 8, y: (py0 + py1) / 2, width: 6, height: 6, color: blue });
  T("PPM", px1 + 17, (py0 + py1) / 2 - 1, { size: 8, color: line });

  return await doc.save();
}

// ---- Builder propio de la Flujometría urinaria computarizada (ECUD) ----
// Ficha del paciente + datos del estudio + tabla de resultados de uroflujometría +
// curva de flujo (sintética a partir de Qmax/T a Qmax/Tiempo total) + informe.
async function buildFlujoPdf(modelo, input) {
  const { PDFDocument, StandardFonts, rgb } = require("./vendor/pdf-lib.min.js");
  const p = input.paciente || {};
  const val = input.valores || {};
  const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(",", ".").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; };
  const informe = ((input.textoInforme || "").trim()) || modelo.textoDefault || "";

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const W = 595.28, H = 841.89, M = 40;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const boldItal = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const black = rgb(0.1, 0.1, 0.1);
  const blue = rgb(0.12, 0.16, 0.78);        // valores (estilo ECUD)
  const red = rgb(0.85, 0.12, 0.12);         // "Uroflujometría:" y curva de flujo
  const green = rgb(0.2, 0.6, 0.28);         // grilla del gráfico
  const axis = rgb(0.15, 0.15, 0.15);

  const T = (t, x, y, o) => { o = o || {}; page.drawText(String(t == null ? "" : t), { x, y, size: o.size || 10, font: o.font || (o.bold ? bold : font), color: o.color || black }); };
  const wsize = (t, f, s) => f.widthOfTextAtSize(String(t == null ? "" : t), s);
  const wrapLine = (text, f, s, maxW) => {
    const words = String(text || "").split(/\s+/).filter(Boolean); const lines = []; let cur = "";
    for (const w of words) { const test = cur ? cur + " " + w : w; if (wsize(test, f, s) > maxW && cur) { lines.push(cur); cur = w; } else cur = test; }
    if (cur) lines.push(cur); return lines.length ? lines : [""];
  };
  // Etiqueta (negra) + valor (azul), estilo Ficha ECUD.
  const kv = (label, value, x, y, labelW, size) => { size = size || 10.5; T(label, x, y, { size }); if (String(value == null ? "" : value).trim()) T(value, x + labelW, y, { size, color: blue }); };

  // ===== Arriba: gráfico (izq) + Resultados (der) =====
  const volTot = num(val.volTotal), qMax = num(val.qMax), tPeak = num(val.tAQmax), tTot = Math.max(num(val.tiempoTotal), 1);
  const Vmax = Math.max(100, Math.ceil(volTot / 100) * 100);
  const Qs = 50;
  const Tmax = Math.max(20, Math.ceil(tTot * 2 / 20) * 20);

  const GX = M, GW = 250, topLbl = H - M;
  T("Q:" + Qs + " ml/s", GX, topLbl - 8, { size: 9 });
  const vLbl = "V:" + Vmax + " ml"; T(vLbl, GX + GW - wsize(vLbl, font, 9), topLbl - 8, { size: 9 });
  const gTop = topLbl - 22, GH = 220, gBot = gTop - GH;
  page.drawRectangle({ x: GX, y: gBot, width: GW, height: GH, borderColor: axis, borderWidth: 1 });
  for (let i = 1; i < 10; i++) page.drawLine({ start: { x: GX + GW * i / 10, y: gBot }, end: { x: GX + GW * i / 10, y: gTop }, thickness: 0.4, color: green });
  for (let i = 1; i < 5; i++) page.drawLine({ start: { x: GX, y: gBot + GH * i / 5 }, end: { x: GX + GW, y: gBot + GH * i / 5 }, thickness: 0.4, color: green });
  const tLbl = "T:" + Tmax + " s"; T(tLbl, GX + GW - wsize(tLbl, font, 9), gBot - 12, { size: 9 });
  // Curvas: azul = volumen acumulado (a V), roja = flujo representativo (a Q).
  const pad = 3, ax0 = GX + pad, ax1 = GX + GW - pad, ay0 = gBot + pad, ay1 = gTop - pad;
  const xForT = (t) => ax0 + (ax1 - ax0) * Math.max(0, Math.min(t, Tmax)) / Tmax;
  const yForQ = (q) => ay0 + (ay1 - ay0) * Math.max(0, Math.min(q, Qs)) / Qs;
  const yForV = (v) => ay0 + (ay1 - ay0) * Math.max(0, Math.min(v, Vmax)) / Vmax;
  if (qMax > 0) {
    const t1 = Math.max(Tmax * 0.08, Math.min((Tmax - tTot) / 2, Tmax * 0.5));
    const redAt = (t) => {
      if (t < t1 || t > t1 + tTot) return 0;
      const u = (t - t1) / tTot, up = tPeak > 0 ? Math.min(tPeak / tTot, 0.95) : 0.2;
      if (u <= up && up > 0) { const r = u / up; return qMax * Math.pow(r, 1.3) * (2 - Math.pow(r, 1.3)); }
      const r = (u - up) / Math.max(1 - up, 0.001); return qMax * (1 - r) * (1 - r * 0.25);
    };
    const N = 120, ts = [], fl = [];
    for (let i = 0; i <= N; i++) { const t = Tmax * i / N; ts.push(t); fl.push(Math.max(0, redAt(t))); }
    const cum = [0];
    for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + (fl[i] + fl[i - 1]) / 2 * (ts[i] - ts[i - 1]));
    const sc = (cum[N] > 0 && volTot > 0) ? volTot / cum[N] : 0;
    for (let i = 0; i < N; i++) {
      page.drawLine({ start: { x: xForT(ts[i]), y: yForV(cum[i] * sc) }, end: { x: xForT(ts[i + 1]), y: yForV(cum[i + 1] * sc) }, thickness: 1.2, color: blue });
      page.drawLine({ start: { x: xForT(ts[i]), y: yForQ(fl[i]) }, end: { x: xForT(ts[i + 1]), y: yForQ(fl[i + 1]) }, thickness: 1, color: red });
    }
  }

  // Resultados (derecha del gráfico)
  const RX = GX + GW + 24;
  T("Resultados:", RX, topLbl - 10, { bold: true, size: 12 });
  T("Uroflujometría:", RX, topLbl - 28, { size: 11, color: red });
  const resL = [["Q Máximo:", val.qMax], ["Q Medio 90%:", val.qMed90], ["Q Promedio:", val.qProm], ["Q a 2 seg:", val.qA2s], ["T a Qmax:", val.tAQmax], ["T de 90%:", val.t90]];
  const resR = [["Volumen Total:", val.volTotal], ["Vol hasta Qmax:", val.volQmax], ["Tiempo Total:", val.tiempoTotal], ["Tiempo Neto:", val.tiempoNeto], ["T de descenso:", val.tiempoDescenso], ["T entre pausas:", val.tiempoEntrePausas]];
  const rTop = topLbl - 48, rStep = 17, cLx = RX, cRx = RX + 130;
  for (let i = 0; i < 6; i++) {
    kv(resL[i][0], resL[i][1], cLx, rTop - i * rStep, 74, 9.5);
    kv(resR[i][0], resR[i][1], cRx, rTop - i * rStep, 80, 9.5);
  }

  // ===== Ficha =====
  let y = gBot - 28;
  T("Ficha:", M, y, { bold: true, size: 12 }); y -= 20;
  const PX = M, EX = M + 300, fLabelW = 92;
  const pac = [["Nombre:", p.nombre], ["Dirección:", ""], ["Ciudad:", ""], ["Teléfono:", ""], ["H.Clínica:", ""], ["Mutual:", ""], ["Edad:", val.edad], ["Sexo:", val.sexo]];
  const est = [["Tipo:", val.tipoEstudio || "Uroflujometría"], ["Fecha:", p.fecha], ["Número:", val.numeroEstudio], ["Motivo:", val.motivo], ["Requerido por:", val.requeridoPor], ["Operador:", val.operador || "Dr. Lisandro Veliz"], ["Diag.Clínico:", val.diagClinico], ["Diag.Urodin:", val.diagUrodinamico]];
  T("Datos del Paciente:", PX, y, { size: 10.5 });
  T("Datos del Estudio:", EX, y, { size: 10.5 });
  let fy = y - 20;
  for (let i = 0; i < 8; i++) { kv(pac[i][0], pac[i][1], PX, fy, fLabelW); kv(est[i][0], est[i][1], EX, fy, fLabelW); fy -= 17; }
  T("Observaciones:", PX, fy - 2, { size: 10.5 });
  y = fy - 32;

  // ===== Informe =====
  T("Informe:", M, y, { bold: true, size: 12 }); y -= 22;
  for (const para of String(informe).split(/\n/)) {
    if (para.trim() === "") { y -= 9; continue; }
    for (const ln of wrapLine(para, font, 12.5, W - 2 * M)) { T(ln, M, y, { size: 12.5 }); y -= 17; }
  }

  // ===== Pie: ECUD (azul cursiva) =====
  const eY = 56, eSize = 22, ew = boldItal.widthOfTextAtSize("ECUD", eSize);
  T("ECUD", W - M - ew, eY, { font: boldItal, size: eSize, color: blue });
  const sub = "Estudio Computarizado de Urodinamia", ss = 8.5;
  T(sub, W - M - wsize(sub, font, ss), eY - 12, { size: ss });

  return await doc.save();
}

// ---- Builder propio del MAPA / Presurometría 24 hs (página resumen) ----
async function buildMapaPdf(modelo, input) {
  const { PDFDocument, StandardFonts, rgb } = require("./vendor/pdf-lib.min.js");
  const p = input.paciente || {};
  const val = input.valores || {};
  const conclusion = ((input.textoInforme || "").trim()) || modelo.textoDefault || "";
  const v = (k) => String(val[k] == null ? "" : val[k]).trim();
  const firmaArchivo = input.firmaArchivo || "";

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const W = 595.28, H = 841.89, M = 40;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.12, 0.12), line = rgb(0.35, 0.35, 0.35), grid = rgb(0.8, 0.8, 0.8), band = rgb(0.9, 0.9, 0.9), soft = rgb(0.4, 0.4, 0.4);

  const T = (t, x, y, o) => { o = o || {}; page.drawText(String(t == null ? "" : t), { x, y, size: o.size || 8.5, font: o.bold ? bold : font, color: o.color || ink }); };
  const ws = (t, f, s) => f.widthOfTextAtSize(String(t == null ? "" : t), s);
  const center = (t, x1, x2, y, o) => { o = o || {}; const f = o.bold ? bold : font, s = o.size || 8.5; T(t, x1 + (x2 - x1 - ws(t, f, s)) / 2, y, o); };
  const box = (x, topY, w, h) => page.drawRectangle({ x, y: topY - h, width: w, height: h, borderColor: line, borderWidth: 0.8 });
  const wrap = (text, f, s, maxW) => { const words = String(text || "").split(/\s+/).filter(Boolean); const L = []; let c = ""; for (const w of words) { const t = c ? c + " " + w : w; if (ws(t, f, s) > maxW && c) { L.push(c); c = w; } else c = t; } if (c) L.push(c); return L; };

  let y = H - M;
  // Encabezado: nombre/dirección del cliente elegido al generar (el modelo
  // puede fijar los suyos propios si alguna vez hace falta, pero hoy no).
  center(modelo.encabezado || input.clienteNombre || "", M, W - M, y - 18, { bold: true, size: 20 });
  center(modelo.subtitulo || input.clienteDireccion || "", M, W - M, y - 34, { size: 10, color: soft });
  y -= 54;
  // Barra gris con paciente
  page.drawRectangle({ x: M, y: y - 20, width: W - 2 * M, height: 20, color: band });
  T((p.nombre || "—") + " - Estudio MAPA", M + 6, y - 14, { bold: true, size: 11 });
  y -= 28;
  // Fila de datos
  { const h = 32; box(M, y, W - 2 * M, h);
    T("Fecha", M + 6, y - 12, { bold: true }); T(p.fecha || "—", M + 42, y - 12);
    if (v("edad")) { T("Edad", M + 150, y - 12, { bold: true }); T(v("edad"), M + 182, y - 12); }
    if (v("sexo")) { T("Sexo", M + 230, y - 12, { bold: true }); T(v("sexo"), M + 262, y - 12); }
    let dy = y - 25;
    if ((p.documento || "").trim()) { T("Doc.", M + 6, dy, { bold: true }); T(p.documento, M + 42, dy); }
    if ((p.benef || "").trim()) { T("N° Benef.", M + 230, dy, { bold: true }); T(p.benef, M + 285, dy); }
    y -= h + 10;
  }

  const colTop = y, colGap = 12;
  const leftW = 208, rightX = M + leftW + colGap, rightW = W - M - rightX;
  // ---- Columna izquierda: cajas ----
  { const h = 46; box(M, colTop, leftW, h); let iy = colTop - 13;
    T("Médico", M + 6, iy, { bold: true }); T(v("medico"), M + 52, iy); iy -= 14;
    T("Técnico", M + 6, iy, { bold: true }); iy -= 14;
    T("Referido por", M + 6, iy, { bold: true });
  }
  const box2Top = colTop - 46 - 8;
  { const h = 58; box(M, box2Top, leftW, h); let iy = box2Top - 13;
    T("Indicaciones", M + 6, iy, { bold: true }); iy -= 16;
    T("Medicación", M + 6, iy, { bold: true }); T(v("medicacion"), M + 70, iy); iy -= 16;
    T("Observaciones", M + 6, iy, { bold: true });
  }
  const box3Top = box2Top - 58 - 8;
  { const h = 40; box(M, box3Top, leftW, h);
    T("Horario de sueño: " + (v("horarioSueno") || "—"), M + 6, box3Top - 15);
    const pat = v("patronDescenso") + (v("clasificacion") ? " (" + v("clasificacion") + ")" : "");
    T("Patrón de descenso nocturno: " + (pat || "—"), M + 6, box3Top - 30);
  }

  // ---- Columna derecha: tabla por períodos ----
  const cols = [
    { x: rightX, w: 58 },        // Período
    { x: rightX + 58, w: 34 },   // stat
    { x: rightX + 92, w: 40 },   // PAS
    { x: rightX + 132, w: 40 },  // PAD
    { x: rightX + 172, w: 34 },  // FC
    { x: rightX + 206, w: 40 },  // PAM
    { x: rightX + 246, w: rightW - 246 }, // PP
  ];
  const rh = 13;
  const cellC = (ci, txt, ry, o) => { o = o || {}; center(txt, cols[ci].x, cols[ci].x + cols[ci].w, ry, o); };
  // header
  page.drawRectangle({ x: rightX, y: colTop - rh, width: rightW, height: rh, color: band });
  ["Período", "", "PAS", "PAD", "FC", "PAM", "PP"].forEach((t, i) => cellC(i, t, colTop - 9, { bold: true, size: 8 }));
  let ty = colTop - rh;
  const num = (k) => { const n = Number(v(k).replace(",", ".")); return isFinite(n) ? n : null; };
  const pam = (pas, pad) => (pas != null && pad != null) ? String(Math.round(pad + (pas - pad) / 3)) : "";
  const pp = (pas, pad) => (pas != null && pad != null) ? String(Math.round(pas - pad)) : "";
  const periodos = [
    { lbl: "Total", n: v("nTot"), ref: "", pre: "T" },
    { lbl: "Vigilia", n: v("nVig"), ref: "135/85", pre: "V" },
    { lbl: "Sueño", n: v("nSue"), ref: "120/70", pre: "S" },
  ];
  for (const per of periodos) {
    const P = per.pre;
    const pasP = num("pas" + P + "P"), padP = num("pad" + P + "P");
    const filas = [
      { s: "Prom.", pas: v("pas" + P + "P"), pad: v("pad" + P + "P"), fc: v("fc" + P + "P"), pam: pam(pasP, padP), pp: pp(pasP, padP) },
      { s: "Mín.", pas: v("pas" + P + "Min"), pad: v("pad" + P + "Min"), fc: "", pam: "", pp: "" },
      { s: "Máx.", pas: v("pas" + P + "Max"), pad: v("pad" + P + "Max"), fc: "", pam: "", pp: "" },
      { s: "Carga", pas: v("cg" + P + "Pas"), pad: v("cg" + P + "Pad"), fc: "", pam: "", pp: "" },
    ];
    const blockTop = ty, blockH = rh * filas.length;
    // celda período (spanning)
    T(per.lbl, cols[0].x + 4, blockTop - 10, { bold: true, size: 8 });
    T("(N = " + (per.n || "—") + ")", cols[0].x + 4, blockTop - 21, { size: 7, color: soft });
    if (per.ref) { T("Ref:", cols[0].x + 4, blockTop - blockH + 15, { size: 6.5, color: soft }); T(per.ref, cols[0].x + 4, blockTop - blockH + 6, { size: 6.5, color: soft }); }
    filas.forEach((f, ri) => {
      const ry = ty - ri * rh - 9;
      cellC(1, f.s, ry, { size: 7.5, bold: f.s === "Prom." });
      cellC(2, f.pas, ry, { size: 8 }); cellC(3, f.pad, ry, { size: 8 }); cellC(4, f.fc, ry, { size: 8 }); cellC(5, f.pam, ry, { size: 8 }); cellC(6, f.pp, ry, { size: 8 });
    });
    ty -= blockH;
    page.drawLine({ start: { x: rightX, y: ty }, end: { x: rightX + rightW, y: ty }, thickness: 0.5, color: grid });
  }
  // borde tabla + líneas verticales
  page.drawRectangle({ x: rightX, y: ty, width: rightW, height: colTop - ty, borderColor: line, borderWidth: 0.8 });
  for (let i = 1; i < cols.length; i++) page.drawLine({ start: { x: cols[i].x, y: colTop }, end: { x: cols[i].x, y: ty }, thickness: 0.4, color: grid });

  // ---- Conclusiones ----
  const concTop = Math.min(box3Top - 40 - 12, ty - 12);
  const concBottom = 70;
  box(M, concTop, W - 2 * M, concTop - concBottom);
  T("Conclusiones", M + 6, concTop - 14, { bold: true, size: 10 });
  let cy = concTop - 30;
  for (const ln of String(conclusion).split(/\n/)) {
    for (const w of wrap(ln, font, 9, W - 2 * M - 16)) { T(w, M + 6, cy, { size: 9 }); cy -= 13; }
  }
  // Firma (solo si hay firma autorizada)
  const firmaBuf = firmaArchivo ? readAsset(firmaArchivo) : null;
  if (firmaBuf) { try { const img = await doc.embedPng(firmaBuf); const { w: fw, h: fh } = encajarImagen(img, 140, 50); page.drawImage(img, { x: W - M - fw - 20, y: concBottom + 8, width: fw, height: fh }); } catch {} }
  else { page.drawLine({ start: { x: W - M - 170, y: concBottom + 18 }, end: { x: W - M - 20, y: concBottom + 18 }, thickness: 0.7, color: line }); center("Firma y sello", W - M - 170, W - M - 20, concBottom + 6, { size: 8, color: soft }); }

  return await doc.save();
}

// ---- Builder propio de la Ergometría (página resumen) ----
async function buildErgoPdf(modelo, input) {
  const { PDFDocument, StandardFonts, rgb } = require("./vendor/pdf-lib.min.js");
  const p = input.paciente || {};
  const val = input.valores || {};
  const conclusion = ((input.textoInforme || "").trim()) || modelo.textoDefault || "";
  const v = (k) => String(val[k] == null ? "" : val[k]).trim();
  const firmaArchivo = input.firmaArchivo || "";

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const W = 595.28, H = 841.89, M = 40;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique);
  const ink = rgb(0.12, 0.12, 0.12), line = rgb(0.35, 0.35, 0.35), soft = rgb(0.4, 0.4, 0.4);

  const T = (t, x, y, o) => { o = o || {}; page.drawText(String(t == null ? "" : t), { x, y, size: o.size || 8.5, font: o.font || (o.bold ? bold : font), color: o.color || ink }); };
  const ws = (t, f, s) => f.widthOfTextAtSize(String(t == null ? "" : t), s);
  const box = (x, topY, w, h) => page.drawRectangle({ x, y: topY - h, width: w, height: h, borderColor: line, borderWidth: 0.8 });
  const hr = (yy) => page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness: 0.6, color: line });
  const wrap = (text, f, s, maxW) => { const words = String(text || "").split(/\s+/).filter(Boolean); const L = []; let c = ""; for (const w of words) { const t = c ? c + " " + w : w; if (ws(t, f, s) > maxW && c) { L.push(c); c = w; } else c = t; } if (c) L.push(c); return L; };

  let y = H - M;
  // Encabezado (caja): nombre del cliente / departamento (del modelo, es la
  // especialidad del estudio) / dirección del cliente.
  { const h = 62; box(M, y, W - 2 * M, h);
    T(modelo.encabezado || input.clienteNombre || "", M + 70, y - 22, { bold: true, size: 20 });
    T(modelo.depto || "", M + 70, y - 38, { font: ital, size: 11 });
    page.drawLine({ start: { x: M + 70, y: y - 43 }, end: { x: W - M - 8, y: y - 43 }, thickness: 0.5, color: soft });
    T(modelo.subtitulo || input.clienteDireccion || "", M + 70, y - 55, { size: 9, color: soft });
    y -= h + 12;
  }
  // Título
  T(modelo.titulo || "Estudio", M + 4, y - 12, { bold: true, size: 12 });
  hr(y - 18); y -= 26;

  // Datos del paciente
  T("Paciente", M, y, { bold: true }); T(p.nombre || "—", M + 52, y);
  T("Fecha", W - M - 150, y, { bold: true }); T(p.fecha || "—", W - M - 110, y); y -= 14;
  const lab = (t, x, yy) => T(t, x, yy, { bold: true });
  lab("Sexo", M, y); T(v("sexo") || "—", M + 34, y);
  lab("Edad", M + 130, y); T(v("edad") || "—", M + 164, y);
  lab("Peso", M + 220, y); T(v("peso") || "—", M + 254, y);
  lab("Estatura", M + 320, y); T(v("estatura") || "—", M + 366, y);
  lab("IMC", M + 430, y); T(v("imc") || "—", M + 458, y); y -= 14;
  if ((p.documento || "").trim()) { lab("Doc. Nº", M, y); T(p.documento, M + 52, y); }
  if ((p.benef || "").trim()) { lab("N° Benef.", M + 220, y); T(p.benef, M + 275, y); }
  if ((p.documento || "").trim() || (p.benef || "").trim()) y -= 14;
  hr(y + 2); y -= 12;
  lab("Indicación/motivo", M, y); T(v("indicacion") || "—", M + 110, y); y -= 14;
  lab("Medicación/tratamiento", M, y); T(v("medicacion") || "—", M + 135, y); y -= 18;
  lab("Fecha/hora inicio de la prueba", M, y); T(v("fechaHoraInicio") || "—", M + 175, y); y -= 18;

  // Resultados (2 columnas)
  { const h = 82; box(M, y, W - 2 * M, h);
    page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 16, color: rgb(0.92, 0.92, 0.92) });
    T("Resultados", M + 6, y - 11, { bold: true, size: 9.5 });
    const colL = M + 8, colR = M + (W - 2 * M) / 2 + 6;
    const izq = [
      "Protocolo: " + (v("protocolo") || "—"),
      "Frec. cardíaca prevista (máx./submáx.): " + (v("fcPrevMax") || "—") + " / " + (v("fcPrevSub") || "—"),
      "Máx. frec. cardíaca alcanzada: " + (v("fcAlcanzada") || "—") + (v("pctFcMax") || v("pctFcSub") ? " (" + (v("pctFcMax") || "—") + " / " + (v("pctFcSub") || "—") + ")" : ""),
      "Máx. Doble Producto: " + (v("dobleProd") || "—"),
      "Carga alcanzada: " + (v("carga") || "—"),
    ];
    const der = [
      "Máx. presión arterial sistólica: " + (v("taSis") || "—"),
      "Máx. presión arterial diastólica: " + (v("taDia") || "—"),
      "Máx. METS: " + (v("mets") || "—"),
      "Máx. VO2: " + (v("vo2") || "—"),
      "Motivo de detención: " + (v("motivoDeten") || "—"),
    ];
    let ly = y - 30; izq.forEach((t) => { for (const w of wrap(t, font, 8.5, (W - 2 * M) / 2 - 16)) { T(w, colL, ly, { size: 8.5 }); ly -= 11; } });
    let ry = y - 30; der.forEach((t) => { for (const w of wrap(t, font, 8.5, (W - 2 * M) / 2 - 16)) { T(w, colR, ry, { size: 8.5 }); ry -= 11; } });
    y -= h + 10;
  }

  // Conclusiones
  const concTop = y, concBottom = 80;
  box(M, concTop, W - 2 * M, concTop - concBottom);
  page.drawRectangle({ x: M, y: concTop - 16, width: W - 2 * M, height: 16, color: rgb(0.92, 0.92, 0.92) });
  T("Conclusiones", M + 6, concTop - 11, { bold: true, size: 9.5 });
  let cy = concTop - 30;
  for (const ln of String(conclusion).split(/\n/)) {
    for (const w of wrap(ln, ital, 9.5, W - 2 * M - 16)) { T(w, M + 8, cy, { font: ital, size: 9.5 }); cy -= 13; }
  }
  // Firma (solo si hay firma autorizada)
  const firmaBuf = firmaArchivo ? readAsset(firmaArchivo) : null;
  if (firmaBuf) { try { const img = await doc.embedPng(firmaBuf); const { w: fw, h: fh } = encajarImagen(img, 140, 50); page.drawImage(img, { x: W - M - fw - 20, y: concBottom + 8, width: fw, height: fh }); } catch {} }
  else { page.drawLine({ start: { x: W - M - 170, y: concBottom + 18 }, end: { x: W - M - 20, y: concBottom + 18 }, thickness: 0.7, color: line }); T("Firma y sello", W - M - 130, concBottom + 6, { size: 8, color: soft }); }

  return await doc.save();
}

module.exports = { MODELOS, buildInformePdf, informeFilename, listarModelos, MODELO_RENOMBRADOS, MODELO_VIEJO_CLIENTE };
