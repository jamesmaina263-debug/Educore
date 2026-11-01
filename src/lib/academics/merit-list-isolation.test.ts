import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The merit list must stay a pure view over the mark sheet model: positions come from the stored
// class_rankings via that model, and there is no second query path or calculation to drift from the
// mark sheet. It must also leave the shared export menu untouched for every other page.
const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("merit list is a read-only view over the mark sheet model", () => {
  it.each(["src/lib/academics/merit-list.ts", "src/lib/pdf/merit-list-pdf.ts", "src/components/exams/class-exports-menu.tsx"])("%s has no database access of its own", (file) => {
    const code = strip(read(file));
    expect(code).not.toMatch(/supabase|\.from\(|\.rpc\(|class_rankings|createClient/);
  });

  it("does not recompute ranks: positions are taken from the model's stored values", () => {
    const code = strip(read("src/lib/academics/merit-list.ts"));
    expect(code).toMatch(/rankInClass/);
    expect(code).not.toMatch(/rank\(\)|\.sort\([^)]*average[^)]*\)\s*\.map\(\(.*index/);
  });

  it("introduces no migration and no new table", () => {
    const code = strip(read("src/lib/academics/merit-list.ts") + read("src/lib/pdf/merit-list-pdf.ts"));
    expect(code).not.toMatch(/create\s+table|alter\s+table/i);
  });
});

describe("shared export menu stays the same for other pages", () => {
  it("defaults the button text to Export and only the report-card exports override it", () => {
    expect(read("src/components/shared/table-export-menu.tsx")).toContain('{label ?? "Export"}');
    for (const file of ["src/components/finance/invoices-section.tsx", "src/components/payroll/payroll-section.tsx", "src/components/boarding/reports-section.tsx", "src/components/health/reports-section.tsx"]) {
      const menus = read(file).match(/<TableExportMenu[\s\S]*?\/>/g) ?? [];
      expect(menus.length).toBeGreaterThan(0);
      for (const tag of menus) expect(tag).not.toMatch(/\blabel=/);
    }
    // The class exports (mark sheet + merit list) now load their data on demand in their own menu, so they no longer use TableExportMenu or its label prop.
    expect(read("src/components/exams/class-exports-menu.tsx")).toContain("Mark sheet");
  });
});
