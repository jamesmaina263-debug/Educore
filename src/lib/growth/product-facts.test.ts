import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRIAL_TERMS } from "@/lib/marketing/trial";
import {
  PITCH_RULES,
  PUBLISHED_PRICE_KES_PER_STUDENT_TERM,
  VERIFIED_FACTS,
  factsForLevel,
  renderProductFactsForPrompt,
} from "./product-facts";

const root = process.cwd();

describe("verified product facts", () => {
  it("every claim points at a file that exists", () => {
    for (const f of VERIFIED_FACTS) {
      expect(existsSync(join(root, f.evidence)), `${f.id} -> ${f.evidence}`).toBe(true);
    }
  });

  it("has unique ids", () => {
    const ids = VERIFIED_FACTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("quotes the published price exactly as the pricing page does", () => {
    const pricing = readFileSync(join(root, "src/app/(marketing)/pricing/page.tsx"), "utf8");
    const published = /const PRICE_LINE = "From KES (\d+)"/.exec(pricing)?.[1];
    expect(published).toBe(String(PUBLISHED_PRICE_KES_PER_STUDENT_TERM));
  });

  it("uses the existing trial wording rather than a copy of it", () => {
    const trial = VERIFIED_FACTS.find((f) => f.id === "trial");
    expect(trial?.claim).toContain(TRIAL_TERMS);
  });

  it("contains no approval, endorsement or discount language as a claim", () => {
    for (const f of VERIFIED_FACTS) {
      expect(f.claim, f.id).not.toMatch(/approved|certified|accredited|endorsed|official|discount|free extension/i);
    }
  });

  it("forbids endorsement claims in the rules", () => {
    expect(PITCH_RULES.join(" ")).toMatch(/KICD/);
    expect(PITCH_RULES.join(" ")).toMatch(/Ministry of Education/);
  });
});

describe("facts by school level", () => {
  const ids = (level: Parameters<typeof factsForLevel>[0]) => factsForLevel(level).map((f) => f.id);

  it("kindergartens get pre-primary and competency reports but no exam-grading claim", () => {
    expect(ids("kindergarten")).toContain("pre-primary");
    expect(ids("kindergarten")).toContain("competency-reports");
    expect(ids("kindergarten")).not.toContain("grading-scales");
  });

  it("primary and secondary get grading scales but not the pre-primary claim", () => {
    for (const level of ["primary", "secondary"] as const) {
      expect(ids(level)).toContain("grading-scales");
      expect(ids(level)).not.toContain("pre-primary");
    }
  });

  it("an unknown level only gets the level-neutral facts", () => {
    expect(ids(null)).not.toContain("pre-primary");
    expect(ids(null)).not.toContain("grading-scales");
    expect(ids(null)).toContain("fees-mpesa");
  });
});

describe("rendered prompt block", () => {
  it("uses the competency wording and never the old 'simple progress reports' wording", () => {
    const k = renderProductFactsForPrompt("kindergarten");
    expect(k).toContain("competency-based learner progress reports");
    expect(k).not.toContain("simple learner progress reports");
    expect(k).toMatch(/Do not mention exams, KCPE, KCSE/);
    expect(k).toMatch(/not claim the reports are designed specifically for pre-primary/i);
  });

  it("only adds kindergarten guidance for kindergartens", () => {
    expect(renderProductFactsForPrompt("primary")).not.toMatch(/kindergarten \/ nursery/);
  });

  it("states the published price and the no-discount rule", () => {
    const text = renderProductFactsForPrompt("primary");
    expect(text).toContain(`KES ${PUBLISHED_PRICE_KES_PER_STUDENT_TERM}`);
    expect(text).toMatch(/Never offer or imply a discount/);
  });
});
