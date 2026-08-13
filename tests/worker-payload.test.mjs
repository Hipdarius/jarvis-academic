import assert from "node:assert/strict";
import test from "node:test";

import { isWorkerSyncPayload } from "../packages/core/src/worker-payload.ts";

function payload() {
  return {
    source: "teams",
    health: { state: "ready", checkedAt: "2026-09-18T12:00:00.000Z", requiresUserAction: false },
    items: [{
      source: "teams",
      sourceExternalId: "teams:assignment:abc123",
      type: "homework",
      title: "Essay draft",
      evidence: "source_derived",
      confidence: 94,
      dueAt: "2026-09-20T16:00:00.000Z",
      raw: {},
    }],
    documents: [{
      sourceExternalId: `teams:document:${"a".repeat(64)}`,
      name: "brief.pdf",
      storageKey: "teams/english/brief.pdf",
      checksum: "a".repeat(64),
      size: 2_048,
    }],
    agentAutoTriage: true,
  };
}

test("accepts a bounded source-matched worker payload", () => {
  assert.equal(isWorkerSyncPayload(payload()), true);
});

test("rejects mismatched sources and malformed academic records", () => {
  const mismatched = payload();
  mismatched.items[0].source = "webuntis";
  assert.equal(isWorkerSyncPayload(mismatched), false);

  const invalidDate = payload();
  invalidDate.items[0].dueAt = "sometime soon";
  assert.equal(isWorkerSyncPayload(invalidDate), false);

  const oversized = payload();
  oversized.documents[0].extractedText = "x".repeat(100_001);
  assert.equal(isWorkerSyncPayload(oversized), false);
});
