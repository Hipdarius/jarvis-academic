import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { workerApiHeaders } from "../src/publish.mjs";

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
