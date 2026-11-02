// Phase 2.4+2.5: what a guardian means when they tell the bot a child will be absent, or ask to change
// their own phone number. PURE: no Deno or Supabase imports, so vitest can test it
// (src/lib/bot-guardian-requests.test.ts).
//
// Deliberately conservative, like intents.ts: it only recognises a message that clearly REPORTS an
// absence or clearly ASKS to change the number. Questions ("was Mary absent yesterday?") return null so
// the existing attendance answer is unchanged. Anything not recognised returns null and falls through
// to the existing bot. It never decides anything about money or the register; it only extracts a date,
// a reason and a phone number that the database functions then validate again.

export type GuardianRequestKind = "absence_report" | "contact_update";

export interface AbsenceRequest {
  kind: "absence_report";
  /** ISO date (YYYY-MM-DD) or null when the message gave no usable day. */
  date: string | null;
  reason: string | null;
}

export interface ContactRequest {
  kind: "contact_update";
  /** The phone number as the guardian typed it (the database normalises it), or null if none found. */
  phone: string | null;
}

export type GuardianRequest = AbsenceRequest | ContactRequest;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januari: 1,
  feb: 2, february: 2, februari: 2,
  mar: 3, march: 3, machi: 3,
  apr: 4, april: 4, aprili: 4,
  may: 5, mei: 5,
  jun: 6, june: 6, juni: 6,
  jul: 7, july: 7, julai: 7,
  aug: 8, august: 8, agosti: 8,
  sep: 9, sept: 9, september: 9, septemba: 9,
  oct: 10, october: 10, oktoba: 10,
  nov: 11, november: 11, novemba: 11,
  dec: 12, december: 12, desemba: 12,
};

// Sunday = 0, as in Date#getUTCDay.
const WEEKDAYS: Record<string, number> = {
  sunday: 0, jumapili: 0,
  monday: 1, jumatatu: 1,
  tuesday: 2, tue: 2, tues: 2, jumanne: 2,
  wednesday: 3, jumatano: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, alhamisi: 4,
  friday: 5, fri: 5, ijumaa: 5,
  saturday: 6, jumamosi: 6,
};

const ABSENCE_CUES =
  /\b(absent|absence|not (?:be )?(?:coming|attending|attend|come)|won'?t (?:be )?(?:coming|attending|attend|come|in school)|will not (?:be )?(?:coming|attending|attend|come)|miss(?:ing)? school|hatakuja|hatahudhuria|hatoenda|mgonjwa|ataugua|sick|unwell|ana homa)\b/;

const QUESTION_START = /^(was|were|is|are|did|does|do|has|have|how|when|why|what|which|who|je|ni nini)\b/;

const NUMBER_WORDS = /\b(number|phone|namba|nambari|simu|contact)\b/;
const CHANGE_WORDS = /\b(change|update|new|badilisha|badili|mpya|now|weka|replace)\b/;
const PHONE_RE = /(?:\+?254|0)[\s-]?[17](?:[\s-]?\d){8}/;

export function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
}

function validIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return isoOf(dt);
}

/** Today's date in Africa/Nairobi (UTC+3, no daylight saving) as YYYY-MM-DD. */
export function nairobiToday(now: Date = new Date()): string {
  return isoOf(new Date(now.getTime() + 3 * 3600 * 1000));
}

/**
 * Pick the day a message is about. `today` is the Nairobi date (YYYY-MM-DD).
 * Day-month dates without a year mean the next occurrence that is not more than ~2 months in the past
 * (so "2 Jan" typed in late December is next January). Weekday names mean the NEXT such day after today.
 */
export function parseAbsenceDate(rawText: string, today: string): string | null {
  const text = rawText.toLowerCase();

  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return validIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  if (/\b(day after tomorrow|kesho kutwa)\b/.test(text)) return addDays(today, 2);
  if (/\b(tomorrow|tomorow|kesho)\b/.test(text)) return addDays(today, 1);
  if (/\b(yesterday|jana)\b/.test(text)) return addDays(today, -1);
  if (/\b(today|leo)\b/.test(text)) return today;

  const [ty, tm] = today.split("-").map(Number);
  const resolveYear = (m: number, d: number, explicitYear: number | null): string | null => {
    if (explicitYear !== null) return validIso(explicitYear, m, d);
    let candidate = validIso(ty, m, d);
    if (!candidate) return null;
    // Typed in late year about early next year, or the reverse: choose the nearest sensible one.
    const diffDays = (Date.parse(candidate) - Date.parse(today)) / 86400000;
    if (diffDays < -60) candidate = validIso(ty + 1, m, d);
    else if (diffDays > 300) candidate = validIso(ty - 1, m, d);
    return candidate;
  };

  // 5/11, 05-11-2026, 5.11
  const numeric = text.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if (numeric) {
    const d = Number(numeric[1]);
    const m = Number(numeric[2]);
    let y: number | null = numeric[3] ? Number(numeric[3]) : null;
    if (y !== null && y < 100) y += 2000;
    return resolveYear(m, d, y);
  }

  const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
  // "5 nov", "5th of november", "5 november 2026"
  const dayFirst = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${monthNames})\\b(?:\\s+(\\d{4}))?`));
  if (dayFirst) return resolveYear(MONTHS[dayFirst[2]], Number(dayFirst[1]), dayFirst[3] ? Number(dayFirst[3]) : null);
  // "nov 5", "november 5th"
  const monthFirst = text.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`));
  if (monthFirst) return resolveYear(MONTHS[monthFirst[1]], Number(monthFirst[2]), monthFirst[3] ? Number(monthFirst[3]) : null);

  const dayNames = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join("|");
  const weekday = text.match(new RegExp(`\\b(${dayNames})\\b`));
  if (weekday) {
    const target = WEEKDAYS[weekday[1]];
    const todayDow = new Date(today + "T00:00:00Z").getUTCDay();
    let ahead = (target - todayDow + 7) % 7;
    if (ahead === 0) ahead = 7;
    return addDays(today, ahead);
  }

  return null;
}

/** The reason, when the guardian gave one ("because ...", "due to ...", "sababu ...", or text after a comma/dash). */
export function parseAbsenceReason(rawText: string): string | null {
  const text = rawText.trim();
  const because = text.match(/(?:because(?: of)?|due to|since|sababu(?: ni)?|kwa sababu(?: ya)?)\s+(.+)$/i);
  let reason = because?.[1] ?? null;
  if (!reason) {
    const afterSep = text.match(/[,;:]\s*(.+)$|\s[-–—]\s+(.+)$/);
    reason = afterSep ? (afterSep[1] ?? afterSep[2]) : null;
  }
  if (!reason) return null;
  reason = reason.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  if (!reason) return null;
  return reason.slice(0, 300);
}

export function extractPhone(rawText: string): string | null {
  const m = rawText.match(PHONE_RE);
  return m ? m[0].trim() : null;
}

/**
 * Returns what the guardian is asking for, or null if the message is not clearly one of the two
 * requests (in which case the existing bot handles it exactly as before).
 */
export function classifyGuardianRequest(rawText: string, today: string): GuardianRequest | null {
  const text = rawText.trim().toLowerCase();
  if (!text || text.includes("?") || QUESTION_START.test(text)) return null;

  const phone = extractPhone(rawText);
  const wantsContact = NUMBER_WORDS.test(text) && CHANGE_WORDS.test(text);
  if (wantsContact) return { kind: "contact_update", phone };

  if (ABSENCE_CUES.test(text)) {
    return { kind: "absence_report", date: parseAbsenceDate(rawText, today), reason: parseAbsenceReason(rawText) };
  }

  return null;
}

/** "Wed 4 Nov 2026" style label for replies (date is YYYY-MM-DD). */
export function describeDate(iso: string, lang: "en" | "sw" = "en"): string {
  const d = new Date(iso + "T00:00:00Z");
  const days = lang === "sw"
    ? ["Jumapili", "Jumatatu", "Jumanne", "Jumatano", "Alhamisi", "Ijumaa", "Jumamosi"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = lang === "sw"
    ? ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ago", "Sep", "Okt", "Nov", "Des"]
    : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Picks the child a written note is about. Never uses the conversation cursor: a note names its child. */
export function pickChildByName<T extends { first_name: string }>(children: T[], messageText: string): T | null {
  if (children.length === 1) return children[0];
  const text = messageText.toLowerCase();
  const hits = children.filter((c) => {
    const n = c.first_name.trim().toLowerCase();
    return n.length > 0 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
  });
  return hits.length === 1 ? hits[0] : null;
}

// ---------------------------------------------------------------------------------------------------
// The handler. Lives in this file (no relative imports) so vitest/tsc can load it; everything it needs
// from the rest of the chatbot is passed in by dispatcher.ts. Called BEFORE the existing keyword
// intents, and only does anything when (a) feature.bot.guardian_requests is on for the school and (b)
// the message clearly is an absence note or a request to change the guardian's own number. Otherwise it
// returns null and the existing bot runs exactly as before.
//  * an absence message becomes a NOTE for the office (bot_submit_absence_report). It never writes to
//    the attendance register.
//  * a phone-number message becomes a QUEUED request (bot_submit_contact_update). The number is never
//    changed from chat: staff approve it on Communication > Bot requests. The reply goes to the number
//    we already hold, so someone who borrowed a phone cannot silently take over the account.
// Replies are fixed templates. Nothing here is generated by a model.

// deno-lint-ignore no-explicit-any
type AnySupabase = any;

export interface GuardianRequestContext {
  supabase: AnySupabase;
  schoolId: string;
  conversationId: string;
  guardianUserId: string;
  messageText: string;
  /** "sw" when the school has the menu flag and the guardian chose Kiswahili; otherwise English. */
  language?: "en" | "sw";
}

export interface GuardianRequestResult {
  replyText: string;
  escalate: boolean;
  escalationReason: "tool_error" | "authorization_denied" | null;
  studentId?: string | null;
}

export interface GuardianRequestDeps {
  escalationAck: string;
  /** True when the message asks for a human (the existing "agent" keywords); that always wins. */
  wantsHuman(text: string): boolean;
  getChildren(guardianUserId: string, schoolId: string): Promise<{ student_id: string; first_name: string }[]>;
  canAccessStudent(guardianUserId: string, studentId: string, schoolId: string): Promise<boolean>;
}

type Reply = (text: string) => GuardianRequestResult;
const say: Reply = (text) => ({ replyText: text, escalate: false, escalationReason: null });

export async function tryHandleGuardianRequest(
  ctx: GuardianRequestContext,
  deps: GuardianRequestDeps,
  now: Date = new Date(),
): Promise<GuardianRequestResult | null> {
  const { escalationAck } = deps;
  const L = (en: string, swText: string) => (ctx.language === "sw" ? swText : en);
  const handOff = (): GuardianRequestResult => ({ replyText: escalationAck, escalate: true, escalationReason: "tool_error" });

  // Fail closed: any problem asking about the flag means "feature off".
  let enabled = false;
  try {
    const { data, error } = await ctx.supabase.rpc("bot_guardian_requests_enabled", { p_school_id: ctx.schoolId });
    enabled = !error && data === true;
  } catch {
    enabled = false;
  }
  if (!enabled) return null;

  // A request for a human always wins.
  if (deps.wantsHuman(ctx.messageText)) return null;

  const today = nairobiToday(now);
  const request = classifyGuardianRequest(ctx.messageText, today);
  if (!request) return null;

  try {
    if (request.kind === "contact_update") {
      if (!request.phone) {
        return say(L("Please send the new number in one message, like: change my number to 0712345678", "Tafadhali tuma namba mpya kwa ujumbe mmoja, kama hivi: badilisha namba yangu mpya 0712345678"));
      }
      const { data, error } = await ctx.supabase.rpc("bot_submit_contact_update", {
        p_school_id: ctx.schoolId,
        p_conversation_id: ctx.conversationId,
        p_guardian_user_id: ctx.guardianUserId,
        p_new_phone: request.phone,
        p_raw_text: ctx.messageText,
      });
      if (error || !data) return handOff();
      if (data.ok) {
        return say(
          L(
            `Thank you. I've asked the school office to change your number to ${extractPhone(ctx.messageText)}. ` +
              "Nothing changes until the office confirms it, and until then we will keep using your current number.",
            `Asante. Nimeomba ofisi ya shule ibadilishe namba yako kuwa ${extractPhone(ctx.messageText)}. ` +
              "Hakuna kitakachobadilika hadi ofisi ithibitishe, na hadi wakati huo tutaendelea kutumia namba yako ya sasa.",
          ),
        );
      }
      switch (data.code) {
        case "bad_phone":
          return say(L("I couldn't read that as a Kenyan mobile number. Please send it like: change my number to 0712345678", "Sikuweza kusoma hiyo kama namba ya simu ya Kenya. Tafadhali tuma hivi: badilisha namba yangu mpya 0712345678"));
        case "same_number":
          return say(L("That is already the number we have for you, so nothing needs to change.", "Hiyo tayari ndiyo namba tuliyo nayo kwako, kwa hivyo hakuna cha kubadilisha."));
        case "rate_limited":
          return say(L("You have sent several requests today. Please type 'agent' to talk to the school office directly.", "Umetuma maombi kadhaa leo. Tafadhali andika 'agent' kuongea moja kwa moja na ofisi ya shule."));
        default:
          return handOff();
      }
    }

    // Absence note.
    const children = await deps.getChildren(ctx.guardianUserId, ctx.schoolId);
    if (children.length === 0) return handOff();
    const child = pickChildByName(children, ctx.messageText);
    if (!child) {
      const names = children.map((c) => c.first_name).join(", ");
      return say(
        L(
          `You have more than one child with us (${names}). Please include the child's first name, like: ${children[0].first_name} will be absent tomorrow`,
          `Una zaidi ya mtoto mmoja shuleni (${names}). Tafadhali weka jina la kwanza la mtoto, kama hivi: ${children[0].first_name} hatakuja kesho`,
        ),
      );
    }
    if (!request.date) {
      return say(
        L(
          `Which day will ${child.first_name} be absent? Please send it like: ${child.first_name} will be absent tomorrow, fever`,
          `${child.first_name} hatakuja siku gani? Tafadhali tuma hivi: ${child.first_name} hatakuja kesho, homa`,
        ),
      );
    }
    // Same gate every student-scoped tool goes through, right before the data is written.
    const authorized = await deps.canAccessStudent(ctx.guardianUserId, child.student_id, ctx.schoolId);
    if (!authorized) return { replyText: escalationAck, escalate: true, escalationReason: "authorization_denied" };

    const { data, error } = await ctx.supabase.rpc("bot_submit_absence_report", {
      p_school_id: ctx.schoolId,
      p_conversation_id: ctx.conversationId,
      p_guardian_user_id: ctx.guardianUserId,
      p_student_id: child.student_id,
      p_absence_date: request.date,
      p_reason: request.reason,
      p_raw_text: ctx.messageText,
    });
    if (error || !data) return handOff();
    const when = describeDate(request.date, ctx.language === "sw" ? "sw" : "en");
    if (data.ok) {
      const prefix = data.duplicate
        ? L(`I already have a note that ${child.first_name} will be absent on ${when}.`, `Tayari nina ujumbe kuwa ${child.first_name} hatakuja tarehe ${when}.`)
        : L(`Thank you. I've noted that ${child.first_name} will be absent on ${when}.`, `Asante. Nimeandika kuwa ${child.first_name} hatakuja tarehe ${when}.`);
      return {
        ...say(
          `${prefix} ${L(
            "This is a message to the school office; it does not change the attendance register.",
            "Huu ni ujumbe kwa ofisi ya shule; haubadilishi rejista ya mahudhurio.",
          )}`,
        ),
        studentId: child.student_id,
      };
    }
    switch (data.code) {
      case "bad_date":
        return say(L("I can only note an absence from yesterday up to 30 days ahead. Please send the day again, or type 'agent' to talk to the school office.", "Naweza kuandika kutokuwepo kuanzia jana hadi siku 30 zijazo tu. Tafadhali tuma siku tena, au andika 'agent' kuongea na ofisi ya shule."));
      case "rate_limited":
        return say(L("You have sent several requests today. Please type 'agent' to talk to the school office directly.", "Umetuma maombi kadhaa leo. Tafadhali andika 'agent' kuongea moja kwa moja na ofisi ya shule."));
      default:
        return handOff();
    }
  } catch (err) {
    console.error("[chatbot] guardian request failed:", err);
    return handOff();
  }
}

