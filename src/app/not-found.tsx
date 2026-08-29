import Link from "next/link";
import type { Metadata } from "next";

import { MarketingNav } from "@/components/marketing/nav";
import { MarketingFooter } from "@/components/marketing/footer";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { MarketingButton } from "@/components/marketing/button";

// Global 404 (Next.js app-router convention: src/app/not-found.tsx catches
// every unmatched route site-wide). Deliberately reuses the marketing
// nav/footer directly rather than relying on the (marketing) layout, since
// route groups don't wrap files outside their own tree -- without this, a
// visitor hitting a dead/mistyped link would drop straight to an unbranded
// blank page, which is a bad first impression exactly on the page most
// likely to be someone's actual first impression.
export const metadata: Metadata = {
  title: "Page not found — EduCore",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="flex min-h-full flex-col bg-marketing-canvas">
      <MarketingNav />
      <main className="flex-1">
        <section className="mx-auto flex max-w-3xl flex-col items-start px-6 py-28 sm:py-36">
          <Eyebrow>404</Eyebrow>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-marketing-navy-950 sm:text-5xl">
            That page doesn&apos;t exist.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-marketing-navy-900/70">
            The link may be out of date, or the page may have moved. Here are
            a couple of places to pick up from instead.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <MarketingButton asChild>
              <Link href="/">Back to homepage</Link>
            </MarketingButton>
            <MarketingButton asChild variant="outline">
              <Link href="/contact">Contact us</Link>
            </MarketingButton>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
