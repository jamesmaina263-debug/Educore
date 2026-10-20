import { redirect } from "next/navigation";
import { Hourglass, ShieldX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AuthLayout } from "@/components/shared/auth-layout";
import { Button } from "@/components/ui/button";
import { NOT_APPROVED_MESSAGE, signupReviewGate } from "@/lib/signup-review";
import { signOutFromPendingApproval } from "./actions";

// Where the middleware holds a self-signup school until a platform admin approves it (see
// lib/signup-review.ts). Deliberately not one of the protected prefixes, so it can never redirect-loop with
// the gate that sends people here; the page does its own sign-in check and re-reads the live status, so the
// moment a school is approved, reloading takes the owner straight to their dashboard.
export const dynamic = "force-dynamic";

export default async function PendingApprovalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("schools(name, signup_review_status)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const school = schoolUser?.schools as unknown as { name: string; signup_review_status?: string } | null;
  const gate = signupReviewGate(school?.signup_review_status);

  // Approved (or not a self-signup school at all): nothing to wait for.
  if (gate === "allow") redirect("/dashboard");

  const rejected = gate === "rejected";

  return (
    <AuthLayout>
      <div className="space-y-5 rounded-xl border border-border bg-surface p-7 text-center shadow-raised sm:p-8">
        <div
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
            rejected ? "bg-warning-subtle text-warning" : "bg-muted text-muted-foreground"
          }`}
        >
          {rejected ? <ShieldX className="h-6 w-6" /> : <Hourglass className="h-6 w-6" />}
        </div>

        {rejected ? (
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold tracking-tight">Signup not approved</h1>
            <p className="text-sm text-muted-foreground">{NOT_APPROVED_MESSAGE}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <h1 className="text-lg font-semibold tracking-tight">Your school is waiting for approval</h1>
            <p className="text-sm text-muted-foreground">
              {school?.name ? (
                <>
                  <span className="font-medium text-foreground">{school.name}</span> has been created.{" "}
                </>
              ) : null}
              Our team reviews every new school before it opens. Your 30-day free trial starts the moment you are
              approved, so you lose none of it while you wait.
            </p>
            <p className="text-xs text-muted-foreground">
              Come back and sign in again after a while. If you have already been approved, reload this page.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Button asChild variant="outline" className="w-full">
            <a href="/contact">Contact EduCore</a>
          </Button>
          <form action={signOutFromPendingApproval}>
            <Button type="submit" variant="ghost" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </AuthLayout>
  );
}
