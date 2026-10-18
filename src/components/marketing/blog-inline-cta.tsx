import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Container } from "@/components/marketing/section";

const WHATSAPP_NUMBER = "254702904562";

// A compact, mid-article call to action for blog posts. Readers of these guides arrive from search
// researching a topic (KJSEA records, CBC assessment, the Data Protection Act...), not shopping for
// software, and the posts' only prompt used to sit at the very bottom of a long page.
//
// Click tracking needs no wiring here: the delegated listener in analytics.tsx already reports any
// link to /contact or wa.me with the page it was clicked on, so each click shows up in the admin
// "CTA clicks" table against the post's own address. The button texts below are deliberately
// different from the end-of-post "Book a Demo" so the two placements can be told apart in that
// table (the label is the link's visible text).
export function BlogInlineCta({
  headline,
  body,
  topic,
}: {
  headline: string;
  body: string;
  /** Short topic used to prefill the WhatsApp message, e.g. "KJSEA SBA records". */
  topic: string;
}) {
  const whatsappHref = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    `Hi, I read your guide on ${topic} and I'd like to know more about EduCore for my school.`,
  )}`;

  return (
    <div className="bg-marketing-canvas py-8 sm:py-12">
      <Container>
        <aside
          aria-label="Talk to EduCore"
          className="mx-auto max-w-3xl rounded-xl border border-marketing-navy-900/10 bg-white p-6 shadow-sm sm:p-8"
        >
          <p className="text-lg font-semibold tracking-tight text-marketing-navy-950 sm:text-xl">{headline}</p>
          <p className="mt-2 text-base leading-relaxed text-marketing-navy-900/75">{body}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <MarketingButton asChild>
              <Link href="/contact">
                See it with your classes <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild variant="outline">
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                Ask us on WhatsApp
              </a>
            </MarketingButton>
          </div>
        </aside>
      </Container>
    </div>
  );
}
