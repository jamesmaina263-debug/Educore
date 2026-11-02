import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { BotRequestsSection } from "@/components/communication/bot-requests-section";
import { BOT_REQUESTS_FLAG, parseBotRequestRows } from "@/lib/bot-requests";

export default async function BotRequestsPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed (any error => false).
  if (!(await hasFeatureFlag(supabase, BOT_REQUESTS_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canRead }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "communication.read" }),
  ]);
  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name ?? "EduCore";

  let rows = parseBotRequestRows([]);
  if (canRead) {
    // The function returns nothing unless the flag is on and the caller may read communication.
    const { data } = await supabase.rpc("bot_requests_for_review", { p_status: "all" });
    rows = parseBotRequestRows(data);
  }

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName, href: "/dashboard" }, { label: "Communication", href: "/communication" }, { label: "Bot requests" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">WhatsApp bot requests</h1>
          <p className="text-sm text-muted-foreground">
            Absence notes and phone-number changes that guardians sent the school bot. Nothing changes until someone here decides.
          </p>
        </div>
        {canRead ? (
          <BotRequestsSection rows={rows} />
        ) : (
          <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">You don&apos;t have access to Communication.</div>
        )}
      </div>
    </AppShell>
  );
}
