import type { DashboardItem, DashboardStudyBlock, DashboardTopAction } from "./dashboard";

const actionableTypes = new Set(["homework", "test", "presentation", "deadline", "personal"]);

function itemScore(item: DashboardItem, now: Date) {
  const due = item.dueAt ? new Date(item.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const hours = (due - now.getTime()) / 3_600_000;
  const urgency = hours < 0 ? 1_200 : hours <= 24 ? 1_050 : hours <= 72 ? 850 : hours <= 168 ? 650 : item.dueAt ? 400 : 120;
  const evidence = item.evidence === "teacher_confirmed" ? 90 : item.evidence === "manual" ? 75 : item.evidence === "source_derived" ? 55 : 0;
  return urgency + evidence + Math.min(50, Math.max(0, item.confidence / 2)) + (item.status === "in_progress" ? 60 : 0);
}

export function buildTopActions(
  items: DashboardItem[],
  studyBlocks: DashboardStudyBlock[],
  now = new Date(),
): DashboardTopAction[] {
  const todayParts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Luxembourg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => todayParts.find((entry) => entry.type === type)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const blockItemIds = new Set(studyBlocks.filter((block) => (
    block.scheduledFor <= today && block.status !== "done" && block.status !== "skipped"
  )).map((block) => block.academicItemId).filter(Boolean));
  const actions: DashboardTopAction[] = [
    ...studyBlocks.filter((block) => (
      block.scheduledFor <= today && block.status !== "done" && block.status !== "skipped"
    )).map((block) => ({
      id: `study:${block.id}`,
      kind: "study" as const,
      academicItemId: block.academicItemId,
      studyBlockId: block.id,
      title: block.title,
      subject: block.subject,
      dueAt: null,
      scheduledFor: block.scheduledFor,
      status: block.status,
      reason: block.reason,
      score: block.status === "accepted" ? 1_180 : 900,
    })),
    ...items.filter((item) => (
      actionableTypes.has(item.type)
      && !["done", "cancelled"].includes(item.status)
      && !item.dismissed
      && !blockItemIds.has(item.id)
    )).map((item) => ({
      id: `item:${item.id}`,
      kind: "item" as const,
      academicItemId: item.id,
      studyBlockId: null,
      title: item.title,
      subject: item.subject,
      dueAt: item.dueAt,
      scheduledFor: null,
      status: item.status,
      reason: item.dueAt ? `Due ${item.dueAt}` : "Actionable work without a confirmed deadline",
      score: itemScore(item, now),
    })),
  ];
  return actions.sort((first, second) => second.score - first.score || first.title.localeCompare(second.title)).slice(0, 3);
}
