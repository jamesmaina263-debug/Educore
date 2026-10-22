import { existsSync, statSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { OUTREACH_LOGO_URL, escapeHtml, firstName, personalize, renderCampaignEmail } from "../../supabase/functions/_shared/campaignEmail";

const base = { schoolName: "Tetu Bygrace Academy", unsubscribeUrl: "https://www.educoreafrica.com/unsubscribe/abc" };

describe("campaign email rendering", () => {
  it("escapes html so a body can never inject markup", () => {
    expect(escapeHtml(`<script>alert("x")</script>&'`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;");
    const { html } = renderCampaignEmail({ ...base, body: "<img src=x onerror=1>" });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("personalizes name and school, falling back to 'there'", () => {
    expect(personalize("Hi {{name}} at {{ school }}", { recipientName: "Anne Kahiro", schoolName: "Tetu" })).toBe("Hi Anne at Tetu");
    expect(personalize("Hi {{name}}", { recipientName: null, schoolName: "Tetu" })).toBe("Hi there");
    expect(firstName("  Wangui  M ")).toBe("Wangui");
  });

  it("always includes the unsubscribe link in both text and html", () => {
    const { text, html } = renderCampaignEmail({ ...base, body: "Hello" });
    expect(text).toContain(base.unsubscribeUrl);
    expect(html).toContain(`href="${base.unsubscribeUrl}"`);
    expect(text).toContain("owner of Tetu Bygrace Academy");
  });

  it("turns blank lines into paragraphs and single newlines into <br>", () => {
    const { html } = renderCampaignEmail({ ...base, body: "One\nTwo\n\nThree" });
    expect(html).toContain("<p style=\"margin:0 0 14px\">One<br>Two</p>");
    expect(html).toContain(">Three</p>");
  });

  it("uses a prospect footer and falls back to 'your school' when no school is known", () => {
    const { text, html } = renderCampaignEmail({
      body: "Hi {{name}}, a walkthrough for {{school}}?",
      recipientName: null,
      schoolName: null,
      unsubscribeUrl: base.unsubscribeUrl,
      audience: "prospects",
    });
    expect(text).toContain("Hi there, a walkthrough for your school?");
    expect(text).toContain("you asked about EduCore on our website");
    expect(text).not.toContain("owner of");
    expect(text).toContain(base.unsubscribeUrl);
    expect(html).toContain(`href="${base.unsubscribeUrl}"`);
  });

  it("keeps the school-owner footer when no audience is given", () => {
    const { text } = renderCampaignEmail({ ...base, body: "Hello" });
    expect(text).toContain("you're the owner of Tetu Bygrace Academy");
  });
});

describe("outreach audience footer", () => {
  it("explains why a school is being emailed (not 'you asked on our website') and keeps the unsubscribe link", () => {
    const { text, html } = renderCampaignEmail({
      body: "Hello {{name}}, about {{school}}.",
      recipientName: "Jane Doe",
      schoolName: "Sunrise Academy",
      unsubscribeUrl: "https://example.com/unsubscribe/abc",
      audience: "outreach",
    });
    expect(text).toContain("Hello Jane, about Sunrise Academy.");
    expect(text).toContain("publicly listed");
    expect(text).not.toContain("asked about EduCore on our website");
    expect(text).toContain("Unsubscribe: https://example.com/unsubscribe/abc");
    expect(html).toContain("Unsubscribe");
  });
});

describe("outreach signature logo", () => {
  const outreach = {
    recipientName: "Mary",
    schoolName: "Sunrise Academy",
    unsubscribeUrl: "https://example.com/unsubscribe/abc",
    audience: "outreach" as const,
  };
  const body = "Hello Mary,\n\nA short pitch.\n\nKind regards,\nEduCore Africa\nhttps://www.educoreafrica.com/\n\nIf you would rather not hear from us, just reply and we will not contact you again.";

  it("puts one small, sized, alt-texted logo right after the sign-off and before the opt-out line", () => {
    const { html } = renderCampaignEmail({ ...outreach, body });
    expect(html.split("<img").length - 1).toBe(1);
    expect(html).toContain(`src="${OUTREACH_LOGO_URL}"`);
    expect(html).toContain('width="156" height="50" alt="EduCore Africa"');
    const logo = html.indexOf("<img");
    expect(html.indexOf("Kind regards")).toBeLessThan(logo);
    expect(logo).toBeLessThan(html.indexOf("If you would rather not hear from us"));
  });

  it("falls back to the end of the message when the sign-off was edited away", () => {
    const { html } = renderCampaignEmail({ ...outreach, body: "Hello Mary,\n\nJust a note." });
    expect(html.split("<img").length - 1).toBe(1);
    expect(html.indexOf("Just a note.")).toBeLessThan(html.indexOf("<img"));
  });

  it("never adds the logo to the plain-text part", () => {
    const { text } = renderCampaignEmail({ ...outreach, body });
    expect(text).not.toContain("educore-logo-email");
    expect(text).not.toContain("<img");
  });

  it("leaves owner and prospect emails exactly as before (no logo)", () => {
    for (const audience of [undefined, "owners", "prospects"] as const) {
      const { html } = renderCampaignEmail({ ...outreach, audience, body });
      expect(html, String(audience)).not.toContain("<img");
    }
  });

  it("still escapes a body that tries to inject an image", () => {
    const { html } = renderCampaignEmail({ ...outreach, body: "Hi\n\n<img src=x onerror=1>\n\nKind regards,\nEduCore Africa" });
    expect(html).toContain("&lt;img src=x");
    expect(html.split("<img").length - 1).toBe(1); // only ours
  });

  it("points at a logo file that exists in public/ and is small enough for email", () => {
    const file = path.join(process.cwd(), "public", "email", "educore-logo-email.png");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThan(25_000);
  });
});
