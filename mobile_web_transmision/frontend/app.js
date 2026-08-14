const profileSelect = document.getElementById("profileSelect");
const clienteInput = document.getElementById("cliente");
const usuarioInput = document.getElementById("usuario");
const claveInput = document.getElementById("clave");
const fechaDesdeInput = document.getElementById("fechaDesde");
const fechaHastaInput = document.getElementById("fechaHasta");
const validadaInput = document.getElementById("validada");
const transmitidaInput = document.getElementById("transmitida");
const headlessModeInput = document.getElementById("headlessMode");
const stateBox = document.getElementById("stateBox");
const logList = document.getElementById("logList");
const connectionBadge = document.getElementById("connectionBadge");
const statusLine = document.getElementById("statusLine");
const summaryLine = document.getElementById("summaryLine");
const ultimaBoteada = document.getElementById("ultimaBoteada");
const messageBox = document.getElementById("messageBox");

let cachedProfiles = [];
let passwordVisible = false;

function ddmmyyyyToIso(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return "";
  }
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function isoToDdmmyyyy(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return raw;
  }
  const [, yyyy, mm, dd] = match;
  return `${dd}/${mm}/${yyyy}`;
}

function getFilters() {
  return {
    fechaDesde: isoToDdmmyyyy(fechaDesdeInput.value),
    fechaHasta: isoToDdmmyyyy(fechaHastaInput.value),
    validada: validadaInput.value,
    transmitida: transmitidaInput.value,
  };
}

function getProfilePayload() {
  return {
    cliente: clienteInput.value.trim(),
    usuario: usuarioInput.value.trim(),
    clave: claveInput.value,
    ultima_boteada: ultimaBoteada.textContent === "Sin registro" ? "" : ultimaBoteada.textContent,
    ...getFilters(),
  };
}

function getActionPayload() {
  return {
    cliente: clienteInput.value.trim(),
    usuario: usuarioInput.value.trim(),
    clave: claveInput.value,
    filtros: getFilters(),
    headless: headlessModeInput.checked,
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail = typeof data === "object" && data ? data.detail : "";
    throw new Error(detail || "Error inesperado");
  }
  return data;
}

function showMessage(text, kind = "info") {
  messageBox.hidden = false;
  messageBox.textContent = text;
  messageBox.className = `panel message-box ${kind}`;
}

function clearMessage() {
  messageBox.hidden = true;
  messageBox.textContent = "";
  messageBox.className = "panel";
}

function resetForm() {
  profileSelect.value = "";
  clienteInput.value = "";
  usuarioInput.value = "";
  claveInput.value = "";
  fechaDesdeInput.value = "";
  fechaHastaInput.value = "";
  validadaInput.value = "";
  transmitidaInput.value = "";
  ultimaBoteada.textContent = "Sin registro";
}

function applyProfile(profile) {
  clienteInput.value = profile.nombre || profile.cliente || "";
  usuarioInput.value = profile.usuario || "";
  claveInput.value = profile.clave || "";
  fechaDesdeInput.value = ddmmyyyyToIso(profile.fecha_desde || "");
  fechaHastaInput.value = ddmmyyyyToIso(profile.fecha_hasta || "");
  validadaInput.value = profile.validada || "";
  transmitidaInput.value = profile.transmitida || "";
  ultimaBoteada.textContent = profile.ultima_boteada || "Sin registro";
}

function renderProfiles(profiles) {
  cachedProfiles = profiles || [];
  const previousUser = profileSelect.value;
  profileSelect.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Elegir perfil";
  profileSelect.appendChild(defaultOption);

  cachedProfiles.forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.usuario;
    option.textContent = profile.nombre
      ? `${profile.usuario} - ${profile.nombre}`
      : profile.usuario;
    profileSelect.appendChild(option);
  });

  if (previousUser && cachedProfiles.some((profile) => profile.usuario === previousUser)) {
    profileSelect.value = previousUser;
  } else if (!usuarioInput.value && cachedProfiles.length) {
    profileSelect.value = cachedProfiles[0].usuario;
  }

  if (profileSelect.value) {
    const profile = cachedProfiles.find((item) => item.usuario === profileSelect.value);
    if (profile) {
      applyProfile(profile);
    }
  }
}

function renderLogs(items = []) {
  logList.innerHTML = "";

  if (!items.length) {
    logList.innerHTML = '<div class="log-item">Todavia no hay actividad.</div>';
    return;
  }

  items.slice().reverse().forEach((item) => {
    const article = document.createElement("article");
    article.className = `log-item ${item.kind || "log"}`;
    article.innerHTML = `
      <div class="log-meta">${item.timestamp} · ${item.kind}</div>
      <div>${item.message}</div>
    `;
    logList.appendChild(article);
  });
}

function renderStatus(payload) {
  const display = payload.display || {};

  if (!payload.connected) {
    connectionBadge.textContent = "Sin sesion activa";
    statusLine.textContent = display.statusLine || "Estado: Sin iniciar | Proceso: Esperando acciones | Procesados: 0";
    summaryLine.textContent = display.summaryLine || (payload.error || "No hay conexion con una sesion de transmision.");
    stateBox.textContent = payload.error || "No hay estado tecnico disponible.";
    renderLogs(payload.logs || []);
    return;
  }

  connectionBadge.textContent = "Sesion conectada";
  statusLine.textContent = display.statusLine || "Sesion conectada";
  summaryLine.textContent = display.summaryLine || "";
  stateBox.textContent = JSON.stringify(payload.state, null, 2);
  renderLogs(payload.logs || []);
}

async function loadProfiles() {
  const data = await api("/api/profiles");
  renderProfiles(data.profiles || []);
}

async function loadStatus() {
  const data = await api("/api/status");
  renderStatus(data);
}

async function saveCurrentProfile() {
  const data = await api("/api/profiles", {
    method: "POST",
    body: JSON.stringify(getProfilePayload()),
  });
  renderProfiles(data.profiles || []);
  return data;
}

async function refreshAll() {
  await loadProfiles();
  await loadStatus();
}

profileSelect.addEventListener("change", () => {
  const profile = cachedProfiles.find((item) => item.usuario === profileSelect.value);
  if (profile) {
    applyProfile(profile);
  }
});

document.getElementById("refreshProfilesBtn").addEventListener("click", async () => {
  clearMessage();
  await refreshAll();
});

document.getElementById("statusBtn").addEventListener("click", async () => {
  clearMessage();
  await loadStatus();
});

document.getElementById("newProfileBtn").addEventListener("click", () => {
  clearMessage();
  resetForm();
});

document.getElementById("togglePasswordBtn").addEventListener("click", () => {
  passwordVisible = !passwordVisible;
  claveInput.type = passwordVisible ? "text" : "password";
  document.getElementById("togglePasswordBtn").textContent = passwordVisible ? "Ocultar clave" : "Ver clave";
});

document.getElementById("saveProfileBtn").addEventListener("click", async () => {
  try {
    clearMessage();
    await saveCurrentProfile();
    showMessage("Perfil guardado.", "success");
    await loadStatus();
  } catch (error) {
    showMessage(error.message, "error");
  }
});

document.getElementById("deleteProfileBtn").addEventListener("click", async () => {
  try {
    const usuario = usuarioInput.value.trim();
    if (!usuario) {
      showMessage("No hay un perfil seleccionado para borrar.", "error");
      return;
    }
    if (!window.confirm(`Quieres borrar el perfil ${usuario}?`)) {
      return;
    }
    clearMessage();
    const data = await api(`/api/profiles/${encodeURIComponent(usuario)}`, { method: "DELETE" });
    renderProfiles(data.profiles || []);
    resetForm();
    showMessage("Perfil borrado.", "success");
    await loadStatus();
  } catch (error) {
    showMessage(error.message, "error");
  }
});

document.getElementById("autofillBtn").addEventListener("click", async () => {
  try {
    clearMessage();
    await saveCurrentProfile();
    const data = await api("/api/autofill", {
      method: "POST",
      body: JSON.stringify({
        usuario: usuarioInput.value.trim(),
        clave: claveInput.value,
      }),
    });
    showMessage(data.message || "Autocompletado solicitado.", "success");
    setTimeout(loadStatus, 800);
  } catch (error) {
    showMessage(error.message, "error");
  }
});

document.getElementById("openBtn").addEventListener("click", async () => {
  try {
    clearMessage();
    const data = await api("/api/open", {
      method: "POST",
      body: JSON.stringify(getActionPayload()),
    });
    if (data.profiles) {
      renderProfiles(data.profiles);
    }
    showMessage(data.message || "Abriendo PAMI en la PC.", "success");
    setTimeout(loadStatus, 1500);
  } catch (error) {
    showMessage(error.message, "error");
  }
});

document.getElementById("openStartBtn").addEventListener("click", async () => {
  try {
    clearMessage();
    const data = await api("/api/open-start", {
      method: "POST",
      body: JSON.stringify(getActionPayload()),
    });
    if (data.ultima_boteada) {
      ultimaBoteada.textContent = data.ultima_boteada;
    }
    if (data.profiles) {
      renderProfiles(data.profiles);
    }
    showMessage(data.message || "Abriendo PAMI e iniciando bot.", "success");
    setTimeout(loadStatus, 1800);
  } catch (error) {
    showMessage(error.message, "error");
  }
});

document.getElementById("exportBtn").addEventListener("click", async () => {
  try {
    clearMessage();
    const params = new URLSearchParams(getFilters());
    const response = await fetch(`/api/export?${params.toString()}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "No se pudo exportar.");
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "transmision_panel.xlsx";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    showMessage("Exportacion descargada.", "success");
  } catch (error) {
    showMessage(error.message, "error");
  }
});

document.getElementById("startBtn").addEventListener("click", async () => {
  try {
    clearMessage();
    const data = await api("/api/start", {
      method: "POST",
      body: JSON.stringify(getActionPayload()),
    });
    if (data.ultima_boteada) {
      ultimaBoteada.textContent = data.ultima_boteada;
    }
    if (data.profiles) {
      renderProfiles(data.profiles);
    }
    showMessage(data.message || "Bot iniciado.", "success");
    setTimeout(loadStatus, 1200);
  } catch (error) {
    showMessage(error.message, "error");
  }
});

document.getElementById("pauseBtn").addEventListener("click", async () => {
  try {
    clearMessage();
    const data = await api("/api/pause", { method: "POST" });
    showMessage(data.message || "Pausa solicitada.", "success");
    setTimeout(loadStatus, 800);
  } catch (error) {
    showMessage(error.message, "error");
  }
});

document.getElementById("resumeBtn").addEventListener("click", async () => {
  try {
    clearMessage();
    const data = await api("/api/resume", { method: "POST" });
    showMessage(data.message || "Reanudacion solicitada.", "success");
    setTimeout(loadStatus, 800);
  } catch (error) {
    showMessage(error.message, "error");
  }
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  try {
    clearMessage();
    const data = await api("/api/reset", { method: "POST" });
    showMessage(data.message || "Reset solicitado.", "success");
    setTimeout(loadStatus, 800);
  } catch (error) {
    showMessage(error.message, "error");
  }
});

document.getElementById("closeBtn").addEventListener("click", async () => {
  try {
    clearMessage();
    const data = await api("/api/close", { method: "POST" });
    showMessage(data.message || "Cierre solicitado.", "success");
    setTimeout(loadStatus, 800);
  } catch (error) {
    showMessage(error.message, "error");
  }
});

loadProfiles().catch((error) => showMessage(error.message, "error"));
loadStatus().catch((error) => showMessage(error.message, "error"));
setInterval(() => {
  loadStatus().catch(() => {});
}, 5000);
