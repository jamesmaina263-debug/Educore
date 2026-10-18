import { describe, expect, it } from "vitest";
import { PUBLISHED_PRICE_KES_PER_STUDENT_TERM } from "@/lib/growth/product-facts";
import { TRIAL_TERMS } from "@/lib/marketing/trial";
import {
  MAX_IMPORT_ROWS,
  OUTREACH_OFFER,
  assembleWhatsApp,
  buildScoringPrompt,
  greetingName,
  normalizePhone,
  normalizeManualContacts,
  sanitizeProspectRows,
  normalizeSchoolLevel,
  normalizeSchoolType,
  normalizeWebsite,
  parseCsv,
  parseProspectCsv,
  parseScoringResponse,
  sanitizeOpening,
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

describe("scoring prompt", () => {
  it("contains only supplied facts and asks for an opening, not a whole email", () => {
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
    expect(p).toContain('"opening"');
    expect(p).not.toContain('"email_body"');
    expect(p).toContain("never claim we visited");
  });
  it("grounds the prompt in the verified facts and bans endorsement and discount claims", () => {
    const p = buildScoringPrompt({
      school_name: "Sunrise Academy",
      town_county: "Nakuru",
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
  it("tells the scorer about ownership and to rank likely-public schools lower", () => {
    const base = { town_county: null, school_type: null, school_level: "primary", website: null, contact_name: null, contact_role: null, student_count: null };
    const priv = buildScoringPrompt({ ...base, school_name: "Murera View Academy" });
    expect(priv).toContain("Ownership: Likely private (a guess from the name)");
    const pub = buildScoringPrompt({ ...base, school_name: "Gititu Primary School" });
    expect(pub).toContain("Ownership: Likely public (a guess from the name)");
    expect(pub).toContain("no higher than 40");
    const tagged = buildScoringPrompt({ ...base, school_name: "Anything", school_type: "private" });
    expect(tagged).toContain("Ownership: Private (map tag)");
    expect(tagged).not.toContain("(a guess from the name)");
    expect(buildScoringPrompt({ ...base, school_name: "Gatimu Ngandu" })).not.toContain("Ownership:");
  });
  it("keeps the fixed offer line in step with the marketing trial wording", () => {
    expect(TRIAL_TERMS).toBe("30-day free trial. No card required.");
    expect(OUTREACH_OFFER.pricePerStudentPerTermKes).toBe(PUBLISHED_PRICE_KES_PER_STUDENT_TERM);
  });
  it("steers kindergartens away from exams", () => {
    const p = buildScoringPrompt({
      school_name: "Little Stars",
      town_county: null,
      school_type: null,
      school_level: "kindergarten",
      website: null,
      contact_name: null,
      contact_role: null,
      student_count: null,
    });
    expect(p).toContain("not exams");
    expect(p).toContain("competency-based learner progress reports");
    expect(p).toContain("Do not mention exams, KCPE, KCSE");
  });
});

describe("parseScoringResponse + fixed draft template", () => {
  const good = {
    fit_score: 72.4,
    fit_reason: "Mid-size private school.",
    email_subject: "One system for fees, attendance and report cards",
    opening: "Following up on fees and preparing report cards each term can take a lot of a school's time.",
  };

  it("parses plain and fenced JSON and clamps the score", () => {
    const a = parseScoringResponse(JSON.stringify(good));
    expect(a.ok && a.value.fit_score).toBe(72);
    const b = parseScoringResponse("```json\n" + JSON.stringify({ ...good, fit_score: 250 }) + "\n```");
    expect(b.ok && b.value.fit_score).toBe(100);
  });

  it("builds the email from fixed text: price, trial, links, sign-off and opt-out always present", () => {
    const r = parseScoringResponse(JSON.stringify(good), { school_name: "Sunrise Academy", contact_name: "Jane Wanjiru", school_level: "primary" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const body = r.value.email_body;
    expect(body.startsWith("Hello Jane Wanjiru,\n\n")).toBe(true);
    expect(body).toContain(good.opening);
    expect(body).toContain("Our pricing starts at KES 100 per student per term, with a 30-day free trial and no payment card required.");
    expect(body).toContain("supported CBC competency-based reporting and marks-based grading");
    expect(body).toContain("Would you be open to a brief online demonstration");
    expect(body).toContain("Kind regards,\nEduCore Africa\nhttps://");
    expect(body).toContain("/signup");
    expect(body).toContain("just reply and we will not contact you again");
  });

  it("greets with plain 'Hello,' when the contact is missing or is really the school's name", () => {
    const none = parseScoringResponse(JSON.stringify(good), { school_name: "Nyeri Junior School", contact_name: null });
    expect(none.ok && none.value.email_body.startsWith("Hello,\n\n")).toBe(true);
    const schoolish = parseScoringResponse(JSON.stringify(good), { school_name: "Nyeri Junior School", contact_name: "Nyeri Junior" });
    expect(schoolish.ok && schoolish.value.email_body.startsWith("Hello,\n\n")).toBe(true);
    const office = parseScoringResponse(JSON.stringify(good), { school_name: "X", contact_name: "School Office" });
    expect(office.ok && office.value.email_body.startsWith("Hello,\n\n")).toBe(true);
    expect(greetingName("Jane Wanjiru", "Sunrise Academy")).toBe("Jane Wanjiru");
  });

  it("rejects an AI opening that contains figures, prices, links or offers and uses the default instead", () => {
    for (const bad of [
      "Save 50% on your school software today with our amazing offer.",
      "Our system costs KES 50 per student which is cheaper than anyone.",
      "Visit https://example.com to learn how we can help your school.",
      "Email us at sales@example.com for a free upgrade for your school.",
      "short",
    ]) {
      const r = parseScoringResponse(JSON.stringify({ ...good, opening: bad }));
      expect(r.ok && r.value.email_body).toContain("can take considerable time for a school");
      expect(r.ok && r.value.email_body).not.toContain(bad);
    }
    expect(sanitizeOpening(undefined, null)).toContain("considerable time");
  });

  it("uses kindergarten wording (no exams or report cards) for kindergartens", () => {
    const r = parseScoringResponse(JSON.stringify({ ...good, opening: undefined }), { school_level: "kindergarten" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.email_body).toContain("kindergartens and nursery schools");
    expect(r.value.email_body).toContain("competency-based learner progress reports");
    expect(r.value.email_body).not.toContain("marks-based grading");
    expect(r.value.email_body).not.toContain("simple learner progress reports");
    expect(r.value.whatsapp).toContain("Kenyan kindergartens and nursery schools");
    expect(r.value.whatsapp).toContain("competency-based learner progress reports");
    expect(r.value.whatsapp).not.toMatch(/report cards|marks-based|exam/i);
  });

  it("stays level-neutral (no exam or report-card wording) when the level is unknown", () => {
    const r = parseScoringResponse(JSON.stringify(good), { school_name: "Sunrise Academy" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.email_body).not.toContain("marks-based grading");
    expect(r.value.email_body).not.toContain("exam");
    expect(r.value.whatsapp).not.toMatch(/report cards|marks-based|exam/i);
    const primary = parseScoringResponse(JSON.stringify(good), { school_level: "primary" });
    expect(primary.ok && primary.value.email_body).toContain("marks-based grading");
  });

  it("builds the WhatsApp message from fixed text in the approved layout", () => {
    const w = assembleWhatsApp({ school_name: "Sunrise Academy", contact_name: "Jane Wanjiru", school_level: "primary" });
    expect(w.split("\n")).toEqual([
      "Hello Jane Wanjiru! 👋 We’re EduCore Africa, helping Kenyan schools simplify their daily administration.",
      "Our school management system brings together admissions, student attendance, M-Pesa fee collection, parent communication via SMS and WhatsApp, and exam management with CBC-supported and marks-based report cards.",
      "Pricing starts at KES 100 per student per term, and you can explore the system with a 30-day free trial, with no payment card required.",
      "Would you be open to a short demo to see how EduCore could support your school?",
      "🌐 https://www.educoreafrica.com",
      "If you’d prefer not to receive further messages, just reply STOP.",
    ]);
    expect(w.length).toBeLessThan(1000);
  });

  it("uses a plain 'Hello!' greeting when there is no usable contact name", () => {
    const w = assembleWhatsApp({ school_name: "Nyeri Junior School", contact_name: "Nyeri Junior", school_level: "primary" });
    expect(w.startsWith("Hello! 👋 We’re EduCore Africa")).toBe(true);
  });

  it("rejects malformed or incomplete output", () => {
    expect(parseScoringResponse("sure! here you go").ok).toBe(false);
    expect(parseScoringResponse(JSON.stringify({ ...good, email_subject: "" })).ok).toBe(false);
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

describe("sanitizeProspectRows (rows sent from the browser are never trusted)", () => {
  const good = {
    school_name: "Murera View Academy",
    town_county: "Nyeri",
    school_type: "private",
    school_level: "primary",
    website: "murera.ac.ke",
    phone: "0712 345 678",
    email: "Office@Murera.ac.ke",
    contact_name: null,
    contact_role: null,
    student_count: 300,
  };
  it("keeps good rows and normalises them", () => {
    expect(sanitizeProspectRows([good])[0]).toMatchObject({
      school_name: "Murera View Academy",
      school_type: "private",
      school_level: "primary",
      website: "https://murera.ac.ke",
      phone: "0712345678",
      email: "office@murera.ac.ke",
      student_count: 300,
    });
  });
  it("drops rows without a usable name, and non-array input", () => {
    expect(sanitizeProspectRows([{ ...good, school_name: "  " }, null, 5, "x", { ...good, school_name: "x".repeat(201) }])).toEqual([]);
    expect(sanitizeProspectRows("nope")).toEqual([]);
    expect(sanitizeProspectRows(undefined)).toEqual([]);
  });
  it("nulls out invalid enum values, bad emails/phones/URLs and bad numbers instead of trusting them", () => {
    const r = sanitizeProspectRows([
      { ...good, school_type: "government", school_level: "tertiary", email: "nope", phone: "12", website: "not a url", student_count: -4 },
    ])[0];
    expect(r).toMatchObject({ school_type: null, school_level: null, email: null, phone: null, website: null, student_count: null });
  });
  it("never returns more than the import cap", () => {
    const many = Array.from({ length: MAX_IMPORT_ROWS + 50 }, (_, i) => ({ ...good, school_name: `School ${i}` }));
    expect(sanitizeProspectRows(many)).toHaveLength(MAX_IMPORT_ROWS);
  });
});
