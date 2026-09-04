import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { windowsPowerShellEnvironment } from "../src/credentials.mjs";

test("prioritizes Windows PowerShell security modules for DPAPI decryption", () => {
  const environment = windowsPowerShellEnvironment({
    SystemRoot: "C:\\Windows",
    PSModulePath: "C:\\Program Files\\PowerShell\\Modules",
    KEEP_ME: "yes",
  });
  assert.equal(environment.KEEP_ME, "yes");
  assert.equal(
    environment.PSModulePath.split(path.delimiter)[0],
    path.join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "Modules"),
  );
});
