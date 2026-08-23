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

const PIE_CABALLITO = ["Centro médico Caballito", "Av. directorio 1662", "Tel: 6338713 / 46330078 / 46324002"];
const PIE_CIMA = ["CIMA - Innovación en Medicina", "Islas Malvinas 2722 - Isidro Casanova"];

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
const MODELOS = {
  // --- Centro Médico Caballito: misma doctora, cambia el estudio realizado ---
  "caballito-consulta-570129": {
    label: "Caballito — Consulta cardiología c/ ECG (570129)",
    short: "Caballito · Consulta ECG",
    practica: "Consulta cardiológica c/ ECG — 570129",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "570129",
    estudio: "Consulta con especialista en cardiología (incluye ECG)",
    estudioArchivo: "Consulta Cardiologia ECG",
    solicitanteDefault: "Dra. Naiara, Jacinto",
    textoDefault: "Ecg sin complicaciones, trazado sin valor patológico.",
    pie: PIE_CABALLITO,
  },
  "caballito-electro": {
    label: "Caballito — Electrocardiograma simple",
    short: "Caballito · ECG",
    practica: "ECG simple",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "",
    estudio: "Electrocardiograma",
    solicitanteDefault: "Dra. Naiara, Jacinto",
    textoDefault: "Ecg sin complicaciones, trazado sin valor patológico.",
    pie: PIE_CABALLITO,
  },
  "caballito-holter": {
    label: "Caballito — Holter cardíaco 24 hs",
    short: "Caballito · Holter",
    practica: "Holter cardíaco 24 hs",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "",
    estudio: "Holter cardíaco de 3 canales 24 hs.",
    estudioArchivo: "Holter 24 hs",
    solicitanteDefault: "Dra. Naiara, Jacinto",
    textoDefault: "Ritmo sinusal durante todo el estudio. Conducción AV dentro de límites fisiológicos. No se observaron arritmias supraventriculares ni ventriculares significativas. No se observaron cambios significativos del segmento ST-T. No se observaron pausas significativas. No refirió síntomas durante el estudio. Se analizó registro electrocardiográfico de 24 hs.",
    pie: PIE_CABALLITO,
    // Caja "DATOS TÉCNICOS DEL REGISTRO": valores estándar precargados, todos editables.
    tecnicosTitulo: "DATOS TÉCNICOS DEL REGISTRO",
    campos: HOLTER_CAMPOS,
  },
  // --- CIMA (Innovación en Medicina): electro, firma Dr. Savia ---
  "cima-electro": {
    label: "CIMA — Electrocardiograma",
    short: "CIMA · ECG",
    practica: "Electrocardiograma",
    centro: "CIMA",
    logo: "cima_logo.png",
    logoW: 150,
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "",
    estudio: "Electrocardiograma",
    solicitanteDefault: "Gerardo Savia",
    textoDefault: "Trazado sin valor patológico.",
    pie: PIE_CIMA,
  },
  "cima-consulta-570129": {
    label: "CIMA — Consulta cardiología c/ ECG (570129)",
    short: "CIMA · Consulta ECG",
    practica: "Consulta cardiológica c/ ECG — 570129",
    centro: "CIMA",
    logo: "cima_logo.png",
    logoW: 150,
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "570129",
    estudio: "Consulta con especialista en cardiología (incluye ECG)",
    estudioArchivo: "Consulta Cardiologia ECG",
    solicitanteDefault: "Gerardo Savia",
    textoDefault: "Trazado sin valor patológico.",
    pie: PIE_CIMA,
  },
  "cima-holter": {
    label: "CIMA — Holter cardíaco 24 hs",
    short: "CIMA · Holter",
    practica: "Holter cardíaco 24 hs",
    centro: "CIMA",
    logo: "cima_logo.png",
    logoW: 150,
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "",
    estudio: "Holter cardíaco de 3 canales 24 hs.",
    estudioArchivo: "Holter 24 hs",
    solicitanteDefault: "Gerardo Savia",
    textoDefault: "Se realizó Holter de tres canales. Ritmo sinusal permanente. Conducción AV dentro de límites normales. Conducción IV dentro de límites normales. No se detectaron ectópicos. No se detectaron alteraciones inespecíficas de la repolarización ventricular. Sin síntomas.",
    pie: PIE_CIMA,
    tecnicosTitulo: "DATOS TÉCNICOS DEL REGISTRO",
    campos: HOLTER_CAMPOS_CIMA,
  },
  // ===================== ORL / Otorrinolaringología =====================
  // Mismo layout que cardiología (sin caja técnica). Cambia el servicio y, en
  // algunas prácticas, se elige el lado (el texto del preset cambia según el lado).
  "caballito-orl-cerumen": {
    label: "Caballito — Extracción tapón de cerumen / cuerpo extraño (717111)",
    short: "Caballito · Cerumen",
    practica: "717111 - Extracción de tapón de cerumen / cuerpo extraño",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717111",
    estudio: "EXTRACCIÓN DE CUERPO EXTRAÑO EN OÍDO + EXTRACCIÓN DE TAPÓN DE CERUMEN",
    estudioArchivo: "Extraccion tapon cerumen",
    solicitanteDefault: "",
    textoDefault: "SE REALIZA OTOMICROSCOPIA. SE EVIDENCIA TAPÓN DE CERUMEN EN CONDUCTO AUDITIVO EXTERNO, EL CUAL SE EXTRAE EN SU TOTALIDAD. POSTERIOR AL PROCEDIMIENTO SE CONSTATA CONDUCTO AUDITIVO PERMEABLE, CON MEMBRANA TIMPÁNICA NORMOLÚCIDA.",
    pie: PIE_CABALLITO,
    requiereLado: true,
  },
  "caballito-orl-quimico": {
    label: "Caballito — Tratamiento químico ORL (717125)",
    short: "Caballito · Trat. químico",
    practica: "717125 - Tratamiento de lesiones ORL por medios físicos o químicos",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717125",
    estudio: "TRATAMIENTO DE LESIONES OTORRINOLARINGOLÓGICAS POR MEDIOS FÍSICOS O QUÍMICOS",
    estudioArchivo: "Tratamiento quimico ORL",
    solicitanteDefault: "",
    textoDefault: "SE REALIZA TRATAMIENTO QUÍMICO DE LESIÓN ANGIOMATOSA EN REGIÓN ANTERIOR SEPTAL, POR EPÍSTAXIS ANTERIOR RECURRENTE. PROCEDIMIENTO BIEN TOLERADO.",
    pie: PIE_CABALLITO,
  },
  "caballito-orl-combinado": {
    label: "Caballito — Cerumen + Tratamiento químico (717111 + 717125)",
    short: "Caballito · Combinado",
    practica: "717111 + 717125 - Cerumen + Tratamiento químico (combinado)",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717111 + 717125",
    estudio: "EXTRACCIÓN DE CUERPO EXTRAÑO EN OÍDO + EXTRACCIÓN DE TAPÓN DE CERUMEN + TRATAMIENTO DE LESIONES OTORRINOLARINGOLÓGICAS POR MEDIOS FÍSICOS O QUÍMICOS",
    estudioArchivo: "Cerumen y tratamiento quimico",
    solicitanteDefault: "",
    textoDefault: "SE REALIZA OTOMICROSCOPIA. SE EVIDENCIA TAPÓN DE CERUMEN EN CONDUCTO AUDITIVO EXTERNO, EL CUAL SE EXTRAE EN SU TOTALIDAD. POSTERIOR AL PROCEDIMIENTO SE CONSTATA CONDUCTO AUDITIVO PERMEABLE, CON MEMBRANA TIMPÁNICA NORMOLÚCIDA. SE REALIZA ADEMÁS TRATAMIENTO QUÍMICO DE LESIÓN ANGIOMATOSA EN REGIÓN ANTERIOR SEPTAL, POR EPÍSTAXIS ANTERIOR RECURRENTE. PROCEDIMIENTOS BIEN TOLERADOS.",
    pie: PIE_CABALLITO,
    requiereLado: true,
  },
  "caballito-orl-videorino": {
    label: "Caballito — Video rinofibrolaringoscopia (717132)",
    short: "Caballito · Videorino",
    practica: "717132 - Video rinofibrolaringoscopia",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717132",
    estudio: "VIDEO RINOFIBROLARINGOSCOPIA",
    estudioArchivo: "Video rinofibrolaringoscopia",
    solicitanteDefault: "",
    textoDefault: "SE REALIZA VIDEO RINOFIBROLARINGOSCOPIA. SE OBSERVAN FOSAS NASALES PERMEABLES, CAVUM LIBRE, FARINGE Y LARINGE SIN LESIONES EVIDENTES. CUERDAS VOCALES MÓVILES Y SIMÉTRICAS, CON BUENA COAPTACIÓN GLÓTICA. PROCEDIMIENTO BIEN TOLERADO.",
    pie: PIE_CABALLITO,
  },
  "cima-orl-videorino": {
    label: "CIMA — Video rinofibrolaringoscopia (717132)",
    short: "CIMA · Videorino",
    practica: "717132 - Video rinofibrolaringoscopia",
    centro: "CIMA",
    logo: "cima_logo.png",
    logoW: 150,
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717132",
    estudio: "VIDEO RINOFIBROLARINGOSCOPIA",
    estudioArchivo: "Video rinofibrolaringoscopia",
    solicitanteDefault: "",
    textoDefault: "SE REALIZA VIDEO RINOFIBROLARINGOSCOPIA. SE OBSERVAN FOSAS NASALES PERMEABLES, CAVUM LIBRE, FARINGE Y LARINGE SIN LESIONES EVIDENTES. CUERDAS VOCALES MÓVILES Y SIMÉTRICAS, CON BUENA COAPTACIÓN GLÓTICA. PROCEDIMIENTO BIEN TOLERADO.",
    pie: PIE_CIMA,
  },
  // --- Centro Médico Caballito: Dermatología (criocirugía) ---
  "caballito-derma-crio": {
    label: "Caballito — Criocirugía de piel (510320)",
    short: "Caballito · Criocirugía",
    practica: "510320 - Ablación de lesiones de piel por criocirugía",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE DERMATOLOGÍA",
    especialidad: "Dermatología",
    codigoPractica: "510320",
    estudio: "ABLACIÓN DE LESIONES DE PIEL EN GENERAL POR CRIOCIRUGÍA",
    estudioArchivo: "Ablacion de piel por criocirugia",
    solicitanteDefault: "",
    textoDefault: "SE REALIZA CRIOCIRUGÍA DE QUERATOSIS ACTÍNICAS Y SEBORREICAS EN CUERO CABELLUDO Y ROSTRO. PROCEDIMIENTO BIEN TOLERADO, SIN COMPLICACIONES INMEDIATAS.",
    pie: PIE_CABALLITO,
  },
  // --- Centro Médico Caballito: Dermatología (electrocoagulación / TCA) ---
  "caballito-derma-electro": {
    label: "Caballito — Destrucción de lesión de piel (537106)",
    short: "Caballito · TCA/Electro",
    practica: "537106 - Destrucción de lesión de piel por electrocoagulación o TCA",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    servicio: "SERVICIO DE DERMATOLOGÍA",
    especialidad: "Dermatología",
    codigoPractica: "537106",
    estudio: "TOPICACION CON TCA",
    estudioArchivo: "Destruccion de lesion de piel",
    solicitanteDefault: "Dra. Leydy Henriquez Gomez",
    textoDefault: "PREVIA ANTISEPSIA SE REALIZA TOPICACIÓN CON TCA AL 50% DE QUERATOSIS SEBORREICAS EN ROSTRO. TOLERA PROCEDIMIENTO, SIN COMPLICACIONES.",
    pie: PIE_CABALLITO,
  },
  // --- Centro Médico Caballito: Test de SIBO (aire espirado) — layout propio ---
  "caballito-sibo": {
    label: "Caballito — Test de SIBO (607130)",
    short: "Caballito · SIBO",
    practica: "607130 - Test de aire espirado (SIBO)",
    centro: "Centro Médico Caballito",
    logo: "cmc_logo.png",
    logoW: 84,
    especialidad: "Gastroenterología / Estudios funcionales",
    codigoPractica: "607130",
    estudio: "TEST DE AIRE ESPIRADO PARA SOBRECRECIMIENTO BACTERIANO",
    estudioArchivo: "Test de SIBO",
    tipo: "sibo",
    testType: "SIBO 2026",
    profesionalDefault: ["DR. RAMIRO CALCAGNO", "MN 149098   MP 232961"],
    campos: SIBO_CAMPOS,
    solicitanteDefault: "",
    textoDefault: "Estudio negativo para SIBO",
    pie: PIE_CABALLITO,
  },
  // --- CIMA: MAPA / Presurometría 24 hs — layout propio (página resumen) ---
  "cima-mapa": {
    label: "CIMA — MAPA / Presurometría 24 hs (570120)",
    short: "CIMA · MAPA",
    practica: "570120 - Presurometría 24 hs / MAPA",
    centro: "CIMA",
    especialidad: "Cardiología",
    codigoPractica: "570120",
    estudio: "PRESUROMETRÍA POR 24 HS / MAPA",
    estudioArchivo: "MAPA Presurometria 24hs",
    tipo: "mapa",
    encabezado: "CIMA SALUD",
    subtitulo: "Islas malvinas 2722 - Isidro Casanova",
    campos: MAPA_CAMPOS,
    solicitanteDefault: "",
    textoDefault: "REGISTRO DE PRESIÓN ARTERIAL DENTRO DE PARÁMETROS CONSERVADOS. ESTUDIO TÉCNICAMENTE SATISFACTORIO.",
    pie: PIE_CIMA,
  },
  // --- CIMA: Ergometría computarizada — layout propio (página resumen) ---
  "cima-ergo": {
    label: "CIMA — Ergometría (570124)",
    short: "CIMA · Ergometría",
    practica: "570124 - Ergometría computarizada 12 derivaciones",
    centro: "CIMA",
    especialidad: "Cardiología",
    codigoPractica: "570124",
    estudio: "ERGOMETRÍA COMPUTARIZADA DE DOCE DERIVACIONES CON OXIMETRÍA",
    estudioArchivo: "Ergometria",
    tipo: "ergo",
    encabezado: "CIMA",
    depto: "Dpto. de Cardiología",
    subtitulo: "Islas Malvinas 2722 - Isidro Casanova",
    titulo: "Estudio CardioVex Ergometría",
    campos: ERGO_CAMPOS,
    solicitanteDefault: "",
    textoDefault: "PRUEBA SUBMÁXIMA SUFICIENTE. ESTUDIO TÉCNICAMENTE SATISFACTORIO.",
    pie: PIE_CIMA,
  },
  // --- Caballito: Flujometría urinaria computarizada (ECUD) — layout propio ---
  "caballito-flujometria": {
    label: "Caballito — Flujometría urinaria computarizada (507315)",
    short: "Caballito · Flujometría",
    practica: "507315 - Flujometría urinaria computarizada",
    centro: "Centro Médico Caballito",
    especialidad: "Urología",
    logo: "cmc_logo.png",
    logoW: 84,
    codigoPractica: "507315",
    estudio: "FLUJOMETRÍA URINARIA COMPUTARIZADA",
    estudioArchivo: "Flujometria urinaria",
    tipo: "flujo",
    campos: FLUJO_CAMPOS,
    solicitanteDefault: "",
    textoDefault: "Estudio normal",
    pie: PIE_CABALLITO,
  },
};
// Para el desplegable del front (una sola fuente de verdad).
function listarModelos() {
  return Object.keys(MODELOS).map((k) => ({
    key: k,
    label: MODELOS[k].label || k,
    short: MODELOS[k].short || MODELOS[k].label || k,
    practica: MODELOS[k].practica || MODELOS[k].estudio || k,
    centro: MODELOS[k].centro || "",
    especialidad: MODELOS[k].especialidad || "",
    codigoPractica: MODELOS[k].codigoPractica || "",
    campos: MODELOS[k].campos || [],
    requiereLado: !!MODELOS[k].requiereLado,
  }));
}

// Las firmas (dato sensible) viven en <datos>/informes/ (el volumen en producción,
// o web/data en local) — ahí las sube el admin. El logo va en assets del repo.
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");
function readAsset(name) {
  try { return fs.readFileSync(path.join(DATA_DIR, "informes", name)); } catch {}
  try { return fs.readFileSync(path.join(ASSETS, name)); } catch { return null; }
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

const DEFAULT_MODELO = "caballito-consulta-570129";

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
  const solicitante = ((input && input.solicitante) || "").trim() || modelo.solicitanteDefault;
  // La firma la define el médico elegido (input.firmaArchivo). Sin archivo -> borrador.
  const firmaArchivo = (input && input.firmaArchivo) || "";

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

  // Logo centrado (fondo blanco)
  const logoBuf = readAsset(modelo.logo);
  if (logoBuf) {
    const logo = await doc.embedPng(logoBuf);
    const lw = modelo.logoW || 84, lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: (width - lw) / 2, y: y - lh, width: lw, height: lh });
    y -= lh + 6;
  }

  // Título (bold itálica)
  const ts = 17;
  centerT(modelo.servicio, y - ts, { font: titleFont, size: ts, color: border });
  y -= ts + 22;

  // Caja: Datos de paciente
  {
    const hasDoc = (p.documento || "").trim();
    const innerLines = 1 + 2 + (hasDoc ? 1 : 0);
    const h = innerLines * 15 + 14;
    drawBox(y, h);
    let iy = y - 18;
    T("Datos de paciente", LBLX, iy, { bold: true, size: 11 }); iy -= 16;
    T("Nombre:", LBLX, iy, { bold: true }); T(p.nombre || "—", VALX, iy); iy -= 15;
    if (hasDoc) { T("Documento:", LBLX, iy, { bold: true }); T(hasDoc, VALX, iy); iy -= 15; }
    T("N° Benef.:", LBLX, iy, { bold: true }); T(p.benef || "—", VALX, iy);
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
    const estudio = modelo.estudio || "";
    if (bold.widthOfTextAtSize(estudio, 10.5) <= rightX - vx) {
      const h = 34; drawBox(y, h);
      T("Estudio realizado:", LBLX, y - 22, { bold: true });
      T(estudio, vx, y - 22, { bold: true });
      y -= h + 22;
    } else {
      const lines = wrapText(estudio, bold, 10.5, boxW - 2 * PADX);
      const h = 20 + lines.length * 14 + 8;
      drawBox(y, h);
      T("Estudio realizado:", LBLX, y - 18, { bold: true });
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
    const fw = 150, fh = (firma.height / firma.width) * fw;
    page.drawImage(firma, { x: firmaAreaX + (firmaAreaW - fw) / 2, y: fy - 22, width: fw, height: fh });
  } else {
    centerIn("Firma Médico", firmaAreaX, width - Mx, fy, { bold: true, size: 11 });
    page.drawLine({ start: { x: firmaAreaX + 12, y: fy - 34 }, end: { x: width - Mx - 12, y: fy - 34 }, thickness: 0.8, color: border });
  }

  // Caja: pie del centro (abajo)
  {
    const top = 100, h = 52;
    drawBox(top, h);
    let py = top - 18;
    centerT(modelo.pie[0], py, { bold: true, size: 12 }); py -= 15;
    for (let i = 1; i < modelo.pie.length; i++) { centerT(modelo.pie[i], py, { bold: true, size: 10.5 }); py -= 14; }
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
  const profes = modelo.profesionalDefault || [];

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
  // Logo centrado
  const logoBuf = readAsset(modelo.logo);
  if (logoBuf) { try { const img = await doc.embedPng(logoBuf); const lw = modelo.logoW || 84, lh = (img.height / img.width) * lw; page.drawImage(img, { x: (W - lw) / 2, y: y - lh, width: lw, height: lh }); y -= lh + 16; } catch {} }

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
  // Encabezado
  center(modelo.encabezado || "CIMA SALUD", M, W - M, y - 18, { bold: true, size: 20 });
  center(modelo.subtitulo || "", M, W - M, y - 34, { size: 10, color: soft });
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
  if (firmaBuf) { try { const img = await doc.embedPng(firmaBuf); const fw = 140, fh = (img.height / img.width) * fw; page.drawImage(img, { x: W - M - fw - 20, y: concBottom + 8, width: fw, height: fh }); } catch {} }
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
  // Encabezado (caja): CIMA / Dpto. de Cardiología / dirección
  { const h = 62; box(M, y, W - 2 * M, h);
    T(modelo.encabezado || "CIMA", M + 70, y - 22, { bold: true, size: 20 });
    T(modelo.depto || "", M + 70, y - 38, { font: ital, size: 11 });
    page.drawLine({ start: { x: M + 70, y: y - 43 }, end: { x: W - M - 8, y: y - 43 }, thickness: 0.5, color: soft });
    T(modelo.subtitulo || "", M + 70, y - 55, { size: 9, color: soft });
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
  if (firmaBuf) { try { const img = await doc.embedPng(firmaBuf); const fw = 140, fh = (img.height / img.width) * fw; page.drawImage(img, { x: W - M - fw - 20, y: concBottom + 8, width: fw, height: fh }); } catch {} }
  else { page.drawLine({ start: { x: W - M - 170, y: concBottom + 18 }, end: { x: W - M - 20, y: concBottom + 18 }, thickness: 0.7, color: line }); T("Firma y sello", W - M - 130, concBottom + 6, { size: 8, color: soft }); }

  return await doc.save();
}

module.exports = { MODELOS, buildInformePdf, informeFilename, listarModelos };
