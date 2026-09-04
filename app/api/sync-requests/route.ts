import { NextResponse } from "next/server";

import { createSyncRequest } from "@/db/store";

export const runtime = "edge";

const sources = new Set(["all", "webuntis", "teams", "academy", "edumoodle"]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { source?: unknown } | null;
  const source = typeof body?.source === "string" ? body.source : "all";
  if (!sources.has(source)) return NextResponse.json({ error: "Invalid sync source." }, { status: 400 });
  const result = await createSyncRequest(source as "all" | "webuntis" | "teams" | "academy" | "edumoodle");
  return NextResponse.json(result, { status: result.deduplicated ? 200 : 202, headers: { "Cache-Control": "no-store" } });
}
