const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "public");

// Persistencia: usa el volumen de Railway si esta montado; si no, ./data local.
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");
const usersFile = path.join(dataDir, "users.json");

// Secreto para firmar la cookie de sesion. En produccion conviene setear
// SESSION_SECRET (env) para que las sesiones sobrevivan a los redeploys.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
};

// ---------- Passwords (scrypt, sin dependencias) ----------
function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(test, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Store de usuarios ----------
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(usersFile, "utf8"));
  } catch {
    return null;
  }
}
function saveUsers(users) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}
function seedUsers() {
  let users = loadUsers();
  if (!Array.isArray(users) || users.length === 0) {
    users = [
      { username: "nacho", name: "Ignacio Borsani", role: "admin", password: hashPassword("123456"), mustChange: true, active: true },
      { username: "seba", name: "Sebastian", role: "admin", password: hashPassword("123456"), mustChange: true, active: true },
    ];
    saveUsers(users);
    console.log("Usuarios semilla creados: nacho, seba (clave 123456, deben cambiarla)");
  }
  return users;
}
seedUsers();

// ---------- Sesion (cookie firmada HMAC) ----------
function sign(value) {
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  return `${value}.${sig}`;
}
function unsign(signed) {
  if (!signed) return null;
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const sig = signed.slice(i + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}
function getSessionUser(req) {
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)ns_session=([^;]+)/);
  if (!m) return null;
  const username = unsign(decodeURIComponent(m[1]));
  if (!username) return null;
  const users = loadUsers() || [];
  return users.find((u) => u.username === username && u.active) || null;
}
function setSessionCookie(res, username) {
  const val = encodeURIComponent(sign(username));
  res.setHeader("Set-Cookie", `ns_session=${val}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "ns_session=; HttpOnly; Path=/; Max-Age=0");
}

// ---------- Helpers ----------
function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => {
      d += c;
      if (d.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); }
    });
  });
}
function publicUser(u) {
  return { username: u.username, name: u.name, role: u.role, mustChange: !!u.mustChange };
}
function sendFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "content-type": contentTypes[ext] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  });
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === "/health") return json(res, 200, { ok: true, service: "ns-web" });

  // ---- API ----
  if (p === "/api/me") {
    const u = getSessionUser(req);
    if (!u) return json(res, 401, { error: "no-auth" });
    return json(res, 200, { user: publicUser(u) });
  }

  if (p === "/api/users") {
    const me = getSessionUser(req);
    if (!me) return json(res, 401, { error: "no-auth" });
    if (me.role !== "admin") return json(res, 403, { error: "forbidden" });
    const users = loadUsers() || [];
    return json(res, 200, {
      users: users.map((u) => ({
        username: u.username,
        name: u.name,
        role: u.role,
        active: u.active !== false,
        mustChange: !!u.mustChange,
      })),
    });
  }

  if (p === "/api/login" && req.method === "POST") {
    const { username, password } = await readBody(req);
    const uname = String(username || "").trim().toLowerCase();
    const users = loadUsers() || [];
    const u = users.find((x) => x.username === uname && x.active);
    if (!u || !verifyPassword(password, u.password)) {
      return json(res, 401, { error: "Usuario o contraseña incorrectos" });
    }
    setSessionCookie(res, u.username);
    return json(res, 200, { user: publicUser(u) });
  }

  if (p === "/api/change-password" && req.method === "POST") {
    const u = getSessionUser(req);
    if (!u) return json(res, 401, { error: "no-auth" });
    const { newPassword } = await readBody(req);
    const np = String(newPassword || "");
    if (np.length < 6) return json(res, 400, { error: "La clave debe tener al menos 6 caracteres" });
    if (np === "123456") return json(res, 400, { error: "Elegí una clave distinta a la inicial" });
    const users = loadUsers() || [];
    const idx = users.findIndex((x) => x.username === u.username);
    if (idx < 0) return json(res, 404, { error: "no-user" });
    users[idx].password = hashPassword(np);
    users[idx].mustChange = false;
    saveUsers(users);
    return json(res, 200, { ok: true });
  }

  if (p === "/api/logout" && req.method === "POST") {
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  // ---- Estatico ----
  const cleanPath = p === "/" ? "/index.html" : p;
  const resolved = path.normalize(path.join(publicDir, cleanPath));
  if (!resolved.startsWith(publicDir)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Acceso denegado");
    return;
  }
  sendFile(res, resolved);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`NS Web escuchando en puerto ${port} | datos en ${dataDir}`);
});
