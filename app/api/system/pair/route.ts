import { NextResponse } from "next/server";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { createWorkerToken } from "@/db/store";

export const runtime = "edge";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in to create a worker token." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { label?: unknown };
  const label = typeof body.label === "string" && body.label.trim()
    ? body.label.trim()
    : "Synology worker";
  const token = await createWorkerToken(label);
  return NextResponse.json({
    token,
    warning: "This token is shown once. Store it in the worker secret file; never paste it into chat or commit it.",
  }, { headers: { "Cache-Control": "no-store" } });
}
