import { ChevronRight } from "lucide-react";
import { navGroups } from "@/components/app-shell/nav-items";
import { cn } from "@/lib/utils";

// The "All modules" companion to DashboardFrame, shown as the second slide of
// the phone/tablet carousel (see dashboard-carousel.tsx).
//
// Phones and tablets drop the dashboard's 256px sidebar (the labels would be
// unreadably small once scaled down), so this frame lists every module at a
// readable size instead. It is rendered from the app's own `navGroups`, exactly
// like the desktop sidebar, so it can never drift from the real product.
//
// Same stage language as DashboardFrame: navy rim + gold hairline, browser
// chrome, white app panel with its own text colour.

const SCHOOL = "Northgate Academy";

export function ModulesFrame({ className }: { className?: string }) {
  const moduleCount = navGroups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div
      className={cn(
        "relative rounded-2xl bg-marketing-navy-900 p-2 shadow-2xl",
        "ring-1 ring-marketing-gold-500/30",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in oklab, var(--brand-gold-500) 35%, transparent), transparent 40%)",
          mixBlendMode: "screen",
        }}
      />

      <div className="overflow-hidden rounded-xl bg-white">
        <div className="flex items-center gap-1.5 border-b border-border bg-secondary px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
          <span className="ml-3 truncate font-mono text-xs text-muted-foreground">
            app.educore.io/modules
          </span>
        </div>

        <div className="bg-background p-4 text-foreground" aria-hidden="true">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">All modules</h2>
            <p className="text-sm text-muted-foreground">
              {SCHOOL} · {moduleCount} modules, one platform
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {navGroups.map((group) => (
              <div key={group.label}>
                <p className="label-eyebrow mb-1.5">{group.label}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {group.items.map((item) => {
                    const subCount = item.children?.length ?? 0;
                    return (
                      <div
                        key={item.href}
                        className="panel flex min-w-0 items-center gap-2 px-2.5 py-2"
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary-subtle text-primary">
                          <item.icon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1 text-[0.8125rem] font-medium leading-tight">
                          {item.label}
                        </span>
                        {subCount > 0 ? (
                          <span className="flex shrink-0 items-center text-xs text-muted-foreground">
                            {subCount}
                            <ChevronRight className="size-3" />
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
