"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Renders children at a fixed *desktop* width and scales the whole thing down
// to fit its container (never up). The dashboard preview is a picture of the
// desktop app, so it must keep its desktop layout at every viewport width
// instead of reflowing into a cramped mobile arrangement.
export function ScaledStage({
  designWidth,
  children,
}: {
  designWidth: number;
  children: React.ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const measure = () => {
      const next = Math.min(1, outer.clientWidth / designWidth);
      setScale(next);
      setHeight(inner.offsetHeight * next);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [designWidth]);

  return (
    <div
      ref={outerRef}
      className="w-full overflow-hidden"
      style={height === null ? undefined : { height }}
    >
      <div
        ref={innerRef}
        style={{
          width: designWidth,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}
