const monthNumbers = new Map([
  ["january", 1], ["janvier", 1], ["januar", 1],
  ["february", 2], ["februar", 2], ["fevrier", 2],
  ["march", 3], ["mars", 3], ["marz", 3],
  ["april", 4], ["avril", 4],
  ["may", 5], ["mai", 5],
  ["june", 6], ["juin", 6], ["juni", 6],
  ["july", 7], ["juillet", 7], ["juli", 7],
  ["august", 8], ["aout", 8],
  ["september", 9], ["septembre", 9],
  ["october", 10], ["octobre", 10], ["oktober", 10],
  ["november", 11], ["novembre", 11],
  ["december", 12], ["decembre", 12], ["dezember", 12],
]);

function asciiWords(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function validParts({ year, month, day, hour, minute }) {
  if (year < 2020 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function partsInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

export function zonedDateTimeToUtc(parts, timeZone = "Europe/Luxembourg") {
  if (!validParts(parts)) return null;
  const intended = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  let guess = intended;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = partsInZone(new Date(guess), timeZone);
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const correction = intended - represented;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess);
}

function numericMatches(text, reference) {
  const matches = [...text.matchAll(/\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2}|\d{4}))?(?:\s+(?:(?:at|um|a)\s*)?(\d{1,2})[:h](\d{2}))?\b/gi)];
  return matches.map((match) => {
    const hasYear = match[3] !== undefined;
    let year = hasYear ? Number(match[3]) : reference.getUTCFullYear();
    if (year < 100) year += 2000;
    return {
      day: Number(match[1]),
      month: Number(match[2]),
      year,
      hour: match[4] === undefined ? 0 : Number(match[4]),
      minute: match[5] === undefined ? 0 : Number(match[5]),
      precision: match[4] === undefined ? "date" : hasYear ? "datetime" : "partial_datetime",
      label: match[0].trim(),
      index: match.index ?? 0,
    };
  });
}

function namedMatches(text) {
  const normalized = asciiWords(text);
  const monthPattern = [...monthNumbers.keys()].sort((a, b) => b.length - a.length).join("|");
  const expression = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[,.\\s]+(${monthPattern})[,.\\s]+(20\\d{2})(?:[,.\\s]+(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?)?`, "gi");
  return [...normalized.matchAll(expression)].map((match) => {
    let hour = match[4] === undefined ? 0 : Number(match[4]);
    const meridiem = match[6]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return {
      day: Number(match[1]),
      month: monthNumbers.get(match[2].toLowerCase()),
      year: Number(match[3]),
      hour,
      minute: match[5] === undefined ? 0 : Number(match[5]),
      precision: match[4] === undefined ? "date" : "datetime",
      label: match[0].trim(),
      index: match.index ?? 0,
    };
  });
}

export function parseSourceDates(text, {
  reference = new Date(),
  timeZone = "Europe/Luxembourg",
} = {}) {
  return [...numericMatches(String(text ?? ""), reference), ...namedMatches(String(text ?? ""))]
    .filter((parts) => validParts(parts))
    .sort((first, second) => first.index - second.index)
    .map((parts) => ({
      label: parts.label,
      precision: parts.precision,
      iso: parts.precision === "datetime" ? zonedDateTimeToUtc(parts, timeZone)?.toISOString() ?? null : null,
    }));
}

export function parseSourceDate(text, options) {
  return parseSourceDates(text, options).at(-1) ?? null;
}
