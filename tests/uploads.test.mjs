import assert from "node:assert/strict";
import test from "node:test";

import { validateStagedUpload } from "../app/lib/upload-validation.ts";
import { suggestUploadDestination } from "../packages/core/src/upload-matcher.ts";

const assignment = {
  id: "item-biology",
  title: "Cell division chapter 4 worksheet",
  description: "Complete the mitosis questions.",
  subject: "Biology",
  source: "academy.am.lu",
  sourceKind: "academy_moodle",
  type: "homework",
  status: "inbox",
  dueAt: "2026-08-20T18:00:00.000Z",
};

test("suggests a live Moodle assignment from meaningful filename evidence", () => {
  const match = suggestUploadDestination(
    "biology-mitosis-chapter-4.pdf",
    [assignment],
    new Date("2026-08-13T12:00:00.000Z"),
  );
  assert.equal(match?.academicItemId, assignment.id);
  assert.ok((match?.confidence ?? 0) >= 28);
});

test("does not invent a destination for a generic filename or completed item", () => {
  assert.equal(suggestUploadDestination("scan-001.pdf", [assignment]), null);
  assert.equal(suggestUploadDestination("biology-mitosis.pdf", [{ ...assignment, status: "done" }]), null);
});

test("checks file signatures and rejects empty or disguised files", () => {
  const valid = validateStagedUpload("answer.pdf", "application/pdf", Buffer.from("%PDF-1.7\nbody"));
  assert.equal(valid.mimeType, "application/pdf");
  assert.throws(() => validateStagedUpload("answer.pdf", "application/pdf", Buffer.from("not a pdf")), /contents/);
  assert.throws(() => validateStagedUpload("answer.pdf", "application/pdf", Buffer.alloc(0)), /empty/);
});
