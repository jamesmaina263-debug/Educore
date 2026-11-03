import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { getRealClientIp } from "../_shared/getRealClientIp.ts";
import {
  DEVICE_MAX_PER_MINUTE,
  IP_MAX_PER_MINUTE,
  MAX_BODY_BYTES,
  RATE_WINDOW_SECONDS,
  deviceBucket,
  hashToken,
  ipBucket,
  mapIngestResult,
  parseBearerToken,
  parseIngestBody,
  type IngestRpcResult,
} from "../_shared/transport/ingestRequest.ts";

// Public endpoint called by a tracker device (e.g. the driver phone app), not by a browser or a
// Supabase session -- verify_jwt = false in config.toml. Authenticity comes from the per-device
// bearer token created by create_tracker_device(); only its SHA-256 is stored, and the database
// function ingest_vehicle_positions() (service role only) does the authoritative checks: device
// active, school flag on, point validation, dedupe. Tracking is dark until a school's
// feature.transport.live_tracking flag is enabled (privacy review first).

function json(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST" });

  const token = parseBearerToken(req.headers.get("authorization"));
  if (!token) return json(401, { error: "unauthorized" });

  // Cheap early rejection on the declared size; parseIngestBody re-checks the real size.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json(413, { error: "payload_too_large" });

  const bodyText = await req.text();
  const parsed = parseIngestBody(bodyText);
  if (!parsed.ok) return json(parsed.status, { error: parsed.error });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const tokenHash = await hashToken(token);

  try {
    const [{ data: withinIp }, { data: withinDevice }] = await Promise.all([
      supabase.rpc("increment_and_check_rate_limit", {
        p_bucket: ipBucket(getRealClientIp(req)),
        p_max_events: IP_MAX_PER_MINUTE,
        p_window_seconds: RATE_WINDOW_SECONDS,
      }),
      supabase.rpc("increment_and_check_rate_limit", {
        p_bucket: deviceBucket(tokenHash),
        p_max_events: DEVICE_MAX_PER_MINUTE,
        p_window_seconds: RATE_WINDOW_SECONDS,
      }),
    ]);
    if (withinIp === false || withinDevice === false) {
      return json(429, { error: "rate_limited" }, { "Retry-After": String(RATE_WINDOW_SECONDS) });
    }

    const { data, error } = await supabase.rpc("ingest_vehicle_positions", {
      p_token_hash: tokenHash,
      p_points: parsed.points,
    });
    if (error) {
      console.error("[vehicle-position-ingest] rpc failed:", error.message);
      return json(500, { error: "internal_error" });
    }
    const mapped = mapIngestResult(data as IngestRpcResult | null);
    return json(mapped.status, mapped.body);
  } catch (err) {
    console.error("[vehicle-position-ingest] unexpected:", err instanceof Error ? err.message : String(err));
    return json(500, { error: "internal_error" });
  }
});
