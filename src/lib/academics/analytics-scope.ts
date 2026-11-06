import type { createClient } from "@/lib/supabase/server";

// Who sees what in the Academic Performance Analytics school page.
//
// Verified against the live RLS (not assumed): marks_select lets ANY holder of exams.read read the whole
// school's marks, and the default Teacher, Class Teacher, Deputy Principal and Academic Officer roles all
// hold exams.read. So the database alone does NOT keep a teacher to their own classes. The scope is
// therefore applied here, as an explicit class filter on the query:
//   - "school":  ai.read (Principal, School Owner) or marks.write_any (also Deputy Principal) -> everything;
//   - "classes": otherwise exams.read -> only classes the person is class teacher of, or teaches a subject in;
//   - "none":    no exams.read -> nothing.
// A person with exams.read who has no classes gets an empty page, never the whole school.

type Client = Awaited<ReturnType<typeof createClient>>;

export type AnalyticsScope = { level: "school" } | { level: "classes"; classIds: string[] } | { level: "none" };

export interface ScopePermissions {
  aiRead: boolean;
  writeAny: boolean;
  examsRead: boolean;
}

export function resolveAnalyticsScope(p: ScopePermissions, teacherClassIds: string[]): AnalyticsScope {
  if (p.aiRead || p.writeAny) return { level: "school" };
  if (p.examsRead) return { level: "classes", classIds: [...new Set(teacherClassIds)] };
  return { level: "none" };
}

/** Classes this signed-in person is class teacher of, or teaches a subject in (class_subjects.teacher_id). */
export async function loadTeacherClassIds(supabase: Client): Promise<string[]> {
  const { data: meId } = await supabase.rpc("auth_school_user_id");
  if (!meId) return [];
  const [owned, taught] = await Promise.all([
    supabase.from("streams").select("class_id").eq("class_teacher_id", meId as string),
    supabase.from("class_subjects").select("streams(class_id)").eq("teacher_id", meId as string),
  ]);
  const ids = new Set<string>();
  for (const s of (owned.data ?? []) as { class_id: string }[]) ids.add(s.class_id);
  for (const r of (taught.data ?? []) as unknown as { streams: { class_id: string } | { class_id: string }[] | null }[]) {
    const st = Array.isArray(r.streams) ? r.streams[0] : r.streams;
    if (st?.class_id) ids.add(st.class_id);
  }
  return [...ids];
}

export async function resolveScopeForCurrentUser(supabase: Client): Promise<AnalyticsScope> {
  const has = async (key: string) => (await supabase.rpc("auth_has_permission", { p_permission_key: key })).data === true;
  const [aiRead, writeAny, examsRead] = await Promise.all([has("ai.read"), has("marks.write_any"), has("exams.read")]);
  const needsClasses = !aiRead && !writeAny && examsRead;
  return resolveAnalyticsScope({ aiRead, writeAny, examsRead }, needsClasses ? await loadTeacherClassIds(supabase) : []);
}
