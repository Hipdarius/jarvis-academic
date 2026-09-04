import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireDaemonLock } from "../src/daemon-lock.mjs";

test("prevents concurrent workers and releases its lease", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jarvis-daemon-"));
  try {
    const release = await acquireDaemonLock(directory, { pid: 101, isAlive: (pid) => pid === 101 });
    await assert.rejects(
      acquireDaemonLock(directory, { pid: 202, isAlive: (pid) => pid === 101 }),
      /already running/,
    );
    await release();
    const releaseReplacement = await acquireDaemonLock(directory, { pid: 202, isAlive: () => false });
    await releaseReplacement();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("replaces a stale worker lease after an interrupted process", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jarvis-daemon-stale-"));
  try {
    await writeFile(path.join(directory, "daemon.pid"), "303\n", "utf8");
    const release = await acquireDaemonLock(directory, { pid: 404, isAlive: () => false });
    await release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
