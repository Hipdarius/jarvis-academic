import { NextResponse } from "next/server";

import { ingestWorkerSync, type WorkerSyncPayload } from "@/db/store";
import { authenticateWorker } from "@/app/lib/worker-auth";
import { isWorkerSyncPayload } from "@/packages/core/src/worker-payload";

export const runtime = "edge";

const maxPayloadBytes = 1_500_000;

export async function POST(request: Request) {
  if (!await authenticateWorker(request)) {
    return NextResponse.json({ error: "Worker authentication failed." }, { status: 401 });
  }

  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (declaredSize > maxPayloadBytes) {
    return NextResponse.json({ error: "Sync payload is too large." }, { status: 413 });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maxPayloadBytes) {
    return NextResponse.json({ error: "Sync payload is too large." }, { status: 413 });
  }
  let body: WorkerSyncPayload | null = null;
  try {
    body = JSON.parse(rawBody) as WorkerSyncPayload;
  } catch {
    body = null;
  }
  if (!isWorkerSyncPayload(body)) {
    return NextResponse.json({ error: "Invalid worker sync payload." }, { status: 400 });
  }

  const result = await ingestWorkerSync(body);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
