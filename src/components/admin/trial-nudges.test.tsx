import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/(admin)/admin/trials/nudges/actions", () => ({
  checkTrialNudge: vi.fn(),
  editTrialNudge: vi.fn(),
  proposeTrialNudge: vi.fn(),
  reviewTrialNudge: vi.fn(),
  sendTrialNudge: vi.fn(),
  setTrialNudgeSettings: vi.fn(),
  withdrawTrialNudge: vi.fn(),
}));

const { TrialNudgesPanel } = await import("./trial-nudges");

const NOW = "2026-10-18T09:00:00.000Z";
const team = [{ id: "t1", name: "Ben" }];
const schools = [{ id: "s1", name: "Tetu Academy", label: "trial running" }];

function row(over: Record<string, unknown>) {
  return {
    id: "n1",
    created_at: "2026-10-18T07:00:00.000Z",
    school_id: "s1",
    school_name: "Tetu Academy",
    kind: "service",
    recipient_email: "owner@example.invalid",
    recipient_name: "Owner",
    subject: "Welcome to your EduCore trial",
    body: "Hello {{name}}, your trial is running.",
    payload_hash: "a".repeat(64),
    status: "proposed",
    proposed_by: "t1",
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    queued_at: null,
    sent_at: null,
    error: null,
    ...over,
  };
}

describe("TrialNudgesPanel", () => {
  it("says nothing can be sent when the settings could not be read", () => {
    const html = renderToStaticMarkup(<TrialNudgesPanel settings={null} nudges={[]} schools={schools} team={team} nowIso={NOW} />);
    expect(html).toContain("Nothing can be sent.");
    expect(html).toContain("Nothing is waiting.");
    expect(html).toContain("No messages yet.");
  });

  it("shows both switches as OFF and explains the limits", () => {
    const html = renderToStaticMarkup(
      <TrialNudgesPanel settings={{ sending_enabled: false, promotional_enabled: false }} nudges={[]} schools={schools} team={team} nowIso={NOW} />,
    );
    expect(html).toContain("Sending: <strong>OFF</strong>");
    expect(html).toContain("Promotional: <strong>OFF</strong>");
    expect(html).toContain("Turn sending on");
    expect(html).toMatch(/one message per school every 3 days/);
    expect(html).toMatch(/Data Protection Act/);
  });

  it("offers review actions for a proposed message and shows exactly what was proposed", () => {
    const html = renderToStaticMarkup(
      <TrialNudgesPanel settings={{ sending_enabled: true, promotional_enabled: false }} nudges={[row({})]} schools={schools} team={team} nowIso={NOW} />,
    );
    expect(html).toContain("Approve exactly this text");
    expect(html).toContain("owner@example.invalid");
    expect(html).toContain("Hello {{name}}, your trial is running.");
    expect(html).not.toContain("Send now");
  });

  it("offers Send only for an approved message, and warns when sending is off or the approval has lapsed", () => {
    const approved = row({ status: "approved", reviewed_at: "2026-10-18T08:00:00.000Z" });
    const off = renderToStaticMarkup(
      <TrialNudgesPanel settings={{ sending_enabled: false, promotional_enabled: false }} nudges={[approved]} schools={schools} team={team} nowIso={NOW} />,
    );
    expect(off).toContain("Send now");
    expect(off).toContain("Sending is OFF, so Send will be refused");
    const lapsed = renderToStaticMarkup(
      <TrialNudgesPanel
        settings={{ sending_enabled: true, promotional_enabled: false }}
        nudges={[row({ status: "approved", reviewed_at: "2026-10-16T08:00:00.000Z" })]}
        schools={schools}
        team={team}
        nowIso={NOW}
      />,
    );
    expect(lapsed).toContain("The approval has lapsed");
  });

  it("shows a sent message in the history, not in the open list, and a queued one with Check status", () => {
    const html = renderToStaticMarkup(
      <TrialNudgesPanel
        settings={{ sending_enabled: true, promotional_enabled: true }}
        nudges={[row({ id: "n2", status: "sent", sent_at: "2026-10-18T08:30:00.000Z" }), row({ id: "n3", school_name: "Other School", status: "queued", queued_at: "2026-10-18T08:55:00.000Z" })]}
        schools={schools}
        team={team}
        nowIso={NOW}
      />,
    );
    expect(html).toContain("Check status");
    expect(html).toContain("Other School");
    expect(html).toMatch(/<span class="font-medium">Sent<\/span>/);
  });
});
