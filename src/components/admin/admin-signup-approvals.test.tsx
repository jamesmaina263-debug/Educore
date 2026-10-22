import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/app/(admin)/admin/signups/actions", () => ({ reviewSchoolSignup: vi.fn() }));

import { AdminSignupApprovals, type SignupRow } from "./admin-signup-approvals";

const row = (over: Partial<SignupRow>): SignupRow => ({
  id: "s1",
  name: "Sunrise Academy",
  kind: "private",
  created_at: "2026-10-21T08:00:00Z",
  status: "pending",
  reviewed_at: null,
  owner_name: "Jane",
  owner_email: "jane@example.com",
  owner_phone: null,
  ...over,
});

describe("AdminSignupApprovals children's home notice", () => {
  it("prompts verification for a waiting signup whose name looks like a children's home", () => {
    const html = renderToStaticMarkup(<AdminSignupApprovals rows={[row({ name: "Mercy Children's Home" })]} />);
    expect(html).toContain("Looks like a children");
    expect(html).toContain("Check it is genuine before approving");
    expect(html).toContain('href="/admin/billing"');
  });

  it("shows the follow-up wording once approved, so it still gets flagged before the trial ends", () => {
    const html = renderToStaticMarkup(
      <AdminSignupApprovals
        rows={[row({ name: "Hope Orphanage", status: "approved", reviewed_at: "2026-10-21T09:00:00Z" })]}
      />,
    );
    expect(html).toContain("Looks like a children");
    expect(html).toContain("If it is genuine, mark it complimentary in");
    expect(html).not.toContain("Check it is genuine before approving");
  });

  it("shows nothing extra for an ordinary school or a school-like name", () => {
    for (const name of ["Sunrise Academy", "Little Angels Orphans Academy"]) {
      const html = renderToStaticMarkup(<AdminSignupApprovals rows={[row({ name })]} />);
      expect(html, name).not.toContain("Looks like a children");
    }
  });
});
