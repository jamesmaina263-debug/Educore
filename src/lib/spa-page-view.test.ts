import { describe, expect, it } from "vitest";
import { createPageViewTracker, type SpaPageViewEvent } from "./spa-page-view";

function setup(initialTitle = "Home") {
  let title = initialTitle;
  let href = "https://example.com/";
  const pushed: SpaPageViewEvent[] = [];
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const tracker = createPageViewTracker({
    getTitle: () => title,
    getLocation: () => href,
    push: (e) => pushed.push(e),
    schedule: (fn) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    cancel: (h) => void timers.delete(h as number),
  });
  const tick = () => {
    const [id, fn] = [...timers.entries()][0] ?? [];
    if (id === undefined || !fn) return false;
    timers.delete(id);
    fn();
    return true;
  };
  return {
    tracker,
    pushed,
    timers,
    tick,
    setTitle: (t: string) => (title = t),
    setHref: (h: string) => (href = h),
  };
}

describe("createPageViewTracker", () => {
  it("does not report the first page of the document (the Google tag sends that one)", () => {
    const s = setup();
    s.tracker.onPathname("/");
    expect(s.pushed).toEqual([]);
  });

  it("reports immediately when the title has already changed", () => {
    const s = setup("Home");
    s.tracker.onPathname("/");
    s.setTitle("About EduCore");
    s.setHref("https://example.com/about");
    s.tracker.onPathname("/about");
    expect(s.pushed).toEqual([
      { event: "spa_page_view", page_title: "About EduCore", page_location: "https://example.com/about", page_path: "/about" },
    ]);
  });

  it("waits for a stale title to update, then reports the new one", () => {
    const s = setup("Home");
    s.tracker.onPathname("/");
    s.setHref("https://example.com/contact");
    s.tracker.onPathname("/contact");
    expect(s.pushed).toEqual([]); // title still "Home"
    s.tick();
    expect(s.pushed).toEqual([]);
    s.setTitle("Contact EduCore");
    s.tick();
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]).toMatchObject({ page_title: "Contact EduCore", page_path: "/contact" });
  });

  it("still reports once, after the wait, when the new page keeps the same title", () => {
    const s = setup("EduCore");
    s.tracker.onPathname("/");
    s.tracker.onPathname("/faq");
    let guard = 0;
    while (s.tick() && guard++ < 50);
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]).toMatchObject({ page_title: "EduCore", page_path: "/faq" });
  });

  it("ignores repeat calls for the same path", () => {
    const s = setup("Home");
    s.tracker.onPathname("/");
    s.setTitle("Pricing");
    s.tracker.onPathname("/pricing");
    s.tracker.onPathname("/pricing");
    expect(s.pushed).toHaveLength(1);
  });

  it("cancels a pending report when the visitor navigates again", () => {
    const s = setup("Home");
    s.tracker.onPathname("/");
    s.tracker.onPathname("/a"); // title unchanged -> polling
    expect(s.timers.size).toBe(1);
    s.setTitle("B page");
    s.tracker.onPathname("/b");
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]).toMatchObject({ page_path: "/b", page_title: "B page" });
    expect(s.timers.size).toBe(0);
  });
});
