import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidIsoDate } from "@/lib/analytics-date-range";
import { parsePageViewSummary } from "@/lib/analytics-page-views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/page-views?from=YYYY-MM-DD&to=YYYY-MM-DD -> our own first-party visit counts for a
// range of Kenya days, polled by the panel on /admin/analytics so Today stays current.
// Platform super-admins only: the database function itself checks auth_is_super_admin(), and every
// other caller gets the same 404 so the endpoint's existence is not advertised (same convention as
// /api/admin/analytics-live).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const headers = { "Cache-Control": "no-store" };
  const from = request.nextUrl.searchParams.get("from") ?? undefined;
  const to = request.nextUrl.searchParams.get("to") ?? undefined;
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) {
    return NextResponse.json({ error: "Invalid date range." }, { status: 400, headers });
  }

  const { data, error } = await supabase.rpc("admin_page_view_summary", { p_from: from, p_to: to });
  if (error) {
    console.error("page-views: admin_page_view_summary failed", error.message);
    return NextResponse.json({ error: "Visit counts are not available." }, { status: 502, headers });
  }
  const summary = parsePageViewSummary(data);
  if (!summary) {
    return NextResponse.json({ error: "Visit counts are not available." }, { status: 502, headers });
  }
  return NextResponse.json(summary, { headers });
}
