import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { downloadSchoolDocument, storeSchoolDocumentBuffer } from "../documents.mjs";
import { redactText } from "../inspection.mjs";

function boundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, parsed)) : fallback;
}

const maxTeams = boundedInteger(process.env.JARVIS_MAX_TEAMS_GROUPS, 16, 40);
const maxChannels = boundedInteger(process.env.JARVIS_MAX_TEAMS_CHANNELS, 8, 30);
const maxPosts = boundedInteger(process.env.JARVIS_MAX_TEAMS_POSTS, 40, 120);
const maxFolderDepth = boundedInteger(process.env.JARVIS_MAX_TEAMS_FOLDER_DEPTH, 4, 8);

function optionalPattern(value) {
  if (!value) return null;
  try {
    return new RegExp(value, "i");
  } catch {
    return null;
  }
}

const configuredTeamPattern = optionalPattern(process.env.JARVIS_TEAMS_NAME_PATTERN);

function stableReference(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 32);
}

function academicYearStart(value) {
  const match = /(?:20)?(\d{2})\s*[\/_-]\s*(?:20)?(\d{2})/.exec(String(value ?? ""));
  if (!match) return null;
  const start = 2000 + Number(match[1]);
  return 2000 + Number(match[2]) === start + 1 ? start : null;
}

function currentAcademicYearStart(reference = new Date()) {
  const year = reference.getUTCFullYear();
  return reference.getUTCMonth() >= 7 ? year : year - 1;
}

export function selectCurrentTeams(teams, reference = new Date()) {
  const currentYear = currentAcademicYearStart(reference);
  const exactYear = teams.filter((team) => academicYearStart(team.title) === currentYear);
  if (exactYear.length) return exactYear.slice(0, maxTeams);
  return teams.filter((team) => academicYearStart(team.title) === null && /\b1\s*C[I1]\b/i.test(team.title)).slice(0, maxTeams);
}

export function isUsefulTeamsPost(value) {
  const text = redactText(value);
  if (text.length < 20) return false;
  if (/meeting in ["“].+?["”] ended/i.test(text) && text.length < 180) return false;
  if (/^(?:.+?)?(?:started a meeting|joined the team|added .+ to the team)/i.test(text)) return false;
  return true;
}

export function teamsAnnouncementItem({ team, channel, author, text, title, externalId }) {
  const cleaned = redactText(text);
  const cleanedTitle = redactText(title) || cleaned.slice(0, 180);
  return {
    source: "teams",
    sourceExternalId: `teams:announcement:${externalId}`,
    type: "announcement",
    title: cleanedTitle,
    description: cleaned === cleanedTitle ? undefined : cleaned,
    subject: redactText(team),
    teacher: redactText(author) || undefined,
    evidence: "source_derived",
    confidence: 90,
    raw: { bucket: "announcement", channel: redactText(channel) },
  };
}

export function teamsPostAuthor(value) {
  const header = redactText(value);
  const dated = /^(.*?)(?=\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\s+\d{1,2}:\d{2})/.exec(header)?.[1];
  return redactText(dated || header);
}

function teamsPostBody(text, header) {
  const cleaned = redactText(text);
  const cleanedHeader = redactText(header);
  const body = cleanedHeader && cleaned.startsWith(cleanedHeader)
    ? cleaned.slice(cleanedHeader.length).trim()
    : cleaned;
  return body.replace(/\s*(?:reply|répondre|antworten)\s*$/i, "").trim();
}

async function collectClassTeams(page) {
  const cards = page.locator('[data-tid$="-team-card"]');
  await cards.first().waitFor({ state: "visible", timeout: 12_000 }).catch(() => undefined);
  const raw = await cards.evaluateAll((elements) => elements.map((card) => ({
    domId: card.getAttribute("data-tid") || "",
    title: card.textContent || card.getAttribute("aria-label") || "",
  })));
  return raw.map((team) => ({ ...team, title: redactText(team.title) })).filter((team) => team.domId && team.title);
}

async function teamCard(page, team) {
  const cards = page.locator('[data-tid$="-team-card"]');
  await cards.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const count = await cards.count();
    for (let index = 0; index < count; index += 1) {
      const card = cards.nth(index);
      const domId = await card.getAttribute("data-tid");
      const title = redactText(await card.innerText().catch(() => ""));
      if (domId === team.domId || title === team.title) return card;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

async function collectChannels(page) {
  const values = await page.locator('[data-tid="channel-list-item"]').evaluateAll((items) => items.map((item) => item.textContent || ""));
  return [...new Set(values.map(redactText).filter(Boolean))].slice(0, maxChannels);
}

async function openChannel(page, name) {
  const entries = page.locator('[data-tid="channel-list-item"]');
  const count = await entries.count();
  for (let index = 0; index < count; index += 1) {
    const entry = entries.nth(index);
    if (redactText(await entry.innerText().catch(() => "")) !== name) continue;
    await entry.click({ timeout: 10_000 }).catch(() => entry.evaluate((element) => element.click()));
    await page.waitForTimeout(2_000);
    return true;
  }
  return false;
}

async function openChannelTab(page, pattern) {
  const tab = page.getByRole("tab", { name: pattern }).first();
  if (!await tab.isVisible().catch(() => false)) return false;
  await tab.click({ timeout: 10_000 }).catch(() => tab.evaluate((element) => element.click()));
  await page.waitForTimeout(2_000);
  return true;
}

async function collectPosts(page, team, channel) {
  const raw = await page.locator('[data-tid="channel-pane-message"]').evaluateAll((messages) => messages.map((message) => {
    const header = message.querySelector('[data-tid="post-message-subheader"]')?.textContent || "";
    const title = message.querySelector('[data-tid*="post-title" i], [data-tid*="message-title" i]')?.textContent || "";
    const links = Array.from(message.querySelectorAll("a[href]"), (anchor) => ({
      href: anchor instanceof HTMLAnchorElement ? anchor.href : "",
      name: anchor.textContent || anchor.getAttribute("title") || anchor.getAttribute("download") || "",
    }));
    return {
      id: message.getAttribute("data-message-id") || message.id || "",
      header,
      title,
      text: message.textContent || "",
      links,
    };
  }));

  const posts = [];
  for (const row of raw.slice(-maxPosts)) {
    const text = teamsPostBody(row.text, row.header);
    if (!isUsefulTeamsPost(text)) continue;
    const header = redactText(row.header);
    const author = teamsPostAuthor(header);
    const externalId = row.id || stableReference(`${team.title}\u0000${channel}\u0000${header}\u0000${text}`);
    posts.push({
      item: teamsAnnouncementItem({ team: team.title, channel, author, text, title: row.title, externalId }),
      links: row.links.filter((link) => link.href).map((link) => ({ href: link.href, name: redactText(link.name) })),
    });
  }
  return posts;
}

function sharePointHosts(value) {
  try {
    const hostname = new URL(value).hostname;
    return hostname.endsWith(".sharepoint.com") ? [hostname] : [];
  } catch {
    return [];
  }
}

async function openSharedFrame(page) {
  if (!await openChannelTab(page, /^(shared|files)$/i)) return null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const frame = page.frames().find((candidate) => /\.sharepoint\.com\/.+filebrowser\.aspx/i.test(candidate.url()));
    if (frame) {
      await frame.locator('[data-automationid="list-content"]').waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
      return frame;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

export async function collectSharePointRows(frame) {
  const raw = await frame.locator('[role="row"][data-automationid^="row-"]').evaluateAll((rows) => rows
    .filter((row) => !row.querySelector('[role="columnheader"]'))
    .map((row) => {
    const nameCell = row.querySelector('[data-automationid="field-LinkFilename"]');
    const icons = row.querySelectorAll('[data-automationid="field-DocIcon"] img, [data-automationid="field-DocIcon"] [role="img"]');
    const modified = row.querySelector('[data-automationid="field-Modified"]');
    const editor = row.querySelector('[data-automationid="field-Editor"]');
    return {
      rowId: row.getAttribute("data-automationid") || "",
      name: nameCell?.textContent || "",
      icon: Array.from(icons, (icon) => icon.getAttribute("alt") || icon.getAttribute("aria-label") || "").join(" "),
      modified: modified?.getAttribute("title") || modified?.textContent || "",
      editor: editor?.textContent || "",
    };
  }));
  return raw.map((row) => {
    const name = redactText(row.name);
    const extension = path.extname(name);
    return {
      ...row,
      name,
      modified: redactText(row.modified),
      editor: redactText(row.editor),
      folder: /folder/i.test(row.icon) || (!extension && !redactText(row.modified)),
    };
  }).filter((row) => row.rowId && row.name);
}

async function rowLocator(frame, rowId) {
  return frame.locator(`[role="row"][data-automationid="${rowId.replaceAll('"', "")}"]`).first();
}

async function downloadSharePointRow(page, frame, row, metadata) {
  const locator = await rowLocator(frame, row.rowId);
  await locator.hover().catch(() => undefined);
  const more = locator.locator('[data-automationid="moreActionsHeroField"]');
  await more.evaluate((element) => element.click());
  const command = frame.locator('[data-automationid="downloadCommand"]').last();
  await command.waitFor({ state: "attached", timeout: 5_000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
  await command.evaluate((element) => element.click());
  const download = await downloadPromise;
  const failure = await download.failure();
  if (failure) throw new Error(failure);
  const temporaryPath = await download.path();
  if (!temporaryPath) throw new Error("SharePoint download did not produce a local file.");
  return storeSchoolDocumentBuffer({
    ...metadata,
    buffer: await fs.readFile(temporaryPath),
    name: download.suggestedFilename() || row.name,
    sourceUrl: download.url(),
  });
}

async function openSharePointFolder(frame, row) {
  const locator = await rowLocator(frame, row.rowId);
  const name = locator.locator('[data-automationid="field-LinkFilename"] [data-id="heroField"], [data-automationid="field-LinkFilename"] [role="button"]').first();
  await name.click({ timeout: 10_000 });
  await waitForSharePointDirectory(frame, row.name);
}

export async function waitForSharePointDirectory(frame, name, timeout = 20_000) {
  const result = await frame.waitForFunction((expected) => {
    const text = document.body?.innerText ?? "";
    if (/unauthorized operation|access denied|you (?:do not|don't) have permission/i.test(text)) return "access_denied";
    if (/couldn't get the page to display|something went wrong/i.test(text)) return "unavailable";
    const crumbs = Array.from(document.querySelectorAll('[data-automationid="breadcrumb-crumb"]'));
    const current = crumbs.at(-1)?.textContent?.replace(/\s+/g, " ").trim();
    const loading = document.querySelector('[aria-busy="true"], [role="progressbar"]');
    return current === expected && !loading ? "ready" : false;
  }, name, { timeout });
  const state = await result.jsonValue();
  await result.dispose();
  if (state !== "ready") throw new Error(`shared_folder_${state}`);
}

async function returnToSharePointParent(frame, parentName) {
  const crumbs = frame.locator('[data-automationid="breadcrumb-crumb"]');
  const count = await crumbs.count();
  for (let index = count - 1; index >= 0; index -= 1) {
    const crumb = crumbs.nth(index);
    if (redactText(await crumb.innerText().catch(() => "")) !== parentName) continue;
    await crumb.click({ timeout: 10_000 });
    await waitForSharePointDirectory(frame, parentName);
    return true;
  }
  return false;
}

async function readSharePointDirectory(page, frame, metadata, folderPath, remaining, depth = 0, currentCrumb = metadata.channel) {
  const documents = [];
  const warnings = [];
  const rows = await collectSharePointRows(frame);
  for (const row of rows.filter((candidate) => !candidate.folder)) {
    if (documents.length >= remaining) break;
    try {
      const stored = await downloadSharePointRow(page, frame, row, {
        ...metadata,
        sourcePath: [...folderPath, row.name].join(" > "),
      });
      if (stored.document) documents.push(stored.document);
      else warnings.push(`shared_file_${stored.state}`);
    } catch {
      warnings.push("shared_file_download_failed");
    }
  }

  if (depth >= maxFolderDepth) return { documents, warnings };
  for (const folder of rows.filter((candidate) => candidate.folder)) {
    if (documents.length >= remaining) break;
    try {
      await openSharePointFolder(frame, folder);
      const nested = await readSharePointDirectory(
        page,
        frame,
        metadata,
        [...folderPath, folder.name],
        remaining - documents.length,
        depth + 1,
        folder.name,
      );
      documents.push(...nested.documents);
      warnings.push(...nested.warnings);
      if (!await returnToSharePointParent(frame, currentCrumb)) break;
    } catch (error) {
      warnings.push(error?.message === "shared_folder_access_denied" ? error.message : "shared_folder_navigation_failed");
      break;
    }
  }
  return { documents, warnings };
}

async function downloadPostLinks(page, posts, metadata, remaining) {
  const documents = [];
  const warnings = [];
  const links = posts.flatMap((post) => post.links.map((link) => ({ post, link })));
  for (const { post, link } of links) {
    if (documents.length >= remaining) break;
    const allowedHosts = sharePointHosts(link.href);
    if (!allowedHosts.length) continue;
    const downloaded = await downloadSchoolDocument(page, {
      ...metadata,
      url: link.href,
      name: link.name,
      academicItemExternalId: post.item.sourceExternalId,
      sourcePath: `${metadata.subject} > ${metadata.channel} > Posts > ${link.name}`,
      allowedHosts,
    }).catch(() => ({ state: "failed" }));
    if (downloaded.document) documents.push(downloaded.document);
    else warnings.push(`post_file_${downloaded.state}`);
  }
  return { documents, warnings };
}

export async function syncTeamsContent(page, source, fileBudget, reference = new Date()) {
  await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(2_000);
  const teams = await collectClassTeams(page);
  const matchingTeams = configuredTeamPattern
    ? teams.filter((team) => configuredTeamPattern.test(team.title))
    : teams;
  const activeTeams = selectCurrentTeams(matchingTeams, reference);
  const items = [];
  const documents = [];
  const warnings = [];
  const channels = [];

  if (!activeTeams.length) warnings.push("no_current_school_year_teams");
  for (const team of activeTeams) {
    await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2_000);
    const card = await teamCard(page, team);
    if (!card) {
      warnings.push("team_navigation_not_found");
      continue;
    }
    await card.click({ timeout: 10_000 }).catch(() => card.evaluate((element) => element.click()));
    await page.waitForTimeout(3_000);
    const teamChannels = await collectChannels(page);
    for (const channel of teamChannels) {
      if (!await openChannel(page, channel)) continue;
      await openChannelTab(page, /^posts?$/i);
      const posts = await collectPosts(page, team, channel);
      items.push(...posts.map((post) => post.item));
      channels.push({ team: team.title, channel, postCount: posts.length });

      const metadata = {
        source: "teams",
        courseExternalId: `team:${stableReference(team.domId)}`,
        subject: team.title,
        channel,
      };
      if (documents.length < fileBudget) {
        const postFiles = await downloadPostLinks(page, posts, metadata, fileBudget - documents.length);
        documents.push(...postFiles.documents);
        warnings.push(...postFiles.warnings);
      }
      if (documents.length < fileBudget) {
        const frame = await openSharedFrame(page);
        if (frame) {
          const shared = await readSharePointDirectory(
            page,
            frame,
            metadata,
            [team.title, channel, "Files"],
            fileBudget - documents.length,
          );
          documents.push(...shared.documents);
          warnings.push(...shared.warnings);
        } else {
          warnings.push("shared_files_surface_not_found");
        }
      }
    }
  }

  return {
    teams: teams.map((team) => ({
      externalId: `team:${stableReference(team.domId)}`,
      title: team.title,
      active: activeTeams.some((candidate) => candidate.domId === team.domId),
    })),
    channels,
    items,
    documents,
    warnings: [...new Set(warnings)],
  };
}
