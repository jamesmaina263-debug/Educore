import { describe, it, expect } from "vitest";
import { extractPdfText } from "./extract-text";

// Deliberately UNMOCKED: exercises the real PDF library so an import-time
// failure (as happened with pdf-parse's ENOENT debug block) fails CI.
function buildPdf(text: string): Uint8Array {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 18 Tf 20 50 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe("extractPdfText (real library, no mocks)", () => {
  it("extracts the text layer of a real PDF", async () => {
    const text = await extractPdfText(buildPdf("Strand Numbers Whole Numbers"));
    expect(text).toContain("Strand Numbers Whole Numbers");
  });

  it("accepts an ArrayBuffer as well as a Uint8Array", async () => {
    const bytes = buildPdf("Hello KICD");
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    expect(await extractPdfText(ab)).toContain("Hello KICD");
  });

  it("throws on a corrupt / non-PDF file so callers can show their error", async () => {
    await expect(extractPdfText(new TextEncoder().encode("this is not a pdf"))).rejects.toThrow();
  });
});
