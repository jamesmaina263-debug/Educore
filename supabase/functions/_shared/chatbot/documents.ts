// deno-lint-ignore-file no-explicit-any
// Deliberately self-contained (structural types, config passed in, no Deno globals or jsr imports) so
// the same file runs in the edge function AND in the app's unit tests. A ChatContext /
// DispatchResult from types.ts satisfies these shapes.

export interface DocRpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }>;
}
export interface DocContext {
  supabase: DocRpcClient;
  schoolId: string;
  conversationId: string;
  guardianUserId: string;
  messageText: string;
}
export interface DocResult {
  replyText: string;
  escalate: boolean;
  escalationReason: "tool_error" | null;
  studentId?: string | null;
  document?: { url: string; filename: string; requestId: string };
}
/** Where the app's PDF route lives and its shared secret (read from the environment by the caller). */
export interface DocumentServiceConfig {
  url: string | undefined;
  secret: string | undefined;
}

// WhatsApp bot documents (feature.bot.documents): the latest released report card PDF and a fee
// statement PDF. Two rules shape everything here:
//   1. A phone number alone never unlocks a document. The guardian must first reply with the PIN
//      they set in the parent portal (bot_submit_pin: bcrypt, 5 wrong attempts lock it 30 minutes).
//   2. The bot never builds the document or its text from guesses. The PDF is produced by the
//      app's /api/bot/documents route from the same data the portal shows, after it re-checks the
//      guardian link and that the report card is released. Anything that goes wrong becomes a
//      hand-off to the school office, never a made-up answer.

export type DocType = "report_card" | "statement";

const PIN_PATTERN = /^[0-9]{4,6}$/;
export function looksLikePin(text: string): boolean {
  return PIN_PATTERN.test(text.trim());
}

export const NO_PIN_REPLY =
  "To receive documents on WhatsApp you first need a PIN. Sign in to the parent portal, set your WhatsApp PIN under \"WhatsApp documents\", then ask me again.";
export const DAILY_LIMIT_REPLY =
  "You've reached today's limit for documents on WhatsApp. Please try again tomorrow or contact the school office.";
export const PIN_LOCKED_REPLY =
  "Too many wrong PINs, so document requests are locked for 30 minutes. You can set a new PIN in the parent portal.";

function pinPrompt(docType: DocType, firstName: string): string {
  const what = docType === "report_card" ? "report card" : "fee statement";
  return `To send ${firstName}'s ${what}, please reply with your WhatsApp PIN (4 to 6 digits, set in the parent portal). This request expires in 5 minutes.`;
}

function wrongPinReply(attemptsLeft: number): string {
  return `That PIN isn't correct. You have ${attemptsLeft} ${attemptsLeft === 1 ? "try" : "tries"} left. Reply with your PIN, or send any other message to cancel.`;
}

export async function documentsEnabled(supabase: DocRpcClient, schoolId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("bot_documents_enabled", { p_school_id: schoolId });
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function pendingPinRequest(supabase: DocRpcClient, conversationId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("bot_pending_pin_request", { p_conversation_id: conversationId });
    return !error && typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}

// Called once the guardian, child and authorization are already settled (see dispatcher.ts).
export async function beginDocumentRequest(
  ctx: DocContext,
  docType: DocType,
  student: { student_id: string; first_name: string },
  escalationReply: string,
): Promise<DocResult> {
  const { data, error } = await ctx.supabase.rpc("bot_begin_document_request", {
    p_school_id: ctx.schoolId,
    p_conversation_id: ctx.conversationId,
    p_guardian_user_id: ctx.guardianUserId,
    p_student_id: student.student_id,
    p_doc_type: docType,
  });
  if (error || !data) {
    console.error("[chatbot] bot_begin_document_request failed:", error?.message);
    return { replyText: escalationReply, escalate: true, escalationReason: "tool_error" };
  }
  if (data.status === "no_pin") return { replyText: NO_PIN_REPLY, escalate: false, escalationReason: null, studentId: student.student_id };
  if (data.status === "daily_limit") return { replyText: DAILY_LIMIT_REPLY, escalate: false, escalationReason: null, studentId: student.student_id };
  return { replyText: pinPrompt(docType, student.first_name), escalate: false, escalationReason: null, studentId: student.student_id };
}

async function completeRequest(ctx: DocContext, requestId: string, status: "failed" | "denied", reason: string) {
  const { error } = await ctx.supabase.rpc("bot_complete_document_request", { p_request_id: requestId, p_status: status, p_reason: reason });
  if (error) console.error("[chatbot] bot_complete_document_request failed:", error.message);
}

// The guardian's message is a PIN for a pending request. Verify it; if right, have the app build
// the PDF and return it for the webhook to send. Returns null only when nothing was pending.
export async function submitPinAndDeliver(ctx: DocContext, escalationReply: string, service: DocumentServiceConfig): Promise<DocResult | null> {
  const { data, error } = await ctx.supabase.rpc("bot_submit_pin", { p_conversation_id: ctx.conversationId, p_pin: ctx.messageText.trim() });
  if (error || !data) {
    console.error("[chatbot] bot_submit_pin failed:", error?.message);
    return { replyText: escalationReply, escalate: true, escalationReason: "tool_error" };
  }
  switch (data.result) {
    case "none":
      return null;
    case "no_pin":
      return { replyText: NO_PIN_REPLY, escalate: false, escalationReason: null };
    case "locked":
      return { replyText: PIN_LOCKED_REPLY, escalate: false, escalationReason: null };
    case "wrong":
      return { replyText: wrongPinReply(Number(data.attempts_left ?? 0)), escalate: false, escalationReason: null };
    case "ok":
      return await deliver(ctx, String(data.request_id), String(data.student_id), escalationReply, service);
    default:
      return { replyText: escalationReply, escalate: true, escalationReason: "tool_error" };
  }
}

async function deliver(ctx: DocContext, requestId: string, studentId: string, escalationReply: string, service: DocumentServiceConfig): Promise<DocResult> {
  const { url, secret } = service;
  const fail = async (reason: string): Promise<DocResult> => {
    await completeRequest(ctx, requestId, "failed", reason);
    return { replyText: escalationReply, escalate: true, escalationReason: "tool_error" };
  };
  if (!url || !secret) return await fail("BOT_DOCUMENTS_URL / BOT_DOCUMENTS_SECRET not configured");

  let body: any;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId }),
      // Twilio gives the webhook about 15s in total, so the PDF service gets 12s at most.
      signal: AbortSignal.timeout(12000),
    });
    body = await res.json().catch(() => null);
    if (!res.ok && !(body && body.ok === false)) return await fail(`document service returned ${res.status}`);
  } catch (err) {
    return await fail(`document service unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (body?.ok === true && typeof body.url === "string" && typeof body.filename === "string" && typeof body.caption === "string") {
    return {
      replyText: body.caption,
      escalate: false,
      escalationReason: null,
      studentId,
      document: { url: body.url, filename: body.filename, requestId },
    };
  }
  if (body?.ok === false && body.code === "not_available" && typeof body.message === "string") {
    await completeRequest(ctx, requestId, "denied", String(body.code));
    return { replyText: body.message, escalate: false, escalationReason: null, studentId };
  }
  return await fail(`document service refused: ${String(body?.code ?? "unknown")}`);
}
