import { describe, it, expect } from "vitest";
import { escapeHtml, firstName, personalize, renderCampaignEmail } from "../../supabase/functions/_shared/campaignEmail";

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
