import { randomBytes } from "crypto";

/**
 * Readable-ish but random — shown once to whoever needs to relay it (an
 * admin inviting staff, or a school owner signing themselves up), not
 * something a user ever gets to pick themselves. Pairs with
 * school_users.must_change_password, which forces a change on first login.
 */
export function generateTemporaryPassword(): string {
  return randomBytes(9).toString("base64url");
}

// How long a temp password (invite, reset, or self-signup) is usable before
// the app refuses to honor it. must_change_password forces a change well
// before this if the person logs in promptly; this bounds the window for
// one who never logs in at all.
const TEMP_PASSWORD_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export function temporaryPasswordExpiry(): string {
  return new Date(Date.now() + TEMP_PASSWORD_TTL_MS).toISOString();
}
