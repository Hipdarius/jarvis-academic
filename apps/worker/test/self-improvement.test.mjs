import assert from "node:assert/strict";
import test from "node:test";

import { changedPaths, extractPatch, safeRepositoryPath } from "../src/agents/self-improvement.mjs";

test("accepts a bounded patch inside a normal source path", () => {
  const patch = [
    "diff --git a/apps/worker/src/sources/teams.mjs b/apps/worker/src/sources/teams.mjs",
    "--- a/apps/worker/src/sources/teams.mjs",
    "+++ b/apps/worker/src/sources/teams.mjs",
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ].join("\n");
  assert.deepEqual(changedPaths(patch), ["apps/worker/src/sources/teams.mjs"]);
  assert.equal(extractPatch(`\`\`\`diff\n${patch}\n\`\`\``), `${patch}\n`);
});

test("rejects traversal, secrets, drive paths, and hidden unsafe patch paths", () => {
  assert.equal(safeRepositoryPath("../.env"), null);
  assert.equal(safeRepositoryPath(".ENV/private"), null);
  assert.equal(safeRepositoryPath("C:\\secrets\\iam"), null);

  const mixedPatch = [
    "diff --git a/apps/worker/src/sources/teams.mjs b/apps/worker/src/sources/teams.mjs",
    "--- a/apps/worker/src/sources/teams.mjs",
    "+++ b/apps/worker/src/sources/teams.mjs",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "diff --git a/.env b/.env",
    "--- a/.env",
    "+++ b/.env",
    "@@ -1 +1 @@",
    "-secret=old",
    "+secret=new",
  ].join("\n");
  assert.equal(changedPaths(mixedPatch), null);
});

test("validates deleted and renamed paths instead of trusting only new-file headers", () => {
  const deleted = [
    "diff --git a/secrets/iam_password b/secrets/iam_password",
    "deleted file mode 100644",
    "--- a/secrets/iam_password",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-secret",
  ].join("\n");
  assert.equal(changedPaths(deleted), null);

  const renamed = [
    "diff --git a/apps/worker/src/sources/teams.mjs b/.env",
    "similarity index 100%",
    "rename from apps/worker/src/sources/teams.mjs",
    "rename to .env",
  ].join("\n");
  assert.equal(changedPaths(renamed), null);
});
