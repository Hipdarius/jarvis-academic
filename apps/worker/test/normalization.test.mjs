import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeMoodleRows,
  normalizeTeamsRows,
  normalizeWebUntisSections,
} from "../src/normalization.mjs";
import { parseSourceDate } from "../src/source-time.mjs";

const reference = new Date("2026-09-18T12:00:00Z");

test("normalizes a WebUntis homework row without inventing a subject", () => {
  const items = normalizeWebUntisSections([{
    label: "Hausaufgaben",
    items: [{ text: "Algebra exercises 4-8 22.09.2026", cells: ["Mathematik", "Algebra exercises 4-8", "22.09.2026"], href: "" }],
  }], reference);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "homework");
  assert.equal(items[0].subject, "Mathematics");
  assert.equal(items[0].dueAt, undefined);
  assert.equal(items[0].raw.dueLabel, "22.09.2026");
  assert.equal(items[0].raw.duePrecision, "date");
  assert.equal(items[0].evidence, "source_derived");
});

test("retains structured WebUntis class details", () => {
  const items = normalizeWebUntisSections([{
    label: "Mein Stundenplan",
    items: [{
      externalId: "lesson-42",
      text: "Mathematics 18.09.2026 09:00",
      subject: "Mathematics",
      teacher: "Teacher Name",
      room: "B204",
    }],
  }], reference);
  assert.equal(items[0].type, "lesson");
  assert.equal(items[0].subject, "Mathematics");
  assert.equal(items[0].teacher, "Teacher Name");
  assert.equal(items[0].room, "B204");
  assert.equal(items[0].startsAt, "2026-09-18T07:00:00.000Z");
});

test("uses WebUntis section evidence for German assessments and lessons", () => {
  const items = normalizeWebUntisSections([
    { label: "Prüfungen", items: [{ text: "Mathematik 21.09.2026 09:00", subject: "Mathematik" }] },
    { label: "Mein Stundenplan", items: [{ text: "Programming: unit tests 21.09.2026 11:00", subject: "Programming" }] },
  ], reference);
  assert.equal(items[0].type, "test");
  assert.equal(items[0].dueAt, "2026-09-21T07:00:00.000Z");
  assert.equal(items[1].type, "lesson");
  assert.equal(items[1].startsAt, "2026-09-21T09:00:00.000Z");
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

test("parses Moodle named dates in the Luxembourg timezone", () => {
  const parsed = parseSourceDate("Opened: Tuesday, 23 September 2025, 6:55 PM Due: Tuesday, 30 September 2025, 8:00 PM", {
    reference,
    timeZone: "Europe/Luxembourg",
  });
  assert.deepEqual(parsed, {
    label: "30 september 2025, 8:00 pm",
    precision: "datetime",
    iso: "2025-09-30T18:00:00.000Z",
  });
});

test("converts numeric times without treating local time as UTC", () => {
  const items = normalizeMoodleRows("academy", [{
    text: "Database worksheet due 25.09.2026 18:30",
    href: "https://academy.am.lu/mod/assign/view.php",
    externalId: "assign:474:1001",
    subject: "Database Systems",
  }], reference);
  assert.equal(items[0].sourceExternalId, "academy:assign:474:1001");
  assert.equal(items[0].dueAt, "2026-09-25T16:30:00.000Z");
  assert.equal(items[0].subject, "Database Systems");
});

test("does not guess the year when a source gives only day, month, and time", () => {
  assert.deepEqual(parseSourceDate("Due 25.09 18:30", { reference }), {
    label: "25.09 18:30",
    precision: "partial_datetime",
    iso: null,
  });
});
