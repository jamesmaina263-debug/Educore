import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { loadFinanceContext } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { PaybillSection, type PaybillEventRow, type PaybillModeInfo } from "@/components/finance/paybill-section";
import { parseWouldBe, type C2bMode } from "@/lib/c2b-events";

export default async function FinancePaybillPage() {
  const supabase = await createClient();

  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed (any error => false).
  if (!(await hasFeatureFlag(supabase, "feature.finance.c2b_capture"))) notFound();

  const ctx = await loadFinanceContext([]);
  const user = await getCachedUser();

  let mode: PaybillModeInfo = { exists: false, mode: null, registered: false };
  let events: PaybillEventRow[] = [];
  let isOwner = false;
  let isTill = false;

  if (ctx.canRead && user) {
    const { data: me } = await supabase
      .from("school_users")
      .select("school_id, roles(name)")
      .eq("auth_user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    isOwner = (me?.roles as unknown as { name: string } | null)?.name === "school_owner";

    if (me?.school_id) {
      const { data: status } = await supabase.rpc("c2b_mode_status", { p_school_id: me.school_id });
      const s = (status as { cfg_exists: boolean; cfg_mode: string | null; cfg_registered: boolean }[] | null)?.[0];
      const { data: mp } = await supabase.from("mpesa_settings").select("shortcode_type").eq("school_id", me.school_id).maybeSingle();
      isTill = (mp as { shortcode_type?: string | null } | null)?.shortcode_type === "till";

      if (s) mode = { exists: s.cfg_exists, mode: (s.cfg_mode as C2bMode | null) ?? null, registered: s.cfg_registered };
    }

    const { data: rows } = await supabase
      .from("inbound_payment_events")
      .select(
        "id, external_id, amount, account_reference, phone_masked, transaction_time, outcome, match_rule, notes, created_at, payment_id, students(first_name, last_name, admission_number)",
      )
      .order("created_at", { ascending: false })
      .limit(200);

    events = (rows ?? []).map((r) => {
      const st = r.students as unknown as { first_name: string; last_name: string; admission_number: string | null } | null;
      return {
        id: r.id as string,
        externalId: r.external_id as string,
        amount: Number(r.amount),
        accountReference: (r.account_reference as string | null) ?? null,
        phoneMasked: (r.phone_masked as string | null) ?? null,
        transactionTime: (r.transaction_time as string | null) ?? (r.created_at as string),
        outcome: r.outcome as string,
        matchRule: (r.match_rule as string | null) ?? null,
        wouldBe: parseWouldBe(r.notes as string | null),
        learner: st ? `${st.first_name} ${st.last_name}${st.admission_number ? ` (${st.admission_number})` : ""}` : null,
        hasPayment: Boolean(r.payment_id),
      };
    });
  }

  return (
    <FinancePageShell
      ctx={ctx}
      section="Paybill auto-capture"
      title="Paybill auto-capture"
      subtitle="Payments received on your paybill, and whether they are recorded automatically"
    >
      <PaybillSection mode={mode} events={events} isOwner={isOwner} isTill={isTill} />
    </FinancePageShell>
  );
}
