const defaultTasks = [
  { doctor: "Medico Demo", type: "Credencial provisoria", benefit: "Beneficio de prueba" },
  { doctor: "Operador NS", type: "Generar OME", benefit: "DNI de prueba" },
  { doctor: "Panel Local", type: "Transmision", benefit: "Pendiente de agente" },
];

const taskList = document.querySelector("#taskList");
const taskForm = document.querySelector("#taskForm");
const pendingCount = document.querySelector("#pendingCount");
const clearTasks = document.querySelector("#clearTasks");

function getTasks() {
  const stored = localStorage.getItem("ns-web-tasks");
  if (!stored) return defaultTasks;

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : defaultTasks;
  } catch {
    return defaultTasks;
  }
}

function saveTasks(tasks) {
  localStorage.setItem("ns-web-tasks", JSON.stringify(tasks));
}

function renderTasks() {
  const tasks = getTasks();
  pendingCount.textContent = String(tasks.length);
  taskList.innerHTML = "";

  for (const task of tasks) {
    const row = document.createElement("article");
    row.className = "task-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(task.type)}</strong>
        <span>${escapeHtml(task.doctor)} · ${escapeHtml(task.benefit)}</span>
      </div>
      <span class="badge">Pendiente</span>
    `;
    taskList.appendChild(row);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(taskForm);
  const task = {
    doctor: formData.get("doctor") || "Sin medico",
    type: formData.get("type") || "Tarea",
    benefit: formData.get("benefit") || "Sin dato",
  };

  const tasks = [task, ...getTasks()].slice(0, 12);
  saveTasks(tasks);
  taskForm.reset();
  renderTasks();
});

clearTasks.addEventListener("click", () => {
  saveTasks([]);
  renderTasks();
});

renderTasks();
