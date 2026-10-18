// Pure helpers for outbound prospecting (/admin/outreach). No I/O in here on purpose: CSV parsing,
// row validation and the Gemini prompt/response handling are all unit-tested in prospects.test.ts.
// The school_type list must match the CHECK constraint in
// supabase/migrations/20261016120000_outbound_prospecting.sql.

import { PUBLISHED_PRICE_KES_PER_STUDENT_TERM, renderProductFactsForPrompt } from "@/lib/growth/product-facts";
import { SITE_URL } from "@/lib/site";
import { OWNERSHIP_LABELS, ownershipSignal } from "./ownership";

export const MAX_IMPORT_ROWS = 500;
export const MAX_SCORE_BATCH = 10;

export const SCHOOL_TYPES = ["public", "private", "other"] as const;
export type OutboundSchoolType = (typeof SCHOOL_TYPES)[number];

export const SCHOOL_LEVELS = ["kindergarten", "primary", "secondary", "other"] as const;
export type OutboundSchoolLevel = (typeof SCHOOL_LEVELS)[number];

export const SCHOOL_LEVEL_LABELS: Record<OutboundSchoolLevel, string> = {
  kindergarten: "Kindergarten / nursery",
  primary: "Primary",
  secondary: "Secondary",
  other: "Other",
};

export type ProspectRow = {
  school_name: string;
  town_county: string | null;
  school_type: OutboundSchoolType | null;
  school_level: OutboundSchoolLevel | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  contact_name: string | null;
  contact_role: string | null;
  student_count: number | null;
};

const HEADER_ALIASES: Record<keyof ProspectRow, string[]> = {
  school_name: ["school_name", "school", "name", "school name", "institution"],
  town_county: ["town_county", "county", "town", "location", "town/county", "sub_county", "sub county"],
  school_type: ["school_type", "type", "category", "ownership", "sponsor"],
  school_level: ["school_level", "level", "stage", "school level"],
  website: ["website", "url", "web", "site"],
  phone: ["phone", "telephone", "tel", "mobile", "phone_number", "phone number"],
  email: ["email", "e-mail", "email_address", "email address"],
  contact_name: ["contact_name", "contact", "head_teacher", "head teacher", "principal", "headteacher"],
  contact_role: ["contact_role", "role", "title", "position"],
  student_count: ["student_count", "students", "enrolment", "enrollment", "population", "learners"],
};

/** RFC-4180-style CSV: quoted fields, escaped quotes (""), commas and newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeSchoolType(raw: string | null | undefined): OutboundSchoolType | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith("pub") || v === "government" || v === "gok") return "public";
  if (v.startsWith("priv") || v === "independent") return "private";
  return "other";
}

export function normalizeSchoolLevel(raw: string | null | undefined): OutboundSchoolLevel | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (/(kinder|nursery|pre-?primary|pre-?school|playgroup|day ?care|ecde|early)/.test(v)) return "kindergarten";
  if (/(primary|junior|lower)/.test(v)) return "primary";
  if (/(secondary|high|senior)/.test(v)) return "secondary";
  return "other";
}

/** Keeps digits and a leading +; returns null if it doesn't look like a phone number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const cleaned = (v.startsWith("+") ? "+" : "") + v.replace(/\D/g, "");
  const digits = cleaned.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? cleaned : null;
}

export function normalizeWebsite(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > 300) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes(".") ? u.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

export type ParsedImport = {
  rows: ProspectRow[];
  /** Human-readable problems, one per skipped/odd row. Never contains contact details. */
  warnings: string[];
};

export type ParseImportResult = { ok: true; value: ParsedImport } | { ok: false; error: string };

export function parseProspectCsv(text: string): ParseImportResult {
  const table = parseCsv(text);
  if (table.length < 2) return { ok: false, error: "The file needs a header row and at least one school." };

  const header = table[0].map((h) => h.trim().toLowerCase());
  const colFor = (field: keyof ProspectRow): number => {
    for (const alias of HEADER_ALIASES[field]) {
      const idx = header.indexOf(alias);
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const cols = Object.fromEntries(
    (Object.keys(HEADER_ALIASES) as Array<keyof ProspectRow>).map((f) => [f, colFor(f)]),
  ) as Record<keyof ProspectRow, number>;
  if (cols.school_name === -1) {
    return { ok: false, error: 'No school name column found. Add a header named "school_name" (or "school" / "name").' };
  }

  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) {
    return { ok: false, error: `Import at most ${MAX_IMPORT_ROWS} schools at a time (this file has ${body.length}).` };
  }

  const rows: ProspectRow[] = [];
  const warnings: string[] = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    const get = (f: keyof ProspectRow) => (cols[f] === -1 ? "" : (cells[cols[f]] ?? "").trim());
    const name = get("school_name");
    if (!name) {
      warnings.push(`Row ${line}: no school name, skipped.`);
      return;
    }
    if (name.length > 200) {
      warnings.push(`Row ${line}: school name longer than 200 characters, skipped.`);
      return;
    }
    const emailRaw = get("email").toLowerCase();
    const email = emailRaw && emailRaw.length <= 254 && EMAIL_RE.test(emailRaw) ? emailRaw : null;
    if (emailRaw && !email) warnings.push(`Row ${line}: email looks invalid, left blank.`);

    const phoneRaw = get("phone");
    const phone = normalizePhone(phoneRaw);
    if (phoneRaw && !phone) warnings.push(`Row ${line}: phone looks invalid, left blank.`);

    const countRaw = get("student_count").replace(/[, ]/g, "");
    const count = /^\d+$/.test(countRaw) ? Number(countRaw) : null;
    const student_count = count !== null && count <= 100000 ? count : null;
    if (countRaw && student_count === null) warnings.push(`Row ${line}: student count not a valid number, left blank.`);

    rows.push({
      school_name: name,
      town_county: get("town_county").slice(0, 200) || null,
      school_type: normalizeSchoolType(get("school_type")),
      school_level: normalizeSchoolLevel(get("school_level")),
      website: normalizeWebsite(get("website")),
      phone,
      email,
      contact_name: get("contact_name").slice(0, 200) || null,
      contact_role: get("contact_role").slice(0, 100) || null,
      student_count,
    });
  });

  if (rows.length === 0) return { ok: false, error: "No usable schools found in the file." };
  return { ok: true, value: { rows, warnings } };
}

// ---------------------------------------------------------------------------------------------
// Gemini scoring + drafting
// ---------------------------------------------------------------------------------------------

export type ProspectForScoring = {
  school_name: string;
  town_county: string | null;
  school_type: string | null;
  school_level?: string | null;
  website: string | null;
  contact_name: string | null;
  contact_role: string | null;
  student_count: number | null;
};

export type ScoringResult = {
  fit_score: number;
  fit_reason: string;
  email_subject: string;
  email_body: string;
  whatsapp: string;
};

/**
 * What the AI actually writes: a score, a one-line reason, a subject and ONE short opening
 * paragraph. Everything else in a draft (what EduCore does, the price, the free trial, the links,
 * the sign-off and the opt-out line) is fixed text assembled below, so the model can never reword
 * an offer or invent one. Product claims come from src/lib/growth/product-facts.ts (every claim there
 * has evidence in the repo); price and trial come from the same sources the marketing site uses.
 */
export const OUTREACH_OFFER = {
  pricePerStudentPerTermKes: PUBLISHED_PRICE_KES_PER_STUDENT_TERM,
  // Must match TRIAL_TERMS in src/lib/marketing/trial.ts ("30-day free trial. No card required.");
  // prospects.test.ts fails if that wording changes so this cannot drift silently.
  trialDays: 30,
} as const;

const OFFER_LINE = `Our pricing starts at KES ${OUTREACH_OFFER.pricePerStudentPerTermKes} per student per term, with a ${OUTREACH_OFFER.trialDays}-day free trial and no payment card required.`;

const DEFAULT_OPENING_SCHOOL =
  "Managing admissions, student records, fee collection through M-Pesa, and end-of-term assessments can take considerable time for a school.";
const DEFAULT_OPENING_KINDERGARTEN =
  "Keeping up with admissions, fee collection and regular updates to parents can take a great deal of a kindergarten's time.";

export type DraftContext = {
  school_name?: string | null;
  contact_name?: string | null;
  school_level?: string | null;
};

/** The name to greet, or null when it's missing or just the school/office label ("Hello," instead). */
export function greetingName(contactName: string | null | undefined, schoolName?: string | null): string | null {
  const name = (contactName ?? "").trim();
  if (!name) return null;
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const n = norm(name);
  const school = norm(schoolName ?? "");
  if (school && (school.includes(n) || n.includes(school))) return null;
  if (/\b(school|academy|office|admin|administrator|administration|principal|headteacher|head teacher|team|info)\b/.test(n)) return null;
  return name;
}

/** The AI-written opening is only used if it is a plain short paragraph with no figures, prices or links. */
export function sanitizeOpening(raw: unknown, level: OutboundSchoolLevel | null | undefined): string {
  const fallback = level === "kindergarten" ? DEFAULT_OPENING_KINDERGARTEN : DEFAULT_OPENING_SCHOOL;
  if (typeof raw !== "string") return fallback;
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < 20 || t.length > 400) return fallback;
  if (/[0-9%]|kes|ksh|http|www\.|@|free|discount|guarantee|approved|certified|accredited|official|endorse|kicd|knec|ministry|safaricom|simple/i.test(t)) return fallback;
  return t;
}

const PRODUCT_PARAGRAPH = {
  // PP1/PP2 and competency-based learner progress reports are verified facts for kindergartens;
  // exam, grade and ranking wording is deliberately absent (see KINDERGARTEN_GUIDANCE).
  kindergarten:
    "EduCore Africa helps Kenyan kindergartens and nursery schools bring admissions, learner records, fee collection through M-Pesa, daily attendance and parent communication through SMS and WhatsApp together in one cloud-based system. It supports Pre-Primary (PP1 and PP2) classes and provides competency-based learner progress reports.",
  // Level unknown (e.g. a CSV import with no level): stay level-neutral rather than risk exam talk for a nursery.
  neutral:
    "EduCore Africa helps Kenyan schools bring admissions, student records, fee collection through M-Pesa, student attendance and parent communication through SMS and WhatsApp together in one cloud-based school management system.",
  full: "EduCore Africa helps Kenyan schools bring admissions, student records and fee collection through M-Pesa together in one cloud-based school management system. It also supports student attendance, parent communication through SMS and WhatsApp, and exam management and report cards, including supported CBC competency-based reporting and marks-based grading.",
} as const;

export function assembleEmailBody(openingRaw: unknown, ctx: DraftContext = {}): string {
  const level = normalizeSchoolLevel(ctx.school_level ?? null);
  const name = greetingName(ctx.contact_name, ctx.school_name);
  const product = level === "kindergarten" ? PRODUCT_PARAGRAPH.kindergarten : level === null ? PRODUCT_PARAGRAPH.neutral : PRODUCT_PARAGRAPH.full;
  return [
    name ? `Hello ${name},` : "Hello,",
    sanitizeOpening(openingRaw, level),
    product,
    OFFER_LINE,
    "Would you be open to a brief online demonstration to see how EduCore could support your school?",
    `Kind regards,\nEduCore Africa\n${SITE_URL}\n${SITE_URL}/signup`,
    "If you would rather not hear from us, just reply and we will not contact you again.",
  ].join("\n\n");
}

// WhatsApp wording per level. Same rules as the email: only verified claims (src/lib/growth/product-facts.ts),
// no exam/grade wording for kindergartens or for an unknown level.
const WHATSAPP_PRODUCT = {
  kindergarten:
    "Our system brings together admissions, attendance, M-Pesa fee collection and parent communication via SMS and WhatsApp, with competency-based learner progress reports and support for Pre-Primary (PP1 and PP2) classes.",
  neutral:
    "Our school management system brings together admissions, student attendance, M-Pesa fee collection and parent communication via SMS and WhatsApp.",
  full: "Our school management system brings together admissions, student attendance, M-Pesa fee collection, parent communication via SMS and WhatsApp, and exam management with CBC-supported and marks-based report cards.",
} as const;

export function assembleWhatsApp(ctx: DraftContext = {}): string {
  const level = normalizeSchoolLevel(ctx.school_level ?? null);
  const name = greetingName(ctx.contact_name, ctx.school_name);
  const who = level === "kindergarten" ? "Kenyan kindergartens and nursery schools" : "Kenyan schools";
  const product = level === "kindergarten" ? WHATSAPP_PRODUCT.kindergarten : level === null ? WHATSAPP_PRODUCT.neutral : WHATSAPP_PRODUCT.full;
  return [
    `Hello${name ? ` ${name}` : ""}! 👋 We’re EduCore Africa, helping ${who} simplify their daily administration.`,
    product,
    `Pricing starts at KES ${OUTREACH_OFFER.pricePerStudentPerTermKes} per student per term, and you can explore the system with a ${OUTREACH_OFFER.trialDays}-day free trial, with no payment card required.`,
    "Would you be open to a short demo to see how EduCore could support your school?",
    `🌐 ${SITE_URL}`,
    "If you’d prefer not to receive further messages, just reply STOP.",
  ].join("\n");
}

/**
 * The model only ever sees facts we already hold about the school. It writes ONLY the score, a reason,
 * a subject and a short opening paragraph (see OUTREACH_OFFER above for why).
 */
export function buildScoringPrompt(p: ProspectForScoring): string {
  const level = normalizeSchoolLevel(p.school_level ?? null);
  const ownership = ownershipSignal({ school_name: p.school_name, school_type: p.school_type, school_level: p.school_level });
  const facts = [
    `School name: ${p.school_name}`,
    p.town_county ? `Location: ${p.town_county}` : null,
    p.school_type ? `Type: ${p.school_type}` : null,
    p.school_level ? `Level: ${p.school_level}` : null,
    ownership !== "unknown" ? `Ownership: ${OWNERSHIP_LABELS[ownership]}${ownership.endsWith("_tagged") ? "" : " (a guess from the name)"}` : null,
    p.student_count !== null ? `Approximate students: ${p.student_count}` : null,
    p.website ? `Website: ${p.website}` : null,
    p.contact_name ? `Contact: ${p.contact_name}${p.contact_role ? ` (${p.contact_role})` : ""}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `You help EduCore, a Kenyan cloud school management system, decide which schools to approach.

${renderProductFactsForPrompt(level)}

What we know about the school (this is ALL we know):
${facts}

Return ONLY a JSON object with these keys:
- "fit_score": integer 0-100. How likely this school is to benefit from and buy a school management system. Larger fee-paying schools with parent-communication and fee-collection needs score higher. If you know very little, score between 30 and 50, not high. A school that looks government-run (public) is usually a weaker fit because it rarely buys software on its own budget: score it no higher than 40 unless other facts clearly show it can pay.
- "fit_reason": one or two plain sentences explaining the score, using only the facts above.
- "email_subject": under 70 characters, plain and professional, no clickbait, no ALL CAPS, no exclamation marks.
- "opening": ONE paragraph of 1-2 sentences (under 45 words) that opens a first email by naming an administrative burden a school like this typically faces (for example admissions, fee follow-up, assessments, or updating parents). Plain text. Do not greet, do not mention EduCore, and do not include any numbers, prices, percentages, offers, links or promises. ${
    level === "kindergarten"
      ? "This is a kindergarten/nursery: talk about admissions, fees and updating parents, not exams."
      : "Keep it general to a Kenyan school."
  }

Hard rules: never claim we visited, spoke to, or were referred by anyone; never invent facts about the school or its current systems; never mention competitors. Write in clear, respectful Kenyan business English.`;
}

function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

const clip = (s: string, max: number) => s.trim().slice(0, max);

export type ParseScoringResult = { ok: true; value: ScoringResult } | { ok: false; error: string };

/**
 * Validates the model's JSON and assembles the final drafts. A missing or unsafe `opening` falls back
 * to a fixed default paragraph rather than failing, since the rest of the email is fixed text.
 */
export function parseScoringResponse(raw: string, ctx: DraftContext = {}): ParseScoringResult {
  let data: unknown;
  try {
    data = JSON.parse(stripFences(raw));
  } catch {
    return { ok: false, error: "AI scoring returned something that wasn't valid JSON." };
  }
  if (!data || typeof data !== "object") return { ok: false, error: "AI scoring returned an unexpected shape." };
  const o = data as Record<string, unknown>;

  const scoreNum = typeof o.fit_score === "number" ? o.fit_score : Number(o.fit_score);
  if (!Number.isFinite(scoreNum)) return { ok: false, error: "AI scoring didn't include a usable fit score." };
  const fit_score = Math.max(0, Math.min(100, Math.round(scoreNum)));

  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const fit_reason = str("fit_reason");
  const email_subject = str("email_subject");
  if (!fit_reason || !email_subject) {
    return { ok: false, error: "AI scoring was missing the reason or the email subject." };
  }

  return {
    ok: true,
    value: {
      fit_score,
      fit_reason: clip(fit_reason, 1000),
      email_subject: clip(email_subject, 200),
      email_body: clip(assembleEmailBody(o.opening, ctx), 4000),
      whatsapp: clip(assembleWhatsApp(ctx), 1000),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Hand-typed contact details (the "Edit contacts" box). Everything is validated here so the
// database function can stay a thin writer.
// ---------------------------------------------------------------------------------------------

export type ManualContactsInput = {
  contact_name?: string;
  contact_role?: string;
  phone?: string;
  email?: string;
  website?: string;
};

export type ManualContacts = {
  contact_name: string | null;
  contact_role: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
};

export type ManualContactsResult = { ok: true; value: ManualContacts } | { ok: false; error: string };

export function normalizeManualContacts(input: ManualContactsInput): ManualContactsResult {
  const t = (v: string | undefined) => (typeof v === "string" ? v.trim() : "");

  const name = t(input.contact_name);
  if (name.length > 200) return { ok: false, error: "The contact name is too long (max 200 characters)." };
  const role = t(input.contact_role);
  if (role.length > 100) return { ok: false, error: "The role is too long (max 100 characters)." };

  const emailRaw = t(input.email).toLowerCase();
  if (emailRaw && (emailRaw.length > 254 || !EMAIL_RE.test(emailRaw))) {
    return { ok: false, error: "That email address doesn't look valid." };
  }

  const phoneRaw = t(input.phone);
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) return { ok: false, error: "That phone number doesn't look valid (7 to 15 digits)." };

  const websiteRaw = t(input.website);
  const website = websiteRaw ? normalizeWebsite(websiteRaw) : null;
  if (websiteRaw && !website) return { ok: false, error: "That website address doesn't look valid." };

  return {
    ok: true,
    value: {
      contact_name: name || null,
      contact_role: role || null,
      phone,
      email: emailRaw || null,
      website,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Rows parsed in the browser (map discovery) are re-validated on the server: never trust the client.
// ---------------------------------------------------------------------------------------------

const isStr = (v: unknown): v is string => typeof v === "string";
const clean = (v: unknown, max: number): string | null => (isStr(v) && v.trim() && v.trim().length <= max ? v.trim() : null);

/** Returns only well-formed rows (invalid ones are dropped, not repaired); at most MAX_IMPORT_ROWS. */
export function sanitizeProspectRows(raw: unknown): ProspectRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ProspectRow[] = [];
  for (const r of raw.slice(0, MAX_IMPORT_ROWS)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const name = clean(o.school_name, 200);
    if (!name) continue;
    const email = isStr(o.email) ? o.email.trim().toLowerCase() : "";
    const students = typeof o.student_count === "number" && Number.isInteger(o.student_count) && o.student_count >= 0 && o.student_count <= 100000 ? o.student_count : null;
    out.push({
      school_name: name,
      town_county: clean(o.town_county, 200),
      school_type: isStr(o.school_type) && (SCHOOL_TYPES as readonly string[]).includes(o.school_type) ? (o.school_type as OutboundSchoolType) : null,
      school_level: isStr(o.school_level) && (SCHOOL_LEVELS as readonly string[]).includes(o.school_level) ? (o.school_level as OutboundSchoolLevel) : null,
      website: isStr(o.website) ? normalizeWebsite(o.website) : null,
      phone: isStr(o.phone) ? normalizePhone(o.phone) : null,
      email: email && email.length <= 254 && EMAIL_RE.test(email) ? email : null,
      contact_name: clean(o.contact_name, 200),
      contact_role: clean(o.contact_role, 100),
      student_count: students,
    });
  }
  return out;
}
