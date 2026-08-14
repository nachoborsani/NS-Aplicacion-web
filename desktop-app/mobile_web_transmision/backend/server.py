from __future__ import annotations

import json
import sys
import threading
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app_paths import get_data_dir, get_output_dir  # noqa: E402
from pami_transmision import PamiTransmisionController  # noqa: E402


FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"
PROFILES_FILE = get_data_dir() / "usuarios_transmision.json"
DOWNLOADS_DIR = get_output_dir() / "web_transmision"
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)


class FiltersPayload(BaseModel):
    fecha_desde: str = Field(default="", alias="fechaDesde")
    fecha_hasta: str = Field(default="", alias="fechaHasta")
    validada: str = ""
    transmitida: str = ""

    model_config = {"populate_by_name": True}


class ProfilePayload(BaseModel):
    nombre: str = Field(default="", alias="cliente")
    usuario: str = ""
    clave: str = ""
    ultima_boteada: str = ""
    fecha_desde: str = Field(default="", alias="fechaDesde")
    fecha_hasta: str = Field(default="", alias="fechaHasta")
    validada: str = ""
    transmitida: str = ""

    model_config = {"populate_by_name": True}


class ControllerActionPayload(BaseModel):
    nombre: str = Field(default="", alias="cliente")
    usuario: str = ""
    clave: str = ""
    filtros: FiltersPayload = Field(default_factory=FiltersPayload)
    headless: bool = False

    model_config = {"populate_by_name": True}


class AutofillPayload(BaseModel):
    usuario: str = ""
    clave: str = ""


class LogStore:
    def __init__(self, limit: int = 300) -> None:
        self._items: deque[dict[str, str]] = deque(maxlen=limit)
        self._lock = threading.Lock()

    def push(self, kind: str, message: str) -> None:
        item = {
            "kind": kind,
            "message": str(message),
            "timestamp": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
        }
        with self._lock:
            self._items.append(item)

    def list(self) -> list[dict[str, str]]:
        with self._lock:
            return list(self._items)


logs = LogStore()
controller = PamiTransmisionController(
    log_callback=lambda msg: logs.push("log", msg),
    status_callback=lambda msg: logs.push("status", msg),
)

app = FastAPI(title="Transmision Web Movil")
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


def _run_controller_action(action, *args, **kwargs) -> None:
    def runner() -> None:
        try:
            action(*args, **kwargs)
        except Exception as exc:
            logs.push("error", str(exc))

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()


def _normalize_profiles(raw: Any) -> list[dict[str, str]]:
    if isinstance(raw, dict):
        items = raw.get("usuarios", [])
    elif isinstance(raw, list):
        items = raw
    else:
        items = []

    profiles: list[dict[str, str]] = []
    for item in items:
        if isinstance(item, dict):
            usuario = str(item.get("usuario", "") or "").strip()
            nombre = str(item.get("nombre", item.get("cliente", "")) or "").strip()
            clave = str(item.get("clave", "") or "")
            ultima_boteada = str(item.get("ultima_boteada", item.get("last_bot_at", "")) or "").strip()
            fecha_desde = str(item.get("fecha_desde", item.get("filtro_fecha_desde", "")) or "").strip()
            fecha_hasta = str(item.get("fecha_hasta", item.get("filtro_fecha_hasta", "")) or "").strip()
            validada = str(item.get("validada", item.get("filtro_validada", "")) or "").strip()
            transmitida = str(item.get("transmitida", item.get("filtro_transmitida", "")) or "").strip()
        else:
            usuario = str(item or "").strip()
            nombre = ""
            clave = ""
            ultima_boteada = ""
            fecha_desde = ""
            fecha_hasta = ""
            validada = ""
            transmitida = ""

        if not usuario:
            continue

        profiles.append(
            {
                "nombre": nombre,
                "cliente": nombre,
                "usuario": usuario,
                "clave": clave,
                "ultima_boteada": ultima_boteada,
                "fecha_desde": fecha_desde,
                "fecha_hasta": fecha_hasta,
                "validada": validada,
                "transmitida": transmitida,
            }
        )

    return profiles


def load_profiles() -> list[dict[str, str]]:
    if not PROFILES_FILE.exists():
        return []
    try:
        raw = json.loads(PROFILES_FILE.read_text(encoding="utf-8"))
        return _normalize_profiles(raw)
    except Exception:
        logs.push("error", "No se pudieron leer los perfiles guardados.")
        return []


def save_profiles(profiles: list[dict[str, str]]) -> None:
    payload = {
        "usuarios": [
            {
                "usuario": item.get("usuario", "").strip(),
                "nombre": item.get("nombre", "").strip(),
                "clave": item.get("clave", ""),
                "ultima_boteada": item.get("ultima_boteada", "").strip(),
                "fecha_desde": item.get("fecha_desde", "").strip(),
                "fecha_hasta": item.get("fecha_hasta", "").strip(),
                "validada": item.get("validada", "").strip(),
                "transmitida": item.get("transmitida", "").strip(),
            }
            for item in profiles[:20]
            if item.get("usuario", "").strip()
        ]
    }
    PROFILES_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _profile_from_payload(payload: ProfilePayload | ControllerActionPayload, *, last_bot: str = "") -> dict[str, str]:
    if isinstance(payload, ControllerActionPayload):
        filtros = payload.filtros.model_dump()
    else:
        filtros = {
            "fecha_desde": payload.fecha_desde,
            "fecha_hasta": payload.fecha_hasta,
            "validada": payload.validada,
            "transmitida": payload.transmitida,
        }

    return {
        "nombre": payload.nombre.strip(),
        "cliente": payload.nombre.strip(),
        "usuario": payload.usuario.strip(),
        "clave": payload.clave,
        "ultima_boteada": last_bot or getattr(payload, "ultima_boteada", ""),
        "fecha_desde": str(filtros.get("fecha_desde", "") or "").strip(),
        "fecha_hasta": str(filtros.get("fecha_hasta", "") or "").strip(),
        "validada": str(filtros.get("validada", "") or "").strip(),
        "transmitida": str(filtros.get("transmitida", "") or "").strip(),
    }


def upsert_profile(profile: dict[str, str]) -> list[dict[str, str]]:
    usuario = profile.get("usuario", "").strip()
    if not usuario:
        return load_profiles()

    profiles = [item for item in load_profiles() if item.get("usuario", "").strip().lower() != usuario.lower()]
    profiles.insert(0, profile)
    profiles = profiles[:20]
    save_profiles(profiles)
    return profiles


def delete_profile(usuario: str) -> list[dict[str, str]]:
    profiles = load_profiles()
    remaining = [item for item in profiles if item.get("usuario", "").strip().lower() != usuario.strip().lower()]
    if len(remaining) == len(profiles):
        raise HTTPException(status_code=404, detail="Ese perfil no estaba guardado.")
    save_profiles(remaining)
    return remaining


def human_status(value: str) -> str:
    mapping = {
        "PAUSED": "Pausado",
        "RUNNING": "Trabajando",
        "WAITING_RELOAD": "Trabajando",
        "DONE": "Finalizado",
        "ERROR": "Con error",
        "SIN DATOS": "Sin datos",
    }
    value = str(value or "SIN DATOS")
    return mapping.get(value, value.replace("_", " ").title())


def human_step(status: str, step: str) -> str:
    if status in {"RUNNING", "WAITING_RELOAD"}:
        return "Procesando"

    mapping = {
        "INICIO": "Inicio",
        "MODAL_ABIERTO": "Modal abierto",
        "PENDIENTE_VALIDACION": "Pendiente de validacion",
    }
    step = str(step or "-")
    return mapping.get(step, step.replace("_", " ").title())


def build_status_payload() -> dict[str, Any]:
    try:
        state = controller.obtener_estado()
    except Exception as exc:
        return {
            "connected": False,
            "error": str(exc),
            "display": {
                "statusLine": "Estado: Sin iniciar | Proceso: Esperando acciones | Procesados: 0",
                "summaryLine": f"Sin sesion activa | Log en: {get_data_dir() / 'logs' / 'consulta_pami.log'}",
            },
            "logs": logs.list(),
        }

    status = str(state.get("status", "SIN DATOS"))
    step = str(state.get("step", "-"))
    procesados = state.get("procesados", 0)
    errores = state.get("errores", 0)
    pagina = state.get("paginaDetectada") or "-"
    pendiente = state.get("pendienteNroOrden") or "-"
    ultimo = state.get("ultimoExitoso") or "-"
    motivo = str(state.get("lastError") or "").strip()
    status_line = f"Estado: {human_status(status)} | Proceso: {human_step(status, step)} | Procesados: {procesados}"
    summary_line = f"Pagina: {pagina} | Errores: {errores} | Pendiente: {pendiente} | Ultimo exitoso: {ultimo}"
    if motivo:
        summary_line += f" | Motivo: {motivo}"

    return {
        "connected": True,
        "state": state,
        "display": {
            "status": human_status(status),
            "step": human_step(status, step),
            "statusLine": status_line,
            "summaryLine": summary_line,
        },
        "logs": logs.list(),
    }


def _validated_filters(payload: FiltersPayload) -> dict[str, str]:
    return payload.model_dump()


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/profiles")
def get_profiles() -> dict[str, Any]:
    return {"profiles": load_profiles()}


@app.post("/api/profiles")
def create_or_update_profile(payload: ProfilePayload) -> dict[str, Any]:
    if not payload.usuario.strip():
        raise HTTPException(status_code=400, detail="Ingresa un usuario para guardar el perfil.")

    profiles = upsert_profile(_profile_from_payload(payload))
    logs.push("status", f"Perfil guardado: {payload.usuario.strip()}")
    return {"profiles": profiles}


@app.delete("/api/profiles/{usuario}")
def remove_profile(usuario: str) -> dict[str, Any]:
    profiles = delete_profile(usuario)
    logs.push("status", f"Perfil borrado: {usuario}")
    return {"profiles": profiles}


@app.post("/api/autofill")
def autofill_login(payload: AutofillPayload) -> dict[str, str]:
    if not payload.usuario.strip():
        raise HTTPException(status_code=400, detail="Ingresa un usuario para autocompletar.")
    logs.push("status", "Solicitud recibida: autocompletar login.")
    _run_controller_action(controller.autocompletar_credenciales, payload.usuario.strip(), payload.clave)
    return {"message": "Autocompletado solicitado."}


@app.post("/api/open")
def open_session(payload: ControllerActionPayload) -> dict[str, Any]:
    if payload.usuario.strip():
        upsert_profile(_profile_from_payload(payload))
    logs.push("status", "Solicitud recibida: abrir PAMI.")
    _run_controller_action(
        controller.abrir_pami,
        payload.usuario.strip() or None,
        payload.clave or None,
        _validated_filters(payload.filtros),
        payload.headless,
    )
    return {"message": "Abriendo PAMI en la PC.", "profiles": load_profiles()}


@app.post("/api/open-start")
def open_and_start(payload: ControllerActionPayload) -> dict[str, Any]:
    if not payload.usuario.strip() or not payload.clave:
        raise HTTPException(status_code=400, detail="Completa usuario y clave para usar Abrir PAMI + Iniciar bot.")

    marca = datetime.now().strftime("%d/%m/%Y %H:%M")
    profile = _profile_from_payload(payload, last_bot=marca)
    profiles = upsert_profile(profile)

    def action() -> None:
        controller.abrir_pami(
            usuario=payload.usuario.strip(),
            clave=payload.clave,
            filtros=None,
            headless=payload.headless,
        )
        controller.iniciar_bot(_validated_filters(payload.filtros))

    logs.push("status", "Solicitud recibida: abrir PAMI e iniciar bot.")
    _run_controller_action(action)
    return {"message": "Abriendo PAMI e iniciando bot.", "profiles": profiles, "ultima_boteada": marca}


@app.post("/api/start")
def start_bot(payload: ControllerActionPayload) -> dict[str, Any]:
    marca = datetime.now().strftime("%d/%m/%Y %H:%M")
    profiles = load_profiles()
    if payload.usuario.strip():
        profiles = upsert_profile(_profile_from_payload(payload, last_bot=marca))

    logs.push("status", "Solicitud recibida: iniciar bot.")
    _run_controller_action(controller.iniciar_bot, _validated_filters(payload.filtros))
    return {"message": "Bot iniciado en segundo plano.", "profiles": profiles, "ultima_boteada": marca}


@app.post("/api/pause")
def pause_bot() -> dict[str, str]:
    _run_controller_action(controller.pausar_bot)
    return {"message": "Pausa solicitada."}


@app.post("/api/resume")
def resume_bot() -> dict[str, str]:
    _run_controller_action(controller.reanudar_bot)
    return {"message": "Reanudacion solicitada."}


@app.post("/api/reset")
def reset_bot() -> dict[str, str]:
    _run_controller_action(controller.resetear_bot)
    return {"message": "Reset solicitado."}


@app.post("/api/close")
def close_browser() -> dict[str, str]:
    _run_controller_action(controller.cerrar_navegador)
    return {"message": "Cierre solicitado."}


@app.get("/api/export")
def export_excel(
    fechaDesde: str = "",
    fechaHasta: str = "",
    validada: str = "",
    transmitida: str = "",
) -> FileResponse:
    filtros = {
        "fecha_desde": fechaDesde.strip(),
        "fecha_hasta": fechaHasta.strip(),
        "validada": validada.strip(),
        "transmitida": transmitida.strip(),
    }
    destino = DOWNLOADS_DIR / f"transmision_panel_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    final_path = controller.exportar_excel_panel(str(destino), filtros)
    return FileResponse(path=final_path, filename=Path(final_path).name)


@app.get("/api/status")
def get_status() -> dict[str, Any]:
    return build_status_payload()
