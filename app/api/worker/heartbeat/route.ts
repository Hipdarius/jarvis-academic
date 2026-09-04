import { NextResponse } from "next/server";

import { authenticateWorker } from "@/app/lib/worker-auth";
import { recordWorkerHeartbeat } from "@/db/store";

export const runtime = "edge";

const states = new Set(["starting", "running", "degraded", "stopping"]);

function optionalDate(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

export async function POST(request: Request) {
  if (!await authenticateWorker(request)) return NextResponse.json({ error: "Worker authentication failed." }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.state !== "string" || !states.has(body.state) || typeof body.version !== "string" || !body.version.trim()
    || !optionalDate(body.cycleStartedAt) || !optionalDate(body.cycleFinishedAt) || !optionalDate(body.nextSyncAt)) {
    return NextResponse.json({ error: "Invalid worker heartbeat." }, { status: 400 });
  }
  const result = await recordWorkerHeartbeat({
    state: body.state as "starting" | "running" | "degraded" | "stopping",
    version: body.version,
    cycleStartedAt: body.cycleStartedAt as string | null | undefined,
    cycleFinishedAt: body.cycleFinishedAt as string | null | undefined,
    nextSyncAt: body.nextSyncAt as string | null | undefined,
    lastError: typeof body.lastError === "string" ? body.lastError : null,
    providers: Array.isArray(body.providers) ? body.providers : [],
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
