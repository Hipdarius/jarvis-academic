import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  kind: text("kind", {
    enum: ["webuntis", "teams", "academy_moodle", "edu_moodle", "manual", "github"],
  }).notNull(),
  displayName: text("display_name").notNull(),
  baseUrl: text("base_url"),
  status: text("status", {
    enum: ["unconfigured", "healthy", "attention", "error"],
  }).notNull().default("unconfigured"),
  lastAttemptAt: integer("last_attempt_at", { mode: "timestamp_ms" }),
  lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
});

export const subjects = sqliteTable("subjects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  color: text("color"),
  teacherNamesJson: text("teacher_names_json").notNull().default("[]"),
});

export const academicItems = sqliteTable("academic_items", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id),
  sourceExternalId: text("source_external_id").notNull(),
  subjectId: text("subject_id").references(() => subjects.id),
  type: text("type", {
    enum: ["homework", "test", "presentation", "deadline", "lesson", "announcement", "personal"],
  }).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  startsAt: integer("starts_at", { mode: "timestamp_ms" }),
  dueAt: integer("due_at", { mode: "timestamp_ms" }),
  status: text("status", {
    enum: ["inbox", "planned", "in_progress", "done", "cancelled"],
  }).notNull().default("inbox"),
  evidence: text("evidence", {
    enum: ["teacher_confirmed", "source_derived", "ai_inferred", "manual"],
  }).notNull(),
  confidence: integer("confidence").notNull().default(100),
  sourceUrl: text("source_url"),
  sourceSnapshotHash: text("source_snapshot_hash"),
  rawJson: text("raw_json"),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("academic_items_source_external_unique").on(table.sourceId, table.sourceExternalId),
]);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").references(() => sources.id),
  subjectId: text("subject_id").references(() => subjects.id),
  academicItemId: text("academic_item_id").references(() => academicItems.id),
  name: text("name").notNull(),
  mimeType: text("mime_type"),
  storageKey: text("storage_key").notNull(),
  checksum: text("checksum").notNull(),
  sourceUrl: text("source_url"),
  extractedText: text("extracted_text"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("documents_source_external_unique").on(table.sourceId, table.storageKey),
]);

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id),
  status: text("status", { enum: ["running", "succeeded", "partial", "failed"] }).notNull(),
  discoveredCount: integer("discovered_count").notNull().default(0),
  changedCount: integer("changed_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  errorSummary: text("error_summary"),
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  actor: text("actor", { enum: ["user", "connector", "planner", "agent"] }).notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const projectCanvases = sqliteTable("project_canvases", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  brief: text("brief").notNull(),
  subject: text("subject").notNull(),
  status: text("status", { enum: ["idea", "researching", "active", "archived"] }).notNull().default("idea"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const knowledgeNotes = sqliteTable("knowledge_notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  subject: text("subject").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const workerTokens = sqliteTable("worker_tokens", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  trigger: text("trigger", { enum: ["sync", "chat", "user", "improvement"] }).notNull(),
  sourceId: text("source_id").references(() => sources.id),
  subjectId: text("subject_id").references(() => subjects.id),
  status: text("status", { enum: ["queued", "running", "succeeded", "failed", "needs_approval"] }).notNull().default("queued"),
  objective: text("objective").notNull(),
  budgetJobs: integer("budget_jobs").notNull().default(3),
  budgetTokens: integer("budget_tokens").notNull().default(6000),
  usedJobs: integer("used_jobs").notNull().default(0),
  usedTokens: integer("used_tokens").notNull().default(0),
  summary: text("summary"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

export const agentJobs = sqliteTable("agent_jobs", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => agentRuns.id),
  parentJobId: text("parent_job_id"),
  agentRole: text("agent_role", { enum: ["curator", "planner", "tutor", "reviewer", "improver", "coder"] }).notNull().default("planner"),
  kind: text("kind", { enum: ["triage", "study_pack", "project_research", "review", "planning", "subject_chat", "improvement", "code_change"] }).notNull(),
  status: text("status", { enum: ["queued", "running", "succeeded", "failed", "needs_approval"] }).notNull().default("queued"),
  priority: integer("priority").notNull().default(50),
  tokenBudget: integer("token_budget").notNull().default(2400),
  inputJson: text("input_json").notNull(),
  resultJson: text("result_json"),
  usageJson: text("usage_json"),
  provider: text("provider"),
  model: text("model"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

export const agentMessages = sqliteTable("agent_messages", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => agentRuns.id),
  jobId: text("job_id").references(() => agentJobs.id),
  sender: text("sender").notNull(),
  recipient: text("recipient").notNull(),
  kind: text("kind", { enum: ["task", "handoff", "observation", "result", "decision"] }).notNull(),
  contentJson: text("content_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const studyBlocks = sqliteTable("study_blocks", {
  id: text("id").primaryKey(),
  academicItemId: text("academic_item_id").references(() => academicItems.id),
  subjectId: text("subject_id").references(() => subjects.id),
  title: text("title").notNull(),
  scheduledFor: text("scheduled_for").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["suggested", "accepted", "done", "skipped"] }).notNull().default("suggested"),
  generatedBy: text("generated_by", { enum: ["deterministic", "agent", "manual"] }).notNull(),
  sourceFingerprint: text("source_fingerprint").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const improvementProposals = sqliteTable("improvement_proposals", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => agentRuns.id),
  title: text("title").notNull(),
  rationale: text("rationale").notNull(),
  evidenceJson: text("evidence_json").notNull().default("[]"),
  scopeJson: text("scope_json").notNull().default("[]"),
  status: text("status", { enum: ["proposed", "approved", "branch_ready", "testing", "ready", "rejected", "failed"] }).notNull().default("proposed"),
  branchName: text("branch_name"),
  implementationSummary: text("implementation_summary"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
