import { NextResponse } from "next/server";

import { readDashboardState } from "@/db/store";
import type { DashboardState } from "@/packages/core/src/dashboard";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await readDashboardState();
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch {
    const unavailable: DashboardState = {
      mode: "database_unavailable",
      generatedAt: new Date().toISOString(),
      items: [],
      sources: [],
      projects: [],
      notes: [],
      documents: [],
      studyBlocks: [],
      agentRuns: [],
      improvementProposals: [],
      agentJobs: [],
      providers: [],
    };
    return NextResponse.json(unavailable, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
