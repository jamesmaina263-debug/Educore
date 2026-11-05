import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { BusAlertsPanel, type AlertLogRow, type AlertSettings, type ReconRow, type RiderOption, type RouteOption } from "@/components/transport/bus-alerts-panel";
import { BUS_ALERTS_FLAG, isBusAlertMode } from "@/lib/bus-alerts";

type One<T> = T | T[] | null | undefined;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

// WP 5.4 + 5.5: staff screen for guardian bus alerts and bus roll-call. Hidden (404) unless the school has the flag.
// Everything is read through the caller's own RLS; the database functions enforce permissions and the test-first rule.
export default async function BusAlertsPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");
  if (!(await hasFeatureFlag(supabase, BUS_ALERTS_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canRead }, { data: canWrite }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "transport.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "transport.write" }),
  ]);
  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  let body: React.ReactNode = <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">You don&apos;t have access to bus alerts.</div>;
  if (canRead === true) {
    const [{ data: s }, { data: routeRows }, { data: assignRows }, { data: logRows }, { data: reconRows }] = await Promise.all([
      supabase.from("bus_alert_settings").select("mode, test_phone, test_sent_at").maybeSingle(),
      supabase.from("transport_routes").select("id, name").order("name"),
      supabase
        .from("student_transport_assignments")
        .select("student_id, students(first_name, last_name), transport_routes(name)")
        .eq("status", "active")
        .limit(500),
      supabase.from("bus_alerts").select("id, created_at, kind, mode, outcome").order("created_at", { ascending: false }).limit(15),
      supabase.rpc("bus_boarding_reconciliation", { p_date: null }),
    ]);

    const settings: AlertSettings = {
      mode: s && isBusAlertMode(s.mode) ? s.mode : "off",
      testPhone: (s?.test_phone as string | null) ?? null,
      testSent: !!s?.test_sent_at,
    };
    const routes: RouteOption[] = (routeRows ?? []).map((r) => ({ id: r.id as string, name: r.name as string }));
    const seen = new Set<string>();
    const riders: RiderOption[] = (assignRows ?? [])
      .map((a) => {
        const st = one(a.students as unknown as One<{ first_name: string; last_name: string }>);
        const rt = one(a.transport_routes as unknown as One<{ name: string }>);
        return { studentId: a.student_id as string, name: st ? `${st.first_name} ${st.last_name}`.trim() : "Learner", route: rt?.name ?? "" };
      })
      .filter((r) => (seen.has(r.studentId) ? false : (seen.add(r.studentId), true)))
      .sort((a, b) => a.name.localeCompare(b.name));

    body = (
      <BusAlertsPanel
        settings={settings}
        routes={routes}
        riders={riders}
        recon={(reconRows ?? []) as ReconRow[]}
        log={(logRows ?? []) as AlertLogRow[]}
        canWrite={canWrite === true}
      />
    );
  }

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Transport", href: "/transport" }, { label: "Bus alerts" }]}
      userName={schoolUser?.full_name ?? ""}
      userRole={roleName}
      onSignOut={logout}
    >
      {body}
    </AppShell>
  );
}
