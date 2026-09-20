import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { TRIAL_CTA_LABEL, TRIAL_HREF, TRIAL_TERMS } from "./trial";

// The marketing copy promises a specific trial length and a self-serve
// signup route. These tests fail if the product stops matching the promise,
// so the site can't silently keep advertising something that's no longer true.
describe("free-trial marketing copy matches the product", () => {
  const signupActions = readFileSync(
    join(process.cwd(), "src/app/signup/actions.ts"),
    "utf8",
  );

  it("advertises the same trial length signup actually starts", () => {
    const days = /p_trial_days:\s*(\d+)/.exec(signupActions)?.[1];
    expect(days).toBeDefined();
    expect(TRIAL_CTA_LABEL).toContain(`${days}-day`);
    expect(TRIAL_TERMS).toContain(`${days}-day`);
  });

  it("links the trial CTA to the self-serve signup route", () => {
    expect(TRIAL_HREF).toBe("/signup");
    const signupPage = readFileSync(
      join(process.cwd(), "src/app/signup/page.tsx"),
      "utf8",
    );
    expect(signupPage).toContain("30-day free trial");
  });

  it("does not ask for a card during signup (backs the 'no card required' claim)", () => {
    expect(signupActions).not.toMatch(/card|stripe|payment_method/i);
  });
});
