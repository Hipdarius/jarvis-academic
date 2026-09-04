import fs from "node:fs/promises";

export async function readWorkerToken() {
  const file = process.env.JARVIS_WORKER_TOKEN_FILE;
  if (file) return (await fs.readFile(file, "utf8")).replace(/\r?\n$/, "");
  return process.env.JARVIS_WORKER_TOKEN?.trim() || null;
}

export async function readSitesBypassToken() {
  const file = process.env.JARVIS_SITES_BYPASS_TOKEN_FILE;
  if (file) return (await fs.readFile(file, "utf8")).replace(/\r?\n$/, "");
  return process.env.JARVIS_SITES_BYPASS_TOKEN?.trim() || null;
}

export async function workerApiHeaders(workerToken) {
  const headers = {
    Authorization: `Bearer ${workerToken}`,
    "Content-Type": "application/json",
  };
  const sitesBypassToken = await readSitesBypassToken();
  if (sitesBypassToken) {
    headers["OAI-Sites-Authorization"] = `Bearer ${sitesBypassToken}`;
  }
  return headers;
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

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function boundedSyncPayload(payload, maxBytes = 1_350_000) {
  const bounded = {
    ...payload,
    items: [],
    documents: [],
    warnings: Array.isArray(payload.warnings) ? payload.warnings.slice(0, 100) : [],
  };
  let truncated = false;
  for (const item of Array.isArray(payload.items) ? payload.items : []) {
    const candidate = { ...bounded, items: [...bounded.items, item] };
    if (jsonBytes(candidate) > maxBytes) {
      truncated = true;
      break;
    }
    bounded.items.push(item);
  }
  for (const document of Array.isArray(payload.documents) ? payload.documents : []) {
    const excerpt = typeof document.extractedText === "string" ? document.extractedText.slice(0, 12_000) : null;
    const candidateDocument = { ...document, extractedText: excerpt };
    let candidate = { ...bounded, documents: [...bounded.documents, candidateDocument] };
    if (jsonBytes(candidate) > maxBytes && excerpt) {
      candidateDocument.extractedText = null;
      candidate = { ...bounded, documents: [...bounded.documents, candidateDocument] };
      truncated = true;
    }
    if (jsonBytes(candidate) > maxBytes) {
      truncated = true;
      break;
    }
    bounded.documents.push(candidateDocument);
  }
  if (truncated && !bounded.warnings.includes("sync_payload_truncated")) bounded.warnings.push("sync_payload_truncated");
  while (jsonBytes(bounded) > maxBytes && bounded.documents.length) bounded.documents.pop();
  while (jsonBytes(bounded) > maxBytes && bounded.items.length) bounded.items.pop();
  return bounded;
}

export async function publishSyncResult(source, result, startedAt) {
  const baseUrl = dashboardUrl();
  const token = await readWorkerToken();
  if (!baseUrl || !token) return { state: "not_configured" };

  const items = Array.isArray(result.items) ? result.items : [];
  const payload = boundedSyncPayload({
    source: source.key,
    health: result.health ?? { state: result.state ?? "error", checkedAt: new Date().toISOString() },
    items,
    documents: Array.isArray(result.documents) ? result.documents : [],
    warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 100) : [],
    extractorState: result.extractorState ?? "unknown",
    agentAutoTriage: process.env.JARVIS_AGENT_AUTO_TRIAGE !== "false",
    startedAt,
    finishedAt: new Date().toISOString(),
    discoveryCount: discoveryCount(result),
  });
  const response = await fetch(`${baseUrl}/api/worker/sync`, {
    method: "POST",
    headers: await workerApiHeaders(token),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Dashboard sync rejected with HTTP ${response.status}.`);
  }
  return { state: "published", ...(await response.json()) };
}

async function workerPost(pathname, body) {
  const baseUrl = dashboardUrl();
  const token = await readWorkerToken();
  if (!baseUrl || !token) return { state: "not_configured" };
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: await workerApiHeaders(token),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Dashboard worker request rejected with HTTP ${response.status}.`);
  return response.json();
}

export function publishWorkerHeartbeat(input) {
  return workerPost("/api/worker/heartbeat", input);
}

export function claimQueuedSyncRequest() {
  return workerPost("/api/worker/sync-requests/claim", {});
}

export function finishQueuedSyncRequest(request, result) {
  return workerPost(`/api/worker/sync-requests/${encodeURIComponent(request.id)}/result`, {
    leaseId: request.leaseId,
    ...result,
  });
}
