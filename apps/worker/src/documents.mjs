import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

import { workerConfig } from "./config.mjs";
import { redactText, redactUrl } from "./inspection.mjs";
import { ensurePrivateDirectory } from "./io.mjs";
import { extractOpenXmlText } from "./openxml.mjs";

const textExtensions = new Set([".csv", ".html", ".htm", ".json", ".md", ".rtf", ".txt", ".xml"]);
const allowedExtensions = new Set([
  ...textExtensions,
  ".doc", ".docx", ".epub", ".gif", ".jpeg", ".jpg", ".odp", ".ods", ".odt",
  ".pdf", ".png", ".ppt", ".pptx", ".svg", ".webp", ".xls", ".xlsx", ".zip",
]);

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

const maxDocumentBytes = boundedInteger(process.env.JARVIS_MAX_DOCUMENT_MB, 25, 1, 100) * 1_024 * 1_024;

export function safePathSegment(value, fallback = "item") {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100);
  return normalized || fallback;
}

function filenameFromDisposition(value) {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value ?? "")?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return /filename="?([^";]+)"?/i.exec(value ?? "")?.[1] ?? "";
}

function filenameFor(response, requestedName, requestedUrl) {
  const disposition = filenameFromDisposition(response.headers()["content-disposition"]);
  const pathname = new URL(response.url() || requestedUrl).pathname;
  const urlName = decodeURIComponent(path.basename(pathname));
  const candidate = disposition || requestedName || urlName || "school-file";
  const extension = path.extname(candidate).toLowerCase();
  const safeName = safePathSegment(candidate, "school-file");
  return extension && !safeName.toLowerCase().endsWith(extension) ? `${safeName}${extension}` : safeName;
}

function isAllowedHost(url, allowedHosts) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && allowedHosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function directDownloadUrl(value) {
  const parsed = new URL(value);
  if (/\/mod\/resource\/view\.php$/i.test(parsed.pathname)) parsed.searchParams.set("redirect", "1");
  return parsed.href;
}

function redactDocumentText(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[school-email]")
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .replace(/\b\d{7,}\b/g, "[identifier]")
    .replace(/\r/g, "")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 100_000);
}

async function extractPdfText(buffer) {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: VerbosityLevel.ERRORS,
  });
  try {
    const pdf = await loadingTask.promise;
    const pages = [];
    let extractedLength = 0;
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 250); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => (
        typeof item === "object" && "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : ""
      )).join("");
      if (text.trim()) {
        const pageText = `[Page ${pageNumber}]\n${text.trim()}`;
        pages.push(pageText);
        extractedLength += pageText.length;
      }
      if (extractedLength >= 100_000) break;
    }
    return redactDocumentText(pages.join("\n\n")) || null;
  } catch {
    return null;
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

export async function extractDocumentText(buffer, mimeType, extension) {
  if (mimeType === "application/pdf" || extension === ".pdf") return extractPdfText(buffer);
  const officeText = await extractOpenXmlText(buffer, mimeType, extension);
  if (officeText) return redactDocumentText(officeText) || null;
  if (!mimeType.startsWith("text/") && !textExtensions.has(extension)) return null;
  const decoded = buffer.subarray(0, 150_000).toString("utf8");
  const plain = /html|xml/i.test(mimeType) || [".htm", ".html", ".xml"].includes(extension)
    ? decoded.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    : decoded;
  return redactDocumentText(plain) || null;
}

async function cachedExtractedText(absolutePath, buffer, mimeType, extension) {
  const cachePath = `${absolutePath}.jarvis-text-v3.txt`;
  try {
    const cached = await fs.readFile(cachePath, "utf8");
    return cached || null;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const extracted = await extractDocumentText(buffer, mimeType, extension);
  await fs.writeFile(cachePath, extracted ?? "", { mode: 0o600 });
  return extracted;
}

export async function downloadSchoolDocument(page, {
  source,
  url,
  name,
  courseExternalId,
  academicItemExternalId,
  subject,
  sourcePath,
  allowedHosts,
}) {
  if (!isAllowedHost(url, allowedHosts)) return { state: "skipped_host" };
  const response = await page.request.get(directDownloadUrl(url), { timeout: 45_000, failOnStatusCode: false });
  if (!response.ok()) return { state: "failed_http", status: response.status() };
  if (!isAllowedHost(response.url(), allowedHosts)) return { state: "skipped_redirect_host" };

  const headers = response.headers();
  const resolvedName = filenameFor(response, name, url);
  const extension = path.extname(resolvedName).toLowerCase();
  const mimeType = String(headers["content-type"] ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
  const finalPath = new URL(response.url()).pathname;
  const hasAttachmentName = Boolean(filenameFromDisposition(headers["content-disposition"]));
  if (mimeType === "text/html" && /\/mod\/resource\/view\.php$/i.test(finalPath) && !hasAttachmentName) {
    return { state: "skipped_navigation" };
  }
  if (extension && !allowedExtensions.has(extension)) return { state: "skipped_type", mimeType };

  const declaredSize = Number.parseInt(headers["content-length"] ?? "0", 10);
  if (declaredSize > maxDocumentBytes) return { state: "skipped_size", size: declaredSize };
  const body = await response.body();
  if (body.byteLength > maxDocumentBytes) return { state: "skipped_size", size: body.byteLength };

  const checksum = createHash("sha256").update(body).digest("hex");
  const directoryParts = [safePathSegment(source), safePathSegment(courseExternalId, "general")];
  const directory = path.join(workerConfig.schoolFilesDirectory, ...directoryParts);
  await ensurePrivateDirectory(directory);
  const stem = safePathSegment(path.basename(resolvedName, extension), "school-file");
  const storedName = `${stem}-${checksum.slice(0, 10)}${extension}`;
  const absolutePath = path.join(directory, storedName);
  await fs.writeFile(absolutePath, body, { mode: 0o600 });
  const text = await cachedExtractedText(absolutePath, body, mimeType, extension);

  return {
    state: "downloaded",
    document: {
      sourceExternalId: `${source}:document:${checksum}`,
      academicItemExternalId: academicItemExternalId || undefined,
      subject: redactText(subject) || undefined,
      sourcePath: redactText(sourcePath)?.slice(0, 1_000) || undefined,
      name: resolvedName.slice(0, 300),
      mimeType,
      storageKey: [...directoryParts, storedName].join("/"),
      checksum,
      sourceUrl: redactUrl(response.url()),
      extractedText: text,
      size: body.byteLength,
    },
  };
}
