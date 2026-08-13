import path from "node:path";

import { workerConfig } from "../config.mjs";
import { writeJson } from "../io.mjs";
import { runRoutedTask } from "./providers.mjs";

export async function triageNormalizedItems(source, items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const sanitized = items.slice(0, 80).map((item) => ({
    type: item.type,
    title: item.title,
    description: item.description,
    subject: item.subject,
    startsAt: item.startsAt,
    dueAt: item.dueAt,
    evidence: item.evidence,
    confidence: item.confidence,
  }));
  const result = await runRoutedTask({
    kind: "triage",
    system: "You are the read-only triage agent for a student's academic system. Identify urgency, missing information, likely dependencies, and the safest next action. Never invent a deadline and never claim an upload or submission happened.",
    prompt: `Source: ${source.label}\nNew normalized items:\n${JSON.stringify(sanitized)}`,
    maxTokens: 1_200,
  });
  const record = { source: source.key, createdAt: new Date().toISOString(), ...result };
  await writeJson(path.join(workerConfig.stateDirectory, "agents", `triage-${source.key}-latest.json`), record);
  return record;
}
