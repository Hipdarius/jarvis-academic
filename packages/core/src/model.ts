export const sourceKinds = [
  "webuntis",
  "teams",
  "academy_moodle",
  "edu_moodle",
  "manual",
  "github",
] as const;

export type SourceKind = (typeof sourceKinds)[number];

export type EvidenceLevel =
  | "teacher_confirmed"
  | "source_derived"
  | "ai_inferred"
  | "manual";

export type AcademicItemType =
  | "homework"
  | "test"
  | "presentation"
  | "deadline"
  | "lesson"
  | "announcement"
  | "personal";

export interface NormalizedAcademicItem {
  source: SourceKind;
  sourceExternalId: string;
  type: AcademicItemType;
  title: string;
  description?: string;
  subject?: string;
  teacher?: string;
  room?: string;
  startsAt?: string;
  dueAt?: string;
  sourceUrl?: string;
  evidence: EvidenceLevel;
  confidence: number;
  raw: unknown;
}

export interface ConnectorHealth {
  state: "unconfigured" | "healthy" | "attention" | "error";
  message: string;
  checkedAt: string;
  requiresUserAction: boolean;
}

export interface SchoolConnector {
  readonly kind: SourceKind;
  checkHealth(): Promise<ConnectorHealth>;
  sync(): Promise<NormalizedAcademicItem[]>;
}
