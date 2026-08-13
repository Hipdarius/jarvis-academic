import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("loads persistent worker configuration before the CLI starts", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-env-"));
  const configFile = path.join(directory, "worker.env");
  await fs.writeFile(configFile, "JARVIS_TIMEZONE=Europe/Luxembourg\nJARVIS_SYNC_INTERVAL_MINUTES=47\n", "utf8");

  try {
    const script = [
      'import { loadLocalEnvironment } from "./src/environment.mjs";',
      "const status = loadLocalEnvironment();",
      "console.log(JSON.stringify({ status, timezone: process.env.JARVIS_TIMEZONE, interval: process.env.JARVIS_SYNC_INTERVAL_MINUTES }));",
    ].join(" ");
    const childEnvironment = { ...process.env, JARVIS_CONFIG_FILE: configFile };
    delete childEnvironment.JARVIS_TIMEZONE;
    delete childEnvironment.JARVIS_SYNC_INTERVAL_MINUTES;
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: childEnvironment,
    });
    const result = JSON.parse(stdout.trim());
    assert.equal(result.status.loaded, true);
    assert.equal(result.timezone, "Europe/Luxembourg");
    assert.equal(result.interval, "47");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
