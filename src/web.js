import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig } from "./config.js";
import { addItem, clearHistory, readHistoryWithFiles, readQueue, removeHistoryItem } from "./store.js";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function corsHeaders(req) {
  const origin = req.headers.origin || "";
  const allowed = /^chrome-extension:\/\//.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!allowed) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
}

function json(req, res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...corsHeaders(req),
  });
  res.end(body);
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Requête trop volumineuse");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function serveStatic(req, res, name) {
  const file = path.join(webDir, path.basename(name));
  if (!fs.existsSync(file)) return json(req, res, 404, { error: "introuvable" });
  res.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

export function createServer(manager) {
  const clients = new Set();
  const publish = (payload) => {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
      try { res.write(data); } catch { clients.delete(res); }
    }
  };
  manager.on("state", (state) => publish({ type: "state", ...state }));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...corsHeaders(req), "access-control-max-age": "600" });
        return res.end();
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return serveStatic(req, res, "index.html");
      if (req.method === "GET" && ["/app.js", "/icons.js", "/style.css"].includes(url.pathname)) return serveStatic(req, res, url.pathname.slice(1));

      if (req.method === "GET" && url.pathname === "/api/state") {
        return json(req, res, 200, {
          queue: readQueue(),
          history: readHistoryWithFiles(),
          config: loadConfig(),
          running: manager.running,
          active: [...manager.active.keys()],
        });
      }
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          ...corsHeaders(req),
        });
        res.write(`data: ${JSON.stringify({ type: "state", queue: readQueue(), history: readHistoryWithFiles(), config: loadConfig(), running: manager.running, active: [...manager.active.keys()] })}\n\n`);
        clients.add(res);
        const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 15000);
        req.on("close", () => { clearInterval(ping); clients.delete(res); });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/items") {
        const data = await body(req);
        if (!data.url || typeof data.url !== "string") return json(req, res, 400, { error: "URL requise" });
        const item = addItem({ url: data.url.trim(), type: data.type || "auto", title: data.title || null });
        manager.emitState();
        return json(req, res, 201, item);
      }
      if (req.method === "POST" && url.pathname === "/api/action") {
        const data = await body(req);
        const actions = { pause: manager.pause, resume: manager.resume, cancel: manager.cancel, retry: manager.retry, remove: manager.remove };
        const fn = actions[data.action];
        if (!fn) return json(req, res, 400, { error: "action inconnue" });
        const ok = fn.call(manager, data.id);
        return json(req, res, ok ? 200 : 404, { ok });
      }
      if (req.method === "PUT" && url.pathname === "/api/config") {
        const data = await body(req);
        const config = saveConfig(data);
        manager.emitState();
        return json(req, res, 200, config);
      }
      if (req.method === "POST" && url.pathname === "/api/history/clear") {
        clearHistory();
        manager.emitState();
        return json(req, res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/history/redownload") {
        const data = await body(req);
        const previous = readHistoryWithFiles().find((item) => item.id === data.id);
        if (!previous) return json(req, res, 404, { error: "entree introuvable" });
        const item = addItem({ url: previous.url, type: previous.type || "auto", title: previous.title || null });
        manager.emitState();
        return json(req, res, 201, item);
      }
      if (req.method === "POST" && url.pathname === "/api/history/remove") {
        const data = await body(req);
        const ok = removeHistoryItem(data.id);
        manager.emitState();
        return json(req, res, ok ? 200 : 404, { ok });
      }
      return json(req, res, 404, { error: "route inconnue" });
    } catch (error) {
      return json(req, res, 400, { error: error.message || String(error) });
    }
  });

  // Les connexions SSE doivent être fermées avant l'arrêt : sinon
  // server.close() attend indéfiniment et laisse un processus zombie.
  server.closeClients = () => {
    for (const res of clients) {
      try { res.end(); } catch {}
    }
    clients.clear();
  };
  return server;
}
