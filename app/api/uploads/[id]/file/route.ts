import { NextResponse } from "next/server";

import { getUploadBucket } from "@/app/lib/upload-storage";
import { getStagedUploadFile } from "@/db/store";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function contentDisposition(name: string) {
  const fallback = name.replace(/[^a-zA-Z0-9._-]+/g, "_") || "staged-file";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^upload:[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid staged file." }, { status: 400 });
  const file = await getStagedUploadFile(id);
  if (!file) return NextResponse.json({ error: "Staged file not found." }, { status: 404 });
  const object = await getUploadBucket().get(file.objectKey);
  if (!object) return NextResponse.json({ error: "Stored file is unavailable." }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(file.name),
      "Content-Length": String(object.size),
      "Content-Type": "application/octet-stream",
      "ETag": object.httpEtag,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
