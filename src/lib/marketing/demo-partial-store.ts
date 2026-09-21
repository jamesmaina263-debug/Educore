import type { SupabaseClient } from "@supabase/supabase-js";

import type { AttributionColumns } from "@/lib/marketing/attribution-fields";
import type { DemoContactStep } from "@/lib/marketing/demo-partial";

// Persistence for the two-step demo form's step-1 contact details. Takes the (service-role)
// client as a parameter so the logic is unit-testable with a fake, and so this module has no
// opinion about how the client is built. Callers must pass a service-role client: the table has
// no anon/authenticated write access by design (see 20260921120000_marketing_demo_partial_leads.sql).

const TABLE = "marketing_demo_partial_leads";
const UNIQUE_VIOLATION = "23505";

/**
 * Saves (or refreshes) the open incomplete lead for this email. One open row per email is
 * enforced by a partial unique index, so a visitor who goes back and re-submits step 1 updates
 * the same row instead of creating duplicates. Never throws -- returns false on any failure,
 * because a problem saving a lead must never stop the visitor finishing the form.
 */
export async function saveIncompleteLead(
  admin: SupabaseClient,
  contact: DemoContactStep,
  attribution: AttributionColumns,
  sourcePage: string | null,
): Promise<boolean> {
  const fields = {
    name: contact.name,
    school_name: contact.schoolName,
    phone: contact.phone,
    source_page: sourcePage,
    ...attribution,
    updated_at: new Date().toISOString(),
  };

  const refreshExisting = () =>
    admin
      .from(TABLE)
      .update(fields)
      .eq("email", contact.email)
      .eq("status", "incomplete");

  try {
    const existing = await admin
      .from(TABLE)
      .select("id")
      .eq("email", contact.email)
      .eq("status", "incomplete")
      .maybeSingle();
    if (existing.error) return false;

    if (existing.data) {
      const { error } = await refreshExisting();
      return !error;
    }

    const { error } = await admin.from(TABLE).insert({ ...fields, email: contact.email });
    if (!error) return true;
    // Two near-simultaneous step-1 submits for the same email: the other one won the insert.
    if (error.code === UNIQUE_VIOLATION) {
      const retry = await refreshExisting();
      return !retry.error;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Called after a full demo request is successfully stored: closes out any open incomplete lead
 * for the same email so it stops showing up as "started but didn't finish". Best-effort.
 */
export async function markIncompleteLeadCompleted(
  admin: SupabaseClient,
  email: string,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    await admin
      .from(TABLE)
      .update({ status: "completed", completed_at: now, updated_at: now })
      .eq("email", email)
      .eq("status", "incomplete");
  } catch {
    // Leaving a lead "incomplete" after they finished is cosmetic, never worth failing the submit.
  }
}
