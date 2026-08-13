#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const [script, ...args] = process.argv.slice(2);

if (!script) {
  console.error("Usage: node scripts/run-bash.mjs <script> [...args]");
  process.exit(64);
}

function works(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function findBash() {
  const candidates = [
    process.env.BASH,
    "bash",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate !== "bash" && !existsSync(candidate)) continue;
    if (works(candidate)) return candidate;
  }
  return null;
}

const bash = findBash();
if (!bash) {
  console.error("Git Bash is required for this script. Install Git for Windows or add bash to PATH.");
  process.exit(69);
}

const result = spawnSync(bash, [script, ...args], { stdio: "inherit", env: process.env });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
