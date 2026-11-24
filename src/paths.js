import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "..");

export const home = process.env.SUPIDO_HOME
  ? path.resolve(process.env.SUPIDO_HOME)
  : path.join(projectRoot, "data");

export const paths = {
  home,
  config: path.join(home, "config.json"),
  queue: path.join(home, "queue.json"),
  history: path.join(home, "history.json"),
  downloads: path.join(home, "downloads"),
};
