import { describe, it, expect } from "vitest";
import {
  APPROVAL_KINDS,
  APPROVAL_KIND_ORDER,
  countByKind,
  formatKes,
  isOverdue,
  mapDiscounts,
  mapExpenses,
  mapLeave,
  mapRequisitions,
  sortOldestFirst,
  waitingLabel,
} from "./approvals-inbox";

const people = new Map([
  ["u1", "Jane Teacher"],
  ["u2", "Peter Bursar"],
]);

describe("approval kinds", () => {
  it("covers every kind in the display order, each with a permission", () => {
    expect([...APPROVAL_KIND_ORDER].sort()).toEqual(Object.keys(APPROVAL_KINDS).sort());
    for (const k of APPROVAL_KIND_ORDER) expect(APPROVAL_KINDS[k].permission).toMatch(/\.approve$/);
  });
  it("never includes payment, payroll or messaging approvals", () => {
    const perms = Object.values(APPROVAL_KINDS).map((k) => k.permission).join(" ");
    expect(perms).not.toMatch(/payroll|payment|mpesa|whatsapp|sms/i);
  });
});

describe("mapping", () => {
  it("maps leave with names, days and own flag", () => {
    const [i] = mapLeave(
      [{ id: "l1", staff_id: "u1", leave_type_id: "t1", start_date: "2026-11-10", end_date: "2026-11-12", days_count: "3", reason: "Family", created_at: "2026-11-01T08:00:00Z" }],
      people,
      new Map([["t1", "Annual"]]),
      "u1",
    );
    expect(i.title).toBe("Jane Teacher: Annual");
    expect(i.detail).toBe("2026-11-10 to 2026-11-12 (3 days). Family");
    expect(i.own).toBe(true);
    expect(i.href).toBe("/staff/u1");
  });
  it("falls back gracefully when names are unknown", () => {
    const [i] = mapLeave(
      [{ id: "l1", staff_id: "zz", leave_type_id: null, start_date: "2026-11-10", end_date: "2026-11-10", days_count: 1, reason: null, created_at: "2026-11-01T08:00:00Z" }],
      people,
      new Map(),
      null,
    );
    expect(i.title).toBe("A staff member: Leave");
    expect(i.detail).toBe("2026-11-10 to 2026-11-10 (1 day)");
    expect(i.own).toBe(false);
  });
  it("maps requisitions, expenses and discounts", () => {
    const [r] = mapRequisitions([{ id: "r1", purpose: "Lab chemicals", requested_by: "u2", created_at: "2026-11-01T08:00:00Z" }], people, "u1");
    expect(r.href).toBe("/inventory/procurement/r1");
    expect(r.requestedBy).toBe("Peter Bursar");
    const [e] = mapExpenses([{ id: "e1", vendor: "Kenya Power", category: "Utilities", amount: "12500.50", description: null, requested_by: "u2", created_at: "2026-11-01T08:00:00Z" }], people, "u2");
    expect(e.amount).toBe(12500.5);
    expect(e.own).toBe(true);
    const [d] = mapDiscounts([{ id: "d1", student_id: "s1", amount: 2000, reason: "Sibling", requested_by: null, created_at: "2026-11-01T08:00:00Z" }], people, new Map([["s1", "Sam One"]]), "u1");
    expect(d.title).toBe("Discount for Sam One");
    expect(d.requestedBy).toBeNull();
  });
});

describe("ordering and counts", () => {
  const mk = (id: string, createdAt: string, kind: "leave" | "expense" = "leave") => ({
    kind, id, title: id, detail: null, amount: null, requestedBy: null, own: false, createdAt, href: "/x",
  });
  it("sorts oldest first with a stable tiebreak and does not mutate the input", () => {
    const input = [mk("b", "2026-11-02T00:00:00Z"), mk("a", "2026-11-02T00:00:00Z"), mk("c", "2026-11-01T00:00:00Z")];
    const out = sortOldestFirst(input);
    expect(out.map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(input.map((i) => i.id)).toEqual(["b", "a", "c"]);
  });
  it("counts per kind including zeros", () => {
    expect(countByKind([mk("a", "2026-11-01T00:00:00Z"), mk("b", "2026-11-01T00:00:00Z", "expense")])).toEqual({
      leave: 1, requisition: 0, expense: 1, discount: 0,
    });
  });
});

describe("waiting time", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  it("labels days, hours and fresh items", () => {
    expect(waitingLabel("2026-11-03T12:00:00Z", now)).toBe("2 days waiting");
    expect(waitingLabel("2026-11-04T12:00:00Z", now)).toBe("1 day waiting");
    expect(waitingLabel("2026-11-05T09:00:00Z", now)).toBe("3 hours waiting");
    expect(waitingLabel("2026-11-05T11:59:00Z", now)).toBe("just now");
    expect(waitingLabel("not a date", now)).toBe("just now");
  });
  it("flags items waiting 3 days or more as overdue", () => {
    expect(isOverdue("2026-11-02T12:00:00Z", now)).toBe(true);
    expect(isOverdue("2026-11-03T12:00:01Z", now)).toBe(false);
  });
});

describe("formatKes", () => {
  it("formats whole and fractional amounts", () => {
    expect(formatKes(2000)).toBe("KES 2,000");
    expect(formatKes(12500.5)).toBe("KES 12,500.5");
  });
});
