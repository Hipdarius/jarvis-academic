import { NextResponse } from "next/server";

import { readDashboardState } from "@/db/store";
import { terminale1CISubjects } from "@/packages/core/src/academic-catalog";
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
      subjects: terminale1CISubjects.map((subject) => ({
        id: subject.id,
        name: subject.name,
        officialName: subject.officialName,
        group: subject.group,
        weeklyLessons: subject.weeklyLessons,
        curriculum: true,
      })),
      items: [],
      sources: [],
      projects: [],
      notes: [],
      documents: [],
      stagedUploads: [],
      studyBlocks: [],
      agentRuns: [],
      improvementProposals: [],
      agentJobs: [],
      providers: [],
    };
    return NextResponse.json(unavailable, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
