import assert from "node:assert/strict";
import test from "node:test";

import yazl from "yazl";

import { extractOpenXmlText, openXmlExtractor } from "../src/openxml.mjs";

function zipBuffer(entries) {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    const chunks = [];
    archive.outputStream.on("data", (chunk) => chunks.push(chunk));
    archive.outputStream.on("error", reject);
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    for (const [name, value] of Object.entries(entries)) archive.addBuffer(Buffer.from(value), name);
    archive.end();
  });
}

const contentTypes = (mainType) => `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/main.xml" ContentType="application/vnd.openxmlformats-officedocument.${mainType}"/></Types>`;

test("extracts paragraphs and table text from a DOCX package", async () => {
  const body = await zipBuffer({
    "[Content_Types].xml": contentTypes("wordprocessingml.document.main+xml"),
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Cell division notes</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Mitosis</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Two daughter cells</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
  });
  const text = await extractOpenXmlText(body, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx");
  assert.match(text, /^\[Document\]/);
  assert.match(text, /Cell division notes/);
  assert.match(text, /Mitosis\nTwo daughter cells/);
  assert.equal(openXmlExtractor(".docx"), "openxml-word-v1");
});

test("uses presentation order and preserves slide locators from PPTX", async () => {
  const body = await zipBuffer({
    "[Content_Types].xml": contentTypes("presentationml.presentation.main+xml"),
    "ppt/presentation.xml": `<?xml version="1.0"?><p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId id="1" r:id="rId2"/><p:sldId id="2" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<?xml version="1.0"?><Relationships xmlns="urn:r"><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>`,
    "ppt/slides/slide1.xml": `<?xml version="1.0"?><p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>Conclusion</a:t></a:r></a:p></p:sld>`,
    "ppt/slides/slide2.xml": `<?xml version="1.0"?><p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>Introduction</a:t></a:r></a:p></p:sld>`,
  });
  const text = await extractOpenXmlText(body, "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx");
  assert.ok(text.indexOf("[Slide 1]\nIntroduction") < text.indexOf("[Slide 2]\nConclusion"));
  assert.equal(openXmlExtractor(".pptx"), "openxml-powerpoint-v1");
});

test("resolves shared strings, formulas, booleans, and sheet names from XLSX", async () => {
  const body = await zipBuffer({
    "[Content_Types].xml": contentTypes("spreadsheetml.sheet.main+xml"),
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="urn:x" xmlns:r="urn:r"><sheets><sheet name="Results" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="urn:r"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst xmlns="urn:x"><si><t>Physics</t></si></sst>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="urn:x"><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><f>SUM(2,3)</f><v>5</v></c><c r="C1" t="b"><v>1</v></c></row></sheetData></worksheet>`,
  });
  const text = await extractOpenXmlText(body, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx");
  assert.match(text, /^\[Sheet Results\]/);
  assert.match(text, /A1: Physics/);
  assert.match(text, /B1: =SUM\(2,3\) -> 5/);
  assert.match(text, /C1: TRUE/);
  assert.equal(openXmlExtractor(".xlsx"), "openxml-spreadsheet-v1");
});

test("uses workbook order when spreadsheet part numbers differ", async () => {
  const body = await zipBuffer({
    "[Content_Types].xml": contentTypes("spreadsheetml.sheet.main+xml"),
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="urn:x" xmlns:r="urn:r"><sheets><sheet name="First" sheetId="2" r:id="rId2"/><sheet name="Second" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="urn:r"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="urn:x"><sheetData><row><c r="A1" t="inlineStr"><is><t>Second value</t></is></c></row></sheetData></worksheet>`,
    "xl/worksheets/sheet2.xml": `<?xml version="1.0"?><worksheet xmlns="urn:x"><sheetData><row><c r="A1" t="inlineStr"><is><t>First value</t></is></c></row></sheetData></worksheet>`,
  });
  const text = await extractOpenXmlText(body, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx");
  assert.ok(text.indexOf("[Sheet First]") < text.indexOf("[Sheet Second]"));
});

test("rejects a ZIP package whose declared Office type is different", async () => {
  const body = await zipBuffer({
    "[Content_Types].xml": contentTypes("presentationml.presentation.main+xml"),
    "word/document.xml": "<?xml version=\"1.0\"?><document/>",
  });
  await assert.rejects(
    extractOpenXmlText(body, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"),
    /does not match/,
  );
});

test("rejects extreme decompression ratios before parsing Office XML", async () => {
  const body = await zipBuffer({
    "[Content_Types].xml": contentTypes("wordprocessingml.document.main+xml"),
    "word/document.xml": `<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>${"A".repeat(2_000_000)}</w:t></w:r></w:p></w:body></w:document>`,
  });
  await assert.rejects(
    extractOpenXmlText(body, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"),
    /compression ratio/,
  );
});
