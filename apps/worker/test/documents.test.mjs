import assert from "node:assert/strict";
import test from "node:test";

import { safePathSegment } from "../src/documents.mjs";
import { academicYearStart, currentAcademicYearStart, isArchivedCourse, prioritizeCourses } from "../src/sources/moodle.mjs";

test("sanitizes school filenames without allowing path traversal", () => {
  assert.equal(safePathSegment("../../Homework: chapter 2.pdf"), "Homework-chapter-2.pdf");
  assert.equal(safePathSegment(".."), "item");
});

test("classifies Moodle course years against the current school year", () => {
  const reference = new Date("2026-08-13T10:00:00Z");
  assert.equal(academicYearStart("Database Systems 2025/26"), 2025);
  assert.equal(currentAcademicYearStart(reference), 2026);
  assert.equal(isArchivedCourse("Database Systems 2025/26", reference), true);
  assert.equal(isArchivedCourse("Database Systems 2026/27", reference), false);
  assert.equal(isArchivedCourse("Database Systems", reference), false);
  assert.deepEqual(
    prioritizeCourses([{ title: "History 2025/26" }, { title: "Math 2026/27" }], reference).map((course) => course.title),
    ["Math 2026/27", "History 2025/26"],
  );
});
