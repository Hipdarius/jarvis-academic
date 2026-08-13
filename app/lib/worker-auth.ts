import { verifyWorkerToken } from "@/db/store";

export async function authenticateWorker(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  return Boolean(token && await verifyWorkerToken(token));
}
