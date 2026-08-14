@echo off
setlocal

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Primero ejecuta ejecutar_transmision_gui.bat para preparar el entorno.
    pause
    exit /b 1
)

call ".venv\Scripts\activate.bat"
if errorlevel 1 goto :error

echo Instalando PyInstaller...
python -m pip install pyinstaller
if errorlevel 1 goto :error

echo Instalando Chromium portable para Playwright...
set "PLAYWRIGHT_BROWSERS_PATH=%cd%\playwright-browsers"
python -m playwright install chromium
if errorlevel 1 goto :error

echo Generando ejecutable de transmision...
pyinstaller --noconsole --windowed --name "Transmision PAMI" --onedir --clean --noupx --collect-all customtkinter --collect-data openpyxl --collect-data playwright --collect-binaries playwright --add-data "playwright-browsers;playwright-browsers" app_transmision.py
if errorlevel 1 goto :error

echo.
echo Ejecutable listo en dist\Transmision PAMI\
echo.
pause
exit /b 0

:error
echo.
echo Ocurrio un error al generar el ejecutable.
echo Revisa el mensaje anterior.
echo.
pause
exit /b 1
