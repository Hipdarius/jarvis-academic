import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function acquireDaemonLock(stateDirectory, {
  pid = process.pid,
  isAlive = processIsAlive,
} = {}) {
  await mkdir(stateDirectory, { recursive: true });
  const lockPath = path.join(stateDirectory, "daemon.pid");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${pid}\n`, "utf8");
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await handle.close().catch(() => undefined);
        const owner = Number.parseInt(await readFile(lockPath, "utf8").catch(() => ""), 10);
        if (owner === pid) await unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = Number.parseInt(await readFile(lockPath, "utf8").catch(() => ""), 10);
      if (isAlive(owner)) throw new Error(`Academic Jarvis worker is already running (PID ${owner}).`);
      await unlink(lockPath).catch(() => undefined);
    }
  }

  throw new Error("Academic Jarvis could not acquire its worker lease.");
}
