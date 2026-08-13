import { collectVisibleItems, navigateToSource } from "../inspection.mjs";
import { normalizeTeamsRows } from "../normalization.mjs";

export async function syncTeams(page, source) {
  const health = await navigateToSource(page, source);
  if (health.requiresUserAction) return { source: source.key, health, visibleWorkspaceItems: [] };

  const visibleWorkspaceItems = await collectVisibleItems(page, [
    '[role="treeitem"]',
    '[data-tid*="team" i]',
    '[data-tid*="channel" i]',
    '[data-tid*="assignment" i]',
    'a[href*="assignments"]',
  ]);

  return {
    source: source.key,
    syncedAt: new Date().toISOString(),
    health,
    visibleWorkspaceItems,
    items: normalizeTeamsRows(visibleWorkspaceItems),
    extractorState: "discovery",
  };
}
