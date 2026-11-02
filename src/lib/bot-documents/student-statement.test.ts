import { describe, expect, it } from "vitest";
import { buildStatementModel, formatKes, type StatementRaw } from "./student-statement";

const base = (over: Partial<StatementRaw> = {}): StatementRaw => ({
  school: { name: "Demo Academy", address: null, phone: null, primaryColor: null },
  student: { fullName: "Sam One", admissionNumber: "A1", classLabel: "Grade 6 East" },
  term: { id: "t2", name: "Term 2", yearName: "2026" },
  invoices: [
    { id: "i1", invoiceNumber: "INV-1", termId: "t1", totalAmount: 10000, createdAt: "2026-01-10T00:00:00Z" },
    { id: "i2", invoiceNumber: "INV-2", termId: "t2", totalAmount: 12000, createdAt: "2026-05-02T00:00:00Z" },
  ],
  discounts: [],
  allocations: [],
  accountBalance: 22000,
  creditBalance: 0,
  generatedAt: "2026-11-02T08:00:00Z",
  ...over,
});

describe("buildStatementModel", () => {
  it("brings forward earlier terms and reconciles to the account balance", () => {
    const m = buildStatementModel(
      base({
        discounts: [{ invoiceId: "i2", amount: 2000 }],
        allocations: [
          { paymentId: "p1", invoiceId: "i1", amount: 4000, paidAt: "2026-02-01T00:00:00Z", method: "cash", reference: null },
          { paymentId: "p2", invoiceId: "i2", amount: 5000, paidAt: "2026-05-10T00:00:00Z", method: "mpesa", reference: "QWE123" },
        ],
        accountBalance: 11000,
      }),
    );
    expect(m).not.toBeNull();
    expect(m!.broughtForward).toBe(6000); // 10000 - 4000 paid on the term-1 invoice
    expect(m!.totalCharged).toBe(12000);
    expect(m!.totalCredited).toBe(7000); // 2000 discount + 5000 payment
    expect(m!.closingBalance).toBe(11000);
    expect(m!.lines.map((l) => l.description)).toEqual(["Invoice INV-2", "Discounts and waivers (approved)", "Payment received (M-Pesa QWE123)"]);
  });

  it("returns null when the lines do not add up to the balance (never sends wrong figures)", () => {
    expect(buildStatementModel(base({ accountBalance: 21999 }))).toBeNull();
  });

  it("merges one payment split over two invoices of the term into a single line", () => {
    const m = buildStatementModel(
      base({
        invoices: [
          { id: "i2", invoiceNumber: "INV-2", termId: "t2", totalAmount: 8000, createdAt: "2026-05-02T00:00:00Z" },
          { id: "i3", invoiceNumber: "INV-3", termId: "t2", totalAmount: 2000, createdAt: "2026-05-03T00:00:00Z" },
        ],
        allocations: [
          { paymentId: "p9", invoiceId: "i2", amount: 3000, paidAt: "2026-05-10T00:00:00Z", method: "cash", reference: null },
          { paymentId: "p9", invoiceId: "i3", amount: 500, paidAt: "2026-05-10T00:00:00Z", method: "cash", reference: null },
        ],
        accountBalance: 6500,
      }),
    );
    expect(m).not.toBeNull();
    expect(m!.lines.filter((l) => l.credit !== null)).toHaveLength(1);
    expect(m!.totalCredited).toBe(3500);
  });

  it("treats everything as brought forward when there is no active term", () => {
    const m = buildStatementModel(base({ term: null, accountBalance: 22000 }));
    expect(m).not.toBeNull();
    expect(m!.termLabel).toBe("No active term");
    expect(m!.broughtForward).toBe(22000);
    expect(m!.lines).toHaveLength(0);
  });

  it("works in whole cents (no floating point drift)", () => {
    const m = buildStatementModel(
      base({
        invoices: [{ id: "i2", invoiceNumber: null, termId: "t2", totalAmount: 0.3, createdAt: "2026-05-02T00:00:00Z" }],
        allocations: [{ paymentId: "p", invoiceId: "i2", amount: 0.1, paidAt: "2026-05-03T00:00:00Z", method: null, reference: null }],
        accountBalance: 0.2,
      }),
    );
    expect(m).not.toBeNull();
    expect(m!.closingBalance).toBe(0.2);
  });

  it("formats money", () => {
    expect(formatKes(1234.5)).toBe("KES 1,234.50");
    expect(formatKes(-10)).toBe("-KES 10.00");
  });
});
