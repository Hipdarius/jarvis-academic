import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { processUploadBytes } from "../src/uploads.mjs";
import yazl from "yazl";

function metadata(body, overrides = {}) {
  return {
    id: "upload:00000000-0000-4000-8000-000000000000",
    leaseId: "00000000-0000-4000-8000-000000000001",
    name: "chapter-notes.txt",
    mimeType: "text/plain",
    sizeBytes: body.byteLength,
    checksum: createHash("sha256").update(body).digest("hex"),
    ...overrides,
  };
}

function docxBuffer(text) {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    const chunks = [];
    archive.outputStream.on("data", (chunk) => chunks.push(chunk));
    archive.outputStream.on("error", reject);
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    archive.addBuffer(Buffer.from(`<?xml version="1.0"?><Types xmlns="urn:t"><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`), "[Content_Types].xml");
    archive.addBuffer(Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`), "word/document.xml");
    archive.end();
  });
}

test("verifies and indexes a private text upload locally", async () => {
  const body = Buffer.from("Mitosis produces two genetically identical daughter cells.");
  const result = await processUploadBytes(metadata(body), body);
  assert.equal(result.status, "indexed");
  assert.equal(result.extractor, "plain-text-v1");
  assert.match(result.extractedText, /daughter cells/);
});

test("rejects changed bytes before extraction", async () => {
  const expected = Buffer.from("expected");
  const changed = Buffer.from("tampered");
  await assert.rejects(processUploadBytes(metadata(expected, { sizeBytes: changed.byteLength }), changed), /checksum/);
});

test("keeps unsupported formats stored without pretending they were indexed", async () => {
  const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const result = await processUploadBytes(metadata(body, { name: "diagram.png", mimeType: "image/png" }), body);
  assert.equal(result.status, "stored");
  assert.equal(result.extractedText, null);
  assert.match(result.message, /OCR/);
});

test("indexes a private Word upload with its local Office extractor", async () => {
  const body = await docxBuffer("Teacher-confirmed chapter seven");
  const result = await processUploadBytes(metadata(body, {
    name: "chapter-seven.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }), body);
  assert.equal(result.status, "indexed");
  assert.equal(result.extractor, "openxml-word-v1");
  assert.match(result.extractedText, /Teacher-confirmed chapter seven/);
});
