import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/documents/print-button";

export default async function ReceiptPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: payment } = await supabase
    .from("payments")
    .select(
      "id, amount, method, reference, purpose, notes, phone_number, recorded_at, students(first_name, last_name, other_names, admission_number, streams(name, classes(name))), schools(name, logo_url, primary_color, address, phone, email, kra_pin, currency_code, motto)",
    )
    .eq("id", paymentId)
    .maybeSingle();

  if (!payment) notFound();

  const { data: receipt } = await supabase
    .from("receipts")
    .select("receipt_number, issued_at")
    .eq("payment_id", paymentId)
    .maybeSingle();

  // A payment that hasn't been issued a receipt yet has nothing printable here.
  if (!receipt) notFound();

  const school = payment.schools as unknown as {
    name: string;
    logo_url: string | null;
    primary_color: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    kra_pin: string | null;
    currency_code: string | null;
    motto: string | null;
  } | null;
  const student = payment.students as unknown as {
    first_name: string;
    last_name: string;
    other_names: string | null;
    admission_number: string | null;
    streams: { name: string; classes: { name: string } | null } | null;
  } | null;

  const payerName = student ? [student.first_name, student.other_names, student.last_name].filter(Boolean).join(" ") : "—";
  const classLabel = student?.streams ? `${student.streams.classes?.name ?? ""} ${student.streams.name}`.trim() : null;
  const accent = school?.primary_color || "#1e40af";
  const currency = school?.currency_code || "KES";
  const methodLabel: Record<string, string> = {
    mpesa: "M-Pesa",
    cash: "Cash",
    bank: "Bank Transfer",
    cheque: "Cheque",
    card: "Card",
    other: "Other",
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "2.5rem 1rem", background: "#f4f4f5", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <div
        className="print-sheet"
        style={{
          width: "100%",
          maxWidth: "680px",
          background: "#fff",
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #e4e4e7",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}
      >
        <div style={{ background: accent, color: "#fff", padding: "20px 28px", display: "flex", alignItems: "center", gap: 14 }}>
          {school?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={school.logo_url} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: "contain", background: "#fff", padding: 4 }} />
          ) : null}
          <div>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{school?.name ?? "EduCore School"}</p>
            {school?.motto && <p style={{ margin: 0, fontSize: 11, opacity: 0.85, fontStyle: "italic" }}>{school.motto}</p>}
            <p style={{ margin: "2px 0 0", fontSize: 10.5, opacity: 0.9 }}>
              {[school?.address, school?.phone, school?.email].filter(Boolean).join(" · ")}
            </p>
            {school?.kra_pin && <p style={{ margin: 0, fontSize: 10.5, opacity: 0.9 }}>KRA PIN: {school.kra_pin}</p>}
          </div>
        </div>

        <div style={{ padding: "24px 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #f4f4f5", paddingBottom: 14, marginBottom: 18 }}>
            <div>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: 0.5 }}>OFFICIAL RECEIPT</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#71717a" }}>No. {receipt.receipt_number}</p>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: "#71717a" }}>
              <p style={{ margin: 0 }}>Date issued</p>
              <p style={{ margin: 0, fontWeight: 600, color: "#18181b" }}>{new Date(receipt.issued_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 13, marginBottom: 20 }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: 0.5 }}>Received from</p>
              <p style={{ margin: "2px 0 0", fontWeight: 600 }}>{payerName}</p>
              {student?.admission_number && <p style={{ margin: 0, color: "#71717a" }}>Adm. No. {student.admission_number}</p>}
              {classLabel && <p style={{ margin: 0, color: "#71717a" }}>Class: {classLabel}</p>}
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: 0.5 }}>Payment method</p>
              <p style={{ margin: "2px 0 0", fontWeight: 600 }}>{methodLabel[payment.method] ?? payment.method}</p>
              {payment.reference && <p style={{ margin: 0, color: "#71717a" }}>Ref: {payment.reference}</p>}
              {payment.phone_number && <p style={{ margin: 0, color: "#71717a" }}>{payment.phone_number}</p>}
            </div>
          </div>

          <div style={{ background: "#f4f4f5", borderRadius: 8, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "#71717a", textTransform: "uppercase", letterSpacing: 0.5 }}>Amount paid</p>
              {payment.purpose && <p style={{ margin: "2px 0 0", fontSize: 12, color: "#52525b" }}>{payment.purpose}</p>}
            </div>
            <p style={{ margin: 0, fontSize: 24, fontWeight: 700, color: accent }}>
              {currency} {Number(payment.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </div>

          {payment.notes && (
            <p style={{ fontSize: 12, color: "#71717a", marginBottom: 20 }}>
              <strong>Notes:</strong> {payment.notes}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 40, paddingTop: 16, borderTop: "1px solid #e4e4e7" }}>
            <p style={{ margin: 0, fontSize: 10.5, color: "#a1a1aa" }}>This is a system-generated receipt and is valid without a signature.</p>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 140, borderBottom: "1px solid #a1a1aa", marginBottom: 4, height: 24 }} />
              <p style={{ margin: 0, fontSize: 10.5, color: "#a1a1aa" }}>Authorized signature</p>
            </div>
          </div>
        </div>
      </div>

      <PrintButton label="Print receipt" />

      <style>{`
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-sheet { box-shadow: none !important; border: none !important; max-width: 100% !important; }
        }
      `}</style>
    </div>
  );
}
