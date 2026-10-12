"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Renders children inside a fixed-size *desktop window* (designWidth x
// designHeight) and scales the whole window down to fit its container
// (never up). The box keeps its landscape aspect ratio at every viewport
// width, like a screenshot taken on a desktop -- content that doesn't fit is
// simply cropped at the window edge, exactly as in a real screenshot.
export function ScaledStage({
  designWidth,
  designHeight,
  children,
}: {
  designWidth: number;
  designHeight: number;
  children: React.ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.45);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const measure = () => setScale(Math.min(1, outer.clientWidth / designWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [designWidth]);

  return (
    <div
      ref={outerRef}
      className="relative w-full overflow-hidden"
      style={{ aspectRatio: `${designWidth} / ${designHeight}` }}
    >
      <div
        className="absolute left-0 top-0 overflow-hidden"
        style={{
          width: designWidth,
          height: designHeight,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}
