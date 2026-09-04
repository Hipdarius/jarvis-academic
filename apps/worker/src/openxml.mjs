import path from "node:path";

import sax from "sax";
import yauzl from "yauzl";

const maxArchiveEntries = 2_000;
const maxSelectedEntries = 600;
const maxEntryBytes = 12 * 1_024 * 1_024;
const maxSelectedBytes = 32 * 1_024 * 1_024;
const maxCompressionRatio = 200;
const maxCells = 10_000;
const maxSharedStrings = 50_000;

const formats = {
  docx: {
    extensions: new Set([".docx"]),
    mimeTypes: new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
    contentType: "wordprocessingml.document.main+xml",
  },
  pptx: {
    extensions: new Set([".pptx"]),
    mimeTypes: new Set(["application/vnd.openxmlformats-officedocument.presentationml.presentation"]),
    contentType: "presentationml.presentation.main+xml",
  },
  xlsx: {
    extensions: new Set([".xlsx"]),
    mimeTypes: new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
    contentType: "spreadsheetml.sheet.main+xml",
  },
};

function formatFor(mimeType, extension) {
  return Object.entries(formats).find(([, format]) => (
    format.extensions.has(extension) || format.mimeTypes.has(mimeType)
  ))?.[0] ?? null;
}

function selectedEntry(format, name) {
  if (name === "[content_types].xml") return true;
  if (format === "docx") {
    return /^word\/(?:document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/.test(name);
  }
  if (format === "pptx") {
    return name === "ppt/presentation.xml"
      || name === "ppt/_rels/presentation.xml.rels"
      || /^ppt\/(?:slides\/slide|notesslides\/notesslide)\d+\.xml$/.test(name);
  }
  return name === "xl/workbook.xml"
    || name === "xl/_rels/workbook.xml.rels"
    || name === "xl/sharedstrings.xml"
    || /^xl\/worksheets\/sheet\d+\.xml$/.test(name);
}

function safeArchiveName(value) {
  return typeof value === "string"
    && value.length <= 500
    && !value.includes("\0")
    && !value.startsWith("/")
    && !/^[a-z]:/i.test(value)
    && !value.split("/").some((segment) => segment === ".." || segment === ".");
}

function collectArchiveEntries(buffer, format) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, {
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    }, (openError, zipfile) => {
      if (openError || !zipfile) {
        reject(new Error("The Office file is not a readable ZIP archive."));
        return;
      }

      const entries = new Map();
      let entryCount = 0;
      let selectedCount = 0;
      let selectedBytes = 0;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        zipfile.close();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      zipfile.on("error", fail);
      zipfile.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(entries);
      });
      zipfile.on("entry", (entry) => {
        try {
          entryCount += 1;
          if (entryCount > maxArchiveEntries) throw new Error("The Office file contains too many archive entries.");
          if (!safeArchiveName(entry.fileName)) throw new Error("The Office file contains an unsafe archive path.");
          const name = entry.fileName.toLowerCase();
          if (entry.fileName.endsWith("/") || !selectedEntry(format, name)) {
            zipfile.readEntry();
            return;
          }
          if (entry.generalPurposeBitFlag & 0x1) throw new Error("Encrypted Office files cannot be indexed.");
          if (![0, 8].includes(entry.compressionMethod)) throw new Error("The Office file uses an unsupported compression method.");
          if (entries.has(name)) throw new Error("The Office file contains duplicate document parts.");
          if (entry.uncompressedSize > maxEntryBytes) throw new Error("An Office document part exceeds the extraction limit.");
          const ratio = entry.compressedSize > 0 ? entry.uncompressedSize / entry.compressedSize : entry.uncompressedSize;
          if (ratio > maxCompressionRatio) throw new Error("The Office file exceeds the safe compression ratio.");
          selectedCount += 1;
          selectedBytes += entry.uncompressedSize;
          if (selectedCount > maxSelectedEntries || selectedBytes > maxSelectedBytes) {
            throw new Error("The Office file exceeds the extraction complexity limit.");
          }
          zipfile.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail(streamError ?? new Error("An Office document part could not be read."));
              return;
            }
            const chunks = [];
            let actualBytes = 0;
            stream.on("data", (chunk) => {
              actualBytes += chunk.byteLength;
              if (actualBytes > maxEntryBytes) {
                stream.destroy(new Error("An Office document part exceeded the extraction limit."));
                return;
              }
              chunks.push(chunk);
            });
            stream.on("error", fail);
            stream.on("end", () => {
              if (settled) return;
              entries.set(name, Buffer.concat(chunks));
              zipfile.readEntry();
            });
          });
        } catch (error) {
          fail(error);
        }
      });
      zipfile.readEntry();
    });
  });
}

function localName(value) {
  return String(value).split(":").at(-1).toLowerCase();
}

function attribute(node, ...names) {
  const wanted = names.map((name) => name.toLowerCase());
  for (const [name, rawValue] of Object.entries(node.attributes ?? {})) {
    if (!wanted.includes(name.toLowerCase()) && !wanted.includes(localName(name))) continue;
    return typeof rawValue === "object" && rawValue !== null && "value" in rawValue
      ? String(rawValue.value)
      : String(rawValue);
  }
  return "";
}

function parseXml(buffer, handlers) {
  const xml = buffer.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Office XML declarations are not allowed.");
  const parser = sax.parser(true, { trim: false, normalize: false, position: false });
  let failure = null;
  parser.onerror = (error) => { failure = error; };
  parser.onopentag = (node) => handlers.open?.(node);
  parser.ontext = (value) => handlers.text?.(value);
  parser.oncdata = (value) => handlers.text?.(value);
  parser.onclosetag = (name) => handlers.close?.(name);
  try {
    parser.write(xml).close();
  } catch (error) {
    failure = error;
  }
  if (failure) throw new Error("The Office file contains malformed XML.");
}

function cleanText(value) {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractRuns(buffer) {
  const output = [];
  let textDepth = 0;
  parseXml(buffer, {
    open(node) {
      const name = localName(node.name);
      if (name === "t") textDepth += 1;
      if (name === "tab") output.push(" ");
      if (name === "br" || name === "cr") output.push("\n");
    },
    text(value) {
      if (textDepth) output.push(value);
    },
    close(nameValue) {
      const name = localName(nameValue);
      if (name === "t") textDepth = Math.max(0, textDepth - 1);
      if (name === "p" || name === "tr") output.push("\n");
      if (name === "tc") output.push("\t");
    },
  });
  return cleanText(output.join(""));
}

function numericPart(name) {
  return Number.parseInt(/(\d+)\.xml$/.exec(name)?.[1] ?? "0", 10);
}

function parseRelationships(buffer, baseDirectory) {
  const relationships = new Map();
  if (!buffer) return relationships;
  parseXml(buffer, {
    open(node) {
      if (localName(node.name) !== "relationship" || attribute(node, "TargetMode").toLowerCase() === "external") return;
      const id = attribute(node, "Id");
      const target = attribute(node, "Target").replaceAll("\\", "/");
      const unrooted = target.replace(/^\/+/, "");
      const joined = unrooted.toLowerCase().startsWith(`${baseDirectory}/`)
        ? unrooted
        : path.posix.join(baseDirectory, unrooted);
      const normalized = path.posix.normalize(joined).toLowerCase();
      if (id && normalized.startsWith(`${baseDirectory}/`) && !normalized.includes("/../")) {
        relationships.set(id, normalized);
      }
    },
  });
  return relationships;
}

function extractDocx(entries) {
  const ordered = [...entries.keys()]
    .filter((name) => name.startsWith("word/") && name.endsWith(".xml"))
    .sort((first, second) => {
      if (first === "word/document.xml") return -1;
      if (second === "word/document.xml") return 1;
      return first.localeCompare(second, "en", { numeric: true });
    });
  const sections = [];
  for (const name of ordered) {
    const text = extractRuns(entries.get(name));
    if (!text) continue;
    const label = name === "word/document.xml"
      ? "Document"
      : path.posix.basename(name, ".xml").replace(/(\D)(\d+)$/, "$1 $2");
    sections.push(`[${label}]\n${text}`);
  }
  return cleanText(sections.join("\n\n")) || null;
}

function parsePresentationOrder(buffer) {
  const ids = [];
  if (!buffer) return ids;
  parseXml(buffer, {
    open(node) {
      if (localName(node.name) !== "sldid") return;
      const id = attribute(node, "r:id");
      if (id) ids.push(id);
    },
  });
  return ids;
}

function extractPptx(entries) {
  const relationships = parseRelationships(entries.get("ppt/_rels/presentation.xml.rels"), "ppt");
  const requested = parsePresentationOrder(entries.get("ppt/presentation.xml"))
    .map((id) => relationships.get(id))
    .filter((name) => name && entries.has(name));
  const fallback = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((first, second) => numericPart(first) - numericPart(second));
  const slideNames = [...new Set([...requested, ...fallback])];
  const sections = [];
  slideNames.forEach((name, index) => {
    const text = extractRuns(entries.get(name));
    if (text) sections.push(`[Slide ${index + 1}]\n${text}`);
    const notesName = `ppt/notesslides/notesslide${numericPart(name)}.xml`;
    const notes = entries.has(notesName) ? extractRuns(entries.get(notesName)) : "";
    if (notes) sections.push(`[Slide ${index + 1} notes]\n${notes}`);
  });
  return cleanText(sections.join("\n\n")) || null;
}

function parseSharedStrings(buffer) {
  const values = [];
  if (!buffer) return values;
  let inItem = false;
  let textDepth = 0;
  let current = "";
  parseXml(buffer, {
    open(node) {
      const name = localName(node.name);
      if (name === "si") {
        inItem = true;
        current = "";
      }
      if (inItem && name === "t") textDepth += 1;
    },
    text(value) {
      if (inItem && textDepth) current += value;
    },
    close(nameValue) {
      const name = localName(nameValue);
      if (name === "t") textDepth = Math.max(0, textDepth - 1);
      if (name === "si") {
        if (values.length < maxSharedStrings) values.push(cleanText(current));
        inItem = false;
      }
    },
  });
  return values;
}

function parseWorkbookSheets(buffer) {
  const sheets = [];
  if (!buffer) return sheets;
  parseXml(buffer, {
    open(node) {
      if (localName(node.name) !== "sheet") return;
      const id = attribute(node, "r:id");
      if (id) sheets.push({ id, name: cleanText(attribute(node, "name")) || `Sheet ${sheets.length + 1}` });
    },
  });
  return sheets;
}

function extractWorksheet(buffer, sharedStrings, budget) {
  const lines = [];
  let cell = null;
  let valueDepth = 0;
  let formulaDepth = 0;
  let inlineDepth = 0;
  parseXml(buffer, {
    open(node) {
      const name = localName(node.name);
      if (name === "c") cell = { reference: attribute(node, "r"), type: attribute(node, "t"), value: "", formula: "", inline: "" };
      if (!cell) return;
      if (name === "v") valueDepth += 1;
      if (name === "f") formulaDepth += 1;
      if (name === "t") inlineDepth += 1;
    },
    text(value) {
      if (!cell) return;
      if (valueDepth) cell.value += value;
      if (formulaDepth) cell.formula += value;
      if (inlineDepth) cell.inline += value;
    },
    close(nameValue) {
      const name = localName(nameValue);
      if (name === "v") valueDepth = Math.max(0, valueDepth - 1);
      if (name === "f") formulaDepth = Math.max(0, formulaDepth - 1);
      if (name === "t") inlineDepth = Math.max(0, inlineDepth - 1);
      if (name !== "c" || !cell) return;
      let value = cleanText(cell.inline || cell.value);
      if (cell.type === "s") value = sharedStrings[Number.parseInt(cell.value, 10)] ?? value;
      if (cell.type === "b") value = cell.value === "1" ? "TRUE" : "FALSE";
      const formula = cleanText(cell.formula);
      const rendered = formula ? `=${formula}${value ? ` -> ${value}` : ""}` : value;
      if (rendered && budget.remaining > 0) {
        lines.push(`${cell.reference || `cell ${maxCells - budget.remaining + 1}`}: ${rendered}`);
        budget.remaining -= 1;
      }
      cell = null;
    },
  });
  return cleanText(lines.join("\n"));
}

function extractXlsx(entries) {
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedstrings.xml"));
  const relationships = parseRelationships(entries.get("xl/_rels/workbook.xml.rels"), "xl");
  const requested = parseWorkbookSheets(entries.get("xl/workbook.xml"))
    .map((sheet) => ({ name: sheet.name, path: relationships.get(sheet.id) }))
    .filter((sheet) => sheet.path && entries.has(sheet.path));
  const fallback = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((first, second) => numericPart(first) - numericPart(second))
    .map((name, index) => ({ name: `Sheet ${index + 1}`, path: name }));
  const selected = new Map(requested.map((sheet) => [sheet.path, sheet]));
  for (const sheet of fallback) if (!selected.has(sheet.path)) selected.set(sheet.path, sheet);
  const sections = [];
  const budget = { remaining: maxCells };
  for (const sheet of selected.values()) {
    if (budget.remaining <= 0) break;
    const text = extractWorksheet(entries.get(sheet.path), sharedStrings, budget);
    if (text) sections.push(`[Sheet ${sheet.name}]\n${text}`);
  }
  return cleanText(sections.join("\n\n")) || null;
}

export function openXmlExtractor(extension) {
  if (extension === ".docx") return "openxml-word-v1";
  if (extension === ".pptx") return "openxml-powerpoint-v1";
  if (extension === ".xlsx") return "openxml-spreadsheet-v1";
  return null;
}

export async function extractOpenXmlText(buffer, mimeType, extension) {
  const format = formatFor(mimeType, extension);
  if (!format) return null;
  const entries = await collectArchiveEntries(buffer, format);
  const contentTypes = entries.get("[content_types].xml")?.toString("utf8").toLowerCase() ?? "";
  if (!contentTypes.includes(formats[format].contentType)) {
    throw new Error("The Office archive does not match its declared file type.");
  }
  if (format === "docx" && !entries.has("word/document.xml")) throw new Error("The Word document body is missing.");
  if (format === "pptx" && ![...entries.keys()].some((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))) {
    throw new Error("The PowerPoint file contains no readable slides.");
  }
  if (format === "xlsx" && ![...entries.keys()].some((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))) {
    throw new Error("The spreadsheet contains no readable sheets.");
  }
  if (format === "docx") return extractDocx(entries);
  if (format === "pptx") return extractPptx(entries);
  return extractXlsx(entries);
}
