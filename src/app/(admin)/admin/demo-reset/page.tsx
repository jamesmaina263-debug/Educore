import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DemoResetPanel } from "@/components/admin/demo-reset-panel";

export default async function AdminDemoResetPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Demo environment reset</h1>
        <p className="text-sm text-muted-foreground">
          Clears announcements published in Demo Academy during a sales demo (PR-07 /
          GO-04) so the next demo starts clean. Doesn&apos;t touch students, classes, fees
          or any other Demo Academy data — see PR-13 in the GTM readiness tracker for
          what&apos;s in and out of scope.
        </p>
      </div>
      <DemoResetPanel />
    </div>
  );
}
