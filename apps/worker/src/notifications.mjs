import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { repositoryRoot, workerConfig } from "./config.mjs";

const stateFile = path.join(workerConfig.stateDirectory, "notification-state.json");
const toastScript = path.join(repositoryRoot, "scripts", "show-jarvis-toast.ps1");

function luxembourgHour(now) {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: workerConfig.timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now));
}

export function isQuietHours(now = new Date()) {
  const hour = luxembourgHour(now);
  return hour >= 22 || hour < 7;
}

async function readState() {
  try {
    const parsed = JSON.parse(await fs.readFile(stateFile, "utf8"));
    return {
      delivered: parsed?.delivered && typeof parsed.delivered === "object" ? parsed.delivered : {},
      pending: Array.isArray(parsed?.pending) ? parsed.pending : [],
    };
  } catch {
    return { delivered: {}, pending: [] };
  }
}

async function showToast(alert) {
  if (process.platform !== "win32") return false;
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", toastScript], {
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
    child.stdin.end(JSON.stringify({ title: alert.title, body: alert.body }));
  });
}

export async function deliverAlerts(incoming, now = new Date()) {
  const state = await readState();
  const cutoff = now.getTime() - 30 * 86_400_000;
  state.delivered = Object.fromEntries(Object.entries(state.delivered).filter(([, value]) => Date.parse(String(value)) >= cutoff));
  const pending = new Map(state.pending.map((alert) => [alert.fingerprint, alert]));
  for (const alert of Array.isArray(incoming) ? incoming : []) {
    if (!alert?.fingerprint || state.delivered[alert.fingerprint]) continue;
    pending.set(alert.fingerprint, alert);
  }
  const quiet = isQuietHours(now);
  const remaining = [];
  let delivered = 0;
  for (const alert of pending.values()) {
    if (quiet && alert.severity !== "urgent") {
      remaining.push(alert);
      continue;
    }
    if (await showToast(alert)) {
      state.delivered[alert.fingerprint] = now.toISOString();
      delivered += 1;
    } else {
      remaining.push(alert);
    }
  }
  state.pending = remaining.slice(-100);
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { delivered, deferred: state.pending.length };
}
