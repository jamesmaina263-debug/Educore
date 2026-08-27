import type { ChatContext, DispatchResult } from "./types.ts";
import { classifyIntent, STUDENT_SCOPED_INTENTS } from "./intents.ts";
import { getGuardianChildren, resolveChildContext, disambiguationPrompt } from "./childContext.ts";
import { guardianCanAccessStudent } from "./authorize.ts";
import { TOOL_REGISTRY } from "./registry.ts";

export const GREETING_REPLY =
  "Hi! You can ask me about your child's fee balance or attendance. Type 'agent' any time to talk to the school office directly.";
export const ESCALATION_ACK =
  "I've passed your message to the school office -- someone will get back to you here on WhatsApp shortly.";

// The single place that decides "does the bot answer this, or does it go to a human" -- and,
// critically, the single place that runs authorization and picks up tool-level failures, so no
// individual tool has to remember to do either. Takes a channel-neutral ChatContext in, returns a
// channel-neutral DispatchResult out; the caller (a Twilio webhook today, potentially an SMS or
// web-chat adapter later) is responsible for actually delivering replyText and persisting the
// result, not this function.
export async function handleInboundMessage(ctx: ChatContext): Promise<DispatchResult> {
  const intent = classifyIntent(ctx.messageText);

  if (intent === "greeting") {
    return { replyText: GREETING_REPLY, escalate: false, escalationReason: null };
  }
  if (intent === "escalate") {
    return { replyText: ESCALATION_ACK, escalate: true, escalationReason: "explicit_request" };
  }
  if (intent === "unknown") {
    return { replyText: ESCALATION_ACK, escalate: true, escalationReason: "unrecognized_intent" };
  }

  if (!STUDENT_SCOPED_INTENTS.has(intent)) {
    // Defensive: every intent besides greeting/escalate/unknown should be student-scoped today.
    // If a future intent is added to classifyIntent without also being added to
    // STUDENT_SCOPED_INTENTS or handled above, fail safe to a human rather than silently no-op.
    return { replyText: ESCALATION_ACK, escalate: true, escalationReason: "unrecognized_intent" };
  }

  // Every student-scoped intent (today's two, and every one added later) goes through the same
  // disambiguation step -- this is what makes it "reusable across all intents" rather than
  // duplicated per tool.
  const children = await getGuardianChildren(ctx.supabase, ctx.guardianUserId, ctx.schoolId);
  if (children.length === 0) {
    return { replyText: ESCALATION_ACK, escalate: true, escalationReason: "tool_error" };
  }

  const { student, needsDisambiguation } = resolveChildContext(children, ctx.currentStudentId, ctx.messageText);
  if (needsDisambiguation || !student) {
    return { replyText: disambiguationPrompt(children), escalate: false, escalationReason: null };
  }

  if (intent === "switch_child") {
    return {
      replyText: `Switched -- I'll answer about ${student.first_name} from here. Ask me about fee balance or attendance.`,
      escalate: false,
      escalationReason: null,
      studentId: student.student_id,
    };
  }

  // Re-verify the guardian-student link right before running the tool -- see authorize.ts for
  // why this is a real check and not just re-deriving what resolveChildContext already implied.
  const authorized = await guardianCanAccessStudent(ctx.supabase, ctx.guardianUserId, student.student_id, ctx.schoolId);
  if (!authorized) {
    return { replyText: ESCALATION_ACK, escalate: true, escalationReason: "authorization_denied" };
  }

  const tool = TOOL_REGISTRY[intent];
  if (!tool) {
    return { replyText: ESCALATION_ACK, escalate: true, escalationReason: "unrecognized_intent" };
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
    return { replyText: ESCALATION_ACK, escalate: true, escalationReason: "tool_error" };
  }
}
