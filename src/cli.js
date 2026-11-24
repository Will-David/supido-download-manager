import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { configValue, describeConfig, loadConfig, saveConfig } from "./config.js";
import { resolveYtDlpForDoctor } from "./doctor.js";
import { Manager } from "./manager.js";
import { paths } from "./paths.js";
import { addItem, clearHistory, readHistory, readQueue, removeItem, updateItem } from "./store.js";
import { createServer } from "./web.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binScript = path.join(projectRoot, "bin", "supido.js");
const pidFile = path.join(paths.home, "server.pid");

const HELP = `SUPIDO - gestionnaire de téléchargements vidéo

Usage:
  supido add <url> [url...] [--type=auto|video|direct]   Ajouter à la file
  supido list                                            Voir la file
  supido status                                          Résumé
  supido history [--clear]                               Historique
  supido config [clé [valeur]]                           Voir/modifier la config
  supido pause|resume|cancel|retry|rm <id>               Piloter une tâche
  supido start|stop|restart [--port=8787]                Gérer le serveur en arrière-plan
  supido serve [--port=8787]                             Lancer le serveur au premier plan
  supido doctor                                          Vérifier l'installation
  supido help                                            Cette aide

Interface web: http://localhost:<port> (par défaut 8787)`;

function flags(args) {
  const options = {};
  const rest = [];
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const [key, ...values] = arg.slice(2).split("=");
      options[key] = values.length ? values.join("=") : true;
    } else rest.push(arg);
  }
  return { options, rest };
}

function formatBytes(value) {
  if (!value && value !== 0) return "-";
  const units = ["o", "Ko", "Mo", "Go"];
  let n = Number(value);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

function printQueue(items) {
  if (!items.length) return console.log("File vide. Ajoutez une URL avec: supido add <url>");
  for (const item of items) {
    const bar = "█".repeat(Math.round((item.progress || 0) / 5)).padEnd(20, "░");
    const detail = item.status === "error" ? ` - ${item.error}` : item.filename ? ` - ${item.filename}` : "";
    console.log(`${item.id}  ${bar} ${String(item.progress || 0).padStart(3)}%  ${item.status.padEnd(11)} ${item.url}${detail}`);
  }
}

function readPid() {
  try { return Number(fs.readFileSync(pidFile, "utf8").trim()) || null; } catch { return null; }
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopServer(quiet = false) {
  const pid = readPid();
  if (!pid || !isAlive(pid)) {
    try { fs.unlinkSync(pidFile); } catch {}
    if (!quiet) console.log("Aucun serveur enregistré.");
    return false;
  }
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 30; i++) {
    if (!isAlive(pid)) break;
    await delay(100);
  }
  if (isAlive(pid)) process.kill(pid, "SIGKILL");
  try { fs.unlinkSync(pidFile); } catch {}
  if (!quiet) console.log(`SUPIDO arrete (pid ${pid}).`);
  return true;
}

function startServer(port) {
  fs.mkdirSync(paths.home, { recursive: true });
  const child = spawn(process.execPath, [binScript, "serve", `--port=${port}`], {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  fs.writeFileSync(pidFile, `${child.pid}\n`);
  console.log(`SUPIDO demarre (pid ${child.pid}) : http://localhost:${port}`);
  return child.pid;
}

export async function main(argv) {
  const [command, ...args] = argv;
  const { options, rest } = flags(args);

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;

    case "add": {
      if (!rest.length) throw new Error("URL requise");
      const type = options.type || "auto";
      for (const url of rest) {
        const item = addItem({ url, type });
        console.log(`ajouté ${item.id}  ${item.url}  (${type})`);
      }
      console.log("Lancez `supido serve` pour traiter la file.");
      return;
    }

    case "list":
    case "ls":
      return printQueue(readQueue());

    case "status": {
      const queue = readQueue();
      const counts = queue.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
      console.log(`File: ${queue.length} tâche(s) - ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ") || "vide"}`);
      console.log(`Historique: ${readHistory().length} entrée(s)`);
      return printQueue(queue);
    }

    case "history": {
      if (options.clear) { clearHistory(); console.log("Historique effacé."); return; }
      const history = readHistory();
      if (!history.length) return console.log("Historique vide.");
      for (const item of history) console.log(`${item.finishedAt || item.archivedAt}  ${item.status.padEnd(9)} ${formatBytes(item.bytes)}  ${item.filename || item.url}`);
      return;
    }

    case "config": {
      if (!rest.length) return console.log(describeConfig());
      if (rest.length === 1) return console.log(`${rest[0]} = ${configValue(rest[0])}`);
      const value = configValue(rest[0], rest.slice(1).join(" "));
      console.log(`${rest[0]} = ${value}`);
      return;
    }

    case "pause":
    case "resume":
    case "cancel":
    case "retry":
    case "rm": {
      if (!rest[0]) throw new Error("ID requis");
      if (command === "rm") {
        console.log(removeItem(rest[0]) ? "supprimé" : "introuvable");
      } else {
        const status = { pause: "paused", resume: "queued", retry: "queued", cancel: "cancelled" }[command];
        console.log(updateItem(rest[0], { status, error: null }) ? `${rest[0]} -> ${status}` : "introuvable");
      }
      return;
    }

    case "start": {
      const port = Number(options.port || loadConfig().port);
      const pid = readPid();
      if (pid && isAlive(pid)) {
        console.log(`SUPIDO deja actif (pid ${pid}) : http://localhost:${port}`);
        return;
      }
      startServer(port);
      return;
    }

    case "stop":
      await stopServer();
      return;

    case "restart":
      await stopServer(true);
      startServer(Number(options.port || loadConfig().port));
      return;

    case "serve": {
      const config = loadConfig();
      const port = Number(options.port || config.port);
      saveConfig({ port });
      const manager = new Manager();
      const server = createServer(manager);
      manager.start();
      // Sans hôte explicite, Node écoute en double pile (IPv6 + IPv4).
      // Cela évite les pages blanches quand Windows résout `localhost` en ::1.
      server.listen(port, () => {
        console.log(`SUPIDO prêt: http://localhost:${port}`);
        console.log(`Dossier de téléchargement: ${config.downloadDir}`);
        console.log("Ctrl+C pour arrêter.");
      });
      const shutdown = () => {
        manager.stop();
        if (typeof server.closeClients === "function") server.closeClients();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 2000).unref();
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      return;
    }

    case "doctor": {
      const config = loadConfig();
      console.log(`Node: ${process.version}`);
      console.log(`yt-dlp: ${resolveYtDlpForDoctor(config)}`);
      const result = spawnSync(resolveYtDlpForDoctor(config), ["--version"], { encoding: "utf8" });
      console.log(`version yt-dlp: ${result.status === 0 ? result.stdout.trim() : "ERREUR: " + result.stderr.trim()}`);
      fs.mkdirSync(config.downloadDir, { recursive: true });
      console.log(`dossier de téléchargement accessible: ${fs.accessSync ? "oui" : "?"} (${config.downloadDir})`);
      console.log(describeConfig());
      return;
    }

    default:
      throw new Error(`commande inconnue: ${command}\n${HELP}`);
  }
}
