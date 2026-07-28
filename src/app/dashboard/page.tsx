import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // RLS scopes this to the caller's own row (or all rows, for super_admin) —
  // no manual school_id filter needed here, by design (§6).
  const { data: schoolUser, error } = await supabase
    .from("school_users")
    .select("full_name, status, roles(display_name), schools(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">EduCore</h1>
        <form action={logout}>
          <button type="submit" className="text-sm underline">
            Sign out
          </button>
        </form>
      </div>

      {error && (
        <p className="text-sm text-red-600">
          Could not load your staff profile: {error.message}
        </p>
      )}

      {!error && !schoolUser && (
        <p className="text-sm text-black/60 dark:text-white/60">
          Signed in, but no school_users record is linked to this account
          yet — ask an administrator to add you to a school.
        </p>
      )}

      {schoolUser && (
        <div className="space-y-1 text-sm">
          <p>
            <span className="text-black/60 dark:text-white/60">Name:</span>{" "}
            {schoolUser.full_name}
          </p>
          <p>
            <span className="text-black/60 dark:text-white/60">Role:</span>{" "}
            {(schoolUser.roles as unknown as { display_name: string } | null)
              ?.display_name ?? "—"}
          </p>
          <p>
            <span className="text-black/60 dark:text-white/60">School:</span>{" "}
            {(schoolUser.schools as unknown as { name: string } | null)
              ?.name ?? "—"}
          </p>
          <p>
            <span className="text-black/60 dark:text-white/60">Status:</span>{" "}
            {schoolUser.status}
          </p>
        </div>
      )}
    </div>
  );
}
