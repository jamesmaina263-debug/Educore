import { timingSafeEqual } from "node:crypto";

/**
 * Verifies a cron route's `Authorization: Bearer <CRON_SECRET>` header using a
 * constant-time comparison, so response timing can't be used to guess the
 * secret byte-by-byte. Returns false on any mismatch, including length
 * differences (checked separately since timingSafeEqual requires equal-length
 * buffers).
 */
export function isValidCronRequest(request: Request, cronSecret: string): boolean {
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;

  const actualBuf = Buffer.from(authHeader);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(actualBuf, expectedBuf);
}
