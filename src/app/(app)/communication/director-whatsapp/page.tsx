import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { DirectorWhatsappSection } from "@/components/communication/director-whatsapp-section";
import { DIRECTOR_WHATSAPP_FLAG, parseDirectorStatus } from "@/lib/director-whatsapp";

export default async function DirectorWhatsappPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed (any error => false).
  if (!(await hasFeatureFlag(supabase, DIRECTOR_WHATSAPP_FLAG))) notFound();

  const [{ data: schoolUser }, { data: statusRaw }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("director_whatsapp_status"),
  ]);
  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name ?? "EduCore";

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName, href: "/dashboard" }, { label: "Communication", href: "/communication" }, { label: "Director WhatsApp" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Director WhatsApp questions</h1>
          <p className="text-sm text-muted-foreground">Ask the school bot for collections, outstanding fees, attendance and learner numbers, from your own phone.</p>
        </div>
        <DirectorWhatsappSection status={parseDirectorStatus(statusRaw)} />
      </div>
    </AppShell>
  );
}
