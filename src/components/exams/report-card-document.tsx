import Link from "next/link";
import { PrintReportCardsButton } from "@/components/exams/print-report-cards-button";
import type { ReportCardDocumentData } from "@/lib/academics/report-card-document";

// Pure presentational, no hooks: shared by the staff print route and the parent-portal route so
// the two never drift apart (same approach as ReceiptDocument). One A4 page per student.
export function ReportCardDocumentSet({ docs, backHref }: { docs: ReportCardDocumentData[]; backHref: string }) {
  return (
    <div className="report-card-sheet" style={{ background: "#f4f4f5", minHeight: "100vh", padding: "1.5rem", fontFamily: "system-ui, sans-serif" }}>
      <div className="print:hidden" style={{ maxWidth: 794, margin: "0 auto 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Link href={backHref} style={{ fontSize: 13, color: "#52525b" }}>
          ← Back
        </Link>
        <PrintReportCardsButton count={docs.length} />
      </div>
      {docs.map((d) => (
        <ReportCardPage key={d.student.id} data={d} />
      ))}
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          body { background: #fff !important; }
          .report-card-sheet { background: #fff !important; padding: 0 !important; min-height: 0 !important; }
          .report-card-page { box-shadow: none !important; border: none !important; margin: 0 !important; max-width: none !important; page-break-after: always; break-after: page; }
          .report-card-page:last-of-type { page-break-after: auto; break-after: auto; }
          .rc-accent { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
        }
      `}</style>
    </div>
  );
}

function ReportCardPage({ data }: { data: ReportCardDocumentData }) {
  const accent = data.school.primaryColor || "#1e40af";
  const cell = { padding: "6px 8px", border: "1px solid #e4e4e7", fontSize: 12 } as const;
  const head = { ...cell, background: "#f4f4f5", textAlign: "left", fontWeight: 600 } as const;
  return (
    <div
      className="report-card-page"
      style={{ maxWidth: 794, margin: "0 auto 24px", background: "#fff", border: "1px solid #e4e4e7", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", overflow: "hidden", color: "#27272a" }}
    >
      <div className="rc-accent" style={{ background: accent, color: "#fff", padding: "16px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        {data.school.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.school.logoUrl} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: "contain", background: "#fff" }} />
        ) : null}
        <div>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{data.school.name}</p>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.9 }}>
            Report Card · {data.exam.name}
            {data.exam.termName ? ` · ${data.exam.termName}` : ""}
          </p>
        </div>
      </div>

      {!data.released && (
        <p style={{ margin: 0, padding: "8px 24px", background: "#fef3c7", color: "#92400e", fontSize: 12, fontWeight: 600 }}>
          DRAFT — the teacher&apos;s comment has not been approved, so this report card is not yet released to parents.
        </p>
      )}

      <div style={{ padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{data.student.fullName}</p>
            <p style={{ margin: 0, fontSize: 12, color: "#71717a" }}>Adm. No. {data.student.admissionNumber ?? "—"}</p>
            <p style={{ margin: 0, fontSize: 12, color: "#71717a" }}>Class: {data.student.classLabel}</p>
          </div>
          {(data.average !== null || data.rank !== null) && (
            <div style={{ textAlign: "right", fontSize: 12 }}>
              {data.average !== null && <p style={{ margin: 0 }}>Average: <strong>{data.average}</strong></p>}
              {data.rank !== null && <p style={{ margin: 0 }}>Position in stream: <strong>{data.rank}</strong></p>}
            </div>
          )}
        </div>

        {data.subjects.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
            <thead>
              <tr>
                <th style={head}>Subject</th>
                <th style={{ ...head, width: 90 }}>Score</th>
                <th style={head}>Grade</th>
              </tr>
            </thead>
            <tbody>
              {data.subjects.map((s) => (
                <tr key={s.subject}>
                  <td style={cell}>{s.subject}</td>
                  <td style={cell}>{s.score ?? "—"}</td>
                  <td style={cell}>{s.grade ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ fontSize: 12, color: "#71717a" }}>No marks recorded for this exam.</p>
        )}

        {data.competencies.length > 0 && (
          <>
            <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 600 }}>CBC competency ratings</p>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
              <tbody>
                {data.competencies.map((c, i) => (
                  <tr key={`${c.subStrand}-${i}`}>
                    <td style={cell}>
                      {c.subject} — {c.strand} — {c.subStrand}
                    </td>
                    <td style={{ ...cell, width: 160, fontWeight: 600 }}>{c.rating}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div style={{ border: "1px solid #e4e4e7", borderRadius: 6, padding: 12, marginBottom: 24, minHeight: 56 }}>
          <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 600 }}>Class teacher&apos;s comment</p>
          <p style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>{data.comment ?? (data.released ? "—" : "Pending approval.")}</p>
        </div>

        <div style={{ display: "flex", gap: 24, fontSize: 11, color: "#52525b", marginTop: 28 }}>
          {["Class teacher", "Principal", "Parent / Guardian"].map((who) => (
            <div key={who} style={{ flex: 1 }}>
              <div style={{ borderBottom: "1px solid #71717a", height: 20 }} />
              <p style={{ margin: "4px 0 0" }}>{who} (signature &amp; date)</p>
            </div>
          ))}
        </div>
      </div>

      {(data.school.address || data.school.phone) && (
        <div style={{ borderTop: "1px solid #e4e4e7", padding: "10px 24px", fontSize: 11, color: "#71717a" }}>
          {data.school.address && <p style={{ margin: 0 }}>{data.school.address}</p>}
          {data.school.phone && <p style={{ margin: 0 }}>{data.school.phone}</p>}
        </div>
      )}
    </div>
  );
}
