// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface GuardianChild {
  student_id: string;
  first_name: string;
  last_name: string;
}

export async function getGuardianChildren(
  supabase: SupabaseClient<any, any, any>,
  guardianUserId: string,
  schoolId: string,
): Promise<GuardianChild[]> {
  const { data, error } = await supabase
    .from("student_guardians")
    .select("student_id, students!inner(id, first_name, last_name, school_id)")
    .eq("guardian_user_id", guardianUserId);

  if (error || !data) return [];

  return data
    .map((row: any) => row.students)
    .filter((s: any) => s && s.school_id === schoolId)
    .map((s: any) => ({ student_id: s.id, first_name: s.first_name, last_name: s.last_name }));
}

// Picks which child a student-scoped reply is about. Reusable across every student-scoped
// intent (fee balance, attendance, and anything added later -- results, report cards, timetable,
// ...), not re-implemented per tool: honors an explicit "switch to <name>"/name mention first,
// falls back to the conversation's current student_id cursor, and only auto-picks for an only
// child. With two or more children and no clear signal, the caller must ask rather than guess
// whose data to read out over WhatsApp.
export function resolveChildContext(
  children: GuardianChild[],
  currentStudentId: string | null,
  messageText: string,
): { student: GuardianChild | null; needsDisambiguation: boolean } {
  if (children.length === 0) return { student: null, needsDisambiguation: false };
  if (children.length === 1) return { student: children[0], needsDisambiguation: false };

  const nameMatch = children.find((c) => messageText.toLowerCase().includes(c.first_name.toLowerCase()));
  if (nameMatch) return { student: nameMatch, needsDisambiguation: false };

  const current = children.find((c) => c.student_id === currentStudentId);
  if (current) return { student: current, needsDisambiguation: false };

  return { student: null, needsDisambiguation: true };
}

export function disambiguationPrompt(children: GuardianChild[]): string {
  const names = children.map((c) => c.first_name).join(", ");
  return `You have more than one child with us (${names}). Please reply with the child's first name so I know who you mean.`;
}

// Small shared helper so tools don't each re-implement the same one-off lookup -- used once a
// student_id is already resolved and authorized, just to personalize the reply text.
export async function getStudentFirstName(supabase: SupabaseClient<any, any, any>, studentId: string): Promise<string> {
  const { data } = await supabase.from("students").select("first_name").eq("id", studentId).maybeSingle();
  return data?.first_name ?? "your child";
}
