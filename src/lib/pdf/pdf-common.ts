import type { jsPDF } from "jspdf";

// Pieces shared by the school-branded report PDFs (class mark sheet, merit list): the letterhead and
// the "Page X of Y" footer. Pure layout helpers over a jsPDF document; no data access.

export interface LoadedLogo {
  dataUrl: string;
  width: number;
  height: number;
}

export interface PdfSchoolHeader {
  name: string;
  motto: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  primaryColor: string | null;
}

export const NAVY: [number, number, number] = [30, 41, 59];
export const GOLD: [number, number, number] = [202, 138, 4];
export const MARGIN = 12;

export function hexToRgb(hex: string | null): [number, number, number] {
  const m = hex?.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return NAVY;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Draws the school letterhead (logo, name, motto, contacts, brand rule + gold rule). Returns the y of the rule. */
export function drawSchoolHeader(doc: jsPDF, school: PdfSchoolHeader, logo: LoadedLogo | null): number {
  const pageW = doc.internal.pageSize.getWidth();
  const accent = hexToRgb(school.primaryColor);
  let textX = MARGIN;
  if (logo) {
    const logoH = 18;
    const logoW = Math.min(36, (logo.width / logo.height) * logoH);
    try {
      doc.addImage(logo.dataUrl, "PNG", MARGIN, 9, logoW, logoH);
      textX = MARGIN + logoW + 4;
    } catch {
      // Embedding failed; carry on with a logo-less header.
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...accent);
  doc.text(school.name, textX, 15);
  let hy = 15;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90);
  if (school.motto) {
    hy += 4.5;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.text(school.motto, textX, hy);
    doc.setFont("helvetica", "normal");
  }
  const contact = [school.address, school.phone, school.email].filter(Boolean).join("  ·  ");
  if (contact) {
    hy += 4.5;
    doc.setFontSize(8);
    doc.text(contact, textX, hy);
  }
  const ruleY = Math.max(hy + 4, 29);
  doc.setDrawColor(...accent);
  doc.setLineWidth(0.7);
  doc.line(MARGIN, ruleY, pageW - MARGIN, ruleY);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, ruleY + 1.2, pageW - MARGIN, ruleY + 1.2);
  return ruleY;
}

/** Writes the gold rule, a left caption and "Generated <date> · Page X of Y" on every page. Call after all content is drawn. */
export function drawPageFooters(doc: jsPDF, leftText: string, generatedAtIso: string) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, pageH - 12, pageW - MARGIN, pageH - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(90);
    doc.text(leftText, MARGIN, pageH - 8);
    doc.text(`Generated ${formatDate(generatedAtIso)}   ·   Page ${p} of ${pages}`, pageW - MARGIN, pageH - 8, { align: "right" });
  }
}

/** Prepared-by / verified-by style signature rows (Name, Signature, Date), two signatories across the page, starting at y. */
export function drawSignatureBlock(doc: jsPDF, y: number, fields: { label: string; value: string | null }[]) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setTextColor(0);
  doc.setFontSize(8.5);
  const colW = (pageW - 2 * MARGIN) / 2;
  fields.forEach((f, i) => {
    const x = MARGIN + i * colW;
    doc.setFont("helvetica", "bold");
    doc.text(f.label, x, y);
    doc.setFont("helvetica", "normal");
    const ly = y + 7;
    const seg = (colW - 6) / 3;
    ["Name:", "Signature:", "Date:"].forEach((lab, j) => {
      const sx = x + j * seg;
      doc.text(lab, sx, ly);
      doc.setDrawColor(120);
      doc.setLineWidth(0.2);
      const lx = sx + doc.getTextWidth(lab) + 1.5;
      doc.line(lx, ly + 1, sx + seg - 3, ly + 1);
      if (j === 0 && f.value) doc.text(doc.splitTextToSize(f.value, sx + seg - 3 - lx)[0] as string, lx + 0.5, ly - 0.5);
    });
  });
}
