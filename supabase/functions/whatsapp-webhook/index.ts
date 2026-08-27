import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyTwilioSignature } from "../_shared/whatsapp/verifyTwilioSignature.ts";
import { getWhatsAppProvider } from "../_shared/whatsapp/index.ts";
import { handleInboundMessage, ESCALATION_ACK } from "../_shared/chatbot/dispatcher.ts";
import type { EscalationReason } from "../_shared/chatbot/types.ts";

// Public endpoint -- deploy with --no-verify-jwt (Twilio cannot send a Supabase JWT). Authenticity
// is instead established per-request via the Twilio signature (see verifyTwilioSignature.ts).
// This function must be idempotent and fast: Twilio retries if it doesn't get a timely 2xx, so
// every path below returns 200 with empty TwiML even on internal failure (logged, not surfaced to
// Twilio) -- returning a non-2xx here would just cause Twilio to hammer the same message again.
// Idempotency itself is handled explicitly below (whatsapp_messages_inbound_sid_unique), not just
// assumed from "well, we return 200" -- a slow first response can still race a Twilio retry.
const EMPTY_TWIML = new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
  status: 200,
  headers: { "Content-Type": "text/xml" },
});

const AMBIGUOUS_SCHOOL_REPLY =
  "This number is registered as a guardian at more than one school with us, so I can't tell which one you mean here. Please contact the school office directly for now.";
const UNRECOGNIZED_SENDER_REPLY =
  "We couldn't match this number to a guardian record on file. Please contact your school's office directly, or message from the phone number registered with the school.";
const RATE_LIMITED_REPLY = "You're sending messages a little too quickly -- please wait a few minutes and try again.";

function normalizePhone(twilioFrom: string): string {
  // Twilio sends "whatsapp:+2547XXXXXXXX" -- strip the channel prefix, keep the E.164 number as-is
  // (matching how phone numbers are stored elsewhere in the app, e.g. request-otp's +254 format).
  return twilioFrom.replace(/^whatsapp:/, "").trim();
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) {
    console.error("[whatsapp-webhook] TWILIO_AUTH_TOKEN not configured -- cannot verify inbound requests, rejecting.");
    return new Response("Not configured", { status: 500 });
  }

  const bodyText = await req.text();
  const params = Object.fromEntries(new URLSearchParams(bodyText));

  const signature = req.headers.get("X-Twilio-Signature");
  // Twilio signs the exact URL it was configured to POST to. If this function sits behind a proxy
  // that rewrites the URL, set TWILIO_WEBHOOK_URL to the externally-configured URL explicitly
  // rather than trusting req.url.
  const requestUrl = Deno.env.get("TWILIO_WEBHOOK_URL") ?? req.url;
  const isValid = await verifyTwilioSignature(requestUrl, params, signature, authToken);
  if (!isValid) {
    console.warn("[whatsapp-webhook] Signature verification failed -- rejecting request.");
    return new Response("Invalid signature", { status: 403 });
  }

  const from = params["From"];
  const to = params["To"];
  const body = (params["Body"] ?? "").trim();
  const messageSid = params["MessageSid"] ?? null;

  if (!from || !body) {
    return EMPTY_TWIML;
  }

  const phoneNumber = normalizePhone(from);
  const toNumber = to ? normalizePhone(to) : null;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Returns whether the send actually succeeded (and the error, if not) instead of only
  // logging on failure -- the pre-dispatcher early-return replies (rate-limited, unrecognized
  // sender, ambiguous school) are best-effort by nature and stay fire-and-forget, but the bot's
  // actual answer to a guardian's question is logged to whatsapp_messages afterward and must
  // reflect what really happened, not always claim "sent". Same status/provider_response
  // pattern as whatsapp-send-reply's staff-reply path.
  const sendReply = async (phone: string, text: string): Promise<{ ok: boolean; error: string | null }> => {
    try {
      await getWhatsAppProvider().send(phone, text);
      return { ok: true, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[whatsapp-webhook] Failed to send reply:", message);
      return { ok: false, error: message };
    }
  };

  try {
    // Rate limiting, before any other work: caps abuse (a compromised/malicious sender hammering
    // the bot, or a script probing many numbers) and, once tools call paid/costed operations
    // later, caps the blast radius of a runaway loop. Reuses the same primitive request-otp
    // already relies on for an analogous "public, phone-keyed, unauthenticated endpoint" shape.
    const [{ data: withinPhoneLimit }, { data: withinGlobalLimit }] = await Promise.all([
      supabase.rpc("increment_and_check_rate_limit", {
        p_bucket: `whatsapp-inbound-phone:${phoneNumber}`,
        p_max_events: 20,
        p_window_seconds: 600, // 20 messages per 10 minutes per sender
      }),
      supabase.rpc("increment_and_check_rate_limit", {
        p_bucket: "whatsapp-inbound-global",
        p_max_events: 2000,
        p_window_seconds: 3600, // a coarse deployment-wide ceiling, not a per-school one -- there's
        // no resolved school yet at this point, and number-spoofing/volume abuse doesn't respect
        // tenant boundaries anyway
      }),
    ]);
    if (withinPhoneLimit === false || withinGlobalLimit === false) {
      await sendReply(phoneNumber, RATE_LIMITED_REPLY);
      return EMPTY_TWIML;
    }

    // --- Resolve school -----------------------------------------------------------------------
    // Preferred path: the inbound `To` number is a school's own dedicated Twilio sender
    // (channel_numbers). Falls back to matching the sender's phone across every school's
    // guardians when no row claims that number -- which is every case today, since the
    // deployment currently runs one shared TWILIO_WHATSAPP_FROM (see migration comment on
    // channel_numbers). This fallback is the same known limitation flagged there: a phone that's
    // a guardian at more than one school can't be routed automatically until dedicated numbers
    // are provisioned.
    let schoolId: string | null = null;
    if (toNumber) {
      const { data: numberRow } = await supabase
        .from("channel_numbers")
        .select("school_id")
        .eq("phone_number", toNumber)
        .eq("active", true)
        .maybeSingle();
      schoolId = numberRow?.school_id ?? null;
    }

    let guardianUserId: string;

    if (schoolId) {
      // Number is dedicated to exactly one school -- guardian lookup is scoped to it directly, no
      // ambiguity possible regardless of how many schools this phone is a guardian at elsewhere.
      const { data: match } = await supabase
        .from("school_users")
        .select("id, roles!inner(name)")
        .eq("phone", phoneNumber)
        .eq("status", "active")
        .eq("school_id", schoolId)
        .eq("roles.name", "parent")
        .maybeSingle();
      if (!match) {
        await sendReply(phoneNumber, UNRECOGNIZED_SENDER_REPLY);
        return EMPTY_TWIML;
      }
      guardianUserId = match.id;
    } else {
      // Shared-number fallback: match across every school. school_users has no separate
      // "guardian" role -- a guardian is a school_users row with role = 'parent' (see
      // student_guardians' enforce_guardian_link_validity trigger).
      const { data: guardianMatches } = await supabase
        .from("school_users")
        .select("id, school_id, roles!inner(name)")
        .eq("phone", phoneNumber)
        .eq("status", "active")
        .eq("roles.name", "parent");

      const distinctSchoolIds = [...new Set((guardianMatches ?? []).map((m: { school_id: string }) => m.school_id))];

      if (distinctSchoolIds.length === 0) {
        await sendReply(phoneNumber, UNRECOGNIZED_SENDER_REPLY);
        return EMPTY_TWIML;
      }
      if (distinctSchoolIds.length > 1) {
        await sendReply(phoneNumber, AMBIGUOUS_SCHOOL_REPLY);
        return EMPTY_TWIML;
      }

      schoolId = distinctSchoolIds[0];
      guardianUserId = (guardianMatches as { id: string; school_id: string }[]).find((m) => m.school_id === schoolId)!.id;
    }

    // --- Settings + conversation ---------------------------------------------------------------
    const { data: settings } = await supabase
      .from("school_whatsapp_settings")
      .upsert({ school_id: schoolId }, { onConflict: "school_id", ignoreDuplicates: true })
      .select("bot_enabled")
      .maybeSingle();
    const botEnabled = settings?.bot_enabled ?? true;

    const { data: existingConvo } = await supabase
      .from("whatsapp_conversations")
      .select("id, status, student_id, unread_count")
      .eq("school_id", schoolId)
      .eq("phone_number", phoneNumber)
      .maybeSingle();

    let conversationId: string;
    let status: string;
    let currentStudentId: string | null;

    if (existingConvo) {
      conversationId = existingConvo.id;
      currentStudentId = existingConvo.student_id;
      status = existingConvo.status === "closed" ? "bot" : existingConvo.status;
    } else {
      const { data: created, error: createError } = await supabase
        .from("whatsapp_conversations")
        .insert({ school_id: schoolId, phone_number: phoneNumber, guardian_user_id: guardianUserId, status: "bot", unread_count: 0 })
        .select("id")
        .single();
      if (createError || !created) throw new Error(createError?.message ?? "Could not create conversation.");
      conversationId = created.id;
      status = "bot";
      currentStudentId = null;
    }

    // --- Idempotency: insert the inbound message BEFORE any counters/side effects --------------
    // If this is a Twilio retry of a delivery we already processed, the unique index on
    // (direction='inbound', twilio_message_sid) rejects the insert and we stop here -- no double
    // unread_count bump, no double bot reply.
    const { error: insertMsgError } = await supabase.from("whatsapp_messages").insert({
      conversation_id: conversationId,
      school_id: schoolId,
      direction: "inbound",
      sender_type: "guardian",
      body,
      twilio_message_sid: messageSid,
      status: "received",
    });
    if (insertMsgError) {
      if (isUniqueViolation(insertMsgError)) {
        console.log(`[whatsapp-webhook] Duplicate delivery for MessageSid=${messageSid} -- skipping.`);
        return EMPTY_TWIML;
      }
      throw new Error(insertMsgError.message);
    }

    await supabase
      .from("whatsapp_conversations")
      .update({
        status,
        guardian_user_id: guardianUserId,
        unread_count: (existingConvo?.unread_count ?? 0) + 1,
        last_message_at: new Date().toISOString(),
        last_message_preview: body.slice(0, 140),
      })
      .eq("id", conversationId);

    // Human is already on it (or the bot is switched off school-wide) -- just log the message,
    // no automated reply.
    if (status !== "bot" || !botEnabled) {
      return EMPTY_TWIML;
    }

    // --- Run the channel-neutral core -----------------------------------------------------------
    const result = await handleInboundMessage({
      supabase,
      schoolId,
      conversationId,
      guardianUserId,
      currentStudentId,
      messageText: body,
    });

    const replyOutcome = await sendReply(phoneNumber, result.replyText);
    await supabase.from("whatsapp_messages").insert({
      conversation_id: conversationId,
      school_id: schoolId,
      direction: "outbound",
      sender_type: "bot",
      body: result.replyText,
      status: replyOutcome.ok ? "sent" : "failed",
      provider_response: replyOutcome.error,
    });
    await supabase
      .from("whatsapp_conversations")
      .update({
        status: result.escalate ? "escalated" : "bot",
        escalation_reason: result.escalate ? (result.escalationReason as EscalationReason) : null,
        student_id: result.studentId !== undefined ? result.studentId : undefined,
        last_message_at: new Date().toISOString(),
        last_message_preview: result.replyText.slice(0, 140),
      })
      .eq("id", conversationId);

    return EMPTY_TWIML;
  } catch (err) {
    console.error("[whatsapp-webhook] Unhandled error:", err);
    // Best-effort: let the guardian know something went wrong rather than leaving them with
    // silence, without leaking internal error detail.
    await sendReply(phoneNumber, ESCALATION_ACK);
    return EMPTY_TWIML;
  }
});
