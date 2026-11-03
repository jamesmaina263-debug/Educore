import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashDeviceToken } from "@/lib/driver-token";
import { MAX_BODY_BYTES, extractBearer, httpStatusForIngest, isValidToken, parsePositionsBody } from "@/lib/driver-tracker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/driver/positions -- the driver phone app sends a batch of GPS points.
// Authenticated only by the tracker device token (Authorization: Bearer vt_...), which is hashed here and checked by
// ingest_vehicle_positions() (WP 5.1) together with the school's feature flag. No session, no cookies. The response
// never echoes the token, and failures are generic so a caller learns nothing beyond "not accepted".
const HEADERS = { "Cache-Control": "no-store" };
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: HEADERS });

export async function POST(request: NextRequest) {
  try {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin") return reply(403, { status: "forbidden" });

    const token = extractBearer(request.headers.get("authorization"));
    if (!isValidToken(token)) return reply(401, { status: "invalid" });

    if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return reply(413, { status: "too_large" });
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return reply(413, { status: "too_large" });

    let parsed: ReturnType<typeof parsePositionsBody> = null;
    try {
      parsed = parsePositionsBody(JSON.parse(raw));
    } catch {
      parsed = null;
    }
    if (!parsed) return reply(400, { status: "bad_request" });

    const { data, error } = await createAdminClient().rpc("ingest_vehicle_positions", {
      p_token_hash: hashDeviceToken(token),
      p_points: parsed.points,
    });
    if (error || !data || typeof data !== "object") return reply(503, { status: "unavailable" });

    const result = data as { status?: string; accepted?: number; duplicates?: number; rejected?: number };
    const http = httpStatusForIngest(result.status);
    if (http !== 200) return reply(http, { status: result.status ?? "error" });
    return reply(200, { status: "ok", accepted: result.accepted ?? 0, duplicates: result.duplicates ?? 0, rejected: result.rejected ?? 0 });
  } catch {
    return reply(503, { status: "unavailable" });
  }
}
