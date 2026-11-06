import type { ChatContext, DispatchResult } from "./types.ts";
import { classifyIntent, STUDENT_SCOPED_INTENTS } from "./intents.ts";
import { getGuardianChildren, resolveChildContext, disambiguationPrompt } from "./childContext.ts";
import { guardianCanAccessStudent } from "./authorize.ts";
import { TOOL_REGISTRY } from "./registry.ts";
import { tryHandleGuardianRequest } from "./guardianRequests.ts";
import { chatText, menuText, prepareMenuTurn } from "./menu.ts";
import { mentionsBus } from "./bus.ts";
import { tryHandleBotPay } from "./pay.ts";
import { beginDocumentRequest, documentsEnabled, looksLikePin, pendingPinRequest, submitPinAndDeliver } from "./documents.ts";

export const GREETING_REPLY =
  "Hi! You can ask me about your child's fee balance or attendance. Type 'agent' any time to talk to the school office directly.";
export const ESCALATION_ACK =
  "I've passed your message to the school office -- someone will get back to you here on WhatsApp shortly.";

// Sends an already-created STK request through mpesa-stk-push's INTERNAL mode (WP 1.3b), authenticated with the
// shared DISPATCH_SECRET, the same server-to-server path mpesa-stk-query and send-communication use. True only if the
// push was accepted. Never logs the secret or the phone number.
async function dispatchStkPush(requestId: string): Promise<boolean> {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("DISPATCH_SECRET");
  if (!baseUrl || !secret) return false;
  const res = await fetch(`${baseUrl}/functions/v1/mpesa-stk-push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-dispatch-secret": secret },
    body: JSON.stringify({ request_id: requestId }),
    signal: AbortSignal.timeout(20_000),
  });
  return res.ok;
}

// The single place that decides "does the bot answer this, or does it go to a human" -- and,
// critically, the single place that runs authorization and picks up tool-level failures, so no
// individual tool has to remember to do either. Takes a channel-neutral ChatContext in, returns a
// channel-neutral DispatchResult out; the caller (a Twilio webhook today, potentially an SMS or
// web-chat adapter later) is responsible for actually delivering replyText and persisting the
// result, not this function.
export async function handleInboundMessage(inputCtx: ChatContext): Promise<DispatchResult> {
  let ctx = inputCtx;
  // WhatsApp bot documents are strictly opt-in per school (feature.bot.documents). With the flag
  // off nothing below changes: no PIN handling, and "report"/"statement" classify as before.
  const documents = await documentsEnabled(ctx.supabase, ctx.schoolId);

  // A guardian who was just asked for their PIN: a 4-6 digit reply IS the PIN. Handled before anything
  // else because it answers the bot's own question. Any other message leaves the request to expire
  // (5 minutes) and is handled normally below.
  if (documents && looksLikePin(ctx.messageText) && (await pendingPinRequest(ctx.supabase, ctx.conversationId))) {
    const pinResult = await submitPinAndDeliver(ctx, ESCALATION_ACK, {
      url: Deno.env.get("BOT_DOCUMENTS_URL"),
      secret: Deno.env.get("BOT_DOCUMENTS_SECRET"),
    });
    if (pinResult) return pinResult;
  }

  // Phase 2.7+2.8: menu, numbered replies and Kiswahili. prepareMenuTurn returns null (after one flag lookup,
  // failing closed) unless the school has feature.bot.menu on, in which case everything below behaves exactly
  // as before: English text, no menu.
  const menu = await prepareMenuTurn({
    supabase: ctx.supabase,
    schoolId: ctx.schoolId,
    conversationId: ctx.conversationId,
    messageText: ctx.messageText,
    documents,
    getChildren: () => getGuardianChildren(ctx.supabase, ctx.guardianUserId, ctx.schoolId),
  });
  if (menu?.reply) {
    return { replyText: menu.reply.text, escalate: false, escalationReason: null, studentId: menu.reply.studentId };
  }
  if (menu) ctx = { ...ctx, language: menu.language, messageText: menu.text };
  const ack = menu ? chatText(menu.language, "ack") : ESCALATION_ACK;

  // Phase 2.4+2.5: absence notes and phone-number change requests. Returns null (and costs one flag
  // lookup) unless the school has feature.bot.guardian_requests on AND the message clearly is one of
  // those two requests, so every other message takes exactly the path below as before.
  const guardianRequest = await tryHandleGuardianRequest(ctx, {
    escalationAck: ack,
    wantsHuman: (text) => classifyIntent(text) === "escalate",
    getChildren: (guardianUserId, schoolId) => getGuardianChildren(ctx.supabase, guardianUserId, schoolId),
    canAccessStudent: (guardianUserId, studentId, schoolId) => guardianCanAccessStudent(ctx.supabase, guardianUserId, studentId, schoolId),
  });
  if (guardianRequest) return guardianRequest;

  // WP 2.3 bot pay: only a message that parses as "pay ...", YES or NO does anything here, and "pay ..." costs one
  // flag lookup (feature.bot.pay AND M-Pesa active). With the flag off, or for any other message, this returns null
  // and everything below behaves exactly as before. All money rules live in the bot_guardian_pay_* functions.
  try {
    const pay = await tryHandleBotPay(
      {
        supabase: ctx.supabase,
        schoolId: ctx.schoolId,
        conversationId: ctx.conversationId,
        guardianUserId: ctx.guardianUserId,
        currentStudentId: ctx.currentStudentId,
        messageText: ctx.messageText,
        language: ctx.language,
      },
      {
        getChildren: () => getGuardianChildren(ctx.supabase, ctx.guardianUserId, ctx.schoolId),
        resolveChild: resolveChildContext,
        canAccessStudent: (studentId) => guardianCanAccessStudent(ctx.supabase, ctx.guardianUserId, studentId, ctx.schoolId),
        dispatchPush: dispatchStkPush,
        escalationAck: ack,
      },
    );
    if (pay) return pay;
  } catch (err) {
    console.error("[chatbot] Pay flow failed:", err);
    return { replyText: ack, escalate: true, escalationReason: "tool_error" };
  }

  // WP 5.3 bot part: one flag lookup, and only for a message that actually mentions the bus. Fails closed.
  let bus = false;
  if (mentionsBus(ctx.messageText)) {
    try {
      const { data } = await ctx.supabase.rpc("bot_bus_enabled", { p_school_id: ctx.schoolId });
      bus = data === true;
    } catch {
      bus = false;
    }
  }
  const intent = classifyIntent(ctx.messageText, { documents, bus });

  if (intent === "greeting") {
    return { replyText: menu ? menuText(menu.language, menu.features) : GREETING_REPLY, escalate: false, escalationReason: null };
  }
  if (intent === "escalate") {
    return { replyText: ack, escalate: true, escalationReason: "explicit_request" };
  }
  if (intent === "unknown") {
    return { replyText: ack, escalate: true, escalationReason: "unrecognized_intent" };
  }

  if (!STUDENT_SCOPED_INTENTS.has(intent)) {
    // Defensive: every intent besides greeting/escalate/unknown should be student-scoped today.
    // If a future intent is added to classifyIntent without also being added to
    // STUDENT_SCOPED_INTENTS or handled above, fail safe to a human rather than silently no-op.
    return { replyText: ack, escalate: true, escalationReason: "unrecognized_intent" };
  }

  // Every student-scoped intent (today's two, and every one added later) goes through the same
  // disambiguation step -- this is what makes it "reusable across all intents" rather than
  // duplicated per tool.
  const children = await getGuardianChildren(ctx.supabase, ctx.guardianUserId, ctx.schoolId);
  if (children.length === 0) {
    return { replyText: ack, escalate: true, escalationReason: "tool_error" };
  }

  const { student, needsDisambiguation } = resolveChildContext(children, ctx.currentStudentId, ctx.messageText);
  if (needsDisambiguation || !student) {
    return {
      replyText: menu
        ? chatText(menu.language, "disambiguate", { names: children.map((c) => c.first_name).join(", ") })
        : disambiguationPrompt(children),
      escalate: false,
      escalationReason: null,
    };
  }

  if (intent === "switch_child") {
    return {
      replyText: menu
        ? chatText(menu.language, "switched", { name: student.first_name })
        : `Switched -- I'll answer about ${student.first_name} from here. Ask me about fee balance or attendance.`,
      escalate: false,
      escalationReason: null,
      studentId: student.student_id,
    };
  }

  // Re-verify the guardian-student link right before running the tool -- see authorize.ts for
  // why this is a real check and not just re-deriving what resolveChildContext already implied.
  const authorized = await guardianCanAccessStudent(ctx.supabase, ctx.guardianUserId, student.student_id, ctx.schoolId);
  if (!authorized) {
    return { replyText: ack, escalate: true, escalationReason: "authorization_denied" };
  }

  // Documents are not a one-shot tool: they need the PIN round trip first (see documents.ts).
  // These intents are only ever produced when the school has the feature on.
  if (intent === "report_card" || intent === "statement") {
    try {
      return await beginDocumentRequest(ctx, intent, student, ack);
    } catch (err) {
      console.error(`[chatbot] Document request "${intent}" failed:`, err);
      return { replyText: ack, escalate: true, escalationReason: "tool_error" };
    }
  }

  const tool = TOOL_REGISTRY[intent];
  if (!tool) {
    return { replyText: ack, escalate: true, escalationReason: "unrecognized_intent" };
  }

  try {
    const result = await tool.run(ctx, student.student_id);
    return {
      replyText: result.replyText,
      escalate: false,
      escalationReason: null,
      studentId: result.studentId !== undefined ? result.studentId : student.student_id,
    };
  } catch (err) {
    console.error(`[chatbot] Tool "${tool.key}" failed:`, err);
    return { replyText: ack, escalate: true, escalationReason: "tool_error" };
  }
}
