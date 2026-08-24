import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Vercel Cron sends this route a GET with an Authorization: Bearer <CRON_SECRET>
// header automatically when CRON_SECRET is set in the project's env vars.
// Same pattern as /api/cron/billing — see that route for the header-checking rationale.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  if (!isValidCronRequest(request, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Admin client not configured." },
      { status: 500 },
    );
  }

  // p_school_id: null → every school in one call. recompute_student_risk_scores() explicitly
  // allows service_role, same as expire_trials/mark_invoices_overdue.
  const { data: studentsScored, error } = await adminClient.rpc("recompute_student_risk_scores", {
    p_school_id: null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    students_scored: studentsScored,
    ran_at: new Date().toISOString(),
  });
}
