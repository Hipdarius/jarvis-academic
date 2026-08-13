import { dashboardUrl, readWorkerToken, workerApiHeaders } from "../publish.mjs";
import { runRoutedTask } from "./providers.mjs";

async function claimJob() {
  const baseUrl = dashboardUrl();
  const token = await readWorkerToken();
  if (!baseUrl || !token) return { state: "not_configured", job: null };
  const response = await fetch(`${baseUrl}/api/worker/jobs/claim`, {
    method: "POST",
    headers: await workerApiHeaders(token),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Agent job claim failed with HTTP ${response.status}.`);
  return { state: "ready", ...(await response.json()), baseUrl, token };
}

async function finishJob(baseUrl, token, id, result) {
  const response = await fetch(`${baseUrl}/api/worker/jobs/${encodeURIComponent(id)}/result`, {
    method: "POST",
    headers: await workerApiHeaders(token),
    body: JSON.stringify(result),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Agent job result failed with HTTP ${response.status}.`);
  return response.json();
}

function jobSystem(kind) {
  const common = "You are an Academic Jarvis worker agent. Never claim to have changed, uploaded, or submitted anything to a school system. State uncertainty clearly and distinguish verified facts from inference.";
  if (kind === "project_research") return `${common} Produce a concise research brief with key questions, reliable starting points, risks, and concrete next actions.`;
  if (kind === "study_pack") return `${common} Create an evidence-bound study outline, recall prompts, and practice questions. Do not invent syllabus coverage.`;
  if (kind === "review") return `${common} Review the supplied work against the stated constraints and identify specific improvements.`;
  return `${common} Give a practical answer or plan grounded only in the supplied context.`;
}

function jobPrompt(job) {
  const input = job.input && typeof job.input === "object" ? job.input : {};
  return [
    typeof input.instruction === "string" ? input.instruction : "Complete the requested academic task.",
    typeof input.subject === "string" ? `Subject: ${input.subject}` : null,
    typeof input.title === "string" ? `Title: ${input.title}` : null,
    typeof input.prompt === "string" ? `Student request: ${input.prompt}` : `Input: ${JSON.stringify(input)}`,
  ].filter(Boolean).join("\n");
}

export async function runNextAgentJob() {
  const claim = await claimJob();
  if (claim.state === "not_configured" || !claim.job) return { state: claim.state === "not_configured" ? "not_configured" : "idle" };
  const job = claim.job;
  try {
    const routed = await runRoutedTask({
      kind: job.kind,
      system: jobSystem(job.kind),
      prompt: jobPrompt(job),
      maxTokens: 2_400,
      timeoutMs: 180_000,
    });
    await finishJob(claim.baseUrl, claim.token, job.id, {
      status: "succeeded",
      result: routed.text,
      provider: routed.provider,
      model: routed.model,
    });
    return { state: "succeeded", id: job.id, kind: job.kind, provider: routed.provider, model: routed.model };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishJob(claim.baseUrl, claim.token, job.id, { status: "failed", error: message }).catch(() => undefined);
    return { state: "failed", id: job.id, kind: job.kind, error: message };
  }
}

export async function drainAgentJobs(limit = 3) {
  const results = [];
  for (let index = 0; index < Math.max(1, Math.min(10, limit)); index += 1) {
    const result = await runNextAgentJob();
    results.push(result);
    if (result.state === "idle" || result.state === "not_configured") break;
  }
  return results;
}
