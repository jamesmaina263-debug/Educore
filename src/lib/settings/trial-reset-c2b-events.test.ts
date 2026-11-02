import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guards the latest definition of reset_trial_school_data: the fees group must clear C2B events, and must
// delete them before payments (children first) because inbound_payment_events references payments.
const sql = readFileSync(
  "supabase/migrations/20261102060000_trial_reset_clears_c2b_events.sql",
  "utf8",
);

describe("reset_trial_school_data fees group", () => {
  const m = sql.match(/c_fees constant text\[\] := array\[([\s\S]*?)\];/);
  const tables = (m?.[1] ?? "").match(/'([a-z_]+)'/g)?.map((s) => s.replace(/'/g, "")) ?? [];

  it("includes inbound_payment_events", () => {
    expect(tables).toContain("inbound_payment_events");
  });
  it("deletes C2B events before payments and invoices", () => {
    const e = tables.indexOf("inbound_payment_events");
    expect(e).toBeGreaterThanOrEqual(0);
    expect(e).toBeLessThan(tables.indexOf("payments"));
    expect(e).toBeLessThan(tables.indexOf("invoices"));
  });
  it("keeps the C2B registration and credentials out of every group", () => {
    expect(tables).not.toContain("mpesa_c2b_config");
    expect(sql).not.toMatch(/delete from public\.mpesa_c2b_config/);
  });
  it("stays service_role only", () => {
    expect(sql).toMatch(/revoke all on function public\.reset_trial_school_data\(uuid, uuid, text\[\], text, boolean\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.reset_trial_school_data\(uuid, uuid, text\[\], text, boolean\) to service_role;/);
  });
});
