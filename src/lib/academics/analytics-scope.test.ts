import { describe, expect, it } from "vitest";
import { resolveAnalyticsScope } from "./analytics-scope";

describe("resolveAnalyticsScope", () => {
  it("gives Principal / Owner (ai.read) the whole school", () => {
    expect(resolveAnalyticsScope({ aiRead: true, writeAny: true, examsRead: true }, [])).toEqual({ level: "school" });
  });

  it("gives Deputy Principal (marks.write_any, no ai.read) the whole school", () => {
    expect(resolveAnalyticsScope({ aiRead: false, writeAny: true, examsRead: true }, [])).toEqual({ level: "school" });
  });

  it("keeps a teacher (exams.read only) to their own classes, deduplicated", () => {
    expect(resolveAnalyticsScope({ aiRead: false, writeAny: false, examsRead: true }, ["c1", "c2", "c1"])).toEqual({ level: "classes", classIds: ["c1", "c2"] });
  });

  it("never widens a teacher with no classes to the whole school", () => {
    expect(resolveAnalyticsScope({ aiRead: false, writeAny: false, examsRead: true }, [])).toEqual({ level: "classes", classIds: [] });
  });

  it("gives someone without exams.read nothing", () => {
    expect(resolveAnalyticsScope({ aiRead: false, writeAny: false, examsRead: false }, ["c1"])).toEqual({ level: "none" });
  });
});
