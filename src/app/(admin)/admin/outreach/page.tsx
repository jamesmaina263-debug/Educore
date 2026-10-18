import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminOutreach, type OutboundProspectRow } from "@/components/admin/admin-outreach";
import { AdminOutreachEmailPanel } from "@/components/admin/admin-outreach-email-panel";
import { getOutreachEmailAudience } from "./actions";
import { summariseContactLog, type ContactLogRow } from "@/lib/outbound/contact";

// "Find contacts" fetches several web pages per school and calls Gemini; allow the full minute.
export const maxDuration = 60;

// Same auth gate as the other platform-admin pages: the (admin) layout already enforces
// auth_is_super_admin(); this repeats it (defense in depth) and outbound_prospects' own RLS
// select policy is gated on it too.
export default async function AdminOutreachPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const [prospectsRes, teamRes, logRes] = await Promise.all([
    supabase
      .from("outbound_prospects")
      .select(
        "id, school_name, town_county, school_type, school_level, website, phone, email, contact_name, contact_role, contact_status, contact_source_url, source_note, fit_score, fit_reason, draft_email_subject, draft_email_body, draft_whatsapp, status",
      )
      .order("fit_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1500),
    supabase.from("platform_team_members").select("id, name").eq("active", true).order("name"),
    // Newest first; the helper keeps the latest event per prospect. If the contact-log migration has
    // not been applied on this environment the page still works and the contact controls stay hidden.
    supabase
      .from("outbound_contact_log")
      .select("prospect_id, channel, event, created_at")
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  // Tolerates the outreach-email migration not being applied yet: the panel then shows the error only.
  const emailAudience = await getOutreachEmailAudience();
  const contactEnabled = !logRes.error;
  const contactSummary = Object.fromEntries(summariseContactLog((logRes.data ?? []) as ContactLogRow[]));

  // Same posture as /admin/sales-pipeline: if the table isn't there yet, say so instead of crashing.
  if (prospectsRes.error) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Outreach</h1>
        <div className="panel p-4 text-sm">
          <p className="font-medium">Outreach isn&apos;t available yet.</p>
          <p className="mt-1 text-muted-foreground">
            Its database table hasn&apos;t been created on this environment. Nothing else is affected — try again
            after the latest database migration has been applied.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Outreach</h1>
        <p className="text-sm text-muted-foreground">
          Find schools and kindergartens, let AI score them and draft a first message, then approve the ones worth
          pursuing. Nothing is sent automatically: emails go only to schools you approved, after you review them and click send; copying a draft or marking it sent is logged so nobody is contacted twice. Visible to platform staff only.
        </p>
      </div>
      <AdminOutreachEmailPanel
        initialCandidates={"success" in emailAudience ? emailAudience.candidates : []}
        initialQuota={"success" in emailAudience ? emailAudience.quota : { cap: 0, used: 0, remaining: 0 }}
        initialError={"error" in emailAudience ? emailAudience.error : null}
      />
      <AdminOutreach
        prospects={(prospectsRes.data ?? []) as OutboundProspectRow[]}
        reps={(teamRes.data ?? []) as { id: string; name: string }[]}
        contactEnabled={contactEnabled}
        contactSummary={contactSummary}
      />
    </div>
  );
}
