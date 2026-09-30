import { Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AuthLayout } from "@/components/shared/auth-layout";

// Not itself auth-gated (an unauthenticated visitor mid-maintenance should see this too, not a
// login wall) -- src/lib/supabase/middleware.ts is what routes people here, this page just
// renders the message. Always reads the live row rather than trusting any cached value, since
// a stale "still down" message lingering after a super_admin turns maintenance back off would
// be its own small outage.
export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const supabase = await createClient();
  const { data } = await supabase.from("platform_maintenance").select("message").eq("id", 1).maybeSingle();

  return (
    <AuthLayout>
      <div className="space-y-5 rounded-xl border border-border bg-surface p-7 text-center shadow-raised sm:p-8">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Wrench className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">EduCore is undergoing maintenance</h1>
          <p className="text-sm text-muted-foreground">
            {data?.message || "We're carrying out planned maintenance right now. Please check back shortly."}
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
