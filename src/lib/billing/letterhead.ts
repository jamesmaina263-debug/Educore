import "server-only";
import type { jsPDF } from "jspdf";
import { BRAND, COMPANY } from "./company";
import { INTER_BOLD_TTF_BASE64, INTER_REGULAR_TTF_BASE64, INTER_SEMIBOLD_TTF_BASE64, PLEX_MONO_MEDIUM_TTF_BASE64 } from "./pdf-assets/fonts";
import { LOGO_ASPECT, LOGO_PNG_BASE64 } from "./pdf-assets/logo";

// EduCore official letterhead, drawn natively (vector text + the official logo image) so documents
// stay selectable/searchable and print crisply. Geometry is in millimetres on A4 (210 x 297),
// 22 mm side margins, nothing within 10 mm of the paper edge so office printers don't clip it.

export const PAGE = { width: 210, height: 297, marginX: 22 } as const;
export const CONTENT_RIGHT = PAGE.width - PAGE.marginX; // 188
export const CONTENT_WIDTH = CONTENT_RIGHT - PAGE.marginX; // 166
/** First usable y below the full / compact header. */
export const BODY_TOP = { full: 47, compact: 32 } as const;
/** Lowest y body content may reach (footer rule is at 277). */
export const BODY_BOTTOM = 268;

export const FONT = { sans: "Inter", semibold: "InterSemi", mono: "PlexMono" } as const;

export function registerBrandFonts(doc: jsPDF): void {
  doc.addFileToVFS("Inter-Regular.ttf", INTER_REGULAR_TTF_BASE64);
  doc.addFont("Inter-Regular.ttf", FONT.sans, "normal");
  doc.addFileToVFS("Inter-SemiBold.ttf", INTER_SEMIBOLD_TTF_BASE64);
  doc.addFont("Inter-SemiBold.ttf", FONT.semibold, "normal");
  doc.addFileToVFS("Inter-Bold.ttf", INTER_BOLD_TTF_BASE64);
  doc.addFont("Inter-Bold.ttf", FONT.sans, "bold");
  doc.addFileToVFS("PlexMono-Medium.ttf", PLEX_MONO_MEDIUM_TTF_BASE64);
  doc.addFont("PlexMono-Medium.ttf", FONT.mono, "normal");
}

type TextStyle = {
  font: string;
  weight?: "normal" | "bold";
  size: number;
  color: string;
  /** Letter spacing in points (tracking), as used on the site's mono eyebrow labels. */
  track?: number;
};

export function setStyle(doc: jsPDF, s: TextStyle): void {
  doc.setFont(s.font, s.weight ?? "normal");
  doc.setFontSize(s.size);
  doc.setTextColor(s.color);
}

/** Rendered width in mm of `str` in style `s`, including tracking. */
export function textWidth(doc: jsPDF, str: string, s: TextStyle): number {
  setStyle(doc, s);
  const ptToMm = 25.4 / 72;
  return doc.getTextWidth(str) + (s.track ?? 0) * ptToMm * Math.max(str.length - 1, 0);
}

/** Text with optional tracking; right/center alignment accounts for the added spacing. */
export function text(doc: jsPDF, str: string, x: number, y: number, s: TextStyle, align: "left" | "right" | "center" = "left"): number {
  setStyle(doc, s);
  const track = s.track ?? 0;
  const ptToMm = 25.4 / 72;
  const width = doc.getTextWidth(str) + track * ptToMm * Math.max(str.length - 1, 0);
  const left = align === "left" ? x : align === "right" ? x - width : x - width / 2;
  // jsPDF's charSpace is in document units (mm here), while our tracking is specified in points.
  doc.text(str, left, y, track ? { charSpace: track * ptToMm } : undefined);
  return width;
}

const LABEL: TextStyle = { font: FONT.mono, size: 5.6, color: BRAND.ink50, track: 0.9 };

export function labelStyle(overrides: Partial<TextStyle> = {}): TextStyle {
  return { ...LABEL, ...overrides };
}

function accentRule(doc: jsPDF, y: number): void {
  doc.setFillColor(BRAND.navy900);
  doc.rect(PAGE.marginX, y - 0.45, 24, 0.45, "F");
  doc.setDrawColor(BRAND.gold500);
  doc.setLineWidth(0.1764); // 0.5pt hairline
  doc.line(PAGE.marginX, y, CONTENT_RIGHT, y);
}

function logo(doc: jsPDF, x: number, y: number, widthMm: number): void {
  doc.addImage(`data:image/png;base64,${LOGO_PNG_BASE64}`, "PNG", x, y, widthMm, widthMm / LOGO_ASPECT, undefined, "FAST");
}

/** Draws the letterhead header. Returns the first y available for body content. */
export function drawHeader(doc: jsPDF, variant: "full" | "compact", pageLabel?: string): number {
  if (variant === "compact") {
    logo(doc, PAGE.marginX, 10, 34);
    if (pageLabel) text(doc, pageLabel.toUpperCase(), CONTENT_RIGHT, 14.4, labelStyle({ size: 6.2 }), "right");
    accentRule(doc, 24);
    return BODY_TOP.compact;
  }

  logo(doc, PAGE.marginX, 12, 54);

  text(doc, COMPANY.tradingName.toUpperCase(), CONTENT_RIGHT, 15.6, { font: FONT.semibold, size: 8.6, color: BRAND.navy900, track: 0.35 }, "right");
  const rows: { label: string; value: string; url: string }[] = [
    { label: "WEB", value: COMPANY.website.label, url: COMPANY.website.url },
    { label: "EMAIL", value: COMPANY.email.label, url: COMPANY.email.url },
    { label: "WHATSAPP", value: COMPANY.whatsapp.label, url: COMPANY.whatsapp.url },
  ];
  const valueStyle: TextStyle = { font: FONT.sans, size: 7.6, color: BRAND.navy900 };
  setStyle(doc, valueStyle);
  const widest = Math.max(...rows.map((r) => doc.getTextWidth(r.value)));
  const labelRight = CONTENT_RIGHT - widest - 3;
  rows.forEach((r, i) => {
    const y = 21.4 + i * 4.1;
    text(doc, r.label, labelRight, y, labelStyle(), "right");
    const w = text(doc, r.value, CONTENT_RIGHT, y, valueStyle, "right");
    doc.link(CONTENT_RIGHT - w, y - 2.6, w, 3.4, { url: r.url });
  });

  accentRule(doc, 35);
  return BODY_TOP.full;
}

/** Draws the (deliberately small) footer: registered entity, address and tagline. */
export function drawFooter(doc: jsPDF): void {
  accentRule(doc, 277);
  text(doc, `${COMPANY.legalName}  ·  Reg. No. ${COMPANY.registrationNo}`, PAGE.marginX, 281.4, { font: FONT.semibold, size: 6.5, color: BRAND.navy900 });
  text(doc, COMPANY.address, PAGE.marginX, 284.8, { font: FONT.sans, size: 6.5, color: BRAND.ink70 });
  text(doc, COMPANY.tagline, CONTENT_RIGHT, 281.4, { font: FONT.sans, size: 6.5, color: BRAND.ink70 }, "right");
}
