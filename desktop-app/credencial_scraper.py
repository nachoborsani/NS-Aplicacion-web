import re
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from openpyxl import Workbook

from app_logging import log_message


CREDENCIAL_URL = "https://www.pami.org.ar/credencial-provisoria"
COLUMNAS_REPORTE_CREDENCIAL = [
    "benef",
    "dni",
    "tramite",
    "sexo",
    "estado",
    "archivo_pdf",
    "observaciones",
]

MAPA_SEXO = {
    "M": "m",
    "MASC": "m",
    "MASCULINO": "m",
    "F": "f",
    "FEM": "f",
    "FEMENINO": "f",
    "O": "o",
    "OTRO": "o",
}

NOMBRES_FEMENINOS_COMUNES = {
    "maria", "ana", "laura", "paula", "sofia", "lucia", "claudia", "silvia", "carla", "monica",
    "andrea", "marcela", "patricia", "adriana", "veronica", "gabriela", "cintia", "romina", "noelia",
    "cecilia", "lorena", "florencia", "alejandra", "julieta", "beatriz", "graciela", "susana", "rosa",
    "norma", "natalia", "daniela", "camila", "eliana", "valeria", "karina", "marina", "fabiana",
}

NOMBRES_MASCULINOS_COMUNES = {
    "juan", "jose", "carlos", "luis", "miguel", "jorge", "diego", "sergio", "roberto", "daniel",
    "alejandro", "ricardo", "martin", "fernando", "gustavo", "hector", "omar", "raul", "oscar",
    "alberto", "pablo", "marcelo", "eduardo", "cristian", "sebastian", "nicolas", "fabian", "julio",
    "ramon", "alfredo", "horacio", "hugo", "francisco", "walter", "emanuel", "leonardo", "enrique",
}


def normalizar_beneficio_credencial(valor: str) -> str:
    digitos = re.sub(r"\D", "", str(valor or ""))
    if len(digitos) < 13 or len(digitos) > 14:
        raise ValueError("El beneficio debe tener 13 o 14 digitos.")
    return digitos


def normalizar_dni_credencial(valor: str) -> str:
    digitos = re.sub(r"\D", "", str(valor or ""))
    if len(digitos) < 5 or len(digitos) > 8:
        raise ValueError("El DNI debe tener entre 5 y 8 digitos.")
    return digitos


def normalizar_tramite(valor: str) -> str:
    texto = str(valor or "")
    texto = texto.replace("\ufeff", "").replace("\u200b", "").strip()
    texto = re.sub(r"^[\s'\u2018\u2019\u02bc`\u00b4]+", "", texto).strip()
    digitos = re.sub(r"\D", "", texto)
    if not digitos:
        raise ValueError("El numero de tramite es obligatorio.")
    if len(digitos) > 11:
        digitos = digitos[:11]
    return digitos.zfill(11)


def normalizar_sexo(valor: str) -> tuple[str, str]:
    texto = str(valor or "").strip().upper()
    if not texto:
        raise ValueError("El sexo es obligatorio.")

    if texto not in MAPA_SEXO:
        raise ValueError("Sexo no valido. Usa MASC, FEM u OTRO.")

    valor_form = MAPA_SEXO[texto]
    etiqueta = "MASC" if valor_form == "m" else "FEM" if valor_form == "f" else "OTRO"
    return valor_form, etiqueta


def normalizar_registro_credencial(benef: str, dni: str, tramite: str, sexo: str) -> dict:
    sexo_form, sexo_etiqueta = normalizar_sexo(sexo)
    return {
        "benef": normalizar_beneficio_credencial(benef),
        "dni": normalizar_dni_credencial(dni),
        "tramite": normalizar_tramite(tramite),
        "sexo": sexo_etiqueta,
        "sexo_form": sexo_form,
    }


def inferir_sexo_desde_nombre(nombre: str) -> str:
    texto = str(nombre or "").strip()
    if not texto:
        return ""
    normalized = unicodedata.normalize("NFKD", texto.lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    tokens = [token for token in re.split(r"[^a-z]+", normalized) if token]
    if not tokens:
        return ""

    for token in tokens[:3]:
        if token in NOMBRES_FEMENINOS_COMUNES:
            return "FEM"
        if token in NOMBRES_MASCULINOS_COMUNES:
            return "MASC"

    primer = tokens[0]
    if primer.endswith(("a", "ia")) and not primer.endswith(("ma", "ta")):
        return "FEM"
    if primer.endswith(("o", "os", "or", "el", "er")):
        return "MASC"
    return ""


def _sexo_candidates(registro: dict) -> list[str]:
    explicit = str(registro.get("sexo", "")).strip().upper()
    inferred = inferir_sexo_desde_nombre(str(registro.get("nombre", "")).strip())
    ordered: list[str] = []
    for value in (explicit, inferred, "MASC", "FEM", "OTRO"):
        if not value:
            continue
        try:
            _sexo_form, normalized = normalizar_sexo(value)
        except ValueError:
            continue
        if normalized not in ordered:
            ordered.append(normalized)
    return ordered


def _descargar_credencial_pdf_intento(normalizado: dict, ruta_pdf: Path) -> tuple[bool, str]:
    payload = urlencode(
        {
            "el_afiliacion": normalizado["benef"],
            "el_dni": normalizado["dni"],
            "el_tramite": normalizado["tramite"],
            "el_genero": normalizado["sexo_form"],
        }
    ).encode("ascii")

    request = Request(
        CREDENCIAL_URL,
        data=payload,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0",
        },
        method="POST",
    )
    with urlopen(request, timeout=45) as response:
        content_type = (response.headers.get("Content-Type") or "").lower()
        body = response.read()

    if "application/pdf" not in content_type:
        return False, "El sitio no devolvio un PDF."

    ruta_pdf.write_bytes(body)
    return True, ""


def descargar_credencial_pdf(registro: dict, carpeta_destino: str | Path) -> dict:
    resultado = {
        "benef": str(registro.get("benef", "")).strip(),
        "dni": str(registro.get("dni", "")).strip(),
        "tramite": str(registro.get("tramite", "")).strip(),
        "sexo": str(registro.get("sexo", "")).strip(),
        "nombre": str(registro.get("nombre", "")).strip(),
        "estado": "",
        "archivo_pdf": "",
        "observaciones": "",
    }

    try:
        benef = normalizar_beneficio_credencial(resultado["benef"])
        dni = normalizar_dni_credencial(resultado["dni"])
        tramite = normalizar_tramite(resultado["tramite"])
    except ValueError as exc:
        resultado["estado"] = "ERROR"
        resultado["observaciones"] = str(exc)
        return resultado

    carpeta = Path(carpeta_destino)
    carpeta.mkdir(parents=True, exist_ok=True)

    nombre_archivo = _nombre_archivo_credencial(resultado["nombre"], dni, benef)
    ruta_pdf = carpeta / nombre_archivo
    sexo_candidates = _sexo_candidates(registro)
    if not sexo_candidates:
        resultado["estado"] = "ERROR"
        resultado["observaciones"] = "No se pudo determinar el sexo para pedir la credencial."
        return resultado
    errores: list[str] = []

    try:
        for sexo_candidato in sexo_candidates:
            normalizado = normalizar_registro_credencial(benef, dni, tramite, sexo_candidato)
            log_message(
                f"[credencial {normalizado['dni']}] solicitando PDF con sexo={normalizado['sexo']}..."
            )
            ok, detalle = _descargar_credencial_pdf_intento(normalizado, ruta_pdf)
            if ok:
                resultado["sexo"] = normalizado["sexo"]
                resultado["estado"] = "DESCARGADA"
                resultado["archivo_pdf"] = str(ruta_pdf.resolve())
                if str(registro.get("sexo", "")).strip() == "" and str(registro.get("nombre", "")).strip():
                    resultado["observaciones"] = f"Sexo resuelto automaticamente: {normalizado['sexo']}"
                log_message(
                    f"[credencial {normalizado['dni']}] PDF descargado correctamente en {ruta_pdf.resolve()}"
                )
                return resultado
            errores.append(f"{normalizado['sexo']}: {detalle}")
    except HTTPError as exc:
        resultado["estado"] = "ERROR"
        resultado["observaciones"] = f"HTTP {exc.code} al pedir la credencial."
        return resultado
    except URLError as exc:
        resultado["estado"] = "ERROR"
        resultado["observaciones"] = f"Error de red: {exc.reason}"
        return resultado
    except Exception as exc:
        resultado["estado"] = "ERROR"
        resultado["observaciones"] = str(exc)
        return resultado

    resultado["estado"] = "ERROR"
    resultado["observaciones"] = " | ".join(errores) if errores else "El sitio no devolvio un PDF."
    log_message(
        f"[credencial {dni}] no se pudo descargar PDF. Detalle: {resultado['observaciones']}"
    )
    return resultado


def procesar_lote_credenciales(
    registros: Iterable[dict],
    carpeta_destino: str | Path,
    progress_callback: Callable[[int, int, dict], None] | None = None,
    status_callback: Callable[[str], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> list[dict]:
    items = [item for item in registros if item]
    resultados: list[dict] = []

    if not items:
        return resultados

    total = len(items)
    if status_callback:
        status_callback("Preparando descarga de credenciales...")

    for indice, registro in enumerate(items, start=1):
        if should_cancel and should_cancel():
            if status_callback:
                status_callback("Proceso detenido por el usuario")
            break

        if status_callback:
            status_callback(f"Procesando {indice} de {total}")

        resultado = descargar_credencial_pdf(registro, carpeta_destino)
        resultados.append(resultado)

        if progress_callback:
            progress_callback(indice, total, resultado)

    if status_callback and not (should_cancel and should_cancel()):
        status_callback("Finalizado")

    return resultados


def exportar_reporte_credenciales(resultados: list[dict], ruta_excel: str | Path) -> Path:
    ruta = Path(ruta_excel)
    ruta.parent.mkdir(parents=True, exist_ok=True)

    libro = Workbook()
    hoja = libro.active
    hoja.title = "Credenciales"
    hoja.append(COLUMNAS_REPORTE_CREDENCIAL)

    for fila in resultados:
        hoja.append([fila.get(columna, "") for columna in COLUMNAS_REPORTE_CREDENCIAL])

    for columna in hoja.columns:
        ancho = max(len(str(celda.value or "")) for celda in columna) + 2
        hoja.column_dimensions[columna[0].column_letter].width = min(ancho, 48)

    libro.save(ruta)
    return ruta


def ruta_reporte_credenciales_por_defecto(carpeta_destino: str | Path) -> Path:
    carpeta = Path(carpeta_destino)
    carpeta.mkdir(parents=True, exist_ok=True)
    marca_tiempo = datetime.now().strftime("%Y%m%d_%H%M%S")
    return carpeta / f"reporte_credenciales_{marca_tiempo}.xlsx"


def _normalizar_nombre_archivo_fragmento(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").strip())
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r'[<>:"/\\|?*]+', " ", text)
    text = re.sub(r"\s+", " ", text).strip(" ._")
    return text


def _nombre_archivo_credencial(nombre: str, dni: str, benef: str) -> str:
    nombre_limpio = _normalizar_nombre_archivo_fragmento(nombre)
    if nombre_limpio:
        return f"{nombre_limpio}_{dni}.pdf"
    return f"credencial_{benef}_{dni}.pdf"
