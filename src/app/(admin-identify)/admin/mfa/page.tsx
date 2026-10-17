import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_OPERATORS, isAdminOperator, safeAdminNextPath, type AdminOperator } from "@/lib/admin-operator";
import { getAdminOperator } from "@/lib/admin-operator-server";
import { getAdminMfaState, isSuperAdminAnyAal } from "@/lib/admin-mfa";
import { logout } from "@/app/login/actions";
import { MfaPanel } from "./mfa-panel";

// Lives in (admin-identify), not (admin): the admin layout sends anyone who has not completed MFA
// here, so this page cannot sit behind that same gate. It does its own sign-in + platform-admin
// check, using the "any assurance level" variant because by definition the visitor is not aal2 yet.
export default async function AdminMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isSuperAdminAnyAal(supabase))) redirect("/dashboard");

  const { next, reason } = await searchParams;
  const nextPath = safeAdminNextPath(next);

  const state = await getAdminMfaState(supabase);
  const operator = await getAdminOperator();

  // Already fully signed in as a named operator -> nothing to do here.
  if (state.currentLevel === "aal2" && operator && reason !== "unrecognized-factor") redirect(nextPath);

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = (factors?.all ?? [])
    .filter((f) => f.status === "verified" && f.factor_type === "totp" && isAdminOperator(f.friendly_name))
    .map((f) => ({ id: f.id, operator: f.friendly_name as AdminOperator }));
  const enrolledNames = new Set(verified.map((f) => f.operator));

  return (
    <MfaPanel
      next={nextPath}
      required={state.required}
      verifiedFactors={verified}
      unenrolledOperators={ADMIN_OPERATORS.filter((name) => !enrolledNames.has(name))}
      unrecognizedFactor={reason === "unrecognized-factor"}
      onSignOut={logout}
    />
  );
}
