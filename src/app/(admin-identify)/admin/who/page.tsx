import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeAdminNextPath } from "@/lib/admin-operator";
import { getAdminOperator } from "@/lib/admin-operator-server";
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

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const { next } = await searchParams;
  const current = await getAdminOperator();

  return <OperatorPicker next={safeAdminNextPath(next)} current={current} />;
}
