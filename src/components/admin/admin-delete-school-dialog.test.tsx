import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/(admin)/admin/actions", () => ({
  previewSchoolDeletion: vi.fn(() => new Promise(() => {})),
  deleteSchoolPermanently: vi.fn(),
}));

const { AdminDeleteSchoolDialog, deletionReady } = await import("./admin-delete-school-dialog");

const preview = {
  school_id: "s1",
  name: "Tetu Academy",
  slug: "tetu-academy",
  status: "suspended" as const,
  students: 10,
  staff: 2,
  login_accounts: 5,
  platform_invoices: 1,
  paid_payments: 0,
  paid_kes: 0,
  blockers: [],
  can_delete: true,
};
const ok = { preview, typedSlug: "tetu-academy", reason: "Duplicate trial", eraseBilling: false };

describe("deletionReady", () => {
  it("is true only when everything is satisfied", () => {
    expect(deletionReady(ok)).toBe(true);
  });
  it("needs the preview, and the DB must say the school can be deleted", () => {
    expect(deletionReady({ ...ok, preview: null })).toBe(false);
    expect(deletionReady({ ...ok, preview: { ...preview, can_delete: false, blockers: ["x"] } })).toBe(false);
  });
  it("needs the slug typed exactly (case matters) and a real reason", () => {
    expect(deletionReady({ ...ok, typedSlug: "" })).toBe(false);
    expect(deletionReady({ ...ok, typedSlug: "Tetu-Academy" })).toBe(false);
    expect(deletionReady({ ...ok, typedSlug: "  tetu-academy " })).toBe(true);
    expect(deletionReady({ ...ok, reason: "  x " })).toBe(false);
  });
  it("needs an explicit tick before erasing recorded payments", () => {
    const paid = { ...preview, paid_payments: 2, paid_kes: 5000 };
    expect(deletionReady({ ...ok, preview: paid })).toBe(false);
    expect(deletionReady({ ...ok, preview: paid, eraseBilling: true })).toBe(true);
  });
});

describe("AdminDeleteSchoolDialog", () => {
  it("renders nothing visible when no school is selected", () => {
    const html = renderToStaticMarkup(<AdminDeleteSchoolDialog school={null} onClose={() => {}} onDeleted={() => {}} />);
    expect(html).not.toContain("Permanently delete");
  });
});
