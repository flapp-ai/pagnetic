import { createHash, timingSafeEqual } from "node:crypto";

export function automationAuthorized(
  request: Request,
  configured = process.env.AUTOMATION_SECRET ?? "",
) {
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (configured.length < 32 || supplied.length < 32) return false;
  const left = createHash("sha256").update(configured).digest();
  const right = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(left, right);
}
