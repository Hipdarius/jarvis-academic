import { chromium } from "playwright";

import { ensurePrivateDirectory } from "./io.mjs";
import { workerConfig } from "./config.mjs";

export async function launchJarvisBrowser({ headless }) {
  await ensurePrivateDirectory(workerConfig.profileDirectory);
  await ensurePrivateDirectory(workerConfig.schoolFilesDirectory);

  const rootArguments = typeof process.getuid === "function" && process.getuid() === 0
    ? ["--no-sandbox"]
    : [];

  try {
    return await chromium.launchPersistentContext(workerConfig.profileDirectory, {
      headless,
      acceptDownloads: true,
      downloadsPath: workerConfig.schoolFilesDirectory,
      locale: "en-GB",
      timezoneId: workerConfig.timezone,
      viewport: { width: 1440, height: 960 },
      args: rootArguments,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/profile|lock|singleton/i.test(message)) {
      throw new Error("The Jarvis browser profile is already open. Close the other worker or login window and retry.");
    }
    throw error;
  }
}
