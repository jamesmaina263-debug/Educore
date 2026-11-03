import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { BusStatusPanel, type BusChild } from "@/components/portal/bus-status-card";
import { LIVE_TRACKING_FLAG, PARENT_BUS_VIEW_FLAG, isUuid, parseGuardianBusStatus, type GuardianBusStatus } from "@/lib/bus-live";

// WP 5.3: where a parent sees where their child's school bus is while it is on its route. Hidden (404) unless the
// signed-in account is a parent AND the school has both live tracking and parent bus view switched on. The
// database function guardian_bus_status() enforces the same rules again for every learner.
export default async function PortalBusPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/parent-login");

  const { data: schoolUser } = await supabase.from("school_users").select("id, roles(name)").eq("auth_user_id", user.id).maybeSingle();
  const roleName = (schoolUser?.roles as unknown as { name: string } | null)?.name;
  if (!schoolUser || roleName !== "parent") notFound();
  if (!(await hasFeatureFlag(supabase, LIVE_TRACKING_FLAG)) || !(await hasFeatureFlag(supabase, PARENT_BUS_VIEW_FLAG))) notFound();

  const { data: links } = await supabase.from("student_guardians").select("students(id, first_name)").eq("guardian_user_id", schoolUser.id);
  const children: BusChild[] = (links ?? [])
    .map((l) => l.students as unknown as { id: string; first_name: string } | null)
    .filter((s): s is { id: string; first_name: string } => s !== null && isUuid(s.id))
    .map((s) => ({ id: s.id, name: s.first_name }));

  const initial: Record<string, GuardianBusStatus> = {};
  await Promise.all(
    children.map(async (c) => {
      const { data, error } = await supabase.rpc("guardian_bus_status", { p_student_id: c.id });
      initial[c.id] = error ? { status: "unavailable" } : parseGuardianBusStatus(data);
    }),
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 bg-background p-4">
      <Link href="/portal" className="text-xs text-muted-foreground underline">
        Back to portal
      </Link>
      <div className="panel p-4">
        <p className="label-eyebrow mb-2">School bus</p>
        <p className="mb-4 text-sm text-muted-foreground">
          See where the school bus is while it is on its route. This shows the bus, not whether your child is on board, and the position only appears
          while the bus is sharing its location.
        </p>
        {children.length === 0 ? (
          <p className="text-sm text-muted-foreground">Your child&apos;s information will appear here once the school has added it.</p>
        ) : (
          <BusStatusPanel learners={children} initial={initial} />
        )}
      </div>
    </div>
  );
}
