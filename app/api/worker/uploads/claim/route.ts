import { NextResponse } from "next/server";

import { authenticateWorker } from "@/app/lib/worker-auth";
import { claimNextStagedUpload } from "@/db/store";

export const runtime = "edge";

export async function POST(request: Request) {
  if (!await authenticateWorker(request)) {
    return NextResponse.json({ error: "Worker authentication failed." }, { status: 401 });
  }
  const upload = await claimNextStagedUpload();
  return NextResponse.json({ upload }, { headers: { "Cache-Control": "no-store" } });
}
