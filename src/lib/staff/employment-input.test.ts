import { describe, it, expect } from "vitest";
import { buildEmploymentUpdate } from "./employment-input";

describe("buildEmploymentUpdate", () => {
  it("stores a cleared date field as null instead of an empty string Postgres would reject", () => {
    const result = buildEmploymentUpdate({ hire_date: "2020-01-10", contract_end_date: "", contract_type: "permanent" });
    expect(result).toEqual({ payload: { hire_date: "2020-01-10", contract_end_date: null, contract_type: "permanent" } });
  });

  it("trims text fields and turns blank ones into null", () => {
    const result = buildEmploymentUpdate({ position: "  Deputy Head  ", department: "   " });
    expect(result).toEqual({ payload: { position: "Deputy Head", department: null } });
  });

  it("leaves absent fields out so they stay untouched", () => {
    const result = buildEmploymentUpdate({ position: "Teacher" });
    expect(result).toEqual({ payload: { position: "Teacher" } });
    expect("payload" in result && "gender" in result.payload).toBe(false);
  });

  it("only ever forwards the six employment fields, dropping anything else", () => {
    const sneaky = { position: "Teacher", role_id: "some-role", status: "active" } as unknown as Parameters<typeof buildEmploymentUpdate>[0];
    const result = buildEmploymentUpdate(sneaky);
    expect(result).toEqual({ payload: { position: "Teacher" } });
  });

  it("rejects a contract end date before the hire date", () => {
    const result = buildEmploymentUpdate({ hire_date: "2024-06-01", contract_end_date: "2024-01-01" });
    expect(result).toEqual({ error: "The contract end date can't be before the hire date." });
  });

  it("accepts an end date equal to the hire date and either date alone", () => {
    expect(buildEmploymentUpdate({ hire_date: "2024-06-01", contract_end_date: "2024-06-01" })).toHaveProperty("payload");
    expect(buildEmploymentUpdate({ contract_end_date: "2020-01-01" })).toHaveProperty("payload");
  });

  it("passes explicit nulls for contract type and gender through", () => {
    expect(buildEmploymentUpdate({ contract_type: null, gender: null })).toEqual({ payload: { contract_type: null, gender: null } });
  });
});
