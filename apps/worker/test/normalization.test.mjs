import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeMoodleRows,
  normalizeTeamsRows,
  normalizeWebUntisSections,
} from "../src/normalization.mjs";

const reference = new Date("2026-09-18T12:00:00Z");

test("normalizes a WebUntis homework row without inventing a subject", () => {
  const items = normalizeWebUntisSections([{
    label: "Hausaufgaben",
    items: [{ text: "Algebra exercises 4-8 22.09.2026", cells: ["Mathematik", "Algebra exercises 4-8", "22.09.2026"], href: "" }],
  }], reference);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "homework");
  assert.equal(items[0].subject, "Mathematics");
  assert.equal(items[0].dueAt, "2026-09-22T23:59:00.000Z");
  assert.equal(items[0].evidence, "source_derived");
});

test("keeps WebUntis inbox messages as announcements even when they mention exams", () => {
  const items = normalizeWebUntisSections([{
    label: "Mitteilungen",
    items: [{ text: "Sport 12.05. The hall is closed because of the final exams.", cells: [], href: "" }],
  }], reference);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "announcement");
  assert.equal(items[0].dueAt, undefined);
});

test("ignores Moodle course navigation but keeps assignment links", () => {
  const items = normalizeMoodleRows("academy", [
    { text: "Math course", href: "https://academy.am.lu/course/view.php", cells: [] },
    { text: "Upload database worksheet by 25.09.2026", href: "https://academy.am.lu/mod/assign/view.php", cells: [] },
  ], reference);
  assert.equal(items.length, 1);
  assert.equal(items[0].source, "academy_moodle");
  assert.equal(items[0].subject, "Databases");
});

test("does not turn an ordinary Teams channel into homework", () => {
  const items = normalizeTeamsRows([{ text: "General channel", href: "https://teams.microsoft.com/" }], reference);
  assert.deepEqual(items, []);
});
