import { NextResponse } from "next/server";

import { approveImprovementProposal } from "@/db/store";

export const runtime = "edge";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid proposal." }, { status: 400 });
  const body = await request.json().catch(() => null) as { confirmation?: unknown } | null;
  if (body?.confirmation !== "prepare_branch") {
    return NextResponse.json({ error: "Explicit branch preparation confirmation is required." }, { status: 400 });
  }
  const result = await approveImprovementProposal(id);
  return result
    ? NextResponse.json(result, { status: 202, headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Proposal is unavailable or already handled." }, { status: 409 });
}
