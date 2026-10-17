// Validation for step 1 of the two-step demo request form (name, school, email, phone) -- the part that is saved as soon as the visitor presses Continue, before they have
// finished the form. Deliberately has no "use client" / "use server" directive so the server
// action and the unit tests can both import it.

import { cleanText, normalizePhone } from "@/lib/marketing/demo-request";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Field length caps. The full form has none, but this endpoint stores data from people who
// never pressed the final submit button, so keep what a script could stuff into it small.
const MAX_NAME = 120;
const MAX_SCHOOL = 200;
const MAX_EMAIL = 254;

export type DemoContactStep = {
  name: string;
  schoolName: string;
  /** Lowercased and trimmed so the same visitor can be matched when they finish the form. */
  email: string;
  /** Normalised (digits and optional leading +); required so an incomplete lead can be called back. */
  phone: string;
};

export type DemoContactStepResult =
  | { ok: true; value: DemoContactStep }
  | { ok: false; message: string };

export function normalizeLeadEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function parseDemoContactStep(formData: FormData): DemoContactStepResult {
  const name = cleanText(formData.get("name"), MAX_NAME);
  const schoolName = cleanText(formData.get("school_name"), MAX_SCHOOL);
  const email = normalizeLeadEmail(cleanText(formData.get("email"), MAX_EMAIL + 1));
  const phone = normalizePhone(formData.get("phone"));

  if (!name || !schoolName || !email) {
    return { ok: false, message: "Name, school, and email are required." };
  }
  if (!phone) {
    return { ok: false, message: "Enter a phone number we can reach you on, e.g. 0712 345 678." };
  }
  if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return { ok: false, message: "Enter a valid email address." };
  }

  return {
    ok: true,
    value: {
      name,
      schoolName,
      email,
      phone,
    },
  };
}

/**
 * How long step-1 leads are kept before the daily retention cron deletes them. Single source
 * for the cron (src/app/api/cron/communication-retention/route.ts) and for anything that needs
 * to know when counts stop being complete (the analytics funnel). The admin panel copy and the
 * privacy policy also say "60 days" -- keep them in step if this ever changes.
 */
export const DEMO_PARTIAL_RETENTION_DAYS = 60;

/**
 * True when a reporting window starts earlier than the retention limit, so counts of saved
 * leads for it are incomplete (older rows have already been deleted).
 */
export function startsBeyondPartialRetention(startIso: string, now: Date = new Date()): boolean {
  const start = new Date(`${startIso}T00:00:00Z`).getTime();
  if (Number.isNaN(start)) return false;
  return start < now.getTime() - DEMO_PARTIAL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}
