import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/exams/report-cards/head-comment-actions", () => ({ saveHeadTeacherComment: vi.fn() }));

const { HeadTeacherCommentEditor } = await import("./head-teacher-comment-editor");

describe("HeadTeacherCommentEditor", () => {
  it("a viewer without the permission sees the comment read-only, and nothing when there is none", () => {
    const withText = renderToStaticMarkup(<HeadTeacherCommentEditor reportCardId="rc1" initial="A pleasure to teach." canEdit={false} />);
    expect(withText).toContain("Head teacher");
    expect(withText).toContain("A pleasure to teach.");
    expect(withText).not.toContain("<textarea");
    expect(renderToStaticMarkup(<HeadTeacherCommentEditor reportCardId="rc1" initial="  " canEdit={false} />)).toBe("");
  });
  it("an editor gets a textarea limited to 1000 characters and a save button that is disabled until the text changes", () => {
    const out = renderToStaticMarkup(<HeadTeacherCommentEditor reportCardId="rc1" initial="Existing" canEdit />);
    expect(out).toContain("<textarea");
    expect(out).toContain('maxLength="1000"');
    expect(out).toContain("Existing");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Save comment<\/button>/);
  });
});
