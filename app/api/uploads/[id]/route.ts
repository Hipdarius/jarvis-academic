import { NextResponse } from "next/server";

import { getUploadBucket } from "@/app/lib/upload-storage";
import { deleteStagedUploadRecord, getStagedUploadFile } from "@/db/store";

export const runtime = "edge";

function validId(id: string) {
  return /^upload:[0-9a-f-]{36}$/i.test(id);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!validId(id)) return NextResponse.json({ error: "Invalid staged file." }, { status: 400 });
  const file = await getStagedUploadFile(id);
  if (!file) return NextResponse.json({ error: "Staged file not found." }, { status: 404 });
  await getUploadBucket().delete(file.objectKey);
  await deleteStagedUploadRecord(id);
  return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
}
