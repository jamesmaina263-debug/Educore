import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { WIZARD_STEP_DEFS } from "@/app/(app)/admissions/wizard-steps";
import { CHECKLIST_STEP_BY_ITEM, canAttemptCompletion, readinessFrom, stepForChecklistItem } from "./completion-readiness";

describe("readinessFrom / canAttemptCompletion", () => {
  it("nothing missing -> ready, and completion is allowed", () => {
    const state = readinessFrom({ success: true, missing: [] });
    expect(state).toEqual({ kind: "ready" });
    expect(canAttemptCompletion(state)).toBe(true);
  });

  it("anything missing -> blocked, completion is NOT allowed, and the items are kept for display", () => {
    const missing = [{ item: "student", message: "Admission cannot be completed because the Student record has not been created yet." }, { item: "guardian", message: "No guardian linked." }];
    const state = readinessFrom({ success: true, missing });
    expect(state).toEqual({ kind: "blocked", missing });
    expect(canAttemptCompletion(state)).toBe(false);
  });

  it("a check that could not run does not lock the officer out (the server still enforces the rules)", () => {
    const state = readinessFrom({ error: "permission denied" });
    expect(state).toEqual({ kind: "unknown", error: "permission denied" });
    expect(canAttemptCompletion(state)).toBe(true);
  });

  it("while checking, completion is not allowed", () => {
    expect(canAttemptCompletion({ kind: "checking" })).toBe(false);
  });
});

describe("stepForChecklistItem", () => {
  it("sends each item to the step that fixes it", () => {
    expect(stepForChecklistItem("student")).toBe("student");
    expect(stepForChecklistItem("guardian")).toBe("guardian");
    expect(stepForChecklistItem("walk_in_screening")).toBe("admission_details");
    expect(stepForChecklistItem("health")).toBe("health");
  });
  it("falls back to the Student step for an unknown item rather than crashing", () => {
    expect(stepForChecklistItem("something_new")).toBe("student");
  });
});

// Drift guard: the checklist lives in SQL. If a migration adds an item the screen doesn't know about, its
// "Fix" button would silently send people to the wrong step (this is how 'health' was missed).
describe("checklist items stay in step with the SQL function", () => {
  const dir = path.resolve(__dirname, "../../../supabase/migrations");
  const latest = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => /function (public\.)?check_admission_checklist/i.test(readFileSync(path.join(dir, f), "utf8")));
  const sql = latest ? readFileSync(path.join(dir, latest), "utf8") : "";
  const body = sql.slice(sql.search(/function (public\.)?check_admission_checklist/i));
  const items = [...new Set([...body.matchAll(/return query select '([a-z_]+)'/g)].map((m) => m[1]))];

  it("found the checklist and its items", () => {
    expect(latest).toBeTruthy();
    expect(items.length).toBeGreaterThanOrEqual(8);
  });

  it("every item the database can report maps to a real wizard step", () => {
    const stepIds = new Set(WIZARD_STEP_DEFS.map((s) => s.id));
    for (const item of items) {
      expect(CHECKLIST_STEP_BY_ITEM[item], `no step mapped for checklist item "${item}"`).toBeTruthy();
      expect(stepIds.has(CHECKLIST_STEP_BY_ITEM[item]), `item "${item}" maps to unknown step "${CHECKLIST_STEP_BY_ITEM[item]}"`).toBe(true);
    }
  });
});
