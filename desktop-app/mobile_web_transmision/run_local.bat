@echo off
setlocal
cd /d "%~dp0"

if not exist .venv (
  py -m venv .venv
)

call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt

echo.
echo Iniciando servidor web en http://0.0.0.0:8000
echo Desde tu celular podes abrir: http://IP-DE-ESTA-PC:8000
echo.

python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000
if errorlevel 1 (
  echo.
  echo El servidor se cerro por un error.
  pause
)
