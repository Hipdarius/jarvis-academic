import { env } from "cloudflare:workers";

export function getUploadBucket() {
  const bucket = (env as unknown as { FILES?: R2Bucket }).FILES;
  if (!bucket) throw new Error("Private upload storage is unavailable.");
  return bucket;
}
