import fs from "node:fs";
import crypto from "node:crypto";
import { paths } from "./paths.js";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(paths.home, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export function newId() {
  return crypto.randomBytes(6).toString("hex");
}

export function readQueue() {
  const data = readJson(paths.queue, { items: [] });
  return Array.isArray(data.items) ? data.items : [];
}

export function writeQueue(items) {
  writeJson(paths.queue, { items });
}

export function readHistory() {
  const data = readJson(paths.history, { items: [] });
  return Array.isArray(data.items) ? data.items : [];
}

export function writeHistory(items) {
  writeJson(paths.history, { items });
}

export function addItem(fields) {
  const items = readQueue();
  const item = {
    id: newId(),
    url: fields.url,
    type: fields.type || "auto",
    status: "queued",
    progress: 0,
    downloaded: 0,
    total: null,
    speed: null,
    eta: null,
    title: fields.title || null,
    filename: null,
    error: null,
    addedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  };
  items.push(item);
  writeQueue(items);
  return item;
}

export function updateItem(id, patch) {
  const items = readQueue();
  const index = items.findIndex((i) => i.id === id);
  if (index === -1) return null;
  items[index] = { ...items[index], ...patch };
  writeQueue(items);
  return items[index];
}

export function removeItem(id) {
  const items = readQueue();
  const next = items.filter((i) => i.id !== id);
  writeQueue(next);
  return items.length !== next.length;
}

export function archiveItem(id, config) {
  const items = readQueue();
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  writeQueue(items.filter((i) => i.id !== id));
  const history = readHistory();
  history.unshift({ ...item, archivedAt: new Date().toISOString() });
  writeHistory(history.slice(0, config.historyLimit));
  return item;
}

export function clearHistory() {
  writeHistory([]);
}

// Historique enrichi : l'interface doit savoir si le fichier est encore présent.
export function readHistoryWithFiles() {
  return readHistory().map((item) => ({
    ...item,
    fileExists: !!(item.path && fs.existsSync(item.path)),
  }));
}

export function removeHistoryItem(id) {
  const items = readHistory();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return false;
  writeHistory(next);
  return true;
}
