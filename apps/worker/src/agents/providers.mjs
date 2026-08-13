import fs from "node:fs/promises";

const providerNames = ["hermes", "openai", "nous", "openrouter", "anthropic"];

async function secret(name) {
  const file = process.env[`${name}_FILE`];
  if (file) return (await fs.readFile(file, "utf8")).replace(/\r?\n$/, "");
  return process.env[name]?.trim() || null;
}

function normalizeBaseUrl(value, fallback) {
  const parsed = new URL(value || fallback);
  const local = ["localhost", "127.0.0.1", "hermes"].includes(parsed.hostname) || parsed.hostname.endsWith(".local");
  if (parsed.protocol !== "https:" && !local) throw new Error(`Provider URL ${parsed.origin} must use HTTPS.`);
  return parsed.href.replace(/\/$/, "");
}

async function configuredProviders() {
  return {
    hermes: {
      id: "hermes",
      kind: "openai-chat",
      baseUrl: process.env.JARVIS_HERMES_BASE_URL ? normalizeBaseUrl(process.env.JARVIS_HERMES_BASE_URL) : null,
      apiKey: await secret("JARVIS_HERMES_API_KEY"),
      model: process.env.JARVIS_HERMES_MODEL || "hermes-agent",
    },
    openai: {
      id: "openai",
      kind: "openai-chat",
      baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL, "https://api.openai.com/v1"),
      apiKey: await secret("OPENAI_API_KEY"),
      model: process.env.JARVIS_OPENAI_AGENT_MODEL || "gpt-5.6-luna",
    },
    nous: {
      id: "nous",
      kind: "openai-chat",
      baseUrl: normalizeBaseUrl(process.env.NOUS_BASE_URL, "https://inference-api.nousresearch.com/v1"),
      apiKey: await secret("NOUS_API_KEY"),
      model: process.env.NOUS_MODEL || null,
    },
    openrouter: {
      id: "openrouter",
      kind: "openai-chat",
      baseUrl: normalizeBaseUrl(process.env.OPENROUTER_BASE_URL, "https://openrouter.ai/api/v1"),
      apiKey: await secret("OPENROUTER_API_KEY"),
      model: process.env.OPENROUTER_MODEL || null,
    },
    anthropic: {
      id: "anthropic",
      kind: "anthropic",
      baseUrl: normalizeBaseUrl(process.env.ANTHROPIC_BASE_URL, "https://api.anthropic.com/v1"),
      apiKey: await secret("ANTHROPIC_API_KEY"),
      model: process.env.ANTHROPIC_MODEL || null,
    },
  };
}

function routeFor(kind) {
  const key = `JARVIS_AGENT_ROUTE_${kind.toUpperCase().replaceAll("-", "_")}`;
  const defaults = kind === "triage"
    ? "nous,openrouter,openai,hermes"
    : kind === "review"
      ? "anthropic,openai,hermes,openrouter"
      : "openai,anthropic,hermes,openrouter,nous";
  return (process.env[key] || defaults).split(",").map((value) => value.trim()).filter((value) => providerNames.includes(value));
}

async function callOpenAIChat(provider, request) {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
      ...(provider.id === "openrouter" ? { "X-Title": "Academic Jarvis" } : {}),
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.prompt },
      ],
      stream: false,
      max_tokens: request.maxTokens,
    }),
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  if (!response.ok) throw new Error(`${provider.id} returned HTTP ${response.status}`);
  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error(`${provider.id} returned no text`);
  return { text, usage: payload.usage ?? null };
}

async function callAnthropic(provider, request) {
  const response = await fetch(`${provider.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      system: request.system,
      messages: [{ role: "user", content: request.prompt }],
      max_tokens: request.maxTokens,
    }),
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  if (!response.ok) throw new Error(`anthropic returned HTTP ${response.status}`);
  const payload = await response.json();
  const text = payload.content?.find((block) => block.type === "text")?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("anthropic returned no text");
  return { text, usage: payload.usage ?? null };
}

export async function providerStatus() {
  const providers = await configuredProviders();
  return providerNames.map((id) => ({
    id,
    configured: Boolean(providers[id].baseUrl && providers[id].apiKey && providers[id].model),
    model: providers[id].model,
  }));
}

export async function runRoutedTask({ kind, system, prompt, maxTokens = 1_500, timeoutMs = 120_000 }) {
  const providers = await configuredProviders();
  const failures = [];
  for (const id of routeFor(kind)) {
    const provider = providers[id];
    if (!provider?.baseUrl || !provider.apiKey || !provider.model) continue;
    const started = Date.now();
    try {
      const result = provider.kind === "anthropic"
        ? await callAnthropic(provider, { system, prompt, maxTokens, timeoutMs })
        : await callOpenAIChat(provider, { system, prompt, maxTokens, timeoutMs });
      return {
        ...result,
        provider: provider.id,
        model: provider.model,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      failures.push({ provider: id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  throw new Error(`No configured provider completed ${kind}: ${failures.map((failure) => `${failure.provider}: ${failure.error}`).join("; ") || "no route providers configured"}`);
}
