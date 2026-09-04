import { NextResponse } from "next/server";

import { authenticateWorker } from "@/app/lib/worker-auth";
import { finishSyncRequest } from "@/db/store";

export const runtime = "edge";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await authenticateWorker(request)) return NextResponse.json({ error: "Worker authentication failed." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { leaseId?: unknown; status?: unknown; result?: unknown; error?: unknown } | null;
  if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id) || !body || typeof body.leaseId !== "string" || body.leaseId.length > 200 || !["succeeded", "failed"].includes(String(body.status))) {
    return NextResponse.json({ error: "Invalid sync result." }, { status: 400 });
  }
  const result = await finishSyncRequest(id, body.leaseId, {
    status: body.status as "succeeded" | "failed",
    result: body.result,
    error: typeof body.error === "string" ? body.error : null,
  });
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Sync request lease expired." }, { status: 409 });
}
