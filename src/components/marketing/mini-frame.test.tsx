import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MiniFrame } from "./mini-frame";

describe("MiniFrame", () => {
  it("sets its own text colour so children don't inherit white from a navy section", () => {
    const html = renderToStaticMarkup(
      <MiniFrame>
        <p>Snapshot</p>
      </MiniFrame>,
    );
    expect(html).toMatch(/class="[^"]*\bbg-background\b[^"]*\btext-foreground\b[^"]*"/);
    expect(html).toContain("Snapshot");
  });
});
