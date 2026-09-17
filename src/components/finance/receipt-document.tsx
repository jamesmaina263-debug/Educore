import { PrintReceiptButton } from "@/components/finance/print-receipt-button";
import type { PaymentReceiptData } from "@/lib/finance/receipt";

// Pure presentational — same component is used by the staff-side Finance receipt page and the
// parent-portal receipt page, so the two never drift out of sync. No hooks, no "use client":
// safe to render from either server component.
export function ReceiptDocument({ data }: { data: PaymentReceiptData }) {
  const accent = data.school.primaryColor || "#1e40af";

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "2rem", background: "#f4f4f5", minHeight: "100vh" }}>
      <div style={{ width: "560px", maxWidth: "100%" }}>
        <div className="print:hidden" style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
          <PrintReceiptButton />
        </div>

        <div
          style={{
            borderRadius: "12px",
            overflow: "hidden",
            border: "1px solid #e4e4e7",
            background: "#fff",
            fontFamily: "system-ui, sans-serif",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ background: accent, color: "#fff", padding: "18px 24px", display: "flex", alignItems: "center", gap: "12px" }}>
            {data.school.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.school.logoUrl} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "contain", background: "#fff" }} />
            ) : null}
            <div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{data.school.name}</p>
              <p style={{ margin: 0, fontSize: 11, opacity: 0.85 }}>Payment Receipt</p>
            </div>
          </div>

          <div style={{ padding: "24px", fontSize: 13, color: "#27272a" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "18px", gap: "12px" }}>
              <div>
                <p style={{ margin: 0, fontWeight: 600 }}>{data.student.fullName}</p>
                <p style={{ margin: 0, color: "#71717a" }}>Adm. No. {data.student.admissionNumber ?? "—"}</p>
                <p style={{ margin: 0, color: "#71717a" }}>Class: {data.student.classLabel}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ margin: 0, fontFamily: "monospace", fontWeight: 600 }}>{data.receiptNumber}</p>
                <p style={{ margin: 0, color: "#71717a" }}>
                  {new Date(data.issuedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                </p>
              </div>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                <ReceiptRow label="Amount paid" value={`KES ${data.amount.toLocaleString()}`} />
                <ReceiptRow
                  label="Balance"
                  value={data.balance > 0 ? `KES ${data.balance.toLocaleString()}` : "Fully paid"}
                />
                <ReceiptRow label="Method" value={data.method.toUpperCase()} />
                <ReceiptRow label="Reference" value={data.reference ?? "—"} />
                <ReceiptRow label="Purpose" value={data.purpose ?? "—"} />
                <ReceiptRow label="Recorded" value={new Date(data.recordedAt).toLocaleString("en-GB")} />
                {data.recordedByName && <ReceiptRow label="Received by" value={data.recordedByName} />}
              </tbody>
            </table>

            {data.reversedTotal > 0 && (
              <p style={{ marginTop: "16px", padding: "10px 12px", background: "#fef2f2", color: "#991b1b", borderRadius: "8px", fontSize: 12 }}>
                {data.reversedTotal >= data.amount
                  ? "This payment has since been fully reversed."
                  : `KES ${data.reversedTotal.toLocaleString()} of this payment has since been reversed.`}
              </p>
            )}
          </div>

          {(data.school.address || data.school.phone) && (
            <div style={{ borderTop: "1px solid #e4e4e7", padding: "12px 24px", fontSize: 11, color: "#71717a" }}>
              {data.school.address && <p style={{ margin: 0 }}>{data.school.address}</p>}
              {data.school.phone && <p style={{ margin: 0 }}>{data.school.phone}</p>}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media print {
          body { background: #fff !important; }
        }
      `}</style>
    </div>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: "6px 0", color: "#71717a", width: "40%", verticalAlign: "top" }}>{label}</td>
      <td style={{ padding: "6px 0", fontWeight: 500 }}>{value}</td>
    </tr>
  );
}
