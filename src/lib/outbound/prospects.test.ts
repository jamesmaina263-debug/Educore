import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_ROWS,
  buildScoringPrompt,
  normalizePhone,
  normalizeSchoolType,
  normalizeWebsite,
  parseCsv,
  parseProspectCsv,
  parseScoringResponse,
} from "./prospects";

describe("parseCsv", () => {
  it("handles quotes, embedded commas/newlines, CRLF and a BOM", () => {
    const rows = parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n"line1\nline2",z\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["line1\nline2", "z"],
    ]);
  });
  it("drops fully blank lines", () => {
    expect(parseCsv("a,b\n\n,\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("normalizers", () => {
  it("maps school types", () => {
    expect(normalizeSchoolType("Private")).toBe("private");
    expect(normalizeSchoolType("Public/Government")).toBe("public");
    expect(normalizeSchoolType("Faith-based")).toBe("other");
    expect(normalizeSchoolType("")).toBeNull();
  });
  it("cleans phones and rejects junk", () => {
    expect(normalizePhone("+254 712 345 678")).toBe("+254712345678");
    expect(normalizePhone("0712-345-678")).toBe("0712345678");
    expect(normalizePhone("n/a")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
  });
  it("normalizes websites", () => {
    expect(normalizeWebsite("school.ac.ke")).toBe("https://school.ac.ke");
    expect(normalizeWebsite("http://school.ac.ke/")).toBe("http://school.ac.ke");
    expect(normalizeWebsite("not a url")).toBeNull();
  });
});

describe("parseProspectCsv", () => {
  it("parses aliased headers and reports bad cells without echoing contact details", () => {
    const csv = [
      "School,County,Type,Email,Phone,Students",
      "Sunrise Academy,Nakuru,Private,head@sunrise.ac.ke,0712 345 678,\"1,200\"",
      "Bad Email School,Kiambu,public,not-an-email,,abc",
      ",Mombasa,private,,,",
    ].join("\n");
    const r = parseProspectCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rows).toHaveLength(2);
    expect(r.value.rows[0]).toMatchObject({
      school_name: "Sunrise Academy",
      town_county: "Nakuru",
      school_type: "private",
      email: "head@sunrise.ac.ke",
      phone: "0712345678",
      student_count: 1200,
    });
    expect(r.value.rows[1]).toMatchObject({ email: null, student_count: null });
    expect(r.value.warnings.some((w) => w.includes("Row 4") && w.includes("no school name"))).toBe(true);
    expect(r.value.warnings.join(" ")).not.toContain("not-an-email");
  });
  it("requires a school name column", () => {
    const r = parseProspectCsv("county,type\nNakuru,private");
    expect(r.ok).toBe(false);
  });
  it("enforces the row cap", () => {
    const lines = ["school_name"];
    for (let i = 0; i <= MAX_IMPORT_ROWS; i++) lines.push(`School ${i}`);
    const r = parseProspectCsv(lines.join("\n"));
    expect(r.ok).toBe(false);
  });
});

describe("scoring prompt + response", () => {
  it("builds a prompt containing only supplied facts and the no-invention rules", () => {
    const p = buildScoringPrompt({
      school_name: "Sunrise Academy",
      town_county: "Nakuru",
      school_type: "private",
      website: null,
      contact_name: null,
      contact_role: null,
      student_count: 400,
    });
    expect(p).toContain("Sunrise Academy");
    expect(p).toContain("Approximate students: 400");
    expect(p).not.toContain("Website:");
    expect(p).toContain("never claim we visited");
  });
  const good = {
    fit_score: 72.4,
    fit_reason: "Mid-size private school.",
    email_subject: "Fees and CBC reports in one place",
    email_body: "Hello, ...",
    whatsapp: "Hi, ... reply STOP.",
  };
  it("parses plain and fenced JSON and clamps the score", () => {
    const a = parseScoringResponse(JSON.stringify(good));
    expect(a.ok && a.value.fit_score).toBe(72);
    const b = parseScoringResponse("```json\n" + JSON.stringify({ ...good, fit_score: 250 }) + "\n```");
    expect(b.ok && b.value.fit_score).toBe(100);
  });
  it("rejects malformed or incomplete output", () => {
    expect(parseScoringResponse("sure! here you go").ok).toBe(false);
    expect(parseScoringResponse(JSON.stringify({ ...good, whatsapp: "" })).ok).toBe(false);
    expect(parseScoringResponse(JSON.stringify({ ...good, fit_score: "high" })).ok).toBe(false);
  });
});
