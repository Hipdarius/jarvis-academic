import type { DashboardItem } from "@/packages/core/src/dashboard";

export type PlannerFilter = "all" | "work" | "deadlines" | "announcements";

const closedStatuses = new Set(["done", "cancelled"]);

export function dashboardItemDate(item: DashboardItem) {
  const value = item.dueAt ?? item.startsAt;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function activeDashboardItems(items: DashboardItem[]) {
  return items
    .filter((item) => !closedStatuses.has(item.status))
    .sort((a, b) => {
      const first = dashboardItemDate(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const second = dashboardItemDate(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return first - second;
    });
}

export function scheduledDashboardItems(items: DashboardItem[]) {
  return activeDashboardItems(items).filter((item) => item.type !== "announcement" && Boolean(dashboardItemDate(item)));
}

export function inboxDashboardItems(items: DashboardItem[]) {
  return activeDashboardItems(items).filter((item) => item.type === "announcement" || !dashboardItemDate(item));
}

export function filterPlannerItems(items: DashboardItem[], filter: PlannerFilter, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return activeDashboardItems(items).filter((item) => {
    const hasDate = Boolean(dashboardItemDate(item));
    const matchesFilter = filter === "all"
      || (filter === "work" && item.type !== "announcement")
      || (filter === "deadlines" && item.type !== "announcement" && hasDate)
      || (filter === "announcements" && item.type === "announcement");
    if (!matchesFilter) return false;
    if (!normalizedQuery) return true;
    return [item.title, item.description, item.subject, item.source, item.type]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery));
  });
}

export function evidenceLabel(value: DashboardItem["evidence"]) {
  if (value === "teacher_confirmed") return "Teacher confirmed";
  if (value === "source_derived") return "Source derived";
  if (value === "ai_inferred") return "AI inferred";
  return "Manually captured";
}
