import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function httpsUrl(name, fallback) {
  const value = process.env[name] || fallback;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error(`${name} must use HTTPS.`);
  return parsed.href;
}

function defaultProfileDirectory() {
  if (process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "AcademicJarvis", "browser-profile");
  }
  return path.join(os.homedir(), ".academic-jarvis", "browser-profile");
}

export const sources = {
  webuntis: {
    key: "webuntis",
    label: "WebUntis",
    url: httpsUrl("WEBUNTIS_BASE_URL", "https://lam.webuntis.com/WebUntis/"),
    settleMs: 1_200,
    navigation: ["Mein Stundenplan", "Hausaufgaben", "Prüfungen", "Mitteilungen", "Kurse"],
  },
  academy: {
    key: "academy",
    label: "academy.am.lu",
    url: httpsUrl("ACADEMY_MOODLE_BASE_URL", "https://academy.am.lu/"),
    settleMs: 1_500,
  },
  edumoodle: {
    key: "edumoodle",
    label: "eduMoodle",
    url: httpsUrl("EDU_MOODLE_BASE_URL", "https://ssl.education.lu/eduMoodle/"),
    settleMs: 1_500,
  },
  teams: {
    key: "teams",
    label: "Microsoft Teams",
    url: httpsUrl("TEAMS_BASE_URL", "https://teams.microsoft.com/"),
    // Teams briefly renders its own shell before a delayed OAuth redirect.
    settleMs: 8_000,
  },
};

export const sourceKeys = Object.keys(sources);

export const workerConfig = {
  profileDirectory: path.resolve(process.env.JARVIS_BROWSER_PROFILE_DIR || defaultProfileDirectory()),
  stateDirectory: path.resolve(process.env.JARVIS_STATE_DIR || path.join(repositoryRoot, "work", "worker")),
  schoolFilesDirectory: path.resolve(process.env.JARVIS_SCHOOL_FILES_DIR || path.join(repositoryRoot, "work", "school-files")),
  timezone: process.env.JARVIS_TIMEZONE || "Europe/Luxembourg",
  syncIntervalMinutes: Math.max(5, Number.parseInt(process.env.JARVIS_SYNC_INTERVAL_MINUTES || "30", 10) || 30),
  agentPollSeconds: Math.max(15, Number.parseInt(process.env.JARVIS_AGENT_POLL_SECONDS || "60", 10) || 60),
  syncRequestPollSeconds: Math.max(5, Number.parseInt(process.env.JARVIS_SYNC_REQUEST_POLL_SECONDS || "15", 10) || 15),
  heartbeatSeconds: Math.max(30, Number.parseInt(process.env.JARVIS_HEARTBEAT_SECONDS || "60", 10) || 60),
  captureScreenshots: process.env.JARVIS_CAPTURE_SCREENSHOTS === "true",
};

export function requireSource(key) {
  const source = sources[key];
  if (!source) {
    throw new Error(`Unknown source “${key}”. Use one of: ${sourceKeys.join(", ")}.`);
  }
  return source;
}
