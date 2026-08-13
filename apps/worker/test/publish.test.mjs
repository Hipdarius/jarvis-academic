import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { boundedSyncPayload, workerApiHeaders } from "../src/publish.mjs";

test("sends the Sites gate credential separately from the Jarvis worker token", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-sites-token-"));
  const tokenFile = path.join(directory, "sites-token");
  const originalFile = process.env.JARVIS_SITES_BYPASS_TOKEN_FILE;
  const originalToken = process.env.JARVIS_SITES_BYPASS_TOKEN;
  await fs.writeFile(tokenFile, "sites_test_token_abcdefghijklmnopqrstuvwxyz", "utf8");
  process.env.JARVIS_SITES_BYPASS_TOKEN_FILE = tokenFile;
  delete process.env.JARVIS_SITES_BYPASS_TOKEN;

  try {
    const headers = await workerApiHeaders("jrv_test_worker_token");
    assert.equal(headers.Authorization, "Bearer jrv_test_worker_token");
    assert.equal(headers["OAI-Sites-Authorization"], "Bearer sites_test_token_abcdefghijklmnopqrstuvwxyz");
  } finally {
    if (originalFile === undefined) delete process.env.JARVIS_SITES_BYPASS_TOKEN_FILE;
    else process.env.JARVIS_SITES_BYPASS_TOKEN_FILE = originalFile;
    if (originalToken === undefined) delete process.env.JARVIS_SITES_BYPASS_TOKEN;
    else process.env.JARVIS_SITES_BYPASS_TOKEN = originalToken;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("keeps sync payloads bounded while preserving school-file metadata", () => {
  const payload = boundedSyncPayload({
    source: "teams",
    health: { state: "ready" },
    items: Array.from({ length: 10 }, (_, index) => ({ title: `Assignment ${index}`, description: "x".repeat(400) })),
    documents: Array.from({ length: 8 }, (_, index) => ({
      name: `file-${index}.txt`,
      storageKey: `teams/course/file-${index}.txt`,
      checksum: "a".repeat(64),
      extractedText: "lesson ".repeat(5_000),
    })),
    warnings: [],
  }, 35_000);
  assert.equal(Buffer.byteLength(JSON.stringify(payload), "utf8") <= 35_000, true);
  assert.equal(payload.documents.length > 0, true);
  assert.equal(payload.documents.every((document) => document.name && document.storageKey && document.checksum), true);
  assert.equal(payload.warnings.includes("sync_payload_truncated"), true);
});
