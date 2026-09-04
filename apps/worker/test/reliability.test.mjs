import assert from "node:assert/strict";
import test from "node:test";

import { isQuietHours } from "../src/notifications.mjs";
import { providerStatus } from "../src/agents/providers.mjs";

test("defers ordinary notifications from 22:00 until 07:00 Luxembourg time", () => {
  assert.equal(isQuietHours(new Date("2026-09-04T20:30:00Z")), true);
  assert.equal(isQuietHours(new Date("2026-09-05T04:59:00Z")), true);
  assert.equal(isQuietHours(new Date("2026-09-05T05:00:00Z")), false);
});

test("reports Hermes reachability without exposing its endpoint or key", async () => {
  const original = {
    baseUrl: process.env.JARVIS_HERMES_BASE_URL,
    apiKey: process.env.JARVIS_HERMES_API_KEY,
    model: process.env.JARVIS_HERMES_MODEL,
    fetch: globalThis.fetch,
  };
  process.env.JARVIS_HERMES_BASE_URL = "http://127.0.0.1:8642/v1";
  process.env.JARVIS_HERMES_API_KEY = "private-test-key";
  process.env.JARVIS_HERMES_MODEL = "hermes-test";
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  try {
    const statuses = await providerStatus({ checkHermes: true });
    const hermes = statuses.find((provider) => provider.id === "hermes");
    assert.equal(hermes.health, "healthy");
    assert.equal(JSON.stringify(hermes).includes("private-test-key"), false);
    assert.equal(JSON.stringify(hermes).includes("127.0.0.1"), false);
  } finally {
    if (original.baseUrl === undefined) delete process.env.JARVIS_HERMES_BASE_URL;
    else process.env.JARVIS_HERMES_BASE_URL = original.baseUrl;
    if (original.apiKey === undefined) delete process.env.JARVIS_HERMES_API_KEY;
    else process.env.JARVIS_HERMES_API_KEY = original.apiKey;
    if (original.model === undefined) delete process.env.JARVIS_HERMES_MODEL;
    else process.env.JARVIS_HERMES_MODEL = original.model;
    globalThis.fetch = original.fetch;
  }
});
