import { existsSync, statSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { OUTREACH_LOGO_URL, escapeHtml, firstName, personalize, renderCampaignEmail, trackOutreachLinks } from "../../supabase/functions/_shared/campaignEmail";
import { assembleEmailBody } from "./outbound/prospects";

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

describe("trackOutreachLinks (per-school tracked links)", () => {
  const SITE = "https://www.educoreafrica.com";
  const RID = "10000000-0000-4000-8000-000000000001";
  const link = (path: string, key: string) =>
    `${SITE}${path}?utm_source=outreach&utm_medium=email&utm_campaign=school_outreach&utm_content=${key}`;
  const tracked = (key: string) => `${SITE}/api/outreach-link/${RID}/${key}`;

  it("rewrites every link of a real outreach draft and leaves no untracked outreach link behind", () => {
    const body = assembleEmailBody("Opening line.", { school_name: "Sunrise Academy", school_level: "primary" });
    expect(body).toContain("utm_source=outreach");
    const out = trackOutreachLinks(body, RID, SITE);
    expect(out).not.toContain("utm_source=outreach");
    for (const key of ["signup", "contact", "brochure", "home"]) expect(out).toContain(tracked(key));
    // Everything that is not one of those links is untouched.
    expect(out.replace(/https:\/\/www\.educoreafrica\.com\/api\/outreach-link\/\S+/g, "LINK")).toBe(
      body.replace(/https:\/\/www\.educoreafrica\.com\/\S*utm_source=outreach\S*/g, "LINK"),
    );
  });

  it("covers a children's home draft (no brochure line) too", () => {
    const out = trackOutreachLinks(assembleEmailBody("x", { school_name: "Hope Children's Home" }), RID, SITE);
    expect(out).not.toContain("utm_source=outreach");
    expect(out).not.toContain("/brochure");
  });

  it("keeps sentence punctuation after a link", () => {
    expect(trackOutreachLinks(`Sign up: ${link("/signup", "signup")}.`, RID, SITE)).toBe(`Sign up: ${tracked("signup")}.`);
  });

  it("leaves other links, other origins, edited links and mismatched path/key alone", () => {
    const other = "https://example.com/signup?utm_source=outreach&utm_medium=email&utm_campaign=school_outreach&utm_content=signup";
    const extra = `${link("/signup", "signup")}&ref=1`;
    const mismatch = link("/contact", "signup");
    const plain = `${SITE}/pricing and https://educoreafrica.com`;
    for (const body of [other, extra, mismatch, plain]) expect(trackOutreachLinks(body, RID, SITE)).toBe(body);
  });

  it("changes nothing without a valid recipient id or site", () => {
    const body = `Go: ${link("/signup", "signup")}`;
    expect(trackOutreachLinks(body, "not-a-uuid", SITE)).toBe(body);
    expect(trackOutreachLinks(body, "", SITE)).toBe(body);
    expect(trackOutreachLinks(body, RID, "")).toBe(body);
  });

  it("tolerates a trailing slash on the site url", () => {
    expect(trackOutreachLinks(link("/contact", "contact"), RID, `${SITE}/`)).toBe(tracked("contact"));
  });

  it("is what the tracked route expects: the key set matches the route's destinations", async () => {
    const { TRACKED_DESTINATIONS, trackedDestinationUrl } = await import("./outbound/tracked-links");
    for (const key of TRACKED_DESTINATIONS) {
      const out = trackOutreachLinks(trackedDestinationUrl(key), RID, SITE);
      expect(out).toBe(tracked(key));
    }
  });
});

describe("outreach email links read as labels, not long URLs", () => {
  const SITE = "https://www.educoreafrica.com";
  const RID = "10000000-0000-4000-8000-000000000001";
  const visible = (html: string) => html.replace(/<[^>]+>/g, "");
  const LABELLED = "color:#1a56db;text-decoration:underline;display:inline-block;padding:8px 0";
  const render = (body: string) => renderCampaignEmail({ body, unsubscribeUrl: `${SITE}/unsubscribe/x`, audience: "outreach", schoolName: "Sunrise Academy" });

  it("shows a real draft's links as clickable labels, with the tracked URL as the target and no URL in the visible text", () => {
    const draft = trackOutreachLinks(assembleEmailBody("Opening.", { school_name: "Sunrise Academy", school_level: "primary" }), RID, SITE);
    const { html, text } = render(draft);
    for (const [label, key] of [["Start your free trial", "signup"], ["Contact us", "contact"], ["Brochure", "brochure"]]) {
      expect(html).toContain(`<a href="${SITE}/api/outreach-link/${RID}/${key}" style="${LABELLED}">${label}</a>`);
    }
    // The sign-off link shows the site name and goes to the tracked home link.
    expect(html).toContain(`<a href="${SITE}/api/outreach-link/${RID}/home" style="color:#1a56db;text-decoration:underline">www.educoreafrica.com</a>`);
    expect(visible(html)).not.toContain("outreach-link");
    expect(visible(html)).not.toContain("http");
    // Plain text keeps every URL in full.
    expect(text).toContain(`${SITE}/api/outreach-link/${RID}/signup`);
    expect(text).toContain("Start your free trial: ");
  });

  it("gives each labelled link its own padding (tap target and spacing) but keeps the sign-off link tight", () => {
    const { html } = render(`Start your free trial: ${SITE}/signup\nContact us: ${SITE}/contact\n\nKind regards,\nEduCore Africa\n${SITE}/`);
    expect(html.match(/display:inline-block;padding:8px 0/g)).toHaveLength(2);
    expect(html).toContain(`style="color:#1a56db;text-decoration:underline">www.educoreafrica.com</a>`);
  });

  it("works on untracked links too (utm links keep working as the target)", () => {
    const draft = assembleEmailBody("Opening.", { school_name: "Sunrise Academy", school_level: "primary" });
    const { html } = render(draft);
    expect(html).toContain('>Start your free trial</a>');
    expect(visible(html)).not.toContain("utm_source");
  });

  it("escapes labels and targets, and leaves other lines, other sites and sentence-ending links as text", () => {
    const { html } = render(`A <b>bold</b> claim: ${SITE}/signup?a=1&b=2\nSee https://example.com/x for more\nVisit ${SITE}/signup.\nHello: https://evil.example/phish`);
    expect(html).toContain(`<a href="${SITE}/signup?a=1&amp;b=2" style="${LABELLED}">A &lt;b&gt;bold&lt;/b&gt; claim</a>`);
    expect(html).toContain("See https://example.com/x for more");
    expect(html).toContain(`Visit ${SITE}/signup.`);
    expect(html).not.toContain('href="https://evil.example');
    expect(html).not.toContain("<b>");
  });

  it("never turns a label containing a link, or a javascript: target, into an anchor", () => {
    const { html } = render(`Go to https://www.educoreafrica.com now: ${SITE}/signup\njavascript:alert(1)\nTry: javascript:alert(1)`);
    expect(html).not.toContain('href="javascript');
    expect(html).not.toMatch(/<a href="[^"]*"[^>]*>Go to/);
  });

  it("does not change owner or prospect emails at all", () => {
    for (const audience of ["owners", "prospects"] as const) {
      const { html } = renderCampaignEmail({ body: `Start your free trial: ${SITE}/signup`, unsubscribeUrl: "u", audience });
      expect(html).toContain(`Start your free trial: ${SITE}/signup</p>`);
      expect(html).not.toContain("color:#1a56db");
    }
  });
});
