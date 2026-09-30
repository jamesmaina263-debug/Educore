import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface GuardianContact {
  id: string;
  name: string;
  relationship: string;
  primary_contact: boolean;
}

/**
 * Replicates health/_data.ts's guardiansByStudent map, but scoped to just
 * the given student ids (a single paginated page's worth, ≤ pageSize)
 * instead of every guardian in the school -- student_guardians grows with
 * total student count, so unlike beds/rooms (bounded by physical capacity)
 * it isn't safe to fetch in full here the way boarding's bed-label.ts does.
 */
export async function getGuardiansForStudents(
  supabase: SupabaseClient,
  studentIds: string[],
): Promise<Map<string, GuardianContact[]>> {
  const map = new Map<string, GuardianContact[]>();
  if (studentIds.length === 0) return map;

  const { data: guardianRows } = await supabase
    .from("student_guardians")
    .select("student_id, relationship, primary_contact, school_users(id, full_name, phone)")
    .in("student_id", studentIds);

  for (const g of guardianRows ?? []) {
    const su = g.school_users as unknown as { id: string; full_name: string; phone: string | null } | null;
    if (!su || !su.phone) continue;
    const list = map.get(g.student_id) ?? [];
    list.push({ id: su.id, name: su.full_name, relationship: g.relationship, primary_contact: g.primary_contact });
    map.set(g.student_id, list);
  }

  return map;
}
