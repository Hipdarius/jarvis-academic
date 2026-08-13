import { NextResponse } from "next/server";

import { updateStudyBlockStatus } from "@/db/store";

export const runtime = "edge";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^study:[a-f0-9]{40}$/i.test(id)) return NextResponse.json({ error: "Invalid study block." }, { status: 400 });
  const body = await request.json().catch(() => null) as { status?: unknown } | null;
  const allowed = new Set(["suggested", "accepted", "done", "skipped"]);
  if (!body || typeof body.status !== "string" || !allowed.has(body.status)) {
    return NextResponse.json({ error: "Invalid study status." }, { status: 400 });
  }
  const result = await updateStudyBlockStatus(id, body.status as "suggested" | "accepted" | "done" | "skipped");
  return result
    ? NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Study block not found." }, { status: 404 });
}
