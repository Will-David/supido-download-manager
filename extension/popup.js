const $ = (id) => document.getElementById(id);
let base = "http://localhost:8787";
let items = [];

/* Meme jeu d'icones que l'interface web : Phosphor Duotone via Iconify. */
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
function setStatus(text, kind) {
  const icons = {
    ok: "ph:check-circle-duotone",
    off: "ph:x-circle-duotone",
    warn: "ph:warning-circle-duotone",
  };
  setIcon($("status-icon"), icons[kind] || icons.warn);
  $("status").className = `status ${kind}`;
  $("status-text").textContent = text;
}
paintIcons();

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function candidates() {
  const list = [base];
  try {
    const parsed = new URL(base);
    let alt = null;
    if (parsed.hostname === "localhost") alt = "127.0.0.1";
    else if (parsed.hostname === "127.0.0.1") alt = "localhost";
    if (alt) {
      parsed.hostname = alt;
      const value = parsed.href.replace(/\/$/, "");
      if (!list.includes(value)) list.push(value);
    }
  } catch {}
  return list;
}

async function ping() {
  for (const candidate of candidates()) {
    try {
      const response = await fetch(`${candidate}/api/state`, { cache: "no-store" });
      if (!response.ok) continue;
      base = candidate;
      setStatus("serveur actif", "ok");
      return true;
    } catch {}
  }
  setStatus("serveur injoignable", "off");
  return false;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((item) => {
    if (!item || !item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function scan() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  $("message").textContent = "Analyse de la page et des lecteurs intégrés…";
  const collected = [];
  try {
    let frameIds = [];
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      frameIds = (frames || []).map((frame) => frame.frameId);
    } catch {}
    if (!frameIds.length) frameIds = [0];

    const results = await Promise.allSettled(frameIds.map((frameId) =>
      chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frameId] },
        files: ["content.js"],
      })
    ));

    for (const entry of results) {
      if (entry.status !== "fulfilled" || !Array.isArray(entry.value)) continue;
      for (const injection of entry.value) {
        if (Array.isArray(injection.result)) collected.push(...injection.result);
      }
    }
  } catch (error) {
    $("message").textContent = `Analyse impossible : ${error.message}`;
    return;
  }

  if (tab.url && /^https?:\/\//.test(tab.url)) {
    collected.unshift({
      url: tab.url,
      title: tab.title || "Page ouverte",
      source: "Page ouverte",
      type: "video",
      page: tab.url,
    });
  }
  items = dedupe(collected);
  render();
}

function render() {
  const list = $("list");
  list.replaceChildren();
  if (!items.length) {
    $("message").textContent = "Aucune vidéo détectée sur cette page.";
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Essayez une page avec un lecteur vidéo ou un lien de fichier.";
    list.append(empty);
    return;
  }
  $("message").textContent = `${items.length} vidéo(s) détectée(s).`;

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "item";

    const top = document.createElement("div");
    top.className = "top";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = item.title || "Vidéo";
    title.title = item.url;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = item.type === "direct" ? "fichier" : "vidéo";
    top.append(title, badge);

    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = `${item.source} · ${hostOf(item.url)}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.innerHTML = iconElement("ph:download-simple-duotone") + "<span>Ajouter à SUPIDO</span>";
    button.addEventListener("click", () => send(item, button));

    card.append(top, meta, button);
    list.append(card);
  }
  paintIcons(list);
}

async function send(item, button) {
  button.disabled = true;
  button.innerHTML = iconElement("ph:warning-circle-duotone") + "<span>Envoi…</span>";
  paintIcons(button);
  try {
    const response = await fetch(`${base}/api/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: item.url, type: item.type || "video", title: item.title }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    button.innerHTML = iconElement("ph:check-circle-duotone") + "<span>Ajouté à la file</span>";
    button.className = "btn done";
  } catch (error) {
    button.innerHTML = iconElement("ph:x-circle-duotone") + "<span>Erreur</span>";
    button.className = "btn error";
    $("message").textContent = `Envoi impossible : ${error.message}`;
  }
  paintIcons(button);
}

const settings = document.querySelector(".settings");
function updateSettingsIcon() {
  setIcon($("settings-icon"), settings.open ? "ph:minus-duotone" : "ph:plus-duotone");
}
settings.addEventListener("toggle", updateSettingsIcon);
updateSettingsIcon();

$("scan").addEventListener("click", scan);
$("open").addEventListener("click", () => chrome.tabs.create({ url: base }));
$("save").addEventListener("click", async () => {
  base = $("base").value.trim().replace(/\/$/, "") || "http://localhost:8787";
  await chrome.storage.local.set({ base });
  await ping();
});

(async () => {
  const stored = await chrome.storage.local.get("base");
  if (stored.base) base = stored.base;
  $("base").value = base;
  await ping();
  await scan();
})();
