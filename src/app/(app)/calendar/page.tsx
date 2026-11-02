import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { CalendarSection, type HouseRow } from "@/components/calendar/calendar-section";
import { CALENDAR_FLAG, type CalendarEvent, type EventAudience, type EventCategory, type EventStatus } from "@/lib/school-calendar";

export default async function CalendarPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed (any error => false).
  if (!(await hasFeatureFlag(supabase, CALENDAR_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canWrite }, { data: eventRows }, { data: houseRows }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.write" }),
    supabase
      .from("school_events")
      .select("id, title, description, category, starts_on, ends_on, start_time, end_time, location, house_id, audience, status, cancel_reason")
      .order("starts_on", { ascending: true })
      .limit(500),
    supabase.from("school_houses").select("id, name, colour, status").order("name", { ascending: true }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const events: CalendarEvent[] = (eventRows ?? []).map((e) => ({
    id: e.id as string,
    title: e.title as string,
    description: (e.description as string | null) ?? null,
    category: e.category as EventCategory,
    startsOn: e.starts_on as string,
    endsOn: e.ends_on as string,
    startTime: (e.start_time as string | null) ?? null,
    endTime: (e.end_time as string | null) ?? null,
    location: (e.location as string | null) ?? null,
    houseId: (e.house_id as string | null) ?? null,
    audience: e.audience as EventAudience,
    status: e.status as EventStatus,
    cancelReason: (e.cancel_reason as string | null) ?? null,
  }));

  const houses: HouseRow[] = (houseRows ?? []).map((h) => ({
    id: h.id as string,
    name: h.name as string,
    colour: h.colour as string,
    status: h.status as "active" | "archived",
  }));

  // "Today" in the school's timezone, not the server's.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Calendar" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">School calendar</h1>
          <p className="text-sm text-muted-foreground">Events, and the competition houses they can belong to.</p>
        </div>
        <CalendarSection events={events} houses={houses} canWrite={canWrite === true} today={today} />
      </div>
    </AppShell>
  );
}
