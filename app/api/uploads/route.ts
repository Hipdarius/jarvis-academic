import { NextResponse } from "next/server";

import { getUploadBucket } from "@/app/lib/upload-storage";
import { MAX_STAGED_UPLOAD_BYTES, validateStagedUpload } from "@/app/lib/upload-validation";
import { createStagedUpload } from "@/db/store";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function checksum(bytes: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) => (
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  ));
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const selected = form?.get("file");
  const requestedDestination = form?.get("academicItemId");
  if (!(selected instanceof File)) return NextResponse.json({ error: "Choose a file to stage." }, { status: 400 });
  if (requestedDestination !== null && typeof requestedDestination !== "string") {
    return NextResponse.json({ error: "Invalid destination." }, { status: 400 });
  }
  if (!selected.size) return NextResponse.json({ error: "The selected file is empty." }, { status: 400 });
  if (selected.size > MAX_STAGED_UPLOAD_BYTES) {
    return NextResponse.json({ error: "The selected file is larger than 25 MB." }, { status: 413 });
  }

  let bytes: Uint8Array<ArrayBuffer>;
  let validated: ReturnType<typeof validateStagedUpload>;
  try {
    bytes = new Uint8Array(await selected.arrayBuffer());
    validated = validateStagedUpload(selected.name, selected.type, bytes);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The file could not be read." }, { status: 400 });
  }

  const digest = await checksum(bytes);
  const date = new Date();
  const objectKey = [
    "staged",
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    `${crypto.randomUUID()}${validated.extension}`,
  ].join("/");
  const bucket = getUploadBucket();
  await bucket.put(objectKey, bytes, {
    httpMetadata: { contentType: validated.mimeType },
    customMetadata: { checksum: digest, originalName: validated.name },
  });

  try {
    const result = await createStagedUpload({
      objectKey,
      name: validated.name,
      mimeType: validated.mimeType,
      sizeBytes: bytes.byteLength,
      checksum: digest,
      academicItemId: requestedDestination?.trim() || null,
    });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await bucket.delete(objectKey).catch(() => undefined);
    const message = error instanceof Error ? error.message : "The file could not be staged.";
    const status = message.includes("destination") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
