import type { AcademicItemType, EvidenceLevel, SourceKind } from "./model";

export type DashboardItem = {
  id: string;
  type: AcademicItemType;
  title: string;
  description: string | null;
  subject: string;
  source: string;
  sourceKind: SourceKind;
  startsAt: string | null;
  dueAt: string | null;
  dueLabel: string | null;
  status: "inbox" | "planned" | "in_progress" | "done" | "cancelled";
  evidence: EvidenceLevel;
  confidence: number;
  sourceUrl: string | null;
  userNote: string | null;
  dismissed: boolean;
};

export type DashboardTopAction = {
  id: string;
  kind: "item" | "study";
  academicItemId: string | null;
  studyBlockId: string | null;
  title: string;
  subject: string;
  dueAt: string | null;
  scheduledFor: string | null;
  status: string;
  reason: string;
  score: number;
};

export type DashboardWorkerStatus = {
  state: "unconfigured" | "starting" | "running" | "degraded" | "offline";
  version: string | null;
  heartbeatAt: string | null;
  cycleStartedAt: string | null;
  cycleFinishedAt: string | null;
  nextSyncAt: string | null;
  freshnessMinutes: number | null;
  successRate7d: number | null;
  cycles7d: number;
  lastError: string | null;
  providers: Array<{
    id: "openai" | "hermes" | "nous" | "openrouter" | "anthropic";
    configured: boolean;
    model: string | null;
    health: "healthy" | "unreachable" | "unknown" | "not_configured";
    detail: string | null;
  }>;
};

export type DashboardSyncRequest = {
  id: string;
  source: "all" | "webuntis" | "teams" | "academy" | "edumoodle";
  status: "queued" | "running" | "succeeded" | "failed";
  requestedAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

export type DashboardAlert = {
  id: string;
  kind: "assignment_due" | "deadline_changed" | "source_attention" | "worker_offline";
  severity: "info" | "warning" | "urgent";
  status: "active" | "acknowledged" | "resolved";
  title: string;
  body: string;
  sourceId: string | null;
  academicItemId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type DashboardSource = {
  id: string;
  kind: SourceKind;
  name: string;
  status: "unconfigured" | "healthy" | "attention" | "error";
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  detail: string;
};

export type DashboardProject = {
  id: string;
  title: string;
  brief: string;
  subject: string;
  status: "idea" | "researching" | "active" | "archived";
  createdAt: string;
};

export type DashboardNote = {
  id: string;
  title: string;
  body: string;
  subject: string;
  createdAt: string;
};

export type ProviderStatus = {
  id: "openai" | "hermes" | "nous" | "openrouter" | "anthropic";
  name: string;
  configured: boolean;
  role: string;
  health?: "healthy" | "unreachable" | "unknown" | "not_configured";
  detail?: string | null;
};

export type DashboardDocument = {
  id: string;
  name: string;
  mimeType: string | null;
  source: string;
  subject: string;
  academicItemId: string | null;
  sourceUrl: string | null;
  extracted: boolean;
  sourcePath: string | null;
  academicPeriod: string;
  topicPath: string[];
  classificationConfidence: number | null;
  classificationReason: string | null;
  createdAt: string;
};

export type DashboardSubject = {
  id: string;
  name: string;
  officialName: string | null;
  group: "Languages and mathematics" | "Specialization" | "General education" | "Observed";
  weeklyLessons: number | null;
  curriculum: boolean;
};

export type DashboardStagedUpload = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  status: "staged" | "processing" | "indexed" | "stored" | "failed" | "ready_for_review" | "submitted";
  matchConfidence: number | null;
  matchReason: string | null;
  extractor: string | null;
  pageCount: number | null;
  processingMessage: string | null;
  attemptCount: number;
  processingStartedAt: string | null;
  processingFinishedAt: string | null;
  createdAt: string;
  subject: string;
  academicPeriod: string;
  topicPath: string[];
  classificationConfidence: number | null;
  classificationReason: string | null;
  destination: {
    academicItemId: string;
    title: string;
    subject: string;
    source: string;
    sourceKind: SourceKind;
    dueAt: string | null;
    sourceUrl: string | null;
  } | null;
};

export type DashboardStudyBlock = {
  id: string;
  academicItemId: string | null;
  subject: string;
  title: string;
  scheduledFor: string;
  durationMinutes: number;
  reason: string;
  status: "suggested" | "accepted" | "done" | "skipped";
  generatedBy: "deterministic" | "agent" | "manual";
};

export type DashboardAgentRun = {
  id: string;
  trigger: string;
  status: string;
  objective: string;
  usedJobs: number;
  budgetJobs: number;
  usedTokens: number;
  budgetTokens: number;
  summary: string | null;
  createdAt: string;
  messages: Array<{
    id: string;
    sender: string;
    recipient: string;
    kind: string;
    content: string;
    createdAt: string;
  }>;
};

export type DashboardImprovementProposal = {
  id: string;
  title: string;
  rationale: string;
  status: string;
  branchName: string | null;
  implementationSummary: string | null;
  createdAt: string;
};

export type DashboardState = {
  mode: "live" | "database_unavailable";
  generatedAt: string;
  subjects: DashboardSubject[];
  items: DashboardItem[];
  topActions: DashboardTopAction[];
  worker: DashboardWorkerStatus;
  syncRequests: DashboardSyncRequest[];
  alerts: DashboardAlert[];
  sources: DashboardSource[];
  projects: DashboardProject[];
  notes: DashboardNote[];
  documents: DashboardDocument[];
  stagedUploads: DashboardStagedUpload[];
  studyBlocks: DashboardStudyBlock[];
  agentRuns: DashboardAgentRun[];
  improvementProposals: DashboardImprovementProposal[];
  agentJobs: Array<{
    id: string;
    kind: string;
    status: string;
    provider: string | null;
    model: string | null;
    runId: string | null;
    agentRole: string;
    prompt: string | null;
    subject: string | null;
    result: string | null;
    error: string | null;
    createdAt: string;
  }>;
  providers: ProviderStatus[];
};
