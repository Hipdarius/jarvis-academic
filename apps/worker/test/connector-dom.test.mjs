import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

import { collectActivityPage, collectCourseModules } from "../src/sources/moodle.mjs";
import { collectSharePointRows, waitForSharePointDirectory } from "../src/sources/teams-content.mjs";

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

test("SharePoint requires the destination breadcrumb before accepting folder contents", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div data-automationid="breadcrumb-crumb">General</div>');
    await assert.rejects(waitForSharePointDirectory(page, "Chapter 2", 200), /Timeout/);
    await page.setContent('<div data-automationid="breadcrumb-crumb">General</div><div data-automationid="breadcrumb-crumb">Chapter 2</div>');
    await waitForSharePointDirectory(page, "Chapter 2", 500);
    await page.setContent('<main>Attempted to perform an unauthorized operation.</main>');
    await assert.rejects(waitForSharePointDirectory(page, "Class Materials", 500), /shared_folder_access_denied/);
  } finally { await page.close(); }
});

test("SharePoint excludes column headings and recognizes icon-based folders", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <div role="row" data-automationid="row-header">
        <div role="columnheader" data-automationid="field-LinkFilename">Name</div>
        <div role="columnheader" data-automationid="field-Modified">Modified</div>
      </div>
      <div role="row" data-automationid="row-0">
        <div data-automationid="field-LinkFilename">Chapter 1.2</div>
        <div data-automationid="field-DocIcon"><i role="img" aria-label="Yellow folder"></i></div>
        <div data-automationid="field-Modified">September 4</div>
      </div>
      <div role="row" data-automationid="row-1">
        <div data-automationid="field-LinkFilename">Worksheet.pdf</div>
        <div data-automationid="field-DocIcon"><img alt=".pdf"></div>
        <div data-automationid="field-Modified">September 4</div>
      </div>
    `);
    const rows = await collectSharePointRows(page);
    assert.deepEqual(rows.map(({ name, folder }) => ({ name, folder })), [
      { name: "Chapter 1.2", folder: true },
      { name: "Worksheet.pdf", folder: false },
    ]);
  } finally { await page.close(); }
});

test("Moodle retains the course and section of each nested content activity", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <section class="course-section"><h2 class="sectionname">Semester 1: Databases</h2>
        <li class="activity"><div class="activity-item"><div class="activityinstance">
          <a href="https://academy.am.lu/mod/folder/view.php?id=21">Chapter 2</a>
        </div></div></li>
        <li class="activity"><a href="https://academy.am.lu/mod/resource/view.php?id=22">Exercises</a></li>
        <li class="activity"><a href="https://academy.am.lu/mod/assign/view.php?id=23">Project draft</a></li>
      </section>
    `);
    const modules = await collectCourseModules(page, { id: "7", title: "1CI AMINF" });
    assert.equal(modules.activities.length, 1);
    assert.equal(modules.activities[0].sourcePath, "1CI AMINF > Semester 1: Databases > Chapter 2");
    assert.equal(modules.resources[0].sourcePath, "1CI AMINF > Semester 1: Databases");
    assert.equal(modules.assignments[0].externalId, "assign:7:23");
  } finally { await page.close(); }
});

test("Moodle reads the page body and folder files beyond the activity description", async () => {
  const page = await browser.newPage();
  try {
    await page.route("https://academy.am.lu/**", (route) => route.fulfill({
      contentType: "text/html",
      body: `<main id="region-main">
        <div class="activity-description">Short introduction only.</div>
        <div class="generalbox"><h2>Database normalization</h2><p>Actual chapter content.</p></div>
        <div class="foldertree"><a href="https://academy.am.lu/pluginfile.php/1/mod_folder/content/0/worksheet.pdf">Worksheet.pdf</a></div>
      </main>`,
    }));
    const result = await collectActivityPage(page, { type: "page", href: "https://academy.am.lu/mod/page/view.php?id=21" });
    assert.match(result.text, /Actual chapter content/);
    assert.doesNotMatch(result.text, /Short introduction/);
    assert.equal(result.links.length, 1);
  } finally { await page.close(); }
});

test("Moodle finds book chapters in the sidebar and never indexes navigation alone", async () => {
  const page = await browser.newPage();
  try {
    await page.route("https://academy.am.lu/**", (route) => route.fulfill({
      contentType: "text/html",
      body: `<aside class="book_toc"><a href="https://academy.am.lu/mod/book/view.php?id=21&chapterid=2">Chapter 2</a></aside>
        <main id="region-main"><nav>Home My courses Dashboard</nav></main>`,
    }));
    const result = await collectActivityPage(page, { type: "book", href: "https://academy.am.lu/mod/book/view.php?id=21" });
    assert.equal(result.chapters.length, 1);
    assert.equal(result.text, "");
  } finally { await page.close(); }
});
