import { describe, expect, it } from "vitest";
import { assembleWhatsApp, outreachLink } from "./prospects";
import { TRACKED_DESTINATIONS, trackWhatsAppLinks, trackedDestinationUrl } from "./tracked-links";

const SITE = "https://www.educoreafrica.com";
const PID = "20000000-0000-4000-8000-000000000002";
const wa = (key: string) => `${SITE}/api/outreach-link/wa/${PID}/${key}`;

describe("trackedDestinationUrl", () => {
  it("defaults to the email link and can build the WhatsApp one, both identical to outreachLink()", () => {
    expect(trackedDestinationUrl("signup")).toBe(outreachLink("/signup", "email"));
    expect(trackedDestinationUrl("signup", "whatsapp")).toBe(outreachLink("/signup", "whatsapp"));
    expect(trackedDestinationUrl("home", "whatsapp")).toBe(outreachLink("", "whatsapp"));
  });
});

describe("trackWhatsAppLinks", () => {
  it("rewrites both links of a real WhatsApp draft and leaves nothing else changed", () => {
    const draft = assembleWhatsApp({ school_name: "Sunrise Academy", school_level: "primary" });
    expect(draft).toContain("utm_medium=whatsapp");
    const out = trackWhatsAppLinks(draft, PID, SITE);
    expect(out).not.toContain("utm_source=outreach");
    expect(out).toContain(wa("signup"));
    expect(out).toContain(wa("contact"));
    expect(out.replace(/https:\/\/www\.educoreafrica\.com\/api\/outreach-link\/wa\/\S+/g, "LINK")).toBe(
      draft.replace(/https:\/\/www\.educoreafrica\.com\/\S*utm_source=outreach\S*/g, "LINK"),
    );
  });

  it("covers a kindergarten and a children's home draft too", () => {
    for (const ctx of [{ school_name: "Little Stars Kindergarten", school_level: "kindergarten" }, { school_name: "Hope Children's Home" }]) {
      const out = trackWhatsAppLinks(assembleWhatsApp(ctx), PID, SITE);
      expect(out).not.toContain("utm_source=outreach");
      expect(out).toContain(wa("signup"));
    }
  });

  it("works with the default site url", () => {
    const out = trackWhatsAppLinks(assembleWhatsApp({ school_name: "X School" }), PID);
    expect(out).toContain(`/api/outreach-link/wa/${PID}/signup`);
  });

  it("does not touch email links, other origins, edited links or mismatched path/key", () => {
    const email = outreachLink("/signup", "email");
    const other = outreachLink("/signup", "whatsapp").replace(SITE, "https://example.com");
    const extra = `${outreachLink("/signup", "whatsapp")}&ref=1`;
    const mismatch = outreachLink("/contact", "whatsapp").replace("utm_content=contact", "utm_content=signup");
    for (const text of [email, other, extra, mismatch, "no links here"]) expect(trackWhatsAppLinks(text, PID, SITE)).toBe(text);
  });

  it("keeps sentence punctuation after a link", () => {
    expect(trackWhatsAppLinks(`Sign up: ${outreachLink("/signup", "whatsapp")}.`, PID, SITE)).toBe(`Sign up: ${wa("signup")}.`);
  });

  it("changes nothing without a valid prospect id or site", () => {
    const text = `Go: ${outreachLink("/signup", "whatsapp")}`;
    expect(trackWhatsAppLinks(text, "not-a-uuid", SITE)).toBe(text);
    expect(trackWhatsAppLinks(text, "", SITE)).toBe(text);
    expect(trackWhatsAppLinks(text, PID, "")).toBe(text);
  });

  it("covers every destination the route accepts", () => {
    for (const key of TRACKED_DESTINATIONS) {
      expect(trackWhatsAppLinks(trackedDestinationUrl(key, "whatsapp"), PID, SITE)).toBe(wa(key));
    }
  });
});
