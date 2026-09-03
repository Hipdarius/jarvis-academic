import { NextResponse } from "next/server";

import { authenticateWorker } from "@/app/lib/worker-auth";
import { getUploadBucket } from "@/app/lib/upload-storage";
import { getClaimedStagedUploadFile } from "@/db/store";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await authenticateWorker(request)) {
    return NextResponse.json({ error: "Worker authentication failed." }, { status: 401 });
  }
  const { id } = await context.params;
  const leaseId = request.headers.get("x-jarvis-upload-lease") ?? "";
  if (!/^upload:[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(leaseId)) {
    return NextResponse.json({ error: "Invalid upload claim." }, { status: 400 });
  }
  const file = await getClaimedStagedUploadFile(id, leaseId);
  if (!file) return NextResponse.json({ error: "Upload claim is no longer active." }, { status: 409 });
  const object = await getUploadBucket().get(file.objectKey);
  if (!object) return NextResponse.json({ error: "Stored file is unavailable." }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(object.size),
      "Content-Type": "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "X-Jarvis-Checksum": file.checksum,
    },
  });
}
