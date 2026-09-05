import assert from "node:assert/strict";
import test from "node:test";

import { webUntisNavigationPattern } from "../src/sources/webuntis.mjs";

test("matches localized WebUntis timetable and assessment navigation exactly", () => {
  assert.equal(webUntisNavigationPattern("Mein Stundenplan").test("My timetable"), true);
  assert.equal(webUntisNavigationPattern("Prüfungen").test("Exams"), true);
  assert.equal(webUntisNavigationPattern("Hausaufgaben").test("Homework"), true);
  assert.equal(webUntisNavigationPattern("Hausaufgaben").test("Homework details"), false);
});
