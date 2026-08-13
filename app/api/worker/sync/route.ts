import { NextResponse } from "next/server";

import { ingestWorkerSync, type WorkerSyncPayload } from "@/db/store";
import { authenticateWorker } from "@/app/lib/worker-auth";

export const runtime = "edge";

const allowedSources = new Set(["webuntis", "academy", "edumoodle", "teams"]);

export async function POST(request: Request) {
  if (!await authenticateWorker(request)) {
    return NextResponse.json({ error: "Worker authentication failed." }, { status: 401 });
  }

  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (declaredSize > 1_500_000) {
    return NextResponse.json({ error: "Sync payload is too large." }, { status: 413 });
  }

  const body = await request.json().catch(() => null) as WorkerSyncPayload | null;
  if (!body || !allowedSources.has(body.source) || !body.health || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "Invalid worker sync payload." }, { status: 400 });
  }

  const result = await ingestWorkerSync(body);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
