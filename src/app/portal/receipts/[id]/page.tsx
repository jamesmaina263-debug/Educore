import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPaymentReceipt } from "@/lib/finance/receipt";
import { ReceiptDocument } from "@/components/finance/receipt-document";

// Parent/student-portal equivalent of the staff Finance > Payments receipt view. Deliberately
// its own route (under /portal, not the (app) group) rather than reusing
// /finance/payments/[id]/receipt directly, so a guardian never gets routed through the
// staff app shell (sidebar/topbar) — this page renders standalone, same as the rest of the
// portal. Access is still enforced entirely by RLS via getPaymentReceipt (a guardian only
// ever sees a receipt for their own child's payment); this page adds no extra permission
// logic of its own.
export default async function PortalPaymentReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/parent-login");

  const receipt = await getPaymentReceipt(supabase, id);
  if (!receipt) notFound();

  return <ReceiptDocument data={receipt} />;
}
