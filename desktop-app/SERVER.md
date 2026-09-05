# El server headless (automatización PAMI)

> Datos de conexión (IP, puerto SSH, clave) **NO van acá**: el repo es público.
> Pedírselos a Nacho / ver las notas privadas del equipo.

## Qué es

Desde 2026-09-05 la automatización de PAMI (worker + tareas programadas) corre en un
**VPS Linux headless** (DonWeb Cloud, Ubuntu 24.04, sin escritorio). Antes corría en
la PC de Nacho por el Programador de tareas de Windows; esas tareas quedaron
**deshabilitadas** en la PC — el server es ahora el único que corre la automatización sola.

**No confundir "lo visual":**
- La **web** (`nsgestion.up.railway.app`, Railway) es la interfaz real que usan todos.
  Se actualiza sola al pushear a la rama principal. Nada de esto la afecta.
- La **GUI de escritorio** (la ventana "Suite PAMI", `app.py` con `customtkinter`) es una
  herramienta secundaria que corre en la PC de Nacho. Sirve para operar/mirar a mano.
  **En el server NO se instala** (es headless). Se actualiza solo si hacés `git pull` en
  esa PC.

## Qué corre en el server (systemd)

Todo `enabled` (arranca solo con el server):

| Unidad | Qué hace | Cuándo |
|---|---|---|
| `ns-worker.service` | Daemon: escucha la cola de la web (auditar/subir a PAMI) y la corre. Se reinicia solo. | siempre |
| `ns-bandeja-poller.timer` | Refresco on-demand (botón "Actualizar ahora" de la web) | cada 10 min |
| `ns-bandeja-refresh.timer` | `bandeja_sync.py` (bajar/refrescar bandeja mes en curso) | 20:00 |
| `ns-bandeja-retry.timer` | `bandeja_retry.py` (reintentar bandejas con error) | 22:00 |
| `ns-scheffelaar-cadena.timer` | `pipeline_scheffelaar.py` (benef→credencial→OME) | Lun/Mar 17:00 y 19:30 · Mié/Vie 12:00, 17:00 y 19:30 |
| `ns-scheffelaar-benef.timer` | `benef_sweep.py` | Lun/Mar/Mié/Vie 19:00 |

**Los horarios ahora se editan desde la web** (panel "Estado del server" → ⚙ Editar
horarios, solo admin). La web guarda el horario y el timer `ns-schedule-apply` (cada 5 min)
corre `apply_schedule.py`, que **regenera los `.timer` de arriba** con validación estricta.
⚠️ **No edites los `.timer` a mano**: en la próxima corrida de apply se sobreescriben con
lo que diga la web. Para cambiar un horario, editá en la web. `apply_schedule.py` solo
reescribe si cambió la versión (guarda la última en `desktop-app/.schedule_version`).

El worker se identifica en la web como `WORKER_ID = hostname` del server.
El código vive en `/opt/NS-Aplicacion-web` (clone del repo). El venv en
`desktop-app/.venv` (**sin `customtkinter`**, que es solo GUI). El Chromium de Playwright
está en `~/.cache/ms-playwright` (default; **no** hay carpeta `playwright-browsers` local).
La config secreta (`ns_conexion.json`, `credentials/credentials.json`, `token_sheets.json`,
etc.) está copiada a mano y **gitignoreada** — no está en el repo.

## Comandos del día a día (por SSH)

```bash
# ver el worker en vivo
journalctl -u ns-worker.service -f

# estado de todas las tareas programadas y cuándo corren
systemctl list-timers "ns-*"

# reiniciar el worker
systemctl restart ns-worker.service

# ver la última corrida de una tarea (ej. la cadena)
journalctl -u ns-scheffelaar-cadena.service -n 100 --no-pager
```

## Cómo se actualiza el código del server

Cuando alguien cambia código del `desktop-app` (worker, bots, schedulers) y lo pushea:

```bash
cd /opt/NS-Aplicacion-web && git pull
systemctl restart ns-worker.service   # solo si tocaste el worker/los bots
```

Los timers toman el código nuevo en su próxima corrida (no hace falta reiniciarlos).
Si cambian las dependencias: `desktop-app/.venv/bin/pip install -r desktop-app/requirements.txt`.
**No editar código directo en el server** — se pisa en el próximo `git pull`. Editar en el
repo, pushear, y `git pull` en el server.

## Ver un error "visualmente" (portal PAMI)

El server corre Chromium **headless** (sin ventana). Si necesitás VER el navegador
recorriendo PAMI para entender un error, hay dos caminos:

1. **La GUI de escritorio en la PC** (`ejecutar_gui.bat`) corre los mismos bots con
   `headless=False` → abre la ventana de Chromium y ves el paso a paso. Es el "cockpit
   visual". Para eso esa PC tiene que tener el código al día (`git pull`). No choca con el
   server: el worker y los schedulers de la PC están deshabilitados, y la GUI es manual.
2. **Screenshots automáticos en el server**: los bots ya guardan capturas en varios
   puntos; se puede ampliar para que ante un fallo de PAMI guarden la pantalla y quede
   accesible sin depender de la PC. (Mejora pendiente si hace falta.)

## Dar acceso SSH a otra persona

No se comparte la clave privada. La persona genera SU par de claves y pasa la **pública**:

```bash
# en la PC de la persona nueva
ssh-keygen -t ed25519 -C "su-nombre"      # crea ~/.ssh/id_ed25519(.pub)
cat ~/.ssh/id_ed25519.pub                 # ESTO es lo que manda (la .pub)
```

Y alguien con acceso la agrega en el server:

```bash
echo "ssh-ed25519 AAAA... su-nombre" >> ~/.ssh/authorized_keys
```

Desde ahí la persona entra con `ssh -p <puerto> root@<IP> -i ~/.ssh/id_ed25519`.
