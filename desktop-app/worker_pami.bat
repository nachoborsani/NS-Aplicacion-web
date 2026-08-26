@echo off
REM Worker de la PC para la cola de tareas NS (cabina: Auditar / Subir a PAMI).
REM Es un daemon: escucha la cola de la web y corre las tareas en PAMI.
REM Si el worker se cae por cualquier motivo, se reinicia solo a los 10 segundos.
cd /d "C:\Users\nacho\Documents\NS-Aplicacion-web\desktop-app"
set "PLAYWRIGHT_BROWSERS_PATH=%CD%\playwright-browsers"
set "PYTHONIOENCODING=utf-8"
:loop
"C:\Users\nacho\Documents\NS-Aplicacion-web\desktop-app\.venv\Scripts\python.exe" "worker_pami.py" >> "C:\Users\nacho\Documents\NS-Aplicacion-web\desktop-app\logs\worker_pami.log" 2>&1
timeout /t 10 /nobreak >nul
goto loop
