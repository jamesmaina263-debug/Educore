// WP 4.4: Approvals inbox. A read-only roll-up of what is waiting for the signed-in person's
// decision. It never approves or rejects anything: each item links to the screen that already does
// that, so every existing rule (self-approval limits, thresholds, audit) stays exactly where it is.
// Payment, M-Pesa, payroll and messaging approvals are deliberately NOT part of this inbox.

export type ApprovalKind = "leave" | "requisition" | "expense" | "discount";

export interface ApprovalKindInfo {
  label: string;
  /** Permission the person must hold for this kind to be loaded at all. */
  permission: string;
}

export const APPROVAL_KINDS: Record<ApprovalKind, ApprovalKindInfo> = {
  leave: { label: "Leave requests", permission: "staff.leave.approve" },
  requisition: { label: "Purchase requisitions", permission: "inventory.procurement.approve" },
  expense: { label: "Expenses", permission: "expenses.approve" },
  discount: { label: "Fee discounts", permission: "discounts.approve" },
};

export const APPROVAL_KIND_ORDER: ApprovalKind[] = ["leave", "requisition", "expense", "discount"];

export interface ApprovalItem {
  kind: ApprovalKind;
  id: string;
  title: string;
  detail: string | null;
  amount: number | null;
  requestedBy: string | null;
  /** True when the signed-in person raised the request themselves. */
  own: boolean;
  createdAt: string;
  /** Bare app path (the page adds the school slug). */
  href: string;
}

export interface LeaveRow {
  id: string;
  staff_id: string;
  leave_type_id: string | null;
  start_date: string;
  end_date: string;
  days_count: number | string;
  reason: string | null;
  created_at: string;
}
export interface RequisitionRow {
  id: string;
  purpose: string;
  requested_by: string | null;
  created_at: string;
}
export interface ExpenseRow {
  id: string;
  vendor: string;
  category: string;
  amount: number | string;
  description: string | null;
  requested_by: string | null;
  created_at: string;
}
export interface DiscountRow {
  id: string;
  student_id: string;
  amount: number | string;
  reason: string;
  requested_by: string | null;
  created_at: string;
}

export type NameMap = ReadonlyMap<string, string>;

function name(map: NameMap, id: string | null): string | null {
  return id ? (map.get(id) ?? null) : null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function formatKes(amount: number): string {
  return `KES ${amount.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function mapLeave(rows: LeaveRow[], people: NameMap, leaveTypes: NameMap, viewerId: string | null): ApprovalItem[] {
  return rows.map((r) => {
    const days = Number(r.days_count);
    const type = name(leaveTypes, r.leave_type_id) ?? "Leave";
    return {
      kind: "leave",
      id: r.id,
      title: `${name(people, r.staff_id) ?? "A staff member"}: ${type}`,
      detail: `${r.start_date} to ${r.end_date} (${plural(days, "day", "days")})${r.reason ? `. ${r.reason}` : ""}`,
      amount: null,
      requestedBy: name(people, r.staff_id),
      own: viewerId !== null && r.staff_id === viewerId,
      createdAt: r.created_at,
      href: `/staff/${r.staff_id}`,
    };
  });
}

export function mapRequisitions(rows: RequisitionRow[], people: NameMap, viewerId: string | null): ApprovalItem[] {
  return rows.map((r) => ({
    kind: "requisition",
    id: r.id,
    title: r.purpose,
    detail: null,
    amount: null,
    requestedBy: name(people, r.requested_by),
    own: viewerId !== null && r.requested_by === viewerId,
    createdAt: r.created_at,
    href: `/inventory/procurement/${r.id}`,
  }));
}

export function mapExpenses(rows: ExpenseRow[], people: NameMap, viewerId: string | null): ApprovalItem[] {
  return rows.map((r) => ({
    kind: "expense",
    id: r.id,
    title: `${r.vendor} (${r.category})`,
    detail: r.description,
    amount: Number(r.amount),
    requestedBy: name(people, r.requested_by),
    own: viewerId !== null && r.requested_by === viewerId,
    createdAt: r.created_at,
    href: "/finance/configuration",
  }));
}

export function mapDiscounts(rows: DiscountRow[], people: NameMap, students: NameMap, viewerId: string | null): ApprovalItem[] {
  return rows.map((r) => ({
    kind: "discount",
    id: r.id,
    title: `Discount for ${name(students, r.student_id) ?? "a learner"}`,
    detail: r.reason,
    amount: Number(r.amount),
    requestedBy: name(people, r.requested_by),
    own: viewerId !== null && r.requested_by === viewerId,
    createdAt: r.created_at,
    href: "/finance/discounts-waivers",
  }));
}

/** Oldest first: whatever has been waiting longest is at the top. Ties keep a stable order by id. */
export function sortOldestFirst(items: ApprovalItem[]): ApprovalItem[] {
  return [...items].sort((a, b) => {
    const d = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
}

export function countByKind(items: ApprovalItem[]): Record<ApprovalKind, number> {
  const out: Record<ApprovalKind, number> = { leave: 0, requisition: 0, expense: 0, discount: 0 };
  for (const i of items) out[i.kind] += 1;
  return out;
}

export function waitingLabel(createdAt: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(createdAt);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} ${days === 1 ? "day" : "days"} waiting`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} ${hours === 1 ? "hour" : "hours"} waiting`;
  return "just now";
}

/** Items older than this many days are flagged as overdue in the list. */
export const OVERDUE_AFTER_DAYS = 3;

export function isOverdue(createdAt: string, now: Date = new Date()): boolean {
  const ms = now.getTime() - Date.parse(createdAt);
  return Number.isFinite(ms) && ms >= OVERDUE_AFTER_DAYS * 86_400_000;
}
