import assert from "node:assert/strict";
import test from "node:test";

import { buildTopActions } from "../packages/core/src/daily-loop.ts";

function item(overrides) {
  return {
    id: "item",
    type: "homework",
    title: "Homework",
    description: null,
    subject: "Mathematics",
    source: "WebUntis",
    sourceKind: "webuntis",
    startsAt: null,
    dueAt: "2026-09-05T08:00:00Z",
    dueLabel: null,
    status: "inbox",
    evidence: "teacher_confirmed",
    confidence: 100,
    sourceUrl: null,
    userNote: null,
    dismissed: false,
    ...overrides,
  };
}

test("ranks confirmed urgent work ahead of later and undated work", () => {
  const actions = buildTopActions([
    item({ id: "later", title: "Later", dueAt: "2026-09-12T08:00:00Z" }),
    item({ id: "urgent", title: "Urgent", dueAt: "2026-09-05T08:00:00Z" }),
    item({ id: "undated", title: "Undated", dueAt: null }),
    item({ id: "announcement", title: "Notice", type: "announcement" }),
  ], [], new Date("2026-09-04T08:00:00Z"));
  assert.deepEqual(actions.map((action) => action.academicItemId), ["urgent", "later", "undated"]);
});

test("preserves decisions by excluding completed, cancelled, and dismissed work", () => {
  const actions = buildTopActions([
    item({ id: "done", status: "done" }),
    item({ id: "cancelled", status: "cancelled" }),
    item({ id: "dismissed", dismissed: true }),
    item({ id: "active", title: "Active" }),
  ], [], new Date("2026-09-04T08:00:00Z"));
  assert.deepEqual(actions.map((action) => action.academicItemId), ["active"]);
});

test("promotes an accepted study block without duplicating its source assignment", () => {
  const actions = buildTopActions([
    item({ id: "source", title: "Source assignment" }),
  ], [{
    id: "block",
    academicItemId: "source",
    subject: "Mathematics",
    title: "Review equations",
    scheduledFor: "2026-09-04",
    durationMinutes: 30,
    reason: "Prepare for confirmed work",
    status: "accepted",
    generatedBy: "deterministic",
  }], new Date("2026-09-04T08:00:00Z"));
  assert.equal(actions.length, 1);
  assert.equal(actions[0].studyBlockId, "block");
});
