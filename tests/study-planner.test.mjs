import assert from "node:assert/strict";
import test from "node:test";

import { buildAdaptiveStudyBlocks } from "../packages/core/src/study-planner.ts";

const base = {
  subject: "Mathematics",
  status: "inbox",
  type: "homework",
};

test("creates more preparation blocks for assessments than ordinary homework", () => {
  const now = new Date("2026-09-01T10:00:00Z");
  const blocks = buildAdaptiveStudyBlocks([
    { ...base, id: "test", title: "Algebra test", type: "test", dueAt: "2026-09-10T08:00:00Z" },
    { ...base, id: "work", title: "Worksheet", dueAt: "2026-09-10T08:00:00Z" },
  ], { now });
  assert.equal(blocks.filter((block) => block.academicItemId === "test").length, 3);
  assert.equal(blocks.filter((block) => block.academicItemId === "work").length, 2);
});

test("ignores completed, undated, and distant items", () => {
  const now = new Date("2026-09-01T10:00:00Z");
  const blocks = buildAdaptiveStudyBlocks([
    { ...base, id: "done", title: "Done", status: "done", dueAt: "2026-09-02T10:00:00Z" },
    { ...base, id: "undated", title: "Undated", dueAt: null },
    { ...base, id: "distant", title: "Distant", dueAt: "2027-01-01T10:00:00Z" },
  ], { now });
  assert.deepEqual(blocks, []);
});

test("caps suggested study time per day", () => {
  const now = new Date("2026-09-01T10:00:00Z");
  const items = Array.from({ length: 8 }, (_, index) => ({
    ...base,
    id: `item-${index}`,
    title: `Task ${index}`,
    dueAt: "2026-09-02T17:00:00Z",
  }));
  const blocks = buildAdaptiveStudyBlocks(items, { now, maxDailyMinutes: 60 });
  const totals = new Map();
  for (const block of blocks) totals.set(block.scheduledFor, (totals.get(block.scheduledFor) ?? 0) + block.durationMinutes);
  assert.equal([...totals.values()].every((minutes) => minutes <= 60), true);
});
