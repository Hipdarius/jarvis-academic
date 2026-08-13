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

export type DashboardState = {
  mode: "live" | "database_unavailable";
  generatedAt: string;
  items: DashboardItem[];
  sources: DashboardSource[];
  projects: DashboardProject[];
  notes: DashboardNote[];
  agentJobs: Array<{
    id: string;
    kind: string;
    status: string;
    provider: string | null;
    model: string | null;
    result: string | null;
    error: string | null;
    createdAt: string;
  }>;
  providers: ProviderStatus[];
};
