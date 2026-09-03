import { createHash } from "node:crypto";
import path from "node:path";

import { extractDocumentText } from "./documents.mjs";
import { dashboardUrl, readWorkerToken, workerApiHeaders } from "./publish.mjs";

const maxUploadBytes = 25 * 1_024 * 1_024;

function pageCountFromText(value) {
  const pages = [...String(value).matchAll(/^\[Page (\d+)\]/gim)].map((match) => Number.parseInt(match[1], 10));
  return pages.length ? Math.max(...pages) : null;
}

function extractorFor(mimeType, extension) {
  if (mimeType === "application/pdf" || extension === ".pdf") return "pdfjs-text-v2";
  return "plain-text-v1";
}

export async function processUploadBytes(upload, body) {
  if (!upload || typeof upload !== "object") throw new Error("Upload metadata is missing.");
  if (!Buffer.isBuffer(body)) throw new Error("Upload body must be a Buffer.");
  if (!Number.isInteger(upload.sizeBytes) || upload.sizeBytes < 1 || upload.sizeBytes > maxUploadBytes) {
    throw new Error("Upload size is outside the worker limit.");
  }
  if (body.byteLength !== upload.sizeBytes) throw new Error("Downloaded upload size does not match its metadata.");
  const digest = createHash("sha256").update(body).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(upload.checksum ?? "") || digest !== String(upload.checksum).toLowerCase()) {
    throw new Error("Downloaded upload checksum does not match its metadata.");
  }
  const extension = path.extname(String(upload.name ?? "")).toLowerCase();
  const mimeType = String(upload.mimeType ?? "application/octet-stream").toLowerCase();
  const extractedText = await extractDocumentText(body, mimeType, extension);
  if (!extractedText) {
    return {
      status: "stored",
      extractedText: null,
      extractor: null,
      pageCount: null,
      message: "Stored safely. This format still needs OCR or an Office text extractor before chat can read it.",
    };
  }
  const pageCount = pageCountFromText(extractedText);
  return {
    status: "indexed",
    extractedText,
    extractor: extractorFor(mimeType, extension),
    pageCount,
    message: pageCount
      ? `Text indexed locally from ${pageCount} page${pageCount === 1 ? "" : "s"}.`
      : "Text indexed locally and available to subject chat.",
  };
}

async function claimUpload() {
  const baseUrl = dashboardUrl();
  const token = await readWorkerToken();
  if (!baseUrl || !token) return { state: "not_configured", upload: null };
  const response = await fetch(`${baseUrl}/api/worker/uploads/claim`, {
    method: "POST",
    headers: await workerApiHeaders(token),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Upload claim failed with HTTP ${response.status}.`);
  return { state: "ready", ...(await response.json()), baseUrl, token };
}

async function downloadUpload(baseUrl, token, upload) {
  const headers = await workerApiHeaders(token);
  headers["X-Jarvis-Upload-Lease"] = upload.leaseId;
  delete headers["Content-Type"];
  const response = await fetch(`${baseUrl}/api/worker/uploads/${encodeURIComponent(upload.id)}/file`, {
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Upload download failed with HTTP ${response.status}.`);
  const declaredSize = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
  if (declaredSize > maxUploadBytes) throw new Error("Dashboard returned an upload larger than the worker limit.");
  const serverChecksum = response.headers.get("x-jarvis-checksum");
  if (serverChecksum && serverChecksum.toLowerCase() !== String(upload.checksum).toLowerCase()) {
    throw new Error("Dashboard upload checksum header does not match the claim.");
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > maxUploadBytes) throw new Error("Downloaded upload is larger than the worker limit.");
  return body;
}

async function finishUpload(baseUrl, token, upload, result) {
  const response = await fetch(`${baseUrl}/api/worker/uploads/${encodeURIComponent(upload.id)}/result`, {
    method: "POST",
    headers: await workerApiHeaders(token),
    body: JSON.stringify({ leaseId: upload.leaseId, ...result }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Upload result failed with HTTP ${response.status}.`);
  return response.json();
}

export async function runNextStagedUpload() {
  const claim = await claimUpload();
  if (claim.state === "not_configured" || !claim.upload) {
    return { state: claim.state === "not_configured" ? "not_configured" : "idle" };
  }
  const upload = claim.upload;
  try {
    const body = await downloadUpload(claim.baseUrl, claim.token, upload);
    const result = await processUploadBytes(upload, body);
    await finishUpload(claim.baseUrl, claim.token, upload, result);
    return { state: result.status, id: upload.id, name: upload.name, pageCount: result.pageCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishUpload(claim.baseUrl, claim.token, upload, {
      status: "failed",
      extractedText: null,
      extractor: null,
      pageCount: null,
      message: message.slice(0, 500),
    }).catch(() => undefined);
    return { state: "failed", id: upload.id, name: upload.name, error: message };
  }
}

export async function drainStagedUploads(limit = 2) {
  const results = [];
  for (let index = 0; index < Math.max(1, Math.min(10, limit)); index += 1) {
    const result = await runNextStagedUpload();
    results.push(result);
    if (result.state === "idle" || result.state === "not_configured") break;
  }
  return results;
}
