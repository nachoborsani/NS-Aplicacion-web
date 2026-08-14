# Transmision Web Movil

Este proyecto es una primera base para usar el modulo de `Transmision` desde el celular, sin pagar servidor.

## Como funciona

- El backend corre en tu PC con Windows.
- Ese backend reutiliza `PamiTransmisionController` del proyecto actual.
- La interfaz es una web responsive para abrir desde el celular.
- Cuando lanzas acciones, el navegador de PAMI se abre en tu PC, no en el telefono.

## Estructura

- `backend/server.py`: API FastAPI + servidor web
- `frontend/index.html`: interfaz responsive
- `frontend/app.css`: estilos
- `frontend/app.js`: logica cliente
- `run_local.bat`: arranque rapido local

## Primer uso

1. Ejecuta `run_local.bat`
2. Espera que instale dependencias
3. Abre en la PC `http://127.0.0.1:8000`
4. Para usarlo desde el celular, busca la IP local de tu PC y abre:

```txt
http://TU-IP-LOCAL:8000
```

Ejemplo:

```txt
http://192.168.0.25:8000
```

## Importante

- La PC tiene que quedar prendida.
- El celular y la PC tienen que estar en la misma red Wi-Fi para esta primera version.
- Si Windows Firewall pregunta, hay que permitir acceso en red privada.
- El sitio de PAMI y Playwright siguen corriendo en la PC.

## Siguiente paso recomendado

Despues de probar esta base, podemos agregar:

- historial persistente de ejecuciones
- logs en tiempo real por polling o SSE
- autenticacion simple para no dejar la web abierta
- acceso remoto fuera de casa o del consultorio
