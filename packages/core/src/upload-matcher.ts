import type { AcademicItemType, SourceKind } from "./model";

export type UploadMatchCandidate = {
  id: string;
  title: string;
  description: string | null;
  subject: string;
  source: string;
  sourceKind: SourceKind;
  type: AcademicItemType;
  status: "inbox" | "planned" | "in_progress" | "done" | "cancelled";
  dueAt: string | null;
};

export type UploadMatch = {
  academicItemId: string;
  confidence: number;
  reason: string;
};

const ignoredTokens = new Set([
  "assignment", "copy", "devoir", "document", "draft", "final", "homework",
  "hausaufgabe", "new", "school", "submission", "version", "work",
]);

function tokens(value: string) {
  return new Set(value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !ignoredTokens.has(token)));
}

function overlap(first: Set<string>, second: Set<string>) {
  return [...first].filter((token) => second.has(token));
}

function isSubmissionDestination(candidate: UploadMatchCandidate) {
  return ["teams", "academy_moodle", "edu_moodle"].includes(candidate.sourceKind)
    && !["done", "cancelled"].includes(candidate.status)
    && ["homework", "presentation", "deadline"].includes(candidate.type);
}

export function suggestUploadDestination(
  filename: string,
  candidates: UploadMatchCandidate[],
  reference = new Date(),
): UploadMatch | null {
  const fileTokens = tokens(filename);
  if (!fileTokens.size) return null;

  const scored = candidates.filter(isSubmissionDestination).map((candidate) => {
    const titleTokens = tokens(`${candidate.title} ${candidate.description ?? ""}`);
    const subjectTokens = tokens(candidate.subject);
    const titleMatches = overlap(fileTokens, titleTokens);
    const subjectMatches = overlap(fileTokens, subjectTokens);
    const titleRatio = titleMatches.length / Math.max(1, Math.min(fileTokens.size, titleTokens.size));
    let score = Math.round(titleRatio * 72) + Math.min(18, subjectMatches.length * 9);
    const dueAt = candidate.dueAt ? new Date(candidate.dueAt) : null;
    if (dueAt && !Number.isNaN(dueAt.getTime())) {
      const days = (dueAt.getTime() - reference.getTime()) / 86_400_000;
      if (days >= -1 && days <= 30) score += 6;
    }
    if (candidate.type === "homework") score += 4;
    return {
      candidate,
      score: Math.min(96, score),
      matchedTokens: [...new Set([...titleMatches, ...subjectMatches])],
    };
  }).sort((first, second) => second.score - first.score);

  const best = scored[0];
  if (!best || best.score < 28 || !best.matchedTokens.length) return null;
  return {
    academicItemId: best.candidate.id,
    confidence: best.score,
    reason: `Filename matched ${best.matchedTokens.slice(0, 3).join(", ")} in ${best.candidate.subject}.`,
  };
}
