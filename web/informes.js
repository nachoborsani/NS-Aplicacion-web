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
// Set completo del Holter (el que usa el modelo hoy). Cada campo lleva:
//  - `grupo`: para las secciones plegables del formulario (el front las arma).
//  - `resumen: true`: entra en la caja resumen del PDF. Si NINGÚN campo del
//    modelo trae `resumen`, el builder muestra todos los campos (el resto de los
//    modelos no cambia). Ver buildInformePdf, caja "DATOS TÉCNICOS DEL REGISTRO".
// Los keys que ya existían (duracion, fcProm, fcMin, fcMax, totalLatidos, ev,
// esv, pausas, stt, sintomas, pausaMasLarga, motivo, medicacion, latidosAnormales)
// se conservan tal cual para no romper presets viejos ni el matcheo.
const HOLTER_CAMPOS_FULL = [
  // --- Resumen (va al PDF) ---
  { key: "duracion", label: "Duración", default: "24 hs", grupo: "resumen", resumen: true },
  { key: "ritmo", label: "Ritmo predominante", default: "Ritmo sinusal durante todo el estudio", wide: true, grupo: "resumen", resumen: true },
  { key: "conduccionAV", label: "Conducción AV", default: "Conservada", grupo: "resumen", resumen: true },
  { key: "fcProm", label: "FC media", default: "72 lpm", grupo: "resumen", resumen: true },
  { key: "fcMin", label: "FC mínima", default: "55 lpm", grupo: "resumen", resumen: true },
  { key: "fcMax", label: "FC máxima", default: "118 lpm", grupo: "resumen", resumen: true },
  { key: "totalLatidos", label: "Total de latidos", default: "103.000 aprox.", grupo: "resumen", resumen: true },
  { key: "ev", label: "EV totales", default: "0", grupo: "resumen", resumen: true },
  { key: "evPct", label: "EV %", default: "0", grupo: "resumen", resumen: true },
  { key: "esv", label: "ESV totales", default: "0", grupo: "resumen", resumen: true },
  { key: "esvPct", label: "ESV %", default: "0", grupo: "resumen", resumen: true },
  { key: "pausas", label: "Pausas >2500 ms", default: "0", grupo: "resumen", resumen: true },
  { key: "pausaMasLarga", label: "Pausa más larga (ms)", default: "0", grupo: "resumen", resumen: true },
  { key: "pausasTexto", label: "Pausas — texto", default: "Sin pausas significativas", wide: true, grupo: "resumen", resumen: true },
  { key: "stt", label: "ST-T conclusión", default: "Sin cambios significativos", wide: true, grupo: "resumen", resumen: true },
  { key: "sintomas", label: "Síntomas", default: "No refiere", grupo: "resumen", resumen: true },
  // --- Datos generales (no van al PDF resumen) ---
  { key: "marcapasos", label: "Marcapasos", default: "No", grupo: "general" },
  { key: "latidosAnormales", label: "Latidos anormales", default: "0", grupo: "general" },
  { key: "motivo", label: "Motivo", default: "Control", grupo: "general" },
  { key: "medicacion", label: "Medicación", default: "—", wide: true, grupo: "general" },
  { key: "bradiEvento", label: "Bradicardia mín / evento", default: "", grupo: "general" },
  { key: "taquiEvento", label: "Taquicardia máx / evento", default: "", grupo: "general" },
  // --- Detalle ventricular ---
  { key: "evPares", label: "EV pares", default: "0", grupo: "ventricular" },
  { key: "evTripletas", label: "EV tripletas", default: "0", grupo: "ventricular" },
  { key: "evBigeminias", label: "Bigeminias EV", default: "0", grupo: "ventricular" },
  { key: "evTrigeminias", label: "Trigeminias EV", default: "0", grupo: "ventricular" },
  { key: "tv", label: "Taquicardias ventriculares", default: "0", grupo: "ventricular" },
  { key: "evMaxMin", label: "Máx EV/min", default: "", grupo: "ventricular" },
  // --- Detalle supraventricular ---
  { key: "esvPares", label: "ESV pares", default: "0", grupo: "supraventricular" },
  { key: "esvTripletas", label: "ESV tripletas", default: "0", grupo: "supraventricular" },
  { key: "esvBigeminias", label: "Bigeminias ESV", default: "0", grupo: "supraventricular" },
  { key: "esvTrigeminias", label: "Trigeminias ESV", default: "0", grupo: "supraventricular" },
  { key: "tsv", label: "TSV / salvas", default: "0", grupo: "supraventricular" },
  { key: "salvaLatidos", label: "Salva más larga (latidos)", default: "", grupo: "supraventricular" },
  { key: "salvaFcMax", label: "FC máx de la salva", default: "", grupo: "supraventricular" },
  { key: "salvaDuracion", label: "Duración de la salva", default: "", grupo: "supraventricular" },
  // --- ST / QT ---
  { key: "st1", label: "ST Canal 1", default: "Sin eventos", grupo: "st" },
  { key: "st2", label: "ST Canal 2", default: "Sin eventos", grupo: "st" },
  { key: "st3", label: "ST Canal 3", default: "Sin eventos", grupo: "st" },
  { key: "qtMax", label: "QT máximo", default: "", grupo: "st" },
  { key: "qtcMax", label: "QTc máximo", default: "", grupo: "st" },
  { key: "qtDif", label: "Diferencia QT", default: "", grupo: "st" },
  // TODO: referencia QTc por sexo a futuro (hoy los QT quedan editables, sin límite automático).
  // --- VFC (avanzado) ---
  { key: "sdnn", label: "SDNN", default: "", grupo: "vfc" },
  { key: "sdann", label: "SDANN", default: "", grupo: "vfc" },
  { key: "sdnnIndex", label: "SDNN Index", default: "", grupo: "vfc" },
  { key: "rmssd", label: "rMSSD", default: "", grupo: "vfc" },
  { key: "nn50", label: "NN50", default: "", grupo: "vfc" },
  { key: "pnn50", label: "pNN50", default: "", grupo: "vfc" },
  { key: "potenciaTotal", label: "Potencia total", default: "", grupo: "vfc" },
  // --- Conclusión / observaciones ---
  { key: "observaciones", label: "Observaciones", default: "", wide: true, grupo: "conclusion" },
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
// Campos del Estudio urodinámico completo (507313, ECUD / Urología Caballito).
// Ficha + preparación + fase de llenado + fase de vaciado. Los presets (M1-M8 /
// F1-F8) pisan estos valores; el operador los revisa/edita antes de firmar. Las
// unidades van en el valor (ej. "165 ml"), no en el label, para que las
// validaciones puedan leer el número con parseFloat y el PDF quede limpio.
const URODINAMIA_CAMPOS = [
  { key: "sexo", label: "Sexo", default: "", tipo: "select", opciones: ["Masculino", "Femenino"], requerido: true },
  { key: "edad", label: "Edad", default: "" },
  { key: "operador", label: "Operador", default: "Lisandro I. Veliz", wide: true },
  { key: "equipo", label: "Equipo utilizado", default: "ECUD" },
  { key: "diagClinico", label: "Diagnóstico clínico", default: "", wide: true },
  { key: "antecedentes", label: "Antecedentes", default: "", wide: true },
  // Preparación (toggles editables; NO se asume nada por defecto).
  { key: "urocultivo", label: "Urocultivo", default: "No informado", tipo: "select", opciones: ["Negativo", "Positivo", "No informado"] },
  { key: "profilaxis", label: "Profilaxis antibiótica", default: "No informado", tipo: "select", opciones: ["Sí", "No", "No informado"] },
  { key: "cateteres", label: "Catéteres", default: "Catéteres uretrales para medición de Pdet e infusión; balón rectal para medición de presión abdominal (Pabd).", wide: true },
  // ---- Fase de llenado ----
  { key: "sensibilidad", label: "Sensibilidad propioceptiva", default: "", tipo: "select", opciones: ["Conservada", "Aumentada", "Disminuida", "Alterada"] },
  { key: "primerDeseo", label: "Primer deseo miccional", default: "" },
  { key: "deseoHabitual", label: "Deseo miccional habitual", default: "" },
  { key: "deseoMaximo", label: "Deseo miccional máximo", default: "" },
  { key: "detrusorLlenado", label: "Detrusor (llenado)", default: "", tipo: "select", opciones: ["Estable", "Hiperactivo", "Hipoactivo", "Acontráctil"] },
  { key: "contraccInvol", label: "Contracciones involuntarias", default: "", tipo: "select", opciones: ["No", "Sí"] },
  { key: "iou", label: "IOU (incontinencia de urgencia)", default: "", tipo: "select", opciones: ["No", "Sí"] },
  { key: "iouDesde", label: "Volumen de aparición de IOU", default: "" },
  { key: "pdetCI", label: "Pdet máx. en contracción involuntaria", default: "" },
  { key: "ioe", label: "Incontinencia de esfuerzo (Valsalva)", default: "", tipo: "select", opciones: ["No", "Sí"] },
  { key: "vlpp", label: "VLPP", default: "" },
  { key: "capacidad", label: "Capacidad cistométrica máxima", default: "" },
  { key: "acomodacion", label: "Acomodación vesical", default: "", tipo: "select", opciones: ["Conservada", "Disminuida"] },
  { key: "obsLlenado", label: "Observaciones de llenado", default: "", wide: true },
  // ---- Fase de vaciado ----
  { key: "contraccVaciado", label: "Contracción del detrusor (vaciado)", default: "", tipo: "select", opciones: ["Voluntaria", "Débil", "Hipoactiva", "Acontráctil"] },
  { key: "pdetMax", label: "Pdet máxima", default: "" },
  { key: "pdetQmax", label: "PdetQmax", default: "" },
  { key: "flujo", label: "Flujo miccional", default: "", tipo: "select", opciones: ["Continuo", "Intermitente", "Reducido", "Ausente"] },
  { key: "curva", label: "Curva", default: "", tipo: "select", opciones: ["Normal", "Aplanada", "Bifásica", "Irregular", "Baja amplitud", "Sin curva"] },
  { key: "qmax", label: "Qmax", default: "" },
  { key: "qprom", label: "Q promedio", default: "" },
  { key: "volMiccional", label: "Volumen miccional", default: "" },
  { key: "apoyoAbdominal", label: "Apoyo abdominal", default: "", tipo: "select", opciones: ["No", "Sí"] },
  { key: "rpm", label: "RPM final", default: "" },
  { key: "presionApertura", label: "Presión de apertura uretral", default: "" },
  { key: "flujoLibre", label: "Flujometría libre complementaria", default: "", wide: true },
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
// ===== Ecografía vesicoprostática (180114) =====
// OJO: esta práctica es VEJIGA + PRÓSTATA. Los riñones NO van acá: el estudio
// reno-vesico-prostático es otra práctica y va a ser otro modelo.
// Los campos no se imprimen como grilla: son la carga guiada del operador y lo
// que alimenta los avisos de coherencia. Lo que sale en el PDF es el INFORME
// (prosa, del preset y editable) más OBSERVACIONES y CONCLUSIÓN.
// "Personalizado" en un desplegable = escribilo a mano en el informe; el campo
// queda como recordatorio de que ese punto se cambió.
const VESICOPROSTATICA_CAMPOS = [
  // ---- Vejiga ----
  { key: "vejReplecion", label: "Repleción", default: "Adecuada", tipo: "select", opciones: ["Adecuada", "Buena", "Escasa", "Distendida"], grupo: "vejiga" },
  { key: "vejPared", label: "Pared vesical", default: "Normal", tipo: "select", opciones: ["Normal", "Discretamente engrosada", "Engrosada", "Fina trabeculación", "Trabeculada", "Personalizado"], grupo: "vejiga" },
  { key: "vejSuperficie", label: "Superficie interna", default: "Regular", tipo: "select", opciones: ["Regular", "Irregular"], grupo: "vejiga" },
  { key: "vejContenido", label: "Contenido", default: "Homogéneo anecoico", tipo: "select", opciones: ["Homogéneo anecoico", "Homogéneo", "Personalizado"], grupo: "vejiga" },
  { key: "vejLesiones", label: "Lesiones parietales", default: "No", tipo: "select", opciones: ["No", "Sí"], grupo: "vejiga" },
  { key: "vejEndoluminales", label: "Imágenes endoluminales", default: "No", tipo: "select", opciones: ["No", "Sí"], grupo: "vejiga" },
  { key: "vejPremiccional", label: "Volumen premiccional (ml)", default: "", grupo: "vejiga" },
  { key: "vejRpm", label: "Residuo postmiccional (ml)", default: "", grupo: "vejiga" },
  // ---- Próstata ----
  { key: "proEcoestructura", label: "Ecoestructura", default: "Homogénea", tipo: "select", opciones: ["Homogénea", "Heterogénea", "Heterogénea por calcificaciones periuretrales", "Personalizado"], grupo: "prostata" },
  { key: "proContornos", label: "Contornos", default: "Netos", tipo: "select", opciones: ["Netos", "Regulares", "Personalizado"], grupo: "prostata" },
  { key: "proSimetria", label: "Simetría", default: "Simétrica", tipo: "select", opciones: ["Simétrica", "Asimétrica", "No informado"], grupo: "prostata" },
  { key: "proTamano", label: "Tamaño", default: "Normal", tipo: "select", opciones: ["Normal", "Aumentado", "Marcadamente aumentado"], grupo: "prostata" },
  { key: "proTransverso", label: "Diámetro transversal (mm)", default: "", grupo: "prostata" },
  { key: "proLongitudinal", label: "Diámetro longitudinal (mm)", default: "", grupo: "prostata" },
  { key: "proAnteroposterior", label: "Diámetro anteroposterior (mm)", default: "", grupo: "prostata" },
  { key: "proVolumen", label: "Volumen prostático (cc)", default: "", grupo: "prostata" },
  { key: "proPeso", label: "Peso estimado (g) — opcional", default: "", grupo: "prostata" },
  { key: "proCalcificaciones", label: "Calcificaciones", default: "No", tipo: "select", opciones: ["No", "Sí", "Periuretrales", "Personalizado"], grupo: "prostata" },
  { key: "proImpronta", label: "Impronta sobre piso vesical", default: "No", tipo: "select", opciones: ["No", "Sí"], grupo: "prostata" },
  // ---- Observaciones y conclusión (sí se imprimen) ----
  { key: "observaciones", label: "Observaciones", default: "", wide: true, grupo: "obs" },
  { key: "conclusion", label: "Conclusión", default: "", wide: true, grupo: "obs" },
];

// ===== Ecodoppler venoso de miembros inferiores (180202) =====
// El estudio se informa POR LADO: los mismos hallazgos se cargan para el
// miembro derecho y para el izquierdo. Se escriben una sola vez y se duplican
// con sufijo Der/Izq, así no hay dos listas que se puedan ir despegando.
// Los grados arrancan en "—" (estudio normal = sin reflujo / sin insuficiencia):
// el "—" NO se imprime, es la forma de decir "no corresponde".
const VENOSO_MMII_LADO = [
  { key: "profundoPerm", label: "Sistema venoso profundo — permeabilidad", opciones: ["Permeable", "No permeable"] },
  { key: "profundoCompr", label: "Sistema venoso profundo — compresibilidad", opciones: ["Compresible", "No compresible"] },
  { key: "profundoCompet", label: "Sistema venoso profundo — competencia", opciones: ["Competente", "Incompetente"] },
  { key: "cayadoIntPerm", label: "Cayado safena interna — permeabilidad", opciones: ["Permeable", "No permeable"] },
  { key: "cayadoIntCompet", label: "Cayado safena interna — competencia", opciones: ["Competente", "Incompetente"] },
  { key: "cayadoIntReflujo", label: "Cayado safena interna — grado de reflujo", opciones: ["—", "Leve", "Moderado", "Severo"] },
  { key: "troncoIntPerm", label: "Tronco safena interna — permeabilidad", opciones: ["Permeable", "No permeable"] },
  { key: "troncoIntSuf", label: "Tronco safena interna — suficiencia", opciones: ["Suficiente", "Insuficiente"] },
  { key: "troncoIntGrado", label: "Tronco safena interna — grado de insuficiencia", opciones: ["—", "Leve", "Moderada", "Severa"] },
  { key: "troncoIntFlebec", label: "Tronco safena interna — deriva reflujo a flebectasias", opciones: ["No", "Sí"] },
  { key: "cayadoExtPerm", label: "Cayado safena externa — permeabilidad", opciones: ["Permeable", "No permeable"] },
  { key: "cayadoExtCompet", label: "Cayado safena externa — competencia", opciones: ["Competente", "Incompetente"] },
  { key: "troncoExtPerm", label: "Tronco safena externa — permeabilidad", opciones: ["Permeable", "No permeable"] },
  { key: "troncoExtSuf", label: "Tronco safena externa — suficiencia", opciones: ["Suficiente", "Insuficiente"] },
  { key: "perforantes", label: "Perforantes insuficientes", opciones: ["No", "Sí"] },
];
// Los dos lados del form (secciones plegables) + las observaciones comunes.
// Ojo con las claves: el guardado solo acepta letras y números (hasta 30), así
// que nada de guiones ni guiones bajos.
const VENOSO_MMII_CAMPOS = [
  ...VENOSO_MMII_LADO.map((c) => ({ key: c.key + "Der", label: c.label, default: c.opciones[0], tipo: "select", opciones: c.opciones, grupo: "ladoDer" })),
  ...VENOSO_MMII_LADO.map((c) => ({ key: c.key + "Izq", label: c.label, default: c.opciones[0], tipo: "select", opciones: c.opciones, grupo: "ladoIzq" })),
  // Observaciones: lo que NO es por segmento venoso. Las anatómicas piden el
  // lado en vez de un sí/no — en un estudio bilateral "Sí" a secas no dice
  // dónde, y el que lee el informe necesita saberlo.
  { key: "obsDificultoso", label: "Estudio técnicamente dificultoso", default: "No", tipo: "select", opciones: ["No", "Sí"], grupo: "obs" },
  { key: "obsTrombosis", label: "Signos de trombosis venosa", default: "No", tipo: "select", opciones: ["No", "Derecha", "Izquierda", "Bilateral"], grupo: "obs" },
  { key: "obsTelangiectasias", label: "Telangiectasias", default: "No", tipo: "select", opciones: ["No", "Derecha", "Izquierda", "Bilateral"], grupo: "obs" },
  { key: "obsFlebectasias", label: "Flebectasias", default: "No", tipo: "select", opciones: ["No", "Derecha", "Izquierda", "Bilateral"], grupo: "obs" },
  { key: "obsEdema", label: "Edema de tejido celular subcutáneo", default: "No", tipo: "select", opciones: ["No", "Derecha", "Izquierda", "Bilateral"], grupo: "obs" },
  { key: "obsLagos", label: "Lagos linfáticos", default: "No", tipo: "select", opciones: ["No", "Derecha", "Izquierda", "Bilateral"], grupo: "obs" },
  // Texto libre. La clave `observaciones` es la que el PDF ya imprime debajo de
  // la conclusión (sirve para cualquier modelo), no inventar otra.
  { key: "observaciones", label: "Observaciones (texto libre)", default: "", wide: true, grupo: "obs" },
];
// Cómo se arma la tabla de hallazgos del PDF: una fila por segmento venoso, con
// una columna por lado. Sin esto serían 30 renglones sueltos que no entran en la
// hoja; así son 6 filas y se lee comparando un lado contra el otro.
// `partes` se concatenan ("Permeable, compresible, competente"); `grado` agrega
// el paréntesis solo si está cargado; `extra` agrega la frase solo si dice "Sí".
// Los hallazgos de OBSERVACIONES no son por segmento venoso, así que no entran
// en la tabla: se imprimen como renglones debajo de la conclusión, y SOLO los
// que están cargados ("No" = no se observó, no se menciona). Los que piden lado
// salen con el lado ("Flebectasias: derecha"); el sí/no sale como la frase sola.
// `textoNo`: lo que se imprime cuando el hallazgo NO está. Solo la trombosis lo
// tiene, y a propósito: descartar una TVP es muchas veces el motivo del estudio,
// así que el informe real de Baimed escribe "Sin signos de trombosis venosa"
// aunque sea negativo. El resto de los hallazgos, si no están, no se mencionan.
const VENOSO_MMII_OBS = [
  { key: "obsDificultoso", texto: "Estudio técnicamente dificultoso" },
  { key: "obsTrombosis", texto: "Signos de trombosis venosa", textoNo: "Sin signos de trombosis venosa" },
  { key: "obsTelangiectasias", texto: "Telangiectasias" },
  { key: "obsFlebectasias", texto: "Flebectasias" },
  { key: "obsEdema", texto: "Edema de tejido celular subcutáneo" },
  { key: "obsLagos", texto: "Lagos linfáticos" },
];
const VENOSO_MMII_FILAS = [
  { label: "Sistema venoso profundo", partes: ["profundoPerm", "profundoCompr", "profundoCompet"] },
  { label: "Cayado safena interna", partes: ["cayadoIntPerm", "cayadoIntCompet"], grado: { key: "cayadoIntReflujo", texto: "reflujo" } },
  { label: "Tronco safena interna", partes: ["troncoIntPerm", "troncoIntSuf"], grado: { key: "troncoIntGrado", texto: "insuficiencia" }, extra: { key: "troncoIntFlebec", texto: "deriva reflujo a flebectasias" } },
  { label: "Cayado safena externa", partes: ["cayadoExtPerm", "cayadoExtCompet"] },
  { label: "Tronco safena externa", partes: ["troncoExtPerm", "troncoExtSuf"] },
  { label: "Perforantes insuficientes", partes: ["perforantes"] },
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
    codigoPractica: "570129",
    estudio: "Electrocardiograma",
    textoDefault: "Ecg sin complicaciones, trazado sin valor patológico.",
  },
  "holter": {
    label: "Holter cardíaco 24 hs",
    short: "Holter",
    practica: "Holter cardíaco 24 hs",
    servicio: "SERVICIO DE CARDIOLOGÍA",
    especialidad: "Cardiología",
    codigoPractica: "570121",
    estudio: "Holter cardíaco de 3 canales 24 hs.",
    estudioArchivo: "Holter 24 hs",
    textoDefault: "Ritmo sinusal durante todo el estudio. Conducción AV dentro de límites fisiológicos. No se observaron arritmias supraventriculares ni ventriculares significativas. No se observaron cambios significativos del segmento ST-T. No se observaron pausas significativas. No refirió síntomas durante el estudio. Se analizó registro electrocardiográfico de 24 hs.",
    // Caja "DATOS TÉCNICOS DEL REGISTRO": valores estándar precargados, todos
    // editables. Usa el set completo (antes solo lo tenía el modelo de CIMA) —
    // son campos opcionales de más, no le quitan nada a nadie.
    tecnicosTitulo: "DATOS TÉCNICOS DEL REGISTRO",
    // Set completo con grupos (secciones plegables en el form) y `resumen` (qué
    // entra en la caja del PDF). El builder lista solo los `resumen: true`.
    campos: HOLTER_CAMPOS_FULL,
    // Con este flag, el PDF del Holter reemplaza la grilla plana de datos
    // técnicos por una sección visual "RESUMEN" (tarjetas + barras). Solo el
    // Holter lo trae; el resto de los modelos sigue con la grilla de siempre.
    graficosResumen: true,
  },
  // ===================== ORL / Otorrinolaringología =====================
  // Mismo layout que cardiología (sin caja técnica). Cambia el servicio y, en
  // algunas prácticas, se elige el lado (el texto del preset cambia según el lado).
  // El texto de este preset siempre incluye "SE REALIZA OTOMICROSCOPIA" como
  // paso previo a la extracción - es una práctica propia (717122), no solo
  // una frase descriptiva. Son 3 códigos en juego cuando además se combina
  // con el tratamiento químico (ver orl-combinado), no 2.
  "orl-cerumen": {
    label: "Extracción tapón de cerumen / cuerpo extraño + otomicroscopia (717111 + 717122)",
    short: "Cerumen",
    practica: "717111 + 717122 - Extracción de tapón de cerumen / cuerpo extraño + otomicroscopia",
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717111 + 717122",
    estudio: "EXTRACCIÓN DE CUERPO EXTRAÑO EN OÍDO + EXTRACCIÓN DE TAPÓN DE CERUMEN + OTOMICROSCOPIA",
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
  // Mismo motivo que orl-cerumen: el texto también informa la otomicroscopia
  // (717122) además de las otras 2 - son 3 códigos, no 2.
  "orl-combinado": {
    label: "Cerumen + Otomicroscopia + Tratamiento químico (717111 + 717122 + 717125)",
    short: "Combinado",
    practica: "717111 + 717122 + 717125 - Cerumen + Otomicroscopia + Tratamiento químico (combinado)",
    servicio: "SERVICIO DE OTORRINOLARINGOLOGÍA",
    especialidad: "Otorrinolaringología",
    codigoPractica: "717111 + 717122 + 717125",
    estudio: "EXTRACCIÓN DE CUERPO EXTRAÑO EN OÍDO + EXTRACCIÓN DE TAPÓN DE CERUMEN + OTOMICROSCOPIA + TRATAMIENTO DE LESIONES OTORRINOLARINGOLÓGICAS POR MEDIOS FÍSICOS O QUÍMICOS",
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
  // --- Estudio urodinámico completo (507313, ECUD / Urología Caballito) ---
  // PDF propio de 2 páginas (buildUrodinamiaPdf). Presets M1-M8 / F1-F8 según sexo.
  "urodinamia": {
    label: "Estudio urodinámico completo (507313)",
    short: "Estudio urodinámico completo",
    practica: "507313 - Estudio urodinámico completo (no incluye insumos ni catéteres)",
    especialidad: "Urología",
    codigoPractica: "507313",
    estudio: "ESTUDIO URODINÁMICO COMPLETO",
    estudioArchivo: "Estudio urodinamico completo",
    tipo: "urodinamia",
    campos: URODINAMIA_CAMPOS,
    textoDefault: "",
  },
  // --- Tratamiento esclerosante (Flebología / Cirugía vascular) ---
  "esclerosante": {
    label: "Tratamiento esclerosante",
    short: "Esclerosante",
    practica: "Tratamiento esclerosante",
    servicio: "SERVICIO DE FLEBOLOGÍA",
    especialidad: "Flebología / Cirugía vascular",
    codigoPractica: "487610",
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
    codigoPractica: "180112",
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
    codigoPractica: "180116",
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
    // Ver la nota en eco-prostatica: el 180114 lo comparten tres prácticas.
    codigoPractica: "180114",
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
    codigoPractica: "180123",
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
    // PAMI factura TRES prácticas distintas con el 180114 (vesicoprostática,
    // prostática y vesical). Los tres modelos llevan el código a propósito: si
    // lo tuviera uno solo, "Crear informe" le mandaría cualquier fila 180114 a
    // ese —el código con un único modelo no se desempata— y una ecografía
    // vesical saldría con un informe que describe la próstata. Con los tres
    // cargados el desempate lo hace el nombre de la práctica de la fila.
    codigoPractica: "180114",
    estudio: "ECOGRAFÍA PROSTÁTICA",
    estudioArchivo: "Ecografia prostatica",
    textoDefault: "PRÓSTATA DE TAMAÑO Y ECOESTRUCTURA CONSERVADOS PARA LA EDAD, DE CONTORNOS REGULARES, SIN IMÁGENES NODULARES EN SU INTERIOR.",
  },
  // Vejiga + próstata. NO lleva riñones: el reno-vesico-prostático es otra
  // práctica y va como modelo aparte. Usa la plantilla de siempre (la misma que
  // el resto de las ecografías); lo propio son los campos de carga, los avisos
  // de coherencia y que imprime CONCLUSIÓN además del informe.
  "eco-vesicoprostatica": {
    label: "Ecografía vesicoprostática (180114)",
    short: "Eco vesicoprostática",
    practica: "180114 - Ecografía vesicoprostática",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecografía",
    codigoPractica: "180114",
    estudio: "ECOGRAFÍA VESICOPROSTÁTICA",
    estudioArchivo: "Ecografia vesicoprostatica",
    campos: VESICOPROSTATICA_CAMPOS,
    // Los campos son para cargar y para los avisos: no se imprimen como grilla.
    camposSoloCarga: true,
    respetaSaltos: true,
    // Los que firman acá lo hacen con el trazo solo; el nombre y la matrícula
    // van impresos debajo, como en los informes de Baimed.
    firmaConMatricula: true,
    // Antes de crearlo se muestra el PDF ya armado para confirmarlo. Va por
    // modelo y no para todos: desde "Faltan informes" se crean de a muchos, y
    // meterle un paso extra a cada uno haría lento el trabajo en tanda.
    revisionPrevia: true,
    textoDefault: "VEJIGA CON ADECUADA REPLECIÓN, DE PAREDES REGULARES Y CONTENIDO HOMOGÉNEO ANECOICO, SIN EVIDENCIA DE LESIONES PARIETALES NI ENDOLUMINALES.\nPRÓSTATA DE CONTORNOS NETOS, SIMÉTRICA, DE ECOESTRUCTURA SIN ALTERACIONES SIGNIFICATIVAS Y VOLUMEN CONSERVADO.",
  },
  "eco-partes-blandas-general": {
    label: "Ecografía de partes blandas (hernia / región quirúrgica)",
    short: "Eco partes blandas",
    practica: "Ecografía de partes blandas",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecografía",
    codigoPractica: "186001",
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
    codigoPractica: "180110",
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
    codigoPractica: "180106",
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
    codigoPractica: "180128",
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
    codigoPractica: "180607",   // ECODOPPLER DE VASOS DEL CUELLO
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
    // Los cuatro doppler de miembros (arterial/venoso, superiores/inferiores)
    // se facturan con el mismo código 180202 (ecodoppler vascular periférico).
    // Van todos con el código puesto A PROPÓSITO: si lo tuviera uno solo, el
    // botón "Crear informe" de Faltan informes le mandaría a ese modelo
    // CUALQUIER fila 180202 (el código con un único modelo no se desempata) y
    // un arterial saldría con la plantilla del venoso. Con los cuatro cargados
    // el desempate lo hace el nombre de la práctica de la fila.
    codigoPractica: "180202",
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
    codigoPractica: "180612",   // ECODOPPLER VENOSO DE MIEMBROS SUPERIORES
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
    codigoPractica: "180202",
    estudio: "ECO-DOPPLER ARTERIAL DE MIEMBROS INFERIORES",
    estudioArchivo: "Ecodoppler arterial MMII",
    // Quien firma estos estudios lo hace con el trazo solo (no con un sello que
    // ya traiga el texto), así que el nombre y la matrícula los imprime el PDF:
    // si no, la firma queda al pie sin decir de quién es.
    firmaConMatricula: true,
    textoDefault: "SE REALIZÓ UNA EXPLORACIÓN DE LAS ARTERIAS DE AMBOS MIEMBROS INFERIORES CON ECÓGRAFO PHILIPS PURE WAVE CON TRANSDUCTOR DE 5-10 MHZ. SE UTILIZARON LOS MODOS: BIDIMENSIONAL, DOPPLER PULSADO EN DIFERENTES DECÚBITOS PARA UNA VALORACIÓN COMPLETA DE LOS PARÁMETROS QUE SE DESCRIBEN A CONTINUACIÓN.\nECOTOMOGRAFÍA: ARTERIAS DE PAREDES LISAS Y DIÁMETRO NORMAL.\nDOPPLER: FLUJO TRIFÁSICO (NORMAL) A NIVEL BILATERAL.\nCONCLUSIÓN: ESTUDIO DENTRO DE LÍMITES FISIOLÓGICOS.",
  },
  // Se informa por lado (derecho / izquierdo) con la tabla de hallazgos, más la
  // conclusión de siempre. Los presets de esta práctica llenan los dos lados.
  "eco-doppler-venoso-mmii": {
    label: "Ecodoppler venoso de miembros inferiores (180202)",
    short: "Doppler ven. MMII",
    practica: "Ecodoppler venoso de miembros inferiores — 180202",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecodoppler",
    codigoPractica: "180202",
    estudio: "ECO-DOPPLER COLOR VENOSO DE MIEMBROS INFERIORES",
    estudioArchivo: "Ecodoppler venoso MMII",
    tecnicosTitulo: "HALLAZGOS",
    campos: VENOSO_MMII_CAMPOS,
    // Tabla de hallazgos con una columna por lado (en vez de la grilla plana).
    hallazgosPorLado: VENOSO_MMII_FILAS,
    // Hallazgos que van a OBSERVACIONES (no son por segmento venoso).
    observacionesHallazgos: VENOSO_MMII_OBS,
    // La conclusión se escribe por miembro ("MIEMBRO INFERIOR DERECHO:" y su
    // detalle): se respetan los saltos de línea del preset en vez de reflowar.
    respetaSaltos: true,
    // Mismo motivo que el arterial de MMII: la firma es el trazo solo.
    firmaConMatricula: true,
    textoDefault: "SE REALIZÓ UNA EXPLORACIÓN DEL SISTEMA VENOSO SUPERFICIAL Y PROFUNDO DE AMBOS MIEMBROS INFERIORES CON ECÓGRAFO PHILIPS PURE WAVE CON TRANSDUCTOR DE 5-10 MHZ. SE UTILIZARON LOS MODOS: BIDIMENSIONAL, DOPPLER PULSADO EN DIFERENTES DECÚBITOS PARA UNA VALORACIÓN COMPLETA DE LOS PARÁMETROS QUE SE DESCRIBEN A CONTINUACIÓN.\nECOTOMOGRAFÍA: VENAS DE PAREDES LISAS QUE COAPTAN CON LA COMPRESIÓN EXTERNA.\nDOPPLER: FLUJO VENOSO ESPONTÁNEO, FÁSICO CON LA RESPIRACIÓN Y COMPETENTE DURANTE LA MANIOBRA DE VALSALVA.\nCONCLUSIÓN: SISTEMA VENOSO PROFUNDO Y SAFENA PERMEABLE Y COMPETENTE A NIVEL BILATERAL. NO SE DETECTAN PERFORANTES INCOMPETENTES.",
  },
  "eco-doppler-aorta-abdominal": {
    label: "Ecodoppler de arteria aorta abdominal",
    short: "Doppler aorta abd.",
    practica: "Ecodoppler de arteria aorta abdominal",
    servicio: "SERVICIO DE DIAGNÓSTICO POR IMÁGENES",
    especialidad: "Diagnóstico por imágenes / Ecodoppler",
    codigoPractica: "180603",
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
    codigoPractica: "180609",
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
    codigoPractica: "180301",
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
    codigoPractica: "687114",
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
// El nombre de la práctica estaba escrito de TRES formas distintas según el
// modelo: con el código adelante ("186001 - Ecografía musculoesquelética"), con
// el código atrás ("Consulta cardiológica c/ ECG — 570129") o sin código
// ("Ecografía renal"). Como cada pantalla mostraba el campo tal cual, el mismo
// desplegable mezclaba los tres formatos. Estas dos funciones limpian el nombre
// y rearman la etiqueta pareja para TODAS las vistas.
function nombreSinCodigo(texto) {
  return String(texto || "")
    .replace(/^\s*\d[\d\s+]*\s*[-–—]\s*/, "")   // "717111 + 717122 - Nombre"
    .replace(/\s*[-–—]\s*\d[\d\s+]*\s*$/, "")   // "Nombre — 570129"
    .trim();
}
// Etiqueta para MOSTRAR en cualquier lista de prácticas: siempre "CÓDIGO - Nombre".
// Si algún modelo nuevo entra sin código cargado, va el nombre solo (nunca se
// inventa un código).
function etiquetaConCodigo(codigo, texto) {
  const nombre = nombreSinCodigo(texto);
  const cod = String(codigo || "").trim();
  return cod ? cod + " - " + nombre : nombre;
}
// Para el desplegable del front (una sola fuente de verdad).
function listarModelos() {
  return Object.keys(MODELOS).map((k) => ({
    key: k,
    label: MODELOS[k].label || k,
    short: MODELOS[k].short || MODELOS[k].label || k,
    practica: MODELOS[k].practica || MODELOS[k].estudio || k,
    // Las dos etiquetas "para mostrar", ya parejas. `practica`/`short` se dejan
    // crudas porque el dashboard las usa para matchear la fila del reporte
    // contra el modelo (ver modeloParaPracticaRow en app.js).
    practicaConCodigo: etiquetaConCodigo(MODELOS[k].codigoPractica, MODELOS[k].practica || MODELOS[k].estudio || k),
    shortConCodigo: etiquetaConCodigo(MODELOS[k].codigoPractica, MODELOS[k].short || MODELOS[k].label || k),
    especialidad: MODELOS[k].especialidad || "",
    codigoPractica: MODELOS[k].codigoPractica || "",
    campos: MODELOS[k].campos || [],
    requiereLado: !!MODELOS[k].requiereLado,
    revisionPrevia: !!MODELOS[k].revisionPrevia,
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
  if (modelo.tipo === "urodinamia") return buildUrodinamiaPdf(modelo, input || {});
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
  // `let`, no `const`: si la conclusión no entra se agrega una hoja y se
  // reapunta (los helpers de dibujo leen esta variable, así que siguen solos).
  let page = doc.addPage([595.28, 841.89]); // A4 vertical
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

  // Piso del texto: más abajo empieza la zona de FECHA/firma y el pie del centro.
  // Hasta ahora un informe largo seguía escribiendo para abajo y se montaba
  // encima de la firma. Se recalcula abajo, cuando se sabe cuánto ocupa el texto.
  let PISO_TEXTO = 268;
  const nuevaPagina = () => {
    page = doc.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 28, y: 28, width: width - 56, height: height - 56, borderColor: border, borderWidth: 1 });
    y = height - 60;
  };
  // Escribe renglones ya cortados, saltando de hoja si se termina el espacio.
  // El renglón vacío es el separador de párrafos (solo baja el cursor).
  const escribirLineas = (lineas, size = 10.5, lineH = 15) => {
    for (const ln of lineas) {
      if (y < PISO_TEXTO) nuevaPagina();
      if (ln) { T(ln, LBLX, y, { size }); y -= lineH; }
      else y -= lineH * 0.6;   // separador de párrafo (mismo alto que al medir)
    }
  };
  // Corta un texto en renglones. `respetaSaltos` (ecodoppler venoso) mantiene los
  // saltos del preset —ese informe se escribe por miembro y de corrido no se
  // entiende—; el resto de los modelos reflowa todo junto, como siempre.
  const cortarTexto = (txt, size = 10.5) => {
    const parrafos = modelo.respetaSaltos ? String(txt == null ? "" : txt).split(/\r?\n/) : [String(txt == null ? "" : txt)];
    const out = [];
    for (const pr of parrafos) {
      if (!pr.trim()) { out.push(""); continue; }
      for (const ln of wrapText(pr, font, size, boxW - 2 * PADX)) out.push(ln);
    }
    return out;
  };

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
    const hasBenef = (p.benef || "").trim();
    const hasSexo = (p.sexo || "").trim();
    const hasCob = !!cobertura;
    // El renglón que no tiene dato no se dibuja: un "N° Benef.: —" impreso no
    // informa nada y encima ocupa alto (que es lo que después le falta al texto).
    const innerLines = 1 + 1 + (hasDoc ? 1 : 0) + (hasBenef ? 1 : 0) + (hasSexo ? 1 : 0) + (hasCob ? 1 : 0);
    const h = innerLines * 15 + 14;
    drawBox(y, h);
    let iy = y - 18;
    T("Datos de paciente", LBLX, iy, { bold: true, size: 11 }); iy -= 16;
    T("Nombre:", LBLX, iy, { bold: true }); T(p.nombre || "—", VALX, iy); iy -= 15;
    if (hasDoc) { T("Documento:", LBLX, iy, { bold: true }); T(hasDoc, VALX, iy); iy -= 15; }
    if (hasBenef) { T("N° Benef.:", LBLX, iy, { bold: true }); T(hasBenef, VALX, iy); iy -= 15; }
    if (hasSexo) { T("Sexo:", LBLX, iy, { bold: true }); T(hasSexo, VALX, iy); iy -= 15; }
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

  // Sección visual "RESUMEN" (solo Holter, gateada por modelo.graficosResumen):
  // reemplaza la grilla plana de datos técnicos por tarjetas + mini-gráficos de
  // barras armados con los mismos valores resumen ya cargados. La conclusión
  // ("INFORME") sigue abajo, sin perder protagonismo: esta sección es compacta.
  // TODO: si algún día se cargan datos HORARIOS reales (FC/arritmias hora por
  // hora), acá se habilitarían gráficos de evolución de 24 hs. Hoy NO hay tira
  // de ECG ni curvas simuladas: solo barras/tarjetas de los valores resumen.
  if (modelo.campos && modelo.campos.length && modelo.graficosResumen) {
    const valores = (input && input.valores) || {};
    const defs = {};
    for (const c of modelo.campos) defs[c.key] = c.default || "";
    // String original tal cual está cargado (con fallback al default del campo).
    const S = (k) => {
      const s = String(valores[k] == null ? "" : valores[k]).trim();
      return s || defs[k] || "";
    };
    // Parseo de números para las barras: quedarse con [0-9.,], quitar puntos de
    // miles y pasar la coma decimal a punto. "1.284"->1284, "54 lpm"->54,
    // "<0,01%"->0.01, ""->0.
    const numStr = (s) => {
      const c = String(s == null ? "" : s).replace(/[^0-9.,]/g, "").replace(/\./g, "").replace(",", ".");
      const n = parseFloat(c);
      return isNaN(n) ? 0 : n;
    };
    const N = (k) => numStr(S(k));
    const teal = rgb(0.16, 0.55, 0.55);
    const cardBorder = rgb(0.78, 0.82, 0.85);
    const axis = rgb(0.6, 0.62, 0.65);
    const innerX = boxX + PADX;
    const innerW = boxW - 2 * PADX;
    const truncTo = (val, f, size, maxW) => {
      if (f.widthOfTextAtSize(val, size) <= maxW) return val;
      while (val.length > 1 && f.widthOfTextAtSize(val + "…", size) > maxW) val = val.slice(0, -1);
      return val + "…";
    };

    // Título
    T("RESUMEN", LBLX, y - 16, { bold: true, size: 11 });

    // --- 1) Fila de tarjetas ---
    const cardsTopY = y - 26;
    const cardH = 34, cardGap = 10;
    const cardW = (innerW - 2 * cardGap) / 3;
    const drawCard = (idx, label, valor, extra) => {
      const cx = innerX + idx * (cardW + cardGap);
      page.drawRectangle({ x: cx, y: cardsTopY - cardH, width: cardW, height: cardH, borderColor: cardBorder, borderWidth: 1 });
      centerIn(label.toUpperCase(), cx, cx + cardW, cardsTopY - 10, { size: 7.5, color: soft });
      centerIn(truncTo(valor || "—", bold, 13, cardW - 6), cx, cx + cardW, cardsTopY - 24, { bold: true, size: 13 });
      if (extra) centerIn(extra, cx, cx + cardW, cardsTopY - 31, { size: 6.5, color: soft });
    };
    drawCard(0, "Total de latidos", S("totalLatidos"));
    const pausaMax = N("pausaMasLarga");
    drawCard(1, "Pausas signif.", S("pausas"), pausaMax ? "máx " + S("pausaMasLarga") + " ms" : "");
    drawCard(2, "Duración", S("duracion"));

    // --- 2) Dos mini-gráficos de barras lado a lado ---
    const chartsTopY = cardsTopY - cardH - 10;
    const chartsH = 84;
    const chartGap = 16;
    const chartW = (innerW - chartGap) / 2;
    const chart1X = innerX;
    const chart2X = innerX + chartW + chartGap;
    const chartsBottomY = chartsTopY - chartsH;
    const baseY = chartsBottomY + 12;          // eje base (deja 12 px para etiquetas debajo)
    const maxBarH = (chartsTopY - 14) - 10 - baseY; // arriba: título 14, valor 10

    const drawBarChart = (cx, titulo, barras, notaVacia) => {
      T(titulo, cx, chartsTopY - 8, { bold: true, size: 7.5, color: soft });
      page.drawLine({ start: { x: cx, y: baseY }, end: { x: cx + chartW, y: baseY }, thickness: 0.6, color: axis });
      const maxVal = Math.max(...barras.map((b) => b.num), 0);
      const slotW = chartW / barras.length;
      const barW = Math.min(slotW * 0.5, 42);
      barras.forEach((b, i) => {
        const bx = cx + i * slotW + (slotW - barW) / 2;
        const bh = maxVal > 0 ? maxBarH * (b.num / maxVal) : 0;
        if (bh > 0) page.drawRectangle({ x: bx, y: baseY, width: barW, height: bh, color: teal });
        centerIn(b.etiquetaValor, bx, bx + barW, baseY + bh + 2, { size: 7 });
        centerIn(b.label, bx, bx + barW, baseY - 9, { size: 7, color: soft });
      });
      if (notaVacia && maxVal === 0) centerIn(notaVacia, cx, cx + chartW, baseY + 16, { size: 7, color: soft });
    };

    drawBarChart(chart1X, "FRECUENCIA CARDÍACA (LPM)", [
      { num: N("fcMin"), etiquetaValor: S("fcMin"), label: "Mín" },
      { num: N("fcProm"), etiquetaValor: S("fcProm"), label: "Media" },
      { num: N("fcMax"), etiquetaValor: S("fcMax"), label: "Máx" },
    ]);
    drawBarChart(chart2X, "EXTRASÍSTOLES", [
      { num: N("ev"), etiquetaValor: S("ev"), label: "EV" },
      { num: N("esv"), etiquetaValor: S("esv"), label: "ESV" },
    ], "Sin extrasístoles");

    // Caption de sub-cuentas de extrasístoles (solo las > 0), debajo del gráfico.
    let cy = chartsBottomY;
    {
      const pares = N("evPares") + N("esvPares");
      const tripletas = N("evTripletas") + N("esvTripletas");
      const salva = N("salvaLatidos");
      const partes = [];
      if (pares > 0) partes.push("Pares: " + pares);
      if (tripletas > 0) partes.push("Tripletas: " + tripletas);
      if (salva > 0) partes.push("Salva: " + salva + " lat");
      if (partes.length) { T(truncTo(partes.join(" · "), font, 7, chartW), chart2X, cy - 1, { size: 7, color: soft }); }
    }
    cy -= 10;

    // --- 3) Tres líneas de texto de ancho completo ---
    cy -= 3;
    const lineas = [
      ["Ritmo predominante:", S("ritmo")],
      ["Conducción AV:", S("conduccionAV")],
      ["ST-T:", S("stt")],
    ];
    for (const [lbl, valor] of lineas) {
      T(lbl, innerX, cy, { bold: true, size: 9 });
      const lblW = bold.widthOfTextAtSize(lbl + " ", 9);
      T(truncTo(valor || "—", font, 9, innerW - lblW), innerX + lblW, cy, { size: 9 });
      cy -= 13;
    }

    // --- 4) Caption final con lo que no entró (solo valores != vacío/0) ---
    {
      const extras = [];
      if (N("evPct") !== 0) extras.push("EV %: " + S("evPct"));
      if (N("esvPct") !== 0) extras.push("ESV %: " + S("esvPct"));
      const sint = S("sintomas");
      if (sint) extras.push("Síntomas: " + sint);
      if (extras.length) {
        cy -= 2;
        T(truncTo(extras.join(" · "), font, 7.5, innerW), innerX, cy, { size: 7.5, color: soft });
        cy -= 10;
      }
    }

    // Caja envolvente (borde) alrededor de toda la sección.
    const h = y - cy + 2;
    drawBox(y, h);
    y -= h + 16;
  } else if (modelo.campos && modelo.campos.length && modelo.hallazgosPorLado) {
    // Caja: HALLAZGOS con una columna por lado (ecodoppler venoso de MMII).
    // Una fila por segmento venoso: los tres o cuatro campos del segmento se
    // juntan en una frase ("Permeable, compresible, competente") en vez de ir
    // como 30 celdas sueltas, que no entrarían en la hoja ni se podrían
    // comparar lado contra lado.
    const valores = (input && input.valores) || {};
    const defs = {};
    for (const c of modelo.campos) defs[c.key] = c.default || "";
    const V = (k) => {
      const s = String(valores[k] == null ? "" : valores[k]).trim();
      return s || defs[k] || "";
    };
    // "—" es "no corresponde" (ej. grado de reflujo en un cayado competente):
    // no se imprime. Si no queda nada cargado, la celda muestra "—".
    const armarCelda = (fila, suf) => {
      const partes = fila.partes.map((k) => V(k + suf)).filter((s) => s && s !== "—");
      if (!partes.length) return "—";
      let txt = partes[0];
      for (let i = 1; i < partes.length; i++) txt += ", " + partes[i].toLowerCase();
      if (fila.grado) {
        const g = V(fila.grado.key + suf);
        if (g && g !== "—") txt += " (" + fila.grado.texto + " " + g.toLowerCase() + ")";
      }
      if (fila.extra && V(fila.extra.key + suf) === "Sí") txt += ", " + fila.extra.texto;
      return txt;
    };
    // Compacta a propósito: esta tabla va ARRIBA de la conclusión y cada punto
    // que se coma acá se lo saca al informe. Con la etiqueta más angosta las
    // celdas entran en un renglón en vez de dos, que es donde está la diferencia.
    const labelW = 116;
    const colW = (boxW - labelW) / 2;
    const S = 8, lineH = 10, titleH = 17, headH = 12;
    // Primero se mide (cuántos renglones ocupa cada celda) y después se dibuja:
    // la caja necesita su altura antes de escribir adentro.
    const filas = modelo.hallazgosPorLado.map((f) => {
      const der = wrapText(armarCelda(f, "Der"), font, S, colW - 12);
      const izq = wrapText(armarCelda(f, "Izq"), font, S, colW - 12);
      const lbl = wrapText(f.label, bold, S, labelW - 12);
      const lineas = Math.max(der.length, izq.length, lbl.length);
      return { der, izq, lbl, lineas, h: lineas * lineH + 3 };
    });
    const h = titleH + headH + filas.reduce((s, f) => s + f.h, 0) + 3;
    drawBox(y, h);
    T(modelo.tecnicosTitulo || "HALLAZGOS", LBLX, y - 16, { bold: true, size: 11 });
    const grid = rgb(0.75, 0.77, 0.8);
    const headTop = y - titleH;
    centerIn("MIEMBRO INFERIOR DERECHO", boxX + labelW, boxX + labelW + colW, headTop - 10, { bold: true, size: S });
    centerIn("MIEMBRO INFERIOR IZQUIERDO", boxX + labelW + colW, boxX + boxW, headTop - 10, { bold: true, size: S });
    let ry = headTop - headH;
    page.drawLine({ start: { x: boxX, y: headTop }, end: { x: boxX + boxW, y: headTop }, thickness: 0.5, color: grid });
    for (const f of filas) {
      page.drawLine({ start: { x: boxX, y: ry }, end: { x: boxX + boxW, y: ry }, thickness: 0.5, color: grid });
      let ty = ry - 11;
      for (const ln of f.lbl) { T(ln, boxX + 8, ty, { bold: true, size: S }); ty -= lineH; }
      ty = ry - 11;
      for (const ln of f.der) { T(ln, boxX + labelW + 8, ty, { size: S }); ty -= lineH; }
      ty = ry - 11;
      for (const ln of f.izq) { T(ln, boxX + labelW + colW + 8, ty, { size: S }); ty -= lineH; }
      ry -= f.h;
    }
    // Verticales: solo desde el encabezado (las dos columnas de lado) hasta
    // la última fila.
    for (const lx of [boxX + labelW, boxX + labelW + colW]) {
      page.drawLine({ start: { x: lx, y: headTop }, end: { x: lx, y: ry }, thickness: 0.5, color: grid });
    }
    y -= h + 18;
  } else if (modelo.campos && modelo.campos.length && !modelo.camposSoloCarga) {
    // Caja: DATOS TÉCNICOS DEL REGISTRO (grilla plana — resto de los modelos)
    const valores = (input && input.valores) || {};
    // Si algún campo declara `resumen`, la caja lista SOLO esos (Holter: ~16
    // campos resumen en vez de los ~35). Si ninguno lo declara, se muestran
    // todos, como siempre — el resto de los modelos no cambia.
    const camposAll = modelo.campos.some((c) => c.resumen) ? modelo.campos.filter((c) => c.resumen) : modelo.campos;
    // Los campos de texto largo (`wide`) van en una fila de ancho completo (no en
    // una celda de la grilla, donde se truncarían con "…"). El resto, en grilla
    // de 3 columnas. Ej Holter: FC/latidos/EV/ESV en grilla; Ritmo/ST-T/Pausas a lo ancho.
    const campos = camposAll.filter((c) => !c.wide);
    const camposWide = camposAll.filter((c) => c.wide);
    const cols = 3;
    const rows = Math.ceil(campos.length / cols);
    const rowH = 14, titleH = 20, wideH = 13;
    const h = titleH + rows * rowH + camposWide.length * wideH + 5;
    drawBox(y, h);
    T(modelo.tecnicosTitulo || "DATOS TÉCNICOS", LBLX, y - 16, { bold: true, size: 11 });
    const grid = rgb(0.75, 0.77, 0.8);
    const gridTop = y - titleH;
    const colW = boxW / cols;
    const trunc = (val, maxVW) => {
      if (font.widthOfTextAtSize(val, 8.5) > maxVW) {
        while (val.length > 1 && font.widthOfTextAtSize(val + "…", 8.5) > maxVW) val = val.slice(0, -1);
        val += "…";
      }
      return val;
    };
    for (let i = 0; i < campos.length; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const cx = boxX + c * colW + 8;
      const cy = gridTop - r * rowH - 11;
      const lbl = campos[i].label + ": ";
      T(lbl, cx, cy, { bold: true, size: 8.5 });
      const lblW = bold.widthOfTextAtSize(lbl, 8.5);
      const raw = String((valores[campos[i].key] == null ? "" : valores[campos[i].key])).trim() || campos[i].default || "";
      T(trunc(raw, colW - 12 - lblW), cx + lblW, cy, { size: 8.5 });
    }
    for (let r = 0; r <= rows; r++) {
      const ly = gridTop - r * rowH;
      page.drawLine({ start: { x: boxX, y: ly }, end: { x: boxX + boxW, y: ly }, thickness: 0.5, color: grid });
    }
    for (let c = 1; c < cols; c++) {
      const lx = boxX + c * colW;
      page.drawLine({ start: { x: lx, y: gridTop }, end: { x: lx, y: gridTop - rows * rowH }, thickness: 0.5, color: grid });
    }
    // Filas de ancho completo (campos `wide`) debajo de la grilla.
    let wy = gridTop - rows * rowH - 11;
    for (const cw of camposWide) {
      const lbl = cw.label + ": ";
      T(lbl, boxX + 8, wy, { bold: true, size: 8.5 });
      const lblW = bold.widthOfTextAtSize(lbl, 8.5);
      const raw = String((valores[cw.key] == null ? "" : valores[cw.key])).trim() || cw.default || "";
      T(trunc(raw, boxW - 16 - lblW), boxX + 8 + lblW, wy, { size: 8.5 });
      wy -= wideH;
    }
    y -= h + 18;
  }

  // OBSERVACIONES (opcional): el texto libre del campo `observaciones`, y —si el
  // modelo los declara (ecodoppler venoso)— los hallazgos sueltos que no entran
  // en la tabla. Solo se listan los cargados: "No" es "no se observó" y no se
  // menciona, para que la ausencia no ocupe media hoja. Todo vacío = no aparece.
  const obsParrafos = [];
  {
    const vals = (input && input.valores) || {};
    if (Array.isArray(modelo.observacionesHallazgos)) {
      for (const o of modelo.observacionesHallazgos) {
        const v = String(vals[o.key] == null ? "" : vals[o.key]).trim();
        if (!v || v === "No" || v === "—") {
          // Ausente: se menciona solo si el hallazgo pide decirlo (trombosis).
          if (o.textoNo && (v === "No" || !v)) obsParrafos.push(o.textoNo + ".");
          continue;
        }
        // "Sí" no aporta nada escrito ("Telangiectasias: sí"): va la frase sola.
        obsParrafos.push(v === "Sí" ? o.texto + "." : o.texto + ": " + v.toLowerCase() + ".");
      }
    }
    const obs = String(vals.observaciones || "").trim();
    if (obs) obsParrafos.push(obs);
  }
  const conclusionTexto = String(((input && input.valores) || {}).conclusion || "").trim();

  // La firma se carga ACÁ, antes de medir, porque su imagen se dibuja desde
  // `fy - 22` hacia ARRIBA: con un sello alto llega hasta `fy + 33`, o sea que
  // se mete en la zona del texto. Sin reservar ese alto, la última línea de la
  // conclusión terminaba escrita encima del sello (se veía en los Holter de
  // Baimed, que firman con un sello redondo grande).
  const firmaBuf = firmaArchivo ? readAsset(firmaArchivo) : null;
  let firmaImg = null, firmaW = 0, firmaH = 0;
  if (firmaBuf) {
    try {
      firmaImg = await doc.embedPng(firmaBuf);
      // Caja de la firma. Antes 150x55, y como los sellos son más anchos que
      // altos entraban SIEMPRE limitados por el alto: el de Ruano (375x266)
      // salía a 78x55 y el nombre y la matrícula que trae adentro quedaban en
      // ~4 pt de altura de mayúscula, contra 7,4 pt del texto del informe.
      // Recortarle los márgenes no servía (ya venía justo: 3% de ganancia); lo
      // que faltaba era caja. Con 75 de alto sale a 106x75, y de paso queda en
      // la medida en que Baimed pone la firma en sus propios informes (101x82).
      const enc = encajarImagen(firmaImg, 150, 75);
      firmaW = enc.w; firmaH = enc.h;
    } catch (e) {
      // Un PNG ilegible no puede tumbar el informe: sale como si no hubiera firma.
      firmaImg = null; firmaW = 0; firmaH = 0;
    }
  }
  // Cuánto invade la firma por encima de la línea de FECHA.
  const reservaFirma = firmaImg ? Math.max(0, firmaH - 22) : 0;

  // Cuánto ocupa el cuerpo (conclusión + observaciones) y dónde termina cayendo
  // la firma. Se mide ANTES de escribir, y se cede en este orden:
  //   1) bajar la firma —entre la firma y el pie sobraban ~135 pt sin usar—,
  //   2) achicar el cuerpo de letra hasta 8,5,
  //   3) recién ahí, una segunda hoja.
  // Un estudio normal tiene que entrar en UNA hoja: una segunda con nada más que
  // la firma se lee como que el informe se cortó.
  const ESCALAS = [[10.5, 15], [10, 14], [9.5, 13], [9, 12], [8.5, 11]];
  const anchoTexto = boxW - 2 * PADX;
  const FY_DEFAULT = 248;
  // Hasta dónde puede bajar la firma: depende de QUÉ se dibuje debajo de la
  // línea de FECHA, que no es lo mismo en todos los casos. Con un número fijo
  // para el peor caso (sello + nombre + matrícula) se desperdiciaban ~40 pt y el
  // Holter de Baimed se iba a dos hojas por nada.
  const PIE_TOP = 100, AIRE_PIE = 8;
  const bajoFy = firmaImg
    ? (modelo.firmaConMatricula && (medicoNombre || medicoMatricula) ? 57 : 22)   // sello (+ nombre/matrícula)
    : (medicoNombre ? (medicoMatricula ? 30 : 16) : 0);                            // "MÉDICO" + nombre (+ matrícula)
  const FY_MIN = PIE_TOP + AIRE_PIE + bajoFy;
  // Aire entre el último renglón y la línea de FECHA. Tiene que ser el MISMO
  // número al medir y al decidir el salto de hoja: con dos valores distintos el
  // texto "entraba" en la cuenta y el escritor igual cambiaba de hoja (le pasaba
  // al Holter, que terminaba en 2 hojas sin necesidad).
  const AIRE_FIRMA = 14;
  const altoCuerpo = (lc, lo, lh, lcon) =>
    20 + lc.reduce((s, ln) => s + (ln ? lh : lh * 0.6), 0)          // renglón vacío = separador
      + (lo.length ? 10 + 18 + lo.reduce((s, arr) => s + arr.length * lh, 0) : 0)
      + ((lcon && lcon.length) ? 10 + 18 + lcon.length * lh : 0);
  let cuerpoSize = 10.5, cuerpoLineH = 15;
  let lineasConcl = [], lineasObs = [];
  let fy = FY_DEFAULT;
  {
    const yInforme = y;
    let entro = false;
    for (const [sz, lh] of ESCALAS) {
      const lc = cortarTexto(texto, sz);
      const lo = obsParrafos.map((pr) => wrapText(pr, font, sz, anchoTexto));
      const lcon = conclusionTexto ? wrapText(conclusionTexto, font, sz, anchoTexto) : [];
      const fyNecesario = yInforme - altoCuerpo(lc, lo, lh, lcon) - AIRE_FIRMA - reservaFirma;
      if (fyNecesario >= FY_MIN) {
        cuerpoSize = sz; cuerpoLineH = lh; lineasConcl = lc; lineasObs = lo;
        fy = Math.min(FY_DEFAULT, fyNecesario);
        entro = true;
        break;
      }
    }
    if (!entro) {
      // No entra en una hoja ni con el cuerpo más chico: se pasa a la siguiente
      // con el cuerpo NORMAL (achicar la letra y encima partir en dos es peor
      // que partir en dos y que se lea bien).
      const [sz, lh] = ESCALAS[0];
      cuerpoSize = sz; cuerpoLineH = lh;
      lineasConcl = cortarTexto(texto, sz);
      lineasObs = obsParrafos.map((pr) => wrapText(pr, font, sz, anchoTexto));
      fy = FY_DEFAULT;
    }
    PISO_TEXTO = fy + AIRE_FIRMA + reservaFirma;
  }

  // INFORME (sin caja)
  T("INFORME", LBLX, y, { bold: true, size: 10.5, color: soft });
  y -= 20;
  escribirLineas(lineasConcl, cuerpoSize, cuerpoLineH);

  if (obsParrafos.length) {
    y -= 10;
    if (y < PISO_TEXTO) nuevaPagina();
    T("OBSERVACIONES", LBLX, y, { bold: true, size: 10.5, color: soft });
    y -= 18;
    for (const arr of lineasObs) escribirLineas(arr, cuerpoSize, cuerpoLineH);
  }

  // CONCLUSIÓN (opcional): los estudios que la separan del cuerpo del informe la
  // cargan en su propio campo (ej. la vesicoprostática, donde el informe describe
  // y la conclusión resume). Vacía = no aparece.
  if (conclusionTexto) {
    y -= 10;
    if (y < PISO_TEXTO) nuevaPagina();
    T("CONCLUSIÓN", LBLX, y, { bold: true, size: 10.5, color: soft });
    y -= 18;
    escribirLineas(wrapText(conclusionTexto, font, cuerpoSize, anchoTexto), cuerpoSize, cuerpoLineH);
  }

  // FECHA + Firma. `fy` sale de la medición de arriba: 248 salvo que el texto
  // necesite ese espacio, en cuyo caso la firma baja (hasta FY_MIN).
  T("FECHA:", LBLX, fy, { bold: true, size: 11 });
  T(p.fecha || "—", LBLX + 56, fy, { size: 11 });
  const firmaAreaW = 200, firmaAreaX = width - Mx - firmaAreaW;
  if (firmaImg) {
    page.drawImage(firmaImg, { x: firmaAreaX + (firmaAreaW - firmaW) / 2, y: fy - 22, width: firmaW, height: firmaH });
    // Nombre + matrícula debajo de la firma (solo modelos que lo piden).
    if (modelo.firmaConMatricula && (medicoNombre || medicoMatricula)) {
      let my = fy - 44;
      if (medicoNombre) { centerIn(medicoNombre, firmaAreaX, width - Mx, my, { bold: true, size: 10 }); my -= 13; }
      if (medicoMatricula) { centerIn(medicoMatricula, firmaAreaX, width - Mx, my, { size: 9.5, color: soft }); }
    }
  } else if (medicoNombre) {
    // Hay médico pero NO firma cargada: se muestra el nombre bajo la etiqueta
    // "MÉDICO", sin línea de firma (no se simula una firma que no existe).
    centerIn("MÉDICO", firmaAreaX, width - Mx, fy, { bold: true, size: 9, color: soft });
    centerIn(medicoNombre, firmaAreaX, width - Mx, fy - 16, { bold: true, size: 10.5 });
    if (medicoMatricula) centerIn("Mat. " + medicoMatricula, firmaAreaX, width - Mx, fy - 30, { size: 9, color: soft });
  }
  // Si no hay firma NI médico, no se dibuja nada en el sector de firma.

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

// ---- Builder propio del Estudio urodinámico completo (ECUD, 2 páginas) ----
// Pág 1: datos + preparación + fase de llenado + fase de vaciado (tablas).
// Pág 2: observaciones, referencias, conclusión/resumen (del textarea) y firma.
async function buildUrodinamiaPdf(modelo, input) {
  const { PDFDocument, StandardFonts, rgb } = require("./vendor/pdf-lib.min.js");
  const p = input.paciente || {};
  const v = input.valores || {};
  const cuerpo = ((input.textoInforme || "")).trim();     // conclusión + resumen (editable)
  const firmaArchivo = input.firmaArchivo || "";
  const medicoNombre = (input.medicoNombre || "").trim();
  const medicoMatricula = (input.medicoMatricula || "").trim();
  const pieLines = modelo.pie || input.pieLines || [];

  const doc = await PDFDocument.create();
  const W = 595.28, H = 841.89, M = 46;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique);
  const ink = rgb(0.12, 0.12, 0.12), soft = rgb(0.3, 0.3, 0.3), border = rgb(0.13, 0.13, 0.13);
  const boxX = M, boxW = W - 2 * M, PADX = 12, LBLX = boxX + PADX;

  let logoImg = null;
  const logoBuf = readAsset(modelo.logo || input.logoName);
  if (logoBuf) { try { logoImg = await doc.embedPng(logoBuf); } catch { /* sin logo */ } }

  const T = (page, t, x, y, o = {}) =>
    page.drawText(String(t == null ? "" : t), { x, y, size: o.size || 10, font: o.font || (o.bold ? bold : font), color: o.color || ink });
  const centerT = (page, t, y, o = {}) => { const f = o.font || (o.bold ? bold : font), s = o.size || 10; T(page, t, (W - f.widthOfTextAtSize(String(t), s)) / 2, y, o); };
  const centerIn = (page, t, x1, x2, y, o = {}) => { const f = o.font || (o.bold ? bold : font), s = o.size || 10; T(page, t, x1 + (x2 - x1 - f.widthOfTextAtSize(String(t), s)) / 2, y, o); };
  const drawBox = (page, topY, h) => page.drawRectangle({ x: boxX, y: topY - h, width: boxW, height: h, borderColor: border, borderWidth: 1 });
  // Parte un texto respetando saltos de línea y luego envuelve cada línea.
  const wrapMulti = (t, f, s, maxW) => {
    const out = [];
    for (const raw of String(t || "").split(/\r?\n/)) {
      if (!raw.trim()) { out.push(""); continue; }
      for (const ln of wrapText(raw, f, s, maxW)) out.push(ln);
    }
    return out;
  };

  const nuevaPagina = () => {
    const page = doc.addPage([W, H]);
    page.drawRectangle({ x: 28, y: 28, width: W - 56, height: H - 56, borderColor: border, borderWidth: 1 });
    return page;
  };
  const encabezado = (page, conSub) => {
    let y = H - 46;
    if (logoImg) {
      const { w, h } = encajarImagen(logoImg, modelo.logoW || input.logoW || 90, 66);
      page.drawImage(logoImg, { x: (W - w) / 2, y: y - h, width: w, height: h });
      y -= h + 6;
    }
    centerT(page, "ESTUDIO URODINÁMICO COMPLETO", y - 14, { bold: true, size: 15, color: border });
    y -= 29;
    if (conSub) { centerT(page, "Informe de resultados", y, { font: ital, size: 11, color: soft }); y -= 18; }
    return y - 6;
  };
  // Caja de pares label:valor en 2 columnas (solo no vacíos). Devuelve la nueva y.
  const seccionKV = (page, titulo, y, pares) => {
    const items = pares.filter(([, val]) => String(val == null ? "" : val).trim() !== "");
    if (!items.length) return y;
    const cols = 2, rows = Math.ceil(items.length / cols), rowH = 15, titleH = 20;
    const h = titleH + rows * rowH + 6;
    drawBox(page, y, h);
    T(page, titulo, LBLX, y - 15, { bold: true, size: 10.5 });
    const colW = boxW / cols;
    for (let i = 0; i < items.length; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const cx = boxX + c * colW + 10, cy = y - titleH - r * rowH - 10;
      const lbl = items[i][0] + ": ";
      T(page, lbl, cx, cy, { bold: true, size: 8.5 });
      const lblW = bold.widthOfTextAtSize(lbl, 8.5);
      let val = String(items[i][1]);
      const maxVW = colW - 14 - lblW;
      if (font.widthOfTextAtSize(val, 8.5) > maxVW) {
        while (val.length > 1 && font.widthOfTextAtSize(val + "…", 8.5) > maxVW) val = val.slice(0, -1);
        val += "…";
      }
      T(page, val, cx + lblW, cy, { size: 8.5 });
    }
    return y - h - 10;
  };
  // Caja con título y una lista de [label, texto] envueltos (para textos largos).
  const bloqueTexto = (page, titulo, y, pares) => {
    const items = pares.filter(([, val]) => String(val == null ? "" : val).trim() !== "");
    if (!items.length) return y;
    const size = 9;
    const lineas = [];
    for (const [lbl, val] of items) {
      const w = wrapMulti((lbl ? lbl + ": " : "") + val, font, size, boxW - 2 * PADX);
      lineas.push(...w);
    }
    const titleH = titulo ? 20 : 8;
    const h = titleH + lineas.length * 12 + 8;
    drawBox(page, y, h);
    if (titulo) T(page, titulo, LBLX, y - 15, { bold: true, size: 10.5 });
    let iy = y - titleH - 8;
    for (const ln of lineas) { T(page, ln, LBLX, iy, { size }); iy -= 12; }
    return y - h - 10;
  };

  // ===================== PÁGINA 1 =====================
  let page = nuevaPagina();
  let y = encabezado(page, true);

  y = seccionKV(page, "DATOS DEL ESTUDIO", y, [
    ["Paciente", p.nombre || "—"], ["Sexo", v.sexo], ["Edad", v.edad], ["Fecha del estudio", p.fecha],
    ["N° Benef.", p.benef], ["Documento", p.documento],
    ["Operador", v.operador || "Lisandro I. Veliz"], ["Equipo utilizado", v.equipo || "ECUD"],
  ]);
  y = bloqueTexto(page, "PREPARACIÓN Y DATOS CLÍNICOS", y, [
    ["Diagnóstico clínico", v.diagClinico], ["Antecedentes", v.antecedentes],
    ["Urocultivo", v.urocultivo], ["Profilaxis antibiótica", v.profilaxis], ["Catéteres", v.cateteres],
  ]);
  y = seccionKV(page, "FASE DE LLENADO", y, [
    ["Sensibilidad", v.sensibilidad], ["Primer deseo", v.primerDeseo],
    ["Deseo habitual", v.deseoHabitual], ["Deseo máximo", v.deseoMaximo],
    ["Detrusor", v.detrusorLlenado], ["Contracc. involunt.", v.contraccInvol],
    ["IOU", v.iou], ["IOU desde", v.iouDesde], ["Pdet máx. CI", v.pdetCI],
    ["Incont. esfuerzo", v.ioe], ["VLPP", v.vlpp],
    ["Capacidad cistométrica", v.capacidad], ["Acomodación", v.acomodacion],
  ]);
  y = seccionKV(page, "FASE DE VACIADO", y, [
    ["Contracción detrusor", v.contraccVaciado], ["Pdet máxima", v.pdetMax], ["PdetQmax", v.pdetQmax],
    ["Flujo", v.flujo], ["Curva", v.curva], ["Qmax", v.qmax], ["Q promedio", v.qprom],
    ["Volumen miccional", v.volMiccional], ["Apoyo abdominal", v.apoyoAbdominal],
    ["RPM final", v.rpm], ["Presión apertura", v.presionApertura],
  ]);

  // ===================== PÁGINA 2 =====================
  page = nuevaPagina();
  y = encabezado(page, false);

  y = bloqueTexto(page, "OBSERVACIONES", y, [
    ["Observaciones de llenado", v.obsLlenado], ["Flujometría libre", v.flujoLibre],
  ]);
  y = bloqueTexto(page, "REFERENCIAS", y, [
    ["", "• Primer deseo miccional: 150–250 ml."],
    ["", "• Capacidad cistométrica: 350–600 ml."],
    ["", "• Qmax de referencia: > 15 ml/s.    • RPM normal: < 50 ml."],
    ["", "• Pdet máx. en vaciado voluntario: 20–60 cm H2O."],
    ["", "• VLPP > 60 cm H2O: esfínter conservado; < 60: incompetencia esfinteriana intrínseca."],
  ]);
  if (cuerpo) y = bloqueTexto(page, "CONCLUSIÓN", y, [["", cuerpo]]);

  // Firma (Veliz u otro médico elegido). Con firma cargada -> imagen; si no, espacio.
  const fy = Math.min(y - 20, 190);
  const firmaAreaW = 220, firmaAreaX = W - M - firmaAreaW;
  const firmaBuf = firmaArchivo ? readAsset(firmaArchivo) : null;
  let firmaImg = null;
  if (firmaBuf) { try { firmaImg = await doc.embedPng(firmaBuf); } catch { /* sin firma */ } }
  if (firmaImg) {
    const { w, h } = encajarImagen(firmaImg, 150, 55);
    page.drawImage(firmaImg, { x: firmaAreaX + (firmaAreaW - w) / 2, y: fy - 20, width: w, height: h });
  } else {
    centerIn(page, "Firma y sello profesional", firmaAreaX, W - M, fy, { bold: true, size: 10.5 });
    page.drawLine({ start: { x: firmaAreaX + 12, y: fy - 32 }, end: { x: W - M - 12, y: fy - 32 }, thickness: 0.8, color: border });
  }
  if (medicoNombre || medicoMatricula) {
    let my = fy - 44;
    if (medicoNombre) { centerIn(page, medicoNombre, firmaAreaX, W - M, my, { bold: true, size: 10 }); my -= 13; }
    if (medicoMatricula) { centerIn(page, medicoMatricula, firmaAreaX, W - M, my, { size: 9.5, color: soft }); }
  }

  // Pie del centro (abajo).
  if (pieLines.length) {
    const top = 96, h = 52;
    drawBox(page, top, h);
    let py = top - 18;
    centerT(page, pieLines[0], py, { bold: true, size: 12 }); py -= 15;
    for (let i = 1; i < pieLines.length; i++) { centerT(page, pieLines[i], py, { bold: true, size: 10.5 }); py -= 14; }
  }

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

// ===== Liquidación de honorarios (PDF membretado) =====
// Documento que el centro le entrega al médico: membrete del centro (logo +
// nombre + dirección), el detalle de las prácticas agrupadas por especialidad
// (con el/los médico(s) de esa especialidad) y el total de honorarios. La data
// (grupos con sus filas y subtotales) la arma server.js; acá solo se dibuja.
//   input = { clienteNombre, clienteDireccion, logoName, logoW, periodoLabel,
//             fechaEmision, paraLabel, mostrarFacturado,
//             grupos:[{ especialidad, medicos, filas:[{practica,code,cantidad,
//               facturado,pago,honorario}], subFacturado, subHonorario }],
//             totalFacturado, totalHonorario }
function _liqSafe(s) { return String(s == null ? "" : s).replace(/[^\x20-\x7E\xA0-\xFF]/g, " "); }
function _liqMoney(n) {
  n = Math.round((Number(n) || 0) * 100) / 100;
  const neg = n < 0; n = Math.abs(n);
  const s = n.toFixed(2).split(".");
  const ent = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (neg ? "-$ " : "$ ") + ent + "," + s[1];
}
async function buildLiquidacionHonorariosPdf(input) {
  const { PDFDocument, StandardFonts, rgb } = require("./vendor/pdf-lib.min.js");
  const data = input || {};
  const grupos = Array.isArray(data.grupos) ? data.grupos : [];
  const mostrarFact = data.mostrarFacturado !== false;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.12, 0.12), soft = rgb(0.38, 0.38, 0.38), line = rgb(0.62, 0.62, 0.62), band = rgb(0.93, 0.95, 0.97);
  const W = 595.28, H = 841.89, Mx = 46;
  let logoImg = null, logoDims = null;
  const logoBuf = readAsset(data.logoName);
  if (logoBuf) { try { logoImg = await doc.embedPng(logoBuf); logoDims = encajarImagen(logoImg, data.logoW || 90, 66); } catch { logoImg = null; } }
  // Columnas: Práctica (izq) · Cant · Facturado · Honorario (der).
  const xPrac = Mx;
  const xHonR = W - Mx;
  const xFactR = mostrarFact ? W - Mx - 95 : null;
  const xCantR = (mostrarFact ? xFactR : xHonR) - 95;
  const pracMaxW = xCantR - xPrac - 40;
  let page, y;
  const T = (t, x, yy, o = {}) => page.drawText(_liqSafe(t), { x, y: yy, size: o.size || 10, font: o.bold ? bold : font, color: o.color || ink });
  const rightT = (t, xr, yy, o = {}) => { const f = o.bold ? bold : font, s = o.size || 10; T(t, xr - f.widthOfTextAtSize(_liqSafe(t), s), yy, o); };
  const centerT = (t, yy, o = {}) => { const f = o.bold ? bold : font, s = o.size || 10; T(t, (W - f.widthOfTextAtSize(_liqSafe(t), s)) / 2, yy, o); };
  const hr = (yy, th) => page.drawLine({ start: { x: Mx, y: yy }, end: { x: W - Mx, y: yy }, thickness: th || 0.6, color: line });
  const colHeads = () => {
    T("Práctica", xPrac, y, { bold: true, size: 8, color: soft });
    rightT("Cant.", xCantR, y, { bold: true, size: 8, color: soft });
    if (mostrarFact) rightT("Facturado", xFactR, y, { bold: true, size: 8, color: soft });
    rightT("Honorario", xHonR, y, { bold: true, size: 8, color: soft });
    y -= 5; hr(y); y -= 13;
  };
  const header = () => {
    y = H - 46;
    if (logoImg && logoDims) { page.drawImage(logoImg, { x: (W - logoDims.w) / 2, y: y - logoDims.h, width: logoDims.w, height: logoDims.h }); y -= logoDims.h + 8; }
    centerT(data.clienteNombre || "Centro", y - 12, { bold: true, size: 14 }); y -= 27;
    if (data.clienteDireccion) { centerT(data.clienteDireccion, y, { size: 9, color: soft }); y -= 14; }
    centerT("Liquidación de honorarios", y - 3, { bold: true, size: 12 }); y -= 19;
    const sub = [data.periodoLabel, data.fechaEmision ? ("Emitido: " + data.fechaEmision) : ""].filter(Boolean).join("     ·     ");
    if (sub) { centerT(sub, y, { size: 9, color: soft }); y -= 15; }
    if (data.paraLabel) { centerT(data.paraLabel, y, { size: 9.5, bold: true }); y -= 15; }
    y -= 2; hr(y, 0.8); y -= 14;
    colHeads();
  };
  const ensure = (h) => { if (y - h < 70) { page = doc.addPage([W, H]); header(); } };
  page = doc.addPage([W, H]); header();
  for (const g of grupos) {
    ensure(40);
    // Banda de especialidad + médicos.
    page.drawRectangle({ x: Mx, y: y - 4, width: W - 2 * Mx, height: 17, color: band });
    T((g.especialidad || "Sin especialidad").toUpperCase(), xPrac + 4, y, { bold: true, size: 9.5 });
    if (g.medicos) rightT(g.medicos, xHonR - 4, y, { size: 8.5, color: soft });
    y -= 20;
    for (const f of (g.filas || [])) {
      const lines = wrapText((f.practica || f.code || "") + (f.code ? "  (" + f.code + ")" : ""), font, 9, pracMaxW);
      const rh = Math.max(12, lines.length * 11);
      ensure(rh + 2);
      lines.forEach((ln, i) => T(ln, xPrac, y - i * 11, { size: 9 }));
      rightT(String(f.cantidad != null ? f.cantidad : ""), xCantR, y, { size: 9 });
      if (mostrarFact) rightT(_liqMoney(f.facturado), xFactR, y, { size: 9 });
      rightT(_liqMoney(f.honorario), xHonR, y, { size: 9, bold: true });
      y -= rh + 2;
    }
    // Subtotal del grupo.
    y -= 2; hr(y); y -= 13;
    rightT("Subtotal " + (g.especialidad || ""), xCantR, y, { size: 8.5, color: soft });
    if (mostrarFact) rightT(_liqMoney(g.subFacturado), xFactR, y, { size: 9 });
    rightT(_liqMoney(g.subHonorario), xHonR, y, { size: 9.5, bold: true });
    y -= 20;
  }
  // Total general.
  ensure(60);
  hr(y, 0.9); y -= 16;
  T("TOTAL HONORARIOS", xPrac, y, { bold: true, size: 11 });
  if (mostrarFact) rightT(_liqMoney(data.totalFacturado), xFactR, y, { size: 9, color: soft });
  rightT(_liqMoney(data.totalHonorario), xHonR, y, { bold: true, size: 12 });
  y -= 46;
  // Firma del profesional (si es una liquidación para UN médico).
  ensure(50);
  if (data.paraLabel) {
    const fx = W - Mx - 220;
    page.drawLine({ start: { x: fx, y: y }, end: { x: W - Mx, y: y }, thickness: 0.6, color: line });
    y -= 12; rightT("Firma y aclaración", W - Mx - 60, y, { size: 8.5, color: soft });
  }
  const bytes = await doc.save();
  return bytes;
}

module.exports = { MODELOS, buildInformePdf, buildLiquidacionHonorariosPdf, informeFilename, listarModelos, MODELO_RENOMBRADOS, MODELO_VIEJO_CLIENTE };
