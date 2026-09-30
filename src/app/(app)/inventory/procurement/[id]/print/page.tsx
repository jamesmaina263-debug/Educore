import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { PrintButton } from "@/components/documents/print-button";

const statusLabel: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_received: "Partially Received",
  received: "Received",
  cancelled: "Cancelled",
};

export default async function PurchaseOrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const user = await getCachedUser();
  if (!user) redirect("/login");

  const { data: po } = await supabase
    .from("purchase_orders")
    .select(
      "id, po_number, status, order_date, expected_date, notes, suppliers(name, contact_person, phone, email, address), purchase_order_items(item_description, quantity, unit_cost, inventory_items(name)), created_by_user:school_users!purchase_orders_created_by_fkey(full_name), schools(name, logo_url, primary_color, address, phone, email, kra_pin, currency_code)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!po) notFound();

  const school = po.schools as unknown as {
    name: string;
    logo_url: string | null;
    primary_color: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    kra_pin: string | null;
    currency_code: string | null;
  } | null;
  const supplier = po.suppliers as unknown as {
    name: string;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  } | null;
  const createdBy = po.created_by_user as unknown as { full_name: string } | null;
  const items = (po.purchase_order_items as unknown as { item_description: string | null; quantity: number; unit_cost: number; inventory_items: { name: string } | null }[]) ?? [];

  const accent = school?.primary_color || "#1e40af";
  const currency = school?.currency_code || "KES";
  const total = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_cost), 0);

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "2.5rem 1rem", background: "#f4f4f5", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <div
        className="print-sheet"
        style={{
          width: "100%",
          maxWidth: "760px",
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
            <p style={{ margin: "2px 0 0", fontSize: 10.5, opacity: 0.9 }}>
              {[school?.address, school?.phone, school?.email].filter(Boolean).join(" · ")}
            </p>
            {school?.kra_pin && <p style={{ margin: 0, fontSize: 10.5, opacity: 0.9 }}>KRA PIN: {school.kra_pin}</p>}
          </div>
        </div>

        <div style={{ padding: "24px 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #f4f4f5", paddingBottom: 14, marginBottom: 18 }}>
            <div>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: 0.5 }}>PURCHASE ORDER</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#71717a" }}>No. {po.po_number}</p>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: "#71717a" }}>
              <p style={{ margin: 0 }}>Order date: <strong style={{ color: "#18181b" }}>{po.order_date ? new Date(po.order_date).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</strong></p>
              {po.expected_date && <p style={{ margin: 0 }}>Expected: <strong style={{ color: "#18181b" }}>{new Date(po.expected_date).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</strong></p>}
              <p style={{ margin: 0 }}>Status: <strong style={{ color: "#18181b" }}>{statusLabel[po.status] ?? po.status}</strong></p>
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <p style={{ margin: 0, fontSize: 11, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: 0.5 }}>Supplier</p>
            <p style={{ margin: "2px 0 0", fontWeight: 600, fontSize: 14 }}>{supplier?.name ?? "—"}</p>
            <p style={{ margin: 0, fontSize: 12, color: "#71717a" }}>
              {[supplier?.contact_person, supplier?.phone, supplier?.email].filter(Boolean).join(" · ")}
            </p>
            {supplier?.address && <p style={{ margin: 0, fontSize: 12, color: "#71717a" }}>{supplier.address}</p>}
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 20 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e4e4e7", textAlign: "left" }}>
                <th style={{ padding: "6px 4px", fontWeight: 600, fontSize: 11, color: "#71717a", textTransform: "uppercase" }}>Item</th>
                <th style={{ padding: "6px 4px", fontWeight: 600, fontSize: 11, color: "#71717a", textTransform: "uppercase", textAlign: "right" }}>Qty</th>
                <th style={{ padding: "6px 4px", fontWeight: 600, fontSize: 11, color: "#71717a", textTransform: "uppercase", textAlign: "right" }}>Unit cost</th>
                <th style={{ padding: "6px 4px", fontWeight: 600, fontSize: 11, color: "#71717a", textTransform: "uppercase", textAlign: "right" }}>Line total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #f4f4f5" }}>
                  <td style={{ padding: "8px 4px" }}>{it.item_description || it.inventory_items?.name || "—"}</td>
                  <td style={{ padding: "8px 4px", textAlign: "right" }}>{Number(it.quantity).toLocaleString()}</td>
                  <td style={{ padding: "8px 4px", textAlign: "right" }}>{Number(it.unit_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td style={{ padding: "8px 4px", textAlign: "right", fontWeight: 600 }}>{(Number(it.quantity) * Number(it.unit_cost)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
            <div style={{ background: "#f4f4f5", borderRadius: 8, padding: "12px 20px", textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 11, color: "#71717a", textTransform: "uppercase", letterSpacing: 0.5 }}>Total</p>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: accent }}>
                {currency} {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {po.notes && (
            <p style={{ fontSize: 12, color: "#71717a", marginBottom: 20 }}>
              <strong>Notes:</strong> {po.notes}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 40, paddingTop: 16, borderTop: "1px solid #e4e4e7" }}>
            <p style={{ margin: 0, fontSize: 10.5, color: "#a1a1aa" }}>
              Prepared by {createdBy?.full_name ?? "—"} · This is a system-generated purchase order.
            </p>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 140, borderBottom: "1px solid #a1a1aa", marginBottom: 4, height: 24 }} />
              <p style={{ margin: 0, fontSize: 10.5, color: "#a1a1aa" }}>Authorized signature</p>
            </div>
          </div>
        </div>
      </div>

      <PrintButton label="Print purchase order" />

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
