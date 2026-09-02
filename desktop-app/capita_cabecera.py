# -*- coding: utf-8 -*-
"""Decide si un paciente es CÁPITA del médico de cabecera del cliente.

Sirve para elegir el código de la OME de cabecera sin prueba y error:
  - cápita          -> 427109
  - extra cápita    -> 427122 / 427121 / 427120

La cápita se resuelve consultando la cartilla de PAMI (vía la web NS, endpoint
/api/pami/capita) y comparando el médico de cabecera ASIGNADO al paciente contra
el médico del cliente (config `medico` en cadena_clientes.py).

La comparación es TOLERANTE a propósito: PAMI escribe el nombre distinto de como lo
tenemos (mayúsculas, acentos, orden, un segundo nombre de más, y hasta un error de
tipeo — p. ej. "Dubesarsky Ezequiel Adolfo" contra nuestro "DUBESARKY, EZEQUIEL").
"""
from __future__ import annotations

import unicodedata


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")   # saca acentos
    s = s.upper()
    s = "".join(ch if (ch.isalnum() or ch == " ") else " " for ch in s)
    return " ".join(s.split())


def _tokens(s: str) -> list[str]:
    return [t for t in _norm(s).split(" ") if len(t) >= 3]


def _un_error(a: str, b: str) -> bool:
    """¿a y b están a lo sumo a UN error de tipeo (sustitución/inserción/borrado)?"""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:
        d = 0
        for x, y in zip(a, b):
            if x != y:
                d += 1
                if d > 1:
                    return False
        return True
    s, l = (a, b) if la < lb else (b, a)   # s = el más corto
    i = j = saltos = 0
    while i < len(s) and j < len(l):
        if s[i] == l[j]:
            i += 1
            j += 1
        else:
            saltos += 1
            if saltos > 1:
                return False
            j += 1
    return True


def _token_pega(t: str, tb: set[str]) -> bool:
    if t in tb:
        return True
    if len(t) < 5:                 # los cortos (nombres de pila breves) se exigen exactos
        return False
    return any(len(x) >= 5 and _un_error(t, x) for x in tb)


def medico_coincide(medico_cliente: str, medico_pami: str) -> bool:
    """¿El médico del cliente ES el médico de cabecera que devuelve PAMI?

    TODOS los tokens del médico del cliente tienen que aparecer en los de PAMI (PAMI
    suele traer nombres de más: "Dubesarsky Ezequiel Adolfo" ⊇ "Dubesarky Ezequiel").
    """
    tc = _tokens(medico_cliente)
    tp = set(_tokens(medico_pami))
    if not tc or not tp:
        return False
    return all(_token_pega(t, tp) for t in tc)


def medico_cabecera_de(web, beneficio: str, dni: str) -> str:
    """Consulta la cartilla y devuelve el médico de cabecera asignado ('' si no tiene)."""
    r = web._request("POST", "/api/pami/capita",
                     body={"beneficio": str(beneficio or ""), "dni": str(dni or "")})
    mods = r.get("modulos") or []
    for m in mods:
        a = m.get("asignado") or {}
        if "cabecera" in str(a.get("modulo", "")).lower():
            return a.get("prestador") or ""
    if mods:                       # el médico de cabecera va primero en la lista
        return (mods[0].get("asignado") or {}).get("prestador") or ""
    return ""


def evaluar(web, medico_cliente: str, beneficio: str, dni: str) -> dict:
    """Decide la cápita de un paciente.

    Devuelve {es_capita, medico_pami, error}:
      - es_capita True  -> es cápita del médico del cliente (código 427109)
      - es_capita False -> extra cápita (médico distinto o sin médico asignado)
      - es_capita None  -> no se pudo consultar (cae al comportamiento de siempre)
    """
    try:
        medico_pami = medico_cabecera_de(web, beneficio, dni)
    except Exception as e:  # noqa: BLE001
        return {"es_capita": None, "medico_pami": "", "error": str(e)}
    if not medico_pami:
        return {"es_capita": False, "medico_pami": "", "error": ""}   # sin médico = extra
    return {"es_capita": medico_coincide(medico_cliente, medico_pami),
            "medico_pami": medico_pami, "error": ""}
