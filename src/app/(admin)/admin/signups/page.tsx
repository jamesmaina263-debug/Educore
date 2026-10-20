import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminSignupApprovals, type SignupRow } from "@/components/admin/admin-signup-approvals";

type SchoolQueryRow = {
  id: string;
  name: string;
  school_type: string | null;
  institution_type: string | null;
  created_at: string;
  signup_review_status: string;
  signup_reviewed_at: string | null;
  email: string | null;
  phone: string | null;
  school_users: { full_name: string | null; email: string | null; phone: string | null }[] | null;
};

export default async function AdminSignupsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  // Everything still waiting or turned away, plus the most recent decisions so a mis-click is easy to spot.
  const { data, error } = await supabase
    .from("schools")
    .select(
      "id, name, school_type, institution_type, created_at, signup_review_status, signup_reviewed_at, email, phone, school_users(full_name, email, phone)",
    )
    .or("signup_review_status.neq.approved,signup_reviewed_at.not.is.null")
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "school_users", ascending: true })
    .limit(200);

  const rows: SignupRow[] = ((data ?? []) as unknown as SchoolQueryRow[]).map((s) => {
    // The first person created in a self-signup school is its owner.
    const owner = s.school_users?.[0] ?? null;
    return {
      id: s.id,
      name: s.name,
      kind: s.institution_type ?? s.school_type,
      created_at: s.created_at,
      status: s.signup_review_status as SignupRow["status"],
      reviewed_at: s.signup_reviewed_at,
      owner_name: owner?.full_name ?? null,
      owner_email: owner?.email ?? s.email,
      owner_phone: owner?.phone ?? s.phone,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Signup approvals</h1>
        <p className="text-sm text-muted-foreground">
          New schools that signed up on their own wait here until you approve them. Approving starts their 30-day
          trial from that moment. A rejected school is signed out with a &ldquo;not approved&rdquo; message and kept,
          so you can still approve it later.
        </p>
      </div>
      {error ? (
        <p className="rounded-md border border-warning/25 bg-warning-subtle p-3 text-sm text-warning">
          Signup approvals are not available yet (the database update has not been applied). Nothing is held for
          approval until it is.
        </p>
      ) : (
        <AdminSignupApprovals rows={rows} />
      )}
    </div>
  );
}
