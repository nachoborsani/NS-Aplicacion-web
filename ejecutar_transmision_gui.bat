@echo off
setlocal

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo ==========================================
    echo Preparando entorno por primera vez...
    echo ==========================================
    py -m venv .venv
    if errorlevel 1 goto :error
)

call ".venv\Scripts\activate.bat"
if errorlevel 1 goto :error

echo Instalando o actualizando dependencias...
python -m pip install --upgrade pip
if errorlevel 1 goto :error

python -m pip install -r requirements.txt
if errorlevel 1 goto :error

echo Verificando navegador Chromium de Playwright...
python -m playwright install chromium
if errorlevel 1 goto :error

echo.
echo Iniciando la interfaz visual de transmision...
echo.
python app_transmision.py

echo.
pause
exit /b 0

:error
echo.
echo Ocurrio un error durante la preparacion o ejecucion.
echo Revisa el mensaje anterior.
echo.
pause
exit /b 1
