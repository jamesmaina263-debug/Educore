import { createClient } from "@/lib/supabase/server";
import { PendingBiometricCapturesTable, type PendingBiometricCaptureRow } from "@/components/settings/pending-biometric-captures-table";

// Task 12 of the admissions fix backlog: no visibility into which enrolled students still need
// their biometric captured. Read-only query over existing tables -- a student is "pending" when
// they have an active biometric_profiles row (person_type='student') but no active
// biometric_credentials row for that profile yet. No new schema; follows the same
// fetch-then-diff-in-JS shape already used by BiometricEventLogPanel in this same directory.
export async function PendingBiometricCapturesPanel() {
  const supabase = await createClient();

  const { data: profiles } = await supabase
    .from("biometric_profiles")
    .select("id, person_id")
    .eq("person_type", "student")
    .eq("status", "active");

  const profileRows = profiles ?? [];
  if (profileRows.length === 0) {
    return <PendingBiometricCapturesTable rows={[]} />;
  }

  const { data: activeCredentials } = await supabase
    .from("biometric_credentials")
    .select("profile_id")
    .eq("status", "active")
    .in(
      "profile_id",
      profileRows.map((p) => p.id),
    );
  const capturedProfileIds = new Set((activeCredentials ?? []).map((c) => c.profile_id));

  const pendingProfiles = profileRows.filter((p) => !capturedProfileIds.has(p.id));
  if (pendingProfiles.length === 0) {
    return <PendingBiometricCapturesTable rows={[]} />;
  }

  const { data: students } = await supabase
    .from("students")
    .select("id, first_name, last_name, admission_number, streams(name, classes(name))")
    .in(
      "id",
      pendingProfiles.map((p) => p.person_id),
    );

  const rows: PendingBiometricCaptureRow[] = (students ?? [])
    .map((s) => {
      const stream = s.streams as unknown as { name: string; classes: { name: string } | null } | null;
      const classLabel = stream ? `${stream.classes?.name ?? ""} ${stream.name}`.trim() : null;
      return {
        id: s.id,
        full_name: `${s.first_name} ${s.last_name}`,
        admission_number: s.admission_number,
        class_label: classLabel,
      };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return <PendingBiometricCapturesTable rows={rows} />;
}
