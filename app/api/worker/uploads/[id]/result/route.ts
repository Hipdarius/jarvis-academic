import { NextResponse } from "next/server";

import { authenticateWorker } from "@/app/lib/worker-auth";
import { finishStagedUpload } from "@/db/store";

export const runtime = "edge";

const maxPayloadBytes = 500_000;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await authenticateWorker(request)) {
    return NextResponse.json({ error: "Worker authentication failed." }, { status: 401 });
  }
  const { id } = await context.params;
  if (!/^upload:[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid upload identifier." }, { status: 400 });
  }
  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (declaredSize > maxPayloadBytes) return NextResponse.json({ error: "Upload result is too large." }, { status: 413 });
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maxPayloadBytes) {
    return NextResponse.json({ error: "Upload result is too large." }, { status: 413 });
  }
  const body = (() => {
    try {
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  const allowedStatuses = new Set(["indexed", "stored", "failed"]);
  if (!body
    || typeof body.leaseId !== "string"
    || !/^[0-9a-f-]{36}$/i.test(body.leaseId)
    || typeof body.status !== "string"
    || !allowedStatuses.has(body.status)
    || (body.status === "indexed" && (typeof body.extractedText !== "string" || !body.extractedText.trim()))) {
    return NextResponse.json({ error: "Invalid upload result." }, { status: 400 });
  }
  const result = await finishStagedUpload(id, body.leaseId, {
    status: body.status as "indexed" | "stored" | "failed",
    extractedText: typeof body.extractedText === "string" ? body.extractedText : null,
    extractor: typeof body.extractor === "string" ? body.extractor : null,
    pageCount: typeof body.pageCount === "number" && Number.isFinite(body.pageCount) ? body.pageCount : null,
    message: typeof body.message === "string" ? body.message : null,
  });
  if (!result) return NextResponse.json({ error: "Upload claim expired or was already completed." }, { status: 409 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
