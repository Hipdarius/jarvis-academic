import { NextResponse } from "next/server";

import { interpretWithProviders } from "@/app/lib/command-provider-router";
import { saveCommandIntent } from "@/db/store";
import { interpretCommandLocally } from "@/packages/core/src/command-router";

export const runtime = "edge";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 2_000) {
    return NextResponse.json(
      { error: "Enter a command between 1 and 2,000 characters." },
      { status: 400 },
    );
  }

  const fallback = interpretCommandLocally(text);
  const intent = await interpretWithProviders(text, fallback).catch(() => null);
  const resolved = intent ?? fallback;
  let stored = false;
  let queuedJobId: string | null = null;

  try {
    const saved = await saveCommandIntent(resolved, text);
    stored = true;
    queuedJobId = saved.jobId;
  } catch {
    // The command remains usable during local preview or a temporary D1 outage.
  }

  return NextResponse.json(
    { ...resolved, stored, queuedJobId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
