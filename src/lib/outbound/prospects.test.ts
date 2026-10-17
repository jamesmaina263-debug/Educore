import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_ROWS,
  buildScoringPrompt,
  normalizePhone,
  normalizeManualContacts,
  normalizeSchoolLevel,
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
  it("maps school levels, recognising kindergartens", () => {
    expect(normalizeSchoolLevel("Nursery")).toBe("kindergarten");
    expect(normalizeSchoolLevel("PP1 / Pre-primary")).toBe("kindergarten");
    expect(normalizeSchoolLevel("Primary School")).toBe("primary");
    expect(normalizeSchoolLevel("Senior High")).toBe("secondary");
    expect(normalizeSchoolLevel("Tertiary")).toBe("other");
    expect(normalizeSchoolLevel("")).toBeNull();
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

  it("grounds the prompt in the verified facts and bans endorsement and discount claims", () => {
    const p = buildScoringPrompt({
      school_name: "Sunrise Academy",
      town_county: null,
      school_type: "private",
      school_level: "primary",
      website: null,
      contact_name: null,
      contact_role: null,
      student_count: null,
    });
    expect(p).toContain("These are the ONLY product claims you may make");
    expect(p).toMatch(/Never claim approval, certification, endorsement/);
    expect(p).toMatch(/Never offer or imply a discount/);
    expect(p).not.toContain("simple learner progress reports");
  });

  it("gives kindergartens the competency wording and no exam claims", () => {
    const p = buildScoringPrompt({
      school_name: "Little Stars Nursery",
      town_county: null,
      school_type: "private",
      school_level: "kindergarten",
      website: null,
      contact_name: null,
      contact_role: null,
      student_count: null,
    });
    expect(p).toContain("competency-based learner progress reports");
    expect(p).toContain("Do not mention exams, KCPE, KCSE");
    expect(p).not.toContain("simple learner progress reports");
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

describe("normalizeManualContacts", () => {
  it("cleans valid input and turns blanks into nulls", () => {
    const r = normalizeManualContacts({
      contact_name: "  Jane Wanjiru ",
      contact_role: "Head Teacher",
      phone: "0712 345 678",
      email: " Office@Sunrise.ac.ke ",
      website: "sunrise.ac.ke",
    });
    expect(r).toEqual({
      ok: true,
      value: {
        contact_name: "Jane Wanjiru",
        contact_role: "Head Teacher",
        phone: "0712345678",
        email: "office@sunrise.ac.ke",
        website: "https://sunrise.ac.ke",
      },
    });
    const blank = normalizeManualContacts({});
    expect(blank).toEqual({
      ok: true,
      value: { contact_name: null, contact_role: null, phone: null, email: null, website: null },
    });
  });
  it("rejects bad email, phone and website with a specific message", () => {
    expect(normalizeManualContacts({ email: "nope" })).toMatchObject({ ok: false, error: expect.stringContaining("email") });
    expect(normalizeManualContacts({ phone: "12" })).toMatchObject({ ok: false, error: expect.stringContaining("phone") });
    expect(normalizeManualContacts({ website: "not a url" })).toMatchObject({ ok: false, error: expect.stringContaining("website") });
    expect(normalizeManualContacts({ contact_name: "x".repeat(201) }).ok).toBe(false);
  });
});
