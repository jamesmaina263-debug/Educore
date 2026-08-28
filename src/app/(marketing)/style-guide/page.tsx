import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { DashboardFrame } from "@/components/marketing/dashboard-frame";

// TEMPORARY -- Phase 2 QA only. Not a real marketing page, not linked from
// any nav. Delete this file (and the "style-guide" NEVER_PREFIX entry) once
// the design system below has been reviewed and approved.
export default function StyleGuidePage() {
  return (
    <>
      <Section tone="canvas">
        <Eyebrow tone="dark">Design System — Phase 2 QA</Eyebrow>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-5xl">
          Colour, type, and the signature element
        </h1>
        <p className="mt-4 max-w-xl text-marketing-navy-900/70">
          This page exists only to review the Phase 2 design system before any
          real homepage copy is written.
        </p>
      </Section>

      <Section tone="canvas">
        <Eyebrow tone="dark">Colour</Eyebrow>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { name: "Navy Ink", cls: "bg-marketing-navy-900", hex: "#0A1730" },
            { name: "Navy Deep", cls: "bg-marketing-navy-950", hex: "#060C1F" },
            { name: "Gold Signal", cls: "bg-marketing-gold-500", hex: "#D9A627" },
            { name: "Gold Soft", cls: "bg-marketing-gold-300", hex: "#F2D182" },
            { name: "Core Blue", cls: "bg-marketing-blue", hex: "#0057C7" },
            { name: "Canvas", cls: "bg-marketing-canvas border border-marketing-navy-900/10", hex: "#FCFCFA" },
          ].map((c) => (
            <div key={c.name}>
              <div className={`h-20 rounded-lg ${c.cls}`} />
              <p className="mt-2 text-sm font-medium text-marketing-navy-950">{c.name}</p>
              <p className="font-mono text-xs text-marketing-navy-900/60">{c.hex}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="canvas">
        <Eyebrow tone="dark">Type</Eyebrow>
        <div className="mt-6 space-y-6">
          <div>
            <p className="font-mono text-xs text-marketing-navy-900/50">
              Inter 800 — display headline
            </p>
            <p className="text-5xl font-extrabold tracking-tight text-marketing-navy-950">
              School operations, connected.
            </p>
          </div>
          <div>
            <p className="font-mono text-xs text-marketing-navy-900/50">
              Inter 400/500 — body
            </p>
            <p className="max-w-xl text-lg text-marketing-navy-900/80">
              EduCore brings admissions, academics, finance, and communication
              into one platform your whole school actually uses.
            </p>
          </div>
          <div>
            <p className="font-mono text-xs text-marketing-navy-900/50">
              IBM Plex Mono — structural / data label
            </p>
            <p className="font-mono text-sm uppercase tracking-[0.14em] text-marketing-navy-950">
              12 modules · 1 platform
            </p>
          </div>
        </div>
      </Section>

      <Section tone="canvas">
        <Eyebrow tone="dark">Buttons</Eyebrow>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <MarketingButton>Book a Demo</MarketingButton>
          <MarketingButton variant="outline">Explore EduCore</MarketingButton>
          <MarketingButton variant="ghost">Ghost</MarketingButton>
          <MarketingButton variant="link">Link style</MarketingButton>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg bg-marketing-navy-950 p-6">
          <MarketingButton>Book a Demo</MarketingButton>
          <MarketingButton variant="outline-on-dark">Explore EduCore</MarketingButton>
          <MarketingButton variant="ghost-on-dark">Ghost on dark</MarketingButton>
        </div>
      </Section>

      <Section tone="navy">
        <Eyebrow tone="light">Signature element</Eyebrow>
        <h2 className="mt-4 max-w-lg text-3xl font-extrabold tracking-tight sm:text-4xl">
          The Dashboard Frame
        </h2>
        <p className="mt-3 max-w-lg text-white/70">
          Navy/gold marketing stage on the outside. The real, unmodified
          product design system on the inside.
        </p>
        <div className="mt-10 max-w-xl">
          <DashboardFrame />
        </div>
      </Section>
    </>
  );
}
