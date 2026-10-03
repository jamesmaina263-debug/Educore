import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next-path";

describe("safeNextPath", () => {
  it("keeps legitimate same-app paths unchanged", () => {
    expect(safeNextPath("/reset-password")).toBe("/reset-password");
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/finance/fees?term=2#top")).toBe(
      "/finance/fees?term=2#top",
    );
  });

  it("falls back to /dashboard when missing or empty", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
  });

  it.each([
    "@evil.com",
    ".evil.com",
    "evil.com",
    "https://evil.com",
    "http://evil.com/x",
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "javascript:alert(1)",
    "/foo\\bar",
    "/foo\nbar",
    "/foo\tbar",
    " /foo",
  ])("rejects unsafe target %j", (bad) => {
    expect(safeNextPath(bad)).toBe("/dashboard");
  });

  it("honours a custom fallback", () => {
    expect(safeNextPath("//evil.com", "/login")).toBe("/login");
  });
});
