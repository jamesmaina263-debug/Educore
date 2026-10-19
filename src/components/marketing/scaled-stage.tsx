"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Renders children inside a fixed-size *desktop window* (designWidth x
// designHeight) and scales the whole window down to fit its container
// (and up to 1.2x on very wide screens). The box keeps its landscape aspect ratio at every viewport
// width, like a screenshot taken on a desktop -- content that doesn't fit is
// simply cropped at the window edge, exactly as in a real screenshot.
//
// Optional narrower layouts. Below `compact.below` px of viewport width (phones)
// or `tablet.below` px (tablets) the window switches to its own design size
// and the stage gets data-compact="true" / data-tablet="true" (it is also a
// `group`), so children can restyle with Tailwind's
// `group-data-[compact=true]:` / `group-data-[tablet=true]:` variants -- e.g.
// hide a sidebar. The CSS aspect ratios below use Tailwind's `max-sm` (640px)
// and `max-lg` (1024px); keep `compact.below` / `tablet.below` in sync.
// `viewWidth` (optional): the window is laid out at `width` but only its left
// `viewWidth` design px are shown -- the rest is cropped at the container edge,
// like a desktop screenshot cropped on the right. Scale and aspect ratio use
// `viewWidth`.
export type CompactStage = { below: number; width: number; height: number; viewWidth?: number };

export function ScaledStage({
  designWidth,
  designHeight,
  compact,
  tablet,
  children,
}: {
  designWidth: number;
  designHeight: number;
  compact?: CompactStage;
  tablet?: CompactStage;
  children: React.ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.45);
  const [mode, setMode] = useState<"desktop" | "tablet" | "compact">("desktop");

  const compactBelow = compact?.below;
  const compactWidth = compact?.width;
  const compactView = compact?.viewWidth;
  const tabletBelow = tablet?.below;
  const tabletWidth = tablet?.width;
  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const measure = () => {
      const vw = window.innerWidth;
      const next =
        compactBelow !== undefined && vw < compactBelow
          ? "compact"
          : tabletBelow !== undefined && vw < tabletBelow
            ? "tablet"
            : "desktop";
      const width =
        next === "compact" && compactWidth
          ? compactWidth
          : next === "tablet" && tabletWidth
            ? tabletWidth
            : designWidth;
      const visible = next === "compact" && compactView ? compactView : width;
      setMode(next);
      setScale(Math.min(next === "desktop" ? 1.2 : 1.4, outer.clientWidth / visible));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [designWidth, compactBelow, compactWidth, compactView, tabletBelow, tabletWidth]);

  const active = mode === "compact" ? compact : mode === "tablet" ? tablet : undefined;
  const width = active ? active.width : designWidth;
  const height = active ? active.height : designHeight;

  return (
    <div
      ref={outerRef}
      // Aspect ratio is CSS-driven (not state) so there is no layout shift
      // between server render and hydration on phones. `max-sm` (< 640px)
      // must match the `below` value passed in `compact`.
      className={
        compact || tablet
          ? "relative w-full overflow-hidden aspect-(--stage-ratio) max-lg:aspect-(--stage-ratio-tablet) max-sm:aspect-(--stage-ratio-compact)"
          : "relative w-full overflow-hidden"
      }
      style={
        compact || tablet
          ? ({
              "--stage-ratio": `${designWidth} / ${designHeight}`,
              "--stage-ratio-tablet": tablet
                ? `${tablet.width} / ${tablet.height}`
                : `${designWidth} / ${designHeight}`,
              "--stage-ratio-compact": compact
                ? `${compact.viewWidth ?? compact.width} / ${compact.height}`
                : tablet
                  ? `${tablet.width} / ${tablet.height}`
                  : `${designWidth} / ${designHeight}`,
            } as React.CSSProperties)
          : { aspectRatio: `${designWidth} / ${designHeight}` }
      }
    >
      <div
        className="group absolute left-0 top-0 overflow-hidden"
        data-compact={mode === "compact" ? "true" : "false"}
        data-tablet={mode === "tablet" ? "true" : "false"}
        style={{
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}
