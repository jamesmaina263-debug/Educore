import { createAdminClient } from "@/lib/supabase/admin";
import { hashPayLinkToken, isPayLinkToken, PAY_LINK_UNAVAILABLE_MESSAGE } from "@/lib/pay-link";
import { PayForm } from "./pay-form";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pay school fees",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

type View = { status: string; school_name: string | null; student_first_name: string | null; amount: number | null };

// Public page. Shows only the school name, the student's first name and the amount. Every
// non-valid state (unknown, expired, used, revoked, flag off) renders the same neutral message.
export default async function PayLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let view: View | null = null;
  if (isPayLinkToken(token)) {
    const { data, error } = await createAdminClient().rpc("pay_link_public_view", { p_token_hash: hashPayLinkToken(token) });
    if (!error && Array.isArray(data) && data[0]?.status === "valid") view = data[0] as View;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      {view ? (
        <>
          <h1 className="text-xl font-semibold">{view.school_name}</h1>
          <p className="text-sm text-muted-foreground">
            School fees for {view.student_first_name}: <span className="font-medium text-foreground">KES {Number(view.amount).toLocaleString("en-KE")}</span>
          </p>
          <PayForm token={token} amountLabel={`KES ${Number(view.amount).toLocaleString("en-KE")}`} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{PAY_LINK_UNAVAILABLE_MESSAGE}</p>
      )}
    </main>
  );
}
