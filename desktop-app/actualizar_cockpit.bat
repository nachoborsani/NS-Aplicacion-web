@echo off
chcp 65001 >nul
title Actualizar cockpit NS
cd /d "%~dp0.."
echo ==================================================
echo    Actualizando el cockpit NS (git pull)
echo ==================================================
echo.

REM Guarda que archivos cambian, para avisar si tocaron dependencias.
git pull --ff-only
set ERR=%errorlevel%
echo.

if not "%ERR%"=="0" (
  echo  --------------------------------------------------
  echo   NO se pudo actualizar automaticamente.
  echo.
  echo   Suele pasar si esta PC tiene cambios locales sin
  echo   guardar, o si la rama se separo de la del server.
  echo   Mira el mensaje de arriba. Si no sabes que hacer,
  echo   avisale a Nacho / al asistente antes de tocar nada.
  echo  --------------------------------------------------
  echo.
  pause
  exit /b 1
)

echo  Listo. El cockpit quedo al dia con el server.
echo.
echo  Si en los cambios aparecio "requirements.txt", corre
echo  una vez esto para actualizar las dependencias:
echo.
echo     desktop-app\.venv\Scripts\python.exe -m pip install -r desktop-app\requirements.txt
echo.
pause
