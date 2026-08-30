import type { ReactNode } from "react";
import {
  BarChart3,
  CalendarCheck,
  GraduationCap,
  Users,
} from "lucide-react";

const BRAND_HIGHLIGHTS = [
  { icon: GraduationCap, label: "Academics" },
  { icon: Users, label: "Students" },
  { icon: CalendarCheck, label: "Attendance" },
  { icon: BarChart3, label: "Reports" },
];

/**
 * Shared shell for the two unauthenticated sign-in surfaces (staff email
 * login and parent/student phone-OTP login). Owns the branded navy/gold
 * panel and the responsive collapse to a single-panel layout with a
 * compact logo badge -- everything auth-specific (form fields, step
 * state, submit handlers) stays in the page that renders as `children`.
 */
export function AuthLayout({
  children,
  contentClassName = "max-w-sm",
}: {
  children: ReactNode;
  /** Width of the form column. Defaults to the original narrow single-field-column width (login/parent-login); signup's wider multi-column form overrides this. */
  contentClassName?: string;
}) {
  return (
    <div className="grid min-h-screen w-full bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Brand panel — desktop/tablet only. The one deliberately branded,
          non-neutral surface in the product; see the brand-* tokens in
          globals.css. */}
      <div
        className="relative hidden flex-col overflow-hidden px-14 py-14 lg:flex xl:px-20"
        style={{
          background:
            "radial-gradient(1100px 620px at 8% -10%, var(--brand-navy-800) 0%, transparent 55%), linear-gradient(165deg, var(--brand-navy-900) 0%, var(--brand-navy-950) 100%)",
        }}
      >
        {/* Subtle dot-grid texture — decoration only. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.5) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
        {/* Soft gold glow, bottom-left — very low opacity, purely atmospheric. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-32 h-96 w-96 rounded-full opacity-[0.12] blur-3xl"
          style={{ background: "var(--brand-gold-400)" }}
        />

        <div className="relative flex flex-1 flex-col justify-center gap-14">
          <div>
            <div className="inline-flex rounded-xl bg-white/[0.97] px-5 py-4 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35)]">
              <img
                src="/educore-logo-lockup.png"
                alt="EduCore — School Management System"
                className="h-14 w-auto xl:h-16"
              />
            </div>
          </div>

          <div className="max-w-md space-y-10">
            <p
              className="text-lg italic leading-relaxed"
              style={{ color: "var(--brand-gold-300)" }}
            >
              Smarter Schools. Brighter Futures.
            </p>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
              {BRAND_HIGHLIGHTS.map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.06)",
                      borderColor: "rgba(217,166,39,0.3)",
                      color: "var(--brand-gold-400)",
                    }}
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <dt className="text-sm font-medium text-white/80">{label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <p className="relative text-xs text-white/40">
          © {new Date().getFullYear()} EduCore. Built for modern school
          administration.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center px-6 py-14 sm:px-10 lg:px-16 xl:px-24">
        <div className={`w-full ${contentClassName}`}>
          {/* Compact brand mark — mobile/tablet only, where the brand panel
              above is hidden. */}
          <div className="mb-10 flex justify-center lg:hidden">
            <div className="inline-flex rounded-lg border border-border bg-white px-3 py-2 shadow-sm">
              <img
                src="/educore-logo-lockup.png"
                alt="EduCore — School Management System"
                className="h-9 w-auto"
              />
            </div>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
