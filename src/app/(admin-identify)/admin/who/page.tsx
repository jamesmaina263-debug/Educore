import { redirect } from "next/navigation";
import { UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AuthLayout } from "@/components/shared/auth-layout";
import { Button } from "@/components/ui/button";
import { ADMIN_OPERATORS, safeAdminNextPath } from "@/lib/admin-operator";
import { getAdminOperator } from "@/lib/admin-operator-server";
import { identifyAdminOperator } from "./actions";

// Lives in its own route group (not under (admin)) on purpose: (admin)/layout.tsx sends anyone
// without an identified operator here, so this page can't sit behind that same gate without
// redirecting to itself forever. It does its own sign-in + super-admin check instead.
export default async function WhoAreYouPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const { next } = await searchParams;
  const current = await getAdminOperator();

  return (
    <AuthLayout>
      <form
        action={identifyAdminOperator}
        className="space-y-5 rounded-xl border border-border bg-surface p-7 shadow-raised sm:p-8"
      >
        <input type="hidden" name="next" value={safeAdminNextPath(next)} />
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">Who are you logging in as?</h1>
          <p className="text-sm text-muted-foreground">
            The admin console uses one shared login. Pick your name so what you do here is recorded
            against you in the activity log.
          </p>
        </div>

        <div className="space-y-2">
          {ADMIN_OPERATORS.map((name) => (
            <Button
              key={name}
              type="submit"
              name="operator"
              value={name}
              variant={name === current ? "default" : "outline"}
              className="h-11 w-full justify-start gap-2"
            >
              <UserRound className="size-4" />
              {name}
            </Button>
          ))}
        </div>
      </form>
    </AuthLayout>
  );
}
