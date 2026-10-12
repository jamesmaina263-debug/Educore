"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Renders children inside a fixed-size *desktop window* (designWidth x
// designHeight) and scales the whole window down to fit its container
// (and up to 1.2x on very wide screens). The box keeps its landscape aspect ratio at every viewport
// width, like a screenshot taken on a desktop -- content that doesn't fit is
// simply cropped at the window edge, exactly as in a real screenshot.
//
// Optional `compact`: below `compact.below` px of viewport width the window
// switches to a narrower/taller design size and the stage gets
// data-compact="true" (it is also a `group`), so children can restyle with
// Tailwind's `group-data-[compact=true]:` variants -- e.g. hide a sidebar.
export type CompactStage = { below: number; width: number; height: number };

export function ScaledStage({
  designWidth,
  designHeight,
  compact,
  children,
}: {
  designWidth: number;
  designHeight: number;
  compact?: CompactStage;
  children: React.ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.45);
  const [isCompact, setIsCompact] = useState(false);

  const compactBelow = compact?.below;
  const compactWidth = compact?.width;
  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const measure = () => {
      const useCompact =
        compactBelow !== undefined && window.innerWidth < compactBelow;
      const width = useCompact && compactWidth ? compactWidth : designWidth;
      setIsCompact(useCompact);
      setScale(Math.min(useCompact ? 1.4 : 1.2, outer.clientWidth / width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [designWidth, compactBelow, compactWidth]);

  const width = isCompact && compact ? compact.width : designWidth;
  const height = isCompact && compact ? compact.height : designHeight;

  return (
    <div
      ref={outerRef}
      // Aspect ratio is CSS-driven (not state) so there is no layout shift
      // between server render and hydration on phones. `max-sm` (< 640px)
      // must match the `below` value passed in `compact`.
      className={
        compact
          ? "relative w-full overflow-hidden aspect-(--stage-ratio) max-sm:aspect-(--stage-ratio-compact)"
          : "relative w-full overflow-hidden"
      }
      style={
        compact
          ? ({
              "--stage-ratio": `${designWidth} / ${designHeight}`,
              "--stage-ratio-compact": `${compact.width} / ${compact.height}`,
            } as React.CSSProperties)
          : { aspectRatio: `${designWidth} / ${designHeight}` }
      }
    >
      <div
        className="group absolute left-0 top-0 overflow-hidden"
        data-compact={isCompact ? "true" : "false"}
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
