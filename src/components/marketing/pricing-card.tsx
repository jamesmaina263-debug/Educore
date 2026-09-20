import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarketingButton } from "@/components/marketing/button";
import { TRIAL_TERMS } from "@/lib/marketing/trial";

// One tier on the Pricing page. Real pricing (Sep 2026): a flat KES 100 per
// student, per term, the same across all three tiers -- tiers differ by
// module coverage and support, not price. Published with a "starting at"
// qualifier (priceLine/priceNote below) rather than an absolute figure, so
// the page stays accurate if the rate is revisited later without implying
// it was ever hidden.
export function PricingCard({
  name,
  tagline,
  studentCap,
  billingNote,
  priceLine,
  priceNote,
  features,
  ctaLabel,
  ctaHref,
  ctaTier,
  className,
}: {
  name: string;
  tagline: string;
  studentCap: string;
  billingNote: string;
  // e.g. "From KES 100" -- the headline price figure for this tier.
  priceLine: string;
  // e.g. "/ student / term" -- unit qualifier shown next to priceLine.
  priceNote: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  // Which tier this card's CTA represents, e.g. "Starter" -- surfaced as a
  // data attribute so the site-wide CTA click tracker (analytics.tsx) can
  // tell tiers apart even though all three currently share the same
  // visible label ("Talk to Sales"). Purely a non-content analytics tag,
  // never rendered or sent to the server.
  ctaTier?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border border-marketing-navy-900/10 bg-white p-8",
        className,
      )}
    >
      <h3 className="text-lg font-semibold text-marketing-navy-950">{name}</h3>
      <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/65">
        {tagline}
      </p>

      <div className="mt-6 border-t border-marketing-navy-900/10 pt-6">
        <p className="text-2xl font-semibold text-marketing-navy-950">
          {priceLine}{" "}
          <span className="text-sm font-normal text-marketing-navy-900/60">
            {priceNote}
          </span>
        </p>
        <p className="mt-1 text-sm font-medium text-marketing-navy-950">
          {TRIAL_TERMS}
        </p>
        <p className="mt-1 text-sm text-marketing-navy-900/70">
          Final quote confirmed with you before you pay
        </p>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-marketing-navy-900/10 pt-6 text-sm">
        <div>
          <dt className="text-marketing-navy-900/60">Students</dt>
          <dd className="mt-0.5 font-medium text-marketing-navy-950">{studentCap}</dd>
        </div>
        <div>
          <dt className="text-marketing-navy-900/60">Billing</dt>
          <dd className="mt-0.5 font-medium text-marketing-navy-950">{billingNote}</dd>
        </div>
      </dl>

      <ul className="mt-6 flex-1 space-y-3 border-t border-marketing-navy-900/10 pt-6">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-marketing-navy-900/75">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-marketing-blue" strokeWidth={2} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <MarketingButton asChild variant="outline" className="mt-8 w-full">
        <Link href={ctaHref} data-cta-tier={ctaTier}>
          {ctaLabel}
        </Link>
      </MarketingButton>
    </div>
  );
}
