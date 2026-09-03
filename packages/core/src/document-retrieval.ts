export type RetrievalDocument = {
  id: string;
  kind: "document" | "upload";
  title: string;
  subject: string;
  source: string;
  text: string;
};

export type RankedDocumentEvidence = Omit<RetrievalDocument, "text"> & {
  excerpt: string;
  locator: string;
  score: number;
};

const stopWords = new Set([
  "about", "after", "again", "also", "and", "are", "but", "can", "could", "does", "for", "from",
  "have", "how", "into", "its", "mein", "mit", "oder", "pour", "que", "qui", "the", "this", "und",
  "was", "what", "when", "where", "which", "with", "would", "you", "your",
]);

function searchable(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u00c0-\u024f]+/g, " ");
}

function tokens(value: string) {
  return [...new Set(searchable(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stopWords.has(token)))];
}

function compact(value: string) {
  return value.replace(/\r/g, "").replace(/[\t\f\v ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function boundedChunks(value: string, locator: string, maximum = 1_400) {
  const paragraphs = compact(value).split(/\n\s*\n/).filter(Boolean);
  const chunks: Array<{ text: string; locator: string }> = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maximum) {
      chunks.push({ text: current, locator });
      const overlap = current.split(/\s+/).slice(-28).join(" ");
      current = overlap && overlap.length + paragraph.length + 1 <= maximum ? `${overlap} ${paragraph}` : paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
    while (current.length > maximum) {
      let splitAt = current.lastIndexOf(" ", maximum);
      if (splitAt < maximum * 0.6) splitAt = maximum;
      chunks.push({ text: current.slice(0, splitAt).trim(), locator });
      current = current.slice(Math.max(0, splitAt - 180)).trim();
    }
  }
  if (current) chunks.push({ text: current, locator });
  return chunks;
}

function documentChunks(text: string) {
  const pagePattern = /^\[Page (\d+)\]\s*$/gim;
  const matches = [...text.matchAll(pagePattern)];
  if (!matches.length) return boundedChunks(text, "document");
  const chunks: Array<{ text: string; locator: string }> = [];
  for (let index = 0; index < matches.length; index += 1) {
    const start = (matches[index].index ?? 0) + matches[index][0].length;
    const end = matches[index + 1]?.index ?? text.length;
    chunks.push(...boundedChunks(text.slice(start, end), `page ${matches[index][1]}`));
  }
  return chunks;
}

function occurrenceScore(value: string, queryTokens: string[]) {
  const lower = searchable(value);
  return queryTokens.reduce((score, token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return score + Math.min(4, (lower.match(new RegExp(`\\b${escaped}`, "g")) ?? []).length);
  }, 0);
}

export function rankDocumentEvidence(query: string, documents: RetrievalDocument[], limit = 12): RankedDocumentEvidence[] {
  const queryTokens = tokens(query);
  const ranked: Array<RankedDocumentEvidence & { order: number }> = [];
  documents.forEach((document, order) => {
    documentChunks(document.text).forEach((chunk) => {
      const score = queryTokens.length
        ? occurrenceScore(document.title, queryTokens) * 8
          + occurrenceScore(document.subject, queryTokens) * 6
          + occurrenceScore(chunk.text, queryTokens) * 2
        : 1;
      if (score > 0) ranked.push({
        id: document.id,
        kind: document.kind,
        title: document.title,
        subject: document.subject,
        source: document.source,
        excerpt: chunk.text.slice(0, 1_400),
        locator: chunk.locator,
        score,
        order,
      });
    });
  });
  if (!ranked.length && queryTokens.length && documents.length) {
    return rankDocumentEvidence("", documents, limit).map((entry) => ({ ...entry, score: 0 }));
  }
  ranked.sort((first, second) => second.score - first.score || first.order - second.order);
  const perDocument = new Map<string, number>();
  return ranked.filter((entry) => {
    const count = perDocument.get(entry.id) ?? 0;
    if (count >= 2) return false;
    perDocument.set(entry.id, count + 1);
    return true;
  }).slice(0, Math.max(1, Math.min(24, limit))).map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    subject: entry.subject,
    source: entry.source,
    excerpt: entry.excerpt,
    locator: entry.locator,
    score: entry.score,
  }));
}
