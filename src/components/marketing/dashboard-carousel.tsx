"use client";

import { useRef, useState } from "react";
import { DashboardFrame } from "@/components/marketing/dashboard-frame";
import { ModulesFrame } from "@/components/marketing/modules-frame";
import { cn } from "@/lib/utils";

// Hero preview wrapper.
//
// Desktop (>= 1024px): just the DashboardFrame, exactly as before -- its
// sidebar already lists every module, so the second slide and the tabs are
// hidden with CSS (`lg:hidden`).
//
// Phones and tablets (< 1024px): the dashboard has no sidebar, so the preview
// becomes a two-slide swipeable strip -- "Dashboard" then "All modules".
// Native CSS scroll-snap does the swiping (no carousel library, works before
// hydration); the client state only drives the tab highlight. The next slide
// peeks in from the right so the swipe is discoverable.
const SLIDES = ["Dashboard", "All modules"] as const;

export function DashboardCarousel() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setActive(max > 0 && el.scrollLeft > max / 2 ? 1 : 0);
  };

  const go = (index: number) => {
    const el = trackRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({
      left: index === 0 ? 0 : el.scrollWidth,
      behavior: reduce ? "auto" : "smooth",
    });
  };

  return (
    <div>
      <div
        ref={trackRef}
        onScroll={onScroll}
        tabIndex={0}
        role="group"
        aria-roledescription="carousel"
        aria-label="EduCore preview: dashboard and all modules"
        className={cn(
          "flex items-start gap-3 overflow-x-auto overscroll-x-contain snap-x snap-mandatory",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "lg:block lg:overflow-visible",
        )}
      >
        <div className="w-[92%] shrink-0 snap-center lg:w-auto">
          <DashboardFrame />
        </div>
        <div className="w-[92%] shrink-0 snap-center lg:hidden">
          <ModulesFrame />
        </div>
      </div>

      <div
        className="mt-4 flex items-center justify-center gap-2 lg:hidden"
        role="tablist"
        aria-label="Preview screens"
      >
        {SLIDES.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={active === i}
            onClick={() => go(i)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
              active === i
                ? "bg-marketing-gold-500 text-marketing-navy-900"
                : "bg-white/10 text-white/80 hover:bg-white/15",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
