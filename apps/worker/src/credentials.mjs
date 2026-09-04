import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function windowsPowerShellEnvironment(environment = process.env) {
  const systemRoot = environment.SystemRoot || environment.SYSTEMROOT;
  if (!systemRoot) return { ...environment };
  const windowsModules = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules");
  return {
    ...environment,
    PSModulePath: [windowsModules, environment.PSModulePath].filter(Boolean).join(path.delimiter),
  };
}

function defaultDpapiFile() {
  if (!process.env.LOCALAPPDATA) return null;
  return path.join(process.env.LOCALAPPDATA, "AcademicJarvis", "iam-credential.dpapi.json");
}

async function readSecretFile(file) {
  const value = await fs.readFile(file, "utf8");
  return value.replace(/^\uFEFF/, "").replace(/\r?\n$/, "");
}

async function loadWindowsDpapiCredentials(file) {
  const script = [
    "$stored = Get-Content -Raw -LiteralPath $env:JARVIS_DPAPI_FILE | ConvertFrom-Json",
    "$secure = $stored.passwordCipher | ConvertTo-SecureString",
    "$plain = [System.Net.NetworkCredential]::new('', $secure).Password",
    "@{ username = $stored.username; password = $plain } | ConvertTo-Json -Compress",
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...windowsPowerShellEnvironment(), JARVIS_DPAPI_FILE: file },
    windowsHide: true,
    maxBuffer: 32_768,
  });
  const result = JSON.parse(stdout.trim());
  if (!result.username || !result.password) throw new Error("The DPAPI credential file is incomplete.");
  return { username: String(result.username), password: String(result.password), storage: "windows_dpapi" };
}

export async function loadIamCredentials() {
  if (process.env.JARVIS_ALLOW_PASSWORD_LOGIN !== "true") return null;

  const usernameFile = process.env.JARVIS_IAM_USERNAME_FILE;
  const username = usernameFile
    ? await readSecretFile(usernameFile)
    : process.env.JARVIS_IAM_USERNAME?.trim();
  const passwordFile = process.env.JARVIS_IAM_PASSWORD_FILE;
  if (username && passwordFile) {
    const password = await readSecretFile(passwordFile);
    if (!password) throw new Error("The IAM password secret file is empty.");
    return { username, password, storage: "secret_file" };
  }

  if (os.platform() === "win32") {
    const dpapiFile = process.env.JARVIS_IAM_DPAPI_FILE || defaultDpapiFile();
    if (dpapiFile) {
      try {
        await fs.access(dpapiFile);
        return await loadWindowsDpapiCredentials(dpapiFile);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
        throw error;
      }
    }
  }

  return null;
}

export async function credentialStatus() {
  if (process.env.JARVIS_ALLOW_PASSWORD_LOGIN !== "true") return { enabled: false, storage: null };
  const credentials = await loadIamCredentials();
  return { enabled: Boolean(credentials), storage: credentials?.storage ?? null };
}
