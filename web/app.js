const $ = (id) => document.getElementById(id);
let state = { queue: [], history: [], config: {}, active: [], running: false };

function bytes(n) {
  if (n == null) return "-";
  const u = ["o", "Ko", "Mo", "Go"]; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

function escapeHtml(s) { return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

/* Icones SVG Iconify (Phosphor Duotone), embarquees dans icons.js. */
function iconElement(name, extraClass = "") {
  return `<span class="icon ${extraClass}" data-icon="${name}" aria-hidden="true"></span>`;
}
function paintIcons(root = document) {
  root.querySelectorAll("[data-icon]:not([data-painted])").forEach((el) => {
    const svg = ICONS[el.dataset.icon];
    if (!svg) return;
    el.innerHTML = svg;
    el.dataset.painted = "1";
  });
}
function setIcon(el, name) {
  if (!el || !ICONS[name]) return;
  el.dataset.icon = name;
  el.dataset.painted = "1";
  el.innerHTML = ICONS[name];
}
paintIcons();

function setStatus(text, kind) {
  const icons = { on: "ph:check-circle-duotone", off: "ph:x-circle-duotone", warn: "ph:warning-circle-duotone" };
  setIcon($("status-icon"), icons[kind] || icons.warn);
  $("status-pill").className = `status-pill ${kind}`;
  $("status-text").textContent = text;
}
setStatus("connexion…", "warn");

const ACTION_ICONS = {
  pause: "ph:pause-duotone",
  resume: "ph:play-duotone",
  cancel: "ph:x-duotone",
  retry: "ph:arrow-counter-clockwise-duotone",
  remove: "ph:trash-duotone",
  redownload: "ph:download-simple-duotone",
  "remove-history": "ph:trash-duotone",
};

function actionButton(action, label, id) {
  const icon = ACTION_ICONS[action] || "ph:download-simple-duotone";
  return `<button type="button" data-action="${action}" data-id="${escapeAttr(id)}">${iconElement(icon)}<span>${escapeHtml(label)}</span></button>`;
}

function actions(item) {
  const btn = (action, label) => actionButton(action, label, item.id);
  const buttons = [];
  if (item.status === "downloading") buttons.push(btn("pause", "Pause"), btn("cancel", "Annuler"));
  if (item.status === "paused") buttons.push(btn("resume", "Reprendre"), btn("cancel", "Annuler"));
  if (item.status === "queued") buttons.push(btn("cancel", "Annuler"));
  if (item.status === "error") buttons.push(btn("retry", "Réessayer"), btn("remove", "Supprimer"));
  if (!buttons.length) buttons.push(btn("remove", "Retirer"));
  return buttons.join("");
}

function historyMeta(item) {
  const file = item.fileExists
    ? `${iconElement("ph:check-duotone", "file-ok")} Fichier présent`
    : `${iconElement("ph:x-duotone", "file-missing")} Fichier manquant`;
  const date = item.finishedAt
    ? new Date(item.finishedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
    : "";
  return `<p class="meta history-meta">${file}${date ? ` · ${escapeHtml(date)}` : ""}${item.bytes ? ` · ${bytes(item.bytes)}` : ""}${item.filename ? `<br><span class="file-name">${escapeHtml(item.filename)}</span>` : ""}</p>`;
}

function renderList(target, items, isHistory) {
  if (!items.length) { target.innerHTML = '<p class="empty">Aucune entrée pour le moment.</p>'; return; }
  target.innerHTML = items.map((item) => `
    <div class="item">
      <div class="top">
        <span class="url" title="${escapeAttr(item.url)}">${escapeHtml(item.title || item.filename || item.url)}</span>
        <span class="badge ${escapeAttr(item.status)}">${escapeHtml(item.status)}</span>
      </div>
      ${isHistory ? historyMeta(item) : `<div class="bar"><span class="bar-fill" style="width:${Number(item.progress) || 0}%"></span></div>`}
      ${isHistory ? "" : `<p class="meta">${bytes(item.downloaded)} / ${bytes(item.total)}${item.speed ? ` · ${bytes(item.speed)}/s` : ""}${item.eta ? ` · ~${Math.round(item.eta)} s` : ""}${item.error ? ` · ${escapeHtml(item.error)}` : ""}</p>`}
      <div class="actions">${isHistory
        ? actionButton("redownload", "Retélécharger", item.id) + actionButton("remove-history", "Retirer", item.id)
        : actions(item)}</div>
    </div>`).join("");
  paintIcons(target);
}

function render() {
  const q = state.queue || [];
  $("stat-queue").textContent = q.filter((i) => i.status === "queued").length;
  $("stat-active").textContent = (state.active || []).length;
  $("stat-done").textContent = (state.history || []).filter((i) => i.status === "done").length;
  $("stat-error").textContent = q.filter((i) => i.status === "error").length;
  renderList($("queue"), q, false);
  renderList($("history"), (state.history || []).slice(0, 30), true);
  setStatus(state.running ? "moteur actif" : "moteur arrêté", state.running ? "on" : "off");
  const c = state.config || {};
  for (const key of ["downloadDir", "format", "concurrency", "port", "speedLimitKiB"]) {
    const el = $(`cfg-${key}`);
    if (el && c[key] != null && document.activeElement !== el) el.value = c[key];
  }
  if ($("cfg-notifications") && document.activeElement !== $("cfg-notifications")) {
    $("cfg-notifications").checked = !!c.notifications;
  }
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function addUrl(url, type) {
  if (!url) return;
  try {
    await api("/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, type: type || $("type").value }),
    });
    $("url").value = "";
    $("file").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { alert(error.message); }
}

$("add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  addUrl($("url").value.trim(), $("type").value);
});

$("queue").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  try {
    await api("/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: button.dataset.id, action: button.dataset.action }),
    });
  } catch (error) { alert(error.message); }
});

$("history").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const route = button.dataset.action === "redownload" ? "/api/history/redownload" : "/api/history/remove";
  try {
    await api(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: button.dataset.id }),
    });
    if (button.dataset.action === "redownload") {
      $("file").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) { alert(error.message); }
});

$("clear-history").addEventListener("click", async () => {
  if (confirm("Effacer tout l'historique ?")) await api("/api/history/clear", { method: "POST" });
});

const configPanel = $("config-panel");
function updateConfigIcon() {
  setIcon($("config-icon"), configPanel.open ? "ph:minus-duotone" : "ph:plus-duotone");
}
configPanel.addEventListener("toggle", updateConfigIcon);
updateConfigIcon();

$("save-config").addEventListener("click", async () => {
  const payload = {
    downloadDir: $("cfg-downloadDir").value,
    format: $("cfg-format").value,
    concurrency: Number($("cfg-concurrency").value),
    port: Number($("cfg-port").value),
    speedLimitKiB: Number($("cfg-speedLimitKiB").value),
    notifications: $("cfg-notifications").checked,
  };
  try { await api("/api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); }
  catch (error) { alert(error.message); }
});

/* Raccourcis de l'accroche */
document.querySelectorAll("[data-demo]").forEach((pill) => {
  pill.addEventListener("click", () => {
    $("url").value = pill.dataset.demo;
    $("type").value = pill.dataset.kind || "auto";
    $("url").focus();
  });
});
document.querySelectorAll("[data-preset]").forEach((card) => {
  card.addEventListener("click", (event) => {
    if (card.tagName === "A") return;
    event.preventDefault();
    $("type").value = card.dataset.preset;
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => $("url").focus(), 300);
  });
});

/* Menu mobile */
function updateMenuIcon() {
  const open = !$("mobile-menu").hidden;
  setIcon($("menu-btn").querySelector(".icon"), open ? "ph:x-duotone" : "ph:list-duotone");
  $("menu-btn").setAttribute("aria-expanded", String(open));
}
$("menu-btn").addEventListener("click", () => {
  const menu = $("mobile-menu");
  menu.hidden = !menu.hidden;
  updateMenuIcon();
});
$("mobile-menu").addEventListener("click", (event) => {
  if (event.target.closest("a")) {
    $("mobile-menu").hidden = true;
    updateMenuIcon();
  }
});

/* Guide flottant */
const GUIDE = {
  title: "Bienvenue !",
  tips: [
    "Collez un lien vidéo dans la barre pour commencer.",
    "Le mode « Auto » choisit tout seul entre site vidéo et fichier direct.",
    "Suivez l'avancement dans « Ma file » : pause, reprise et annulation sont là.",
    "Les terminés sont conservés dans l'historique, et vos réglages sont enregistrés.",
  ],
};
const GUIDE_KEY = "supido_guide_seen";
let guideStep = 0;
let guideOpen = false;

function renderGuide() {
  const bubble = $("guide-bubble");
  bubble.hidden = !guideOpen;
  $("guide-title").textContent = GUIDE.title;
  $("guide-tip").textContent = GUIDE.tips[guideStep];
  $("guide-dots").innerHTML = GUIDE.tips.map((_, i) => `<i class="${i === guideStep ? "active" : ""}"></i>`).join("");
  $("guide-next").textContent = guideStep >= GUIDE.tips.length - 1 ? "Compris" : "Suivant";
  const label = guideOpen ? "Fermer l'aide" : "Ouvrir l'aide";
  $("guide-toggle").setAttribute("aria-label", label);
  $("guide-toggle").title = label;
  setIcon($("guide-toggle").querySelector(".icon"), guideOpen ? "ph:x-duotone" : "ph:question-duotone");
}

$("guide-toggle").addEventListener("click", () => {
  guideOpen = !guideOpen;
  if (guideOpen) guideStep = 0;
  renderGuide();
});
$("guide-close").addEventListener("click", () => { guideOpen = false; renderGuide(); });
$("guide-next").addEventListener("click", () => {
  if (guideStep >= GUIDE.tips.length - 1) { guideOpen = false; guideStep = 0; }
  else guideStep += 1;
  renderGuide();
});
try {
  if (!localStorage.getItem(GUIDE_KEY)) {
    guideOpen = true;
    localStorage.setItem(GUIDE_KEY, "1");
  }
} catch {}
renderGuide();

/* État initial + mises à jour temps réel */
api("/api/state").then((data) => { state = data; render(); })
  .catch(() => setStatus("serveur injoignable", "warn"));
const events = new EventSource("/api/events");
events.addEventListener("message", (event) => {
  try {
    const data = JSON.parse(event.data);
    state = { ...state, ...data };
    render();
  } catch {}
});
events.addEventListener("error", () => setStatus("connexion perdue", "warn"));
