import { describe, expect, it } from "vitest";
import {
  buildJournalLines,
  csvSafe,
  exportFilename,
  isValidIsoDate,
  toCents,
  toQuickBooksRows,
  toSageRows,
  unbalancedJournals,
  validateExportOptions,
  type ExportOptions,
} from "./accounting-export";
import type { LedgerLine } from "@/lib/vote-heads";

const opts: ExportOptions = {
  date: "2026-11-02",
  periodLabel: "Term 3 2026",
  receivableAccount: "Accounts Receivable",
  payableAccount: "Accounts Payable",
};

const L = (code: string, name: string, kind: "income" | "expense", amount: number, voteHeadId: string | null = "id-" + code): LedgerLine => ({
  voteHeadId,
  code,
  name,
  kind,
  lines: 1,
  amount,
});

const ledger: LedgerLine[] = [
  L("TUITION", "Tuition", "income", 1000000.1),
  L("BOARD", "Boarding", "income", 250000.2),
  L("UNMAPPED", "Unmapped income", "income", 500, null),
  L("REPAIRS", "Repairs", "expense", 12345.67),
  L("UNMAPPED", "Unmapped spending", "expense", 100, null),
  L("EMPTY", "Empty head", "income", 0),
];

describe("toCents", () => {
  it("rounds to whole cents without float drift", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1000000.1)).toBe(100000010);
  });
});

describe("buildJournalLines", () => {
  const lines = buildJournalLines(ledger, opts);

  it("makes one income and one spending journal and skips zero lines", () => {
    expect([...new Set(lines.map((l) => l.journalNo))]).toEqual(["EDUCORE-INC-20261102", "EDUCORE-EXP-20261102"]);
    expect(lines.some((l) => l.account.includes("EMPTY"))).toBe(false);
  });

  it("credits income vote heads and debits the receivable account with the net total", () => {
    const inc = lines.filter((l) => l.journalNo.includes("INC"));
    expect(inc.find((l) => l.account === "TUITION - Tuition")?.creditCents).toBe(100000010);
    const recv = inc.find((l) => l.account === "Accounts Receivable")!;
    expect(recv.debitCents).toBe(100000010 + 25000020 + 50000);
    expect(recv.creditCents).toBe(0);
  });

  it("debits spending vote heads and credits the payable account", () => {
    const exp = lines.filter((l) => l.journalNo.includes("EXP"));
    expect(exp.find((l) => l.account === "REPAIRS - Repairs")?.debitCents).toBe(1234567);
    expect(exp.find((l) => l.account === "Accounts Payable")?.creditCents).toBe(1234567 + 10000);
  });

  it("keeps unmapped buckets visible under their own names", () => {
    expect(lines.some((l) => l.account === "Unmapped income")).toBe(true);
    expect(lines.some((l) => l.account === "Unmapped spending")).toBe(true);
  });

  it("always balances to the cent", () => {
    expect(unbalancedJournals(lines)).toEqual([]);
  });

  it("flips sides for a negative amount (invoice totals below itemised) and still balances", () => {
    const withNegative = buildJournalLines([L("TUITION", "Tuition", "income", 1000), L("UNITEMISED", "Invoiced but not itemised", "income", -250.5, null)], opts);
    const neg = withNegative.find((l) => l.account === "Invoiced but not itemised")!;
    expect(neg.debitCents).toBe(25050);
    expect(neg.creditCents).toBe(0);
    expect(unbalancedJournals(withNegative)).toEqual([]);
  });

  it("uses custom account names per vote head when given", () => {
    const named = buildJournalLines(ledger, { ...opts, accountNames: { TUITION: "4000 Tuition Income" } });
    expect(named.some((l) => l.account === "4000 Tuition Income")).toBe(true);
    expect(named.some((l) => l.account === "BOARD - Boarding")).toBe(true);
  });

  it("returns nothing for an empty ledger", () => {
    expect(buildJournalLines([], opts)).toEqual([]);
  });
});

describe("csv layouts", () => {
  const lines = buildJournalLines(ledger, opts);

  it("QuickBooks rows carry the journal import columns with 2-decimal amounts and DD/MM/YYYY dates", () => {
    const rows = toQuickBooksRows(lines);
    expect(Object.keys(rows[0])).toEqual(["*JournalNo", "*JournalDate", "*AccountName", "*Debits", "*Credits", "Description"]);
    const tuition = rows.find((r) => r["*AccountName"] === "TUITION - Tuition")!;
    expect(tuition["*Credits"]).toBe("1000000.10");
    expect(tuition["*Debits"]).toBe("");
    expect(tuition["*JournalDate"]).toBe("02/11/2026");
  });

  it("Sage rows use JD/JC with a positive net amount", () => {
    const rows = toSageRows(lines);
    const recv = rows.find((r) => r["Nominal A/C Ref"] === "Accounts Receivable")!;
    expect(recv.Type).toBe("JD");
    expect(recv["Net Amount"]).toBe("1250500.30");
    const tuition = rows.find((r) => r["Nominal A/C Ref"] === "TUITION - Tuition")!;
    expect(tuition.Type).toBe("JC");
  });

  it("debits equal credits across each exported file", () => {
    const qb = toQuickBooksRows(lines);
    const sum = (k: string) => qb.reduce((s, r) => s + Math.round(Number(r[k] || 0) * 100), 0);
    expect(sum("*Debits")).toBe(sum("*Credits"));
  });
});

describe("csvSafe", () => {
  it("defuses spreadsheet formulas and flattens newlines", () => {
    expect(csvSafe("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(csvSafe("+1")).toBe("'+1");
    expect(csvSafe("@SUM")).toBe("'@SUM");
    expect(csvSafe("Line\r\nbreak")).toBe("Line break");
    expect(csvSafe("Normal name")).toBe("Normal name");
  });
});

describe("validateExportOptions", () => {
  it("accepts good options", () => {
    expect(validateExportOptions(opts)).toBeNull();
  });
  it("rejects a bad date, empty accounts and control characters", () => {
    expect(validateExportOptions({ ...opts, date: "2026-02-30" })).toMatch(/date/i);
    expect(validateExportOptions({ ...opts, receivableAccount: "  " })).toMatch(/Receivable/);
    expect(validateExportOptions({ ...opts, payableAccount: "A\u0000B" })).toMatch(/Payable/);
    expect(validateExportOptions({ ...opts, accountNames: { TUITION: "" } })).toMatch(/TUITION/);
  });
  it("validates ISO dates strictly", () => {
    expect(isValidIsoDate("2026-11-02")).toBe(true);
    expect(isValidIsoDate("02/11/2026")).toBe(false);
  });
});

describe("exportFilename", () => {
  it("names the file by format and date", () => {
    expect(exportFilename("quickbooks", "2026-11-02")).toBe("educore-journal-quickbooks-20261102.csv");
    expect(exportFilename("sage", "2026-11-02")).toBe("educore-journal-sage-20261102.csv");
  });
});
