import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { firstValidEmail, firstValidPhone, parseProspectCsv } from "./prospects";
import { xlsxBufferToCsv } from "./spreadsheet";

async function workbook(rows: unknown[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("School Contacts");
  rows.forEach((r) => ws.addRow(r));
  const out = await wb.xlsx.writeBuffer();
  return out as ArrayBuffer;
}

describe("multi-value cells", () => {
  it("takes the first valid email", () => {
    expect(firstValidEmail("info@a.ac.ke; admin@a.ac.ke")).toBe("info@a.ac.ke");
    expect(firstValidEmail("nope; Real@School.com")).toBe("real@school.com");
    expect(firstValidEmail("nope")).toBeNull();
  });
  it("takes the first valid phone and handles (+254) formatting", () => {
    expect(firstValidPhone("(+254) 713734477; (+254) 733177333")).toBe("+254713734477");
    expect(firstValidPhone("0712 345 678")).toBe("0712345678");
    expect(firstValidPhone("n/a")).toBeNull();
  });
});

describe("xlsxBufferToCsv -> parseProspectCsv", () => {
  it("imports a County/School name/Email/Website/Phone sheet", async () => {
    const buf = await workbook([
      ["County", "School name", "Email", "Website", "Phone"],
      ["Mombasa", "Alpha Academy", "info@alpha.test; b@alpha.test", { text: "alpha.test", hyperlink: "https://alpha.test/" }, "(+254) 713734477; (+254) 733177333"],
      ["Kwale", 'Beta "Junior" School, Kwale', "beta@gmail.test", null, null],
      [null, null, null, null, null],
    ]);
    const csv = await xlsxBufferToCsv(buf);
    const r = parseProspectCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rows).toHaveLength(2);
    expect(r.value.rows[0]).toMatchObject({
      school_name: "Alpha Academy",
      town_county: "Mombasa",
      email: "info@alpha.test",
      phone: "+254713734477",
      website: "https://alpha.test",
    });
    expect(r.value.rows[1]).toMatchObject({ school_name: 'Beta "Junior" School, Kwale', email: "beta@gmail.test", phone: null });
    expect(r.value.warnings).toEqual([]);
  });
});
