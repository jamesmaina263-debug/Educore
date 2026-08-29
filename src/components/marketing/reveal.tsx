"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Deliberately minimal: no animation library added (none exists elsewhere
// in this app) -- just an IntersectionObserver toggling opacity/translate
// classes already defined by Tailwind. Respects prefers-reduced-motion by
// skipping the initial hidden state entirely, so motion-sensitive visitors
// never see a delayed fade-in.
export function Reveal({
  children,
  className,
  delayMs = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  // Lazy initializer runs once, synchronously, before first paint -- avoids
  // the extra render-then-correct cycle a `useEffect(() => setState(...))`
  // pair would cause, and avoids a hydration mismatch since this only ever
  // runs on the client (the component is already "use client").
  const [reduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (reduceMotion || !ref.current) return;
    const node = ref.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduceMotion]);

  return (
    <div
      ref={ref}
      className={cn(
        "transition-[opacity,transform] duration-700 ease-out",
        !reduceMotion && !visible && "translate-y-4 opacity-0",
        (reduceMotion || visible) && "translate-y-0 opacity-100",
        className,
      )}
      style={{ transitionDelay: reduceMotion ? "0ms" : `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}
