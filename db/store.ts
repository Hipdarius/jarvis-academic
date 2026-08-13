import { and, asc, desc, eq, isNull, lt } from "drizzle-orm";

import type { CommandIntent } from "@/packages/core/src/command-router";
import type { DashboardState, ProviderStatus } from "@/packages/core/src/dashboard";
import type { NormalizedAcademicItem, SourceKind } from "@/packages/core/src/model";
import { getDb } from "./index";
import {
  academicItems,
  agentJobs,
  auditEvents,
  knowledgeNotes,
  projectCanvases,
  sources,
  subjects,
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
  startedAt?: string;
  finishedAt?: string;
  discoveryCount?: number;
};

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

function subjectIdFor(name: string) {
  const normalized = name.trim().toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "general";
  return { id: `subject:${slug}`, normalized };
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
    name: name.trim(),
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
  const [itemRows, sourceRows, projectRows, noteRows, jobRows] = await Promise.all([
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
  ]);

  const storedSources = new Map(sourceRows.map((source) => [source.id, source]));
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
    items: itemRows.map(({ item, subjectName, sourceName, sourceKind }) => {
      const raw = safeJson(item.rawJson);
      return {
        id: item.id,
        type: item.type,
        title: item.title,
        description: item.description,
        subject: subjectName ?? "General",
        source: sourceName,
        sourceKind,
        startsAt: iso(item.startsAt),
        dueAt: iso(item.dueAt),
        dueLabel: typeof raw?.dueLabel === "string" ? raw.dueLabel : null,
        status: item.status,
        evidence: item.evidence,
        confidence: item.confidence,
      };
    }),
    sources: dashboardSources,
    projects: projectRows.map((project) => ({
      id: project.id,
      title: project.title,
      brief: project.brief,
      subject: project.subject,
      status: project.status,
      createdAt: project.createdAt.toISOString(),
    })),
    notes: noteRows.map((note) => ({
      id: note.id,
      title: note.title,
      body: note.body,
      subject: note.subject,
      createdAt: note.createdAt.toISOString(),
    })),
    agentJobs: jobRows.map((job) => ({
      id: job.id,
      kind: job.kind,
      status: job.status,
      provider: job.provider?.startsWith("claim:") ? null : job.provider,
      model: job.model,
      result: job.resultJson,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
    })),
    providers: configuredProviders(),
  };
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
    jobId = crypto.randomUUID();
    await db.insert(agentJobs).values({
      id: jobId,
      kind: "project_research",
      status: "queued",
      priority: 45,
      inputJson: JSON.stringify({
        prompt: originalText,
        title: intent.canvasTitle ?? intent.title,
        subject: intent.subject,
        instruction: "Research the concept, identify key questions, credible starting points, risks, and three concrete next actions. State uncertainty.",
      }),
      createdAt: now,
    });
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
    jobId = crypto.randomUUID();
    await db.insert(agentJobs).values({
      id: jobId,
      kind: "planning",
      status: "queued",
      priority: 60,
      inputJson: JSON.stringify({
        prompt: originalText,
        title: intent.title,
        subject: intent.subject,
        instruction: "Answer the student's question using only available context. Explain missing evidence and propose the safest useful next step.",
      }),
      createdAt: now,
    });
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
  const next = await db.select().from(agentJobs)
    .where(eq(agentJobs.status, "queued"))
    .orderBy(desc(agentJobs.priority), asc(agentJobs.createdAt))
    .limit(1);
  if (!next[0]) return null;

  const startedAt = new Date();
  const claimMarker = `claim:${crypto.randomUUID()}`;
  await db.update(agentJobs).set({ status: "running", startedAt, provider: claimMarker })
    .where(and(eq(agentJobs.id, next[0].id), eq(agentJobs.status, "queued")));
  const claimed = await db.select().from(agentJobs)
    .where(and(
      eq(agentJobs.id, next[0].id),
      eq(agentJobs.status, "running"),
      eq(agentJobs.provider, claimMarker),
    ))
    .limit(1);
  if (!claimed[0]) return null;
  return {
    id: claimed[0].id,
    kind: claimed[0].kind,
    input: parseJobInput(claimed[0].inputJson),
    createdAt: claimed[0].createdAt.toISOString(),
  };
}

export async function finishAgentJob(id: string, payload: {
  status: "succeeded" | "failed" | "needs_approval";
  result?: string | null;
  error?: string | null;
  provider?: string | null;
  model?: string | null;
}) {
  const db = getDb();
  await db.update(agentJobs).set({
    status: payload.status,
    resultJson: payload.result?.slice(0, 100_000) ?? null,
    error: payload.error?.slice(0, 4_000) ?? null,
    provider: payload.provider?.slice(0, 80) ?? null,
    model: payload.model?.slice(0, 200) ?? null,
    finishedAt: new Date(),
  }).where(and(eq(agentJobs.id, id), eq(agentJobs.status, "running")));
  return { id, status: payload.status };
}

function sourceStatusFromHealth(state: string) {
  if (state === "ready") return "healthy" as const;
  if (state === "failed" || state === "error") return "error" as const;
  return "attention" as const;
}

export async function ingestWorkerSync(payload: WorkerSyncPayload) {
  const db = getDb();
  const definition = workerSourceMap[payload.source];
  const now = new Date();
  const attemptedAt = safeDate(payload.health.checkedAt, now);
  const status = sourceStatusFromHealth(payload.health.state);

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

  let changedCount = 0;
  for (const item of payload.items.slice(0, 500)) {
    if (!item.sourceExternalId || !item.title) continue;
    const subjectId = item.subject ? await ensureSubject(item.subject) : null;
    const firstSeenAt = safeDate(payload.startedAt, now);
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
      status: "inbox" as const,
      evidence: item.evidence,
      confidence: Math.max(0, Math.min(100, Math.round(item.confidence))),
      sourceUrl: item.sourceUrl?.slice(0, 1_000) ?? null,
      rawJson: JSON.stringify(item.raw ?? null).slice(0, 30_000),
      firstSeenAt,
      lastSeenAt: now,
      updatedAt: now,
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
        evidence: values.evidence,
        confidence: values.confidence,
        sourceUrl: values.sourceUrl,
        rawJson: values.rawJson,
        lastSeenAt: now,
        updatedAt: now,
      },
    });
    changedCount += 1;
  }

  return { changedCount, source: payload.source, status };
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
