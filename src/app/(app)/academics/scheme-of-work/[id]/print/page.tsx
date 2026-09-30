import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { PrintButton } from "@/components/documents/print-button";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_progress: "In Progress",
  submitted: "Submitted",
  under_review: "Under Review",
  approved: "Approved",
};

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Gap #7: print/PDF. No dedicated PDF-generation infrastructure exists
// elsewhere in EduCore to reuse (the `pdf` skill is a document-authoring
// tool for this session, not app runtime code) -- but a browser-print
// pattern already does, used by purchase orders
// (inventory/procurement/[id]/print), fee receipts (finance/payments/[id]
// /receipt) and student ID cards: a self-contained server component that
// fetches its own data (not the dashboard/editor's _data.ts loaders -- same
// choice those pages made), renders an A4 document with print-specific CSS,
// and a floating PrintButton that calls window.print() so the teacher/
// reviewer uses the browser's own Print -> Save as PDF. That's "PDF" here,
// same as everywhere else in the app -- there is no server-side PDF
// renderer anywhere in EduCore to plug into instead.
//
// Landscape rather than the portrait style of the other print pages: a
// scheme-of-work row has ~8 real fields (topic/subtopic, outcomes, content,
// activities+methods, resources, assessment, remarks) and needs the extra
// width to stay legible instead of wrapping every cell to one column.
// ---------------------------------------------------------------------------

export default async function SchemeOfWorkPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const user = await getCachedUser();
  if (!user) redirect("/login");

  // RLS on schemes_of_work (scheme_of_work.read, school-scoped) is what
  // actually authorizes this -- same as every other print page in the app,
  // no separate permission check here. A caller without access gets no row
  // back and hits notFound(), not a leaked draft.
  const { data: scheme } = await supabase
    .from("schemes_of_work")
    .select(
      "id, status, total_weeks, lessons_per_week, reviewed_at, review_comment, subjects(name), classes(name), streams(name), terms(name, academic_years(name)), teacher:school_users!schemes_of_work_teacher_id_fkey(full_name), reviewer:school_users!schemes_of_work_reviewed_by_fkey(full_name), schools(name, logo_url, primary_color, address, phone, email)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!scheme) notFound();

  const { data: entriesRaw } = await supabase
    .from("scheme_of_work_entries")
    .select("*")
    .eq("scheme_id", id)
    .order("week_number")
    .order("lesson_number");
  const entries = entriesRaw ?? [];

  const school = scheme.schools as unknown as {
    name: string;
    logo_url: string | null;
    primary_color: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  const term = scheme.terms as unknown as { name: string; academic_years: { name: string } | null } | null;
  const teacher = scheme.teacher as unknown as { full_name: string } | null;
  const reviewer = scheme.reviewer as unknown as { full_name: string } | null;
  const subjectName = (scheme.subjects as unknown as { name: string } | null)?.name ?? "—";
  const className = (scheme.classes as unknown as { name: string } | null)?.name ?? "—";
  const streamName = (scheme.streams as unknown as { name: string } | null)?.name ?? null;

  const accent = school?.primary_color || "#1e40af";

  return (
    <div style={{ padding: "1.5rem", background: "#f4f4f5", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <div
        className="print-sheet"
        style={{
          background: "#fff",
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #e4e4e7",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}
      >
        <div style={{ background: accent, color: "#fff", padding: "16px 24px", display: "flex", alignItems: "center", gap: 14 }}>
          {school?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={school.logo_url} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "contain", background: "#fff", padding: 4 }} />
          ) : null}
          <div>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{school?.name ?? "EduCore School"}</p>
            <p style={{ margin: "2px 0 0", fontSize: 10, opacity: 0.9 }}>{[school?.address, school?.phone, school?.email].filter(Boolean).join(" · ")}</p>
          </div>
        </div>

        <div style={{ padding: "18px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #f4f4f5", paddingBottom: 12, marginBottom: 14 }}>
            <div>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: 0.5 }}>SCHEME OF WORK</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#71717a" }}>
                {subjectName} — {className}
                {streamName ? ` (${streamName})` : ""}
              </p>
            </div>
            <div style={{ textAlign: "right", fontSize: 11, color: "#71717a" }}>
              <p style={{ margin: 0 }}>
                Term: <strong style={{ color: "#18181b" }}>{term ? `${term.name}, ${term.academic_years?.name ?? ""}` : "—"}</strong>
              </p>
              <p style={{ margin: 0 }}>
                Teacher: <strong style={{ color: "#18181b" }}>{teacher?.full_name ?? "—"}</strong>
              </p>
              <p style={{ margin: 0 }}>
                Weeks x Lessons/week: <strong style={{ color: "#18181b" }}>{scheme.total_weeks} x {scheme.lessons_per_week}</strong>
              </p>
              <p style={{ margin: 0 }}>
                Status: <strong style={{ color: "#18181b" }}>{STATUS_LABEL[scheme.status] ?? scheme.status}</strong>
              </p>
            </div>
          </div>

          {entries.length === 0 ? (
            <p style={{ fontSize: 12, color: "#71717a", padding: "24px 0", textAlign: "center" }}>No lessons have been added to this scheme yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e4e4e7", textAlign: "left", background: "#fafafa" }}>
                  <th style={{ padding: "5px 4px", fontWeight: 600, fontSize: 9.5, color: "#71717a", textTransform: "uppercase", width: "6%" }}>Wk/Lsn</th>
                  <th style={{ padding: "5px 4px", fontWeight: 600, fontSize: 9.5, color: "#71717a", textTransform: "uppercase", width: "6%" }}>Date</th>
                  <th style={{ padding: "5px 4px", fontWeight: 600, fontSize: 9.5, color: "#71717a", textTransform: "uppercase", width: "14%" }}>Topic / Sub-topic</th>
                  <th style={{ padding: "5px 4px", fontWeight: 600, fontSize: 9.5, color: "#71717a", textTransform: "uppercase", width: "14%" }}>Learning Outcomes</th>
                  <th style={{ padding: "5px 4px", fontWeight: 600, fontSize: 9.5, color: "#71717a", textTransform: "uppercase", width: "14%" }}>Content</th>
                  <th style={{ padding: "5px 4px", fontWeight: 600, fontSize: 9.5, color: "#71717a", textTransform: "uppercase", width: "16%" }}>Activities &amp; Methods</th>
                  <th style={{ padding: "5px 4px", fontWeight: 600, fontSize: 9.5, color: "#71717a", textTransform: "uppercase", width: "12%" }}>Resources</th>
                  <th style={{ padding: "5px 4px", fontWeight: 600, fontSize: 9.5, color: "#71717a", textTransform: "uppercase", width: "10%" }}>Assessment</th>
                  <th style={{ padding: "5px 4px", fontWeight: 600, fontSize: 9.5, color: "#71717a", textTransform: "uppercase", width: "8%" }}>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const remarksParts = [entry.remarks, entry.references ? `Ref: ${entry.references}` : null].filter(Boolean);
                  return (
                    <tr key={entry.id} style={{ borderBottom: "1px solid #f4f4f5", verticalAlign: "top" }}>
                      <td style={{ padding: "6px 4px", fontWeight: 600 }}>
                        {entry.week_number}.{entry.lesson_number}
                      </td>
                      <td style={{ padding: "6px 4px", color: "#71717a" }}>{formatDate(entry.entry_date)}</td>
                      <td style={{ padding: "6px 4px" }}>
                        {entry.topic}
                        {entry.subtopic ? <span style={{ color: "#71717a" }}> — {entry.subtopic}</span> : null}
                      </td>
                      <td style={{ padding: "6px 4px" }}>{entry.learning_outcomes || "—"}</td>
                      <td style={{ padding: "6px 4px" }}>{entry.content || "—"}</td>
                      <td style={{ padding: "6px 4px" }}>
                        {entry.activities || "—"}
                        {entry.teaching_methods ? <span style={{ color: "#71717a" }}> ({entry.teaching_methods})</span> : null}
                      </td>
                      <td style={{ padding: "6px 4px" }}>{entry.resources || "—"}</td>
                      <td style={{ padding: "6px 4px" }}>{entry.assessment_methods || "—"}</td>
                      <td style={{ padding: "6px 4px", color: "#71717a" }}>{remarksParts.length > 0 ? remarksParts.join(" · ") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 28, paddingTop: 14, borderTop: "1px solid #e4e4e7" }}>
            <p style={{ margin: 0, fontSize: 9.5, color: "#a1a1aa" }}>
              {scheme.status === "approved" && reviewer
                ? `Approved by ${reviewer.full_name}${scheme.reviewed_at ? ` on ${formatDateTime(scheme.reviewed_at)}` : ""}.`
                : "This is a system-generated scheme of work."}
              {scheme.status === "approved" && scheme.review_comment ? ` "${scheme.review_comment}"` : ""}
            </p>
            <div style={{ display: "flex", gap: 32 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 120, borderBottom: "1px solid #a1a1aa", marginBottom: 4, height: 20 }} />
                <p style={{ margin: 0, fontSize: 9.5, color: "#a1a1aa" }}>Teacher&apos;s signature</p>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 120, borderBottom: "1px solid #a1a1aa", marginBottom: 4, height: 20 }} />
                <p style={{ margin: 0, fontSize: 9.5, color: "#a1a1aa" }}>Head of Department / Principal</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <PrintButton label="Print scheme of work" />

      <style>{`
        @page {
          size: A4 landscape;
          margin: 12mm;
        }
        thead { display: table-header-group; }
        tr { break-inside: avoid; page-break-inside: avoid; }
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-sheet { box-shadow: none !important; border: none !important; border-radius: 0 !important; }
        }
        @media print {
          @page {
            @bottom-right {
              content: "Page " counter(page) " of " counter(pages);
              font-size: 8px;
              color: #71717a;
            }
          }
        }
      `}</style>
    </div>
  );
}
