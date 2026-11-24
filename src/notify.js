import { spawnSync } from "node:child_process";
import os from "node:os";

function send(title, message) {
  try {
    if (os.platform() === "linux") {
      const result = spawnSync("notify-send", [title, message], { stdio: "ignore" });
      if (result.error) return false;
      return result.status === 0;
    }
    if (os.platform() === "darwin") {
      const script = `display notification "${message}" with title "${title}"`;
      return spawnSync("osascript", ["-e", script], { stdio: "ignore" }).status === 0;
    }
    if (os.platform() === "win32") {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${message}', '${title}')`;
      return spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "ignore" }).status === 0;
    }
  } catch {}
  return false;
}

export function notify(title, message, enabled = true) {
  if (!enabled) return;
  const ok = send(title, message);
  if (!ok) console.log(`[notification] ${title} - ${message}`);
}
