import { describe, expect, it } from "vitest";
import {
  buildEnrichmentPrompt,
  extractContactsFromHtml,
  htmlToText,
  isSafePublicUrl,
  nameMatchesPage,
  pageContainsEmail,
  pageContainsName,
  pageContainsPhone,
  parseEnrichmentResponse,
  pickBestEmail,
  verifyFoundContacts,
  type FoundContacts,
} from "./enrichment";

describe("isSafePublicUrl (SSRF guard)", () => {
  it("allows ordinary public sites", () => {
    expect(isSafePublicUrl("https://sunrise.ac.ke/contact")).toBe(true);
    expect(isSafePublicUrl("http://www.school.co.ke")).toBe(true);
    expect(isSafePublicUrl("https://www.facebook.com/sunriseacademy")).toBe(true);
  });
  it("blocks internal and unsafe targets", () => {
    for (const u of [
      "http://localhost/admin",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.5/",
      "http://[::1]/",
      "http://intranet/",
      "http://printer.local/",
      "https://user:pass@school.ac.ke/",
      "https://school.ac.ke:8443/",
      "ftp://school.ac.ke/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isSafePublicUrl(u), u).toBe(false);
    }
  });
});

describe("extractContactsFromHtml", () => {
  const html = `
    <a href="mailto:Admin@Sunrise.ac.ke?subject=Hi">Email us</a>
    <a href="tel:+254712345678">Call</a>
    <p>Office: 0722 111 222 &middot; info@sunrise.ac.ke</p>
    <img src="logo@2x.png"><p>you@example.com</p>
    <script>var x = "hidden@tracker.sentry.io 0700000000"</script>`;
  it("pulls links first, then text, and drops junk", () => {
    const r = extractContactsFromHtml(html);
    expect(r.emails).toEqual(["admin@sunrise.ac.ke", "info@sunrise.ac.ke"]);
    expect(r.phones).toEqual(["+254712345678", "0722111222"]);
  });
  it("htmlToText strips scripts and decodes basics", () => {
    expect(htmlToText("<p>A&nbsp;&amp;&nbsp;B</p><script>x()</script>")).toBe("A & B");
  });
});

describe("pickBestEmail", () => {
  it("prefers the school's own domain", () => {
    expect(pickBestEmail(["x@gmail.com", "office@sunrise.ac.ke"], "https://www.sunrise.ac.ke")).toBe("office@sunrise.ac.ke");
    expect(pickBestEmail(["x@gmail.com"], "https://sunrise.ac.ke")).toBe("x@gmail.com");
    expect(pickBestEmail([], null)).toBeNull();
  });
});

describe("parseEnrichmentResponse", () => {
  const good = {
    website: "sunrise.ac.ke",
    phone: "+254 712 345 678",
    email: "Office@Sunrise.ac.ke",
    contact_name: "Jane Wanjiru",
    contact_role: "Head Teacher",
    source_url: "https://sunrise.ac.ke/contact",
  };
  it("normalizes valid output, including fenced JSON and surrounding prose", () => {
    const a = parseEnrichmentResponse(JSON.stringify(good));
    expect(a.ok && a.value).toMatchObject({ website: "https://sunrise.ac.ke", phone: "+254712345678", email: "office@sunrise.ac.ke" });
    const b = parseEnrichmentResponse("Here you go:\n```json\n" + JSON.stringify(good) + "\n```");
    expect(b.ok).toBe(true);
  });
  it("drops phone/email/name when there is no usable source page", () => {
    const r = parseEnrichmentResponse(JSON.stringify({ ...good, source_url: "http://127.0.0.1/x" }));
    expect(r.ok && r.value).toMatchObject({ source_url: null, phone: null, email: null, contact_name: null });
  });
  it("treats the string 'null' and junk as empty, and rejects non-JSON", () => {
    const r = parseEnrichmentResponse(JSON.stringify({ ...good, email: "null", phone: "n/a" }));
    expect(r.ok && r.value).toMatchObject({ email: null, phone: null });
    expect(parseEnrichmentResponse("I couldn't find anything").ok).toBe(false);
  });
  it("builds a prompt that forbids guessing", () => {
    const p = buildEnrichmentPrompt({ school_name: "Sunrise Academy", town_county: "Nakuru", school_level: "primary", website: null });
    expect(p).toContain("Sunrise Academy");
    expect(p).toContain("never construct an email");
  });
});

describe("page checks", () => {
  const page = "Contact the Head Teacher Jane Wanjiru on 0712-345-678 or office@sunrise.ac.ke. Sunrise Academy, Nakuru.";
  it("finds phone numbers regardless of formatting", () => {
    expect(pageContainsPhone(page, "+254712345678")).toBe(true);
    expect(pageContainsPhone(page, "0799999999")).toBe(false);
    expect(pageContainsPhone(page, "123")).toBe(false);
  });
  it("finds emails and names case-insensitively", () => {
    expect(pageContainsEmail(page, "Office@Sunrise.ac.ke")).toBe(true);
    expect(pageContainsEmail(page, "other@sunrise.ac.ke")).toBe(false);
    expect(pageContainsName(page, "jane wanjiru")).toBe(true);
    expect(pageContainsName(page, "John Doe")).toBe(false);
  });
  it("matches a page to a school by its distinctive words", () => {
    expect(nameMatchesPage("Sunrise Academy", page)).toBe(true);
    expect(nameMatchesPage("Moonlight Academy", page)).toBe(false);
    expect(nameMatchesPage("St. Mary's Girls High School", "Welcome to St Mary's, Nairobi")).toBe(true);
  });
});

describe("verifyFoundContacts", () => {
  const found: FoundContacts = {
    website: "https://sunrise.ac.ke",
    phone: "+254712345678",
    email: "office@sunrise.ac.ke",
    contact_name: "Jane Wanjiru",
    contact_role: "Head Teacher",
    source_url: "https://sunrise.ac.ke/contact",
  };
  it("keeps everything that is on the page", () => {
    const page = "Sunrise Academy. Jane Wanjiru 0712 345 678 office@sunrise.ac.ke";
    expect(verifyFoundContacts(found, page, page, "Sunrise Academy")).toEqual(found);
  });
  it("drops hallucinated values the page does not contain", () => {
    const page = "Sunrise Academy. Call 0712 345 678.";
    const r = verifyFoundContacts(found, page, page, "Sunrise Academy");
    expect(r.phone).toBe("+254712345678");
    expect(r.email).toBeNull();
    expect(r.contact_name).toBeNull();
    expect(r.contact_role).toBeNull();
  });
  it("drops everything if the source page couldn't be fetched, and rejects a website that isn't this school", () => {
    const none = verifyFoundContacts(found, null, "A page about Moonlight Academy", "Sunrise Academy");
    expect(none).toMatchObject({ phone: null, email: null, contact_name: null, source_url: null, website: null });
  });
});
