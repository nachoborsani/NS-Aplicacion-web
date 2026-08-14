@echo off
setlocal

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Primero ejecuta ejecutar_gui.bat para preparar el entorno.
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

echo Generando ejecutable principal desde el archivo spec...
pyinstaller --clean "Consulta PAMI.spec"
if errorlevel 1 goto :error

if exist "build\Consulta PAMI\Consulta PAMI.exe" (
    del /q "build\Consulta PAMI\Consulta PAMI.exe"
)

echo.
echo Ejecutable listo en dist\Consulta PAMI\
echo.
start "" explorer "%cd%\dist\Consulta PAMI"
pause
exit /b 0

:error
echo.
echo Ocurrio un error al generar el ejecutable.
echo Revisa el mensaje anterior.
echo.
pause
exit /b 1
