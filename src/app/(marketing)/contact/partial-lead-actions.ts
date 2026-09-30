"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRealClientIp } from "@/lib/get-real-client-ip";
import { parseAttributionFormData } from "@/lib/marketing/attribution-fields";
import { parseDemoContactStep } from "@/lib/marketing/demo-partial";
import { saveIncompleteLead } from "@/lib/marketing/demo-partial-store";

export type DemoContactStepState =
  | { status: "saved" }
  | { status: "error"; message: string };

// Same fill-time floor as submitDemoRequest (see actions.ts).
const MIN_FILL_TIME_MS = 1500;

// Step 1 of the two-step demo form. Saves the visitor's contact details the moment they press
// Continue, so someone who never completes step 2 is still a lead. The visitor is told about
// this next to the Continue button and in the privacy policy.
//
// Deliberately fail-open: the visitor is always allowed to continue to step 2 unless their
// input is invalid. Bot traffic, a rate-limit trip, or a database problem just means nothing is
// saved -- the real submit (submitDemoRequest) has its own checks and is what actually creates
// a demo request.
export async function saveDemoContactStep(formData: FormData): Promise<DemoContactStepState> {
  // Honeypot / too-fast: pretend success, save nothing (same signal-suppression as actions.ts).
  const honeypot = String(formData.get("company_website") ?? "").trim();
  if (honeypot) return { status: "saved" };
  const renderedAt = Number(formData.get("rendered_at") ?? 0);
  if (renderedAt && Date.now() - renderedAt < MIN_FILL_TIME_MS) return { status: "saved" };

  const parsed = parseDemoContactStep(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };

  try {
    const admin = createAdminClient();

    // Per-IP limit, same primitive as the full form, on its own bucket so browsing between
    // steps can't use up the visitor's allowance for the final submit. Trusted (last)
    // X-Forwarded-For entry -- see getRealClientIp.
    const clientIp = getRealClientIp((await headers()).get("x-forwarded-for"));
    const { data: withinLimit } = await admin.rpc("increment_and_check_rate_limit", {
      p_bucket: `demo-partial:${clientIp}`,
      p_max_events: 10,
      p_window_seconds: 3600,
    });
    if (withinLimit === false) return { status: "saved" };

    const rawSourcePage = String(formData.get("source_page") ?? "").trim();
    const sourcePage = rawSourcePage.startsWith("/") ? rawSourcePage.slice(0, 200) : null;

    await saveIncompleteLead(
      admin,
      parsed.value,
      parseAttributionFormData(formData),
      sourcePage,
    );
  } catch (err) {
    // Missing service-role key, network error, etc. -- never block the visitor.
    console.error("saveDemoContactStep: unexpected error", err);
  }

  return { status: "saved" };
}
