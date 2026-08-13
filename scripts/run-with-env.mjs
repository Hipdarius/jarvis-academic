#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
const env = { ...process.env };
let index = 0;

while (index < args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[index])) {
  const splitAt = args[index].indexOf("=");
  env[args[index].slice(0, splitAt)] = args[index].slice(splitAt + 1);
  index += 1;
}

const command = args[index];
const commandArgs = args.slice(index + 1);

if (!command) {
  console.error("Usage: node scripts/run-with-env.mjs KEY=value <command> [...args]");
  process.exit(64);
}

const result = spawnSync(command, commandArgs, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
