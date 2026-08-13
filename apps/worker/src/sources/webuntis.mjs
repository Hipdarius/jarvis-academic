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

async function waitForNavigationOverlay(page) {
  await page.waitForFunction(() => {
    const overlays = document.querySelectorAll(".overlay, [class*='overlay' i], [class*='backdrop' i]");
    return Array.from(overlays).every((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display === "none"
        || style.visibility === "hidden"
        || style.pointerEvents === "none"
        || rect.width === 0
        || rect.height === 0;
    });
  }, undefined, { timeout: 12_000 }).catch(() => undefined);
}

async function activateNavigationItem(page, locator) {
  await waitForNavigationOverlay(page);
  try {
    await locator.click({ timeout: 8_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/intercepts pointer events|not stable/i.test(message)) throw error;
    await locator.evaluate((element) => {
      const target = element.closest("a, button") ?? element;
      target.click();
    });
  }
}

async function readSection(page, label) {
  const link = await firstVisibleExactText(page, label);
  if (!link) return { label, state: "navigation_not_found", items: [] };

  await activateNavigationItem(page, link);
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
