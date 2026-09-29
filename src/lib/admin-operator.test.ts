import { describe, expect, it } from "vitest";
import { ADMIN_OPERATORS, isAdminOperator, operatorRequiresOtp, safeAdminNextPath } from "./admin-operator";

describe("isAdminOperator", () => {
  it("accepts every configured operator", () => {
    for (const name of ADMIN_OPERATORS) expect(isAdminOperator(name)).toBe(true);
  });
  it("rejects anything else, including case variants and non-strings", () => {
    expect(isAdminOperator("ben")).toBe(false);
    expect(isAdminOperator("Mallory")).toBe(false);
    expect(isAdminOperator("")).toBe(false);
    expect(isAdminOperator(undefined)).toBe(false);
    expect(isAdminOperator(null)).toBe(false);
    expect(isAdminOperator(42)).toBe(false);
  });
});

describe("safeAdminNextPath", () => {
  it("keeps genuine admin paths", () => {
    expect(safeAdminNextPath("/admin")).toBe("/admin");
    expect(safeAdminNextPath("/admin/billing")).toBe("/admin/billing");
    expect(safeAdminNextPath("/admin/leads?stage=new")).toBe("/admin/leads?stage=new");
  });
  it("falls back to /admin for anything that could leave the console", () => {
    expect(safeAdminNextPath(undefined)).toBe("/admin");
    expect(safeAdminNextPath("https://evil.example")).toBe("/admin");
    expect(safeAdminNextPath("//evil.example")).toBe("/admin");
    expect(safeAdminNextPath("/dashboard")).toBe("/admin");
    expect(safeAdminNextPath("/admin/../dashboard\\x")).toBe("/admin");
    expect(safeAdminNextPath("/admin?u=https://evil.example")).toBe("/admin");
  });
  it("never bounces back to the picker itself", () => {
    expect(safeAdminNextPath("/admin/who")).toBe("/admin");
  });
});

describe("operatorRequiresOtp", () => {
  it("exempts only James from the emailed code", () => {
    expect(operatorRequiresOtp("James")).toBe(false);
    expect(operatorRequiresOtp("Ben")).toBe(true);
    expect(operatorRequiresOtp("Boniface")).toBe(true);
  });

  it("keeps the exemption to exactly one of the configured operators", () => {
    const exempt = ADMIN_OPERATORS.filter((name) => !operatorRequiresOtp(name));
    expect(exempt).toEqual(["James"]);
  });
});
