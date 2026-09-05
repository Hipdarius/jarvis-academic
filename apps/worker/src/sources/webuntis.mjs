import path from "node:path";

import { workerConfig } from "../config.mjs";
import { navigateToSource, redactText, redactUrl } from "../inspection.mjs";
import { ensurePrivateDirectory, safeTimestamp } from "../io.mjs";
import { normalizeWebUntisSections } from "../normalization.mjs";

const navigationAliases = {
  "Mein Stundenplan": /^(?:(?:mein\s+)?stundenplan|my timetable|timetable)$/i,
  Hausaufgaben: /^(?:hausaufgaben|homework)$/i,
  "Prüfungen": /^(?:prüfungen|pruefungen|exams?|tests?)$/i,
  Mitteilungen: /^(?:mitteilungen|messages?|announcements?|news)$/i,
  Kurse: /^(?:kurse|courses?)$/i,
};

export function webUntisNavigationPattern(label) {
  return navigationAliases[label] ?? new RegExp(`^${String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

async function firstVisibleNavigation(page, label) {
  const pattern = webUntisNavigationPattern(label);
  const matches = page.getByRole("link", { name: pattern })
    .or(page.getByRole("button", { name: pattern }))
    .or(page.getByText(pattern));
  const count = await matches.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = matches.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function collectSectionItems(page) {
  const raw = await page.locator([
    "table tbody tr",
    '[role="row"]',
    '[class*="lesson" i]',
    '[class*="homework" i]',
    '[class*="exam" i]',
    '[class*="event" i]',
    "article",
  ].join(",")).evaluateAll((elements) => elements.map((element) => {
    const style = window.getComputedStyle(element);
    const anchor = element.querySelector("a[href]");
    const field = (name) => element.querySelector([
      `[data-testid*="${name}" i]`,
      `[data-test*="${name}" i]`,
      `[class*="${name}" i]`,
      `[aria-label*="${name}" i]`,
    ].join(","))?.textContent || "";
    return {
      visible: style.visibility !== "hidden" && style.display !== "none",
      externalId: element.getAttribute("data-id") || element.getAttribute("data-testid") || element.id || "",
      text: element.textContent || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      title: element.getAttribute("title") || "",
      href: anchor instanceof HTMLAnchorElement ? anchor.href : "",
      cells: Array.from(element.querySelectorAll("th, td"), (cell) => cell.textContent || ""),
      subject: field("subject"),
      teacher: field("teacher"),
      room: field("room"),
      description: field("description") || field("info"),
    };
  }));
  const unique = new Map();
  for (const item of raw) {
    if (!item.visible) continue;
    const normalized = {
      ...item,
      text: redactText(item.text),
      ariaLabel: redactText(item.ariaLabel),
      title: redactText(item.title),
      href: redactUrl(item.href),
      cells: item.cells.map(redactText).filter(Boolean),
      subject: redactText(item.subject),
      teacher: redactText(item.teacher),
      room: redactText(item.room),
      description: redactText(item.description),
    };
    if (!normalized.text && !normalized.ariaLabel && !normalized.title) continue;
    const key = normalized.externalId || `${normalized.href}\u0000${normalized.text}`;
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()];
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

async function readSection(page, source, label) {
  await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(source.settleMs ?? 1_200);
  const link = await firstVisibleNavigation(page, label);
  if (!link) return { label, state: "navigation_not_found", items: [] };

  await activateNavigationItem(page, link);
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(900);

  const items = await collectSectionItems(page);

  return { label, state: "read", url: redactUrl(page.url()), items };
}

export async function syncWebUntis(page, source) {
  const health = await navigateToSource(page, source);
  if (health.requiresUserAction) return { source: source.key, health, sections: [] };

  const sections = [];
  for (const label of source.navigation) {
    sections.push(await readSection(page, source, label));
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
    extractorState: sections.some((section) => section.state === "read") ? "structured" : "structured_empty",
  };
}
