import { createClient } from "@/lib/supabase/server";
import { BiometricEventLogTable, type BiometricEventLogRow } from "@/components/settings/biometric-event-log-table";

export async function BiometricEventLogPanel() {
  const supabase = await createClient();

  const { data: verifications } = await supabase
    .from("biometric_verifications")
    .select("id, occurred_at, result, profile_id, biometric_devices(name)")
    .order("occurred_at", { ascending: false })
    .limit(200);

  const rows = verifications ?? [];
  const profileIds = Array.from(new Set(rows.map((r) => r.profile_id).filter((id): id is string => !!id)));

  const { data: profiles } = profileIds.length
    ? await supabase.from("biometric_profiles").select("id, person_type, person_id").in("id", profileIds)
    : { data: [] };

  const studentIds = (profiles ?? []).filter((p) => p.person_type === "student").map((p) => p.person_id);
  const staffIds = (profiles ?? []).filter((p) => p.person_type === "staff").map((p) => p.person_id);

  const [{ data: students }, { data: staff }] = await Promise.all([
    studentIds.length
      ? supabase.from("students").select("id, first_name, last_name").in("id", studentIds)
      : Promise.resolve({ data: [] }),
    staffIds.length
      ? supabase.from("school_users").select("id, full_name").in("id", staffIds)
      : Promise.resolve({ data: [] }),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const studentNameById = new Map((students ?? []).map((s) => [s.id, `${s.first_name} ${s.last_name}`]));
  const staffNameById = new Map((staff ?? []).map((s) => [s.id, s.full_name]));

  // Successful verifications produced a biometric_events row -- fetch those
  // to show check_in/check_out direction alongside the outcome.
  const successVerificationIds = rows.filter((r) => r.result === "success").map((r) => r.id);
  const { data: events } = successVerificationIds.length
    ? await supabase.from("biometric_events").select("verification_id, event_type").in("verification_id", successVerificationIds)
    : { data: [] };
  const eventTypeByVerificationId = new Map((events ?? []).map((e) => [e.verification_id, e.event_type]));

  const tableRows: BiometricEventLogRow[] = rows.map((r) => {
    const profile = r.profile_id ? profileById.get(r.profile_id) : null;
    const personName = profile
      ? profile.person_type === "student"
        ? (studentNameById.get(profile.person_id) ?? null)
        : (staffNameById.get(profile.person_id) ?? null)
      : null;
    return {
      id: r.id,
      occurred_at: r.occurred_at,
      person_name: personName,
      person_type: (profile?.person_type as "student" | "staff" | undefined) ?? null,
      device_name: (r.biometric_devices as unknown as { name: string } | null)?.name ?? null,
      result: r.result,
      event_type: eventTypeByVerificationId.get(r.id) ?? null,
    };
  });

  return <BiometricEventLogTable rows={tableRows} />;
}
