import "server-only";
import { createHash } from "node:crypto";

/** Same hash the database stores (hex SHA-256 of the UTF-8 token). The token itself is never stored or logged. */
export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
