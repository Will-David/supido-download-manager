import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { resolveMediaUrl } from "./resolve.js";

function resolveYtDlp(config) {
  const candidate = config.ytDlpPath || "yt-dlp";
  if (path.isAbsolute(candidate)) {
    if (!fs.existsSync(candidate)) throw new Error(`yt-dlp introuvable: ${candidate}`);
    return candidate;
  }
  const local = path.join(os.homedir(), ".local", "bin", "yt-dlp");
  if (fs.existsSync(local)) return local;
  return candidate;
}

function safeName(name) {
  return String(name || "download")
    .replace(/[\u2011\u2013\u2014\u2015]/g, "-")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .slice(0, 160) || "download";
}

function filenameFromResponse(response, url) {
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^;"']+)/i);
  if (match) return safeName(decodeURIComponent(match[1]));
  try {
    const base = path.basename(new URL(url).pathname);
    if (base) return safeName(decodeURIComponent(base));
  } catch {}
  return "download";
}

function parseBytes(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function downloadVideo(item, config, onProgress, signal) {
  const binary = resolveYtDlp(config);
  fs.mkdirSync(config.downloadDir, { recursive: true });

  // Certains lecteurs cachent le flux HLS dans une iframe : on le révèle
  // juste avant le téléchargement pour que le jeton d'URL soit à jour.
  const resolved = await resolveMediaUrl(item.url, signal);
  if (resolved.title) onProgress({ title: resolved.title });
  const title = resolved.title || item.title;
  const nameTemplate = title
    ? `${item.id}.${safeName(title).replace(/%/g, "%%")}.%(ext)s`
    : `${item.id}.%(title)s.%(ext)s`;
  const output = path.join(config.downloadDir, nameTemplate);
  const args = [
    "--no-warnings",
    "--newline",
    "--no-playlist",
    "--continue",
    "--no-overwrites",
    "--socket-timeout",
    "20",
    "-f",
    config.format || "best[ext=mp4]/best",
    "-o",
    output,
    "--progress-template",
    "download|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.status)s|%(progress.fragment_index)s|%(progress.fragment_count)s",
    resolved.url,
  ];
  if (config.speedLimitKiB > 0) args.unshift("--limit-rate", `${Math.round(config.speedLimitKiB)}K`);

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let destination = null;
    let settled = false;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (err) reject(err);
      else resolve(result);
    };

    const killTimer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("yt-dlp a dépassé le délai maximal (2 h)"));
    }, 2 * 60 * 60 * 1000);

    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.startsWith("download|")) {
          const parts = line.split("|");
          // yt-dlp renvoie "NA" pour les champs inconnus (notamment total_bytes
          // sur les flux HLS). On utilise alors l'estimation ou les fragments.
          const downloaded = parseBytes(parts[1]);
          const total = parseBytes(parts[2]) ?? parseBytes(parts[3]);
          const fragIndex = parseBytes(parts[7]);
          const fragCount = parseBytes(parts[8]);
          let percent = null;
          if (total && downloaded !== null) percent = (downloaded / total) * 100;
          else if (fragCount && fragIndex !== null) percent = (fragIndex / fragCount) * 100;
          onProgress({
            downloaded,
            total,
            speed: parseBytes(parts[4]),
            eta: Number(parts[5]) || null,
            phase: parts[6] || "downloading",
            percent,
          });
        }
        const dest = line.match(/\[download\] Destination:\s*(.+)$/);
        if (dest) destination = dest[1].trim();
        const already = line.match(/\[download\] (.+) has already been downloaded/);
        if (already) destination = already[1].trim();
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (error) => finish(new Error(`Impossible de lancer yt-dlp: ${error.message}`)));
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        const detail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");
        return finish(new Error(detail || `yt-dlp a quitté avec le code ${code}`));
      }
      let filename = destination ? path.basename(destination) : null;
      if (!filename || !fs.existsSync(path.join(config.downloadDir, filename))) {
        const prefix = `${item.id}.`;
        const matches = fs
          .readdirSync(config.downloadDir)
          .filter((name) => name.startsWith(prefix) && !name.endsWith(".part") && !name.endsWith(".ytdl"))
          .map((name) => ({ name, stat: fs.statSync(path.join(config.downloadDir, name)) }))
          .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
        filename = matches[0]?.name ?? filename;
      }
      if (!filename) return finish(new Error("Téléchargement terminé mais fichier introuvable"));
      const full = path.join(config.downloadDir, filename);
      finish(null, { filename, path: full, bytes: fs.statSync(full).size });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function downloadDirect(item, config, onProgress, signal) {
  fs.mkdirSync(config.downloadDir, { recursive: true });
  const probe = await fetch(item.url, { method: "GET", headers: { Range: "bytes=0-0" }, signal, redirect: "follow" });
  if (!probe.ok && probe.status !== 206) throw new Error(`HTTP ${probe.status}`);
  const type = probe.headers.get("content-type") || "";
  if (type.startsWith("text/html") && !/\.(mp4|webm|mkv|mov|avi|m4v|mp3|m4a)(\?|$)/i.test(item.url)) {
    await probe.body?.cancel();
    throw new Error("Cette URL renvoie une page HTML, pas un fichier. Utilisez le type vidéo (yt-dlp).");
  }
  await probe.body?.cancel();

  const name = filenameFromResponse(probe, item.url);
  const finalPath = path.join(config.downloadDir, `${item.id}.${name}`);
  const partPath = `${finalPath}.part`;
  let existing = 0;
  try {
    existing = fs.statSync(partPath).size;
  } catch {}

  const wantsResume = existing > 0;
  const headers = wantsResume ? { Range: `bytes=${existing}-` } : {};
  const response = await fetch(item.url, { headers, signal, redirect: "follow" });
  if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);

  // Certains serveurs ignorent Range et renvoient 200 avec le fichier complet :
  // dans ce cas on repart de zéro au lieu d'ajouter un doublon au fichier .part.
  const contentRange = response.headers.get("content-range") || "";
  const restart = wantsResume && (response.status !== 206 || (contentRange && !contentRange.startsWith(`bytes ${existing}-`)));
  const offset = restart ? 0 : existing;
  const remaining = Number(response.headers.get("content-length")) || null;
  const total = response.status === 206 && remaining ? offset + remaining : remaining;
  const file = createWriteStream(partPath, { flags: offset > 0 ? "a" : "w" });
  let downloaded = offset;
  let lastEmit = 0;

  await pipeline(
    response.body,
    async function* (source) {
      for await (const chunk of source) {
        downloaded += chunk.byteLength;
        const now = Date.now();
        if (now - lastEmit > 250) {
          lastEmit = now;
          onProgress({ downloaded, total, speed: null, eta: null, phase: "downloading" });
        }
        if (config.speedLimitKiB > 0) {
          const expected = (chunk.byteLength / (config.speedLimitKiB * 1024)) * 1000;
          if (expected > 1) await delay(expected);
        }
        yield chunk;
      }
    },
    file,
  );

  fs.renameSync(partPath, finalPath);
  return { filename: path.basename(finalPath), path: finalPath, bytes: fs.statSync(finalPath).size };
}

export function pickEngine(url, type) {
  if (type === "video" || type === "yt-dlp") return "video";
  if (type === "direct" || type === "http") return "direct";
  return /\.(mp4|webm|mkv|mov|avi|m4v|mp3|m4a|wav)(\?|$)/i.test(url) ? "direct" : "video";
}
