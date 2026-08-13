import path from "node:path";

import { workerConfig } from "../config.mjs";
import { collectVisibleItems, navigateToSource, redactUrl } from "../inspection.mjs";
import { ensurePrivateDirectory, safeTimestamp } from "../io.mjs";
import { normalizeWebUntisSections } from "../normalization.mjs";

async function firstVisibleExactText(page, label) {
  const matches = page.getByText(label, { exact: true });
  const count = await matches.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = matches.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function readSection(page, label) {
  const link = await firstVisibleExactText(page, label);
  if (!link) return { label, state: "navigation_not_found", items: [] };

  await link.click({ timeout: 15_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(900);

  const items = await collectVisibleItems(page, [
    "table tbody tr",
    '[role="row"]',
    '[class*="lesson" i]',
    '[class*="homework" i]',
    '[class*="exam" i]',
    '[class*="event" i]',
    "article",
  ]);

  return { label, state: "read", url: redactUrl(page.url()), items };
}

export async function syncWebUntis(page, source) {
  const health = await navigateToSource(page, source);
  if (health.requiresUserAction) return { source: source.key, health, sections: [] };

  const sections = [];
  for (const label of source.navigation) {
    sections.push(await readSection(page, label));
  }

  let screenshot = null;
  if (workerConfig.captureScreenshots) {
    const directory = path.join(workerConfig.stateDirectory, "screenshots");
    await ensurePrivateDirectory(directory);
    screenshot = path.join(directory, `webuntis-${safeTimestamp()}.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
  }

  return {
    source: source.key,
    syncedAt: new Date().toISOString(),
    health,
    sections,
    items: normalizeWebUntisSections(sections),
    screenshot,
    extractorState: "discovery",
  };
}
