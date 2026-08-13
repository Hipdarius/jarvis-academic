import { createHash } from "node:crypto";

import { workerConfig } from "./config.mjs";
import { parseSourceDate } from "./source-time.mjs";

const explicitTask = /\b(assign(?:ment)?|aufgabe(?:n)?|devoir|due|exam|examen|exercise(?:s)?|hausaufgabe(?:n)?|homework|pr(?:u|ue)fung(?:en)?|presentation|referat|submit|test|worksheet)\b/i;
const presentationSignal = /\b(presentation|referat|vortrag|powerpoint|slides?)\b/i;
const subjectRules = [
  ["Mathematics", /\b(algebra|analysis|calculus|math(?:ematics?)?|mathematik|matrix|probability|trigonometry)\b/i],
  ["Databases", /\b(database|datenbank|normalization|sql)\b/i],
  ["Computer Science", /\b(computer science|informatik|java|netbeans|programming|python)\b/i],
  ["Physics", /\b(physics|physik|mechanics?)\b/i],
  ["Economics", /\b(economics?|economy|wirtschaft)\b/i],
  ["English", /\benglish|anglais\b/i],
  ["French", /\bfran(?:c|cais)|french\b/i],
  ["German", /\bdeutsch|german\b/i],
];

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stableId(source, bucket, row) {
  if (row.externalId) return clean(row.externalId).slice(0, 160);
  return createHash("sha256")
    .update(`${source}\u0000${bucket}\u0000${clean(row.text)}\u0000${clean(row.href)}`)
    .digest("hex")
    .slice(0, 32);
}

function inferredSubject(text) {
  return subjectRules.find(([, pattern]) => pattern.test(text))?.[0] ?? undefined;
}

function rowTitle(row, fallback) {
  const cells = Array.isArray(row.cells) ? row.cells.map(clean).filter(Boolean) : [];
  const candidates = cells.filter((value) => !/^\d{1,2}[.\/-]\d{1,2}/.test(value) && !/^\d{1,2}:\d{2}$/.test(value));
  const explicit = candidates.find((value) => explicitTask.test(value) && value.length >= 5);
  const longest = [...candidates].sort((a, b) => b.length - a.length)[0];
  return clean(row.title || explicit || longest || row.ariaLabel || row.text || fallback).slice(0, 300);
}

function typeFor(bucket, text) {
  if (/mitteilung|announcement|news/i.test(bucket)) return "announcement";
  if (presentationSignal.test(text)) return "presentation";
  if (/exam|examen|test/i.test(bucket) || /\b(exam|examen|test)\b/i.test(text)) return "test";
  if (/lesson|stunde|timetable|stundenplan/i.test(bucket)) return "lesson";
  if (/homework|hausaufgabe|assignment|devoir/i.test(bucket) || explicitTask.test(text)) return "homework";
  return null;
}

function normalizeRow({ source, sourceKind, bucket, row, reference }) {
  const text = clean([row.text, row.description, row.ariaLabel, row.title, ...(row.cells ?? [])].filter(Boolean).join(" | "));
  const type = typeFor(bucket, text);
  const taskLink = /\/(?:mod\/assign|assignments?)(?:\/|$)/i.test(row.href ?? "");
  if (!type && !taskLink) return null;
  const resolvedType = type ?? "homework";
  const title = rowTitle(row, `${bucket} item`);
  if (!title || title.length < 3) return null;
  const sourceDate = parseSourceDate(text, { reference, timeZone: workerConfig.timezone });
  const item = {
    source: sourceKind,
    sourceExternalId: `${source}:${stableId(source, bucket, row)}`,
    type: resolvedType,
    title,
    description: clean(row.description || (text === title ? "" : text)).slice(0, 2_000) || undefined,
    subject: clean(row.subject) || inferredSubject(text),
    teacher: clean(row.teacher) || undefined,
    sourceUrl: row.href || undefined,
    evidence: "source_derived",
    confidence: sourceDate?.precision === "datetime" ? 94 : sourceDate ? 86 : 82,
    raw: {
      bucket,
      dueLabel: sourceDate?.label,
      duePrecision: sourceDate?.precision,
      submissionStatus: clean(row.submissionStatus) || undefined,
      courseExternalId: clean(row.courseExternalId) || undefined,
    },
  };
  if (sourceDate?.iso) {
    if (resolvedType === "lesson") item.startsAt = sourceDate.iso;
    else if (resolvedType !== "announcement") item.dueAt = sourceDate.iso;
  }
  return item;
}

export function normalizeWebUntisSections(sections, reference = new Date()) {
  const items = [];
  for (const section of sections ?? []) {
    for (const row of section.items ?? []) {
      const item = normalizeRow({ source: "webuntis", sourceKind: "webuntis", bucket: section.label, row, reference });
      if (item) items.push(item);
    }
  }
  return deduplicate(items);
}

export function normalizeMoodleRows(source, rows, reference = new Date()) {
  const sourceKind = source === "academy" ? "academy_moodle" : "edu_moodle";
  const items = (rows ?? []).flatMap((row) => {
    const text = clean(`${row.text} ${row.title} ${row.ariaLabel}`);
    const isAssignment = /\/mod\/assign(?:\/|$)/i.test(row.href ?? "") || explicitTask.test(text);
    if (!isAssignment) return [];
    const item = normalizeRow({ source, sourceKind, bucket: "assignment", row, reference });
    return item ? [item] : [];
  });
  return deduplicate(items);
}

export function normalizeTeamsRows(rows, reference = new Date()) {
  const items = (rows ?? []).flatMap((row) => {
    const text = clean(`${row.text} ${row.title} ${row.ariaLabel}`);
    const isAssignment = /assignments?/i.test(row.href ?? "") || explicitTask.test(text);
    if (!isAssignment) return [];
    const item = normalizeRow({ source: "teams", sourceKind: "teams", bucket: "assignment", row, reference });
    return item ? [item] : [];
  });
  return deduplicate(items);
}

function deduplicate(items) {
  return [...new Map(items.map((item) => [item.sourceExternalId, item])).values()];
}
