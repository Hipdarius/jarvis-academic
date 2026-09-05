import { createHash } from "node:crypto";

import { downloadSchoolDocument } from "../documents.mjs";
import { collectVisibleItems, navigateToSource, redactText, redactUrl } from "../inspection.mjs";
import { normalizeTeamsRows } from "../normalization.mjs";
import { syncTeamsContent } from "./teams-content.mjs";

function boundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, parsed)) : fallback;
}

const maxAssignments = boundedInteger(process.env.JARVIS_MAX_TEAMS_ASSIGNMENTS, 80, 200);
const maxAssignmentDetails = boundedInteger(process.env.JARVIS_MAX_TEAMS_ASSIGNMENT_DETAILS, 30, 80);
const maxFiles = boundedInteger(process.env.JARVIS_MAX_FILES_PER_SOURCE, 40, 100);
export const assignmentEntryNamePattern = /^assignments?(?:\s*\([^)]*\))?$/i;

function stableReference(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 32);
}

export function assignmentExternalId(href, text) {
  try {
    const parsed = new URL(href);
    const queryId = ["assignmentId", "assignment", "id"]
      .map((name) => parsed.searchParams.get(name))
      .find((value) => value && /^[a-zA-Z0-9_-]{5,200}$/.test(value));
    if (queryId) return `assignment:${queryId}`;
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const assignmentIndex = pathParts.findIndex((part) => /^assignments?$/i.test(part));
    const pathId = assignmentIndex >= 0 ? pathParts[assignmentIndex + 1] : null;
    if (pathId && /^[a-zA-Z0-9_-]{5,200}$/.test(pathId)) return `assignment:${pathId}`;
  } catch {
    // A hash still gives an opaque, stable source identifier.
  }
  return `assignment:${stableReference(`${href}\u0000${text}`)}`;
}

async function firstVisible(locator) {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function openAssignmentsSurface(page) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const exact = await firstVisible(page.getByRole("link", { name: assignmentEntryNamePattern }));
    const button = exact ?? await firstVisible(page.getByRole("button", { name: assignmentEntryNamePattern }));
    const dataControl = button ?? await firstVisible(page.locator([
      '[data-tid*="assignment-app" i]',
      '[data-tid*="assignments-nav" i]',
      '[aria-label^="Assignments" i]',
      '[title="Assignments" i]',
    ].join(",")));
    if (dataControl) {
      await dataControl.click({ timeout: 10_000 }).catch(async () => {
        await dataControl.evaluate((element) => element.click());
      });
      await page.waitForTimeout(3_000);
      return true;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

export function isAssignmentsSurfaceError(heading, visibleText) {
  const combined = `${heading ?? ""} ${visibleText ?? ""}`;
  return /\boops\b|we.ve run into an issue|there was a problem|something went wrong/i.test(combined);
}

async function assignmentsSurfaceErrored(page) {
  const heading = await page.getByRole("heading").first().innerText({ timeout: 2_000 }).catch(() => "");
  const visibleText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  return isAssignmentsSurfaceError(heading, visibleText);
}

async function collectAssignmentCards(page) {
  const raw = await page.locator([
    '[data-tid*="assignment-card" i]',
    '[data-tid*="assignment-row" i]',
    'a[href*="/assignments/"]',
    'a[href*="assignmentId=" i]',
  ].join(",")).evaluateAll((elements) => elements.map((element) => {
    const container = element.closest("article, li, [role='row'], [role='listitem']") ?? element;
    const anchor = element instanceof HTMLAnchorElement ? element : container.querySelector('a[href*="assignment" i]');
    const subjectElement = container.querySelector('[data-tid*="class" i], [data-tid*="course" i], [data-tid*="team-name" i]');
    const teacherElement = container.querySelector('[data-tid*="teacher" i], [data-tid*="author" i]');
    const files = Array.from(container.querySelectorAll("a[href]"))
      .filter((candidate) => /\.(?:docx?|pdf|pptx?|xlsx?|odt|ods|odp|txt|zip)(?:$|[?#])/i.test(candidate.getAttribute("href") || "") || candidate.hasAttribute("download"))
      .map((candidate) => ({
        href: candidate instanceof HTMLAnchorElement ? candidate.href : "",
        name: candidate.textContent || candidate.getAttribute("download") || candidate.getAttribute("title") || "",
      }));
    return {
      href: anchor instanceof HTMLAnchorElement ? anchor.href : "",
      text: container.textContent || "",
      title: anchor?.textContent || anchor?.getAttribute("title") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      subject: subjectElement?.textContent || "",
      teacher: teacherElement?.textContent || "",
      files,
    };
  }));

  const unique = new Map();
  for (const row of raw) {
    const text = redactText(row.text);
    const href = row.href;
    if (!text && !href) continue;
    const externalId = assignmentExternalId(href, text);
    if (!unique.has(externalId)) unique.set(externalId, {
      externalId,
      href: redactUrl(href),
      rawHref: href,
      text,
      title: redactText(row.title),
      ariaLabel: redactText(row.ariaLabel),
      subject: redactText(row.subject),
      teacher: redactText(row.teacher),
      files: row.files.filter((file) => file.href).map((file) => ({ href: file.href, name: redactText(file.name) })),
    });
  }
  return [...unique.values()].slice(0, maxAssignments);
}

async function workspaceMarkers(page) {
  return page.locator([
    '[data-tid*="app-bar" i]',
    '[data-tid*="team" i]',
    '[data-tid*="channel" i]',
    '[role="tree"]',
    '[aria-label*="teams" i]',
  ].join(",")).count().catch(() => 0);
}

async function readAssignmentDetail(page, assignment) {
  if (!assignment.rawHref) return assignment;
  await page.goto(assignment.rawHref, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1_200);
  const detail = await page.evaluate(() => {
    const root = document.querySelector("main, [role='main']") ?? document.body;
    const heading = root.querySelector("h1, [role='heading'][aria-level='1']");
    const subject = root.querySelector('[data-tid*="class" i], [data-tid*="course" i], [data-tid*="team-name" i]');
    const teacher = root.querySelector('[data-tid*="teacher" i], [data-tid*="author" i]');
    const files = Array.from(root.querySelectorAll("a[href]"))
      .filter((candidate) => /\.(?:docx?|pdf|pptx?|xlsx?|odt|ods|odp|txt|zip)(?:$|[?#])/i.test(candidate.getAttribute("href") || "") || candidate.hasAttribute("download"))
      .map((candidate) => ({
        href: candidate instanceof HTMLAnchorElement ? candidate.href : "",
        name: candidate.textContent || candidate.getAttribute("download") || candidate.getAttribute("title") || "",
      }));
    return {
      title: heading?.textContent || "",
      text: root.textContent || "",
      subject: subject?.textContent || "",
      teacher: teacher?.textContent || "",
      files,
    };
  });
  const files = [...new Map([...assignment.files, ...detail.files]
    .filter((file) => file.href)
    .map((file) => [file.href, { href: file.href, name: redactText(file.name) }])).values()];
  return {
    ...assignment,
    title: redactText(detail.title) || assignment.title,
    text: redactText(detail.text) || assignment.text,
    subject: redactText(detail.subject) || assignment.subject,
    teacher: redactText(detail.teacher) || assignment.teacher,
    files,
  };
}

function teamsFileHosts(value) {
  try {
    const hostname = new URL(value).hostname;
    if (hostname === "teams.microsoft.com") return [hostname];
    if (hostname.endsWith(".sharepoint.com")) return [hostname];
    return [];
  } catch {
    return [];
  }
}

async function downloadAssignmentFiles(page, assignments) {
  const documents = [];
  const warnings = [];
  const candidates = assignments.flatMap((assignment) => assignment.files.map((file) => ({ assignment, file }))).slice(0, maxFiles);
  for (const { assignment, file } of candidates) {
    const allowedHosts = teamsFileHosts(file.href);
    if (!allowedHosts.length) continue;
    const downloaded = await downloadSchoolDocument(page, {
      source: "teams",
      url: file.href,
      name: file.name,
      courseExternalId: assignment.subject || "general",
      academicItemExternalId: `teams:${assignment.externalId}`,
      subject: assignment.subject,
      sourcePath: [assignment.subject, "Assignments", assignment.title].filter(Boolean).join(" > "),
      allowedHosts,
    }).catch((error) => ({ state: "failed", error: error instanceof Error ? error.message : String(error) }));
    if (downloaded.document) documents.push(downloaded.document);
    else warnings.push(`file_${downloaded.state}`);
  }
  return { documents, warnings };
}

function publishableAssignment(row) {
  return {
    externalId: row.externalId,
    href: row.href,
    text: row.text,
    title: row.title,
    ariaLabel: row.ariaLabel,
    subject: row.subject,
    teacher: row.teacher,
  };
}

export function teamsAssignmentHealth(health, openedAssignments, assignmentCount, surfaceError = false) {
  if (surfaceError) {
    return { ...health, state: "assignments_surface_error", requiresUserAction: false };
  }
  return !openedAssignments && assignmentCount === 0
    ? { ...health, state: "assignments_surface_not_found", requiresUserAction: false }
    : health;
}

export async function syncTeams(page, source) {
  const health = await navigateToSource(page, source);
  if (health.requiresUserAction) return { source: source.key, health, visibleWorkspaceItems: [], items: [], documents: [] };

  await page.waitForTimeout(2_000);
  const markers = await workspaceMarkers(page);
  if (!markers) {
    return {
      source: source.key,
      health: { ...health, state: "workspace_not_ready", requiresUserAction: true },
      visibleWorkspaceItems: [],
      items: [],
      documents: [],
      warnings: ["teams_workspace_not_detected"],
      extractorState: "attention",
    };
  }

  const visibleWorkspaceItems = await collectVisibleItems(page, [
    '[role="treeitem"]',
    '[data-tid*="team" i]',
    '[data-tid*="channel" i]',
  ]);
  const openedAssignments = await openAssignmentsSurface(page);
  let assignmentSurfaceError = openedAssignments && await assignmentsSurfaceErrored(page);
  if (assignmentSurfaceError) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    await page.waitForTimeout(3_000);
    assignmentSurfaceError = await assignmentsSurfaceErrored(page);
  }
  const assignments = assignmentSurfaceError ? [] : await collectAssignmentCards(page);
  const assignmentSurfaceMissing = !openedAssignments && assignments.length === 0;
  const detailedAssignments = [];
  const detailWarnings = [];
  for (const assignment of assignments.slice(0, maxAssignmentDetails)) {
    try {
      detailedAssignments.push(await readAssignmentDetail(page, assignment));
    } catch {
      detailedAssignments.push(assignment);
      detailWarnings.push("assignment_detail_failed");
    }
  }
  detailedAssignments.push(...assignments.slice(maxAssignmentDetails));
  const downloaded = await downloadAssignmentFiles(page, detailedAssignments);
  const content = await syncTeamsContent(page, source, Math.max(0, maxFiles - downloaded.documents.length))
    .catch(() => ({ teams: [], channels: [], items: [], documents: [], warnings: ["teams_channel_read_failed"] }));
  const normalizedAssignments = normalizeTeamsRows(detailedAssignments.map(publishableAssignment));
  const items = [...new Map([...normalizedAssignments, ...content.items]
    .map((item) => [item.sourceExternalId, item])).values()];
  const documents = [...new Map([...downloaded.documents, ...content.documents]
    .map((document) => [document.sourceExternalId, document])).values()];
  const awaitingSchoolYear = content.warnings.includes("no_current_school_year_teams");

  return {
    source: source.key,
    syncedAt: new Date().toISOString(),
    health: teamsAssignmentHealth(health, openedAssignments, assignments.length, assignmentSurfaceError),
    visibleWorkspaceItems,
    teams: content.teams,
    channels: content.channels,
    items,
    documents,
    warnings: [
      ...downloaded.warnings,
      ...content.warnings.filter((warning) => warning !== "no_current_school_year_teams"),
      ...detailWarnings,
      ...(assignmentSurfaceError ? ["assignments_surface_error"] : []),
      ...(assignmentSurfaceMissing ? ["assignments_navigation_not_found"] : []),
    ],
    extractorState: assignmentSurfaceError ? "attention"
      : items.length || documents.length ? "structured"
        : awaitingSchoolYear ? "awaiting_school_year" : "structured_empty",
  };
}
