import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STATUSES,
  STATUS_LABELS,
  buildTimeline,
  isManualRule,
  listHref,
  missingRequired,
  parseListParams,
  recommendedNextAction,
  type MilestoneConfig,
  type SchoolDetail,
  type SchoolFacts,
} from "./onboarding";

const config: MilestoneConfig[] = [
  { key: "password_changed", label: "Password changed", grp: "account", weight: 1, required: true, enabled: true, sort_order: 10 },
  { key: "classes", label: "Classes created", grp: "setup", weight: 2, required: true, enabled: true, sort_order: 50 },
  { key: "students", label: "Students added", grp: "setup", weight: 2, required: true, enabled: true, sort_order: 60 },
  { key: "fee_structures", label: "Fee structure configured", grp: "setup", weight: 2, required: true, enabled: true, sort_order: 70 },
  { key: "second_user", label: "Second staff account added", grp: "setup", weight: 1, required: false, enabled: false, sort_order: 80 },
];

function school(over: Partial<SchoolFacts> = {}): SchoolFacts {
  return {
    school_id: "s1",
    school_name: "Test School",
    school_status: "trial",
    registered_at: "2026-10-01T08:00:00Z",
    admin_name: "A Admin",
    admin_email: "a@example.org",
    password_changed_at: null,
    email_verified_at: "2026-10-01T08:00:00Z",
    first_login_at: null,
    last_login_at: null,
    last_seen_at: null,
    student_count: 0,
    class_count: 0,
    academic_year_count: 0,
    fee_structure_count: 0,
    user_count: 1,
    milestones: {},
    progress_pct: 0,
    setup_started: false,
    required_complete: false,
    last_activity_at: null,
    days_since_activity: 0,
    status: "password_pending",
    priority: "low",
    ...over,
  };
}

describe("labels", () => {
  it("has a label for every status", () => {
    for (const s of ONBOARDING_STATUSES) expect(STATUS_LABELS[s]).toBeTruthy();
  });
});

describe("recommendedNextAction", () => {
  it("asks for a personal call once a password has been pending long enough", () => {
    expect(recommendedNextAction(school({ priority: "high" }), config)).toMatch(/Call the school administrator/);
  });

  it("suggests a reminder at medium priority and waiting at low", () => {
    expect(recommendedNextAction(school({ priority: "medium" }), config)).toMatch(/reminder/i);
    expect(recommendedNextAction(school({ priority: "low" }), config)).toMatch(/^Wait/);
  });

  it("names what is still missing for a school that is setting up", () => {
    const text = recommendedNextAction(
      school({ status: "setting_up", progress_pct: 40, milestones: { password_changed: true, classes: true } }),
      config,
    );
    expect(text).toContain("40%");
    expect(text).toContain("students added");
    expect(text).toContain("fee structure configured");
    expect(text).not.toContain("classes created");
  });

  it("needs no action when onboarding is complete", () => {
    expect(recommendedNextAction(school({ status: "complete" }), config)).toMatch(/No action needed/);
  });

  it("recommends re-engagement for inactive schools", () => {
    expect(recommendedNextAction(school({ status: "inactive" }), config)).toMatch(/re-engage/);
  });
});

describe("missingRequired", () => {
  it("ignores disabled and non-required milestones and keeps configured order", () => {
    const miss = missingRequired({ milestones: { password_changed: true } }, config);
    expect(miss.map((m) => m.key)).toEqual(["classes", "students", "fee_structures"]);
  });
});

describe("buildTimeline", () => {
  it("merges account, login, setup, follow-up, message and note events newest first", () => {
    const detail: SchoolDetail = {
      school: school({
        password_changed_at: "2026-10-02T08:00:00Z",
        first_login_at: "2026-10-03T08:00:00Z",
        status: "setting_up",
      }),
      milestone_config: config,
      logins: [{ occurred_at: "2026-10-03T08:00:00Z", person: "A Admin" }],
      followups: [{ id: "f1", created_at: "2026-10-04T08:00:00Z", rule_key: "password_pending_48h", kind: "alert", status: "open", resolved_at: null }],
      messages: [{ id: "m1", created_at: "2026-10-02T09:00:00Z", kind: "service", status: "sent", subject: "x", auto_rule: "password_reminder_email", queued_at: null, sent_at: "2026-10-02T09:30:00Z", error: null }],
      audit: [],
      notes: [{ id: "n1", created_at: "2026-10-05T08:00:00Z", kind: "call", note: "spoke", author: "Team" }],
      setup_activity: [
        { key: "students", n: 12, first_at: "2026-10-03T09:00:00Z", last_at: "2026-10-03T11:00:00Z" },
        { key: "classes", n: 0, first_at: null, last_at: null },
      ],
      registered_at: "2026-10-01T08:00:00Z",
    };
    const t = buildTimeline(detail);
    expect(t[0].label).toContain("Note");
    expect(t[t.length - 1].label).toBe("School registered");
    expect(t.map((e) => e.at)).toEqual([...t.map((e) => e.at)].sort().reverse());
    expect(t.some((e) => e.label === "Latest student added (12 in total)")).toBe(true);
    // A setup table with no rows contributes nothing.
    expect(t.some((e) => /class/.test(e.label))).toBe(false);
    expect(t.find((e) => e.group === "message")?.label).toBe("Email automatic: sent");
  });
});

describe("parseListParams", () => {
  it("falls back to no filter for anything unrecognised", () => {
    const p = parseListParams({ status: "drop table", activity: "x", from: "2026-13-45", to: "nope", sort: "random", page: "-3" });
    expect(p).toEqual({ status: null, activity: null, from: null, to: null, q: "", sort: "newest", page: 1 });
  });

  it("accepts valid values and trims the search", () => {
    const p = parseListParams({ status: "inactive", activity: "quiet", from: "2026-10-01", to: "2026-10-30", q: "  hope  ", sort: "lowest_progress", page: "3" });
    expect(p).toEqual({ status: "inactive", activity: "quiet", from: "2026-10-01", to: "2026-10-30", q: "hope", sort: "lowest_progress", page: 3 });
  });

  it("caps an over-long search", () => {
    expect(parseListParams({ q: "x".repeat(500) }).q).toHaveLength(100);
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseListParams({ status: ["complete", "inactive"] }).status).toBe("complete");
  });
});

describe("listHref", () => {
  it("omits defaults and round-trips", () => {
    expect(listHref({ sort: "newest", page: 1 })).toBe("/admin/onboarding");
    const href = listHref({ status: "inactive", sort: "longest_inactive", page: 2 });
    const parsed = parseListParams(Object.fromEntries(new URL(href, "https://x.test").searchParams));
    expect(parsed).toMatchObject({ status: "inactive", sort: "longest_inactive", page: 2 });
  });
});

describe("isManualRule", () => {
  it("only accepts the two email follow-ups", () => {
    expect(isManualRule("password_reminder_email")).toBe(true);
    expect(isManualRule("login_guidance_email")).toBe(true);
    expect(isManualRule("inactive_7d")).toBe(false);
  });
});
