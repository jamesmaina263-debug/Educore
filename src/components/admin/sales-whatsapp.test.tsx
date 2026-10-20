import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/(admin)/admin/sales-whatsapp/actions", () => ({
  editSalesWhatsApp: vi.fn(),
  markSalesWhatsAppSent: vi.fn(),
  proposeSalesWhatsApp: vi.fn(),
  recordWhatsAppAgreement: vi.fn(),
  reviewSalesWhatsApp: vi.fn(),
  setSalesWhatsAppPromotional: vi.fn(),
  withdrawSalesWhatsApp: vi.fn(),
  withdrawWhatsAppAgreement: vi.fn(),
}));

const { SalesWhatsAppPanel } = await import("./sales-whatsapp");

const NOW = "2026-10-19T09:00:00.000Z";
const team = [{ id: "t1", name: "Ben" }];

function consent(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    created_at: "2026-10-19T07:00:00.000Z",
    phone: "254712345678",
    contact_name: "Jane Owner",
    school_name: "Sunrise Academy",
    source: "demo_form",
    scope: "service",
    consent_text: "Yes, you may message me on WhatsApp.",
    how: null,
    note: null,
    withdrawn_at: null,
    ...over,
  };
}
function message(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    created_at: "2026-10-19T08:00:00.000Z",
    consent_id: "c1",
    phone: "254712345678",
    recipient_name: "Jane Owner",
    kind: "service",
    body: "Hello Jane, thanks for asking about a demo.",
    payload_hash: "a".repeat(64),
    status: "proposed",
    reviewed_at: null,
    review_note: null,
    sent_at: null,
    ...over,
  };
}
const render = (props: Partial<Parameters<typeof SalesWhatsAppPanel>[0]> = {}) =>
  renderToStaticMarkup(
    <SalesWhatsAppPanel settings={{ promotional_enabled: false }} consents={[]} messages={[]} schools={[]} team={team} nowIso={NOW} {...props} />,
  );

describe("SalesWhatsAppPanel", () => {
  it("says plainly that nothing is sent by the system, and shows promotional OFF", () => {
    const html = render();
    expect(html).toContain("Nothing is sent by the system.");
    expect(html).toContain("Promotional messages: <strong>OFF</strong>");
    expect(html).toContain("Turn promotional on");
    expect(html).toMatch(/Data Protection Act/);
    expect(html).toContain("Nobody yet.");
    expect(html).toContain("Nothing is waiting.");
  });

  it("says nothing can be recorded or sent when the settings could not be read", () => {
    expect(render({ settings: null })).toContain("Nothing can be recorded or sent.");
  });

  it("lists people who agreed with the source and scope, and hides withdrawn ones", () => {
    const html = render({
      consents: [consent(), consent({ id: "c2", contact_name: "Gone Person", phone: "254799999999", withdrawn_at: "2026-10-18T08:00:00.000Z" })],
    });
    expect(html).toContain("Jane Owner");
    expect(html).toContain("+254712345678");
    expect(html).toContain("Ticked the box on the demo form");
    expect(html).toContain("Messages about their demo and trial only");
    expect(html).not.toContain("Gone Person");
    expect(html).toContain("1 withdrawn agreement(s) are blocked");
  });

  it("offers review actions for a proposed message and no sending actions yet", () => {
    const html = render({ consents: [consent()], messages: [message()] });
    expect(html).toContain("Approve exactly this text");
    expect(html).toContain("Hello Jane, thanks for asking about a demo.");
    expect(html).not.toContain("Open in WhatsApp");
    expect(html).not.toContain("mark as sent");
  });

  it("for an approved message offers Open in WhatsApp with the text in the link, plus Copy text and mark as sent", () => {
    const html = render({ consents: [consent()], messages: [message({ status: "approved", reviewed_at: "2026-10-19T08:30:00.000Z" })] });
    expect(html).toContain("Open in WhatsApp");
    expect(html).toContain('href="https://wa.me/254712345678?text=Hello%20Jane%2C%20thanks%20for%20asking%20about%20a%20demo."');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Copy text");
    expect(html).toContain("I sent it: mark as sent");
  });

  it("warns when an approval has lapsed", () => {
    const html = render({ consents: [consent()], messages: [message({ status: "approved", reviewed_at: "2026-10-17T08:00:00.000Z" })] });
    expect(html).toContain("The approval has lapsed");
  });

  it("shows a sent message in the history, not in the open list", () => {
    const html = render({ consents: [consent()], messages: [message({ status: "sent", sent_at: "2026-10-19T08:45:00.000Z" })] });
    expect(html).toMatch(/<span class="font-medium">Marked as sent<\/span>/);
    expect(html).toContain("Nothing is waiting.");
  });
});
