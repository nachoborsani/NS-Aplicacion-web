import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import parse_qs, urljoin, urlparse

from openpyxl import Workbook
from playwright.sync_api import Browser, BrowserContext, Page, Playwright, TimeoutError, sync_playwright

from app_logging import log_message
from app_paths import get_errors_dir, get_output_dir, get_resource_path
from app_settings import DEFAULT_MEDICOS, get_medico_default


PAMI_URL = "https://prestadores.pami.org.ar/result.php?c=6-2&vm=2"
CARTILLA_LOGIN_URL = "https://www.pami.org.ar/mi-cartilla/login"
CARTILLA_SERVICIO_URL = "https://www.pami.org.ar/mi-cartilla/buscar-servicio-medico"
MEDICO_CAPITA = DEFAULT_MEDICOS[0]
COLUMNAS_SALIDA = [
    "numero_original",
    "numero_base",
    "beneficio_encontrado",
    "nombre_afiliado",
    "medico_cabecera",
    "clasificacion",
    "observaciones",
]
MODO_BENEFICIO = "beneficio"
MODO_DNI = "dni"
FUENTE_CARTILLA = "cartilla_medica"
FUENTE_PADRON = "padron_prestadores"


def configurar_playwright() -> None:
    carpeta_navegadores = get_resource_path("playwright-browsers")
    if carpeta_navegadores.exists():
        import os

        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(carpeta_navegadores)
        log_message(f"PLAYWRIGHT_BROWSERS_PATH configurado en {carpeta_navegadores}")


@dataclass
class SesionPami:
    playwright: Playwright
    browser: Browser
    context: BrowserContext
    page: Page


def normalizar_beneficio(numero: str) -> str:
    digitos = re.sub(r"\D", "", str(numero or ""))

    if not digitos:
        raise ValueError("No contiene digitos.")

    if len(digitos) >= 13:
        return digitos[:-2]

    if len(digitos) == 12:
        return digitos

    raise ValueError(
        "Formato no valido. Se esperaba un numero de 14 digitos, uno de 13 digitos, o un numero base de 12 digitos."
    )


def normalizar_dni(numero: str) -> str:
    digitos = re.sub(r"\D", "", str(numero or ""))

    if not digitos:
        raise ValueError("No contiene digitos.")

    if len(digitos) < 7 or len(digitos) > 11:
        raise ValueError("Formato de DNI no valido. Ingresa un documento con 7 a 11 digitos.")

    return digitos


def normalizar_beneficio_cartilla(numero: str) -> str:
    digitos = re.sub(r"\D", "", str(numero or ""))

    if not digitos:
        raise ValueError("No contiene digitos.")

    if len(digitos) != 14:
        raise ValueError("Para Cartilla medica el beneficio debe tener 14 digitos completos.")

    return digitos


def iniciar_sesion(headless: bool = False) -> SesionPami:
    configurar_playwright()
    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(headless=headless)
    context = browser.new_context(ignore_https_errors=True)
    page = context.new_page()
    page.set_default_timeout(20000)
    return SesionPami(playwright=playwright, browser=browser, context=context, page=page)


def cerrar_sesion(sesion: SesionPami) -> None:
    sesion.context.close()
    sesion.browser.close()
    sesion.playwright.stop()


def _crear_contexto_y_pagina(browser: Browser) -> tuple[BrowserContext, Page]:
    context = browser.new_context(ignore_https_errors=True)
    page = context.new_page()
    page.set_default_timeout(20000)
    return context, page


def procesar_afiliado(
    numero_original: str,
    page: Page,
    modo_busqueda: str = MODO_BENEFICIO,
    medico_objetivo: str | None = None,
    fuente_consulta: str = FUENTE_PADRON,
) -> dict:
    medico_objetivo = (medico_objetivo or "").strip() or get_medico_default()
    resultado = {
        "numero_original": str(numero_original or "").strip(),
        "numero_base": "",
        "beneficio_encontrado": "",
        "nombre_afiliado": "",
        "medico_cabecera": "",
        "clasificacion": "",
        "observaciones": "",
    }

    observaciones = []

    if fuente_consulta == FUENTE_CARTILLA:
        return _procesar_afiliado_cartilla(
            numero_original=numero_original,
            page=page,
            medico_objetivo=medico_objetivo,
        )

    try:
        valor_busqueda = _normalizar_valor_busqueda(numero_original, modo_busqueda)
        parent_objetivo = _obtener_parent_objetivo(numero_original, modo_busqueda)
        if modo_busqueda == MODO_BENEFICIO:
            resultado["numero_base"] = valor_busqueda
    except ValueError as exc:
        resultado["clasificacion"] = "NO ENCONTRADO"
        resultado["observaciones"] = str(exc)
        return resultado

    try:
        _log_paso(numero_original, "abriendo padron")
        page.goto(PAMI_URL, wait_until="domcontentloaded")
        formulario = _obtener_formulario(page, modo_busqueda)
        formulario.wait_for(state="visible")
        _esperar_input_formulario(formulario, modo_busqueda)
        _pausa_debug(page)

        _log_paso(numero_original, _texto_busqueda_log(modo_busqueda, valor_busqueda))
        _completar_formulario_busqueda(formulario, valor_busqueda, modo_busqueda)
        captcha_resuelto = _resolver_captcha(formulario, modo_busqueda)
        _completar_captcha(formulario, captcha_resuelto, modo_busqueda)
        _pausa_debug(page)

        with page.expect_navigation(wait_until="domcontentloaded"):
            formulario.locator("button.btn_buscar").click()
        _pausa_debug(page)

        texto_pagina = _texto_pagina(page)
        cantidad_resultados = _extraer_cantidad_resultados(texto_pagina)
        _log_paso(numero_original, f"resultados encontrados: {cantidad_resultados}")
        if "0 Registro/s encontrado/s" in texto_pagina:
            resultado["clasificacion"] = "NO ENCONTRADO"
            return resultado

        if modo_busqueda == MODO_DNI:
            resultados_dni = _leer_resultados_dni(page)
            beneficios_distintos = {item["beneficio_completo"] for item in resultados_dni if item["beneficio_completo"]}
            if len(beneficios_distintos) > 1:
                resultado.update(
                    _procesar_multiples_resultados_dni(
                        page,
                        resultados_dni,
                        medico_objetivo,
                        numero_original,
                    )
                )
                return resultado
            resultado["beneficio_encontrado"] = _leer_beneficio_completo_resultado(page, parent_objetivo)

        enlace_detalle = _buscar_enlace_detalle(page, parent_objetivo)
        if enlace_detalle is None:
            resultado["clasificacion"] = "NO ENCONTRADO"
            if parent_objetivo:
                observaciones.append(f"No se encontro enlace al detalle para grado parent {parent_objetivo}.")
            else:
                observaciones.append("No se encontro enlace al detalle del titular.")
            resultado["observaciones"] = " ".join(observaciones)
            return resultado

        _log_paso(numero_original, "abriendo detalle")
        with page.expect_navigation(wait_until="domcontentloaded"):
            enlace_detalle.click()
        _pausa_debug(page)

        _log_paso(numero_original, "leyendo nombre")
        nombre_afiliado = _leer_nombre_afiliado(page)
        _pausa_debug(page)

        _log_paso(numero_original, "leyendo medico")
        medico_cabecera = _leer_medico_cabecera(page)
        _pausa_debug(page)

        _log_paso(numero_original, "clasificando")
        clasificacion = _clasificar_medico(medico_cabecera, medico_objetivo)

        resultado["nombre_afiliado"] = nombre_afiliado
        resultado["medico_cabecera"] = medico_cabecera
        resultado["clasificacion"] = clasificacion

        if not nombre_afiliado:
            observaciones.append("No se pudo leer el nombre del afiliado.")

        if clasificacion == "SIN MÉDICO ASIGNADO":
            observaciones.append("El sitio no mostro un prestador valido en Medico de Cabecera.")

    except TimeoutError:
        resultado["clasificacion"] = "NO ENCONTRADO"
        observaciones.append("Tiempo de espera agotado al consultar el sitio de PAMI.")
        evidencia = _guardar_evidencia_error(page, numero_original, "timeout")
        if evidencia:
            observaciones.append(f"Evidencia guardada en {evidencia}")
    except Exception as exc:
        resultado["clasificacion"] = "NO ENCONTRADO"
        observaciones.append(f"Error al procesar: {exc}")
        evidencia = _guardar_evidencia_error(page, numero_original, "error")
        if evidencia:
            observaciones.append(f"Evidencia guardada en {evidencia}")

    resultado["observaciones"] = " ".join(observaciones).strip()
    return resultado


def procesar_lote(
    beneficios: Iterable[str],
    headless: bool = False,
    modo_busqueda: str = MODO_BENEFICIO,
    medico_objetivo: str | None = None,
    fuente_consulta: str = FUENTE_PADRON,
    progress_callback: Callable[[int, int, dict], None] | None = None,
    status_callback: Callable[[str], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> list[dict]:
    medico_objetivo = (medico_objetivo or "").strip() or get_medico_default()
    beneficios_limpios = [str(item).strip() for item in beneficios if str(item).strip()]
    resultados: list[dict] = []

    if not beneficios_limpios:
        return resultados

    if status_callback:
        status_callback("Preparando navegador...")

    sesion = iniciar_sesion(headless=headless)
    try:
        total = len(beneficios_limpios)
        for indice, beneficio in enumerate(beneficios_limpios, start=1):
            if should_cancel and should_cancel():
                if status_callback:
                    status_callback("Proceso detenido por el usuario")
                break

            if status_callback:
                status_callback(f"Procesando {indice} de {total}")

            etiqueta = _etiqueta_log_consulta(fuente_consulta, modo_busqueda)
            print(f"[{indice}/{total}] Procesando {etiqueta}: {beneficio}")

            if fuente_consulta == FUENTE_CARTILLA:
                context, page = _crear_contexto_y_pagina(sesion.browser)
                try:
                    resultado = procesar_afiliado(
                        beneficio,
                        page,
                        modo_busqueda=modo_busqueda,
                        medico_objetivo=medico_objetivo,
                        fuente_consulta=fuente_consulta,
                    )
                finally:
                    context.close()
            else:
                resultado = procesar_afiliado(
                    beneficio,
                    sesion.page,
                    modo_busqueda=modo_busqueda,
                    medico_objetivo=medico_objetivo,
                    fuente_consulta=fuente_consulta,
                )
            resultados.append(resultado)
            print(
                f"[{indice}/{total}] Resultado: {resultado['clasificacion']}"
                + (f" | {resultado['nombre_afiliado']}" if resultado["nombre_afiliado"] else "")
            )

            if progress_callback:
                progress_callback(indice, total, resultado)
    finally:
        cerrar_sesion(sesion)

    if status_callback and not (should_cancel and should_cancel()):
        status_callback("Finalizado")

    return resultados


def exportar_resultados(
    resultados: list[dict],
    carpeta_salida: str | Path = "salidas",
    ruta_excel: str | Path | None = None,
) -> Path:
    if ruta_excel is not None:
        ruta_excel = Path(ruta_excel)
        ruta_excel.parent.mkdir(parents=True, exist_ok=True)
    else:
        carpeta = Path(carpeta_salida) if carpeta_salida != "salidas" else get_output_dir()
        carpeta.mkdir(parents=True, exist_ok=True)
        marca_tiempo = datetime.now().strftime("%Y%m%d_%H%M%S")
        ruta_excel = carpeta / f"resultados_pami_{marca_tiempo}.xlsx"

    libro = Workbook()
    hoja = libro.active
    hoja.title = "Resultados"
    hoja.append(COLUMNAS_SALIDA)

    for fila in resultados:
        hoja.append([fila.get(columna, "") for columna in COLUMNAS_SALIDA])

    for columna in hoja.columns:
        ancho = max(len(str(celda.value or "")) for celda in columna) + 2
        hoja.column_dimensions[columna[0].column_letter].width = min(ancho, 40)

    libro.save(ruta_excel)
    return ruta_excel


def _log_paso(numero_original: str, mensaje: str) -> None:
    log_message(f"[{numero_original}] {mensaje}...")


def _pausa_debug(page: Page, milisegundos: int = 700) -> None:
    page.wait_for_timeout(milisegundos)


def _extraer_cantidad_resultados(texto_pagina: str) -> str:
    coincidencia = re.search(r"(\d+)\s+Registro/s encontrado/s", texto_pagina, re.IGNORECASE)
    if coincidencia:
        return coincidencia.group(1)
    return "desconocido"


def _guardar_evidencia_error(page: Page, numero_original: str, motivo: str) -> str:
    carpeta = get_errors_dir()

    marca_tiempo = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_segura = _nombre_seguro(f"{numero_original}_{motivo}_{marca_tiempo}")
    ruta_html = carpeta / f"{base_segura}.html"
    ruta_png = carpeta / f"{base_segura}.png"

    guardados = []

    try:
        ruta_html.write_text(page.content(), encoding="utf-8")
        guardados.append(str(ruta_html.resolve()))
    except Exception:
        pass

    try:
        page.screenshot(path=str(ruta_png), full_page=True)
        guardados.append(str(ruta_png.resolve()))
    except Exception:
        pass

    return " | ".join(guardados)


def _nombre_seguro(texto: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", texto).strip("_") or "error"


def _normalizar_valor_busqueda(valor_original: str, modo_busqueda: str) -> str:
    if modo_busqueda == MODO_DNI:
        return normalizar_dni(valor_original)
    return normalizar_beneficio(valor_original)


def _etiqueta_log_consulta(fuente_consulta: str, modo_busqueda: str) -> str:
    if fuente_consulta == FUENTE_CARTILLA:
        return "beneficio,dni"
    return "DNI" if modo_busqueda == MODO_DNI else "beneficio"


def _procesar_afiliado_cartilla(
    numero_original: str,
    page: Page,
    medico_objetivo: str,
) -> dict:
    resultado = {
        "numero_original": str(numero_original or "").strip(),
        "numero_base": "",
        "beneficio_encontrado": "",
        "nombre_afiliado": "",
        "medico_cabecera": "",
        "clasificacion": "",
        "observaciones": "",
    }
    observaciones = []

    try:
        beneficio, dni = _parsear_entrada_cartilla(numero_original)
        resultado["numero_original"] = beneficio
        resultado["numero_base"] = beneficio
        resultado["beneficio_encontrado"] = beneficio
    except ValueError as exc:
        resultado["clasificacion"] = "NO ENCONTRADO"
        resultado["observaciones"] = str(exc)
        return resultado

    try:
        _log_paso(numero_original, "abriendo cartilla medica")
        page.goto(CARTILLA_LOGIN_URL, wait_until="domcontentloaded")
        _pausa_debug(page)

        _log_paso(numero_original, f"validando afiliado con beneficio {beneficio} y DNI {dni}")
        _completar_login_cartilla(page, beneficio, dni)
        with page.expect_navigation(wait_until="domcontentloaded"):
            page.get_by_role("button", name="Continuar").click()
        _pausa_debug(page)

        resultado["nombre_afiliado"] = _leer_nombre_cartilla_inicio(page)

        _log_paso(numero_original, "abriendo busqueda por servicio medico")
        page.goto(CARTILLA_SERVICIO_URL, wait_until="domcontentloaded")
        _pausa_debug(page)

        _completar_filtros_cartilla(page)
        _log_paso(numero_original, "buscando profesional asignado")
        boton_buscar = page.get_by_role("button", name=re.compile("Buscar", re.IGNORECASE)).first
        with page.expect_navigation(wait_until="domcontentloaded"):
            boton_buscar.click()
        _pausa_debug(page)

        _log_paso(numero_original, "leyendo medico")
        medico_cabecera = _leer_medico_cartilla_resultado(page)
        clasificacion = _clasificar_medico(medico_cabecera, medico_objetivo)

        resultado["medico_cabecera"] = medico_cabecera
        resultado["clasificacion"] = clasificacion
        if not resultado["nombre_afiliado"]:
            resultado["nombre_afiliado"] = _leer_nombre_cartilla_resultado(page)

        if not resultado["nombre_afiliado"]:
            observaciones.append("No se pudo leer el nombre del afiliado desde Cartilla medica.")
        if clasificacion == "SIN MÃ‰DICO ASIGNADO":
            observaciones.append("Cartilla medica no devolvio un profesional asignado.")
    except TimeoutError:
        resultado["clasificacion"] = "NO ENCONTRADO"
        observaciones.append("Tiempo de espera agotado al consultar Cartilla medica.")
        evidencia = _guardar_evidencia_error(page, numero_original, "timeout_cartilla")
        if evidencia:
            observaciones.append(f"Evidencia guardada en {evidencia}")
    except Exception as exc:
        resultado["clasificacion"] = "NO ENCONTRADO"
        observaciones.append(f"Error al procesar: {exc}")
        evidencia = _guardar_evidencia_error(page, numero_original, "error_cartilla")
        if evidencia:
            observaciones.append(f"Evidencia guardada en {evidencia}")

    resultado["observaciones"] = " ".join(observaciones).strip()
    return resultado


def _parsear_entrada_cartilla(numero_original: str) -> tuple[str, str]:
    texto = str(numero_original or "").strip()
    if not texto:
        raise ValueError("Ingresa un beneficio y un DNI para usar Cartilla medica.")

    partes = [parte.strip() for parte in re.split(r"[,\t;|]", texto) if parte.strip()]
    if len(partes) < 2:
        raise ValueError("Para Cartilla medica usa una fila por paciente con formato: beneficio,dni")

    beneficio = normalizar_beneficio_cartilla(partes[0])
    dni = normalizar_dni(partes[1])
    return beneficio, dni


def _completar_login_cartilla(page: Page, beneficio: str, dni: str) -> None:
    input_beneficio = page.locator("#n_beneficio")
    input_documento = page.locator("#n_documento")

    if input_beneficio.count() == 0 or input_documento.count() == 0:
        raise RuntimeError("No se encontraron los campos de acceso de Cartilla medica.")

    input_beneficio.fill(beneficio)
    input_documento.fill(dni)


def _leer_nombre_cartilla_inicio(page: Page) -> str:
    candidatos = [
        page.locator(".h5_responsive").first,
        page.locator("h5").first,
        page.locator("main h2").nth(0),
        page.locator("h2").nth(0),
        page.locator("xpath=//*[contains(normalize-space(), 'Mi cartilla médica')]/following::*[self::h1 or self::h2][1]").first,
    ]
    for locator in candidatos:
        texto = _texto_normalizado(locator)
        if texto and _normalizar_texto_comparable(texto) != "MI CARTILLA MEDICA":
            return texto
    return ""


def _completar_filtros_cartilla(page: Page) -> None:
    selects = page.locator("select")
    if selects.count() < 2:
        raise RuntimeError("No se encontraron los filtros de servicio medico en Cartilla medica.")
    selects.nth(0).select_option(label="Médica o Médico de Cabecera")
    _pausa_debug(page, 400)
    selects = page.locator("select")
    selects.nth(1).select_option(label="Médico o médica de cabecera")
    _pausa_debug(page, 400)


def _leer_medico_cartilla_resultado(page: Page) -> str:
    if page.locator("#sin-resultados-capitado").count():
        estilo = (page.locator("#sin-resultados-capitado").first.get_attribute("style") or "").lower()
        if "display: none" not in estilo:
            return ""

    posibles = [
        page.locator(".resultado-card--titulo").first,
        page.locator("xpath=//*[contains(normalize-space(), 'Profesional/es o centro/s de salud asignado/s')]/following::*[contains(@class, 'resultado-card--titulo')][1]").first,
        page.locator("h3").first,
        page.locator("h2").nth(1),
        page.locator("xpath=//*[contains(normalize-space(), 'Profesional/es o centro/s de salud asignado/s')]/following::*[self::h2 or self::h3][1]").first,
    ]
    for locator in posibles:
        texto = _texto_normalizado(locator)
        if texto and "PROFESIONAL/ES O CENTRO/S DE SALUD ASIGNADO/S" not in _normalizar_texto_comparable(texto):
            return texto
    return ""


def _leer_nombre_cartilla_resultado(page: Page) -> str:
    candidatos = [
        page.locator(".h5_responsive").first,
        page.locator("h5").first,
        page.locator("xpath=//main//*[contains(normalize-space(), 'Mi cartilla médica')]/following::*[self::h2 or self::h3][1]").first,
        page.locator("h2").first,
    ]
    for locator in candidatos:
        texto = _texto_normalizado(locator)
        if texto and _normalizar_texto_comparable(texto) != "MI CARTILLA MEDICA":
            return texto
    return ""


def _obtener_parent_objetivo(valor_original: str, modo_busqueda: str) -> str:
    if modo_busqueda != MODO_BENEFICIO:
        return "00"

    digitos = re.sub(r"\D", "", str(valor_original or ""))
    if len(digitos) >= 13:
        return digitos[-2:]

    if len(digitos) == 12:
        return "00"

    return ""


def _obtener_formulario(page: Page, modo_busqueda: str):
    if modo_busqueda == MODO_DNI:
        return page.locator("form#form2")
    return page.locator("form#form1")


def _esperar_input_formulario(formulario, modo_busqueda: str) -> None:
    if modo_busqueda == MODO_DNI:
        formulario.locator("input[name='nroDocumento']").wait_for(state="visible")
        return
    formulario.locator("input[name='nroBeneficio']").wait_for(state="visible")


def _completar_formulario_busqueda(formulario, valor_busqueda: str, modo_busqueda: str) -> None:
    if modo_busqueda == MODO_DNI:
        formulario.locator("select[name='tipoDocumento']").select_option("DNI")
        formulario.locator("input[name='nroDocumento']").fill(valor_busqueda)
        return
    formulario.locator("input[name='nroBeneficio']").fill(valor_busqueda)


def _resolver_captcha(formulario, modo_busqueda: str) -> str:
    total_id = "#totalSuma2" if modo_busqueda == MODO_DNI else "#totalSuma1"
    total = formulario.locator(total_id)
    if total.count() > 0:
        valor = total.get_attribute("value")
        if valor and valor.strip():
            return valor.strip()

    captcha_visible = formulario.locator("input[name='captchaImage']").input_value()
    numeros = [int(numero) for numero in re.findall(r"\d+", captcha_visible)]
    if len(numeros) >= 2:
        return str(sum(numeros[:2]))

    raise RuntimeError("No se pudo resolver la verificacion matematica.")


def _completar_captcha(formulario, captcha_resuelto: str, modo_busqueda: str) -> None:
    input_name = "math2" if modo_busqueda == MODO_DNI else "math1"
    formulario.locator(f"input[name='{input_name}']").fill(captcha_resuelto)


def _texto_busqueda_log(modo_busqueda: str, valor_busqueda: str) -> str:
    if modo_busqueda == MODO_DNI:
        return f"buscando DNI {valor_busqueda}"
    return f"buscando beneficio base {valor_busqueda}"


def _buscar_enlace_detalle(page: Page, parent_objetivo: str = "00"):
    if parent_objetivo:
        enlace_objetivo = page.locator(f"a[href*='c=6-2-1-1'][href*='parent={parent_objetivo}']").first
        if enlace_objetivo.count() > 0:
            return enlace_objetivo

    enlace_titular = page.locator("a[href*='c=6-2-1-1'][href*='parent=00']").first
    if enlace_titular.count() > 0:
        return enlace_titular

    enlace_generico = page.locator("a[href*='c=6-2-1-1']").first
    if enlace_generico.count() > 0:
        return enlace_generico

    return None


def _leer_beneficio_completo_resultado(page: Page, parent_objetivo: str = "00") -> str:
    enlace = _buscar_enlace_detalle(page, parent_objetivo)
    if enlace is None or enlace.count() == 0:
        return ""

    href = enlace.get_attribute("href") or ""
    if not href:
        return ""

    parsed = urlparse(href)
    query = parse_qs(parsed.query)
    beneficio = (query.get("beneficio") or [""])[0].strip()
    parent = (query.get("parent") or [""])[0].strip()

    if beneficio and parent:
        return f"{beneficio}{parent}"

    return beneficio


def _leer_resultados_dni(page: Page) -> list[dict]:
    enlaces = page.locator("a[href*='c=6-2-1-1']")
    resultados: list[dict] = []
    total = enlaces.count()

    for index in range(total):
        enlace = enlaces.nth(index)
        href = enlace.get_attribute("href") or ""
        if not href:
            continue

        parsed = urlparse(href)
        query = parse_qs(parsed.query)
        beneficio = (query.get("beneficio") or [""])[0].strip()
        parent = (query.get("parent") or [""])[0].strip()
        beneficio_completo = f"{beneficio}{parent}" if beneficio and parent else beneficio

        fila = enlace.locator("xpath=ancestor::tr[1]")
        afiliado = ""
        if fila.count() > 0:
            afiliado = _texto_normalizado(fila.locator("td").nth(0))

        resultados.append(
            {
                "afiliado": afiliado,
                "beneficio": beneficio,
                "parent": parent,
                "beneficio_completo": beneficio_completo,
                "href": href,
            }
        )

    return resultados


def _procesar_multiples_resultados_dni(
    page: Page,
    resultados_dni: list[dict],
    medico_objetivo: str,
    numero_original: str,
) -> dict:
    pagina_resultados_url = page.url
    detalles = []

    for index, item in enumerate(resultados_dni, start=1):
        href = str(item.get("href", "")).strip()
        if not href:
            continue

        url_detalle = urljoin(pagina_resultados_url, href)
        _log_paso(numero_original, f"abriendo detalle multiple {index}")
        page.goto(url_detalle, wait_until="domcontentloaded")
        _pausa_debug(page)

        nombre_afiliado = _leer_nombre_afiliado(page) or str(item.get("afiliado", "")).strip()
        medico_cabecera = _leer_medico_cabecera(page)
        clasificacion = _clasificar_medico(medico_cabecera, medico_objetivo)

        detalles.append(
            {
                "beneficio_encontrado": str(item.get("beneficio_completo", "")).strip(),
                "nombre_afiliado": nombre_afiliado,
                "medico_cabecera": medico_cabecera or "SIN MEDICO",
                "clasificacion": clasificacion,
            }
        )

    detalle_capita = next((detalle for detalle in detalles if _es_clasificacion_capita(detalle["clasificacion"])), None)
    if detalle_capita is not None:
        return {
            "beneficio_encontrado": detalle_capita["beneficio_encontrado"],
            "nombre_afiliado": detalle_capita["nombre_afiliado"],
            "medico_cabecera": detalle_capita["medico_cabecera"],
            "clasificacion": detalle_capita["clasificacion"],
            "observaciones": (
                f"Se encontraron {len(detalles)} beneficios distintos para el mismo DNI. "
                "Se priorizo el beneficio clasificado como CAPITA."
            ),
        }

    beneficios = [detalle["beneficio_encontrado"] for detalle in detalles]
    nombres = [detalle["nombre_afiliado"] for detalle in detalles]
    medicos = [detalle["medico_cabecera"] for detalle in detalles]
    clasificaciones = [detalle["clasificacion"] for detalle in detalles]
    cantidad = len([benef for benef in beneficios if benef])
    observaciones = f"Se encontraron {cantidad} beneficios distintos para el mismo DNI."

    return {
        "beneficio_encontrado": " // ".join(beneficios),
        "nombre_afiliado": " // ".join(nombres),
        "medico_cabecera": " // ".join(medicos),
        "clasificacion": " // ".join(clasificaciones),
        "observaciones": observaciones,
    }


def _leer_nombre_afiliado(page: Page) -> str:
    return _texto_normalizado(
        page.locator(
            "xpath=//td[p[contains(normalize-space(), 'APELLIDO Y NOMBRE:')]]/following-sibling::td[1]//p"
        ).first
    )


def _leer_medico_cabecera(page: Page) -> str:
    texto = _texto_normalizado(
        page.locator(
            "xpath=//table[.//strong[contains(normalize-space(), 'MEDICO DE CABECERA')]]"
            "//td[p[normalize-space()='PRESTADOR:']]/following-sibling::td[1]//p"
        ).first
    )

    texto_mayusculas = texto.upper()
    if not texto_mayusculas or texto_mayusculas in {"-", "SIN ASIGNAR", "SIN MEDICO", "SIN MEDICO."}:
        return ""

    return texto


def _clasificar_medico(medico_cabecera: str, medico_objetivo: str = MEDICO_CAPITA) -> str:
    if not medico_cabecera.strip():
        return "SIN MÉDICO ASIGNADO"

    if _normalizar_texto_comparable(medico_cabecera) == _normalizar_texto_comparable(medico_objetivo):
        return "CÁPITA"

    return "EXTRACÁPITA"


def _es_clasificacion_capita(clasificacion: str) -> bool:
    return _normalizar_texto_comparable(clasificacion) == "CAPITA"


def _texto_normalizado(locator) -> str:
    try:
        if locator.count() == 0:
            return ""
        texto = locator.text_content() or ""
        return " ".join(texto.split()).strip()
    except Exception:
        return ""


def _texto_pagina(page: Page) -> str:
    return " ".join((page.locator("body").text_content() or "").split())


def _normalizar_texto_comparable(texto: str) -> str:
    reemplazos = str.maketrans(
        {
            "Á": "A",
            "É": "E",
            "Í": "I",
            "Ó": "O",
            "Ú": "U",
            "á": "A",
            "é": "E",
            "í": "I",
            "ó": "O",
            "ú": "U",
        }
    )
    return " ".join(texto.translate(reemplazos).upper().split())
