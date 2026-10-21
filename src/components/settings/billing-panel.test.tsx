import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("@/app/(app)/settings/billing-actions", () => ({ cancelOwnSubscription: vi.fn() }));

import { BillingPanel, type BillingData } from "./billing-panel";

const base: BillingData = {
  status: "trialing",
  plan_name: "Starter",
  trial_ends_at: "2026-11-20T00:00:00Z",
  current_period_end: null,
  complimentary: false,
  invoices: [],
};

describe("BillingPanel", () => {
  it("shows the plan and the trial end date for a normal trial", () => {
    const html = renderToStaticMarkup(<BillingPanel data={base} canManage={false} />);
    expect(html).toContain("Starter");
    expect(html).toContain("Trial ends");
    expect(html).not.toContain("Complimentary");
  });

  it("shows 'Complimentary — no charge' and no trial or period countdown for a no-charge school", () => {
    const html = renderToStaticMarkup(
      <BillingPanel
        data={{ ...base, status: "active", trial_ends_at: "2026-11-20T00:00:00Z", current_period_end: "2026-12-31", complimentary: true }}
        canManage={false}
      />,
    );
    expect(html).toContain("Complimentary — no charge");
    expect(html).not.toContain("Trial ends");
    expect(html).not.toContain("Current period ends");
    expect(html).not.toContain("No plan assigned");
  });
});
