#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { createInterface } from "node:readline/promises";

import { repositoryRoot, requireSource, sourceKeys, sources, workerConfig } from "./config.mjs";
import { ensureAuthenticated } from "./authentication.mjs";
import { credentialStatus, loadIamCredentials } from "./credentials.mjs";
import { inspectSession, navigateToSource } from "./inspection.mjs";
import { appendEvent, writeJson } from "./io.mjs";
import { dashboardUrl, readWorkerToken, publishSyncResult } from "./publish.mjs";
import { providerStatus, runRoutedTask } from "./agents/providers.mjs";
import { triageNormalizedItems } from "./agents/triage.mjs";
import { drainAgentJobs } from "./agents/jobs.mjs";
import { syncSource } from "./sources/index.mjs";

function usage() {
  return `Academic Jarvis IAM worker

Usage:
  npm run login -- <webuntis|academy|edumoodle|teams>
  npm run auth -- <source|all> [--headed]
  npm run health -- <source|all>
  npm run sync -- <source|all>
  npm run providers
  npm run doctor
  npm run agent -- <triage|planning|research|review> <prompt>
  npm run jobs
  npm run daemon

The login command opens a dedicated browser for a manual session. For automatic
login, run setup:iam on Windows; the password is protected with your Windows
account's DPAPI key and is never printed or sent to an AI provider.`;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function check(name, ok, detail, required = true) {
  return { name, ok: Boolean(ok), detail, required };
}

function supportedNodeVersion() {
  const [major, minor] = process.versions.node.split(".").map((value) => Number.parseInt(value, 10));
  return major > 22 || (major === 22 && minor >= 13);
}

async function directoryStatus(directory) {
  try {
    await fs.access(directory, fsConstants.W_OK);
    return { ok: true, detail: directory };
  } catch {
    return { ok: false, detail: `${directory} (missing or not writable)` };
  }
}

async function playwrightStatus() {
  try {
    const { chromium } = await import("playwright");
    const executable = chromium.executablePath();
    await fs.access(executable);
    return { ok: true, detail: executable };
  } catch (error) {
    return {
      ok: false,
      detail: `Run the Windows setup or npx playwright install chromium. ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function reachabilityCheck(name, url) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    return check(`${name} reachability`, response.status < 500, `HTTP ${response.status} at ${new URL(response.url).origin}`);
  } catch (error) {
    return check(`${name} reachability`, false, error instanceof Error ? error.message : String(error));
  }
}

function printDoctor(report) {
  console.log("Academic Jarvis doctor\n");
  for (const item of report.report) {
    const marker = item.ok ? "OK" : item.required ? "FAIL" : "WARN";
    console.log(`[${marker}] ${item.name}: ${item.detail}`);
  }
  console.log(`\n${report.ok ? "Ready for worker commands." : "Setup is incomplete. Fix the FAIL items above."}`);
}

async function doctor({ network = true, json = false } = {}) {
  const workerPackage = path.join(repositoryRoot, "apps", "worker", "package.json");
  const dependencyPackage = path.join(repositoryRoot, "apps", "worker", "node_modules", "playwright", "package.json");
  const configFile = process.env.JARVIS_CONFIG_FILE;
  const [credentials, providers, token, playwright, stateDirectory, profileDirectory, schoolFilesDirectory] = await Promise.all([
    credentialStatus().catch((error) => ({
      enabled: false,
      storage: null,
      error: error instanceof Error ? error.message : String(error),
    })),
    providerStatus().catch((error) => ({ error: error instanceof Error ? error.message : String(error) })),
    readWorkerToken().catch(() => null),
    playwrightStatus(),
    directoryStatus(workerConfig.stateDirectory),
    directoryStatus(workerConfig.profileDirectory),
    directoryStatus(workerConfig.schoolFilesDirectory),
  ]);
  const dashboard = (() => {
    try {
      return dashboardUrl();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  })();
  const report = [
    check("repository", await exists(workerPackage), repositoryRoot),
    check("persistent config", Boolean(configFile && await exists(configFile)), configFile || "Run .\\scripts\\setup-windows.ps1.", process.platform === "win32"),
    check("node version", supportedNodeVersion(), `${process.version} (requires 22.13 or newer)`),
    check("worker dependencies", await exists(dependencyPackage), await exists(dependencyPackage) ? "installed" : "Run .\\scripts\\setup-windows.ps1."),
    check("Playwright Chromium", playwright.ok, playwright.detail),
    check("dashboard url", Boolean(dashboard && !String(dashboard).includes("must use HTTPS")), dashboard ?? "Set JARVIS_DASHBOARD_URL."),
    check("worker token", Boolean(token), token ? "configured" : "Set JARVIS_WORKER_TOKEN_FILE or JARVIS_WORKER_TOKEN."),
    check("password login opt-in", process.env.JARVIS_ALLOW_PASSWORD_LOGIN === "true", "Run setup or set JARVIS_ALLOW_PASSWORD_LOGIN=true."),
    check("iam credentials", credentials.enabled, credentials.error ?? (credentials.storage ? `configured via ${credentials.storage}` : "Run .\\scripts\\jarvis.ps1 credentials.")),
    check("state directory", stateDirectory.ok, stateDirectory.detail),
    check("browser profile", profileDirectory.ok, profileDirectory.detail),
    check("school files", schoolFilesDirectory.ok, schoolFilesDirectory.detail),
    check("ai providers", Array.isArray(providers) && providers.some((provider) => provider.configured), Array.isArray(providers) ? providers.map((provider) => `${provider.id}:${provider.configured ? provider.model : "off"}`).join(", ") : providers.error, false),
  ];

  if (network) {
    const probes = await Promise.all([
      dashboard ? reachabilityCheck("dashboard", dashboard) : Promise.resolve(check("dashboard reachability", false, "Dashboard URL is not configured.")),
      ...sourceKeys.map((key) => reachabilityCheck(sources[key].label, sources[key].url)),
    ]);
    report.push(...probes);
  }

  const result = { ok: report.every((item) => !item.required || item.ok), report };
  if (json) console.log(JSON.stringify(result, null, 2));
  else printDoctor(result);
  if (!result.ok) process.exitCode = 2;
}

function targets(value = "all") {
  if (value === "all") return sourceKeys.map((key) => sources[key]);
  return [requireSource(value)];
}

async function withBrowser(headless, callback) {
  const { launchJarvisBrowser } = await import("./browser.mjs");
  const context = await launchJarvisBrowser({ headless });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    return await callback(page);
  } finally {
    await context.close();
  }
}

async function login(key) {
  if (!process.stdin.isTTY) throw new Error("Interactive login needs a local terminal and visible desktop.");
  const source = requireSource(key);

  const result = await withBrowser(false, async (page) => {
    await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    console.log(`\nOpened ${source.label}. Complete IAM sign-in in the browser.`);
    console.log("Do not type your password in this terminal or share it with Jarvis.");

    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    await prompt.question("Press Enter after the school page is fully open… ");
    prompt.close();
    return inspectSession(page, source);
  });

  await writeJson(path.join(workerConfig.stateDirectory, "health", `${source.key}.json`), result);
  console.log(JSON.stringify(result, null, 2));
  if (result.requiresUserAction) process.exitCode = 2;
}

async function checkHealth(source) {
  const credentials = await loadIamCredentials();
  const result = await withBrowser(true, (page) => credentials
    ? ensureAuthenticated(page, source, credentials)
    : navigateToSource(page, source));
  await writeJson(path.join(workerConfig.stateDirectory, "health", `${source.key}.json`), result);
  return result;
}

async function authenticate(target, { headless = true } = {}) {
  const credentials = await loadIamCredentials();
  if (!credentials) {
    throw new Error("Password login is not configured. Run npm run setup:iam on Windows or mount the NAS IAM secret file.");
  }
  for (const source of targets(target)) {
    const result = await withBrowser(headless, (page) => ensureAuthenticated(page, source, credentials));
    await writeJson(path.join(workerConfig.stateDirectory, "health", `${source.key}.json`), result);
    console.log(JSON.stringify(result, null, 2));
  }
}

async function health(target) {
  for (const source of targets(target)) {
    const result = await checkHealth(source);
    console.log(JSON.stringify(result, null, 2));
  }
}

async function synchronize(source) {
  const startedAt = new Date().toISOString();
  try {
    const credentials = await loadIamCredentials();
    const result = await withBrowser(true, async (page) => {
      if (credentials) {
        const health = await ensureAuthenticated(page, source, credentials);
        if (health.requiresUserAction) return { source: source.key, health, items: [] };
      }
      return syncSource(page, source);
    });
    await writeJson(path.join(workerConfig.stateDirectory, "sync", source.key, "latest.json"), result);
    const publication = await publishSyncResult(source, result, startedAt).catch((error) => ({
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    let triage = null;
    if (process.env.JARVIS_AGENT_AUTO_TRIAGE === "true" && Array.isArray(result.items) && result.items.length) {
      triage = await triageNormalizedItems(source, result.items).catch((error) => ({
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
    await appendEvent(path.join(workerConfig.stateDirectory, "events.jsonl"), {
      type: "sync_completed",
      source: source.key,
      startedAt,
      finishedAt: new Date().toISOString(),
      state: result.health?.state ?? "unknown",
      publication: publication.state,
      triage: triage ? (triage.state ?? "completed") : "skipped",
    });
    return result;
  } catch (error) {
    const failure = {
      source: source.key,
      state: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
    await appendEvent(path.join(workerConfig.stateDirectory, "events.jsonl"), { type: "sync_failed", ...failure });
    return failure;
  }
}

async function runAgent(kind, promptParts) {
  const prompt = promptParts.join(" ").trim();
  if (!prompt) throw new Error("Provide a task prompt after the agent kind.");
  const result = await runRoutedTask({
    kind,
    system: "You are an Academic Jarvis agent. Work only from the supplied information, state uncertainties, and never claim to have changed a school system. Uploads, submissions, messages, and destructive actions always require explicit user approval.",
    prompt,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function sync(target, quiet = false) {
  const results = [];
  for (const source of targets(target)) {
    const result = await synchronize(source);
    results.push(result);
    if (!quiet) console.log(JSON.stringify(result, null, 2));
  }
  return results;
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function daemon() {
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });

  const credentials = await credentialStatus();
  console.log(`Jarvis worker started; checking ${sourceKeys.length} sources every ${workerConfig.syncIntervalMinutes} minutes.`);
  console.log(`Agent queue polling: every ${workerConfig.agentPollSeconds} seconds.`);
  console.log(`Automatic IAM login: ${credentials.enabled ? `enabled (${credentials.storage})` : "disabled"}.`);
  while (!stopping) {
    const cycleStartedAt = new Date().toISOString();
    const results = await sync("all", true);
    const agentJobs = await drainAgentJobs(3).catch((error) => [{
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    }]);
    await writeJson(path.join(workerConfig.stateDirectory, "heartbeat.json"), {
      state: "running",
      cycleStartedAt,
      cycleFinishedAt: new Date().toISOString(),
      nextCheckMinutes: workerConfig.syncIntervalMinutes,
      sources: results.map((result) => ({ source: result.source, state: result.health?.state ?? result.state })),
      agentJobs,
    });

    const waitUntil = Date.now() + workerConfig.syncIntervalMinutes * 60_000;
    let nextAgentPoll = Date.now() + workerConfig.agentPollSeconds * 1_000;
    while (!stopping && Date.now() < waitUntil) {
      if (Date.now() >= nextAgentPoll) {
        await drainAgentJobs(3).catch(() => undefined);
        nextAgentPoll = Date.now() + workerConfig.agentPollSeconds * 1_000;
      }
      await pause(Math.min(5_000, waitUntil - Date.now()));
    }
  }
  console.log("Jarvis worker stopped cleanly.");
}

const rawArguments = process.argv.slice(2);
const command = rawArguments.shift();
const flags = new Set(rawArguments.filter((value) => value.startsWith("--")));
const [target, ...rest] = rawArguments.filter((value) => !value.startsWith("--"));

try {
  if (command === "login") await login(target);
  else if (command === "auth") await authenticate(target || "all", { headless: !flags.has("--headed") });
  else if (command === "health") await health(target || "all");
  else if (command === "sync") await sync(target || "all");
  else if (command === "providers") console.log(JSON.stringify(await providerStatus(), null, 2));
  else if (command === "doctor") await doctor({ network: !flags.has("--offline"), json: flags.has("--json") });
  else if (command === "agent") await runAgent(target || "planning", rest);
  else if (command === "jobs") console.log(JSON.stringify(await drainAgentJobs(10), null, 2));
  else if (command === "daemon") await daemon();
  else {
    console.log(usage());
    if (command) process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
