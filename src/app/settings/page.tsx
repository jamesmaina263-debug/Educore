import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BrandingForm, type BrandingData } from "@/components/settings/branding-form";
import { StaffRolesTable, type StaffRow, type RoleOption } from "@/components/settings/staff-roles-table";
import { InviteStaffDialog } from "@/components/settings/invite-staff-dialog";
import { BillingPanel, type BillingData } from "@/components/settings/billing-panel";

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canWriteBranding }, { data: canManageStaff }, { data: canReadBilling }] =
    await Promise.all([
      supabase
        .from("school_users")
        .select("id, full_name, roles(display_name), schools(id, name, motto, logo_url, primary_color)")
        .eq("auth_user_id", user.id)
        .maybeSingle(),
      supabase.rpc("auth_has_permission", { p_permission_key: "settings.branding.write" }),
      supabase.rpc("auth_has_permission", { p_permission_key: "staff.manage" }),
      supabase.rpc("auth_has_permission", { p_permission_key: "billing.read" }),
    ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const school = schoolUser?.schools as unknown as {
    id: string;
    name: string;
    motto: string | null;
    logo_url: string | null;
    primary_color: string | null;
  } | null;

  const [{ data: staffRows }, { data: roleRows }] = await Promise.all([
    supabase
      .from("school_users")
      .select("id, full_name, email, status, role_id, roles(name, display_name)")
      .order("full_name"),
    supabase.from("roles").select("id, name, display_name").order("display_name"),
  ]);

  const staff: StaffRow[] = (staffRows ?? []).map((s) => {
    const role = s.roles as unknown as { name: string; display_name: string } | null;
    return {
      id: s.id,
      full_name: s.full_name,
      email: s.email,
      status: s.status as StaffRow["status"],
      role_id: s.role_id,
      role_name: role?.name ?? "",
      role_display_name: role?.display_name ?? "—",
    };
  });

  const roles: RoleOption[] = (roleRows ?? []).map((r) => ({ id: r.id, name: r.name, display_name: r.display_name }));

  let billingData: BillingData | null = null;
  if (canReadBilling === true) {
    const { data: sub } = await supabase
      .from("school_subscriptions")
      .select("status, trial_ends_at, current_period_end, subscription_plans(name)")
      .maybeSingle();
    const { data: invoiceRows } = await supabase
      .from("platform_invoices")
      .select("id, period_start, period_end, student_count, amount_kes, status, due_at, paid_at")
      .order("period_start", { ascending: false })
      .limit(12);
    const plan = sub?.subscription_plans as unknown as { name: string } | null;
    billingData = {
      status: sub?.status ?? null,
      plan_name: plan?.name ?? null,
      trial_ends_at: sub?.trial_ends_at ?? null,
      current_period_end: sub?.current_period_end ?? null,
      invoices: invoiceRows ?? [],
    };
  }

  const brandingData: BrandingData = {
    name: school?.name ?? "",
    motto: school?.motto ?? null,
    logo_url: school?.logo_url ?? null,
    primary_color: school?.primary_color ?? null,
  };

  return (
    <AppShell
      breadcrumbs={[{ label: school?.name ?? "EduCore", href: "/dashboard" }, { label: "Settings" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Branding and staff administration</p>
        </div>

        <Tabs defaultValue="branding">
          <TabsList>
            <TabsTrigger value="branding">Branding</TabsTrigger>
            <TabsTrigger value="staff">Users &amp; Roles</TabsTrigger>
            {billingData && <TabsTrigger value="billing">Billing</TabsTrigger>}
          </TabsList>

          <TabsContent value="branding">
            <BrandingForm initial={brandingData} canWrite={canWriteBranding === true} />
          </TabsContent>

          <TabsContent value="staff">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{staff.length} staff</p>
                {canManageStaff === true && <InviteStaffDialog roles={roles} />}
              </div>
              <StaffRolesTable
                rows={staff}
                roles={roles}
                canManage={canManageStaff === true}
                currentUserId={schoolUser?.id ?? ""}
              />
            </div>
          </TabsContent>

          {billingData && (
            <TabsContent value="billing">
              <BillingPanel data={billingData} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppShell>
  );
}
