import json
from copy import deepcopy
from pathlib import Path

from app_paths import get_data_dir
from app_credentials import sync_profile_records, upsert_shared_credentials_from_records


DEFAULT_MEDICOS = [
    "EPSTEIN ALEJANDRO MAX",
    "SCHEFFELAAR KLOTZ, SABRINA ALEJANDRA",
    "DUBESARSKY EZEQUIEL ADOLFO",
]

SETTINGS_FILE = Path(get_data_dir()) / "configuracion_medicos.json"

DEFAULT_PANEL_RAPIDO_CONFIG = {
    "ver_web_default": False,
    "modules": [
        {"key": "med_cabecera_sheets", "label": "Med Cabecera - Sheets", "visible": True},
        {"key": "especialista_sheets", "label": "Especialista - Sheets", "visible": True},
        {"key": "activar_ome_sheets", "label": "Activar OME - Sheets", "visible": True},
        {"key": "transmision", "label": "Transmision", "visible": True},
        {"key": "liberar_cupo", "label": "Liberar Cupo", "visible": True},
        {"key": "credenciales", "label": "Credenciales", "visible": True},
    ],
}

VERIFICAR_OMES_COMBOS = [
    {"key": "lesiones", "label": "Validar lesiones"},
    {"key": "video_otorino_lesiones", "label": "Validar Video + Otorrino + Lesiones"},
    {"key": "flebo_esclerosante", "label": "Validar Flebo + Esclerosante"},
    {"key": "reuma_infiltraciones", "label": "Validar Reuma + Infiltraciones"},
    {"key": "hema_frotis", "label": "Validar Hematologia + Frotis"},
    {"key": "mamografia_eco_mamaria", "label": "Validar Mamografia + Ecografias"},
    {"key": "espiro_neumo", "label": "Validar Espiro + Consulta Neumo"},
]

DEFAULT_VERIFICAR_OMES_CONFIG = {
    "combos": {item["key"]: True for item in VERIFICAR_OMES_COMBOS},
}

PANEL_RAPIDO_MODULES = [dict(item) for item in DEFAULT_PANEL_RAPIDO_CONFIG["modules"]]

PROFILE_SECTIONS: dict[str, dict] = {
    "transmision": {
        "title": "Transmision",
        "filename": "usuarios_transmision.json",
        "identity_field": "usuario",
        "display_fields": ["usuario", "nombre"],
        "fields": [
            {"key": "nombre", "label": "Cliente", "required": False},
            {"key": "usuario", "label": "Usuario", "required": True},
            {"key": "clave", "label": "Clave", "required": False},
            {"key": "ultima_boteada", "label": "Ultima boteada", "required": False},
            {"key": "fecha_desde", "label": "Fecha desde", "required": False},
            {"key": "fecha_hasta", "label": "Fecha hasta", "required": False},
            {"key": "validada", "label": "Validada", "required": False},
            {"key": "transmitida", "label": "Transmitida", "required": False},
        ],
        "defaults": {
            "nombre": "",
            "usuario": "",
            "clave": "",
            "ultima_boteada": "",
            "fecha_desde": "",
            "fecha_hasta": "",
            "validada": "",
            "transmitida": "",
        },
    },
    "ome_med_cabecera": {
        "title": "OME Med Cabecera",
        "filename": "usuarios_ome_med_cabecera.json",
        "identity_field": "usuario",
        "display_fields": ["usuario", "nombre"],
        "fields": [
            {"key": "nombre", "label": "Nombre", "required": False},
            {"key": "usuario", "label": "Usuario", "required": True},
            {"key": "clave", "label": "Clave", "required": False},
        ],
        "defaults": {"nombre": "", "usuario": "", "clave": ""},
    },
    "ome_especialista": {
        "title": "OME Especialista",
        "filename": "usuarios_ome_especialista.json",
        "identity_field": "usuario",
        "display_fields": ["usuario", "nombre"],
        "fields": [
            {"key": "nombre", "label": "Nombre", "required": False},
            {"key": "usuario", "label": "Usuario", "required": True},
            {"key": "clave", "label": "Clave", "required": False},
        ],
        "defaults": {"nombre": "", "usuario": "", "clave": ""},
    },
    "activar": {
        "title": "Activar OME",
        "filename": "usuarios_activar.json",
        "identity_field": "usuario",
        "display_fields": ["usuario", "nombre"],
        "fields": [
            {"key": "nombre", "label": "Nombre", "required": False},
            {"key": "usuario", "label": "Usuario", "required": True},
            {"key": "clave", "label": "Clave", "required": False},
        ],
        "defaults": {"nombre": "", "usuario": "", "clave": ""},
    },
    "liberar_cupo": {
        "title": "Liberar Cupo",
        "filename": "usuarios_liberar_cupo.json",
        "identity_field": "usuario",
        "display_fields": ["usuario", "nombre"],
        "fields": [
            {"key": "nombre", "label": "Nombre", "required": False},
            {"key": "usuario", "label": "Usuario", "required": True},
            {"key": "clave", "label": "Clave", "required": False},
        ],
        "defaults": {"nombre": "", "usuario": "", "clave": ""},
    },
    "verificar": {
        "title": "Verificar OME",
        "filename": "usuarios_verificar.json",
        "identity_field": "usuario",
        "display_fields": ["cliente", "usuario"],
        "fields": [
            {"key": "cliente", "label": "Cliente", "required": False},
            {"key": "usuario", "label": "Usuario", "required": True},
            {"key": "clave", "label": "Clave", "required": False},
        ],
        "defaults": {"cliente": "", "usuario": "", "clave": ""},
    },
    "documentacion": {
        "title": "Documentacion OME",
        "filename": "usuarios_documentacion.json",
        "identity_field": "usuario",
        "display_fields": ["usuario", "nombre"],
        "fields": [
            {"key": "nombre", "label": "Cliente", "required": False},
            {"key": "usuario", "label": "Usuario", "required": True},
            {"key": "clave", "label": "Clave", "required": False},
        ],
        "defaults": {"nombre": "", "usuario": "", "clave": ""},
    },
    "afip": {
        "title": "AFIP",
        "filename": "usuarios_afip.json",
        "identity_field": "usuario",
        "display_fields": ["usuario", "nombre"],
        "fields": [
            {"key": "nombre", "label": "Nombre", "required": False},
            {"key": "usuario", "label": "CUIT/CUIL", "required": True},
            {"key": "clave", "label": "Clave", "required": False},
            {"key": "representado", "label": "Representado", "required": False},
            {"key": "punto_venta", "label": "Punto venta", "required": False},
            {"key": "tipo_comprobante", "label": "Tipo comprobante", "required": False},
            {"key": "actividad", "label": "Actividad", "required": False},
            {"key": "receptor_cuit", "label": "Receptor CUIT", "required": False},
            {"key": "receptor_iva", "label": "Receptor IVA", "required": False},
            {"key": "receptor_tipo_doc", "label": "Receptor tipo doc", "required": False},
            {"key": "condicion_venta", "label": "Condicion venta", "required": False},
        ],
        "defaults": {
            "nombre": "",
            "usuario": "",
            "clave": "",
            "representado": "",
            "punto_venta": "00002",
            "tipo_comprobante": "Factura C",
            "actividad": "869090 - SERVICIOS RELACIONADOS CON LA SALUD",
            "receptor_cuit": "30522763922",
            "receptor_iva": "IVA Sujeto Exento",
            "receptor_tipo_doc": "CUIT",
            "condicion_venta": "Cuenta Corriente",
        },
    },
}


def load_medicos_config() -> list[str]:
    try:
        data = _load_settings_payload()
        medicos = data.get("medicos", [])
        if not isinstance(medicos, list):
            raise ValueError("Formato invalido.")
        normalizados = _normalizar_medicos(medicos)
        if normalizados:
            return normalizados
    except Exception:
        pass
    return list(DEFAULT_MEDICOS)


def save_medicos_config(medicos: list[str]) -> list[str]:
    normalizados = _normalizar_medicos(medicos)
    if not normalizados:
        raise ValueError("Debe quedar al menos un medico cargado.")

    payload = _load_settings_payload()
    payload["medicos"] = normalizados
    _save_settings_payload(payload)
    return normalizados


def get_medico_default() -> str:
    medicos = load_medicos_config()
    return medicos[0] if medicos else DEFAULT_MEDICOS[0]


def load_panel_rapido_config() -> dict:
    payload = _load_settings_payload()
    raw_config = payload.get("panel_rapido", {})
    if not isinstance(raw_config, dict):
        raw_config = {}
    config = _default_panel_rapido_config()
    config.update(raw_config)
    config["ver_web_default"] = _truthy(config.get("ver_web_default"))
    config["modules"] = _normalize_panel_rapido_modules(config.get("modules"))
    return config


def save_panel_rapido_config(config: dict) -> dict:
    payload = _load_settings_payload()
    current = payload.get("panel_rapido", {})
    if not isinstance(current, dict):
        current = {}
    merged = _default_panel_rapido_config()
    merged.update(current)
    merged.update(config if isinstance(config, dict) else {})

    normalized = _default_panel_rapido_config()
    normalized["ver_web_default"] = _truthy(merged.get("ver_web_default"))
    normalized["modules"] = _normalize_panel_rapido_modules(merged.get("modules"))
    payload["panel_rapido"] = normalized
    _save_settings_payload(payload)
    return normalized


def load_verificar_omes_config() -> dict:
    payload = _load_settings_payload()
    return _normalize_verificar_omes_config(payload.get("verificar_omes", {}))


def save_verificar_omes_config(config: dict) -> dict:
    payload = _load_settings_payload()
    current = payload.get("verificar_omes", {})
    if not isinstance(current, dict):
        current = {}

    merged = deepcopy(current)
    if isinstance(config, dict):
        for key, value in config.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                nested = dict(merged[key])
                nested.update(value)
                merged[key] = nested
            else:
                merged[key] = value

    normalized = _normalize_verificar_omes_config(merged)
    payload["verificar_omes"] = normalized
    _save_settings_payload(payload)
    return normalized


def get_profile_sections() -> dict[str, dict]:
    return deepcopy(PROFILE_SECTIONS)


def load_profile_records(section_key: str) -> list[dict]:
    config = _require_section(section_key)
    path = get_profile_file_path(section_key)
    defaults = dict(config.get("defaults", {}))
    records: list[dict] = []

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        usuarios = data.get("usuarios", [])
        if not isinstance(usuarios, list):
            return []
        for item in usuarios:
            if not isinstance(item, dict):
                continue
            record = defaults.copy()
            for field in config["fields"]:
                key = field["key"]
                record[key] = str(item.get(key, record.get(key, "")) or "").strip()
            identity = str(record.get(config["identity_field"], "")).strip()
            if identity:
                records.append(record)
    except Exception:
        return []
    return sync_profile_records(records)


def save_profile_records(section_key: str, records: list[dict]) -> list[dict]:
    config = _require_section(section_key)
    path = get_profile_file_path(section_key)
    defaults = dict(config.get("defaults", {}))
    identity_field = config["identity_field"]
    normalized: list[dict] = []
    seen = set()

    for item in records:
        if not isinstance(item, dict):
            continue
        record = defaults.copy()
        for field in config["fields"]:
            key = field["key"]
            record[key] = str(item.get(key, record.get(key, "")) or "").strip()
        identity = str(record.get(identity_field, "")).strip()
        if not identity:
            continue
        identity_key = identity.lower()
        if identity_key in seen:
            continue
        seen.add(identity_key)
        normalized.append(record)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"usuarios": normalized}, ensure_ascii=False, indent=2), encoding="utf-8")
    upsert_shared_credentials_from_records(normalized)
    return sync_profile_records(normalized)


def get_profile_file_path(section_key: str) -> Path:
    config = _require_section(section_key)
    return Path(get_data_dir()) / str(config["filename"])


def build_record_display(section_key: str, record: dict) -> str:
    config = _require_section(section_key)
    values = []
    for key in config.get("display_fields", []):
        value = str(record.get(key, "") or "").strip()
        if value:
            values.append(value)
    if values:
        return " - ".join(values)
    return str(record.get(config["identity_field"], "") or "").strip()


def _require_section(section_key: str) -> dict:
    config = PROFILE_SECTIONS.get(section_key)
    if not config:
        raise KeyError(f"Seccion de configuracion desconocida: {section_key}")
    return config


def _load_settings_payload() -> dict:
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def _save_settings_payload(payload: dict) -> None:
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _truthy(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "si", "sí", "yes", "y", "x"}


def _default_panel_rapido_config() -> dict:
    return {
        "ver_web_default": False,
        "modules": [dict(item) for item in PANEL_RAPIDO_MODULES],
    }


def _normalize_panel_rapido_modules(raw_modules) -> list[dict]:
    defaults = {item["key"]: item for item in PANEL_RAPIDO_MODULES}
    normalized: list[dict] = []
    seen = set()
    if isinstance(raw_modules, list):
        for item in raw_modules:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key", "")).strip()
            if key not in defaults or key in seen:
                continue
            base = dict(defaults[key])
            base["visible"] = _truthy(item.get("visible", base.get("visible", True)))
            normalized.append(base)
            seen.add(key)
    for key, item in defaults.items():
        if key not in seen:
            normalized.append(dict(item))
    return normalized


def _normalize_verificar_omes_config(raw_config) -> dict:
    config = deepcopy(DEFAULT_VERIFICAR_OMES_CONFIG)
    if not isinstance(raw_config, dict):
        return config

    raw_combos = raw_config.get("combos", {})
    if isinstance(raw_combos, dict):
        for key in config["combos"]:
            if key in raw_combos:
                config["combos"][key] = _truthy(raw_combos.get(key))
    return config


def _normalizar_medicos(medicos: list[str]) -> list[str]:
    resultado = []
    vistos = set()
    for medico in medicos:
        texto = " ".join(str(medico or "").strip().split())
        if not texto:
            continue
        clave = texto.upper()
        if clave in vistos:
            continue
        vistos.add(clave)
        resultado.append(texto)
    return resultado
