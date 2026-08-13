import fs from "node:fs/promises";

export async function readWorkerToken() {
  const file = process.env.JARVIS_WORKER_TOKEN_FILE;
  if (file) return (await fs.readFile(file, "utf8")).replace(/\r?\n$/, "");
  return process.env.JARVIS_WORKER_TOKEN?.trim() || null;
}

export function dashboardUrl() {
  const value = process.env.JARVIS_DASHBOARD_URL?.trim();
  if (!value) return null;
  const parsed = new URL(value);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !local) throw new Error("JARVIS_DASHBOARD_URL must use HTTPS.");
  return parsed.origin;
}

function discoveryCount(result) {
  if (Array.isArray(result.items)) return result.items.length;
  if (Array.isArray(result.sections)) {
    return result.sections.reduce((total, section) => total + (Array.isArray(section.items) ? section.items.length : 0), 0);
  }
  if (Array.isArray(result.courses)) return result.courses.length;
  if (Array.isArray(result.visibleWorkspaceItems)) return result.visibleWorkspaceItems.length;
  return 0;
}

export async function publishSyncResult(source, result, startedAt) {
  const baseUrl = dashboardUrl();
  const token = await readWorkerToken();
  if (!baseUrl || !token) return { state: "not_configured" };

  const items = Array.isArray(result.items) ? result.items : [];
  const response = await fetch(`${baseUrl}/api/worker/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: source.key,
      health: result.health ?? { state: result.state ?? "error", checkedAt: new Date().toISOString() },
      items,
      startedAt,
      finishedAt: new Date().toISOString(),
      discoveryCount: discoveryCount(result),
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Dashboard sync rejected with HTTP ${response.status}.`);
  }
  return { state: "published", ...(await response.json()) };
}
