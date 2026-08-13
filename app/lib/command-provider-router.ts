import {
  commandActions,
  isCommandAction,
  type CommandIntent,
} from "@/packages/core/src/command-router";

type ProviderId = Exclude<CommandIntent["provider"], "local">;

type Provider = {
  id: ProviderId;
  kind: "responses" | "chat" | "anthropic";
  baseUrl: string;
  apiKey: string;
  model: string;
};

const routerInstruction = `Route a student's natural-language command into exactly one Academic Jarvis action.
Infer subjects from context, preserve exercise numbers and constraints, and never claim an upload or submission happened.
Use create_project_canvas for hypothetical ideas and brainstorms; create_homework for assigned work; create_study_session for revision blocks; create_knowledge_note for facts to retain; otherwise ask_jarvis.
Return only JSON with these fields: action, title, subject, dueLabel, canvasTitle, response, confidence. Nullable fields must be null.`;

const intentSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: commandActions },
    title: { type: "string" },
    subject: { anyOf: [{ type: "string" }, { type: "null" }] },
    dueLabel: { anyOf: [{ type: "string" }, { type: "null" }] },
    canvasTitle: { anyOf: [{ type: "string" }, { type: "null" }] },
    response: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["action", "title", "subject", "dueLabel", "canvasTitle", "response", "confidence"],
  additionalProperties: false,
} as const;

function providers(): Partial<Record<ProviderId, Provider>> {
  const configured: Partial<Record<ProviderId, Provider>> = {};
  if (process.env.OPENAI_API_KEY) {
    configured.openai = {
      id: "openai",
      kind: "responses",
      baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.JARVIS_COMMAND_MODEL || "gpt-5.6-luna",
    };
  }
  if (process.env.JARVIS_HERMES_BASE_URL && process.env.JARVIS_HERMES_API_KEY) {
    configured.hermes = {
      id: "hermes",
      kind: "chat",
      baseUrl: process.env.JARVIS_HERMES_BASE_URL.replace(/\/$/, ""),
      apiKey: process.env.JARVIS_HERMES_API_KEY,
      model: process.env.JARVIS_HERMES_MODEL || "hermes-agent",
    };
  }
  if (process.env.NOUS_API_KEY && process.env.NOUS_MODEL) {
    configured.nous = {
      id: "nous",
      kind: "chat",
      baseUrl: (process.env.NOUS_BASE_URL || "https://inference-api.nousresearch.com/v1").replace(/\/$/, ""),
      apiKey: process.env.NOUS_API_KEY,
      model: process.env.NOUS_MODEL,
    };
  }
  if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL) {
    configured.openrouter = {
      id: "openrouter",
      kind: "chat",
      baseUrl: (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL,
    };
  }
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MODEL) {
    configured.anthropic = {
      id: "anthropic",
      kind: "anthropic",
      baseUrl: (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1").replace(/\/$/, ""),
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL,
    };
  }
  return configured;
}

function providerRoute() {
  const allowed: ProviderId[] = ["openai", "hermes", "nous", "openrouter", "anthropic"];
  return (process.env.JARVIS_COMMAND_ROUTE || "openai,nous,openrouter,anthropic,hermes")
    .split(",")
    .map((value) => value.trim() as ProviderId)
    .filter((value) => allowed.includes(value));
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as { content?: unknown };
    const content = Array.isArray(candidate.content) ? candidate.content : [];
    for (const block of content) {
      if (block && typeof block === "object" && "text" in block && typeof block.text === "string") return block.text;
    }
  }
  return null;
}

function jsonFromText(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("No JSON object returned");
  return JSON.parse(cleaned.slice(first, last + 1)) as unknown;
}

function validated(value: unknown, fallback: CommandIntent, provider: ProviderId): CommandIntent | null {
  if (!value || typeof value !== "object") return null;
  const intent = value as Partial<CommandIntent>;
  if (!isCommandAction(intent.action) || typeof intent.title !== "string" || typeof intent.response !== "string") return null;
  return {
    action: intent.action,
    title: intent.title.trim() || fallback.title,
    subject: typeof intent.subject === "string" ? intent.subject : fallback.subject,
    dueLabel: typeof intent.dueLabel === "string" ? intent.dueLabel : fallback.dueLabel,
    canvasTitle: typeof intent.canvasTitle === "string" ? intent.canvasTitle : fallback.canvasTitle,
    response: intent.response,
    confidence: typeof intent.confidence === "number" ? Math.min(1, Math.max(0, intent.confidence)) : fallback.confidence,
    provider,
  };
}

async function callResponses(provider: Provider, text: string) {
  const response = await fetch(`${provider.baseUrl}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: provider.model,
      store: false,
      reasoning: { effort: "low" },
      input: [
        { role: "developer", content: [{ type: "input_text", text: routerInstruction }] },
        { role: "user", content: [{ type: "input_text", text }] },
      ],
      text: { format: { type: "json_schema", name: "academic_command", strict: true, schema: intentSchema } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json() as Record<string, unknown>;
  const result = outputText(payload);
  if (!result) throw new Error("No output text");
  return result;
}

async function callChat(provider: Provider, text: string) {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
      ...(provider.id === "openrouter" ? { "X-Title": "Academic Jarvis" } : {}),
    },
    body: JSON.stringify({
      model: provider.model,
      stream: false,
      max_tokens: 900,
      messages: [
        { role: "system", content: routerInstruction },
        { role: "user", content: text },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const result = payload.choices?.[0]?.message?.content;
  if (typeof result !== "string") throw new Error("No output text");
  return result;
}

async function callAnthropic(provider: Provider, text: string) {
  const response = await fetch(`${provider.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      system: routerInstruction,
      messages: [{ role: "user", content: text }],
      max_tokens: 900,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json() as { content?: Array<{ type?: string; text?: unknown }> };
  const result = payload.content?.find((block) => block.type === "text")?.text;
  if (typeof result !== "string") throw new Error("No output text");
  return result;
}

export async function interpretWithProviders(text: string, fallback: CommandIntent) {
  const configured = providers();
  for (const id of providerRoute()) {
    const provider = configured[id];
    if (!provider) continue;
    try {
      const output = provider.kind === "responses"
        ? await callResponses(provider, text)
        : provider.kind === "anthropic"
          ? await callAnthropic(provider, text)
          : await callChat(provider, text);
      const intent = validated(jsonFromText(output), fallback, provider.id);
      if (intent) return intent;
    } catch {
      continue;
    }
  }
  return null;
}
