import assert from "node:assert/strict";
import test from "node:test";

import { downloadSchoolDocument, extractDocumentText, safePathSegment } from "../src/documents.mjs";
import { academicYearStart, currentAcademicYearStart, isArchivedCourse, prioritizeCourses } from "../src/sources/moodle.mjs";

test("sanitizes school filenames without allowing path traversal", () => {
  assert.equal(safePathSegment("../../Homework: chapter 2.pdf"), "Homework-chapter-2.pdf");
  assert.equal(safePathSegment(".."), "item");
});

function pdfWithText(text) {
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${text.replace(/[()\\]/g, "\\$&")}) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test("extracts page-addressable text from a digital PDF", async () => {
  const extracted = await extractDocumentText(pdfWithText("Assignment chapter 4"), "application/pdf", ".pdf");
  assert.match(extracted, /\[Page 1\]/);
  assert.match(extracted, /Assignment chapter 4/);
});

test("keeps recoverable PDF parser warnings out of worker diagnostics", async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...values) => warnings.push(values.join(" "));
  try {
    await extractDocumentText(pdfWithText("Quiet extraction"), "application/pdf", ".pdf");
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(warnings, []);
});

test("requests Moodle's direct file redirect and rejects an unresolved resource page", async () => {
  let requestedUrl = "";
  const page = {
    request: {
      async get(url) {
        requestedUrl = url;
        return {
          ok: () => true,
          url: () => url,
          headers: () => ({ "content-type": "text/html; charset=utf-8" }),
          body: async () => { throw new Error("Navigation HTML must be rejected before its body is stored."); },
        };
      },
    },
  };
  const result = await downloadSchoolDocument(page, {
    source: "academy",
    url: "https://academy.am.lu/mod/resource/view.php?id=42",
    name: "blackboard-1-to-many-File",
    courseExternalId: "course:42",
    subject: "AMINF",
    sourcePath: "AMINF > Data modeling",
    allowedHosts: ["academy.am.lu"],
  });
  assert.equal(new URL(requestedUrl).searchParams.get("redirect"), "1");
  assert.deepEqual(result, { state: "skipped_navigation" });
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
