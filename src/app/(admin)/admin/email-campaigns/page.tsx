import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminEmailCampaignForm } from "@/components/admin/admin-email-campaign-form";
import { AdminProspectSequence } from "@/components/admin/admin-prospect-sequence";
import type {
  AudienceRow,
  CampaignHistoryRow,
  ProspectRow,
  SequenceConfig,
} from "@/app/(admin)/admin/email-campaigns/actions";

export const maxDuration = 60;

export default async function AdminEmailCampaignsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const { data: audience } = await supabase.rpc("preview_owner_campaign_audience");
  const { data: prospects } = await supabase.rpc("preview_prospect_campaign_audience");
  const { data: sequence } = await supabase.rpc("admin_get_prospect_sequence");
  const { data: history } = await supabase.rpc("get_email_campaign_history");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Email campaigns</h1>
        <p className="text-sm text-muted-foreground">
          Promotional email to school owners (active and trial schools; demo and test tenants are excluded) or to
          prospects who left their email on the website but are not onboarded yet. Sent as EDUCORE with replies going
          to support. Every email carries an unsubscribe link, and anyone who unsubscribes is skipped from then on.
        </p>
      </div>
      <AdminEmailCampaignForm
        audience={(audience as AudienceRow[]) ?? []}
        prospects={(prospects as ProspectRow[]) ?? []}
        history={(history as CampaignHistoryRow[]) ?? []}
      />
      {sequence ? <AdminProspectSequence config={sequence as SequenceConfig} /> : null}
    </div>
  );
}
