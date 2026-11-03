import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashDeviceToken } from "@/lib/driver-token";
import { extractBearer, isValidToken } from "@/lib/driver-tracker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/driver/route -- the driver phone asks "which vehicle and route is this token for?".
// Bearer token only. Returns vehicle registration, route name, ordered stops with rider COUNTS; never learner names.
const HEADERS = { "Cache-Control": "no-store" };
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: HEADERS });

export async function POST(request: NextRequest) {
  try {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin") return reply(403, { status: "forbidden" });

    const token = extractBearer(request.headers.get("authorization"));
    if (!isValidToken(token)) return reply(401, { status: "invalid" });

    const { data, error } = await createAdminClient().rpc("driver_route_for_device", { p_token_hash: hashDeviceToken(token) });
    if (error || !data || typeof data !== "object") return reply(503, { status: "unavailable" });

    const status = (data as { status?: string }).status;
    if (status === "invalid") return reply(401, { status: "invalid" });
    if (status === "disabled") return reply(403, { status: "disabled" });
    if (status !== "ok") return reply(502, { status: "error" });
    return reply(200, data as Record<string, unknown>);
  } catch {
    return reply(503, { status: "unavailable" });
  }
}
