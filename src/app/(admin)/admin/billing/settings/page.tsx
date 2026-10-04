import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminBillingRunPanel } from "@/components/admin/admin-billing-run-panel";
import { AdminBillingSettingsForm, type BillingSettings, type PlanRow } from "@/components/admin/admin-billing-settings-form";

export const dynamic = "force-dynamic";

export default async function AdminBillingSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const [{ data: settings }, { data: plans }] = await Promise.all([
    supabase.from("platform_billing_settings").select("*").maybeSingle(),
    supabase.from("subscription_plans").select("id, code, name, price_per_student_kes, billing_period").order("price_per_student_kes"),
  ]);
  if (!settings) {
    return <p className="text-sm text-danger">Billing settings are missing. The invoicing migration may not have been applied.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs text-muted-foreground">
          <Link href="/admin/billing/invoices" className="hover:underline">
            Invoices
          </Link>{" "}
          / Settings
        </p>
        <h1 className="mt-1 text-lg font-semibold">Billing settings</h1>
        <p className="text-sm text-muted-foreground">Rates, numbering, payment instructions and the automatic end-of-term billing run. Changes apply to invoices created after you save.</p>
      </div>
      <AdminBillingRunPanel autoEnabled={settings.auto_generate_enabled === true} autoIssue={settings.auto_issue === true} />
      <AdminBillingSettingsForm
        settings={settings as unknown as BillingSettings}
        plans={(plans ?? []).map((p) => ({ ...p, price_per_student_kes: Number(p.price_per_student_kes) })) as PlanRow[]}
      />
    </div>
  );
}
