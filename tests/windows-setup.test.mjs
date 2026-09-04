import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("Windows bootstrap resolves the repository without relying on the current folder", {
  skip: process.platform !== "win32",
}, async () => {
  const outsideDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-preflight-"));
  try {
    const setupScript = path.join(repositoryRoot, "scripts", "setup-windows.ps1");
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", setupScript,
      "-CheckOnly",
    ], { cwd: outsideDirectory });
    assert.match(stdout, /Preflight passed/);
    assert.match(stdout, /apps[\\/]worker|Repository:/);
  } finally {
    await fs.rm(outsideDirectory, { recursive: true, force: true });
  }
});

test("root command help keeps secrets out of command-line examples", {
  skip: process.platform !== "win32",
}, async () => {
  const launcher = path.join(repositoryRoot, "scripts", "jarvis.ps1");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", launcher,
    "help",
  ]);
  assert.match(stdout, /jarvis\.ps1 doctor/);
  assert.match(stdout, /jarvis\.ps1 sites-token/);
  assert.match(stdout, /native DPAPI credential prompt/);
  assert.doesNotMatch(stdout, /JARVIS_IAM_PASSWORD=/);
  assert.doesNotMatch(stdout, /JARVIS_WORKER_TOKEN=/);
});

test("Windows bootstrap persists only non-secret settings", {
  skip: process.platform !== "win32",
}, async () => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-config-"));
  try {
    const setupScript = path.join(repositoryRoot, "scripts", "setup-windows.ps1");
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", setupScript,
      "-DataDirectory", dataDirectory,
      "-SkipDependencies",
      "-SkipIam",
      "-SkipToken",
    ]);
    const configuration = await fs.readFile(path.join(dataDirectory, "worker.env"), "utf8");
    assert.match(configuration, /JARVIS_WORKER_TOKEN_FILE=/);
    assert.match(configuration, /JARVIS_SITES_BYPASS_TOKEN_FILE=/);
    assert.match(configuration, /JARVIS_IAM_DPAPI_FILE=/);
    assert.match(configuration, /JARVIS_ALLOW_PASSWORD_LOGIN=true/);
    assert.match(configuration, /JARVIS_AGENT_AUTO_TRIAGE=true/);
    assert.doesNotMatch(configuration, /JARVIS_WORKER_TOKEN=/);
    assert.doesNotMatch(configuration, /JARVIS_SITES_BYPASS_TOKEN=/);
    assert.doesNotMatch(configuration, /JARVIS_IAM_PASSWORD=/);
    assert.doesNotMatch(configuration, /jrv_[A-Za-z0-9_-]+/);

    await fs.appendFile(path.join(dataDirectory, "worker.env"), "OPENAI_API_KEY_FILE=C:\\private\\openai_key\n", "utf8");
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", setupScript,
      "-DataDirectory", dataDirectory,
      "-SkipDependencies",
      "-SkipIam",
      "-SkipToken",
    ]);
    const updatedConfiguration = await fs.readFile(path.join(dataDirectory, "worker.env"), "utf8");
    assert.match(updatedConfiguration, /OPENAI_API_KEY_FILE=C:\\private\\openai_key/);
  } finally {
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});

test("scheduled worker starts immediately and has retry and watchdog recovery", async () => {
  const script = await fs.readFile(path.join(repositoryRoot, "scripts", "install-worker-task.ps1"), "utf8");
  assert.match(script, /RestartCount\s*=\s*5/);
  assert.match(script, /RestartInterval\s*=\s*"PT1M"/);
  assert.match(script, /Repetition\.Interval\s*=\s*"PT15M"/);
  assert.match(script, /GetTask\(\$taskName\).*Run\(\$null\)/s);
  assert.match(script, /MultipleInstances\s*=\s*2/);
});

test("background launcher logs native warnings without terminating the daemon", async () => {
  const script = await fs.readFile(path.join(repositoryRoot, "scripts", "jarvis.ps1"), "utf8");
  assert.match(script, /if \(\$Background\).*?\$ErrorActionPreference = "Continue".*?& \$node @nodeArguments \*>> \$logFile/s);
  assert.match(script, /& \$node @nodeArguments \*>> \$logFile\s+\$exitCode = \$LASTEXITCODE/);
});
