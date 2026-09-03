import assert from "node:assert/strict";
import test from "node:test";

import { rankDocumentEvidence } from "../packages/core/src/document-retrieval.ts";

const base = {
  id: "biology-handbook",
  kind: "document",
  title: "Biology handbook",
  subject: "Biology",
  source: "academy.am.lu",
};

test("ranks the relevant PDF page ahead of unrelated opening pages", () => {
  const results = rankDocumentEvidence("How does mitosis create daughter cells?", [{
    ...base,
    text: "[Page 1]\nCourse introduction and classroom rules.\n\n[Page 2]\nPhotosynthesis uses light energy.\n\n[Page 7]\nMitosis creates two genetically identical daughter cells.",
  }]);
  assert.equal(results[0].locator, "page 7");
  assert.match(results[0].excerpt, /daughter cells/);
});

test("includes private uploads and limits repeated chunks from one file", () => {
  const repeated = Array.from({ length: 12 }, (_, index) => `Section ${index}: normalization prevents duplicated database facts.`).join("\n\n");
  const results = rankDocumentEvidence("database normalization", [{
    ...base,
    id: "upload-one",
    kind: "upload",
    title: "database notes.txt",
    subject: "Computer Science",
    source: "Private upload",
    text: repeated,
  }], 12);
  assert.equal(results.every((entry) => entry.kind === "upload"), true);
  assert.ok(results.length <= 2);
});

test("falls back to bounded evidence when wording does not overlap", () => {
  const results = rankDocumentEvidence("Explain the exam", [{ ...base, text: "Chapter overview and learning objectives." }]);
  assert.equal(results.length, 1);
  assert.equal(results[0].score, 0);
});
