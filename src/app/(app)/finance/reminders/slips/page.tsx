import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { PrintButton } from "@/components/documents/print-button";
import { REMINDER_FLAG, chunkSlips } from "@/lib/fee-reminders";

// Printable reminder slips for the drafts that are still pending review (Phase 1.4). For handing to a
// family in person or sending home with a learner. Hidden (404) unless the school has the flag; the
// rows come through RLS, so only a finance.write user of this school sees anything.
export default async function ReminderSlipsPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");
  if (!(await hasFeatureFlag(supabase, REMINDER_FLAG))) notFound();

  const { data: rows } = await supabase
    .from("fee_reminders")
    .select(
      "id, balance_at_generation, draft_body, run_on, students(first_name, last_name, admission_number), school_users!fee_reminders_guardian_user_id_fkey(full_name), schools(name, logo_url, primary_color, phone, email, currency_code)",
    )
    .eq("status", "draft")
    .order("generated_at", { ascending: true })
    .limit(400);

  const slips = (rows ?? []).map((r) => {
    const st = r.students as unknown as { first_name: string; last_name: string; admission_number: string | null } | null;
    const g = r.school_users as unknown as { full_name: string } | null;
    const sc = r.schools as unknown as {
      name: string;
      logo_url: string | null;
      primary_color: string | null;
      phone: string | null;
      email: string | null;
      currency_code: string | null;
    } | null;
    return {
      id: r.id as string,
      learner: st ? `${st.first_name} ${st.last_name}` : "Learner",
      admission: st?.admission_number ?? null,
      guardian: g?.full_name ?? "Parent/Guardian",
      balance: Number(r.balance_at_generation),
      body: r.draft_body as string,
      runOn: r.run_on as string,
      schoolName: sc?.name ?? "School",
      logo: sc?.logo_url ?? null,
      accent: sc?.primary_color || "#1e40af",
      contact: [sc?.phone, sc?.email].filter(Boolean).join(" · "),
      currency: sc?.currency_code || "KES",
    };
  });

  const pages = chunkSlips(slips, 4);

  return (
    <div style={{ background: "#f4f4f5", minHeight: "100vh", padding: "2rem 1rem", fontFamily: "system-ui, sans-serif" }}>
      {slips.length === 0 ? (
        <p style={{ textAlign: "center", color: "#71717a" }}>No pending reminder drafts to print.</p>
      ) : (
        pages.map((page, pi) => (
          <div
            key={pi}
            className="slip-page"
            style={{ maxWidth: 760, margin: "0 auto 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            {page.map((s) => (
              <div key={s.id} style={{ background: "#fff", border: "1px dashed #a1a1aa", borderRadius: 8, padding: 14, fontSize: 12, breakInside: "avoid" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: `2px solid ${s.accent}`, paddingBottom: 6, marginBottom: 8 }}>
                  {s.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.logo} alt="" style={{ width: 28, height: 28, objectFit: "contain" }} />
                  ) : null}
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>{s.schoolName}</p>
                    {s.contact && <p style={{ margin: 0, fontSize: 10, color: "#71717a" }}>{s.contact}</p>}
                  </div>
                </div>
                <p style={{ margin: "0 0 4px", fontWeight: 700, letterSpacing: 0.4, fontSize: 11, color: s.accent }}>FEE BALANCE REMINDER</p>
                <p style={{ margin: 0 }}>
                  To: <strong>{s.guardian}</strong>
                </p>
                <p style={{ margin: 0 }}>
                  Learner: <strong>{s.learner}</strong>
                  {s.admission ? ` (Adm. ${s.admission})` : ""}
                </p>
                <p style={{ margin: "4px 0" }}>
                  Balance: <strong>{s.currency} {s.balance.toLocaleString()}</strong>
                </p>
                <p style={{ margin: "6px 0", lineHeight: 1.4 }}>{s.body}</p>
                <p style={{ margin: 0, fontSize: 10, color: "#a1a1aa" }}>
                  Date: {new Date(s.runOn).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}
                </p>
              </div>
            ))}
          </div>
        ))
      )}

      {slips.length > 0 && <PrintButton label="Print slips" />}

      <style>{`
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .slip-page { page-break-after: always; margin: 0 auto !important; }
        }
      `}</style>
    </div>
  );
}
