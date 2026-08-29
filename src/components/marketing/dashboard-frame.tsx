import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// The marketing site's signature element (see Phase 2 design plan).
// Deliberately two-toned: the outer "stage" (browser chrome, gold rim-light,
// navy backdrop) is marketing art -- it exists to frame and present. The
// inner content strictly reuses the app's real, unmodified design tokens
// (--primary blue, --success, --border, --muted, the same Badge component
// every real page uses) so what's shown is the actual EduCore visual
// language, not an invented mockup. This is how the design plan keeps the
// brief's "never invent products or capabilities" rule honest at the
// pixel level, not just the copy level.
export function DashboardFrame({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative rounded-2xl bg-marketing-navy-900 p-2 shadow-2xl",
        "ring-1 ring-marketing-gold-500/30",
        className,
      )}
    >
      {/* Rim-light: a thin gold gradient hairline, not a filled border --
          "restrained", per the brief. */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in oklab, var(--brand-gold-500) 35%, transparent), transparent 40%)",
          mixBlendMode: "screen",
        }}
      />

      <div className="overflow-hidden rounded-xl bg-white">
        {/* Browser chrome */}
        <div className="flex items-center gap-1.5 border-b border-border bg-secondary px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
          <span className="ml-3 font-mono text-[11px] text-muted-foreground">
            app.educore.io/dashboard
          </span>
        </div>

        {/* Reconstructed dashboard content -- real tokens, real Badge. */}
        <div className="grid grid-cols-3 gap-3 bg-background p-4">
          <div className="col-span-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Gititu High School</p>
              <p className="text-xs text-muted-foreground">Term 2 · Overview</p>
            </div>
            <Badge variant="secondary" className="font-mono text-[10px]">
              Live
            </Badge>
          </div>

          {[
            { label: "Students", value: "812", tone: "default" as const },
            { label: "Attendance today", value: "96.2%", tone: "success" as const },
            { label: "Open admissions", value: "23", tone: "warning" as const },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-border bg-card p-3"
            >
              <p className="text-[11px] text-muted-foreground">{stat.label}</p>
              <p
                className={cn(
                  "mt-1 font-mono text-lg font-semibold",
                  stat.tone === "default" && "text-foreground",
                  stat.tone === "success" && "text-success",
                  stat.tone === "warning" && "text-warning",
                )}
              >
                {stat.value}
              </p>
            </div>
          ))}

          <div className="col-span-3 grid grid-cols-2 gap-3">
            {[
              { label: "Fees collected", value: "KES 4.1M", tone: "info" as const },
              { label: "Outstanding fees", value: "KES 620K", tone: "danger" as const },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-border bg-card p-3"
              >
                <p className="text-[11px] text-muted-foreground">{stat.label}</p>
                <p
                  className={cn(
                    "mt-1 font-mono text-lg font-semibold",
                    stat.tone === "info" && "text-info",
                    stat.tone === "danger" && "text-destructive",
                  )}
                >
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          <div className="col-span-3 rounded-lg border border-border bg-card p-3">
            <p className="mb-2 text-[11px] text-muted-foreground">Fee collection — last 6 terms</p>
            <div className="flex h-16 items-end gap-1.5">
              {[38, 52, 47, 61, 58, 74].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-primary/70"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
