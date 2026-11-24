import fs from "node:fs";
import { paths, projectRoot } from "./paths.js";

export function defaultConfig() {
  return {
    downloadDir: paths.downloads,
    ytDlpPath: "yt-dlp",
    format: "bv*+ba/b",
    concurrency: 2,
    port: 8787,
    speedLimitKiB: 0,
    notifications: true,
    historyLimit: 200,
  };
}

function ensureHome() {
  fs.mkdirSync(paths.home, { recursive: true });
}

export function loadConfig() {
  ensureHome();
  const base = defaultConfig();
  try {
    const raw = JSON.parse(fs.readFileSync(paths.config, "utf8"));
    return { ...base, ...raw };
  } catch {
    return base;
  }
}

export function saveConfig(next) {
  ensureHome();
  const merged = { ...loadConfig(), ...next };
  const tmp = `${paths.config}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n");
  fs.renameSync(tmp, paths.config);
  return merged;
}

export function configValue(key, value) {
  const config = loadConfig();
  if (value === undefined) return config[key];
  const known = Object.keys(defaultConfig());
  if (!known.includes(key)) throw new Error(`clé inconnue: ${key} (clés: ${known.join(", ")})`);
  let parsed = value;
  if (["concurrency", "port", "speedLimitKiB", "historyLimit"].includes(key)) {
    parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${key} doit être un nombre >= 0`);
  }
  if (key === "notifications") parsed = value === "true" || value === "1" || value === "yes";
  return saveConfig({ [key]: parsed })[key];
}

export function describeConfig() {
  const c = loadConfig();
  return [
    `downloadDir      ${c.downloadDir}`,
    `ytDlpPath        ${c.ytDlpPath}`,
    `format           ${c.format}`,
    `concurrency      ${c.concurrency}`,
    `port             ${c.port}`,
    `speedLimitKiB    ${c.speedLimitKiB} (0 = illimité)`,
    `notifications    ${c.notifications}`,
    `historyLimit     ${c.historyLimit}`,
    ``,
    `Données: ${paths.home}`,
    `Projet:  ${projectRoot}`,
  ].join("\n");
}
