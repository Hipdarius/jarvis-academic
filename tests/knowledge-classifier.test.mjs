import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalSubjectName,
  terminale1CISubjects,
} from "../packages/core/src/academic-catalog.ts";
import { classifyKnowledgeFile } from "../packages/core/src/knowledge-classifier.ts";

test("ships the complete 31-lesson terminale 1CI curriculum", () => {
  assert.equal(terminale1CISubjects.length, 12);
  assert.equal(terminale1CISubjects.reduce((sum, subject) => sum + subject.weeklyLessons, 0), 31);
  assert.deepEqual(
    [...new Set(terminale1CISubjects.map((subject) => subject.group))],
    ["Languages and mathematics", "Specialization", "General education"],
  );
});

test("canonicalizes multilingual school course names", () => {
  assert.equal(canonicalSubjectName("1CI - Science de la programmation"), "Programming");
  assert.equal(canonicalSubjectName("AMINF Datenbanken"), "Information Analysis & Modeling");
  assert.equal(canonicalSubjectName("Physique"), "Physics");
});

test("uses a school folder before incidental words in document text", () => {
  const result = classifyKnowledgeFile({
    name: "chapter-4.pdf",
    sourcePath: "1CI SCIPR > Semester 1 > Java > Chapter 4",
    text: "This programming exercise stores a result in a database.",
    createdAt: new Date("2026-10-12T08:00:00Z"),
  });
  assert.equal(result.subject, "Programming");
  assert.equal(result.academicPeriod, "2026-2027 / Semester 1");
  assert.deepEqual(result.topicPath, ["Java", "Chapter 4"]);
  assert.ok(result.confidence >= 80);
});

test("classifies a personal upload from its filename and content", () => {
  const result = classifyKnowledgeFile({
    name: "physics-mechanics-chapter-2.docx",
    text: "Kinetic energy and momentum exercises",
    createdAt: new Date("2027-03-02T08:00:00Z"),
  });
  assert.equal(result.subject, "Physics");
  assert.equal(result.academicPeriod, "2026-2027 / Semester 2");
  assert.deepEqual(result.topicPath, ["Chapter 2", "Mechanics"]);
});

test("keeps uncertain files visible without inventing a subject or chapter", () => {
  const result = classifyKnowledgeFile({
    name: "scan-0042.png",
    createdAt: new Date("2026-09-20T08:00:00Z"),
  });
  assert.equal(result.subject, "General");
  assert.equal(result.confidence, 0);
  assert.deepEqual(result.topicPath, ["Unclassified"]);
});
