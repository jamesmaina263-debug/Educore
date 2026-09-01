// Third-party read-only API gateway (Phase 5 Item 3).
//
// Design, matching the "classify-then-execute, nothing un-grounded reaches the caller"
// convention already used by Trimora AI (Phase 4 Item 1): an API key is NOT a Postgres role
// and carries no JWT, so it can never reach PostgREST/RLS directly. This function is the only
// thing that ever sees a raw key. It authenticates the key against api_keys.key_hash, resolves
// its scope (one school OR one school_group — never both, never platform-wide) and its
// granted scopes, then runs exactly one of a small FIXED set of parameterized queries below.
// There is no pass-through SQL, no dynamic query building from caller input beyond a resource
// name lookup against a fixed allowlist.
//
// Sensitive tables are permanently excluded from this allowlist: medical_records,
// teacher_performance_reviews, payroll_records, documents, discipline records. If a use case
// for those ever exists, it needs its own explicit design decision, not a scope flag added
// here.
//
// Every request is logged to api_request_logs, via this function's own service-role client
// (RLS on that table has no insert policy for regular users on purpose — only this function,
// running as service_role, writes to it).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "./cors.ts";
import { timingSafeEqual } from "../_shared/timingSafeEqual.ts";
import { getRealClientIp } from "../_shared/getRealClientIp.ts";

type Resource = "students" | "attendance" | "fees" | "exams";

const RESOURCE_SCOPES: Record<Resource, string> = {
  students: "students.read",
  attendance: "attendance.read",
  fees: "fees.read",
  exams: "exams.read",
};

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Was reading the first x-forwarded-for entry -- caller-controlled, so it was falsifying the
  // audit log's ip_address column. See getRealClientIp.ts.
  const ipAddress = getRealClientIp(req);
  const url = new URL(req.url);
  // Path is /functions/v1/api-v1/{resource} — take the last non-empty segment.
  const segments = url.pathname.split("/").filter(Boolean);
  const resource = segments[segments.length - 1] as Resource;
  const endpointLabel = `/${resource}`;

  async function logAndRespond(apiKeyId: string | null, statusCode: number, body: unknown) {
    if (apiKeyId) {
      // Fire-and-forget-ish but awaited so failures don't silently drop the audit trail;
      // a logging failure still returns the real response rather than masking it.
      await supabase.from("api_request_logs").insert({
        api_key_id: apiKeyId,
        endpoint: endpointLabel,
        status_code: statusCode,
        ip_address: ipAddress,
      });
    }
    return new Response(JSON.stringify(body), {
      status: statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!RESOURCE_SCOPES[resource]) {
    return logAndRespond(null, 404, {
      error: "Unknown resource.",
      available: Object.keys(RESOURCE_SCOPES),
    });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const rawKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!rawKey || !rawKey.includes(".")) {
    return logAndRespond(null, 401, { error: "Missing or malformed API key." });
  }

  const [keyPrefix, secret] = rawKey.split(/\.(.*)/s);
  if (!keyPrefix || !secret) {
    return logAndRespond(null, 401, { error: "Malformed API key." });
  }

  const { data: keyRow, error: keyLookupError } = await supabase
    .from("api_keys")
    .select("id, school_id, school_group_id, key_hash, scopes, status, expires_at")
    .eq("key_prefix", keyPrefix)
    .maybeSingle();

  if (keyLookupError || !keyRow) {
    return logAndRespond(null, 401, { error: "Invalid API key." });
  }
  if (keyRow.status !== "active") {
    return logAndRespond(keyRow.id, 401, { error: "This API key has been revoked." });
  }
  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    return logAndRespond(keyRow.id, 401, { error: "This API key has expired." });
  }

  const secretHash = await sha256Hex(secret);
  if (!timingSafeEqual(secretHash, keyRow.key_hash)) {
    return logAndRespond(keyRow.id, 401, { error: "Invalid API key." });
  }

  const requiredScope = RESOURCE_SCOPES[resource];
  if (!keyRow.scopes.includes(requiredScope)) {
    return logAndRespond(keyRow.id, 403, {
      error: `This key does not have the ${requiredScope} scope.`,
    });
  }

  // Resolve the set of school_ids this key can see: one school directly, or every school in
  // its group. Either way, this is the ONLY place caller-controlled input (none, here — it's
  // entirely derived from the verified key row) ever touches which rows get returned.
  let schoolIds: string[];
  if (keyRow.school_id) {
    schoolIds = [keyRow.school_id];
  } else {
    const { data: groupSchools } = await supabase
      .from("schools")
      .select("id")
      .eq("school_group_id", keyRow.school_group_id);
    schoolIds = (groupSchools ?? []).map((s) => s.id);
  }

  let payload: unknown;
  switch (resource) {
    case "students": {
      // Roster only. Deliberately excludes date_of_birth, medical fields, guardian contact
      // details, and discipline history -- this is the denylist from the header comment
      // applied in practice, not just documented.
      const { data } = await supabase
        .from("students")
        .select("id, school_id, admission_number, first_name, last_name, status")
        .in("school_id", schoolIds)
        .eq("status", "active");
      payload = data ?? [];
      break;
    }
    case "attendance": {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("student_attendance")
        .select("school_id, status")
        .in("school_id", schoolIds)
        .eq("attendance_date", today);
      const rows = data ?? [];
      const bySchool = new Map<string, { present: number; total: number }>();
      for (const id of schoolIds) bySchool.set(id, { present: 0, total: 0 });
      for (const row of rows) {
        const bucket = bySchool.get(row.school_id);
        if (!bucket) continue;
        bucket.total += 1;
        if (row.status === "present") bucket.present += 1;
      }
      payload = Array.from(bySchool.entries()).map(([school_id, v]) => ({
        school_id,
        date: today,
        present: v.present,
        total: v.total,
        rate_pct: v.total > 0 ? Math.round((v.present / v.total) * 1000) / 10 : 0,
      }));
      break;
    }
    case "fees": {
      // Aggregate balances only -- no per-invoice line items, no M-Pesa references, no
      // payment method detail. A third party gets "is this student's account current",
      // not a transaction ledger.
      const { data } = await supabase
        .from("v_student_balances")
        .select("student_id, school_id, balance")
        .in("school_id", schoolIds);
      payload = data ?? [];
      break;
    }
    case "exams": {
      // class_rankings has no school_id of its own -- scoped via its parent exam, which does.
      // Only closed exams are exposed: results aren't final (and shouldn't leave the building)
      // until an exam is actually closed, same rule the report-cards feature already applies.
      const { data } = await supabase
        .from("class_rankings")
        .select("student_id, average_score, rank_in_class, rank_in_stream, exams!inner(id, school_id, name, status)")
        .in("exams.school_id", schoolIds)
        .eq("exams.status", "closed");
      payload = (data ?? []).map((row) => {
        const exam = row.exams as unknown as { id: string; school_id: string; name: string };
        return {
          student_id: row.student_id,
          school_id: exam.school_id,
          exam_id: exam.id,
          exam_name: exam.name,
          average_score: row.average_score,
          rank_in_class: row.rank_in_class,
          rank_in_stream: row.rank_in_stream,
        };
      });
      break;
    }
  }

  // Best-effort last_used_at bump -- not awaited-critical, a failure here shouldn't fail the
  // actual response.
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRow.id)
    .then(() => {});

  return logAndRespond(keyRow.id, 200, { resource, data: payload });
});

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
