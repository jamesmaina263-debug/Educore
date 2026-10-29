import { describe, it, expect } from "vitest";
import {
  EDUCORE_SITE_URL,
  WELCOME_EMAIL_SUBJECT,
  WHATSAPP_SUPPORT_URL,
  renderSchoolWelcomeEmail,
} from "../../supabase/functions/_shared/schoolWelcomeEmail";

describe("school welcome email", () => {
  it("uses the agreed subject and WhatsApp link", () => {
    expect(WELCOME_EMAIL_SUBJECT).toBe("Welcome to EduCore Africa – We're Here to Support Your School!");
    expect(WHATSAPP_SUPPORT_URL).toBe("https://wa.me/254702904562");
    expect(renderSchoolWelcomeEmail({ schoolName: "Sunrise Academy" }).subject).toBe(WELCOME_EMAIL_SUBJECT);
  });

  it("addresses the school by its registered name in both the text and html parts", () => {
    const { text, html } = renderSchoolWelcomeEmail({ schoolName: "Sunrise Academy" });
    expect(text.startsWith("Dear Sunrise Academy Team,")).toBe(true);
    expect(html).toContain("Dear Sunrise Academy Team,");
  });

  it("falls back to a plain greeting when no school name is on file", () => {
    for (const schoolName of [undefined, null, "", "   "]) {
      const { text, html } = renderSchoolWelcomeEmail({ schoolName });
      expect(text.startsWith("Hello,")).toBe(true);
      expect(html).toContain("Hello,");
      expect(text).not.toContain("Dear  Team");
      expect(text).not.toContain("undefined");
    }
  });

  it("carries the WhatsApp link and the sign-off in every part", () => {
    const { text, html } = renderSchoolWelcomeEmail({ schoolName: "Sunrise Academy" });
    expect(text).toContain(`WhatsApp Support: ${WHATSAPP_SUPPORT_URL}`);
    expect(text.trim().endsWith(`Warm regards,\nThe EduCore Africa Team\n${EDUCORE_SITE_URL}`)).toBe(true);
    expect(html).toContain(`href="${WHATSAPP_SUPPORT_URL}"`);
    expect(html).toContain("Thank you for choosing EduCore Africa");
    expect(html).toContain("We look forward to growing with your school!");
  });

  it("is built to be responsive: viewport meta, fluid 600px container, tappable button", () => {
    const { html } = renderSchoolWelcomeEmail({ schoolName: "Sunrise Academy" });
    expect(html).toContain('name="viewport" content="width=device-width,initial-scale=1"');
    expect(html).toContain("max-width:600px");
    expect(html).toContain("padding:14px 28px");
  });

  it("escapes a hostile school name so it cannot inject markup or extra lines", () => {
    const { text, html } = renderSchoolWelcomeEmail({ schoolName: `<script>alert(1)</script>"&\r\nBcc: x@evil.test` });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(text.split("\n")[0]).toBe(`Dear <script>alert(1)</script>"& Bcc: x@evil.test Team,`);
  });

  it("caps an absurdly long school name", () => {
    const { text } = renderSchoolWelcomeEmail({ schoolName: "A".repeat(5000) });
    expect(text.split("\n")[0].length).toBeLessThan(230);
  });
});
