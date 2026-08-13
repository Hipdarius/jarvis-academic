import fs from "node:fs/promises";
import path from "node:path";

export async function ensurePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
}

export async function writeJson(file, value) {
  await ensurePrivateDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}

export async function appendEvent(file, value) {
  await ensurePrivateDirectory(path.dirname(file));
  await fs.appendFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

export function safeTimestamp(date = new Date()) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}
