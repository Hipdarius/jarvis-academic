import { NextResponse } from "next/server";

import { updateAcademicItemOverride } from "@/db/store";

export const runtime = "edge";

const statuses = new Set(["inbox", "planned", "in_progress", "done", "cancelled"]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) return NextResponse.json({ error: "Invalid academic item." }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !Object.keys(body).some((key) => ["status", "dueAt", "subject", "userNote", "dismissed"].includes(key))) {
    return NextResponse.json({ error: "No supported changes were supplied." }, { status: 400 });
  }
  if (body.status !== undefined && (typeof body.status !== "string" || !statuses.has(body.status))) return NextResponse.json({ error: "Invalid item status." }, { status: 400 });
  if (body.dueAt !== undefined && body.dueAt !== null && (typeof body.dueAt !== "string" || Number.isNaN(Date.parse(body.dueAt)))) return NextResponse.json({ error: "Invalid deadline." }, { status: 400 });
  if (body.subject !== undefined && body.subject !== null && (typeof body.subject !== "string" || body.subject.length > 200)) return NextResponse.json({ error: "Invalid subject." }, { status: 400 });
  if (body.userNote !== undefined && body.userNote !== null && (typeof body.userNote !== "string" || body.userNote.length > 1_000)) return NextResponse.json({ error: "Invalid note." }, { status: 400 });
  if (body.dismissed !== undefined && typeof body.dismissed !== "boolean") return NextResponse.json({ error: "Invalid dismissed state." }, { status: 400 });
  const result = await updateAcademicItemOverride(id, {
    status: body.status as "inbox" | "planned" | "in_progress" | "done" | "cancelled" | undefined,
    dueAt: body.dueAt as string | null | undefined,
    subject: body.subject as string | null | undefined,
    userNote: body.userNote as string | null | undefined,
    dismissed: body.dismissed as boolean | undefined,
  });
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Academic item not found." }, { status: 404 });
}
