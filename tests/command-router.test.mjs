import assert from "node:assert/strict";
import test from "node:test";

import {
  inferDueLabel,
  inferSubject,
  interpretCommandLocally,
} from "../packages/core/src/command-router.ts";

test("infers mathematics homework from an algebra book command", () => {
  const intent = interpretCommandLocally("Algebra book exercises 4-8 for Friday");
  assert.equal(intent.action, "create_homework");
  assert.equal(intent.subject, "Mathematics");
  assert.equal(intent.dueLabel, "Friday");
});

test("turns a hypothetical build into a brainstorm canvas", () => {
  const intent = interpretCommandLocally("What if I built a CubeSat radiation monitor?");
  assert.equal(intent.action, "create_project_canvas");
  assert.equal(intent.canvasTitle, "A CubeSat radiation monitor");
  assert.equal(intent.subject, "Physics");
});

test("does not confuse an explicit create-homework command with a project", () => {
  const intent = interpretCommandLocally("Create a homework from the algebra book for Tuesday");
  assert.equal(intent.action, "create_homework");
  assert.equal(intent.subject, "Mathematics");
  assert.equal(intent.dueLabel, "Tuesday");
});

test("recognizes school-specific database and due-date language", () => {
  assert.equal(inferSubject("finish SQL normalization worksheet"), "Databases");
  assert.equal(inferDueLabel("hand it in next week"), "Next week");
});

test("keeps ambiguous questions as questions", () => {
  const intent = interpretCommandLocally("Why does this theorem work?");
  assert.equal(intent.action, "ask_jarvis");
});
