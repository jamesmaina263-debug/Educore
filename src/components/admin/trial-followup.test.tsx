import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrialFollowupView } from "./trial-followup";
import { buildTrialFollowup, type TrialSchoolInput } from "@/lib/growth/trial-followup";

const NOW = new Date("2026-10-18T09:00:00Z");
const DAY = 86_400_000;
const iso = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString();

function trial(day: number, over: Partial<TrialSchoolInput> = {}): TrialSchoolInput {
  return {
    schoolId: over.schoolId ?? `s${day}`,
    name: over.name ?? `School ${day}`,
    slug: over.slug ?? `school-${day}`,
    schoolStatus: "trial",
    subscriptionStatus: "trialing",
    trialStartedAt: iso(-(day - 1) - 0.1),
    trialEndsAt: iso(-(day - 1) - 0.1 + 30),
    lastActiveAt: iso(-0.2),
    staffCount: 4,
    owner: { name: "Jane Owner", email: "jane@school.example" },
    ...over,
  };
}

const render = (inputs: TrialSchoolInput[]) => renderToStaticMarkup(<TrialFollowupView data={buildTrialFollowup(inputs, NOW)} />);

describe("TrialFollowupView", () => {
  it("shows the school, owner contact, the reasons and a suggested step for a school needing a check-in", () => {
    const html = render([trial(9, { name: "Sunrise Academy", lastActiveAt: iso(-6), staffCount: 1 })]);
    expect(html).toContain("Sunrise Academy");
    expect(html).toContain("Jane Owner");
    expect(html).toContain("jane@school.example");
    expect(html).toContain("Day 9 of 30");
    expect(html).toContain("No activity for 6 days");
    expect(html).toContain("Only one staff account");
    expect(html).toContain("Check in and offer a short setup or training call");
  });

  it("says plainly when nothing needs attention, and when nothing is running", () => {
    expect(render([trial(10)])).toContain("No running trial needs a check-in today");
    const none = render([]);
    expect(none).toContain("No trials are running right now.");
    expect(none).not.toContain("NaN");
  });

  it("lists a recently ended trial in the win-back panel", () => {
    const ended: TrialSchoolInput = {
      ...trial(30, { name: "Lapsed School" }),
      schoolStatus: "suspended",
      subscriptionStatus: "past_due",
      trialStartedAt: iso(-35),
      trialEndsAt: iso(-5),
    };
    const html = render([ended]);
    expect(html).toContain("Lapsed School");
    expect(html).toContain("5 days ago");
    expect(html).toContain("Trial ended recently, not converted");
  });

  it("copes with a missing owner and a school never active", () => {
    const html = render([trial(9, { name: "Quiet School", owner: null, lastActiveAt: null })]);
    expect(html).toContain("No owner on file");
    expect(html).toContain("None recorded");
  });

  it("states that nothing is sent and that no learner data is read", () => {
    const html = render([trial(9)]);
    expect(html).toContain("Nothing is sent from this page");
    expect(html).toContain("No learner data");
    expect(html).not.toMatch(/mailto:|<button|<form/i);
  });

  it("leaves demo and QA schools out", () => {
    const html = render([trial(9, { name: "Demo Academy", slug: "demo-academy", lastActiveAt: iso(-9) })]);
    expect(html).not.toContain("Demo Academy");
  });
});
