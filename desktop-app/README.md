# Suite PAMI Desktop App

Aplicación de escritorio en Windows para trabajar con varios módulos de PAMI desde una sola interfaz:

- consulta de padrón
- descarga de credenciales provisorias
- transmisión automática
- generación de OME
- activación de OME

La app usa Python + CustomTkinter para la interfaz y Playwright para automatizar el navegador visible cuando hace falta.

## Módulos incluidos

### Consulta de padrón

Permite:

- buscar por `beneficio` o por `DNI`
- clasificar por médico de cabecera
- revisar resultados en pantalla
- copiar datos puntuales
- guardar el resultado final en Excel

Archivo principal:

- `padron_module.py`

Motor:

- `pami_scraper.py`

### Credencial provisoria

Permite:

- cargar datos manualmente o por lote
- generar credenciales provisorias en PDF
- abrir PDFs desde la tabla
- guardar un reporte Excel

Archivo principal:

- `credencial_module.py`

Motor:

- `credencial_scraper.py`

### Transmisión automática

Permite:

- guardar perfiles con `cliente`, `usuario` y `clave`
- abrir PAMI visible
- autocompletar login
- aplicar filtros automáticos opcionales
- ejecutar el bot de transmisión
- ver el estado en vivo del proceso

Archivos principales:

- `app_transmision.py`
- `pami_transmision.py`

### Generar OME

Permite:

- guardar perfiles médicos
- abrir CUP
- autocompletar login
- cargar BENEF o DNI por lote
- definir diagnóstico y práctica
- ejecutar lotes de OME
- ver resultados y números de OME
- exportar a Excel

Archivos principales:

- `app_ome.py`
- `pami_ome.py`
- `pami_ome_generator.py`

### Activar OME

Permite:

- abrir el panel correspondiente
- preparar turnos por lote
- automatizar la activación

Archivos principales:

- `app_activar.py`
- `pami_activar.py`

### Validacion OME (BETA)

Permite preparar la futura automatizacion de validacion con app Android:

- guardar configuracion base de dispositivo Android
- registrar paquete/activity de la app cuando se identifiquen
- cargar BENEF y numero de OME para pruebas
- reservar acciones para probar conexion, abrir app PAMI y validar QR

Archivo principal:

- `app_validacion.py`

## Estructura principal del proyecto

- `app.py`: app principal integrada
- `app_transmision.py`: interfaz visual del módulo de transmisión
- `app_ome.py`: interfaz visual del módulo de generación de OME
- `app_activar.py`: interfaz visual del módulo de activación
- `padron_module.py`: interfaz visual del padrón
- `credencial_module.py`: interfaz visual de credenciales
- `pami_transmision.py`: motor de automatización de transmisión
- `pami_ome.py`: helpers de automatización para OME
- `pami_ome_generator.py`: ejecución por lote de OME
- `pami_scraper.py`: motor del padrón
- `excel_models.py`: plantillas y salidas Excel
- `app_paths.py`: rutas de trabajo
- `app_logging.py`: utilidades de log
- `main.py`: modo consola heredado

## Requisitos

En Windows:

1. Tener Python instalado.
2. Tener acceso a internet la primera vez para instalar Chromium de Playwright.

Para verificar Python:

```bat
py --version
```

## Cómo ejecutar la app principal

La forma recomendada es:

1. Abrir `ejecutar_gui.bat`
2. Esperar la preparación inicial si es la primera vez
3. Elegir el módulo desde la pantalla principal

También se puede ejecutar con:

```bat
python app.py
```

## Cómo ejecutar solo Transmisión

Si quieres abrir únicamente ese módulo:

1. Ejecuta `ejecutar_transmision_gui.bat`

También puedes correr:

```bat
python app_transmision.py
```

## Flujo actual de Transmisión

La app de transmisión hoy funciona así:

1. Elegir o guardar un perfil.
2. Revisar `cliente`, `usuario` y `clave`.
3. Usar `Abrir PAMI`.
4. Si hace falta, dejar que la app autocomplemente el login.
5. Entrar a la pantalla `Transmisión`.
6. Opcionalmente definir en la app:
   - `Fecha desde`
   - `Fecha hasta`
   - `Validada`
   - `Transmitida`
7. Iniciar el bot.

Notas:

- `Fecha desde` y `Fecha hasta` usan selector visual de fecha.
- `Validada` y `Transmitida` son opcionales y pueden quedar vacíos.
- el estado del bot se actualiza en vivo dentro de la app
- la app guarda `última boteada` por perfil

## Flujo actual de Generar OME

1. Elegir o guardar un perfil.
2. Abrir CUP.
3. Autocompletar login si corresponde.
4. Definir modo de carga.
5. Pegar BENEF o DNI por columna.
6. Pegar diagnósticos y prácticas.
7. Cargar la grilla.
8. Ejecutar el lote.
9. Copiar OME o exportar Excel.

## Carpetas de trabajo

Durante el uso normal, la app trabaja con:

- `logs/`
- `salidas/`
- `errores/`

En modo `.exe`, la app puede usar la carpeta de datos resuelta por `app_paths.py`, normalmente bajo `%LOCALAPPDATA%`.

## Logs

Log principal:

- `logs/consulta_pami.log`

Se usa para:

- seguimiento de automatizaciones
- errores del navegador
- detalle técnico de ejecución

## Compilación del ejecutable

### App completa

Usa:

- `build_exe.bat`

Salida esperada:

- `dist\Consulta PAMI\Consulta PAMI.exe`

### Solo Transmisión

Usa:

- `build_transmision_exe.bat`

## Recomendaciones para Playwright

- preferir distribución `--onedir` y no `--onefile`
- mantener la carpeta `playwright-browsers`
- instalar Chromium antes de empaquetar
- distribuir la carpeta completa generada en `dist`

Instalación manual si hace falta:

```bat
python -m playwright install chromium
```

## Archivos de perfiles

Perfiles guardados por módulo:

- `usuarios_transmision.json`
- `usuarios_ome.json`

## Estado actual del proyecto

La app está pensada como suite integrada. El flujo principal recomendado hoy es usar `app.py` como entrada y abrir cada módulo desde ahí.
