# NS Aplicacion Web

Repositorio monorepo para la app de escritorio NS/PAMI y el desarrollo web asociado.

## Estructura

- `desktop-app/`: aplicacion de escritorio actual en Python/CustomTkinter, automatizaciones PAMI, integraciones Drive/Sheets y scripts de empaquetado.
- `web/`: base para la futura web que va a conectarse con la app local o con servicios en servidor.

## App de escritorio

Para trabajar con la app actual:

```bat
cd desktop-app
ejecutar_gui.bat
```

La documentacion especifica de la app esta en `desktop-app/README.md`.

## Web

La carpeta `web/` queda reservada para el desarrollo nuevo. Cuando definamos el stack, Railway/Render/VPS deberian deployar desde esa carpeta, no desde `desktop-app/`.

## Datos locales

Tokens, perfiles, credenciales, PDFs, Excels y salidas locales estan ignorados por Git. Pueden existir en tu PC para uso propio, pero no se suben al repositorio.
