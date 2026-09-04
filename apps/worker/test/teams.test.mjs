import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTeamsRows } from "../src/normalization.mjs";
import {
  assignmentEntryNamePattern,
  assignmentExternalId,
  isAssignmentsSurfaceError,
  teamsAssignmentHealth,
} from "../src/sources/teams.mjs";

test("keeps stable explicit Teams assignment identifiers and subject context", () => {
  const items = normalizeTeamsRows([{
    externalId: "assignment:abc123",
    href: "https://teams.microsoft.com/v2/assignments/abc123",
    title: "Essay draft",
    text: "Essay draft due 18.09.2026 17:00",
    subject: "English 3C",
    teacher: "Teacher",
  }], new Date("2026-09-01T00:00:00Z"));
  assert.equal(items.length, 1);
  assert.equal(items[0].sourceExternalId, "teams:assignment:abc123");
  assert.equal(items[0].subject, "English 3C");
  assert.equal(items[0].dueAt, "2026-09-18T15:00:00.000Z");
});

test("marks Teams for attention only when both navigation and assignment evidence are missing", () => {
  const health = { state: "ready", requiresUserAction: false };
  assert.deepEqual(teamsAssignmentHealth(health, false, 0), {
    state: "assignments_surface_not_found",
    requiresUserAction: false,
  });
  assert.equal(teamsAssignmentHealth(health, true, 0), health);
  assert.equal(teamsAssignmentHealth(health, false, 2), health);
  assert.deepEqual(teamsAssignmentHealth(health, true, 0, true), {
    state: "assignments_surface_error",
    requiresUserAction: false,
  });
});

test("recognizes a Teams Assignments error page without treating it as an empty list", () => {
  assert.equal(isAssignmentsSurfaceError("Oops", "Assignments"), true);
  assert.equal(isAssignmentsSurfaceError("Assignments", "There was a problem"), true);
  assert.equal(isAssignmentsSurfaceError("Assignments", "No assignments yet"), false);
});

test("uses the explicit Teams assignment query identifier instead of mutable card text", () => {
  assert.equal(
    assignmentExternalId("https://teams.microsoft.com/v2/?assignmentId=stable_12345", "Draft due tomorrow"),
    "assignment:stable_12345",
  );
});

test("recognizes the Teams app-bar shortcut suffix on Assignments", () => {
  assert.equal(assignmentEntryNamePattern.test("Assignments"), true);
  assert.equal(assignmentEntryNamePattern.test("Assignments (Ctrl+Shift+4)"), true);
  assert.equal(assignmentEntryNamePattern.test("Assignment due tomorrow"), false);
});
