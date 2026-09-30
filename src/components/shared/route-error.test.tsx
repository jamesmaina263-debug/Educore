import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RouteError } from "./route-error";

// Server-side render only (effects such as Sentry reporting don't run here); this pins the
// fallback screen's content so a refactor can't silently drop the retry / way-out / reference.
describe("RouteError", () => {
  const render = (digest?: string) =>
    renderToStaticMarkup(
      <RouteError
        error={Object.assign(new Error("boom"), digest ? { digest } : {})}
        retry={() => {}}
        homeHref="/dashboard"
        homeLabel="Go to dashboard"
      />,
    );

  it("offers a retry and a way out", () => {
    const html = render();
    expect(html).toContain("Try again");
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("Go to dashboard");
    expect(html).toContain('role="alert"');
  });

  it("shows the support reference only when the error has a digest", () => {
    expect(render("abc123")).toContain("abc123");
    expect(render()).not.toContain("quote reference");
  });

  it("never leaks the raw error message", () => {
    expect(render("abc123")).not.toContain("boom");
  });
});
