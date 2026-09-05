import { downloadSchoolDocument, storeSchoolTextDocument } from "../documents.mjs";
import { navigateToSource, redactText, redactUrl } from "../inspection.mjs";
import { normalizeMoodleRows } from "../normalization.mjs";
import { parseSourceDate } from "../source-time.mjs";

function boundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, parsed)) : fallback;
}

const maxCourses = boundedInteger(process.env.JARVIS_MAX_MOODLE_COURSES, 24, 60);
const maxAssignments = boundedInteger(process.env.JARVIS_MAX_MOODLE_ASSIGNMENTS, 80, 200);
const maxFiles = boundedInteger(process.env.JARVIS_MAX_FILES_PER_SOURCE, 40, 100);
const maxContentActivities = boundedInteger(process.env.JARVIS_MAX_MOODLE_CONTENT_ACTIVITIES, 80, 200);
const contentActivityTypes = new Set(["book", "folder", "page"]);

export function academicYearStart(name) {
  const match = /(?:20)?(\d{2})\s*[\/_-]\s*(?:20)?(\d{2})/.exec(String(name ?? ""));
  if (!match) return null;
  const start = 2000 + Number(match[1]);
  const end = 2000 + Number(match[2]);
  return end === start + 1 ? start : null;
}

export function currentAcademicYearStart(reference = new Date()) {
  const year = reference.getUTCFullYear();
  return reference.getUTCMonth() >= 7 ? year : year - 1;
}

export function isArchivedCourse(name, reference = new Date()) {
  const start = academicYearStart(name);
  return start !== null && start < currentAcademicYearStart(reference);
}

export function prioritizeCourses(courses, reference = new Date()) {
  return [...courses].sort((first, second) => (
    Number(isArchivedCourse(first.title, reference)) - Number(isArchivedCourse(second.title, reference))
  ));
}

function queryId(value) {
  try {
    return new URL(value).searchParams.get("id");
  } catch {
    return null;
  }
}

async function collectCourses(page) {
  const rows = await page.locator('a[href*="/course/view.php"][href*="id="]').evaluateAll((anchors) => anchors.map((anchor) => ({
    href: anchor instanceof HTMLAnchorElement ? anchor.href : "",
    title: anchor.textContent || anchor.getAttribute("title") || "",
  })));
  const unique = new Map();
  for (const row of rows) {
    const id = queryId(row.href);
    const title = redactText(row.title);
    if (id && title && !unique.has(id)) unique.set(id, { id, title, href: row.href });
  }
  return [...unique.values()].slice(0, maxCourses);
}

export function moodleActivityType(value) {
  try {
    return /\/mod\/([^/]+)\/view\.php$/i.exec(new URL(value).pathname)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function isMoodleContentActivity(value) {
  return contentActivityTypes.has(moodleActivityType(value));
}

async function openCourseIndex(page, source) {
  const indexUrl = new URL("my/courses.php", source.url).href;
  const response = await page.goto(indexUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
  if (!response || response.status() >= 400) {
    await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }
  await page.waitForTimeout(700);
}

export async function collectCourseModules(page, course) {
  const modules = await page.locator(".activity-item, li.activity, .activityinstance").evaluateAll((elements) => elements.map((element) => {
    const assignment = element.querySelector('a[href*="/mod/assign/view.php"]');
    const section = element.closest(".course-section, li.section, [data-sectionid]");
    const sectionHeading = section?.querySelector(".sectionname, h2, h3, h4, [data-region='section-title']");
    const resources = Array.from(element.querySelectorAll([
      'a[href*="/mod/resource/view.php"]',
      'a[href*="/pluginfile.php/"]',
    ].join(",")));
    const activities = Array.from(element.querySelectorAll('a[href*="/mod/"][href*="/view.php"]'));
    return {
      text: element.textContent || "",
      sectionName: sectionHeading?.textContent || "",
      assignmentHref: assignment instanceof HTMLAnchorElement ? assignment.href : "",
      assignmentTitle: assignment?.textContent || assignment?.getAttribute("title") || "",
      resources: resources.map((anchor) => ({
        href: anchor instanceof HTMLAnchorElement ? anchor.href : "",
        name: anchor.textContent || anchor.getAttribute("title") || "",
      })),
      activities: activities.map((anchor) => ({
        href: anchor instanceof HTMLAnchorElement ? anchor.href : "",
        name: anchor.textContent || anchor.getAttribute("title") || "",
      })),
    };
  }));

  const assignments = [];
  const resources = [];
  const activities = [];
  for (const courseModule of modules) {
    const text = redactText(courseModule.text);
    if (courseModule.assignmentHref) {
      const moduleId = queryId(courseModule.assignmentHref);
      if (moduleId) assignments.push({
        href: courseModule.assignmentHref,
        moduleId,
        text,
        title: redactText(courseModule.assignmentTitle),
        subject: course.title,
        courseExternalId: `course:${course.id}`,
        sourcePath: [course.title, redactText(courseModule.sectionName), redactText(courseModule.assignmentTitle)].filter(Boolean).join(" > "),
        externalId: `assign:${course.id}:${moduleId}`,
      });
    }
    for (const resource of courseModule.resources) {
      if (resource.href) resources.push({
        href: resource.href,
        name: redactText(resource.name),
        sourcePath: [course.title, redactText(courseModule.sectionName)].filter(Boolean).join(" > "),
      });
    }
    for (const activity of courseModule.activities) {
      if (!activity.href || !isMoodleContentActivity(activity.href)) continue;
      const type = moodleActivityType(activity.href);
      const moduleId = queryId(activity.href);
      if (!type || !moduleId) continue;
      activities.push({
        type,
        moduleId,
        href: activity.href,
        title: redactText(activity.name) || `${type} ${moduleId}`,
        sectionName: redactText(courseModule.sectionName),
        sourcePath: [course.title, redactText(courseModule.sectionName), redactText(activity.name)].filter(Boolean).join(" > "),
      });
    }
  }
  return {
    assignments: [...new Map(assignments.map((assignment) => [assignment.externalId, assignment])).values()],
    resources: [...new Map(resources.map((resource) => [resource.href, resource])).values()],
    activities: [...new Map(activities.map((activity) => [`${activity.type}:${activity.moduleId}`, activity])).values()],
  };
}

export async function collectActivityPage(page, activity) {
  await page.goto(activity.href, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(500);
  return page.evaluate((type) => {
    const main = document.querySelector("#region-main, main, [role='main']");
    const content = type === "book"
      ? main?.querySelector(".book_content")
      : main?.querySelector(".generalbox, [data-region='activity-content']");
    const links = Array.from((main ?? document.createElement("div")).querySelectorAll('a[href*="/pluginfile.php/"], a[href*="/mod/resource/view.php"]'));
    const chapters = Array.from(document.querySelectorAll('.book_toc a[href*="/mod/book/view.php"][href*="chapterid="], .block_book_toc a[href*="chapterid="]'));
    return {
      title: content?.querySelector("h1, h2, h3")?.textContent || "",
      text: content?.textContent || "",
      links: links.map((anchor) => ({
        href: anchor instanceof HTMLAnchorElement ? anchor.href : "",
        name: anchor.textContent || anchor.getAttribute("download") || anchor.getAttribute("title") || "",
      })),
      chapters: chapters.map((anchor) => ({
        href: anchor instanceof HTMLAnchorElement ? anchor.href : "",
        name: anchor.textContent || anchor.getAttribute("title") || "",
      })),
    };
  }, activity.type);
}

async function discoverActivityContent(page, source, course, activity, remaining) {
  const pages = [];
  const resources = [];
  const warnings = [];
  const queue = [activity];
  const visited = new Set();

  while (queue.length && visited.size < maxContentActivities && pages.length + resources.length < remaining) {
    const current = queue.shift();
    if (!current?.href || visited.has(current.href)) continue;
    visited.add(current.href);
    try {
      const content = await collectActivityPage(page, current);
      const title = redactText(content.title) || current.title;
      const sourcePath = [activity.sourcePath, current.chapterTitle].filter(Boolean).join(" > ");
      for (const link of content.links) {
        if (!link.href) continue;
        resources.push({ href: link.href, name: redactText(link.name), sourcePath });
      }
      if (["book", "page"].includes(activity.type)) {
        const stored = await storeSchoolTextDocument({
          source: source.key,
          content: content.text,
          name: [title, current.chapterTitle].filter(Boolean).join(" - "),
          sourceUrl: current.href,
          courseExternalId: `course:${course.id}`,
          academicItemExternalId: null,
          subject: course.title,
          sourcePath,
        });
        if (stored.document) pages.push(stored.document);
        else if (stored.state === "skipped_empty") warnings.push(`activity_${activity.type}_content_not_found`);
      }
      if (activity.type === "book") {
        for (const chapter of content.chapters) {
          if (chapter.href && new URL(chapter.href).origin === new URL(activity.href).origin
            && queryId(chapter.href) === activity.moduleId && !visited.has(chapter.href)) {
            queue.push({ ...activity, href: chapter.href, chapterTitle: redactText(chapter.name) });
          }
        }
      }
    } catch {
      warnings.push(`activity_${activity.type}_failed`);
    }
  }

  return {
    documents: pages.slice(0, remaining),
    resources: [...new Map(resources.map((resource) => [resource.href, resource])).values()].slice(0, Math.max(0, remaining - pages.length)),
    warnings,
  };
}

async function readAssignment(page, row) {
  await page.goto(row.href, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(600);
  const detail = await page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent || "";
    const submissionRows = Array.from(document.querySelectorAll("tr"))
      .map((element) => element.textContent || "")
      .filter((value) => /submission|submitted|grading|attempt|due date/i.test(value));
    const teacherFiles = Array.from(document.querySelectorAll('a[href*="/mod_assign/introattachment/"], #intro a[href*="/pluginfile.php/"]'))
      .map((anchor) => ({
        href: anchor instanceof HTMLAnchorElement ? anchor.href : "",
        name: anchor.textContent || anchor.getAttribute("title") || "",
      }));
    return {
      title: text("h1"),
      description: text("#intro") || text(".activity-description"),
      timing: text('[data-region="activity-information"]'),
      submissionRows,
      teacherFiles,
    };
  });
  const submissionText = redactText(detail.submissionRows.join(" | "));
  return {
    ...row,
    href: redactUrl(row.href),
    title: redactText(detail.title) || row.title,
    description: redactText(detail.description),
    text: redactText([row.text, detail.timing, submissionText].filter(Boolean).join(" | ")),
    submissionStatus: submissionText,
    status: /submitted for grading|graded|submission status\s+submitted/i.test(submissionText) ? "done" : "inbox",
    teacherFiles: detail.teacherFiles.filter((file) => file.href).map((file) => ({ href: file.href, name: redactText(file.name) })),
  };
}

function keepAsActive(row, archived, reference) {
  if (!archived) return true;
  const date = parseSourceDate(row.text, { reference });
  if (!date?.iso) return false;
  return new Date(date.iso).getTime() >= reference.getTime() - 30 * 86_400_000;
}

async function downloadDocuments(page, source, course, resources, assignments, remaining) {
  const allowedHosts = [new URL(source.url).hostname];
  const candidates = [
    ...resources.map((resource) => ({ ...resource, academicItemExternalId: null })),
    ...assignments.flatMap((assignment) => assignment.teacherFiles.map((file) => ({
      ...file,
      academicItemExternalId: `${source.key}:${assignment.externalId}`,
      sourcePath: assignment.sourcePath,
    }))),
  ].slice(0, remaining);
  const documents = [];
  const warnings = [];
  for (const candidate of candidates) {
    const downloaded = await downloadSchoolDocument(page, {
      source: source.key,
      url: candidate.href,
      name: candidate.name,
      courseExternalId: `course:${course.id}`,
      academicItemExternalId: candidate.academicItemExternalId,
      subject: course.title,
      sourcePath: candidate.sourcePath || course.title,
      allowedHosts,
    }).catch((error) => ({ state: "failed", error: error instanceof Error ? error.message : String(error) }));
    if (downloaded.document) documents.push(downloaded.document);
    else if (downloaded.state !== "skipped_type") warnings.push(`file_${downloaded.state}`);
  }
  return { documents, warnings };
}

export async function syncMoodle(page, source) {
  const health = await navigateToSource(page, source);
  if (health.requiresUserAction) return { source: source.key, health, courses: [], items: [], documents: [] };

  const reference = new Date();
  await openCourseIndex(page, source);
  const courses = await collectCourses(page);
  const rows = [];
  const documents = [];
  const warnings = [];
  let assignmentBudget = maxAssignments;
  const orderedCourses = prioritizeCourses(courses, reference);

  for (const course of orderedCourses) {
    let modules;
    try {
      await page.goto(course.href, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(500);
      modules = await collectCourseModules(page, course);
    } catch {
      warnings.push("course_navigation_failed");
      continue;
    }
    const archived = isArchivedCourse(course.title, reference);
    const activeCandidates = modules.assignments.filter((row) => keepAsActive(row, archived, reference));
    const detailCandidates = assignmentBudget <= 0 ? [] : archived
      ? modules.assignments.slice(-Math.min(4, assignmentBudget))
      : modules.assignments.slice(0, assignmentBudget);
    const detailed = [];
    for (const row of detailCandidates) {
      try {
        detailed.push(await readAssignment(page, row));
      } catch {
        detailed.push({ ...row, href: redactUrl(row.href), teacherFiles: [] });
        warnings.push("assignment_detail_failed");
      }
      assignmentBudget -= 1;
      if (assignmentBudget <= 0) break;
    }
    const detailById = new Map(detailed.map((row) => [row.externalId, row]));
    rows.push(...activeCandidates.map((row) => detailById.get(row.externalId) ?? { ...row, href: redactUrl(row.href) }));

    if (documents.length < maxFiles) {
      const discoveredResources = [...modules.resources];
      for (const activity of modules.activities.slice(0, maxContentActivities)) {
        if (documents.length >= maxFiles) break;
        const discovered = await discoverActivityContent(
          page,
          source,
          course,
          activity,
          maxFiles - documents.length,
        );
        documents.push(...discovered.documents);
        discoveredResources.push(...discovered.resources);
        warnings.push(...discovered.warnings);
      }
      const downloaded = await downloadDocuments(page, source, course, discoveredResources, detailed, maxFiles - documents.length);
      documents.push(...downloaded.documents);
      warnings.push(...downloaded.warnings);
    }
  }

  return {
    source: source.key,
    syncedAt: new Date().toISOString(),
    health,
    courses: courses.map((course) => ({
      externalId: `course:${course.id}`,
      title: course.title,
      archived: isArchivedCourse(course.title, reference),
      href: redactUrl(course.href),
    })),
    items: normalizeMoodleRows(source.key, rows, reference).map((item) => {
      const row = rows.find((candidate) => `${source.key}:${candidate.externalId}` === item.sourceExternalId);
      return row?.status ? { ...item, status: row.status } : item;
    }),
    documents,
    warnings: [...new Set(warnings)],
    extractorState: courses.length ? "structured" : "structured_empty",
  };
}
