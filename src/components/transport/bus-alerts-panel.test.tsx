import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/transport/alerts/actions", () => ({
  recordBusBoarding: vi.fn(),
  saveBusAlertMode: vi.fn(),
  sendDelayAlert: vi.fn(),
  sendTestBusAlert: vi.fn(),
}));

import type { AlertSettings } from "./bus-alerts-panel";
const { BusAlertsPanel } = await import("./bus-alerts-panel");

const recon = [
  { student_id: "s1", student_name: "Ann Alpha", route_name: "North Route", roll_call_present: true, gate_in: true, gate_out: false, boarded: true, dropped_off: false },
];
const base = {
  settings: { mode: "test", testPhone: "0712345678", testSent: true } as AlertSettings,
  routes: [{ id: "r1", name: "North Route" }],
  riders: [{ studentId: "s1", name: "Ann Alpha", route: "North Route" }],
  recon,
  log: [{ id: "l1", created_at: "2026-11-04T05:00:00Z", kind: "delay", mode: "test", outcome: "queued" }],
  canWrite: true,
};
const html = (over: Partial<typeof base> = {}) => renderToStaticMarkup(<BusAlertsPanel {...base} {...over} />);
const liveOption = (h: string) => h.match(/<option[^>]*value="live"[^>]*>/)?.[0] ?? "";

describe("BusAlertsPanel safety UI", () => {
  it("locks Live until a test alert has been sent", () => {
    const h = html({ settings: { mode: "test", testPhone: "0712345678", testSent: false } });
    expect(liveOption(h)).toContain("disabled");
    expect(h).toContain("Live unlocks after a test alert has been sent");
  });
  it("unlocks Live once the current test phone has been tested", () => {
    expect(liveOption(html())).not.toContain("disabled");
  });
  it("says plainly that test mode never messages guardians", () => {
    const h = html();
    expect(h).toContain("sends only to the staff test phone");
    expect(h).toContain("never to a guardian");
  });
  it("shows no send or roll-call controls to view-only staff, but still shows the read-only check", () => {
    const h = html({ canWrite: false });
    expect(h).not.toContain("Send a delay alert");
    expect(h).not.toContain("Bus roll-call</h2>");
    expect(h).not.toContain("Boarded the bus");
    expect(h).toContain("only transport staff can change them");
    expect(h).toContain("Ann Alpha");
  });
  it("disables sending a delay alert while alerts are off", () => {
    const h = html({ settings: { mode: "off", testPhone: null, testSent: false } });
    expect(h).toContain("Bus alerts are off. Switch to Test above first.");
    expect(h).toMatch(/<button[^>]*disabled[^>]*>Send delay alert<\/button>/);
  });
  it("labels the action as a test when in test mode", () => {
    expect(html()).toContain("Send test delay alert");
  });
  it("explains that gate scans never message anyone", () => {
    expect(html()).toContain("School-gate scans are not used to message anyone");
  });
  it("renders the reconciliation and the activity log, marking test rows", () => {
    const h = html();
    expect(h).toContain("North Route");
    expect(h).toContain("TEST");
    expect(html({ recon: [], log: [] })).toContain("No learners with an active bus assignment.");
  });
});
