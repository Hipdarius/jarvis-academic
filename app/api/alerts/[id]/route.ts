import { NextResponse } from "next/server";

import { updateAlertStatus } from "@/db/store";

export const runtime = "edge";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) return NextResponse.json({ error: "Invalid alert." }, { status: 400 });
  const body = await request.json().catch(() => null) as { status?: unknown } | null;
  if (!body || (body.status !== "acknowledged" && body.status !== "resolved")) return NextResponse.json({ error: "Invalid alert status." }, { status: 400 });
  const result = await updateAlertStatus(id, body.status);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Alert not found." }, { status: 404 });
}
