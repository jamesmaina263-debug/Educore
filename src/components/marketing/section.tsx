import { cn } from "@/lib/utils";

// Enforces the design plan's rhythm: canvas -> navy -> canvas, never two
// dark sections in a row (the brief explicitly asks not to overuse dark
// backgrounds). "navy" is the only dark option on purpose -- there is no
// per-section custom-color escape hatch here, so the rhythm can't quietly
// drift as more pages are built in later phases.
export function Section({
  tone = "canvas",
  className,
  children,
  id,
}: {
  tone?: "canvas" | "navy";
  className?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "py-20 sm:py-28",
        // Anchor targets need to clear the sticky navbar (h-16) plus a
        // little breathing room, matching the offset role-panel already
        // uses for the same reason (see role-panel.tsx).
        id && "scroll-mt-24",
        tone === "canvas" && "bg-marketing-canvas text-marketing-navy-950",
        tone === "navy" && "bg-marketing-navy-950 text-white",
        className,
      )}
    >
      <Container>{children}</Container>
    </section>
  );
}

export function Container({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("mx-auto w-full max-w-6xl px-6", className)}>{children}</div>;
}
