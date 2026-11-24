import { EventEmitter } from "node:events";
import { loadConfig } from "./config.js";
import { downloadDirect, downloadVideo, pickEngine } from "./engine.js";
import { notify } from "./notify.js";
import { archiveItem, readHistoryWithFiles, readQueue, removeItem, updateItem } from "./store.js";

export class Manager extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this.timer = null;
    this.active = new Map();
  }

  snapshot() {
    return { queue: readQueue(), history: readHistoryWithFiles(), active: [...this.active.keys()] };
  }

  emitState() {
    this.emit("state", this.snapshot());
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
    this.emitState();
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const controller of this.active.values()) controller.abort();
    this.emitState();
  }

  async tick() {
    if (!this.running) return;
    const config = loadConfig();
    const queue = readQueue();

    for (const item of queue) {
      if (item.status === "paused" && this.active.has(item.id)) {
        this.active.get(item.id).abort();
      }
    }

    const slots = Math.max(0, config.concurrency - this.active.size);
    if (slots === 0) return;
    const next = queue.filter((i) => i.status === "queued").slice(0, slots);
    for (const item of next) void this.run(item, config);
  }

  async run(item, config) {
    if (this.active.has(item.id)) return;
    const controller = new AbortController();
    this.active.set(item.id, controller);
    updateItem(item.id, {
      status: "downloading",
      error: null,
      startedAt: new Date().toISOString(),
      engine: pickEngine(item.url, item.type),
    });
    this.emitState();

    const onProgress = (progress) => {
      const current = readQueue().find((i) => i.id === item.id);
      if (!current || current.status !== "downloading") return;
      if (progress.title && !current.title) updateItem(item.id, { title: progress.title });
      let pct = progress.percent;
      if (pct == null && progress.total && progress.downloaded != null) {
        pct = (progress.downloaded / progress.total) * 100;
      }
      if (pct == null) pct = Number(current.progress) || 0;
      // L'estimation de taille varie pendant un flux HLS : la barre ne doit jamais reculer.
      pct = Math.max(Number(current.progress) || 0, Math.min(100, Math.round(pct)));
      updateItem(item.id, {
        downloaded: progress.downloaded ?? current.downloaded,
        total: progress.total ?? current.total,
        speed: progress.speed,
        eta: progress.eta,
        progress: pct,
      });
      this.emit("progress", { id: item.id, progress: pct });
    };

    try {
      const engine = pickEngine(item.url, item.type);
      const result = engine === "direct"
        ? await downloadDirect(item, config, onProgress, controller.signal)
        : await downloadVideo(item, config, onProgress, controller.signal);

      updateItem(item.id, {
        status: "done",
        progress: 100,
        filename: result.filename,
        path: result.path,
        bytes: result.bytes,
        speed: null,
        eta: null,
        finishedAt: new Date().toISOString(),
      });
      archiveItem(item.id, loadConfig());
      notify("SUPIDO - terminé", result.filename, loadConfig().notifications);
    } catch (error) {
      const aborted = controller.signal.aborted;
      const fresh = readQueue().find((i) => i.id === item.id);
      const status = fresh?.status ?? "queued";
      if (status === "cancelled") {
        archiveItem(item.id, loadConfig());
      } else if (status === "paused") {
        updateItem(item.id, { speed: null, eta: null });
      } else {
        updateItem(item.id, {
          status: "error",
          error: aborted ? "Interrompu" : String(error.message || error).slice(0, 1000),
          speed: null,
          eta: null,
          finishedAt: new Date().toISOString(),
        });
        notify("SUPIDO - échec", `${item.url}\n${error.message || error}`, loadConfig().notifications);
      }
    } finally {
      this.active.delete(item.id);
      this.emitState();
    }
  }

  pause(id) {
    const fresh = readQueue().find((i) => i.id === id);
    if (!fresh || fresh.status !== "downloading") return false;
    updateItem(id, { status: "paused", speed: null, eta: null });
    this.active.get(id)?.abort();
    this.emitState();
    return true;
  }

  resume(id) {
    const fresh = readQueue().find((i) => i.id === id);
    if (!fresh || !["paused", "error"].includes(fresh.status)) return false;
    updateItem(id, { status: "queued", error: null });
    this.emitState();
    return true;
  }

  cancel(id) {
    const fresh = readQueue().find((i) => i.id === id);
    if (!fresh) return false;
    updateItem(id, { status: "cancelled", error: null });
    this.active.get(id)?.abort();
    this.emitState();
    return true;
  }

  retry(id) {
    return this.resume(id);
  }

  remove(id) {
    this.active.get(id)?.abort();
    const ok = removeItem(id);
    this.emitState();
    return ok;
  }
}
