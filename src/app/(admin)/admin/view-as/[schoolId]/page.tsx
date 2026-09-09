import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { logAdminAction } from "@/lib/log-admin-action";
import { StatusBadge } from "@/components/status-badge";
import { KpiCard } from "@/components/admin/analytics/kpi-card";

// This is a READ-ONLY SNAPSHOT, not a real session swap into the school's own account. True
// impersonation (reusing every existing school-app page/action as-is) would mean every one of
// the ~100+ scattered `.from("school_users").select(...).eq("auth_user_id", user.id)` lookups
// across the school app resolving to a different person's identity instead of the platform
// admin's own -- that's an auth-architecture change with real security stakes (a write path
// missed during that swap becomes a super_admin silently mutating a school's data as someone
// else), not something to build and ship in one pass without a dedicated design review. This
// gives the actual support value asked for -- see what a school's setup/activity looks like
// without a SQL console -- by reading the same tables directly (super_admin already bypasses
// SELECT RLS everywhere, confirmed against schools/school_users/announcements/platform_invoices
// live policies) and rendering a purpose-built summary. No mutations are exposed anywhere on
// this page. Flagging this trade-off plainly rather than quietly under-delivering against "see
// exactly what they see" -- full session impersonation is a separate, larger piece of work if
// still wanted.

function formatLastActive(lastActiveAt: string | null): string {
  if (!lastActiveAt) return "No login activity recorded";
  const days = Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / 86_400_000);
  if (days <= 0) return "Active today";
  if (days === 1) return "Active yesterday";
  return `Last active ${days}d ago`;
}

export default async function ViewAsSchoolPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const { data: school } = await supabase
    .from("schools")
    .select("id, name, slug, status, school_type, created_at")
    .eq("id", schoolId)
    .maybeSingle();
  if (!school) notFound();

  // Logged after confirming the school exists, so a bad id in the URL doesn't produce a
  // misleading "viewed school X" entry for a school that was never actually shown.
  void logAdminAction(supabase, "view_as_school", { school_id: schoolId, school_name: school.name });

  const [
    { data: sub },
    { data: staff },
    { count: studentCount },
    { data: invoices },
    { data: announcements },
    { data: lastActiveRows },
  ] = await Promise.all([
    supabase
      .from("school_subscriptions")
      .select("status, trial_ends_at, plan_id, subscription_plans(name)")
      .eq("school_id", schoolId)
      .maybeSingle(),
    supabase
      .from("school_users")
      .select("id, full_name, position, status, roles(display_name)")
      .eq("school_id", schoolId)
      .order("full_name")
      .limit(25),
    supabase.from("students").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    supabase
      .from("platform_invoices")
      .select("id, amount_kes, status, due_at, paid_at")
      .eq("school_id", schoolId)
      .order("due_at", { ascending: false })
      .limit(10),
    supabase
      .from("announcements")
      .select("id, title, urgency, published_at")
      .eq("school_id", schoolId)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(10),
    supabase.rpc("admin_school_last_active"),
  ]);

  const lastActiveAt =
    ((lastActiveRows ?? []) as { school_id: string; last_active_at: string | null }[]).find(
      (r) => r.school_id === schoolId,
    )?.last_active_at ?? null;

  const planName = (sub?.subscription_plans as unknown as { name: string } | null)?.name ?? "No plan";
  const staffRows = (staff ?? []) as {
    id: string;
    full_name: string;
    position: string | null;
    status: string;
    roles: { display_name: string }[] | null;
  }[];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin" className="flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="size-3.5" /> Back to Overview
        </Link>
        <StatusBadge tone="warning" label="Read-only admin view — no actions taken here" />
      </div>

      <div>
        <h1 className="text-lg font-semibold">{school.name}</h1>
        <p className="text-sm text-muted-foreground">
          /{school.slug} · {school.school_type ?? "School"} · {formatLastActive(lastActiveAt)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Status" value={school.status} />
        <KpiCard label="Plan" value={planName} sub={sub?.status ?? undefined} />
        <KpiCard label="Staff" value={staffRows.length} sub={staffRows.length === 25 ? "showing first 25" : undefined} />
        <KpiCard label="Students" value={studentCount ?? 0} />
      </div>

      <div className="panel">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Staff</h2>
        </header>
        {staffRows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No staff on record.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Position</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {staffRows.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.full_name}</td>
                    <td>{s.roles?.[0]?.display_name ?? "—"}</td>
                    <td>{s.position ?? "—"}</td>
                    <td>
                      <StatusBadge tone={s.status === "active" ? "success" : "neutral"} label={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="panel">
          <header className="border-b border-border px-4 py-2.5">
            <h2 className="text-[0.8125rem] font-semibold">Recent invoices</h2>
          </header>
          {(invoices ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(invoices ?? []).map((inv) => (
                <li key={inv.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span>KES {Number(inv.amount_kes).toLocaleString()}</span>
                  <StatusBadge
                    tone={inv.status === "paid" ? "success" : inv.status === "overdue" ? "danger" : "warning"}
                    label={inv.status}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <header className="border-b border-border px-4 py-2.5">
            <h2 className="text-[0.8125rem] font-semibold">Recent announcements</h2>
          </header>
          {(announcements ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No published announcements.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(announcements ?? []).map((a) => (
                <li key={a.id} className="px-4 py-2 text-sm">
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.published_at ? new Date(a.published_at).toLocaleDateString() : "—"} · {a.urgency}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
