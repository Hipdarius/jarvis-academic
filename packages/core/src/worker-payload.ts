const sourceKinds = {
  webuntis: "webuntis",
  academy: "academy_moodle",
  edumoodle: "edu_moodle",
  teams: "teams",
} as const;

const itemTypes = new Set(["homework", "test", "presentation", "deadline", "lesson", "announcement", "personal"]);
const evidenceLevels = new Set(["teacher_confirmed", "source_derived", "ai_inferred", "manual"]);
const itemStatuses = new Set(["inbox", "planned", "in_progress", "done", "cancelled"]);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown, maximum: number) {
  return value === undefined || value === null || (typeof value === "string" && value.length <= maximum);
}

function timestamp(value: unknown) {
  if (value === undefined || value === null || value === "") return true;
  return typeof value === "string" && value.length <= 80 && Number.isFinite(Date.parse(value));
}

function validItem(value: unknown, expectedSource: string) {
  if (!record(value)) return false;
  return value.source === expectedSource
    && typeof value.sourceExternalId === "string" && value.sourceExternalId.length > 0 && value.sourceExternalId.length <= 300
    && typeof value.title === "string" && value.title.trim().length > 0 && value.title.length <= 500
    && typeof value.type === "string" && itemTypes.has(value.type)
    && typeof value.evidence === "string" && evidenceLevels.has(value.evidence)
    && typeof value.confidence === "number" && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 100
    && optionalString(value.description, 4_000)
    && optionalString(value.subject, 300)
    && optionalString(value.teacher, 300)
    && optionalString(value.room, 120)
    && optionalString(value.sourceUrl, 2_000)
    && timestamp(value.startsAt)
    && timestamp(value.dueAt)
    && (value.status === undefined || (typeof value.status === "string" && itemStatuses.has(value.status)));
}

function validDocument(value: unknown) {
  if (!record(value)) return false;
  return typeof value.sourceExternalId === "string" && value.sourceExternalId.length > 0 && value.sourceExternalId.length <= 300
    && typeof value.name === "string" && value.name.trim().length > 0 && value.name.length <= 300
    && typeof value.storageKey === "string" && value.storageKey.length > 0 && value.storageKey.length <= 500
    && typeof value.checksum === "string" && /^[a-f0-9]{64}$/i.test(value.checksum)
    && optionalString(value.academicItemExternalId, 300)
    && optionalString(value.subject, 300)
    && optionalString(value.mimeType, 120)
    && optionalString(value.sourceUrl, 2_000)
    && optionalString(value.extractedText, 100_000)
    && (value.size === undefined || (typeof value.size === "number" && Number.isInteger(value.size) && value.size >= 0 && value.size <= 100 * 1_024 * 1_024));
}

export function isWorkerSyncPayload(value: unknown) {
  if (!record(value) || typeof value.source !== "string" || !(value.source in sourceKinds)) return false;
  if (!record(value.health) || typeof value.health.state !== "string" || value.health.state.length > 80) return false;
  if (!timestamp(value.health.checkedAt) || !optionalString(value.health.pageTitle, 500)) return false;
  if (value.health.requiresUserAction !== undefined && typeof value.health.requiresUserAction !== "boolean") return false;
  if (!Array.isArray(value.items) || value.items.length > 500 || !value.items.every((item) => validItem(item, sourceKinds[value.source as keyof typeof sourceKinds]))) return false;
  if (value.documents !== undefined && (!Array.isArray(value.documents) || value.documents.length > 200 || !value.documents.every(validDocument))) return false;
  if (value.warnings !== undefined && (!Array.isArray(value.warnings) || value.warnings.length > 100 || !value.warnings.every((warning) => typeof warning === "string" && warning.length <= 1_000))) return false;
  return optionalString(value.extractorState, 100)
    && timestamp(value.startedAt)
    && timestamp(value.finishedAt)
    && (value.discoveryCount === undefined || (typeof value.discoveryCount === "number" && Number.isInteger(value.discoveryCount) && value.discoveryCount >= 0 && value.discoveryCount <= 10_000))
    && (value.agentAutoTriage === undefined || typeof value.agentAutoTriage === "boolean");
}
