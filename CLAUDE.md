# NS Aplicación Web — CLAUDE.md

Contexto para trabajar en este repo. Léelo antes de tocar código.
(El `README.md` está desactualizado: describe la web como "futura" — ya está en producción.)

## Qué es

Monorepo de la Suite NS/PAMI:
- **`web/`** — la aplicación web, **en producción** en `nsgestion.up.railway.app` (Railway).
  La usan NS y los centros médicos (clientes): cabina de informes, bandejas PAMI, padrón
  de afiliados, administración/facturas, y "Laboratorio" (mini-sistema de gestión).
- **`desktop-app/`** — Python. Dos roles distintos:
  1. La **automatización de PAMI** (worker + tareas programadas) que hoy corre en un
     **server Linux headless** (ver más abajo).
  2. La **GUI de escritorio** ("Suite PAMI", `customtkinter`) que corre en la PC de Nacho
     como herramienta manual / cockpit visual.

## Stack

- **Web**: Node **HTTP vanilla** (`web/server.js`, sin framework), SPA en **JS vanilla**
  (`web/public/app.js`, `index.html`, `lab.js`). Stores en JSON dentro del volumen
  (`dataDir` = `RAILWAY_VOLUME_MOUNT_PATH`).
- **Desktop**: Python 3.12, Playwright (Chromium) para manejar el portal de PAMI,
  openpyxl, Google Sheets/Drive, OCR.

## Deploy — LEER

- **La web autodeploya en cada push** a la rama principal (Railway). **Un push = deploy real
  en producción.** No hay botón manual. Verificá con `GET /api/version` (devuelve un número
  que cambia en cada deploy); tras pushear, esperá a que cambie antes de dar algo por subido.
- **La automatización (worker + schedulers) NO se deploya con push.** Corre en el server
  Linux. Si tocás worker/bots (`worker_pami.py`, `pami_documentacion.py`, `bandeja_sync.py`,
  `pipeline_scheffelaar.py`, `benef_sweep.py`, etc.), hay que actualizar el server a mano:
  `cd /opt/NS-Aplicacion-web && git pull` + `systemctl restart ns-worker`. **Ver
  [`desktop-app/SERVER.md`](desktop-app/SERVER.md).**
- **La PC de Nacho ya NO corre la automatización.** Sus tareas del Programador de Windows
  (`NS - Worker PAMI`, bandejas, Scheffelaar) están **deshabilitadas** a propósito.
  **No las re-actives** — correría todo por duplicado con el server. La PC quedó solo como
  cockpit visual manual (la GUI, para ver PAMI en pantalla al debuggear un error).

## Convenciones

- **UI en castellano llano, sin jerga técnica** (nada de "parser", "endpoint", "default",
  "config" en pantalla). Los botones auxiliares: solo emoji + `title` de una palabra.
- **Estáticos se sirven con `cache-control: no-store`.** `app.js` toma los cambios sin
  `?v=` (siempre fresco). `lab.js` sí usa `?v=N`: al tocarlo, subí el número en `index.html`.
- **Los secretos NO están en el repo** (está gitignoreado): `ns_conexion.json`, los
  `token_*.json` y `credentials/credentials.json`. Están copiados a mano en la PC y en el
  server. El repo es **público** — nunca commitear credenciales, IPs de servers ni tokens.

## Cómo corre la automatización PAMI (resumen)

La web encola tareas (auditar/subir informes a PAMI); el **worker** del server las toma,
las corre con Playwright headless y reporta el resultado. La web (Railway) no llega a PAMI;
el server sí. Cuando una subida falla, el bot saca una **captura de pantalla del error** y
la sube a la web (se ve en el panel "Estado del server", solo admin). Detalle completo del
server, systemd, logs y accesos en [`desktop-app/SERVER.md`](desktop-app/SERVER.md).
