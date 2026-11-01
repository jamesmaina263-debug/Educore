import { describe, expect, it } from "vitest";
import {
  MAX_C2B_AMOUNT,
  maskMsisdn,
  parseC2bConfirmation,
  parseC2bPath,
  parseTransTime,
} from "../../supabase/functions/_shared/mpesa/parseC2bConfirmation";

const SCHOOL = "123e4567-e89b-42d3-a456-426614174000";
const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef";

const good = {
  TransactionType: "Pay Bill",
  TransID: "RKTQDM7W6S",
  TransTime: "20261031093845",
  TransAmount: "1500.00",
  BusinessShortCode: "600638",
  BillRefNumber: "001",
  InvoiceNumber: "",
  OrgAccountBalance: "",
  ThirdPartyTransID: "",
  MSISDN: "2547*****126",
  FirstName: "Jane",
  MiddleName: "",
  LastName: "Doe",
};

describe("parseC2bPath", () => {
  it("accepts a valid school id and token from the last two segments", () => {
    const r = parseC2bPath(`/functions/v1/fees-c2b-confirmation/${SCHOOL}/${TOKEN}`);
    expect(r).toEqual({ ok: true, schoolId: SCHOOL, token: TOKEN });
  });
  it("normalises an upper-case school id", () => {
    const r = parseC2bPath(`/fees-c2b-confirmation/${SCHOOL.toUpperCase()}/${TOKEN}`);
    expect(r.ok && r.schoolId).toBe(SCHOOL);
  });
  it("rejects malformed paths without touching anything else", () => {
    for (const bad of [
      "/",
      "/fees-c2b-confirmation",
      `/fees-c2b-confirmation/${SCHOOL}`,
      `/fees-c2b-confirmation/not-a-uuid/${TOKEN}`,
      `/fees-c2b-confirmation/${SCHOOL}/short`,
      `/fees-c2b-confirmation/${SCHOOL}/${TOKEN.toUpperCase()}`,
      `/fees-c2b-confirmation/${SCHOOL}/${TOKEN}x`,
      `/fees-c2b-confirmation/${SCHOOL}/' or 1=1 --`,
    ]) {
      expect(parseC2bPath(bad).ok).toBe(false);
    }
  });
});

describe("parseC2bConfirmation", () => {
  it("accepts a genuine confirmation and ignores the payer's name fields", () => {
    const r = parseC2bConfirmation(good);
    expect(r).toEqual({
      ok: true,
      transId: "RKTQDM7W6S",
      amount: 1500,
      shortcode: "600638",
      billRef: "001",
      msisdnMasked: "2547*****126",
      transTime: "2026-10-31T09:38:45+03:00",
      transactionType: "Pay Bill",
    });
    expect(JSON.stringify(r)).not.toMatch(/Jane|Doe/);
  });

  it("accepts numeric amount and shortcode, and upper-cases the TransID", () => {
    const r = parseC2bConfirmation({ ...good, TransID: "rktqdm7w6s", TransAmount: 250.5, BusinessShortCode: 600638 });
    expect(r.ok && r.transId).toBe("RKTQDM7W6S");
    expect(r.ok && r.amount).toBe(250.5);
    expect(r.ok && r.shortcode).toBe("600638");
  });

  it("treats a missing or blank account reference as null (till payments)", () => {
    for (const ref of [undefined, "", "   "]) {
      const r = parseC2bConfirmation({ ...good, BillRefNumber: ref });
      expect(r.ok && r.billRef).toBeNull();
    }
  });

  it("strips control characters and caps the account reference at 100 characters", () => {
    const r = parseC2bConfirmation({ ...good, BillRefNumber: "  AB\u0000\n1" + "x".repeat(200) });
    expect(r.ok && r.billRef?.length).toBeLessThanOrEqual(100);
    expect(r.ok && r.billRef).not.toMatch(/[\u0000-\u001f]/);
  });

  it("rejects non-object bodies", () => {
    for (const bad of [null, undefined, "x", 5, [], [good]]) {
      expect(parseC2bConfirmation(bad).ok).toBe(false);
    }
  });

  it("rejects a missing or malformed TransID", () => {
    for (const id of [undefined, null, "", "ab", "has space1", "ABC-123456", "x".repeat(40), 123456789]) {
      const r = parseC2bConfirmation({ ...good, TransID: id });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.transId).toBeNull();
    }
  });

  it("rejects bad amounts and reports the TransID", () => {
    for (const amount of [undefined, null, "", "0", 0, -5, "-5", "abc", "1e3", "10.999", NaN, Infinity, MAX_C2B_AMOUNT + 1, {}]) {
      const r = parseC2bConfirmation({ ...good, TransAmount: amount });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.transId).toBe("RKTQDM7W6S");
    }
  });

  it("rejects a missing or malformed BusinessShortCode", () => {
    for (const code of [undefined, "", "12", "abc123", "12345678901", {}]) {
      expect(parseC2bConfirmation({ ...good, BusinessShortCode: code }).ok).toBe(false);
    }
  });

  it("rounds amounts to two decimals", () => {
    const r = parseC2bConfirmation({ ...good, TransAmount: "10.10" });
    expect(r.ok && r.amount).toBe(10.1);
  });
});

describe("maskMsisdn", () => {
  it("keeps Daraja's own masked form", () => {
    expect(maskMsisdn("2547*****126")).toBe("2547*****126");
    expect(maskMsisdn("2547 ***** 126")).toBe("2547*****126");
  });
  it("masks a raw number so it is never stored in full", () => {
    expect(maskMsisdn("254712345126")).toBe("2547*****126");
    expect(maskMsisdn(254712345126)).toBe("2547*****126");
    expect(maskMsisdn("+254 712 345 126")).toBe("2547*****126");
  });
  it("drops hashes and anything unrecognisable", () => {
    expect(maskMsisdn("a".repeat(64))).toBeNull();
    expect(maskMsisdn("12345")).toBeNull();
    expect(maskMsisdn("")).toBeNull();
    expect(maskMsisdn(undefined)).toBeNull();
    expect(maskMsisdn({})).toBeNull();
    expect(maskMsisdn("25471234512*6789")).toBeNull();
  });
});

describe("parseTransTime", () => {
  it("reads yyyyMMddHHmmss as East Africa Time", () => {
    expect(parseTransTime("20261031093845")).toBe("2026-10-31T09:38:45+03:00");
    expect(parseTransTime(20261031093845)).toBe("2026-10-31T09:38:45+03:00");
  });
  it("returns null for anything else", () => {
    for (const bad of [undefined, "", "2026-10-31", "20261331093845", "abc", "2026103109384"]) {
      expect(parseTransTime(bad)).toBeNull();
    }
  });
});
