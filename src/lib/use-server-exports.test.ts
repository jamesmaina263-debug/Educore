import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A file marked "use server" may only export async functions (types are erased and fine).
// Anything else -- a const, class, default value, sync function -- throws at runtime in
// production ("A "use server" file can only export async functions") and breaks every server
// action bundled alongside it. It slipped through type-check, lint and build once already.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('"use server" modules', () => {
  it("export only async functions", () => {
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), "src"))) {
      const src = readFileSync(file, "utf8");
      if (!/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(src)) continue;
      for (const [i, line] of src.split("\n").entries()) {
        if (/^export\s+(const|let|var|class|default|enum)\b/.test(line) || /^export\s+function\b/.test(line) || /^export\s*\{/.test(line)) {
          offenders.push(`${file.replace(process.cwd() + "/", "")}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
