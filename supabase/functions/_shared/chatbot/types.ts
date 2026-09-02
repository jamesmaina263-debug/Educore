// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2.112.4";

// Deliberately channel-neutral: nothing in this file (or anywhere under _shared/chatbot/) knows
// about Twilio, WhatsApp, or HTTP form-encoding. A future SMS or web-chat channel builds one of
// these from its own inbound payload and gets the same intent classification, authorization, and
// tool execution for free. All Twilio-specific plumbing (signature verification, the provider
// that actually sends a WhatsApp message) stays in _shared/whatsapp/.
export interface ChatContext {
  supabase: SupabaseClient<any, any, any>;
  schoolId: string;
  conversationId: string;
  guardianUserId: string;
  currentStudentId: string | null;
  messageText: string;
}

export type EscalationReason =
  | "explicit_request" // guardian asked for a human
  | "unrecognized_intent" // the bot couldn't classify the message
  | "authorization_denied" // guardian isn't linked to the student they asked about
  | "ambiguous_school" // resolved at the channel-adapter layer, before a ChatContext even exists
  | "tool_error"; // a tool's data lookup failed, or returned nothing usable

export interface DispatchResult {
  replyText: string;
  escalate: boolean;
  escalationReason: EscalationReason | null;
  // When set, the caller should update the conversation's student_id cursor. Distinguished from
  // "not provided" (leave the cursor alone) by using undefined vs null/string, same convention as
  // the whatsapp_conversations update elsewhere.
  studentId?: string | null;
}

export interface ToolResult {
  replyText: string;
  studentId?: string | null;
}

// A tool is "intent -> verified data -> templated response." The AI/keyword layer only ever
// selects *which* tool runs and *which student* it runs for -- it never generates the factual
// content of run()'s result itself. That boundary is the whole point of this architecture (see
// the migration/dispatcher comments): a wrong keyword match produces an escalation, never an
// invented fee balance.
export interface ToolDefinition {
  key: string;
  run(ctx: ChatContext, studentId: string): Promise<ToolResult>;
}
