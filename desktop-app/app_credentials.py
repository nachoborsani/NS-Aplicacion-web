from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from app_paths import get_data_dir


SHARED_CREDENTIALS_FILE = Path(get_data_dir()) / "usuarios_pami.json"


def sync_profile_records(records: list[dict], *, name_keys: Iterable[str] = ("nombre", "cliente")) -> list[dict]:
    shared = _load_shared_map()
    changed = False
    synced: list[dict] = []

    for item in records:
        if not isinstance(item, dict):
            continue
        record = dict(item)
        usuario = _normalize_user(record.get("usuario"))
        if not usuario:
            synced.append(record)
            continue

        shared_item = shared.get(usuario.lower())
        if shared_item:
            record_clave = str(record.get("clave", "") or "")
            if not str(shared_item.get("clave", "") or "") and record_clave:
                shared_item["clave"] = record_clave
                changed = True
            record_nombre = _first_text(record.get(name_key) for name_key in name_keys)
            if not str(shared_item.get("nombre", "") or "") and record_nombre:
                shared_item["nombre"] = record_nombre
                changed = True
            shared_clave = str(shared_item.get("clave", "") or "")
            if shared_clave:
                record["clave"] = shared_clave
            shared_nombre = str(shared_item.get("nombre", "") or "")
            for key in name_keys:
                if key in record and not str(record.get(key, "") or "").strip() and shared_nombre:
                    record[key] = shared_nombre
        else:
            shared[usuario.lower()] = _shared_from_profile(record, usuario=usuario, name_keys=name_keys)
            changed = True
        synced.append(record)

    if changed:
        _save_shared_map(shared)
    return synced


def upsert_shared_credentials_from_records(
    records: Iterable[dict],
    *,
    name_keys: Iterable[str] = ("nombre", "cliente"),
) -> None:
    shared = _load_shared_map()
    changed = False

    for item in records:
        if not isinstance(item, dict):
            continue
        usuario = _normalize_user(item.get("usuario"))
        if not usuario:
            continue
        key = usuario.lower()
        current = dict(shared.get(key, {"usuario": usuario, "clave": "", "nombre": ""}))
        current["usuario"] = usuario

        clave = str(item.get("clave", "") or "")
        if clave and current.get("clave") != clave:
            current["clave"] = clave
            changed = True

        nombre = _first_text(item.get(name_key) for name_key in name_keys)
        if nombre and current.get("nombre") != nombre:
            current["nombre"] = nombre
            changed = True

        if key not in shared:
            shared[key] = current
            changed = True
        else:
            shared[key] = current

    if changed:
        _save_shared_map(shared)


def sync_profile_payload(payload: dict, *, name_keys: Iterable[str] = ("nombre", "cliente")) -> dict:
    data = dict(payload) if isinstance(payload, dict) else {}
    usuarios = data.get("usuarios", [])
    if isinstance(usuarios, list):
        data["usuarios"] = sync_profile_records(usuarios, name_keys=name_keys)
    return data


def upsert_shared_credentials_from_payload(payload: dict, *, name_keys: Iterable[str] = ("nombre", "cliente")) -> None:
    if isinstance(payload, dict) and isinstance(payload.get("usuarios"), list):
        upsert_shared_credentials_from_records(payload["usuarios"], name_keys=name_keys)


def refresh_object_profile_credentials(owner: object) -> None:
    saved_profiles = getattr(owner, "saved_profiles", None)
    if isinstance(saved_profiles, list):
        saved_profiles = sync_profile_records(saved_profiles)
        setattr(owner, "saved_profiles", saved_profiles)
    elif isinstance(saved_profiles, dict):
        saved_profiles = sync_profile_payload(saved_profiles)
        setattr(owner, "saved_profiles", saved_profiles)
    else:
        return

    user_var = getattr(owner, "profile_user_var", None)
    password_var = getattr(owner, "profile_password_var", None)
    if user_var is None or password_var is None:
        return

    try:
        usuario = str(user_var.get() or "").strip()
    except Exception:
        return
    if not usuario:
        return

    profile = _find_profile(saved_profiles, usuario)
    if not profile:
        return
    clave = str(profile.get("clave", "") or "")
    if clave:
        try:
            password_var.set(clave)
        except Exception:
            pass


def _shared_from_profile(profile: dict, *, usuario: str, name_keys: Iterable[str]) -> dict:
    return {
        "usuario": usuario,
        "clave": str(profile.get("clave", "") or ""),
        "nombre": _first_text(profile.get(name_key) for name_key in name_keys),
    }


def _load_shared_map() -> dict[str, dict]:
    try:
        data = json.loads(SHARED_CREDENTIALS_FILE.read_text(encoding="utf-8"))
        usuarios = data.get("usuarios", [])
    except Exception:
        usuarios = []

    shared: dict[str, dict] = {}
    if not isinstance(usuarios, list):
        return shared

    for item in usuarios:
        if not isinstance(item, dict):
            continue
        usuario = _normalize_user(item.get("usuario"))
        if not usuario:
            continue
        shared[usuario.lower()] = {
            "usuario": usuario,
            "clave": str(item.get("clave", "") or ""),
            "nombre": str(item.get("nombre", "") or "").strip(),
        }
    return shared


def _save_shared_map(shared: dict[str, dict]) -> None:
    usuarios = sorted(shared.values(), key=lambda item: str(item.get("usuario", "")).lower())
    SHARED_CREDENTIALS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SHARED_CREDENTIALS_FILE.write_text(
        json.dumps({"usuarios": usuarios}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _normalize_user(value: object) -> str:
    return str(value or "").strip()


def _first_text(values: Iterable[object]) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _find_profile(saved_profiles: object, usuario: str) -> dict | None:
    usuarios = saved_profiles.get("usuarios", []) if isinstance(saved_profiles, dict) else saved_profiles
    if not isinstance(usuarios, list):
        return None
    target = usuario.lower()
    for item in usuarios:
        if isinstance(item, dict) and str(item.get("usuario", "")).strip().lower() == target:
            return item
    return None
