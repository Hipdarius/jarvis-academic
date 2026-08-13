export const MAX_STAGED_UPLOAD_BYTES = 25 * 1_024 * 1_024;

const mimeTypes = new Map<string, string>([
  [".csv", "text/csv"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".md", "text/markdown"],
  [".odp", "application/vnd.oasis.opendocument.presentation"],
  [".ods", "application/vnd.oasis.opendocument.spreadsheet"],
  [".odt", "application/vnd.oasis.opendocument.text"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".zip", "application/zip"],
]);

const zipExtensions = new Set([".docx", ".odp", ".ods", ".odt", ".pptx", ".xlsx", ".zip"]);
const legacyOfficeExtensions = new Set([".doc", ".ppt", ".xls"]);

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function safeFilename(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .trim()
    .slice(0, 240);
}

export function validateStagedUpload(name: string, declaredMimeType: string, bytes: Uint8Array) {
  const safeName = safeFilename(name);
  const extensionMatch = /\.[a-z0-9]{1,8}$/i.exec(safeName);
  const extension = extensionMatch?.[0].toLowerCase() ?? "";
  const canonicalMimeType = mimeTypes.get(extension);
  if (!safeName || !canonicalMimeType) throw new Error("Choose a supported school file format.");
  if (!bytes.byteLength) throw new Error("The selected file is empty.");
  if (bytes.byteLength > MAX_STAGED_UPLOAD_BYTES) throw new Error("The selected file is larger than 25 MB.");

  const validPdf = extension !== ".pdf" || startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  const validPng = extension !== ".png" || startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const validJpeg = ![".jpg", ".jpeg"].includes(extension) || startsWith(bytes, [0xff, 0xd8, 0xff]);
  const validWebp = extension !== ".webp"
    || (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP");
  const validZip = !zipExtensions.has(extension)
    || startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
    || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
    || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]);
  const validLegacyOffice = !legacyOfficeExtensions.has(extension)
    || startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const validText = ![".csv", ".md", ".txt"].includes(extension) || !bytes.slice(0, 8_192).includes(0);

  if (![validPdf, validPng, validJpeg, validWebp, validZip, validLegacyOffice, validText].every(Boolean)) {
    throw new Error("The file contents do not match its filename.");
  }

  const normalizedDeclaredType = declaredMimeType.split(";")[0].trim().toLowerCase();
  const compatibleMimeType = !normalizedDeclaredType
    || normalizedDeclaredType === "application/octet-stream"
    || normalizedDeclaredType === canonicalMimeType
    || (extension === ".zip" && normalizedDeclaredType === "application/x-zip-compressed");
  if (!compatibleMimeType) throw new Error("The file type does not match its filename.");
  return { name: safeName, extension, mimeType: canonicalMimeType };
}
