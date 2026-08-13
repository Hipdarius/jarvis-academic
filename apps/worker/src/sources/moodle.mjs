import { downloadSchoolDocument } from "../documents.mjs";
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

export function academicYearStart(name) {
  const match = /(?:20)?(\d{2})\s*[\/-]\s*(?:20)?(\d{2})/.exec(String(name ?? ""));
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

async function collectCourseModules(page, course) {
  const modules = await page.locator(".activity-item, li.activity, .activityinstance").evaluateAll((elements) => elements.map((element) => {
    const assignment = element.querySelector('a[href*="/mod/assign/view.php"]');
    const resources = Array.from(element.querySelectorAll([
      'a[href*="/mod/resource/view.php"]',
      'a[href*="/pluginfile.php/"]',
    ].join(",")));
    return {
      text: element.textContent || "",
      assignmentHref: assignment instanceof HTMLAnchorElement ? assignment.href : "",
      assignmentTitle: assignment?.textContent || assignment?.getAttribute("title") || "",
      resources: resources.map((anchor) => ({
        href: anchor instanceof HTMLAnchorElement ? anchor.href : "",
        name: anchor.textContent || anchor.getAttribute("title") || "",
      })),
    };
  }));

  const assignments = [];
  const resources = [];
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
        externalId: `assign:${course.id}:${moduleId}`,
      });
    }
    for (const resource of courseModule.resources) {
      if (resource.href) resources.push({ href: resource.href, name: redactText(resource.name) });
    }
  }
  return {
    assignments: [...new Map(assignments.map((assignment) => [assignment.externalId, assignment])).values()],
    resources: [...new Map(resources.map((resource) => [resource.href, resource])).values()],
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
  const courses = await collectCourses(page);
  const rows = [];
  const documents = [];
  const warnings = [];
  let assignmentBudget = maxAssignments;
  const orderedCourses = prioritizeCourses(courses, reference);

  for (const course of orderedCourses) {
    if (assignmentBudget <= 0) break;
    await page.goto(course.href, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(500);
    const modules = await collectCourseModules(page, course);
    const archived = isArchivedCourse(course.title, reference);
    const activeCandidates = modules.assignments.filter((row) => keepAsActive(row, archived, reference));
    const detailCandidates = archived
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
      const downloaded = await downloadDocuments(page, source, course, modules.resources, detailed, maxFiles - documents.length);
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
    extractorState: "structured",
  };
}
