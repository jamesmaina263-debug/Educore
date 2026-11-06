// WP 2.3: "pay fees" over the WhatsApp bot. Pure (no imports, no Deno globals) so the same file runs in the edge
// function AND in the app's unit tests (src/lib/bot-pay.test.ts).
//
// The bot only PARSES what the guardian typed and FORMATS what the database returned. Every rule (guardian linked to
// this learner, whole shillings, minimum KES 10, never above the outstanding balance, 10-minute confirmation, one
// prompt at a time, rate limits, the prompt going only to the guardian's OWN registered number) lives in the
// bot_guardian_pay_* functions and is enforced there. A number typed in chat is never used. The bot never sees or asks
// for a PIN: the guardian enters it on their own phone in the M-Pesa prompt. Anything unexpected throws, and the
// dispatcher turns that into "pass to the school office", never into a guess about money.

export type PayLang = "en" | "sw";
export type PayMessage =
  | { kind: "pay"; amount: number | "all" | null }
  | { kind: "yes" }
  | { kind: "no" };

const YES = new Set(["yes", "y", "ndio", "ndiyo", "confirm", "thibitisha"]);
const NO = new Set(["no", "n", "hapana", "cancel", "ghairi", "acha"]);
const QUESTION_START = /^(how|can|could|do|does|did|is|are|what|when|where|why|je|ni|naweza|nawezaje)\b/;
const AMOUNT_RE = /\d[\d,]*(?:\.\d+)?/g;
const ALL_RE = /\b(all|everything|yote|zote)\b/;

/** What the message means for the pay flow, or null when it is none of our business (so the bot behaves exactly as before). */
export function classifyPayMessage(rawText: string): PayMessage | null {
  const text = rawText.trim().toLowerCase().replace(/[.!?\s]+$/g, "");
  if (text === "") return null;
  if (YES.has(text)) return { kind: "yes" };
  if (NO.has(text)) return { kind: "no" };
  if (QUESTION_START.test(text)) return null;
  if (!/^(pay|lipa)\b/.test(text)) return null;
  const rest = text.replace(/^(pay|lipa)\b/, "");
  if (rest.includes("?")) return null;
  const numbers = rest.match(AMOUNT_RE) ?? [];
  if (numbers.length > 1) return null; // ambiguous: ask them to send one amount
  if (numbers.length === 1) {
    if (ALL_RE.test(rest)) return null;
    const n = Number(numbers[0].replace(/,/g, ""));
    return Number.isFinite(n) ? { kind: "pay", amount: n } : null;
  }
  return { kind: "pay", amount: ALL_RE.test(rest) ? "all" : null };
}

export type PrepareResult =
  | { status: "ask_amount"; balance: number }
  | { status: "awaiting_confirm"; amount: number; balance: number; phoneLast3: string }
  | { status: "no_balance" | "too_low" | "not_whole" | "rate_limited" | "disabled" | "forbidden" | "not_configured" }
  | { status: "too_high"; balance: number };

export type ConfirmResult =
  | { status: "started"; requestId: string; amount: number }
  | { status: "none" | "expired" | "in_progress" | "rate_limited" | "disabled" | "forbidden" | "not_configured" }
  | { status: "too_high"; balance: number };

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Fails closed: returns null for anything unrecognised. */
export function parsePrepareResult(raw: unknown): PrepareResult | null {
  if (!isRecord(raw) || typeof raw.status !== "string") return null;
  switch (raw.status) {
    case "ask_amount": {
      const balance = num(raw.balance);
      return balance !== null && balance > 0 ? { status: "ask_amount", balance } : null;
    }
    case "awaiting_confirm": {
      const amount = num(raw.amount);
      const balance = num(raw.balance);
      const last3 = typeof raw.phone_last3 === "string" && /^\d{3}$/.test(raw.phone_last3) ? raw.phone_last3 : null;
      return amount !== null && balance !== null && last3 ? { status: "awaiting_confirm", amount, balance, phoneLast3: last3 } : null;
    }
    case "too_high": {
      const balance = num(raw.balance);
      return balance !== null ? { status: "too_high", balance } : null;
    }
    case "no_balance": case "too_low": case "not_whole": case "rate_limited": case "disabled": case "forbidden": case "not_configured":
      return { status: raw.status };
    default:
      return null;
  }
}

export function parseConfirmResult(raw: unknown): ConfirmResult | null {
  if (!isRecord(raw) || typeof raw.status !== "string") return null;
  switch (raw.status) {
    case "started": {
      const amount = num(raw.amount);
      return typeof raw.request_id === "string" && amount !== null ? { status: "started", requestId: raw.request_id, amount } : null;
    }
    case "too_high": {
      const balance = num(raw.balance);
      return balance !== null ? { status: "too_high", balance } : null;
    }
    case "none": case "expired": case "in_progress": case "rate_limited": case "disabled": case "forbidden": case "not_configured":
      return { status: raw.status };
    default:
      return null;
  }
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;

/** Fixed English / Kiswahili templates. The Kiswahili is a first draft: needs native review (open item O-34). */
export const PAY_TEXT = {
  askAmount: (l: PayLang, name: string, balance: number) =>
    l === "sw"
      ? `Salio la ada la ${name} ni ${kes(balance)}. Kulipa kwa M-Pesa, jibu PAY <kiasi> (mfano PAY 2000) au PAY ALL. Ujumbe wa malipo utatumwa kwenye namba uliyosajili shuleni.`
      : `${name}'s outstanding fee balance is ${kes(balance)}. To pay by M-Pesa reply PAY <amount> (for example PAY 2000) or PAY ALL. The prompt goes to the number you registered with the school.`,
  confirm: (l: PayLang, name: string, amount: number, last3: string) =>
    l === "sw"
      ? `Lipa ${kes(amount)} kwa ada ya ${name} kupitia M-Pesa? Ujumbe wa malipo utatumwa kwenye namba yako uliyosajili inayoishia ${last3}. Jibu NDIO kuthibitisha au HAPANA kughairi.`
      : `Pay ${kes(amount)} for ${name}'s fees by M-Pesa? A prompt will be sent to your registered number ending ${last3}. Reply YES to confirm or NO to cancel.`,
  started: (l: PayLang, amount: number) =>
    l === "sw"
      ? `Nimetuma ujumbe wa M-Pesa wa ${kes(amount)} kwenye namba yako uliyosajili. Weka PIN yako ya M-Pesa kwenye simu yako kulipa. Usimpe mtu yeyote PIN yako, hata mimi. Shule hurekodi malipo moja kwa moja M-Pesa ikithibitisha.`
      : `I've sent an M-Pesa prompt for ${kes(amount)} to your registered number. Enter your M-Pesa PIN on your phone to pay. Never share your PIN with anyone, including me. The school records the payment automatically once M-Pesa confirms it.`,
  cancelled: (l: PayLang) => (l === "sw" ? "Sawa, nimeghairi. Hakuna malipo yaliyotumwa." : "OK, cancelled. No payment was sent."),
  noBalance: (l: PayLang, name: string) =>
    l === "sw" ? `${name} hana salio la ada linalodaiwa kwa sasa, kwa hivyo hakuna cha kulipa.` : `${name} has no outstanding fee balance right now, so there is nothing to pay.`,
  tooLow: (l: PayLang) => (l === "sw" ? "Kiasi cha chini ni KES 10. Tafadhali jaribu tena, mfano PAY 500." : "The minimum is KES 10. Please try again, for example PAY 500."),
  notWhole: (l: PayLang) => (l === "sw" ? "Tafadhali tumia shilingi kamili, mfano PAY 500." : "Please use whole shillings, for example PAY 500."),
  tooHigh: (l: PayLang, balance: number) =>
    l === "sw" ? `Kiasi hicho kinazidi salio linalodaiwa la ${kes(balance)}. Tafadhali tuma kiasi kisichozidi hicho, au PAY ALL.` : `That is more than the outstanding balance of ${kes(balance)}. Please send an amount up to that, or PAY ALL.`,
  rateLimited: (l: PayLang) => (l === "sw" ? "Majaribio mengi sana. Tafadhali subiri kidogo kisha ujaribu tena." : "Too many attempts. Please wait a while and try again."),
  inProgress: (l: PayLang) =>
    l === "sw" ? "Ujumbe wa malipo ulishatumwa kwenye simu yako. Tafadhali uidhinishe, au usubiri dakika mbili kisha ujaribu tena." : "A payment prompt was just sent to your phone. Please approve it, or wait two minutes and try again.",
  expired: (l: PayLang) => (l === "sw" ? "Uthibitisho umeisha muda. Tuma PAY <kiasi> tena ukitaka kulipa." : "That confirmation has expired. Send PAY <amount> again if you still want to pay."),
  pushFailed: (l: PayLang) =>
    l === "sw" ? "Sikuweza kutuma ujumbe wa M-Pesa sasa hivi. Hakuna pesa iliyokatwa. Tafadhali subiri dakika mbili kisha ujaribu tena." : "I couldn't send the M-Pesa prompt just now. Nothing has been charged. Please wait two minutes and try again.",
  disambiguate: (l: PayLang, names: string) =>
    l === "sw" ? `Una zaidi ya mtoto mmoja (${names}). Tafadhali andika PAY ikifuatiwa na jina la mtoto, mfano PAY 2000 ${names.split(", ")[0]}.` : `You have more than one child with us (${names}). Please send PAY with the child's first name, for example PAY 2000 ${names.split(", ")[0]}.`,
};

// ---- The handler (structural types so it needs no imports) ---------------------------------------------------

export interface PayRpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}
export interface PayChild { student_id: string; first_name: string }
export interface PayCtx {
  supabase: PayRpcClient;
  schoolId: string;
  conversationId: string;
  guardianUserId: string;
  currentStudentId: string | null;
  messageText: string;
  language?: PayLang;
}
export interface PayDeps {
  getChildren(): Promise<PayChild[]>;
  /** Picks the child (name in the message, conversation cursor, only child) like every other student-scoped answer. */
  resolveChild(children: PayChild[], currentStudentId: string | null, text: string): { student: PayChild | null; needsDisambiguation: boolean };
  canAccessStudent(studentId: string): Promise<boolean>;
  /** Sends the already-created STK request through mpesa-stk-push's internal mode. True only if the push was accepted. */
  dispatchPush(requestId: string): Promise<boolean>;
  escalationAck: string;
}
export interface PayReply {
  replyText: string;
  escalate: boolean;
  escalationReason: "tool_error" | "authorization_denied" | null;
  studentId?: string | null;
}

const reply = (replyText: string, studentId?: string | null): PayReply => ({ replyText, escalate: false, escalationReason: null, ...(studentId !== undefined ? { studentId } : {}) });

/**
 * Returns null when the message is not part of the pay flow (or the school has it off), so the bot behaves exactly
 * as before. Throws on any database error or answer it must not act on; the dispatcher escalates to the office.
 */
export async function tryHandleBotPay(ctx: PayCtx, deps: PayDeps): Promise<PayReply | null> {
  const msg = classifyPayMessage(ctx.messageText);
  if (!msg) return null;
  const lang: PayLang = ctx.language === "sw" ? "sw" : "en";
  const escalate = (reason: "tool_error" | "authorization_denied"): PayReply => ({ replyText: deps.escalationAck, escalate: true, escalationReason: reason });
  const ids = { p_school_id: ctx.schoolId, p_conversation_id: ctx.conversationId, p_guardian_user_id: ctx.guardianUserId };

  if (msg.kind === "no") {
    const { data, error } = await ctx.supabase.rpc("bot_guardian_pay_cancel", ids);
    if (error) throw new Error(`bot_guardian_pay_cancel failed: ${error.message}`);
    return data === true ? reply(PAY_TEXT.cancelled(lang)) : null;
  }

  if (msg.kind === "yes") {
    const { data, error } = await ctx.supabase.rpc("bot_guardian_pay_confirm", ids);
    if (error) throw new Error(`bot_guardian_pay_confirm failed: ${error.message}`);
    const r = parseConfirmResult(data);
    if (!r) throw new Error("bot_guardian_pay_confirm returned a status the bot does not act on");
    switch (r.status) {
      case "none": case "disabled": return null; // nothing awaiting confirmation (or feature off): not ours
      case "started": {
        const ok = await deps.dispatchPush(r.requestId).catch(() => false);
        // If the push could not be sent the request stays pending: the stale-pending watchdog reconciles it. It is
        // deliberately NOT marked failed here, because the push may have reached Safaricom.
        return reply(ok ? PAY_TEXT.started(lang, r.amount) : PAY_TEXT.pushFailed(lang));
      }
      case "expired": return reply(PAY_TEXT.expired(lang));
      case "in_progress": return reply(PAY_TEXT.inProgress(lang));
      case "rate_limited": return reply(PAY_TEXT.rateLimited(lang));
      case "too_high": return reply(PAY_TEXT.tooHigh(lang, r.balance));
      case "forbidden": return escalate("authorization_denied");
      case "not_configured": return escalate("tool_error");
    }
  }

  // msg.kind === "pay": only for schools that have it on (one flag lookup). Off or unknown: not ours.
  const { data: enabled, error: enabledError } = await ctx.supabase.rpc("bot_pay_enabled", { p_school_id: ctx.schoolId });
  if (enabledError) throw new Error(`bot_pay_enabled failed: ${enabledError.message}`);
  if (enabled !== true) return null;

  const children = await deps.getChildren();
  if (children.length === 0) return escalate("tool_error");
  const { student, needsDisambiguation } = deps.resolveChild(children, ctx.currentStudentId, ctx.messageText);
  if (needsDisambiguation || !student) {
    return reply(PAY_TEXT.disambiguate(lang, children.map((c) => c.first_name).join(", ")));
  }
  if (!(await deps.canAccessStudent(student.student_id))) return escalate("authorization_denied");

  const prepare = async (amount: number | null): Promise<PrepareResult> => {
    const { data, error } = await ctx.supabase.rpc("bot_guardian_pay_prepare", { ...ids, p_student_id: student.student_id, p_amount: amount });
    if (error) throw new Error(`bot_guardian_pay_prepare failed: ${error.message}`);
    const r = parsePrepareResult(data);
    if (!r) throw new Error("bot_guardian_pay_prepare returned a status the bot does not act on");
    return r;
  };

  let result: PrepareResult;
  if (msg.amount === "all") {
    const first = await prepare(null);
    result = first.status === "ask_amount" ? await prepare(first.balance) : first;
  } else {
    result = await prepare(msg.amount);
  }

  switch (result.status) {
    case "ask_amount": return reply(PAY_TEXT.askAmount(lang, student.first_name, result.balance), student.student_id);
    case "awaiting_confirm": return reply(PAY_TEXT.confirm(lang, student.first_name, result.amount, result.phoneLast3), student.student_id);
    case "no_balance": return reply(PAY_TEXT.noBalance(lang, student.first_name), student.student_id);
    case "too_low": return reply(PAY_TEXT.tooLow(lang));
    case "not_whole": return reply(PAY_TEXT.notWhole(lang));
    case "too_high": return reply(PAY_TEXT.tooHigh(lang, result.balance));
    case "rate_limited": return reply(PAY_TEXT.rateLimited(lang));
    case "disabled": return null;
    case "forbidden": return escalate("authorization_denied");
    case "not_configured": return escalate("tool_error");
  }
}
