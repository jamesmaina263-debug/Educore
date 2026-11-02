import type { SupabaseClient } from "@supabase/supabase-js";
import { loadReportCardDocuments, isReleased } from "@/lib/academics/report-card-document";
import { buildReportCardPdf } from "@/lib/pdf/report-card-pdf";
import { buildStatementPdf } from "@/lib/pdf/student-statement-pdf";
import { loadStatementRaw } from "./load-statement";
import { buildStatementModel } from "./student-statement";

// Builds the PDF for one PIN-verified WhatsApp document request. Runs with the service role (the
// bot has no user session), so every rule the portal gets from RLS is enforced here by hand:
//   - report card: ONLY a card whose comment a teacher approved or wrote (isReleased), the same
//     "released" rule as the parent portal; the latest such card for the learner.
//   - statement: the lines must reconcile exactly with the account balance, or nothing is sent.
// The caller (the route) has already proved the guardian-student link.

export type DocType = "report_card" | "statement";

export type GenerateResult =
  | { ok: true; bytes: Uint8Array; filename: string; caption: string }
  | { ok: false; code: "not_available"; message: string }
  | { ok: false; code: "error"; message: string };

const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "document";

type RcClient = Parameters<typeof loadReportCardDocuments>[0];

export async function generateBotDocument(
  admin: SupabaseClient,
  args: { schoolId: string; studentId: string; docType: DocType },
): Promise<GenerateResult> {
  const { data: student } = await admin
    .from("students")
    .select("first_name")
    .eq("id", args.studentId)
    .eq("school_id", args.schoolId)
    .maybeSingle();
  if (!student) return { ok: false, code: "error", message: "student not found in this school" };
  const first = student.first_name as string;

  if (args.docType === "statement") {
    const raw = await loadStatementRaw(admin, args.schoolId, args.studentId);
    if (!raw) return { ok: false, code: "error", message: "statement data unavailable" };
    const model = buildStatementModel(raw);
    if (!model) return { ok: false, code: "error", message: "statement does not reconcile with the account balance" };
    const doc = await buildStatementPdf(model);
    return {
      ok: true,
      bytes: new Uint8Array(doc.output("arraybuffer")),
      filename: `Fee-Statement-${safe(model.student.fullName)}.pdf`,
      caption: `${first}'s fee statement (${model.termLabel}). Closing balance: ${model.closingBalance.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Please keep this document private.`,
    };
  }

  // Report card: the latest exam for which this learner has a released card.
  const { data: cards } = await admin
    .from("report_cards")
    .select("exam_id, comment_source, exams(created_at)")
    .eq("student_id", args.studentId)
    .eq("school_id", args.schoolId);
  const released = ((cards ?? []) as unknown as { exam_id: string; comment_source: string; exams: { created_at: string } | { created_at: string }[] | null }[])
    .filter((c) => isReleased(c.comment_source))
    .map((c) => ({ examId: c.exam_id, at: (Array.isArray(c.exams) ? c.exams[0]?.created_at : c.exams?.created_at) ?? "" }))
    .sort((a, b) => b.at.localeCompare(a.at));
  if (released.length === 0) {
    return {
      ok: false,
      code: "not_available",
      message: `There is no released report card for ${first} yet. The school releases report cards once the teacher has approved the comments. Please check again later or contact the school office.`,
    };
  }
  const docs = (await loadReportCardDocuments(admin as unknown as RcClient, released[0].examId, { studentId: args.studentId })).filter(
    (d) => d.released && d.student.id === args.studentId,
  );
  const card = docs[0];
  if (!card) return { ok: false, code: "error", message: "report card could not be loaded" };
  const pdf = await buildReportCardPdf(card);
  return {
    ok: true,
    bytes: new Uint8Array(pdf.output("arraybuffer")),
    filename: `Report-Card-${safe(card.student.fullName)}-${safe(card.exam.name)}.pdf`,
    caption: `${first}'s report card (${card.details.assessment}, ${card.details.termYear}). Please keep this document private.`,
  };
}
