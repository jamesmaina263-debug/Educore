import { isReleased } from "@/lib/academics/report-card-document";

// Pure status rules for the Report Cards class overview and the per-class student list. Nothing here
// touches the database: the loaders feed it rows and it answers "how far along is this class?".
//
// A student's report card is in exactly one of four states:
//   not_generated  no report_cards row yet for this exam (generate_report_cards hasn't covered them,
//                  e.g. a student admitted after the class was generated)
//   needs_comment  row exists, comment_source = 'none' and no comment text (freshly generated)
//   needs_reapproval  comment_source = 'none' but comment text exists: a post-close mark correction
//                  reset an approved card (the text is kept on purpose so re-approval is one click)
//   ai_draft       comment_source = 'ai': drafted, waiting for a teacher to approve
//   approved       comment_source = 'teacher_approved' | 'teacher_written': released to the portal
// "Approved" deliberately reuses isReleased() from report-card-document.ts, the same rule RLS applies
// before a guardian can see a card, so the overview never disagrees with the portal.

export type CardStatus = "not_generated" | "needs_comment" | "needs_reapproval" | "ai_draft" | "approved";

export function cardStatusOf(card: { comment_source: string | null; comment?: string | null } | null | undefined): CardStatus {
  if (!card) return "not_generated";
  if (isReleased(card.comment_source)) return "approved";
  if (card.comment_source === "ai") return "ai_draft";
  return card.comment?.trim() ? "needs_reapproval" : "needs_comment";
}

export interface ClassStatusSummary {
  /** Active students currently in this class's streams (the same set generate_report_cards covers). */
  total: number;
  /** Of those, how many have a report card row for this exam. */
  generated: number;
  /** Active students with no report card row yet. */
  pending: number;
  /** Released cards (teacher approved / written). */
  approved: number;
  /** Cards with an AI-drafted comment waiting for approval. */
  aiDraft: number;
  /** Cards generated but with no comment yet. */
  needsComment: number;
}

export function summariseClassStatus(totalStudents: number, cards: { comment_source: string | null }[]): ClassStatusSummary {
  const total = Math.max(0, Math.floor(totalStudents));
  let approved = 0;
  let aiDraft = 0;
  let needsComment = 0;
  for (const card of cards) {
    const status = cardStatusOf(card);
    if (status === "approved") approved += 1;
    else if (status === "ai_draft") aiDraft += 1;
    else needsComment += 1;
  }
  const generated = cards.length;
  return { total, generated, pending: Math.max(0, total - generated), approved, aiDraft, needsComment };
}

export type ClassHealth = "empty" | "not_started" | "needs_generation" | "in_review" | "complete";

/** One headline label per class, for the overview card badge. */
export function classHealthOf(s: ClassStatusSummary): ClassHealth {
  if (s.total === 0 && s.generated === 0) return "empty";
  if (s.generated === 0) return "not_started";
  if (s.pending > 0) return "needs_generation";
  if (s.approved >= s.generated) return "complete";
  return "in_review";
}

export function addSummaries(items: ClassStatusSummary[]): ClassStatusSummary {
  return items.reduce<ClassStatusSummary>(
    (acc, s) => ({
      total: acc.total + s.total,
      generated: acc.generated + s.generated,
      pending: acc.pending + s.pending,
      approved: acc.approved + s.approved,
      aiDraft: acc.aiDraft + s.aiDraft,
      needsComment: acc.needsComment + s.needsComment,
    }),
    { total: 0, generated: 0, pending: 0, approved: 0, aiDraft: 0, needsComment: 0 },
  );
}

// ---- student list (inside a class) ----

export interface StudentSummary {
  student_id: string;
  full_name: string;
  admission_number: string | null;
  stream_id: string;
  average_score: number | null;
  rank_in_stream: number | null;
  status: CardStatus;
  report_card_id: string | null;
}

export interface StreamGroup {
  id: string;
  name: string;
  /** Whether the signed-in user may approve / write / AI-draft comments for this stream's students. */
  canApprove: boolean;
  students: StudentSummary[];
}

/**
 * Streams whose comments the user may approve, mirroring the report_cards update policies:
 *   report_cards.approve_any  -> every stream
 *   report_cards.approve      -> only streams where they are the class teacher
 * This only decides which controls the page shows; the database policies remain the real gate.
 */
export function streamsUserCanApprove(params: {
  canApproveAny: boolean;
  canApproveOwn: boolean;
  schoolUserId: string | null;
  streams: { id: string; class_teacher_id: string | null }[];
}): Set<string> {
  const { canApproveAny, canApproveOwn, schoolUserId, streams } = params;
  if (canApproveAny) return new Set(streams.map((s) => s.id));
  if (!canApproveOwn || !schoolUserId) return new Set();
  return new Set(streams.filter((s) => s.class_teacher_id === schoolUserId).map((s) => s.id));
}

/** Case-insensitive; every whitespace-separated word must appear in "name admission-number", so
 *  "jane wanj", "wanjiku jane" and "1234/2024" all find the same learner. Empty query matches all. */
export function studentMatchesQuery(student: Pick<StudentSummary, "full_name" | "admission_number">, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${student.full_name} ${student.admission_number ?? ""}`.toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export function filterStreamGroups(groups: StreamGroup[], query: string): StreamGroup[] {
  if (!query.trim()) return groups;
  return groups
    .map((g) => ({ ...g, students: g.students.filter((s) => studentMatchesQuery(s, query)) }))
    .filter((g) => g.students.length > 0);
}

export function summariseStream(students: StudentSummary[]): {
  total: number;
  approved: number;
  needsAttention: number;
  notGenerated: number;
  /** Generated with no comment at all: what "Draft AI comments" would fill. */
  draftable: number;
  /** AI drafts waiting for a teacher, plus reset cards that kept their text: what "Approve" would release. */
  approvable: number;
} {
  let approved = 0;
  let needsAttention = 0;
  let notGenerated = 0;
  let draftable = 0;
  let approvable = 0;
  for (const s of students) {
    if (s.status === "approved") approved += 1;
    else if (s.status === "not_generated") notGenerated += 1;
    else needsAttention += 1;
    if (s.status === "needs_comment") draftable += 1;
    if (s.status === "ai_draft" || s.status === "needs_reapproval") approvable += 1;
  }
  return { total: students.length, approved, needsAttention, notGenerated, draftable, approvable };
}

/**
 * Which report cards a bulk "approve" may release: still unreleased (AI draft, or reset to 'none') AND
 * carrying actual comment text. A card with no text is never approved in bulk: approving releases it
 * to parents, so an empty comment must not go out.
 */
export function selectBulkApprovable<T extends { comment_source: string | null; comment: string | null }>(cards: T[]): T[] {
  return cards.filter((c) => (c.comment_source === "ai" || c.comment_source === "none") && !!c.comment?.trim());
}
