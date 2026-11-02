import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";
import { generateBotDocument, type DocType } from "@/lib/bot-documents/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// WhatsApp bot documents (feature.bot.documents). Called ONLY by the whatsapp-webhook edge function,
// after the guardian proved their PIN. Not a user-facing route: it is protected by a shared secret
// (BOT_DOCUMENTS_SECRET, constant-time compare) and by the database, which hands out each
// PIN-verified request exactly once (bot_claim_document_request) and only while the school's flag
// is on. It re-checks the guardian-student link itself, builds the PDF, stores it in the PRIVATE
// bot-documents bucket and returns a signed link that expires in 10 minutes. The link is never
// logged. Nothing is sent from here.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_SECONDS = 600;
const KEEP_HOURS = 24;

export async function POST(request: Request) {
  const secret = process.env.BOT_DOCUMENTS_SECRET;
  if (!secret) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 500 });
  if (!isValidCronRequest(request, secret)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  let requestId: string | null = null;
  try {
    const body = (await request.json()) as { request_id?: unknown };
    if (typeof body.request_id === "string" && UUID.test(body.request_id)) requestId = body.request_id;
  } catch {
    // falls through to the 400 below
  }
  if (!requestId) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false, code: "not_configured" }, { status: 500 });
  }

  const fail = async (status: number, code: string, reason: string) => {
    await admin.rpc("bot_complete_document_request", { p_request_id: requestId, p_status: "failed", p_reason: reason });
    return NextResponse.json({ ok: false, code }, { status });
  };

  const { data: claim, error: claimError } = await admin.rpc("bot_claim_document_request", { p_request_id: requestId });
  if (claimError) return NextResponse.json({ ok: false, code: "error" }, { status: 500 });
  if (!claim) return NextResponse.json({ ok: false, code: "not_claimable" }, { status: 409 });
  const c = claim as { school_id: string; guardian_user_id: string; student_id: string; doc_type: DocType };

  // Defence in depth: the guardian must still be linked to this learner, in this school.
  const { data: link } = await admin
    .from("student_guardians")
    .select("id, students!inner(school_id)")
    .eq("guardian_user_id", c.guardian_user_id)
    .eq("student_id", c.student_id)
    .eq("students.school_id", c.school_id)
    .maybeSingle();
  if (!link) return await fail(403, "forbidden", "guardian is not linked to this learner");

  let result;
  try {
    result = await generateBotDocument(admin, { schoolId: c.school_id, studentId: c.student_id, docType: c.doc_type });
  } catch (e) {
    return await fail(500, "error", `generation threw: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
  }

  if (!result.ok) {
    if (result.code === "not_available") {
      // The edge function records this as "denied" and tells the guardian in plain words.
      return NextResponse.json({ ok: false, code: "not_available", message: result.message });
    }
    return await fail(500, "error", result.message);
  }

  const path = `${c.school_id}/${requestId}.pdf`;
  const { error: uploadError } = await admin.storage.from("bot-documents").upload(path, result.bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) return await fail(500, "error", `upload failed: ${uploadError.message.slice(0, 120)}`);
  const { data: signed, error: signError } = await admin.storage.from("bot-documents").createSignedUrl(path, LINK_SECONDS, { download: result.filename });
  if (signError || !signed?.signedUrl) return await fail(500, "error", "could not sign the document link");

  // Housekeeping: a child's report should not sit in storage. Remove this school's files older
  // than a day (best effort: never blocks or fails the request).
  try {
    const { data: files } = await admin.storage.from("bot-documents").list(c.school_id, { limit: 100, sortBy: { column: "created_at", order: "asc" } });
    const cutoff = Date.now() - KEEP_HOURS * 3600 * 1000;
    const stale = (files ?? []).filter((f) => f.created_at && new Date(f.created_at).getTime() < cutoff).map((f) => `${c.school_id}/${f.name}`);
    if (stale.length > 0) await admin.storage.from("bot-documents").remove(stale);
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true, url: signed.signedUrl, filename: result.filename, caption: result.caption });
}
