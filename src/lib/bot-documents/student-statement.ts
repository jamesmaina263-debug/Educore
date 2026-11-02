// Fee statement for ONE learner, used by the WhatsApp bot document route (feature.bot.documents).
//
// Pure model + a loader. The model reconciles EXACTLY with the balance the bot, portal and Finance
// already show (v_student_balances): invoiced - approved discounts - allocated payments, split by
// the invoice's term. "Brought forward" is everything on invoices from other terms; the current
// term's lines follow; the closing balance must equal the balance view or no statement is issued
// (a wrong figure over WhatsApp is worse than "ask the office").

export interface StatementRawInvoice {
  id: string;
  invoiceNumber: string | null;
  termId: string | null;
  totalAmount: number;
  createdAt: string;
}
export interface StatementRawDiscount {
  invoiceId: string;
  amount: number;
}
export interface StatementRawAllocation {
  paymentId: string;
  invoiceId: string;
  amount: number;
  paidAt: string;
  method: string | null;
  reference: string | null;
}
export interface StatementRaw {
  school: { name: string; address: string | null; phone: string | null; primaryColor: string | null };
  student: { fullName: string; admissionNumber: string | null; classLabel: string };
  term: { id: string; name: string; yearName: string | null } | null;
  invoices: StatementRawInvoice[];
  discounts: StatementRawDiscount[];
  allocations: StatementRawAllocation[];
  /** From v_student_balances: the figure every other screen shows. */
  accountBalance: number;
  creditBalance: number;
  generatedAt: string;
}

export interface StatementLine {
  date: string;
  description: string;
  /** Amount charged (invoice). */
  charge: number | null;
  /** Amount credited (payment or discount). */
  credit: number | null;
}

export interface StatementModel {
  school: StatementRaw["school"];
  student: StatementRaw["student"];
  termLabel: string;
  generatedAt: string;
  broughtForward: number;
  lines: StatementLine[];
  totalCharged: number;
  totalCredited: number;
  closingBalance: number;
  creditBalance: number;
}

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100;

export function formatKes(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}KES ${Math.abs(amount).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Builds the statement, or returns null when the lines do not add up to the account balance
 * (the caller then tells the guardian to contact the office instead of sending wrong figures).
 */
export function buildStatementModel(raw: StatementRaw): StatementModel | null {
  const termId = raw.term?.id ?? null;
  const isCurrent = (inv: StatementRawInvoice) => termId !== null && inv.termId === termId;
  const invoiceById = new Map(raw.invoices.map((i) => [i.id, i]));

  const discountByInvoice = new Map<string, number>();
  for (const d of raw.discounts) discountByInvoice.set(d.invoiceId, (discountByInvoice.get(d.invoiceId) ?? 0) + cents(d.amount));
  const paidByInvoice = new Map<string, number>();
  for (const a of raw.allocations) paidByInvoice.set(a.invoiceId, (paidByInvoice.get(a.invoiceId) ?? 0) + cents(a.amount));

  let broughtForward = 0;
  for (const inv of raw.invoices) {
    if (isCurrent(inv)) continue;
    broughtForward += cents(inv.totalAmount) - (discountByInvoice.get(inv.id) ?? 0) - (paidByInvoice.get(inv.id) ?? 0);
  }

  const lines: StatementLine[] = [];
  let charged = 0;
  let credited = 0;
  for (const inv of raw.invoices.filter(isCurrent).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    charged += cents(inv.totalAmount);
    lines.push({ date: inv.createdAt, description: `Invoice${inv.invoiceNumber ? ` ${inv.invoiceNumber}` : ""}`, charge: inv.totalAmount, credit: null });
  }
  const discountTotal = [...discountByInvoice.entries()].reduce((sum, [invId, c]) => {
    const inv = invoiceById.get(invId);
    return sum + (inv && isCurrent(inv) ? c : 0);
  }, 0);
  if (discountTotal !== 0) {
    credited += discountTotal;
    const latest = raw.invoices.filter(isCurrent).map((i) => i.createdAt).sort().pop() ?? raw.generatedAt;
    lines.push({ date: latest, description: "Discounts and waivers (approved)", charge: null, credit: money(discountTotal) });
  }
  // One line per payment (a payment can be split over several invoices of the term).
  const perPayment = new Map<string, { date: string; method: string | null; reference: string | null; cents: number }>();
  for (const a of raw.allocations) {
    const inv = invoiceById.get(a.invoiceId);
    if (!inv || !isCurrent(inv)) continue;
    const row = perPayment.get(a.paymentId) ?? { date: a.paidAt, method: a.method, reference: a.reference, cents: 0 };
    row.cents += cents(a.amount);
    perPayment.set(a.paymentId, row);
  }
  for (const p of [...perPayment.values()].filter((p) => p.cents !== 0).sort((a, b) => a.date.localeCompare(b.date))) {
    credited += p.cents;
    const how = [p.method === "mpesa" ? "M-Pesa" : p.method === "cash" ? "Cash" : p.method, p.reference].filter(Boolean).join(" ");
    lines.push({ date: p.date, description: `Payment received${how ? ` (${how})` : ""}`, charge: null, credit: money(p.cents) });
  }

  const closing = broughtForward + charged - credited;
  if (cents(raw.accountBalance) !== closing) return null;

  return {
    school: raw.school,
    student: raw.student,
    termLabel: raw.term ? [raw.term.name, raw.term.yearName].filter(Boolean).join(", ") : "No active term",
    generatedAt: raw.generatedAt,
    broughtForward: money(broughtForward),
    lines,
    totalCharged: money(charged),
    totalCredited: money(credited),
    closingBalance: money(closing),
    creditBalance: raw.creditBalance,
  };
}
