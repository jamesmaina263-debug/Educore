import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPaymentReceipt } from "@/lib/finance/receipt";
import { ReceiptDocument } from "@/components/finance/receipt-document";

// Read-only, print-friendly view of a single payment's receipt. No new permission checks are
// added here on purpose — access is enforced entirely by the existing RLS policies on
// `receipts`/`payments` (finance staff with finance.read, the student's guardian, or the
// student themselves), the same pattern already used by /students/[id]/id-card. A payment
// that doesn't exist, has no receipt yet (e.g. still unallocated), or isn't visible to this
// user all resolve the same way: notFound().
export default async function PaymentReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const receipt = await getPaymentReceipt(supabase, id);
  if (!receipt) notFound();

  return <ReceiptDocument data={receipt} />;
}
