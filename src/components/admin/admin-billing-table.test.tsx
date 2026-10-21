import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(admin)/admin/billing/actions", () => ({
  activateSchoolSubscription: vi.fn(),
  suspendSchoolSubscription: vi.fn(),
  generateSchoolInvoice: vi.fn(),
  recordSchoolPayment: vi.fn(),
  setSchoolComplimentary: vi.fn(),
}));

import { AdminBillingTable, type SchoolBillingRow } from "./admin-billing-table";

const row = (over: Partial<SchoolBillingRow>): SchoolBillingRow => ({
  school_id: "s1",
  school_name: "Sunrise Academy",
  school_status: "active",
  subscription_status: "active",
  plan_id: null,
  trial_ends_at: null,
  current_period_end: null,
  complimentary: false,
  complimentary_reason: null,
  invoices: [],
  ...over,
});

describe("AdminBillingTable", () => {
  it("marks a complimentary school with a badge", () => {
    const html = renderToStaticMarkup(
      <AdminBillingTable rows={[row({ school_name: "Mercy Children's Home", complimentary: true, complimentary_reason: "Certificate seen" })]} plans={[]} />,
    );
    expect(html).toContain("Mercy Children&#x27;s Home");
    expect(html).toContain("complimentary");
  });

  it("does not badge a normal school", () => {
    const html = renderToStaticMarkup(<AdminBillingTable rows={[row({})]} plans={[]} />);
    expect(html).not.toContain("complimentary");
  });
});
