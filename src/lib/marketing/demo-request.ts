// Shared definitions and validation for the public demo-request form (/contact).
// Deliberately has no "use client" / "use server" directive so the browser form, the server
// action and the unit tests all import the same rules.
//
// Storage note: contact method, preferred time and (optionally) school type are NOT separate
// database columns. They are written as a short, readable block at the top of the existing
// `message` column, because the admin console, the new-lead notification email and the assignment email already display
// `message` verbatim. That keeps this change schema-free (no migration, no deploy-ordering
// risk, no change to anything that reads marketing_demo_requests). If these ever need to be
// filtered or reported on, promote them to real columns in a dedicated migration.

import {
  parseSchoolCategory,
  schoolCategoryLabel,
  type SchoolCategorySlug,
} from "@/lib/marketing/school-category-options";

export const ROLE_OPTIONS = [
  "School Owner",
  "Principal",
  "Administrator",
  "Teacher",
  "Finance",
  "Other",
] as const;

export const CONTACT_METHODS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "phone", label: "Phone call" },
  { value: "email", label: "Email" },
] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number]["value"];

// What the visitor would *prefer*. These are never presented as available or booked slots.
export const TIME_WINDOWS = [
  { value: "morning", label: "Morning (8:00–12:00)" },
  { value: "afternoon", label: "Afternoon (12:00–17:00)" },
] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number]["value"];

export const REQUEST_TYPES = ["callback", "scheduled"] as const;

/**
 * The exact words shown next to the WhatsApp tick-box (unticked by default) and stored with the agreement.
 * It covers messages about the visitor's own demo request and trial only, never promotions. If this wording changes,
 * old agreements keep the words their owner actually saw (they are copied into the record, not referenced).
 */
export const WHATSAPP_CONSENT_LABEL =
  "Yes, you may message me on WhatsApp, on the phone number above, about my demo request and free trial. I can reply STOP at any time.";
export type RequestType = (typeof REQUEST_TYPES)[number];

/** Kenya has no DST: East Africa Time is always UTC+3. */
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const MAX_DAYS_AHEAD = 60;

export const LIMITS = {
  name: 120,
  school: 200,
  email: 254,
  message: 2000,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Trims, removes control characters (keeping newlines/tabs only when allowed) and caps length.
 * Output is stored and later rendered/emailed by admin tooling, so unprintable characters are
 * stripped rather than trusted.
 */
export function cleanText(raw: unknown, max: number, opts: { multiline?: boolean } = {}): string {
  let s = String(raw ?? "").normalize("NFC");
  s = opts.multiline
    ? s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    : s.replace(/[\u0000-\u001F\u007F]/g, " ");
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "");
  return s.trim().slice(0, max);
}

/**
 * Accepts the shapes people actually type in Kenya (0712 345 678, +254 712 345 678,
 * 254712345678, 07-12...) plus other international numbers, and returns a tidy string with
 * only digits and a leading "+". Returns null when it can't be a phone number.
 * This checks plausibility, not that the number is reachable.
 */
export function normalizePhone(raw: unknown): string | null {
  const input = String(raw ?? "").trim();
  if (!input || input.length > 40) return null;
  if (!/^[+\d\s().-]+$/.test(input)) return null;
  const hasPlus = input.startsWith("+");
  const digits = input.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return null;
  return `${hasPlus ? "+" : ""}${digits}`;
}

/** Today's calendar date in Nairobi as yyyy-mm-dd. */
export function todayInNairobi(now: Date = new Date()): string {
  return new Date(now.getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Valid, real calendar date, today or later (Nairobi), within the next 60 days. */
export function isAcceptablePreferredDate(raw: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return false;
  const today = todayInNairobi(now);
  return raw >= today && raw <= addDays(today, MAX_DAYS_AHEAD);
}

export function formatPreferredDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export type DemoRequestInput = {
  name: string;
  schoolName: string;
  role: string;
  email: string;
  phone: string;
  contactMethod: ContactMethod;
  requestType: RequestType;
  preferredDate: string | null;
  timeWindow: TimeWindow | null;
  studentCount: number | null;
  message: string;
  /** True only when the visitor ticked the WhatsApp tick-box. Never defaulted on. */
  whatsappConsent: boolean;
  /** Optional: which /schools/<slug> type the visitor chose. Unknown values are dropped, never an error. */
  schoolCategory?: SchoolCategorySlug | null;
};

export type DemoRequestParse =
  | { ok: true; value: DemoRequestInput }
  | { ok: false; field: string; message: string };

const fail = (field: string, message: string): DemoRequestParse => ({ ok: false, field, message });

export function parseDemoRequest(formData: FormData, now: Date = new Date()): DemoRequestParse {
  const name = cleanText(formData.get("name"), LIMITS.name);
  const schoolName = cleanText(formData.get("school_name"), LIMITS.school);
  const role = cleanText(formData.get("role"), 40);
  const email = cleanText(formData.get("email"), LIMITS.email);
  const message = cleanText(formData.get("message"), LIMITS.message, { multiline: true });
  const studentCountRaw = cleanText(formData.get("student_count"), 10);

  if (!name) return fail("name", "Please enter your name.");
  if (!schoolName) return fail("school_name", "Please enter your school's name.");
  if (!(ROLE_OPTIONS as readonly string[]).includes(role)) {
    return fail("role", "Please choose your role.");
  }

  const phone = normalizePhone(formData.get("phone"));
  if (!phone) return fail("phone", "Enter a phone number we can reach you on, e.g. 0712 345 678.");

  if (!email || !EMAIL_RE.test(email)) return fail("email", "Enter a valid email address.");

  const method = cleanText(formData.get("contact_method"), 20);
  const contactMethod = CONTACT_METHODS.find((m) => m.value === method)?.value;
  if (!contactMethod) return fail("contact_method", "Choose how you'd like us to reach you.");

  const typeRaw = cleanText(formData.get("request_type"), 20) || "callback";
  if (!(REQUEST_TYPES as readonly string[]).includes(typeRaw)) {
    return fail("request_type", "Choose when you'd like to hear from us.");
  }
  const requestType = typeRaw as RequestType;

  let preferredDate: string | null = null;
  let timeWindow: TimeWindow | null = null;
  if (requestType === "scheduled") {
    preferredDate = cleanText(formData.get("preferred_date"), 10);
    if (!isAcceptablePreferredDate(preferredDate, now)) {
      return fail("preferred_date", "Pick a date from today up to 60 days ahead.");
    }
    const windowRaw = cleanText(formData.get("time_window"), 20);
    timeWindow = TIME_WINDOWS.find((w) => w.value === windowRaw)?.value ?? null;
    if (!timeWindow) return fail("time_window", "Choose morning or afternoon.");
  }

  let studentCount: number | null = null;
  if (studentCountRaw) {
    const n = Number(studentCountRaw);
    if (!Number.isInteger(n) || n < 0 || n > 100000) {
      return fail("student_count", "Student count must be a whole number.");
    }
    studentCount = n;
  }

  return {
    ok: true,
    value: {
      name,
      schoolName,
      role,
      email,
      phone,
      contactMethod,
      requestType,
      preferredDate,
      timeWindow,
      studentCount,
      message,
      whatsappConsent: formData.get("whatsapp_consent") === "yes",
      schoolCategory: parseSchoolCategory(formData.get("school_category")),
    },
  };
}

/**
 * The text stored in marketing_demo_requests.message. Starts with the booking preferences so
 * whoever follows up sees them first, and states plainly that nothing is confirmed.
 */
export function buildStoredMessage(input: DemoRequestInput): string {
  const methodLabel = CONTACT_METHODS.find((m) => m.value === input.contactMethod)?.label ?? "";
  const lines = [`Contact via: ${methodLabel}`];
  if (input.requestType === "scheduled" && input.preferredDate && input.timeWindow) {
    const windowLabel = TIME_WINDOWS.find((w) => w.value === input.timeWindow)?.label ?? "";
    lines.push(
      `Preferred time: ${formatPreferredDate(input.preferredDate)}, ${windowLabel} EAT (NOT yet confirmed -- confirm with the visitor)`,
    );
  } else {
    lines.push("Preferred time: callback requested as soon as possible");
  }
  if (input.schoolCategory) lines.push(`School type: ${schoolCategoryLabel(input.schoolCategory)}`);
  if (input.message) lines.push("", input.message);
  return lines.join("\n");
}
