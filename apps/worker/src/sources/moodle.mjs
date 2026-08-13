import { collectVisibleItems, navigateToSource } from "../inspection.mjs";
import { normalizeMoodleRows } from "../normalization.mjs";

export async function syncMoodle(page, source) {
  const health = await navigateToSource(page, source);
  if (health.requiresUserAction) return { source: source.key, health, courses: [] };

  const courses = await collectVisibleItems(page, [
    ".coursebox",
    '[data-region="course-content"]',
    '[data-region="courseoverview"] a',
    'a[href*="/course/view.php"]',
    'a[href*="/mod/assign/"]',
  ]);

  return {
    source: source.key,
    syncedAt: new Date().toISOString(),
    health,
    courses,
    items: normalizeMoodleRows(source.key, courses),
    extractorState: "discovery",
  };
}
