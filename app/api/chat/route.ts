import { NextResponse } from "next/server";

import { createSubjectChatJob } from "@/db/store";

export const runtime = "edge";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { message?: unknown; subject?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const subject = typeof body?.subject === "string" ? body.subject.trim() : null;
  if (!message || message.length > 4_000 || (subject && subject.length > 200)) {
    return NextResponse.json({ error: "Enter a question up to 4,000 characters." }, { status: 400 });
  }
  const result = await createSubjectChatJob(message, subject || null);
  return NextResponse.json({ ...result, state: "queued" }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
