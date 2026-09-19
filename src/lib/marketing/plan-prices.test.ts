import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The pricing page publishes a flat per-student rate ("From KES 100"), but
// invoices are generated from subscription_plans.price_per_student_kes in the
// database. That gap went unnoticed once (site said 100, DB still said
// 150/200/250). This fails if the published rate changes without a migration
// that brings the plans table in line with it.
describe("published plan price matches the database migrations", () => {
  const root = process.cwd();

  const pricingSource = readFileSync(
    join(root, "src/app/(marketing)/pricing/page.tsx"),
    "utf8",
  );
  const published = /const PRICE_LINE = "From KES (\d+)"/.exec(pricingSource)?.[1];

  it("finds the published rate", () => {
    expect(published).toBeDefined();
  });

  it("has a migration setting every plan to the published rate", () => {
    const dir = join(root, "supabase/migrations");
    const alignment = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter(
        (sql) =>
          /update\s+public\.subscription_plans/i.test(sql) &&
          new RegExp(`price_per_student_kes\\s*=\\s*${published}\\b`).test(sql),
      );
    expect(alignment.length).toBeGreaterThan(0);
    const sql = alignment[alignment.length - 1];
    for (const code of ["starter", "growth", "enterprise"]) {
      expect(sql).toContain(`'${code}'`);
    }
  });
});
