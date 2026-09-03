import { NextResponse } from "next/server";

import { retryStagedUpload } from "@/db/store";

export const runtime = "edge";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^upload:[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid staged file." }, { status: 400 });
  }
  const result = await retryStagedUpload(id);
  if (!result) return NextResponse.json({ error: "Only stored-only or failed files can be retried." }, { status: 409 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
