// Pure helpers for outbound prospecting (/admin/outreach). No I/O in here on purpose: CSV parsing,
// row validation and the Gemini prompt/response handling are all unit-tested in prospects.test.ts.
// The school_type list must match the CHECK constraint in
// supabase/migrations/20261016120000_outbound_prospecting.sql.

export const MAX_IMPORT_ROWS = 500;
export const MAX_SCORE_BATCH = 10;

export const SCHOOL_TYPES = ["public", "private", "other"] as const;
export type OutboundSchoolType = (typeof SCHOOL_TYPES)[number];

export type ProspectRow = {
  school_name: string;
  town_county: string | null;
  school_type: OutboundSchoolType | null;
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
 * The model only ever sees facts we already hold about the school. It is told not to invent
 * anything (no claimed visits, no fake mutual contacts, no numbers, no prices) because these
 * drafts go to strangers under EduCore's name.
 */
export function buildScoringPrompt(p: ProspectForScoring): string {
  const facts = [
    `School name: ${p.school_name}`,
    p.town_county ? `Location: ${p.town_county}` : null,
    p.school_type ? `Type: ${p.school_type}` : null,
    p.student_count !== null ? `Approximate students: ${p.student_count}` : null,
    p.website ? `Website: ${p.website}` : null,
    p.contact_name ? `Contact: ${p.contact_name}${p.contact_role ? ` (${p.contact_role})` : ""}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `You help EduCore, a Kenyan cloud school management system, decide which schools to approach and draft a first message.

EduCore covers: admissions, attendance, CBC and 8-4-4 exams and report cards, fee collection with M-Pesa, and SMS/WhatsApp updates to parents. It is Kenya-first and multi-tenant.

What we know about the school (this is ALL we know):
${facts}

Return ONLY a JSON object with these keys:
- "fit_score": integer 0-100. How likely this school is to benefit from and buy a school management system. Larger fee-paying schools with parent-communication and fee-collection needs score higher. If you know very little, score between 30 and 50, not high.
- "fit_reason": one or two plain sentences explaining the score, using only the facts above.
- "email_subject": under 70 characters, no clickbait, no ALL CAPS.
- "email_body": 70-120 words, plain text, no markdown. Address the contact by name if given, otherwise "Hello". Mention one concrete benefit relevant to the school's type or size. End by inviting a reply or a short demo. Do not include an unsubscribe line or signature block; the sending system adds those.
- "whatsapp": 40-70 words, friendly and brief, in the same spirit. Introduce EduCore, offer a short demo, and say they can reply STOP and we won't message again.

Hard rules: never claim we visited, spoke to, or were referred by anyone; never invent statistics, customers, awards, or prices; never mention competitors; do not imply the school asked to hear from us. Write in clear, respectful Kenyan business English.`;
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

/** Validates the model's JSON. Anything missing or the wrong shape is an error, never a guess. */
export function parseScoringResponse(raw: string): ParseScoringResult {
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
  const email_body = str("email_body");
  const whatsapp = str("whatsapp");
  if (!fit_reason || !email_subject || !email_body || !whatsapp) {
    return { ok: false, error: "AI scoring was missing one of the reason, email or WhatsApp drafts." };
  }

  return {
    ok: true,
    value: {
      fit_score,
      fit_reason: clip(fit_reason, 1000),
      email_subject: clip(email_subject, 200),
      email_body: clip(email_body, 4000),
      whatsapp: clip(whatsapp, 1000),
    },
  };
}
