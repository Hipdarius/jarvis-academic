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
  createdAt: string;
};

export type DashboardStagedUpload = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  status: "staged" | "ready_for_review" | "submitted" | "failed";
  matchConfidence: number | null;
  matchReason: string | null;
  createdAt: string;
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
  items: DashboardItem[];
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
