import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";

import type { CommandIntent } from "@/packages/core/src/command-router";
import { canonicalSubjectName, terminale1CISubjects } from "@/packages/core/src/academic-catalog";
import type { DashboardState, ProviderStatus } from "@/packages/core/src/dashboard";
import { rankDocumentEvidence } from "@/packages/core/src/document-retrieval";
import { classifyKnowledgeFile } from "@/packages/core/src/knowledge-classifier";
import type { NormalizedAcademicItem, SourceKind } from "@/packages/core/src/model";
import { buildAdaptiveStudyBlocks } from "@/packages/core/src/study-planner";
import {
  suggestUploadDestination,
  type UploadMatchCandidate,
} from "@/packages/core/src/upload-matcher";
import { getDb } from "./index";
import {
  academicItems,
  agentJobs,
  agentMessages,
  agentRuns,
  auditEvents,
  documents,
  improvementProposals,
  knowledgeNotes,
  projectCanvases,
  sources,
  stagedUploads,
  studyBlocks,
  subjects,
  syncRuns,
  workerTokens,
} from "./schema";

const sourceDefinitions: Array<{
  id: string;
  kind: SourceKind;
  name: string;
  baseUrl: string | null;
}> = [
  { id: "source:webuntis", kind: "webuntis", name: "WebUntis", baseUrl: "https://lam.webuntis.com/WebUntis/" },
  { id: "source:teams", kind: "teams", name: "Microsoft Teams", baseUrl: "https://teams.microsoft.com/" },
  { id: "source:academy", kind: "academy_moodle", name: "academy.am.lu", baseUrl: "https://academy.am.lu/" },
  { id: "source:edumoodle", kind: "edu_moodle", name: "eduMoodle", baseUrl: "https://ssl.education.lu/eduMoodle/" },
  { id: "source:manual", kind: "manual", name: "Universal Command", baseUrl: null },
];

const workerSourceMap = {
  webuntis: sourceDefinitions[0],
  teams: sourceDefinitions[1],
  academy: sourceDefinitions[2],
  edumoodle: sourceDefinitions[3],
} as const;

export type WorkerSourceKey = keyof typeof workerSourceMap;

export type WorkerSyncPayload = {
  source: WorkerSourceKey;
  health: {
    state: string;
    checkedAt?: string;
    requiresUserAction?: boolean;
    pageTitle?: string;
  };
  items: NormalizedAcademicItem[];
  documents?: Array<{
    sourceExternalId: string;
    academicItemExternalId?: string;
    subject?: string;
    name: string;
    mimeType?: string;
    storageKey: string;
    checksum: string;
    sourceUrl?: string;
    extractedText?: string | null;
    sourcePath?: string;
    size?: number;
  }>;
  warnings?: string[];
  extractorState?: string;
  agentAutoTriage?: boolean;
  startedAt?: string;
  finishedAt?: string;
  discoveryCount?: number;
};

type AgentRole = "curator" | "planner" | "tutor" | "reviewer" | "improver" | "coder";
type AgentJobKind = "triage" | "study_pack" | "project_research" | "review" | "planning" | "subject_chat" | "improvement" | "code_change";

function safeDate(value: string | undefined, fallback = new Date()) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function safeJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function safeStringArray(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 4) : [];
  } catch {
    return [];
  }
}

function safeSourceUrl(value: string | undefined | null, definition: (typeof sourceDefinitions)[number]) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    const sourceHost = definition.baseUrl ? new URL(definition.baseUrl).hostname : null;
    const allowed = parsed.hostname === sourceHost
      || (definition.kind === "teams" && (parsed.hostname === "teams.microsoft.com" || parsed.hostname.endsWith(".sharepoint.com")));
    if (!allowed) return null;
    return `${parsed.origin}${parsed.pathname}`.slice(0, 1_000);
  } catch {
    return null;
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function messageContent(value: string) {
  const parsed = safeJson(value);
  if (typeof parsed?.summary === "string") return parsed.summary;
  if (typeof parsed?.text === "string") return parsed.text;
  if (typeof parsed?.instruction === "string") return parsed.instruction;
  return value.slice(0, 600);
}

function subjectIdFor(name: string) {
  const canonical = canonicalSubjectName(name);
  const normalized = canonical.toLowerCase();
  const slug = normalized.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "general";
  return { id: `subject:${slug}`, normalized, name: canonical };
}

async function ensureSource(definition: (typeof sourceDefinitions)[number]) {
  const db = getDb();
  await db.insert(sources).values({
    id: definition.id,
    kind: definition.kind,
    displayName: definition.name,
    baseUrl: definition.baseUrl,
    status: "unconfigured",
  }).onConflictDoNothing();
}

async function ensureSubject(name: string) {
  const db = getDb();
  const identity = subjectIdFor(name);
  await db.insert(subjects).values({
    id: identity.id,
    name: identity.name,
    normalizedName: identity.normalized,
  }).onConflictDoNothing();
  return identity.id;
}

function configuredProviders(): ProviderStatus[] {
  return [
    { id: "openai", name: "OpenAI", configured: Boolean(process.env.OPENAI_API_KEY), role: "Command routing and high-confidence planning" },
    { id: "hermes", name: "Hermes Agent", configured: Boolean(process.env.JARVIS_HERMES_BASE_URL && process.env.JARVIS_HERMES_API_KEY), role: "Tool-using autonomous agent gateway" },
    { id: "nous", name: "Nous Portal", configured: Boolean(process.env.NOUS_API_KEY && process.env.NOUS_MODEL), role: "OpenAI-compatible model routing" },
    { id: "openrouter", name: "OpenRouter", configured: Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL), role: "Low-cost multi-model fallback" },
    { id: "anthropic", name: "Anthropic", configured: Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MODEL), role: "Long-form review and project reasoning" },
  ];
}

export async function readDashboardState(): Promise<DashboardState> {
  const db = getDb();
  const [itemRows, sourceRows, projectRows, noteRows, jobRows, documentRows, uploadRows, blockRows, runRows, messageRows, proposalRows, subjectRows] = await Promise.all([
    db.select({
      item: academicItems,
      subjectName: subjects.name,
      sourceName: sources.displayName,
      sourceKind: sources.kind,
    }).from(academicItems)
      .leftJoin(subjects, eq(academicItems.subjectId, subjects.id))
      .innerJoin(sources, eq(academicItems.sourceId, sources.id))
      .orderBy(desc(academicItems.updatedAt))
      .limit(120),
    db.select().from(sources),
    db.select().from(projectCanvases).orderBy(desc(projectCanvases.updatedAt)).limit(60),
    db.select().from(knowledgeNotes).orderBy(desc(knowledgeNotes.updatedAt)).limit(80),
    db.select().from(agentJobs).orderBy(desc(agentJobs.createdAt)).limit(20),
    db.select({
      document: documents,
      sourceName: sources.displayName,
      subjectName: subjects.name,
    }).from(documents)
      .leftJoin(sources, eq(documents.sourceId, sources.id))
      .leftJoin(subjects, eq(documents.subjectId, subjects.id))
      .orderBy(desc(documents.updatedAt))
      .limit(500),
    db.select({
      upload: stagedUploads,
      item: academicItems,
      subjectName: subjects.name,
      sourceName: sources.displayName,
      sourceKind: sources.kind,
    }).from(stagedUploads)
      .leftJoin(academicItems, eq(stagedUploads.academicItemId, academicItems.id))
      .leftJoin(subjects, eq(academicItems.subjectId, subjects.id))
      .leftJoin(sources, eq(academicItems.sourceId, sources.id))
      .orderBy(desc(stagedUploads.createdAt))
      .limit(100),
    db.select({
      block: studyBlocks,
      subjectName: subjects.name,
    }).from(studyBlocks)
      .leftJoin(subjects, eq(studyBlocks.subjectId, subjects.id))
      .orderBy(asc(studyBlocks.scheduledFor))
      .limit(120),
    db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt)).limit(12),
    db.select().from(agentMessages).orderBy(desc(agentMessages.createdAt)).limit(100),
    db.select().from(improvementProposals).orderBy(desc(improvementProposals.createdAt)).limit(20),
    db.select().from(subjects),
  ]);

  const storedSources = new Map(sourceRows.map((source) => [source.id, source]));
  const storedSubjects = new Map(subjectRows.map((subject) => [subject.id, subject]));
  const curriculumNames = new Set(terminale1CISubjects.map((subject) => subject.name));
  const dashboardSubjects = [
    ...terminale1CISubjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
      officialName: subject.officialName,
      group: subject.group,
      weeklyLessons: subject.weeklyLessons,
      curriculum: true,
    })),
    ...subjectRows.map((subject) => canonicalSubjectName(subject.name)).filter((name, index, all) => (
      name !== "General" && !curriculumNames.has(name) && all.indexOf(name) === index
    )).map((name) => ({
      id: `observed:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name,
      officialName: null,
      group: "Observed" as const,
      weeklyLessons: null,
      curriculum: false,
    })),
  ];
  const dashboardSources = sourceDefinitions.filter((definition) => definition.kind !== "manual").map((definition) => {
    const stored = storedSources.get(definition.id);
    const status = stored?.status ?? "unconfigured";
    const detail = status === "unconfigured"
      ? "Worker has not reported yet"
      : stored?.lastError
        ? stored.lastError
        : stored?.lastSuccessAt
          ? `Last read ${stored.lastSuccessAt.toISOString()}`
          : "Waiting for first successful read";
    return {
      id: definition.id,
      kind: definition.kind,
      name: definition.name,
      status,
      lastSuccessAt: iso(stored?.lastSuccessAt),
      lastAttemptAt: iso(stored?.lastAttemptAt),
      detail,
    };
  });

  return {
    mode: "live",
    generatedAt: new Date().toISOString(),
    subjects: dashboardSubjects,
    items: itemRows.map(({ item, subjectName, sourceName, sourceKind }) => {
      const raw = safeJson(item.rawJson);
      return {
        id: item.id,
        type: item.type,
        title: item.title,
        description: item.description,
        subject: canonicalSubjectName(subjectName),
        source: sourceName,
        sourceKind,
        startsAt: iso(item.startsAt),
        dueAt: iso(item.dueAt),
        dueLabel: typeof raw?.dueLabel === "string" ? raw.dueLabel : null,
        status: item.status,
        evidence: item.evidence,
        confidence: item.confidence,
        sourceUrl: item.sourceUrl,
      };
    }),
    sources: dashboardSources,
    projects: projectRows.map((project) => ({
      id: project.id,
      title: project.title,
      brief: project.brief,
      subject: canonicalSubjectName(project.subject),
      status: project.status,
      createdAt: project.createdAt.toISOString(),
    })),
    notes: noteRows.map((note) => ({
      id: note.id,
      title: note.title,
      body: note.body,
      subject: canonicalSubjectName(note.subject),
      createdAt: note.createdAt.toISOString(),
    })),
    documents: documentRows.map(({ document, sourceName, subjectName }) => {
      const storedTopics = safeStringArray(document.topicPathJson);
      const storedSubject = canonicalSubjectName(subjectName);
      const hasStoredClassification = Boolean(
        document.academicPeriod
        && storedTopics.length
        && document.classificationConfidence !== null
        && document.classificationReason,
      );
      const inferred = hasStoredClassification ? null : classifyKnowledgeFile({
        name: document.name,
        text: document.extractedText,
        sourcePath: document.sourcePath,
        subjectHint: subjectName,
        createdAt: document.createdAt,
      });
      return {
        id: document.id,
        name: document.name,
        mimeType: document.mimeType,
        source: sourceName ?? "Local worker",
        subject: !hasStoredClassification && storedSubject === "General" ? inferred?.subject ?? "General" : storedSubject,
        academicItemId: document.academicItemId,
        sourceUrl: document.sourceUrl,
        extracted: Boolean(document.extractedText),
        sourcePath: document.sourcePath,
        academicPeriod: document.academicPeriod ?? inferred?.academicPeriod ?? "Unscheduled",
        topicPath: storedTopics.length ? storedTopics : inferred?.topicPath ?? ["Unclassified"],
        classificationConfidence: document.classificationConfidence ?? inferred?.confidence ?? null,
        classificationReason: document.classificationReason ?? inferred?.reason ?? null,
        createdAt: document.createdAt.toISOString(),
      };
    }),
    stagedUploads: uploadRows.map(({ upload, item, subjectName, sourceName, sourceKind }) => {
      const storedSubject = canonicalSubjectName(storedSubjects.get(upload.subjectId ?? "")?.name ?? subjectName);
      const storedTopics = safeStringArray(upload.topicPathJson);
      const hasStoredClassification = Boolean(
        upload.academicPeriod
        && storedTopics.length
        && upload.classificationConfidence !== null
        && upload.classificationReason,
      );
      const inferred = hasStoredClassification ? null : classifyKnowledgeFile({
        name: upload.originalName,
        text: upload.extractedText,
        subjectHint: storedSubject,
        academicItemTitle: item?.title,
        createdAt: upload.createdAt,
      });
      return {
        id: upload.id,
        name: upload.originalName,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        checksum: upload.checksum,
        status: upload.status,
        matchConfidence: upload.matchConfidence,
        matchReason: upload.matchReason,
        extractor: upload.extractor,
        pageCount: upload.pageCount,
        processingMessage: upload.processingMessage,
        attemptCount: upload.attemptCount,
        processingStartedAt: iso(upload.processingStartedAt),
        processingFinishedAt: iso(upload.processingFinishedAt),
        createdAt: upload.createdAt.toISOString(),
        subject: !hasStoredClassification && storedSubject === "General" ? inferred?.subject ?? "General" : storedSubject,
        academicPeriod: upload.academicPeriod ?? inferred?.academicPeriod ?? "Unscheduled",
        topicPath: storedTopics.length ? storedTopics : inferred?.topicPath ?? ["Unclassified"],
        classificationConfidence: upload.classificationConfidence ?? inferred?.confidence ?? null,
        classificationReason: upload.classificationReason ?? inferred?.reason ?? null,
        destination: item && sourceKind ? {
          academicItemId: item.id,
          title: item.title,
          subject: canonicalSubjectName(subjectName),
          source: sourceName ?? "School source",
          sourceKind,
          dueAt: iso(item.dueAt),
          sourceUrl: item.sourceUrl,
        } : null,
      };
    }),
    studyBlocks: blockRows.map(({ block, subjectName }) => ({
      id: block.id,
      academicItemId: block.academicItemId,
      subject: canonicalSubjectName(subjectName),
      title: block.title,
      scheduledFor: block.scheduledFor,
      durationMinutes: block.durationMinutes,
      reason: block.reason,
      status: block.status,
      generatedBy: block.generatedBy,
    })),
    agentRuns: runRows.map((run) => ({
      id: run.id,
      trigger: run.trigger,
      status: run.status,
      objective: run.objective,
      usedJobs: run.usedJobs,
      budgetJobs: run.budgetJobs,
      usedTokens: run.usedTokens,
      budgetTokens: run.budgetTokens,
      summary: run.summary,
      createdAt: run.createdAt.toISOString(),
      messages: messageRows.filter((message) => message.runId === run.id).slice(0, 8).map((message) => ({
        id: message.id,
        sender: message.sender,
        recipient: message.recipient,
        kind: message.kind,
        content: messageContent(message.contentJson),
        createdAt: message.createdAt.toISOString(),
      })),
    })),
    improvementProposals: proposalRows.map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      rationale: proposal.rationale,
      status: proposal.status,
      branchName: proposal.branchName,
      implementationSummary: proposal.implementationSummary,
      createdAt: proposal.createdAt.toISOString(),
    })),
    agentJobs: jobRows.map((job) => {
      const input = parseJobInput(job.inputJson);
      return {
        id: job.id,
        kind: job.kind,
        status: job.status,
        provider: job.provider?.startsWith("claim:") ? null : job.provider,
        model: job.model,
        runId: job.runId,
        agentRole: job.agentRole,
        prompt: typeof input.prompt === "string" ? input.prompt : null,
        subject: typeof input.subject === "string" ? input.subject : null,
        result: job.resultJson,
        error: job.error,
        createdAt: job.createdAt.toISOString(),
      };
    }),
    providers: configuredProviders(),
  };
}

async function activeSubmissionCandidates(): Promise<UploadMatchCandidate[]> {
  const db = getDb();
  const rows = await db.select({
    item: academicItems,
    subjectName: subjects.name,
    sourceName: sources.displayName,
    sourceKind: sources.kind,
  }).from(academicItems)
    .leftJoin(subjects, eq(academicItems.subjectId, subjects.id))
    .innerJoin(sources, eq(academicItems.sourceId, sources.id))
    .orderBy(asc(academicItems.dueAt))
    .limit(300);
  return rows.map(({ item, subjectName, sourceName, sourceKind }) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    subject: subjectName ?? "General",
    source: sourceName,
    sourceKind,
    type: item.type,
    status: item.status,
    dueAt: iso(item.dueAt),
  })).filter((candidate) => (
    ["teams", "academy_moodle", "edu_moodle"].includes(candidate.sourceKind)
    && !["done", "cancelled"].includes(candidate.status)
    && ["homework", "presentation", "deadline"].includes(candidate.type)
  ));
}

export async function createStagedUpload(input: {
  objectKey: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  academicItemId?: string | null;
}) {
  const db = getDb();
  const candidates = await activeSubmissionCandidates();
  const selected = input.academicItemId
    ? candidates.find((candidate) => candidate.id === input.academicItemId)
    : null;
  if (input.academicItemId && !selected) throw new Error("The selected destination is no longer available.");
  const suggestion = selected
    ? { academicItemId: selected.id, confidence: 100, reason: "Destination chosen by you." }
    : suggestUploadDestination(input.name, candidates);
  const matchedCandidate = suggestion
    ? candidates.find((candidate) => candidate.id === suggestion.academicItemId) ?? null
    : null;
  const classification = classifyKnowledgeFile({
    name: input.name,
    subjectHint: matchedCandidate?.subject ?? null,
    academicItemTitle: matchedCandidate?.title ?? null,
  });
  const classifiedSubjectId = classification.subject === "General"
    ? null
    : await ensureSubject(classification.subject);
  const id = `upload:${crypto.randomUUID()}`;
  const now = new Date();
  await db.insert(stagedUploads).values({
    id,
    objectKey: input.objectKey,
    originalName: input.name.slice(0, 240),
    mimeType: input.mimeType.slice(0, 120),
    sizeBytes: input.sizeBytes,
    checksum: input.checksum.toLowerCase(),
    academicItemId: suggestion?.academicItemId ?? null,
    subjectId: classifiedSubjectId,
    matchConfidence: suggestion?.confidence ?? null,
    matchReason: suggestion?.reason ?? null,
    academicPeriod: classification.academicPeriod,
    topicPathJson: JSON.stringify(classification.topicPath),
    classificationConfidence: classification.confidence,
    classificationReason: classification.reason,
    status: "staged",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    action: "file_staged",
    entityType: "staged_upload",
    entityId: id,
    actor: "user",
    detailsJson: JSON.stringify({
      academicItemId: suggestion?.academicItemId ?? null,
      matchConfidence: suggestion?.confidence ?? null,
      subject: classification.subject,
      topicPath: classification.topicPath,
      sizeBytes: input.sizeBytes,
      checksumPrefix: input.checksum.slice(0, 12),
    }),
    createdAt: now,
  }).catch(() => undefined);
  return { id, match: suggestion ?? null };
}

export async function getStagedUploadFile(id: string) {
  const db = getDb();
  return (await db.select({
    id: stagedUploads.id,
    objectKey: stagedUploads.objectKey,
    name: stagedUploads.originalName,
    mimeType: stagedUploads.mimeType,
    sizeBytes: stagedUploads.sizeBytes,
    checksum: stagedUploads.checksum,
    status: stagedUploads.status,
  }).from(stagedUploads).where(eq(stagedUploads.id, id)).limit(1))[0] ?? null;
}

export async function claimNextStagedUpload() {
  const db = getDb();
  const staleBefore = new Date(Date.now() - 15 * 60_000);
  await db.update(stagedUploads).set({
    status: "staged",
    processingLeaseId: null,
    processingStartedAt: null,
    processingMessage: "Previous indexing attempt timed out; returned to the queue.",
    updatedAt: new Date(),
  }).where(and(eq(stagedUploads.status, "processing"), lt(stagedUploads.processingStartedAt, staleBefore)));

  const candidate = (await db.select().from(stagedUploads)
    .where(eq(stagedUploads.status, "staged"))
    .orderBy(asc(stagedUploads.createdAt))
    .limit(1))[0];
  if (!candidate) return null;

  const leaseId = crypto.randomUUID();
  const startedAt = new Date();
  await db.update(stagedUploads).set({
    status: "processing",
    processingLeaseId: leaseId,
    processingStartedAt: startedAt,
    processingFinishedAt: null,
    processingMessage: "Local worker is verifying and reading this file.",
    attemptCount: sql`${stagedUploads.attemptCount} + 1`,
    updatedAt: startedAt,
  }).where(and(eq(stagedUploads.id, candidate.id), eq(stagedUploads.status, "staged")));
  const claimed = (await db.select().from(stagedUploads).where(and(
    eq(stagedUploads.id, candidate.id),
    eq(stagedUploads.status, "processing"),
    eq(stagedUploads.processingLeaseId, leaseId),
  )).limit(1))[0];
  if (!claimed) return null;

  return {
    id: claimed.id,
    leaseId,
    name: claimed.originalName,
    mimeType: claimed.mimeType,
    sizeBytes: claimed.sizeBytes,
    checksum: claimed.checksum,
    attemptCount: claimed.attemptCount,
    createdAt: claimed.createdAt.toISOString(),
  };
}

export async function getClaimedStagedUploadFile(id: string, leaseId: string) {
  const db = getDb();
  return (await db.select({
    id: stagedUploads.id,
    objectKey: stagedUploads.objectKey,
    name: stagedUploads.originalName,
    mimeType: stagedUploads.mimeType,
    sizeBytes: stagedUploads.sizeBytes,
    checksum: stagedUploads.checksum,
  }).from(stagedUploads).where(and(
    eq(stagedUploads.id, id),
    eq(stagedUploads.status, "processing"),
    eq(stagedUploads.processingLeaseId, leaseId),
  )).limit(1))[0] ?? null;
}

export async function finishStagedUpload(id: string, leaseId: string, payload: {
  status: "indexed" | "stored" | "failed";
  extractedText?: string | null;
  extractor?: string | null;
  pageCount?: number | null;
  message?: string | null;
}) {
  const db = getDb();
  const existing = (await db.select().from(stagedUploads).where(and(
    eq(stagedUploads.id, id),
    eq(stagedUploads.status, "processing"),
    eq(stagedUploads.processingLeaseId, leaseId),
  )).limit(1))[0];
  if (!existing) return null;
  const finishedAt = new Date();
  const extractedText = payload.status === "indexed" ? payload.extractedText?.trim().slice(0, 100_000) || null : null;
  if (payload.status === "indexed" && !extractedText) throw new Error("Indexed upload results require extracted text.");
  const linked = existing.academicItemId
    ? (await db.select({ item: academicItems, subjectName: subjects.name })
      .from(academicItems)
      .leftJoin(subjects, eq(academicItems.subjectId, subjects.id))
      .where(eq(academicItems.id, existing.academicItemId))
      .limit(1))[0] ?? null
    : null;
  const classification = classifyKnowledgeFile({
    name: existing.originalName,
    text: extractedText,
    subjectHint: linked?.subjectName ?? null,
    academicItemTitle: linked?.item.title ?? null,
    createdAt: existing.createdAt,
  });
  const classifiedSubjectId = classification.subject === "General"
    ? null
    : await ensureSubject(classification.subject);
  await db.update(stagedUploads).set({
    status: payload.status,
    extractedText,
    extractor: payload.extractor?.slice(0, 80) ?? null,
    pageCount: payload.pageCount === null || payload.pageCount === undefined
      ? null
      : Math.max(1, Math.min(250, Math.round(payload.pageCount))),
    subjectId: classifiedSubjectId,
    academicPeriod: classification.academicPeriod,
    topicPathJson: JSON.stringify(classification.topicPath),
    classificationConfidence: classification.confidence,
    classificationReason: classification.reason,
    processingMessage: payload.message?.slice(0, 500) ?? null,
    processingLeaseId: null,
    processingFinishedAt: finishedAt,
    updatedAt: finishedAt,
  }).where(and(
    eq(stagedUploads.id, id),
    eq(stagedUploads.status, "processing"),
    eq(stagedUploads.processingLeaseId, leaseId),
  ));
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    action: "staged_file_processed",
    entityType: "staged_upload",
    entityId: id,
    actor: "connector",
    detailsJson: JSON.stringify({
      status: payload.status,
      extractor: payload.extractor ?? null,
      pageCount: payload.pageCount ?? null,
      subject: classification.subject,
      classificationConfidence: classification.confidence,
      topicPath: classification.topicPath,
    }),
    createdAt: finishedAt,
  }).catch(() => undefined);
  return { id, status: payload.status };
}

export async function retryStagedUpload(id: string) {
  const db = getDb();
  const existing = (await db.select().from(stagedUploads).where(eq(stagedUploads.id, id)).limit(1))[0];
  if (!existing || !["stored", "failed"].includes(existing.status)) return null;
  const updatedAt = new Date();
  await db.update(stagedUploads).set({
    status: "staged",
    extractedText: null,
    extractor: null,
    pageCount: null,
    processingMessage: "Queued for another local indexing attempt.",
    processingLeaseId: null,
    processingStartedAt: null,
    processingFinishedAt: null,
    updatedAt,
  }).where(and(eq(stagedUploads.id, id), eq(stagedUploads.status, existing.status)));
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    action: "staged_file_requeued",
    entityType: "staged_upload",
    entityId: id,
    actor: "user",
    detailsJson: JSON.stringify({ previousStatus: existing.status }),
    createdAt: updatedAt,
  }).catch(() => undefined);
  return { id, status: "staged" as const };
}

export async function deleteStagedUploadRecord(id: string) {
  const db = getDb();
  const existing = await getStagedUploadFile(id);
  if (!existing) return null;
  await db.delete(stagedUploads).where(eq(stagedUploads.id, id));
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    action: "staged_file_deleted",
    entityType: "staged_upload",
    entityId: id,
    actor: "user",
    detailsJson: "{}",
    createdAt: new Date(),
  }).catch(() => undefined);
  return existing;
}

function dueDateFromLabel(label: string | null) {
  if (!label) return null;
  const normalized = label.toLowerCase();
  const now = new Date();
  if (normalized === "today") return now;
  if (normalized === "tomorrow") return new Date(now.getTime() + 86_400_000);
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const weekday = weekdays.findIndex((day) => normalized.endsWith(day));
  if (weekday >= 0) {
    let days = (weekday - now.getUTCDay() + 7) % 7;
    if (days === 0 || normalized.startsWith("next ")) days += 7;
    return new Date(now.getTime() + days * 86_400_000);
  }
  return null;
}

async function queueAgentRun({
  trigger,
  objective,
  kind,
  role,
  priority,
  input,
  sourceId = null,
  subjectId = null,
  budgetJobs = 3,
  budgetTokens = 6000,
}: {
  trigger: "sync" | "chat" | "user" | "improvement";
  objective: string;
  kind: AgentJobKind;
  role: AgentRole;
  priority: number;
  input: Record<string, unknown>;
  sourceId?: string | null;
  subjectId?: string | null;
  budgetJobs?: number;
  budgetTokens?: number;
}) {
  const db = getDb();
  const now = new Date();
  const runId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const tokenBudget = Math.min(2400, budgetTokens);
  await db.insert(agentRuns).values({
    id: runId,
    trigger,
    sourceId,
    subjectId,
    status: "queued",
    objective: objective.slice(0, 1_000),
    budgetJobs: Math.max(1, Math.min(6, budgetJobs)),
    budgetTokens: Math.max(500, Math.min(20_000, budgetTokens)),
    createdAt: now,
  });
  await db.insert(agentJobs).values({
    id: jobId,
    runId,
    agentRole: role,
    kind,
    status: "queued",
    priority,
    tokenBudget,
    inputJson: JSON.stringify(input).slice(0, 100_000),
    createdAt: now,
  });
  await db.insert(agentMessages).values({
    id: crypto.randomUUID(),
    runId,
    jobId,
    sender: "orchestrator",
    recipient: role,
    kind: "task",
    contentJson: JSON.stringify({ instruction: input.instruction ?? objective }),
    createdAt: now,
  });
  return { runId, jobId };
}

export async function saveCommandIntent(intent: CommandIntent, originalText: string) {
  const db = getDb();
  const now = new Date();
  const auditId = crypto.randomUUID();
  let entityId: string | null = null;
  let entityType = "question";
  let jobId: string | null = null;

  if (intent.action === "create_homework" || intent.action === "create_study_session") {
    const source = sourceDefinitions.find((definition) => definition.kind === "manual")!;
    await ensureSource(source);
    const subjectId = intent.subject ? await ensureSubject(intent.subject) : null;
    entityId = crypto.randomUUID();
    entityType = "academic_item";
    await db.insert(academicItems).values({
      id: entityId,
      sourceId: source.id,
      sourceExternalId: `command:${entityId}`,
      subjectId,
      type: intent.action === "create_homework" ? "homework" : "personal",
      title: intent.title,
      description: originalText,
      dueAt: dueDateFromLabel(intent.dueLabel),
      status: intent.action === "create_study_session" ? "planned" : "inbox",
      evidence: "manual",
      confidence: Math.round(intent.confidence * 100),
      rawJson: JSON.stringify({ commandAction: intent.action, dueLabel: intent.dueLabel }),
      firstSeenAt: now,
      lastSeenAt: now,
      updatedAt: now,
    });
  } else if (intent.action === "create_project_canvas") {
    const subjectId = intent.subject ? await ensureSubject(intent.subject) : null;
    entityId = crypto.randomUUID();
    entityType = "project_canvas";
    await db.insert(projectCanvases).values({
      id: entityId,
      title: intent.canvasTitle ?? intent.title,
      brief: originalText,
      subject: intent.subject ?? "Independent project",
      status: "idea",
      createdAt: now,
      updatedAt: now,
    });
    const queued = await queueAgentRun({
      trigger: "user",
      objective: `Research project: ${intent.canvasTitle ?? intent.title}`,
      kind: "project_research",
      role: "tutor",
      priority: 45,
      subjectId,
      input: {
        prompt: originalText,
        title: intent.canvasTitle ?? intent.title,
        subject: intent.subject,
        instruction: "Research the concept, identify key questions, credible starting points, risks, and three concrete next actions. State uncertainty.",
      },
    });
    jobId = queued.jobId;
  } else if (intent.action === "create_knowledge_note") {
    entityId = crypto.randomUUID();
    entityType = "knowledge_note";
    await db.insert(knowledgeNotes).values({
      id: entityId,
      title: intent.title,
      body: originalText,
      subject: intent.subject ?? "General",
      createdAt: now,
      updatedAt: now,
    });
  } else if (intent.action === "ask_jarvis") {
    const subjectId = intent.subject ? await ensureSubject(intent.subject) : null;
    const queued = await queueAgentRun({
      trigger: "chat",
      objective: intent.title,
      kind: "subject_chat",
      role: "tutor",
      priority: 60,
      subjectId,
      budgetJobs: 1,
      budgetTokens: 2400,
      input: {
        prompt: originalText,
        title: intent.title,
        subject: intent.subject,
        instruction: "Answer the student's question using only available context. Explain missing evidence and propose the safest useful next step.",
      },
    });
    jobId = queued.jobId;
  }

  await db.insert(auditEvents).values({
    id: auditId,
    action: intent.action,
    entityType,
    entityId,
    actor: "user",
    detailsJson: JSON.stringify({ provider: intent.provider, confidence: intent.confidence }),
    createdAt: now,
  });
  return { entityId, entityType, jobId };
}

function parseJobInput(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return { prompt: value };
  }
}

export async function claimNextAgentJob() {
  const db = getDb();
  const staleBefore = new Date(Date.now() - 30 * 60_000);
  await db.update(agentJobs).set({
    status: "queued",
    startedAt: null,
    provider: null,
    error: "Recovered after worker timeout.",
  }).where(and(eq(agentJobs.status, "running"), lt(agentJobs.startedAt, staleBefore)));
  const candidates = await db.select().from(agentJobs)
    .where(eq(agentJobs.status, "queued"))
    .orderBy(desc(agentJobs.priority), asc(agentJobs.createdAt))
    .limit(20);
  let next: typeof agentJobs.$inferSelect | null = null;
  let run: typeof agentRuns.$inferSelect | null = null;
  let parentResult: string | null = null;
  for (const candidate of candidates) {
    const candidateRun = candidate.runId
      ? (await db.select().from(agentRuns).where(eq(agentRuns.id, candidate.runId)).limit(1))[0] ?? null
      : null;
    if (candidateRun && (candidateRun.status === "failed" || candidateRun.status === "needs_approval" || candidateRun.usedJobs >= candidateRun.budgetJobs || candidateRun.usedTokens >= candidateRun.budgetTokens)) continue;
    if (candidate.parentJobId) {
      const parent = (await db.select().from(agentJobs).where(eq(agentJobs.id, candidate.parentJobId)).limit(1))[0];
      if (!parent || parent.status !== "succeeded") continue;
      parentResult = parent.resultJson;
    }
    next = candidate;
    run = candidateRun;
    break;
  }
  if (!next) return null;

  const startedAt = new Date();
  const claimMarker = `claim:${crypto.randomUUID()}`;
  await db.update(agentJobs).set({ status: "running", startedAt, provider: claimMarker })
    .where(and(eq(agentJobs.id, next.id), eq(agentJobs.status, "queued")));
  const claimed = await db.select().from(agentJobs)
    .where(and(
      eq(agentJobs.id, next.id),
      eq(agentJobs.status, "running"),
      eq(agentJobs.provider, claimMarker),
    ))
    .limit(1);
  if (!claimed[0]) return null;
  if (run) await db.update(agentRuns).set({ status: "running" }).where(eq(agentRuns.id, run.id));
  const remainingTokens = run ? Math.max(500, run.budgetTokens - run.usedTokens) : claimed[0].tokenBudget;
  return {
    id: claimed[0].id,
    runId: claimed[0].runId,
    agentRole: claimed[0].agentRole,
    kind: claimed[0].kind,
    tokenBudget: Math.min(claimed[0].tokenBudget, remainingTokens),
    input: {
      ...parseJobInput(claimed[0].inputJson),
      ...(parentResult ? { handoff: parentResult.slice(0, 20_000) } : {}),
    },
    createdAt: claimed[0].createdAt.toISOString(),
  };
}

function tokenUsage(value: Record<string, unknown> | null | undefined) {
  if (!value) return 0;
  const direct = Number(value.total_tokens ?? value.totalTokens);
  if (Number.isFinite(direct)) return Math.max(0, Math.round(direct));
  const input = Number(value.input_tokens ?? value.prompt_tokens ?? 0);
  const output = Number(value.output_tokens ?? value.completion_tokens ?? 0);
  return Math.max(0, Math.round((Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0)));
}

function childFor(job: typeof agentJobs.$inferSelect, run: typeof agentRuns.$inferSelect) {
  if (run.trigger !== "sync") return null;
  if (job.kind === "triage") return {
    kind: "planning" as const,
    role: "planner" as const,
    instruction: "Turn the curator's verified changes into practical planning advice. Respect existing deterministic study blocks and call out uncertainty.",
  };
  if (job.kind === "planning") return {
    kind: "review" as const,
    role: "reviewer" as const,
    instruction: "Review the curator and planner handoff for unsupported claims, missed deadlines, overload, and concrete improvements.",
  };
  return null;
}

export async function finishAgentJob(id: string, payload: {
  status: "succeeded" | "failed" | "needs_approval";
  result?: string | null;
  error?: string | null;
  provider?: string | null;
  model?: string | null;
  usage?: Record<string, unknown> | null;
  durationMs?: number | null;
}) {
  const db = getDb();
  const job = (await db.select().from(agentJobs).where(and(eq(agentJobs.id, id), eq(agentJobs.status, "running"))).limit(1))[0];
  if (!job) return { id, status: "not_running" };
  const finishedAt = new Date();
  const usage = { ...(payload.usage ?? {}), durationMs: payload.durationMs ?? undefined };
  await db.update(agentJobs).set({
    status: payload.status,
    resultJson: payload.result?.slice(0, 100_000) ?? null,
    usageJson: JSON.stringify(usage).slice(0, 4_000),
    error: payload.error?.slice(0, 4_000) ?? null,
    provider: payload.provider?.slice(0, 80) ?? null,
    model: payload.model?.slice(0, 200) ?? null,
    finishedAt,
  }).where(and(eq(agentJobs.id, id), eq(agentJobs.status, "running")));

  if (job.runId) {
    const run = (await db.select().from(agentRuns).where(eq(agentRuns.id, job.runId)).limit(1))[0];
    if (run) {
      const usedTokens = tokenUsage(payload.usage);
      const nextUsedJobs = run.usedJobs + 1;
      const nextUsedTokens = run.usedTokens + usedTokens;
      await db.insert(agentMessages).values({
        id: crypto.randomUUID(),
        runId: run.id,
        jobId: job.id,
        sender: job.agentRole,
        recipient: "orchestrator",
        kind: payload.status === "succeeded" ? "result" : "observation",
        contentJson: JSON.stringify({
          summary: payload.result?.slice(0, 4_000) ?? payload.error?.slice(0, 1_000) ?? payload.status,
          provider: payload.provider,
          model: payload.model,
          usedTokens,
        }),
        createdAt: finishedAt,
      });

      const child = payload.status === "succeeded" ? childFor(job, run) : null;
      const canContinue = Boolean(child) && nextUsedJobs < run.budgetJobs && nextUsedTokens < run.budgetTokens;
      if (child && canContinue) {
        const childId = crypto.randomUUID();
        await db.insert(agentJobs).values({
          id: childId,
          runId: run.id,
          parentJobId: job.id,
          agentRole: child.role,
          kind: child.kind,
          status: "queued",
          priority: Math.max(1, job.priority - 5),
          tokenBudget: Math.min(2_000, run.budgetTokens - nextUsedTokens),
          inputJson: JSON.stringify({ ...parseJobInput(job.inputJson), instruction: child.instruction }).slice(0, 100_000),
          createdAt: finishedAt,
        });
        await db.insert(agentMessages).values({
          id: crypto.randomUUID(),
          runId: run.id,
          jobId: childId,
          sender: "orchestrator",
          recipient: child.role,
          kind: "handoff",
          contentJson: JSON.stringify({ instruction: child.instruction, parentJobId: job.id }),
          createdAt: finishedAt,
        });
        await db.update(agentRuns).set({
          status: "queued",
          usedJobs: nextUsedJobs,
          usedTokens: nextUsedTokens,
          summary: payload.result?.slice(0, 4_000) ?? null,
        }).where(eq(agentRuns.id, run.id));
      } else {
        await db.update(agentRuns).set({
          status: payload.status,
          usedJobs: nextUsedJobs,
          usedTokens: nextUsedTokens,
          summary: payload.result?.slice(0, 4_000) ?? payload.error?.slice(0, 4_000) ?? null,
          finishedAt,
        }).where(eq(agentRuns.id, run.id));
      }

      if (job.kind === "improvement" && payload.status === "succeeded" && payload.result) {
        const input = parseJobInput(job.inputJson);
        await db.insert(improvementProposals).values({
          id: crypto.randomUUID(),
          runId: run.id,
          title: String(input.title ?? "Agent improvement proposal").slice(0, 300),
          rationale: payload.result.slice(0, 8_000),
          evidenceJson: JSON.stringify(input.evidence ?? []),
          scopeJson: JSON.stringify(input.scope ?? []),
          status: "proposed",
          createdAt: finishedAt,
          updatedAt: finishedAt,
        });
      }

      if (job.kind === "code_change" && typeof parseJobInput(job.inputJson).proposalId === "string") {
        const proposalId = String(parseJobInput(job.inputJson).proposalId);
        await db.update(improvementProposals).set({
          status: payload.status === "succeeded" ? "branch_ready" : payload.status === "needs_approval" ? "approved" : "failed",
          implementationSummary: payload.result?.slice(0, 8_000) ?? null,
          error: payload.error?.slice(0, 4_000) ?? null,
          updatedAt: finishedAt,
        }).where(eq(improvementProposals.id, proposalId));
      }
    }
  }
  return { id, status: payload.status };
}

function sourceStatusFromHealth(state: string) {
  if (state === "ready") return "healthy" as const;
  if (state === "failed" || state === "error") return "error" as const;
  return "attention" as const;
}

function safeStorageKey(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "").slice(0, 500);
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return normalized;
}

async function refreshAdaptiveStudyPlan() {
  const db = getDb();
  const rows = await db.select({
    item: academicItems,
    subjectName: subjects.name,
  }).from(academicItems).leftJoin(subjects, eq(academicItems.subjectId, subjects.id));
  const planned = buildAdaptiveStudyBlocks(rows.map(({ item, subjectName }) => ({
    id: item.id,
    title: item.title,
    subject: subjectName ?? "General",
    type: item.type,
    dueAt: iso(item.dueAt),
    status: item.status,
  })));
  const preserved = await db.select({ fingerprint: studyBlocks.sourceFingerprint }).from(studyBlocks)
    .where(sql`${studyBlocks.status} <> 'suggested'`);
  const preservedFingerprints = new Set(preserved.map((row) => row.fingerprint));
  await db.delete(studyBlocks).where(and(eq(studyBlocks.status, "suggested"), eq(studyBlocks.generatedBy, "deterministic")));
  const now = new Date();
  for (const block of planned.filter((candidate) => !preservedFingerprints.has(candidate.sourceFingerprint)).slice(0, 200)) {
    const sourceItem = rows.find(({ item }) => item.id === block.academicItemId);
    await db.insert(studyBlocks).values({
      id: `study:${(await sha256(block.key)).slice(0, 40)}`,
      academicItemId: block.academicItemId,
      subjectId: sourceItem?.item.subjectId ?? null,
      title: block.title.slice(0, 500),
      scheduledFor: block.scheduledFor,
      durationMinutes: block.durationMinutes,
      reason: block.reason.slice(0, 1_000),
      status: "suggested",
      generatedBy: "deterministic",
      sourceFingerprint: block.sourceFingerprint,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
  }
  return planned.length;
}

async function maybeQueueConnectorImprovement(definition: (typeof sourceDefinitions)[number]) {
  const db = getDb();
  const recent = await db.select().from(syncRuns)
    .where(eq(syncRuns.sourceId, definition.id))
    .orderBy(desc(syncRuns.startedAt))
    .limit(3);
  if (recent.length < 3 || recent.some((run) => run.warningCount === 0)) return null;
  const existing = await db.select({ id: agentRuns.id }).from(agentRuns)
    .where(and(eq(agentRuns.sourceId, definition.id), eq(agentRuns.trigger, "improvement")))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1);
  if (existing[0]) return null;
  return queueAgentRun({
    trigger: "improvement",
    objective: `Propose a bounded reliability improvement for ${definition.name}.`,
    kind: "improvement",
    role: "improver",
    priority: 20,
    sourceId: definition.id,
    budgetJobs: 1,
    budgetTokens: 1800,
    input: {
      title: `Improve ${definition.name} extraction reliability`,
      evidence: recent.map((run) => run.errorSummary).filter(Boolean),
      scope: [`apps/worker/src/sources/${definition.kind === "academy_moodle" || definition.kind === "edu_moodle" ? "moodle" : definition.kind}.mjs`],
      instruction: "Draft a narrow implementation proposal from these repeated redacted warnings. Do not edit code, use credentials, or claim the issue is fixed.",
    },
  });
}

export async function ingestWorkerSync(payload: WorkerSyncPayload) {
  const db = getDb();
  const definition = workerSourceMap[payload.source];
  const now = new Date();
  const attemptedAt = safeDate(payload.health.checkedAt, now);
  const status = sourceStatusFromHealth(payload.health.state);
  const startedAt = safeDate(payload.startedAt, now);
  const finishedAt = safeDate(payload.finishedAt, now);
  const warnings = (payload.warnings ?? []).filter((warning): warning is string => typeof warning === "string").slice(0, 100);
  const syncRunId = crypto.randomUUID();

  const updateValues = {
    status,
    lastAttemptAt: attemptedAt,
    lastError: status === "healthy" ? null : payload.health.state,
    ...(status === "healthy" ? { lastSuccessAt: attemptedAt } : {}),
  };

  await db.insert(sources).values({
    id: definition.id,
    kind: definition.kind,
    displayName: definition.name,
    baseUrl: definition.baseUrl,
    status,
    lastAttemptAt: attemptedAt,
    lastSuccessAt: status === "healthy" ? attemptedAt : null,
    lastError: status === "healthy" ? null : payload.health.state,
  }).onConflictDoUpdate({
    target: sources.id,
    set: updateValues,
  });

  await db.insert(syncRuns).values({
    id: syncRunId,
    sourceId: definition.id,
    status: status === "healthy" ? (warnings.length ? "partial" : "succeeded") : status === "error" ? "failed" : "partial",
    discoveredCount: Math.max(0, Math.min(10_000, payload.discoveryCount ?? payload.items.length)),
    changedCount: 0,
    warningCount: warnings.length,
    startedAt,
    finishedAt,
    errorSummary: status === "healthy"
      ? (warnings.length ? JSON.stringify({ extractor: payload.extractorState, warnings }).slice(0, 4_000) : null)
      : JSON.stringify({ state: payload.health.state, extractor: payload.extractorState, warnings }).slice(0, 4_000),
  });

  let changedCount = 0;
  const changedItems: Array<Record<string, unknown>> = [];
  for (const item of payload.items.slice(0, 500)) {
    if (!item.sourceExternalId || !item.title) continue;
    const subjectId = item.subject ? await ensureSubject(item.subject) : null;
    const firstSeenAt = startedAt;
    const rawJson = JSON.stringify(item.raw ?? null).slice(0, 30_000);
    const sourceSnapshotHash = await sha256(JSON.stringify({
      type: item.type,
      title: item.title,
      description: item.description ?? null,
      subject: item.subject ?? null,
      startsAt: item.startsAt ?? null,
      dueAt: item.dueAt ?? null,
      status: item.status ?? "inbox",
      sourceUrl: safeSourceUrl(item.sourceUrl, definition),
      rawJson,
    }));
    const existing = (await db.select().from(academicItems).where(and(
      eq(academicItems.sourceId, definition.id),
      eq(academicItems.sourceExternalId, item.sourceExternalId.slice(0, 300)),
    )).limit(1))[0];
    const changed = !existing || existing.sourceSnapshotHash !== sourceSnapshotHash;
    const incomingStatus = item.status ?? "inbox";
    const resolvedStatus = incomingStatus === "done" || !existing || !["done", "cancelled"].includes(existing.status)
      ? incomingStatus
      : existing.status;
    const values = {
      id: crypto.randomUUID(),
      sourceId: definition.id,
      sourceExternalId: item.sourceExternalId.slice(0, 300),
      subjectId,
      type: item.type,
      title: item.title.slice(0, 500),
      description: item.description?.slice(0, 4_000) ?? null,
      startsAt: item.startsAt ? safeDate(item.startsAt) : null,
      dueAt: item.dueAt ? safeDate(item.dueAt) : null,
      status: resolvedStatus,
      evidence: item.evidence,
      confidence: Math.max(0, Math.min(100, Math.round(item.confidence))),
      sourceUrl: safeSourceUrl(item.sourceUrl, definition),
      sourceSnapshotHash,
      rawJson,
      firstSeenAt,
      lastSeenAt: now,
      updatedAt: changed ? now : existing?.updatedAt ?? now,
    };
    await db.insert(academicItems).values(values).onConflictDoUpdate({
      target: [academicItems.sourceId, academicItems.sourceExternalId],
      set: {
        subjectId: values.subjectId,
        type: values.type,
        title: values.title,
        description: values.description,
        startsAt: values.startsAt,
        dueAt: values.dueAt,
        status: values.status,
        evidence: values.evidence,
        confidence: values.confidence,
        sourceUrl: values.sourceUrl,
        sourceSnapshotHash: values.sourceSnapshotHash,
        rawJson: values.rawJson,
        lastSeenAt: now,
        updatedAt: values.updatedAt,
      },
    });
    if (changed) {
      changedCount += 1;
      changedItems.push({
        sourceExternalId: item.sourceExternalId,
        title: item.title.slice(0, 300),
        subject: item.subject ?? "General",
        type: item.type,
        dueAt: item.dueAt ?? null,
        dueLabel: safeJson(rawJson)?.dueLabel ?? null,
        status: resolvedStatus,
      });
    }
  }

  let documentCount = 0;
  for (const document of (payload.documents ?? []).slice(0, 200)) {
    const storageKey = typeof document.storageKey === "string" ? safeStorageKey(document.storageKey) : null;
    if (!storageKey || !/^[a-f0-9]{64}$/i.test(document.checksum ?? "") || !document.name) continue;
    const linked = document.academicItemExternalId
      ? (await db.select({ item: academicItems, subjectName: subjects.name }).from(academicItems)
        .leftJoin(subjects, eq(academicItems.subjectId, subjects.id)).where(and(
        eq(academicItems.sourceId, definition.id),
        eq(academicItems.sourceExternalId, document.academicItemExternalId.slice(0, 300)),
      )).limit(1))[0]
      : null;
    const linkedItem = linked?.item ?? null;
    const sourcePath = document.sourcePath?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 1_000) || null;
    const classification = classifyKnowledgeFile({
      name: document.name,
      text: document.extractedText,
      sourcePath,
      subjectHint: document.subject ?? linked?.subjectName,
      academicItemTitle: linkedItem?.title ?? null,
      createdAt: now,
    });
    const classifiedSubjectId = classification.subject === "General"
      ? null
      : await ensureSubject(classification.subject);
    const documentSubjectId = classifiedSubjectId ?? linkedItem?.subjectId ?? null;
    const id = `document:${(await sha256(`${definition.id}\u0000${storageKey}`)).slice(0, 40)}`;
    await db.insert(documents).values({
      id,
      sourceId: definition.id,
      subjectId: documentSubjectId,
      academicItemId: linkedItem?.id ?? null,
      name: document.name.slice(0, 300),
      mimeType: document.mimeType?.slice(0, 120) ?? null,
      storageKey,
      checksum: document.checksum.toLowerCase(),
      sourceUrl: safeSourceUrl(document.sourceUrl, definition),
      extractedText: document.extractedText?.slice(0, 100_000) ?? null,
      sourcePath,
      academicPeriod: classification.academicPeriod,
      topicPathJson: JSON.stringify(classification.topicPath),
      classificationConfidence: classification.confidence,
      classificationReason: classification.reason,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [documents.sourceId, documents.storageKey],
      set: {
        subjectId: documentSubjectId,
        academicItemId: linkedItem?.id ?? null,
        name: document.name.slice(0, 300),
        mimeType: document.mimeType?.slice(0, 120) ?? null,
        checksum: document.checksum.toLowerCase(),
        sourceUrl: safeSourceUrl(document.sourceUrl, definition),
        extractedText: document.extractedText?.slice(0, 100_000) ?? null,
        sourcePath,
        academicPeriod: classification.academicPeriod,
        topicPathJson: JSON.stringify(classification.topicPath),
        classificationConfidence: classification.confidence,
        classificationReason: classification.reason,
        updatedAt: now,
      },
    });
    documentCount += 1;
  }

  const studyBlockCount = await refreshAdaptiveStudyPlan();
  await db.update(syncRuns).set({ changedCount }).where(eq(syncRuns.id, syncRunId));
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    action: "worker_sync",
    entityType: "source",
    entityId: definition.id,
    actor: "connector",
    detailsJson: JSON.stringify({
      syncRunId,
      status,
      discoveredCount: payload.discoveryCount ?? payload.items.length,
      changedCount,
      documentCount,
      warningCount: warnings.length,
      extractorState: payload.extractorState,
    }),
    createdAt: now,
  });

  let agentRunId: string | null = null;
  if (payload.agentAutoTriage !== false && status === "healthy" && changedItems.length) {
    const queued = await queueAgentRun({
      trigger: "sync",
      objective: `Review ${changedItems.length} verified change${changedItems.length === 1 ? "" : "s"} from ${definition.name}.`,
      kind: "triage",
      role: "curator",
      priority: 35,
      sourceId: definition.id,
      budgetJobs: 3,
      budgetTokens: 6000,
      input: {
        source: definition.name,
        changes: changedItems.slice(0, 40),
        instruction: "Check the verified changes for urgency, duplicates, missing context, and conflicts. Hand concise findings to the planner; do not invent facts.",
      },
    });
    agentRunId = queued.runId;
  }
  await maybeQueueConnectorImprovement(definition);

  return { changedCount, documentCount, studyBlockCount, agentRunId, source: payload.source, status, syncRunId };
}

export async function createSubjectChatJob(message: string, subject: string | null) {
  const db = getDb();
  const requestedSubject = subject ? canonicalSubjectName(subject) : null;
  const normalizedSubject = requestedSubject?.toLowerCase() || null;
  const [itemRows, documentRows, uploadRows, noteRows, subjectRows] = await Promise.all([
    db.select({
      item: academicItems,
      subjectName: subjects.name,
      sourceName: sources.displayName,
    }).from(academicItems)
      .leftJoin(subjects, eq(academicItems.subjectId, subjects.id))
      .innerJoin(sources, eq(academicItems.sourceId, sources.id))
      .orderBy(desc(academicItems.updatedAt))
      .limit(160),
    db.select({
      document: documents,
      subjectName: subjects.name,
      sourceName: sources.displayName,
    }).from(documents)
      .leftJoin(subjects, eq(documents.subjectId, subjects.id))
      .leftJoin(sources, eq(documents.sourceId, sources.id))
      .orderBy(desc(documents.updatedAt))
      .limit(100),
    db.select({
      upload: stagedUploads,
      subjectName: subjects.name,
      sourceName: sources.displayName,
    }).from(stagedUploads)
      .leftJoin(academicItems, eq(stagedUploads.academicItemId, academicItems.id))
      .leftJoin(subjects, eq(academicItems.subjectId, subjects.id))
      .leftJoin(sources, eq(academicItems.sourceId, sources.id))
      .where(eq(stagedUploads.status, "indexed"))
      .orderBy(desc(stagedUploads.updatedAt))
      .limit(100),
    db.select().from(knowledgeNotes).orderBy(desc(knowledgeNotes.updatedAt)).limit(80),
    db.select().from(subjects),
  ]);
  const resolvedSubjectId = requestedSubject && requestedSubject !== "General"
    ? await ensureSubject(requestedSubject)
    : null;
  const matches = (value: string | null | undefined) => !normalizedSubject || canonicalSubjectName(value).toLowerCase() === normalizedSubject;
  const documentSubject = (row: (typeof documentRows)[number]) => {
    const stored = canonicalSubjectName(row.subjectName);
    if (stored !== "General" || row.document.classificationReason) return stored;
    return classifyKnowledgeFile({
      name: row.document.name,
      text: row.document.extractedText,
      sourcePath: row.document.sourcePath,
      createdAt: row.document.createdAt,
    }).subject;
  };
  const uploadSubject = (row: (typeof uploadRows)[number]) => (
    subjectRows.find((candidate) => candidate.id === row.upload.subjectId)?.name ?? row.subjectName
  );
  const rankedDocuments = rankDocumentEvidence(message, [
    ...documentRows.filter((row) => matches(documentSubject(row)) && row.document.extractedText).map((row) => ({
      id: row.document.id,
      kind: "document" as const,
      title: row.document.name,
      subject: documentSubject(row),
      source: row.sourceName ?? "Local worker",
      text: row.document.extractedText ?? "",
    })),
    ...uploadRows.filter((row) => matches(uploadSubject(row)) && row.upload.extractedText).map((row) => ({
      id: row.upload.id,
      kind: "upload" as const,
      title: row.upload.originalName,
      subject: canonicalSubjectName(uploadSubject(row)),
      source: row.sourceName ? `Private upload for ${row.sourceName}` : "Private upload",
      text: row.upload.extractedText ?? "",
    })),
  ], 12);
  let documentRef = 0;
  let uploadRef = 0;
  const citations = [
    ...itemRows.filter((row) => matches(row.subjectName)).slice(0, 24).map((row, index) => ({
      ref: `A${index + 1}`,
      kind: "academic_item",
      title: row.item.title,
      subject: canonicalSubjectName(row.subjectName),
      source: row.sourceName,
      type: row.item.type,
      dueAt: iso(row.item.dueAt),
      status: row.item.status,
      evidence: row.item.evidence,
      description: row.item.description?.slice(0, 800) ?? null,
    })),
    ...rankedDocuments.map((row) => ({
      ref: row.kind === "upload" ? `U${++uploadRef}` : `D${++documentRef}`,
      kind: row.kind,
      title: row.title,
      subject: row.subject,
      source: row.source,
      locator: row.locator,
      excerpt: row.excerpt,
    })),
    ...noteRows.filter((note) => matches(note.subject)).slice(0, 10).map((note, index) => ({
      ref: `N${index + 1}`,
      kind: "note",
      title: note.title,
      subject: canonicalSubjectName(note.subject),
      excerpt: note.body.slice(0, 1_000),
    })),
  ];
  const queued = await queueAgentRun({
    trigger: "chat",
    objective: `Answer a ${requestedSubject ?? "cross-subject"} question from verified Jarvis context.`,
    kind: "subject_chat",
    role: "tutor",
    priority: 70,
    subjectId: resolvedSubjectId,
    budgetJobs: 1,
    budgetTokens: 3000,
    input: {
      prompt: message.slice(0, 4_000),
      subject: requestedSubject?.slice(0, 200) ?? null,
      citations,
      instruction: "Answer from the supplied citation records. Cite factual claims as [A1], [D1], [U1], or [N1]. Document and upload excerpts include page or section locators. Say plainly when the indexed evidence is insufficient, and never imply access beyond this context.",
    },
  });
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    action: "subject_chat_queued",
    entityType: "agent_run",
    entityId: queued.runId,
    actor: "user",
    detailsJson: JSON.stringify({ subject: requestedSubject ?? null, citationCount: citations.length }),
    createdAt: new Date(),
  });
  return { ...queued, citationCount: citations.length };
}

export async function updateStudyBlockStatus(id: string, status: "suggested" | "accepted" | "done" | "skipped") {
  const db = getDb();
  const existing = (await db.select().from(studyBlocks).where(eq(studyBlocks.id, id)).limit(1))[0];
  if (!existing) return null;
  await db.update(studyBlocks).set({ status, updatedAt: new Date() }).where(eq(studyBlocks.id, id));
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    action: "study_block_status_changed",
    entityType: "study_block",
    entityId: id,
    actor: "user",
    detailsJson: JSON.stringify({ from: existing.status, to: status }),
    createdAt: new Date(),
  });
  return { id, status };
}

function branchSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "improvement";
}

export async function approveImprovementProposal(id: string) {
  const db = getDb();
  const proposal = (await db.select().from(improvementProposals).where(eq(improvementProposals.id, id)).limit(1))[0];
  if (!proposal || proposal.status !== "proposed") return null;
  const branchName = `agent/${new Date().toISOString().slice(0, 10)}-${branchSlug(proposal.title)}-${crypto.randomUUID().slice(0, 8)}`;
  await db.update(improvementProposals).set({
    status: "approved",
    branchName,
    updatedAt: new Date(),
  }).where(and(eq(improvementProposals.id, id), eq(improvementProposals.status, "proposed")));
  const claimed = (await db.select().from(improvementProposals).where(and(
    eq(improvementProposals.id, id),
    eq(improvementProposals.status, "approved"),
    eq(improvementProposals.branchName, branchName),
  )).limit(1))[0];
  if (!claimed) return null;

  let queued: Awaited<ReturnType<typeof queueAgentRun>>;
  try {
    queued = await queueAgentRun({
      trigger: "improvement",
      objective: `Prepare an isolated implementation branch for: ${proposal.title}`,
      kind: "code_change",
      role: "coder",
      priority: 15,
      budgetJobs: 1,
      budgetTokens: 4000,
      input: {
        proposalId: proposal.id,
        title: proposal.title,
        rationale: proposal.rationale,
        evidence: safeJson(proposal.evidenceJson) ?? [],
        scope: safeJson(proposal.scopeJson) ?? [],
        branchName,
        instruction: "Prepare the approved change only in the named separate git worktree. Perform static scope and diff validation, but never execute generated code. Never merge, push, deploy, or access IAM/browser secrets.",
      },
    });
  } catch (error) {
    await db.update(improvementProposals).set({
      status: "proposed",
      branchName: null,
      updatedAt: new Date(),
    }).where(and(
      eq(improvementProposals.id, id),
      eq(improvementProposals.status, "approved"),
      eq(improvementProposals.branchName, branchName),
    ));
    throw error;
  }
  await db.update(improvementProposals).set({ runId: queued.runId, updatedAt: new Date() })
    .where(and(eq(improvementProposals.id, id), eq(improvementProposals.branchName, branchName)));
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    action: "improvement_branch_approved",
    entityType: "improvement_proposal",
    entityId: id,
    actor: "user",
    detailsJson: JSON.stringify({ branchName, runId: queued.runId }),
    createdAt: new Date(),
  });
  return { id, branchName, ...queued };
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const binary = String.fromCharCode(...bytes);
  return `jrv_${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createWorkerToken(label: string) {
  const db = getDb();
  const token = randomToken();
  const now = new Date();
  await db.insert(workerTokens).values({
    id: crypto.randomUUID(),
    label: label.slice(0, 80),
    tokenHash: await tokenHash(token),
    createdAt: now,
  });
  return token;
}

export async function verifyWorkerToken(token: string) {
  if (!token.startsWith("jrv_") || token.length > 100) return false;
  const db = getDb();
  const hash = await tokenHash(token);
  const row = await db.select({ id: workerTokens.id }).from(workerTokens)
    .where(and(eq(workerTokens.tokenHash, hash), isNull(workerTokens.revokedAt)))
    .limit(1);
  if (!row[0]) return false;
  await db.update(workerTokens).set({ lastUsedAt: new Date() }).where(eq(workerTokens.id, row[0].id));
  return true;
}
