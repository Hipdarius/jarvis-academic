import { NextResponse } from "next/server";

import { authenticateWorker } from "@/app/lib/worker-auth";
import { finishAgentJob } from "@/db/store";

export const runtime = "edge";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await authenticateWorker(request)) {
    return NextResponse.json({ error: "Worker authentication failed." }, { status: 401 });
  }
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid job identifier." }, { status: 400 });
  }
  const body = await request.json().catch(() => null) as {
    status?: unknown;
    result?: unknown;
    error?: unknown;
    provider?: unknown;
    model?: unknown;
    usage?: unknown;
    durationMs?: unknown;
  } | null;
  const allowed = new Set(["succeeded", "failed", "needs_approval"]);
  if (!body || typeof body.status !== "string" || !allowed.has(body.status)) {
    return NextResponse.json({ error: "Invalid job result." }, { status: 400 });
  }
  const result = await finishAgentJob(id, {
    status: body.status as "succeeded" | "failed" | "needs_approval",
    result: typeof body.result === "string" ? body.result : null,
    error: typeof body.error === "string" ? body.error : null,
    provider: typeof body.provider === "string" ? body.provider : null,
    model: typeof body.model === "string" ? body.model : null,
    usage: body.usage && typeof body.usage === "object" && !Array.isArray(body.usage)
      ? body.usage as Record<string, unknown>
      : null,
    durationMs: typeof body.durationMs === "number" && Number.isFinite(body.durationMs) ? body.durationMs : null,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
