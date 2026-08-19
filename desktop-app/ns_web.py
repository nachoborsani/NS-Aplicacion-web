"""Cliente de la web NS (nsgestion) para la app de escritorio.

La web NS es la fuente central de nomencladores PAMI: un admin sube el Excel de
cada mes y la web lo guarda por periodo (2026-04, 2026-05, ...). Este modulo deja
que la app de escritorio se conecte, elija con que mes trabajar y baje el
nomenclador de ese periodo, en vez de depender de un Excel copiado a mano en cada
PC.

No agrega dependencias: usa urllib (stdlib) y truststore (ya esta en el proyecto)
para que el SSL use el almacen de certificados del sistema. No toca el backend:
reutiliza los endpoints que ya existen (/api/login, /api/nomencladores,
/api/nomencladores/search).
"""

from __future__ import annotations

import dataclasses
import http.client
import json
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path

try:  # el SSL del sistema (evita CERTIFICATE_VERIFY_FAILED en algunas PCs)
    import truststore

    truststore.inject_into_ssl()
except Exception:  # pragma: no cover - si no esta, urllib usa el default
    pass

try:
    from app_paths import get_data_dir
except Exception:  # pragma: no cover - permite usar el modulo suelto para tests
    def get_data_dir() -> Path:  # type: ignore
        d = Path.home() / ".ns_gestion"
        d.mkdir(parents=True, exist_ok=True)
        return d


DEFAULT_BASE_URL = "https://nsgestion.up.railway.app"
CONFIG_FILE = "ns_conexion.json"
CACHE_DIRNAME = "ns_nomencladores"


# --------------------------------------------------------------------------- #
# Config local (base_url + credenciales) — guardada por usuario en LOCALAPPDATA
# --------------------------------------------------------------------------- #
def _config_path() -> Path:
    return get_data_dir() / CONFIG_FILE


def load_config() -> dict:
    try:
        data = json.loads(_config_path().read_text("utf-8"))
        if isinstance(data, dict):
            data.setdefault("base_url", DEFAULT_BASE_URL)
            data.setdefault("username", "")
            data.setdefault("password", "")
            return data
    except Exception:
        pass
    return {"base_url": DEFAULT_BASE_URL, "username": "", "password": ""}


def save_config(cfg: dict) -> None:
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), "utf-8")


# --------------------------------------------------------------------------- #
# Modelo
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class PracticaWeb:
    module_code: str
    module_name: str
    code: str
    description: str
    honorarios: float
    gastos: float
    total: float
    type: str
    auth_level: str
    observations: str
    scope: str


class NSWebError(Exception):
    """Error de conexion o del backend NS (mensaje apto para mostrar al usuario)."""


# --------------------------------------------------------------------------- #
# Cliente
# --------------------------------------------------------------------------- #
class NSWebClient:
    def __init__(self, base_url: str = DEFAULT_BASE_URL, timeout: int = 30) -> None:
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.timeout = timeout
        self._cookie = ""

    # --- HTTP ---------------------------------------------------------------
    def _request(self, method: str, path: str, params: dict | None = None, body: dict | None = None) -> dict:
        full_path = path
        if params:
            clean = {k: v for k, v in params.items() if v not in (None, "")}
            if clean:
                full_path += "?" + urllib.parse.urlencode(clean)

        parsed = urllib.parse.urlsplit(self.base_url)
        is_https = parsed.scheme == "https"
        host = parsed.hostname or "localhost"
        port = parsed.port or (443 if is_https else 80)

        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if self._cookie:
            headers["Cookie"] = self._cookie

        # El server manda Content-Length, asi que http.client lee exactamente
        # esos bytes y no hace un recv de mas (que en Windows termina en reset).
        # Igual reintentamos ante un corte, por las dudas.
        last_err = None
        for intento in range(3):
            conn = None
            try:
                if is_https:
                    conn = http.client.HTTPSConnection(host, port, timeout=self.timeout)
                else:
                    conn = http.client.HTTPConnection(host, port, timeout=self.timeout)
                conn.request(method, full_path, body=data, headers=headers)
                resp = conn.getresponse()
                set_cookie = resp.getheader("Set-Cookie")
                if set_cookie:
                    self._cookie = set_cookie.split(";", 1)[0]
                text = resp.read().decode("utf-8") or "{}"
                if resp.status >= 400:
                    try:
                        message = json.loads(text).get("error") or f"HTTP {resp.status}"
                    except Exception:
                        message = f"HTTP {resp.status}"
                    raise NSWebError(message)
                return json.loads(text)
            except (ConnectionResetError, http.client.IncompleteRead) as exc:
                last_err = exc
                time.sleep(0.4 * (intento + 1))
                continue
            except NSWebError:
                raise
            except OSError as exc:
                raise NSWebError(f"No se pudo conectar con {self.base_url} ({exc}).") from exc
            finally:
                if conn is not None:
                    conn.close()
        raise NSWebError(
            f"La conexion con {self.base_url} se corto al recibir la respuesta. Probá de nuevo."
        ) from last_err

    # --- Sesion -------------------------------------------------------------
    def login(self, username: str, password: str, remember: bool = True) -> dict:
        data = self._request(
            "POST", "/api/login",
            body={"username": username, "password": password, "remember": remember},
        )
        return data.get("user", {})

    def me(self) -> dict:
        return self._request("GET", "/api/me").get("user", {})

    @property
    def connected(self) -> bool:
        return bool(self._cookie)

    # --- Clientes / bandeja -------------------------------------------------
    def list_clients(self) -> list[dict]:
        return self._request("GET", "/api/clientes").get("clients", [])

    def client_pami(self, slug: str) -> dict:
        """Usuario + clave PAMI del cliente (desencriptada). Requiere sesión admin."""
        return self._request("GET", f"/api/clientes/{urllib.parse.quote(slug)}/pami/credenciales")

    def faltan_benef_scheffelaar(self) -> list[dict]:
        """Filas de la planilla de Scheffelaar con DNI y sin benef (para buscarlo)."""
        data = self._request("GET", "/api/credenciales/scheffelaar/faltan-benef")
        return data.get("faltan", []) if isinstance(data, dict) else []

    def set_benef_scheffelaar(self, sheet_row: int, benef: str) -> dict:
        """Escribe el benef encontrado en la planilla de Scheffelaar."""
        return self._request("POST", "/api/credenciales/scheffelaar/set-benef",
                             body={"sheetRow": int(sheet_row), "benef": str(benef)})

    def upload_bandeja(self, slug: str, month: str, rows: list[dict],
                       columns: list[str] | None = None, month_label: str = "",
                       generated_at: str = "") -> dict:
        """Sube la bandeja parseada del mes de un cliente a la web."""
        return self._request(
            "POST", f"/api/clientes/{urllib.parse.quote(slug)}/bandeja",
            body={
                "month": month,
                "monthLabel": month_label,
                "generatedAt": generated_at,
                "columns": columns or [],
                "rows": rows,
            },
        )

    def upload_bandeja_adelante(self, slug: str, month: str, rows: list[dict],
                                columns: list[str] | None = None, month_label: str = "",
                                generated_at: str = "") -> dict:
        """Sube la bandeja de turnos futuros (hacia adelante) de un cliente."""
        return self._request(
            "POST", f"/api/clientes/{urllib.parse.quote(slug)}/bandeja-adelante",
            body={
                "month": month,
                "monthLabel": month_label,
                "generatedAt": generated_at,
                "columns": columns or [],
                "rows": rows,
            },
        )

    def report_bandeja_estado(self, slug: str, ok: bool, count: int | None = None,
                              error: str = "", transmitidas: int | None = None,
                              transmit_errores: int | None = None,
                              transmit_error: str = "",
                              omitidos_detalle: list | None = None) -> dict:
        """Reporta el resultado del último sync (para el indicador de salud).

        Incluye la info de transmisión si se corrió (transmitidas / errores) y el
        detalle de las OMEs que no se pudieron transmitir con su leyenda/motivo."""
        body = {"ok": bool(ok), "count": int(count or 0), "error": str(error or "")[:300]}
        if transmitidas is not None or transmit_errores is not None or transmit_error:
            body["transmitidas"] = int(transmitidas or 0)
            body["transmitErrores"] = int(transmit_errores or 0)
            body["transmitError"] = str(transmit_error or "")[:300]
        if omitidos_detalle:
            body["omitidosDetalle"] = [
                {"nroOrden": str(d.get("nroOrden", ""))[:20], "motivo": str(d.get("motivo", ""))[:200]}
                for d in list(omitidos_detalle)[:100] if isinstance(d, dict)
            ]
        return self._request(
            "POST", f"/api/clientes/{urllib.parse.quote(slug)}/bandeja/estado", body=body,
        )

    # --- Nomencladores ------------------------------------------------------
    def list_nomencladores(self) -> tuple[list[dict], str]:
        """Devuelve (lista de periodos disponibles, periodo activo).

        La web usa la clave `value` para el periodo; la normalizamos a `period`
        para que el resto del codigo hable siempre de "period".
        """
        data = self._request("GET", "/api/nomencladores")
        items = []
        for it in data.get("nomencladores", []):
            it = dict(it)
            it.setdefault("period", it.get("value"))
            items.append(it)
        return items, data.get("activePeriod", "")

    def summary(self, period: str | None = None) -> dict:
        return self._request("GET", "/api/nomencladores", params={"period": period})

    def search(
        self,
        q: str = "",
        period: str | None = None,
        module: str | None = None,
        tipo: str | None = None,
        scope: str | None = None,
        limit: int = 120,
    ) -> tuple[list[dict], int]:
        data = self._request(
            "GET", "/api/nomencladores/search",
            params={"q": q, "period": period, "module": module, "type": tipo, "scope": scope, "limit": limit},
        )
        return data.get("rows", []), int(data.get("total", 0))

    def buscar_practicas(self, q: str, period: str | None = None, limit: int = 120) -> list[PracticaWeb]:
        rows, _ = self.search(q=q, period=period, limit=limit)
        return [self._to_practica(r) for r in rows]

    def download_catalog(self, period: str | None = None, progress=None) -> dict:
        """Baja el catalogo completo de un periodo y lo cachea local.

        Camino rapido: GET /api/nomencladores/export trae todo en una request.
        Respaldo (server viejo sin ese endpoint): itera la busqueda por modulo.
        `progress(hechos, total)` es opcional (para una barra de avance).
        """
        try:
            data = self._request("GET", "/api/nomencladores/export", params={"period": period})
            rows = data.get("rows", [])
            period = data.get("period") or period or ""
            row_count = int(data.get("rowCount") or len(rows))
            practicas = [self._to_practica(r) for r in rows]
            result = {
                "period": period,
                "label": data.get("label") or period,
                "rowCount": row_count,
                "count": len(practicas),
                "complete": len(practicas) >= row_count,
                "practicas": practicas,
            }
            if progress:
                progress(1, 1)
            self._cache_write(period, result)
            return result
        except NSWebError as exc:
            # Si el endpoint no existe todavia (404), uso el respaldo por modulo.
            if "404" not in str(exc):
                raise
            return self._download_by_modules(period, progress)

    def _download_by_modules(self, period: str | None, progress=None) -> dict:
        summary = self.summary(period)
        if not summary.get("loaded"):
            raise NSWebError("La web no tiene un nomenclador cargado para ese mes.")
        period = summary.get("activePeriod") or period or ""
        row_count = int(summary.get("rowCount") or 0)
        modules = (summary.get("filters") or {}).get("modules") or []

        collected: dict[tuple, dict] = {}

        def _merge(rows: list[dict]) -> None:
            for r in rows:
                key = (r.get("moduleCode"), r.get("practiceCode"), r.get("practiceDescription"))
                collected[key] = r

        rows, _ = self.search(period=period, limit=300)
        _merge(rows)
        total_mods = len(modules)
        for i, mod in enumerate(modules):
            rows, _ = self.search(period=period, module=str(mod.get("value") or ""), limit=300)
            _merge(rows)
            if progress:
                progress(i + 1, total_mods)

        practicas = [self._to_practica(r) for r in collected.values()]
        result = {
            "period": period,
            "label": summary.get("label") or period,
            "rowCount": row_count,
            "count": len(practicas),
            "complete": row_count == 0 or len(practicas) >= row_count,
            "practicas": practicas,
        }
        self._cache_write(period, result)
        return result

    # --- Mapeo web -> desktop ----------------------------------------------
    @staticmethod
    def _to_practica(r: dict) -> PracticaWeb:
        def num(v):
            try:
                return float(v or 0)
            except Exception:
                return 0.0
        return PracticaWeb(
            module_code=str(r.get("moduleCode") or "").strip(),
            module_name=" ".join(str(r.get("moduleDescription") or "").split()),
            code=str(r.get("practiceCode") or "").strip(),
            description=" ".join(str(r.get("practiceDescription") or "").split()),
            honorarios=num(r.get("honorarios")),
            gastos=num(r.get("gastos")),
            total=num(r.get("total")),
            type=str(r.get("type") or "").strip(),
            auth_level=str(r.get("authLevel") or "").strip(),
            observations=str(r.get("observations") or "").strip(),
            scope=str(r.get("scope") or "").strip(),
        )

    # --- Cache local por periodo -------------------------------------------
    def _cache_dir(self) -> Path:
        d = get_data_dir() / CACHE_DIRNAME
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _cache_write(self, period: str, result: dict) -> None:
        if not period:
            return
        payload = dict(result)
        payload["practicas"] = [dataclasses.asdict(p) for p in result["practicas"]]
        (self._cache_dir() / f"nomenclador_{period}.json").write_text(
            json.dumps(payload, ensure_ascii=False), "utf-8"
        )

    def cached_catalog(self, period: str) -> dict | None:
        try:
            data = json.loads((self._cache_dir() / f"nomenclador_{period}.json").read_text("utf-8"))
            data["practicas"] = [PracticaWeb(**p) for p in data.get("practicas", [])]
            return data
        except Exception:
            return None

    def cached_periods(self) -> list[str]:
        try:
            return sorted(
                p.stem.replace("nomenclador_", "")
                for p in self._cache_dir().glob("nomenclador_*.json")
            )
        except Exception:
            return []


# --------------------------------------------------------------------------- #
# Prueba manual: python ns_web.py [base_url] [usuario] [clave]
# --------------------------------------------------------------------------- #
if __name__ == "__main__":  # pragma: no cover
    import sys

    base = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_BASE_URL
    user = sys.argv[2] if len(sys.argv) > 2 else input("Usuario: ")
    pwd = sys.argv[3] if len(sys.argv) > 3 else input("Clave: ")

    client = NSWebClient(base)
    print("Conectando a", client.base_url)
    print("Logueado como:", client.login(user, pwd))
    periodos, activo = client.list_nomencladores()
    print(f"Periodos en la web: {[p.get('period') for p in periodos]} (activo: {activo})")
    if periodos:
        target = activo or periodos[0].get("period")
        print(f"Bajando catalogo {target} ...")
        cat = client.download_catalog(target, progress=lambda a, b: print(f"  modulo {a}/{b}", end="\r"))
        print()
        estado = "COMPLETO" if cat["complete"] else f"PARCIAL ({cat['count']}/{cat['rowCount']})"
        print(f"Catalogo {cat['label']}: {cat['count']} practicas [{estado}]")
        for p in cat["practicas"][:5]:
            print(f"  {p.code}  {p.description[:50]}  ${p.total}")
