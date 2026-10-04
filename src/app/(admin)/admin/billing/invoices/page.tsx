import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InvoiceStatusBadge } from "@/components/billing/invoice-status-badge";
import { AdminCreateInvoiceDialog } from "@/components/admin/admin-create-invoice-dialog";
import { Button } from "@/components/ui/button";
import { formatDateOnly, formatInstantDate, formatKes } from "@/lib/billing/format";

export const dynamic = "force-dynamic";

const FILTERS: { key: string; label: string; statuses: string[] | null }[] = [
  { key: "all", label: "All", statuses: null },
  { key: "draft", label: "Drafts", statuses: ["draft"] },
  { key: "outstanding", label: "Outstanding", statuses: ["issued", "sent", "partially_paid", "overdue"] },
  { key: "overdue", label: "Overdue", statuses: ["overdue"] },
  { key: "paid", label: "Paid", statuses: ["paid"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
];

type Row = {
  id: string;
  school_id: string;
  invoice_number: string;
  status: string;
  billing_period_label: string | null;
  period_start: string;
  period_end: string;
  student_count: number;
  unit_price_kes: number | null;
  amount_kes: number;
  amount_paid_kes: number;
  balance_kes: number;
  invoice_date: string;
  due_at: string;
  source: string;
  sent_at: string | null;
};

export default async function AdminInvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status: statusParam, q: qParam } = await searchParams;
  const filter = FILTERS.find((f) => f.key === statusParam) ?? FILTERS[0];
  const q = (qParam ?? "").trim().toLowerCase();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const [{ data: all }, { data: schools }] = await Promise.all([
    supabase
      .from("platform_invoices")
      .select("id, school_id, invoice_number, status, billing_period_label, period_start, period_end, student_count, unit_price_kes, amount_kes, amount_paid_kes, balance_kes, invoice_date, due_at, source, sent_at")
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase.from("schools").select("id, name").order("name"),
  ]);

  const nameById = new Map((schools ?? []).map((s) => [s.id, s.name as string]));
  const rows = ((all ?? []) as unknown as Row[]).map((r) => ({
    ...r,
    student_count: Number(r.student_count),
    unit_price_kes: r.unit_price_kes == null ? null : Number(r.unit_price_kes),
    amount_kes: Number(r.amount_kes),
    amount_paid_kes: Number(r.amount_paid_kes),
    balance_kes: Number(r.balance_kes),
    school_name: nameById.get(r.school_id) ?? "Unknown school",
  }));

  const open = rows.filter((r) => ["issued", "sent", "partially_paid", "overdue"].includes(r.status));
  const overdue = rows.filter((r) => r.status === "overdue");
  const drafts = rows.filter((r) => r.status === "draft");
  const paid = rows.filter((r) => r.status === "paid");
  const sum = (xs: typeof rows, f: (r: (typeof rows)[number]) => number) => xs.reduce((a, r) => a + f(r), 0);

  const shown = rows
    .filter((r) => !filter.statuses || filter.statuses.includes(r.status))
    .filter((r) => !q || r.invoice_number.toLowerCase().includes(q) || r.school_name.toLowerCase().includes(q));

  const cards = [
    { label: "Drafts to review", value: String(drafts.length), sub: drafts.length ? formatKes(sum(drafts, (r) => r.amount_kes)) : "Nothing waiting", href: "?status=draft" },
    { label: "Outstanding", value: formatKes(sum(open, (r) => r.balance_kes)), sub: `${open.length} open invoice${open.length === 1 ? "" : "s"}`, href: "?status=outstanding" },
    { label: "Overdue", value: formatKes(sum(overdue, (r) => r.balance_kes)), sub: `${overdue.length} invoice${overdue.length === 1 ? "" : "s"}`, href: "?status=overdue" },
    { label: "Collected (all time)", value: formatKes(sum(rows, (r) => r.amount_paid_kes)), sub: `${paid.length} paid invoice${paid.length === 1 ? "" : "s"}`, href: "?status=paid" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Invoices</h1>
          <p className="text-sm text-muted-foreground">Who was billed, for which period, how many students, at what rate — and whether it has been paid.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/billing/settings">Billing settings</Link>
          </Button>
          <AdminCreateInvoiceDialog schools={(schools ?? []).map((s) => ({ id: s.id, name: s.name as string }))} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={`/admin/billing/invoices${c.href}`} className="panel px-4 py-3 transition-colors hover:bg-muted/40">
            <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">{c.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{c.value}</p>
            <p className="text-xs text-muted-foreground">{c.sub}</p>
          </Link>
        ))}
      </div>

      <div className="panel">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <nav className="flex flex-wrap gap-1" aria-label="Filter invoices">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`/admin/billing/invoices?status=${f.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${f.key === filter.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >
                {f.label}
              </Link>
            ))}
          </nav>
          <form className="flex items-center gap-2" action="/admin/billing/invoices">
            <input type="hidden" name="status" value={filter.key} />
            <input
              name="q"
              defaultValue={qParam ?? ""}
              placeholder="Search school or invoice no."
              className="h-8 w-56 rounded-md border border-input bg-transparent px-2.5 text-sm"
              aria-label="Search invoices"
            />
            <Button type="submit" size="sm" variant="outline">
              Search
            </Button>
          </form>
        </header>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>Invoice</th>
                <th>School</th>
                <th>Billing period</th>
                <th className="text-right">Students × rate</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Balance</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    No invoices match.
                  </td>
                </tr>
              )}
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">
                    <Link href={`/admin/billing/invoices/${r.id}`} className="underline-offset-2 hover:underline">
                      {r.invoice_number}
                    </Link>
                    {r.source === "auto" && <span className="ml-1.5 text-[0.625rem] uppercase tracking-wide text-muted-foreground">auto</span>}
                  </td>
                  <td>{r.school_name}</td>
                  <td>
                    <div>{r.billing_period_label ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateOnly(r.period_start)} – {formatDateOnly(r.period_end)}
                    </div>
                  </td>
                  <td className="text-right tabular-nums">
                    {r.student_count.toLocaleString("en-KE")} × {r.unit_price_kes == null ? "—" : formatKes(r.unit_price_kes)}
                  </td>
                  <td className="text-right font-medium tabular-nums">{formatKes(r.amount_kes)}</td>
                  <td className="text-right tabular-nums text-muted-foreground">{r.status === "cancelled" ? "—" : formatKes(r.balance_kes)}</td>
                  <td className="text-muted-foreground">{r.status === "draft" ? "—" : formatDateOnly(r.invoice_date)}</td>
                  <td className="text-muted-foreground">{formatInstantDate(r.due_at)}</td>
                  <td>
                    <InvoiceStatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
