export type StudyPlanningItem = {
  id: string;
  title: string;
  subject: string;
  type: "homework" | "test" | "presentation" | "deadline" | "lesson" | "announcement" | "personal";
  dueAt: string | null;
  status: "inbox" | "planned" | "in_progress" | "done" | "cancelled";
};

export type PlannedStudyBlock = {
  key: string;
  academicItemId: string;
  subject: string;
  title: string;
  scheduledFor: string;
  durationMinutes: number;
  reason: string;
  sourceFingerprint: string;
};

function localDate(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function planShape(type: StudyPlanningItem["type"], daysRemaining: number) {
  if (type === "test") return { offsets: daysRemaining >= 7 ? [7, 3, 1] : [Math.min(3, daysRemaining), 1, 0], duration: 45 };
  if (type === "presentation") return { offsets: daysRemaining >= 5 ? [5, 2, 1] : [Math.min(2, daysRemaining), 0], duration: 40 };
  if (type === "homework" && daysRemaining >= 4) return { offsets: [3, 1], duration: 30 };
  return { offsets: [Math.min(1, daysRemaining)], duration: 30 };
}

export function buildAdaptiveStudyBlocks(items: StudyPlanningItem[], {
  now = new Date(),
  timeZone = "Europe/Luxembourg",
  horizonDays = 30,
  maxDailyMinutes = 120,
} = {}): PlannedStudyBlock[] {
  const dayLoad = new Map<string, number>();
  const blocks: PlannedStudyBlock[] = [];
  const eligible = items.flatMap((item) => {
    if (!item.dueAt || ["done", "cancelled"].includes(item.status) || ["announcement", "lesson"].includes(item.type)) return [];
    const due = new Date(item.dueAt);
    const milliseconds = due.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(milliseconds / 86_400_000));
    if (!Number.isFinite(due.getTime()) || milliseconds < -86_400_000 || daysRemaining > horizonDays) return [];
    return [{ item, due, daysRemaining }];
  }).sort((first, second) => first.due.getTime() - second.due.getTime());

  for (const { item, due, daysRemaining } of eligible) {
    const shape = planShape(item.type, daysRemaining);
    const offsets = [...new Set(shape.offsets.map((offset) => Math.max(0, Math.min(daysRemaining, offset))))];
    for (const offset of offsets) {
      let scheduled = new Date(due.getTime() - offset * 86_400_000);
      if (scheduled < now) scheduled = now;
      let date = localDate(scheduled, timeZone);
      for (let shift = 0; shift < 7 && (dayLoad.get(date) ?? 0) + shape.duration > maxDailyMinutes; shift += 1) {
        scheduled = new Date(scheduled.getTime() - 86_400_000);
        if (scheduled < now) break;
        date = localDate(scheduled, timeZone);
      }
      if ((dayLoad.get(date) ?? 0) + shape.duration > maxDailyMinutes) continue;
      dayLoad.set(date, (dayLoad.get(date) ?? 0) + shape.duration);
      const phase = offset === 0 ? "Final pass" : offset === 1 ? "Review" : "Prepare";
      const sourceFingerprint = `${item.id}:${item.dueAt}:${item.status}:${phase}`;
      blocks.push({
        key: `${item.id}:${date}:${phase.toLowerCase().replaceAll(" ", "-")}`,
        academicItemId: item.id,
        subject: item.subject,
        title: `${phase}: ${item.title}`,
        scheduledFor: date,
        durationMinutes: shape.duration,
        reason: `${item.type === "test" ? "Assessment" : "Work"} due in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}; ${phase.toLowerCase()} before the deadline.`,
        sourceFingerprint,
      });
    }
  }
  return blocks.sort((first, second) => first.scheduledFor.localeCompare(second.scheduledFor));
}
