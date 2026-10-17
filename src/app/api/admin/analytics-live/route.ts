import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRealtimeSnapshot, isGa4Configured } from "@/lib/ga4";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/analytics-live -> the "who is on the marketing site right now" snapshot that the
// live panel on /admin/analytics polls. Platform super-admins only: auth_is_super_admin() is the
// same check the admin pages use, and it already refuses a session that has not passed MFA.
// Every other caller gets the same 404 so the endpoint's existence is not advertised.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const headers = { "Cache-Control": "no-store" };
  if (!isGa4Configured()) {
    return NextResponse.json({ error: "Google Analytics is not connected." }, { status: 503, headers });
  }

  const snapshot = await getRealtimeSnapshot();
  if (!snapshot) {
    return NextResponse.json({ error: "Google Analytics did not respond." }, { status: 502, headers });
  }
  return NextResponse.json(snapshot, { headers });
}
