import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeAdminNextPath } from "@/lib/admin-operator";
import { getAdminOperator } from "@/lib/admin-operator-server";
import { getAdminMfaState, isSuperAdminAnyAal } from "@/lib/admin-mfa";
import { OperatorPicker } from "./operator-picker";

// Lives in its own route group (not under (admin)) on purpose: (admin)/layout.tsx sends anyone
// without an identified operator here, so this page can't sit behind that same gate without
// redirecting to itself forever. It does its own sign-in + super-admin check instead.
//
// Actual name selection + email-code confirmation is client-side (operator-picker.tsx) so the
// picker can move between the two steps without a full page round-trip each time; this server
// component only establishes it's safe to be here at all and works out where "back to the
// console" should go.
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

  if (!(await isSuperAdminAnyAal(supabase))) redirect("/dashboard");

  // With MFA enforced, identity comes from the verified authenticator -- the self-declared picker
  // (and the emailed-code / James-exempt shortcuts) are retired.
  const mfa = await getAdminMfaState(supabase);
  const { next } = await searchParams;
  if (mfa.required) redirect(`/admin/mfa?next=${encodeURIComponent(safeAdminNextPath(next))}`);

  const current = await getAdminOperator();

  return <OperatorPicker next={safeAdminNextPath(next)} current={current} />;
}
