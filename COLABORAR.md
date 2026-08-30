# Cómo colaborar en NS

Guía para trabajar en este proyecto sin romper nada. Léela antes de tocar código.

## Qué es y qué corre dónde

**NS** es la plataforma de gestión PAMI (web + automatización). Hay **dos mundos** y
es clave no confundirlos:

| Parte | Qué es | Dónde corre | ¿La tocás vos? |
|---|---|---|---|
| **Web** (`web/`) | La app que se ve en `nsgestion.up.railway.app` (dashboards, informes, reportes, débitos). | **Railway** — se despliega **sola** al pushear a `main`. | **SÍ**, es el 99% del laburo. |
| **Automatización PAMI** (`desktop-app/`) | Los robots que entran a PAMI: bajar bandejas, la cadena, transmitir, credenciales. | **La PC de Nacho**, con tareas programadas. | Casi nunca. |

> **Regla de oro**: la automatización PAMI vive **centralizada en la PC de Nacho** a
> propósito — una sola máquina hablándole a PAMI evita pisarse con los cupos y las
> sesiones. Vos trabajás sobre la **web**.

---

## 1. Acceso al repo

1. Necesitás una cuenta de **GitHub** y que Nacho te agregue como *collaborator*
   (repo → Settings → Collaborators). Te llega una invitación por mail: aceptala.
2. El repo es privado: `github.com/nachoborsani/NS-Aplicacion-web`.

## 2. Bajar el proyecto

Con **Claude Code** (recomendado) o con git a mano:

```bash
git clone https://github.com/nachoborsani/NS-Aplicacion-web.git
cd NS-Aplicacion-web
```

La primera vez GitHub te va a pedir loguearte. Si usás la terminal, lo más fácil es
[GitHub CLI](https://cli.github.com): `gh auth login` y listo.

---

## 3. Trabajar con Claude Code

Claude Code es la forma recomendada de trabajar acá. Un par de cosas para que rinda:

- **Abrí Claude Code parado en la carpeta del repo** (`NS-Aplicacion-web/`). Desde ahí
  ve todo el código y puede editar, correr comandos y commitear.
- **Pedile contexto primero.** Antes de un cambio, algo como:
  *"Leé web/server.js y web/public/app.js y explicame cómo funciona la cabina de
  informes"*. Que **lea antes de tocar**.
- **Cambios chicos y verificables.** Pedí una cosa a la vez y que te muestre el diff.
- **Que pruebe lo que hace.** Para lógica pura (matchers, cálculos) se puede correr un
  test rápido con Node sin levantar nada:
  `node -e "const m=require('./web/informes_match'); ..."`.
- **El deploy es tuyo, no de Claude.** Que **no** commitee ni pushee sin que vos lo
  revises. Un push a `main` sale a producción (ver abajo).

### Mapa rápido del código (para orientar a Claude)
- `web/server.js` — el backend entero (rutas API, lógica, acceso a la base).
- `web/public/app.js` — el frontend (vanilla JS, un solo archivo grande).
- `web/public/index.html` / `styles.css` — la interfaz y los estilos.
- `web/informes_match.js`, `web/informe_extract.js` — matcheo y lectura de informes.
- `web/services/` y demás módulos — servicios puntuales.
- `desktop-app/` — la automatización PAMI (**no** se despliega; corre en la PC).

---

## 4. Correr la web en tu compu (para probar antes de subir)

Necesitás **Node 18 o superior**. Desde la raíz del repo:

```bash
npm install
npm start
```

Levanta en `http://localhost:3000`. Sirve para ver que un cambio no rompió la
pantalla. **No** vas a tener los datos reales de producción (eso vive en Railway),
pero alcanza para probar la interfaz y que no haya errores.

> Si solo vas a editar y subir, este paso es opcional: Railway igual la corre. Pero
> probar local antes de pushear evita mandar un bug a producción.

---

## 5. Subir cambios — ⚠️ OJO CON ESTO

**Cada push a `main` DISPARA un deploy a producción.** Lo que subís sale **en vivo**
en `nsgestion.up.railway.app` en ~2 minutos. No hay "staging".

**Para cambios visuales, el flujo es directo — se despliega solo.** No hay que
configurar nada: Railway ya está conectado a este repo y despliega en cada push a
`main`.

```bash
git pull                                  # traé lo último antes de empezar
# ... editás y PROBÁS local (ver sección 4) ...
git add -A
git commit -m "Describí el cambio en una línea clara"
git push                                  # esto sube a main y DISPARA el deploy
```

En ~2 minutos tu cambio está en `nsgestion.up.railway.app`. No necesitás que Nacho
apruebe nada.

**Reglas para que no rompas producción:**
- **Probá local antes de pushear** (sección 4). Un cambio visual que se ve bien en
  `localhost:3000` es seguro.
- **Un cambio por push**, con mensaje claro. Si algo sale mal, se revierte fácil.
- **Tocá solo lo visual** (`web/public/` — HTML, CSS, textos, layout). El backend
  (`web/server.js`) y la automatización PAMI, coordinalos con Nacho.
- **Si te da miedo un cambio grande**, ahí sí conviene una rama + Pull Request para que
  Nacho lo mire antes (`git checkout -b mi-cambio` → push → PR en GitHub). Pero para el
  día a día visual, andá directo a `main`.

> **Si tu primer push no dispara el deploy**: puede que Railway pida aprobar una vez a
> los colaboradores nuevos (aparece un botón en el panel de Railway del proyecto). Que
> Nacho lo apruebe esa primera vez y después ya sale solo.

### Verificar qué versión está en producción
`GET https://nsgestion.up.railway.app/api/version` devuelve un identificador que
cambia en cada deploy. Sirve para confirmar que tu cambio ya subió.

---

## 6. Qué NO tocar / dónde están los secretos

**Nunca** commitees credenciales. Están fuera del repo a propósito (ver `.gitignore`):
tokens de Google (`token_*.json`), `.env`, `credentials/`, `CREDENCIALES/`, los
`*_sheets_config.json`, etc. Si tu cambio necesita una clave nueva, se carga como
variable de entorno en Railway, **no** en el código.

La automatización de `desktop-app/` depende de esos secretos y del entorno de la PC de
Nacho (Python, Playwright, tareas programadas). Podés leer ese código, pero **no
esperes que corra** con solo clonar el repo, y coordiná con Nacho antes de cambiar algo
ahí: es lo que le habla a PAMI en producción.

---

## Resumen en 3 líneas
1. Pedí acceso, cloná, abrí **Claude Code** en la carpeta.
2. Cambios visuales: probá en `localhost:3000`, `git push` a **main** y **se despliega solo** (~2 min).
3. **Secretos** y **automatización PAMI** no se tocan sin coordinar con Nacho.
