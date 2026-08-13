import os from "node:os";
import path from "node:path";
import process from "node:process";

export function defaultEnvironmentFile() {
  if (process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "AcademicJarvis", "worker.env");
  }
  return path.join(os.homedir(), ".academic-jarvis", "worker.env");
}

export function loadLocalEnvironment() {
  const file = process.env.JARVIS_CONFIG_FILE?.trim() || defaultEnvironmentFile();
  process.env.JARVIS_CONFIG_FILE = file;

  try {
    process.loadEnvFile(file);
    return { file, loaded: true };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { file, loaded: false };
    }
    throw error;
  }
}
