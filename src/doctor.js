import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveYtDlpForDoctor(config) {
  const candidate = config.ytDlpPath || "yt-dlp";
  if (path.isAbsolute(candidate)) return candidate;
  const local = path.join(os.homedir(), ".local", "bin", "yt-dlp");
  if (fs.existsSync(local)) return local;
  return candidate;
}
