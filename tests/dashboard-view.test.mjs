import assert from "node:assert/strict";
import test from "node:test";

import {
  filterPlannerItems,
  inboxDashboardItems,
  scheduledDashboardItems,
} from "../app/lib/dashboard-view.ts";

const base = {
  description: null,
  subject: "General",
  source: "WebUntis",
  sourceKind: "webuntis",
  startsAt: null,
  dueAt: null,
  dueLabel: null,
  status: "inbox",
  evidence: "source_derived",
  confidence: 90,
  sourceUrl: null,
};

test("does not promote undated announcements into the deadline queue", () => {
  const announcement = { ...base, id: "announcement", type: "announcement", title: "Sports lesson moved" };
  const homework = { ...base, id: "homework", type: "homework", title: "Worksheet", dueAt: "2026-09-22T18:00:00.000Z" };
  assert.deepEqual(scheduledDashboardItems([announcement, homework]).map((item) => item.id), ["homework"]);
  assert.deepEqual(inboxDashboardItems([announcement, homework]).map((item) => item.id), ["announcement"]);
});

test("filters planner items by type and search text", () => {
  const items = [
    { ...base, id: "announcement", type: "announcement", title: "Room change" },
    { ...base, id: "math", type: "homework", title: "Algebra worksheet", subject: "Mathematics" },
  ];
  assert.deepEqual(filterPlannerItems(items, "announcements", "").map((item) => item.id), ["announcement"]);
  assert.deepEqual(filterPlannerItems(items, "all", "algebra").map((item) => item.id), ["math"]);
  assert.deepEqual(filterPlannerItems(items, "work", "room").map((item) => item.id), []);
});
