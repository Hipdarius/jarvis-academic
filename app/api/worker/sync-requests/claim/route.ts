import { NextResponse } from "next/server";

import { authenticateWorker } from "@/app/lib/worker-auth";
import { claimSyncRequest } from "@/db/store";

export const runtime = "edge";

export async function POST(request: Request) {
  if (!await authenticateWorker(request)) return NextResponse.json({ error: "Worker authentication failed." }, { status: 401 });
  const syncRequest = await claimSyncRequest();
  return NextResponse.json(syncRequest ? { state: "claimed", request: syncRequest } : { state: "idle", request: null }, { headers: { "Cache-Control": "no-store" } });
}
