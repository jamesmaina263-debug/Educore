import type { Metadata } from "next";
import Link from "next/link";
import { Camera, Fingerprint, MessageSquareWarning, Server, ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";
import { BlogByline } from "@/components/marketing/blog-byline";

const SLUG = "data-protection-act-kenya-schools-guide";
const PATH = `/blog/${SLUG}`;
const PUBLISHED_ON = "2026-09-20";
const TITLE = "Data Protection Act for Kenyan Schools — EduCore";
const DESCRIPTION = "What Kenya's Data Protection Act asks of schools: ODPC registration, parental consent, biometric data, the 72-hour breach rule, vendor questions.";
const ODPC_EDUCATION_NOTE = "https://www.odpc.go.ke/wp-content/uploads/2024/02/ODPC-Guidance-Note-for-the-Education-Sector.pdf";
const ODPC_CHILDREN_NOTE =
  "https://www.odpc.go.ke/wp-content/uploads/2025/11/ODPC-%E2%80%93-Guidance-Note-for-Processing-Childrens-Data.pdf";
const REGS_2021 = "https://new.kenyalaw.org/akn/ke/act/ln/2021/263/eng@2022-01-14";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PATH, images: ["/og-image.png"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og-image.png"] },
};

// Sourcing (researched Sep 2026; primary sources read directly):
//   - ODPC "Guidance Note for the Education Sector" (Dec 2023), read in full:
//     mandatory registration for education institutions regardless of size or
//     turnover; privacy notice contents; consent (minors cannot give it, a
//     parent/guardian must); sensitive-data definition (includes health,
//     biometric, and family details); 7-day access-request response;
//     portability in a structured machine-readable format; 72-hour breach
//     report to the ODPC and written notice to affected data subjects;
//     written processor contract elements; the privacy concerns it lists
//     (results on notice boards, WhatsApp-group disclosures, photos without
//     consent, CCTV in boarding schools, vendors reusing data).
//   - Data Protection (General) Regulations 2021, reg 26 (Kenya Law, seen via
//     search snippet -- the site blocks automated fetching): processing for
//     the purpose of offering early childhood and basic education under the
//     Basic Education Act must be done through a server and data centre in
//     Kenya, or with at least one serving copy stored in a Kenyan data centre.
//   - ODPC penalty notices reported by Clyde & Co (Oct 2023): a school fined
//     KSh 4.55 million for posting images of minors without parental consent;
//     administrative fines of up to KSh 5 million.
// EduCore statements mirror the live /privacy page (Part B), which the founder
// approved for publication -- including section 9, the disclosed data
// localisation gap. This post must not say anything that page does not, and
// must be updated when that page changes (e.g. once a Kenya-based copy exists).
// This is general information, not legal advice, and the page says so.

const FAQS = [
  {
    q: "Does a school have to register with the ODPC?",
    a: "Yes. The ODPC's education-sector guidance says institutions in the education sector are expected to register as data controllers or processors, and that education institutions are subject to mandatory registration regardless of size or turnover. Registration is done through the ODPC.",
  },
  {
    q: "Can we post photos of pupils on our website or social media?",
    a: "Only with the parent or guardian's consent, obtained for that purpose. A child's image is personal data. In 2023 the ODPC fined a school KSh 4.55 million for posting images of minors without parental consent, according to law-firm reports of the penalty notices.",
  },
  {
    q: "Is it acceptable to pin exam results on the notice board or post them in a class WhatsApp group?",
    a: "The ODPC's guidance lists both as privacy concerns and says schools should get parental consent before publishing children's results, with an option to publish names without scores. Many schools find it simpler to send each parent their own child's results directly.",
  },
  {
    q: "How quickly must we answer a parent's request for their child's data?",
    a: "The General Regulations give seven days from receipt of a data access request. A parent or guardian can request access on behalf of a child, including academic, disciplinary and health records.",
  },
  {
    q: "What do we do if student data is leaked or lost?",
    a: "Report it to the ODPC without delay and within 72 hours of becoming aware, and tell affected people in writing within a reasonable period. Keep a written record of what happened and what you did. If a vendor holds the data, your contract should oblige them to tell you promptly.",
  },
  {
    q: "Must school data be stored in Kenya?",
    a: "Regulation 26 of the General Regulations requires processing for the purpose of offering early childhood and basic education to be done through a server and data centre in Kenya, or with at least one serving copy stored in a Kenyan data centre. How that applies to a particular school and vendor is a legal question, so ask your vendor where data is stored and take advice if the answer is unclear. EduCore's current position is set out above.",
  },
];

const SITUATIONS = [
  {
    icon: MessageSquareWarning,
    title: "Marks, arrears and discipline in WhatsApp groups",
    body: "The ODPC lists disclosing academic records, fee balances, behavioural issues or health information to a wider group as a privacy concern. Message each parent about their own child.",
  },
  {
    icon: Camera,
    title: "Photos and results in public",
    body: "Prospectus photos, website galleries, and top-performer lists all need parental consent for the specific use. General crowd shots where no child is identifiable are the ODPC's suggested safer option.",
  },
  {
    icon: Fingerprint,
    title: "Biometric attendance and health records",
    body: "Biometric and health data are sensitive personal data. The guidance expects explicit consent, a clear purpose, and biometrics only where nothing less intrusive will do. CCTV in boarding areas is flagged as high-risk.",
  },
  {
    icon: Server,
    title: "Handing data to software vendors",
    body: "A vendor holding student data is your processor. You stay responsible as controller, so the vendor should be bound by a written contract and chosen with due diligence.",
  },
];

const OBLIGATIONS = [
  {
    q: "Register with the ODPC",
    a: "Mandatory for education institutions, whatever their size. Registration is separate from having a privacy policy.",
  },
  {
    q: "Tell people what you do with their data",
    a: "Give a plain-language privacy notice at enrolment: what you collect, why, who receives it, how long you keep it, security measures, their rights and who to contact. Give a copy again at the start of each year if you can.",
  },
  {
    q: "Get valid consent where you rely on it",
    a: "For a child, that means a parent or guardian, freely given, specific and informed, and withdrawable without penalty. The ODPC suggests verifying the person giving consent really is the parent or guardian.",
  },
  {
    q: "Collect less, keep it for less time",
    a: "Ask only for what a stated purpose needs. Set retention periods, and destroy records securely when they expire. The guidance recommends reviewing the accuracy of records yearly.",
  },
  {
    q: "Honour people's rights",
    a: "Access within seven days, correction of wrong records, erasure where there is no reason to keep the data, and a copy in a structured, machine-readable format for portability.",
  },
  {
    q: "Secure it and be ready for a breach",
    a: "Access controls, backups, encrypted transmission, staff training and a written incident plan. Report a breach to the ODPC within 72 hours of becoming aware and tell affected people in writing.",
  },
  {
    q: "Assess high-risk processing",
    a: "A data protection impact assessment is required where processing is likely to be high risk, and the ODPC recommends one when it is unclear. Biometrics and large-scale tracking of children are the obvious candidates.",
  },
];

const VENDOR_QUESTIONS = [
  "Will you sign a written data processing agreement that binds you to act only on our instructions?",
  "Where is our data stored, and which sub-processors touch it?",
  "Do you use our data for advertising, analytics of your own, or anything beyond running our service?",
  "How and when do we get our data back, and when do you delete it?",
  "How fast will you tell us about a breach?",
  "Are biometric and health features opt-in, with access restricted more tightly than ordinary records?",
];

export default function DataProtectionActKenyaSchoolsGuidePost() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          HOME_CRUMB,
          { name: "Blog", path: "/blog" },
          { name: "Data Protection Act for Kenyan Schools", path: PATH },
        ]}
      />
      <ArticleJsonLd headline={TITLE} description={DESCRIPTION} path={PATH} datePublished={PUBLISHED_ON} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          The Data Protection Act for Kenyan Schools: A Practical Guide
        </h1>
        <BlogByline publishedOn={PUBLISHED_ON} />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          A school holds some of the most sensitive data there is: children&apos;s
          names, families, health notes, discipline records and fee
          histories. Kenya&apos;s Data Protection Act applies to all of it, and
          the regulator has already fined a school for posting pupils&apos;
          photos without consent. This guide sets out what the ODPC actually
          asks of schools, in plain terms.
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/50">
          General information, not legal advice. Read the ODPC&apos;s own{" "}
          <a
            href={ODPC_EDUCATION_NOTE}
            target="_blank"
            rel="noopener noreferrer"
            className="text-marketing-gold-400 underline underline-offset-4"
          >
            Guidance Note for the Education Sector
          </a>{" "}
          and take advice for your school&apos;s situation.
        </p>
      </Section>

      {/* 2 — Roles */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Start Here</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Your school is the data controller
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              The Act separates the organisation that decides why and how
              personal data is used, the <strong className="font-semibold text-marketing-navy-950">controller</strong>,
              from one that handles it on the controller&apos;s behalf, the{" "}
              <strong className="font-semibold text-marketing-navy-950">processor</strong>. A school
              deciding to collect admission details, take attendance and
              publish results is the controller. A software vendor storing
              that data for you is a processor.
            </p>
            <p>
              The point that surprises many principals: handing data to a
              vendor does not hand over the responsibility. The ODPC expects
              schools to choose processors that give sufficient guarantees
              and to bind them with a written contract. If something goes
              wrong with data a vendor holds, the regulator will still
              come to the school first.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 3 — Seven obligations */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">What The ODPC Expects</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Seven things every school should have in place
          </h2>
          <ol className="mt-8 flex flex-col gap-6">
            {OBLIGATIONS.map((o, i) => (
              <li key={o.q} className="flex gap-4">
                <span className="mt-0.5 font-mono text-sm text-marketing-gold-400">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="text-base font-semibold text-white">{o.q}</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">{o.a}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-sm leading-relaxed text-white/60">
            The ODPC&apos;s guidance note ends with a compliance checklist that
            maps to all of these. It is worth printing and walking through
            with your board.
          </p>
        </Reveal>
      </Section>

      {/* 4 — Everyday situations */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>Where Schools Get Caught</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Four everyday situations
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/70">
            None of these needs new software. They need a decision and a
            written rule.
          </p>
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-2">
          {SITUATIONS.map((s) => (
            <Reveal key={s.title}>
              <s.icon className="h-5 w-5 text-marketing-gold-600" strokeWidth={1.75} />
              <p className="mt-3 text-sm font-semibold text-marketing-navy-950">{s.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">{s.body}</p>
            </Reveal>
          ))}
        </div>
        <Reveal className="mx-auto mt-10 max-w-3xl">
          <p className="text-sm leading-relaxed text-marketing-navy-900/60">
            The ODPC has also published a{" "}
            <a
              href={ODPC_CHILDREN_NOTE}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-marketing-navy-950 underline underline-offset-4"
            >
              guidance note on processing children&apos;s data
            </a>
            , which is the place to go for consent, age and parental
            verification in more detail.
          </p>
        </Reveal>
      </Section>

      {/* 5 — Choosing a vendor + localisation */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Choosing Software</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Six questions for any school-software vendor
          </h2>
          <ul className="mt-6 flex flex-col gap-3 text-base leading-relaxed text-white/75">
            {VENDOR_QUESTIONS.map((q) => (
              <li key={q} className="flex gap-3">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-marketing-gold-400" />
                <span>{q}</span>
              </li>
            ))}
          </ul>
          <h3 className="mt-10 text-xl font-semibold text-white">A rule about where data lives</h3>
          <div className="mt-4 flex flex-col gap-4 text-base leading-relaxed text-white/75">
            <p>
              Under Regulation 26 of the{" "}
              <a
                href={REGS_2021}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-marketing-gold-400 underline underline-offset-4"
              >
                Data Protection (General) Regulations, 2021
              </a>
              , personal data processed for the purpose of offering early
              childhood and basic education must be processed through a
              server and data centre in Kenya, or at least one serving copy
              must be stored in a data centre in Kenya. Software
              hosted in the cloud may run on servers outside Kenya, so this
              is a question worth putting to every vendor in writing. How the
              rule applies to a given school and arrangement is a legal
              question; take advice if the answer is unclear.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 6 — EduCore's position */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Our Own Answers</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            How EduCore answers, including the part we haven&apos;t solved
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              For school data, EduCore acts as the processor and the school
              is the controller. EduCore Technologies Ltd states in its{" "}
              <Link href="/privacy" className="font-semibold text-marketing-navy-950 underline underline-offset-4">
                privacy policy
              </Link>{" "}
              that it is registered with the ODPC and names a data
              protection officer. The biometric attendance and health record
              modules are opt-in for each school, with tighter access than
              ordinary records, and the school remains responsible for
              obtaining the explicit consent those data require. If EduCore
              becomes aware of a security incident affecting a school&apos;s
              data, it notifies the school without undue delay so the school
              can meet its own reporting duties. A school owner or principal
              can export the school&apos;s core records to Excel at any time.
            </p>
            <p>
              <strong className="font-semibold text-marketing-navy-950">The unresolved part:</strong>{" "}
              EduCore&apos;s database is hosted in the EU (Frankfurt, Germany),
              and its error-monitoring provider also uses an EU endpoint.
              We do not currently have a Kenya-based serving copy of the
              database, and as a platform serving Kenyan basic-education
              schools we likely fall within Regulation 26. We say so in our
              privacy policy, we are working through the engineering and
              legal steps to address it, and we would rather you hear it
              from us than discover it. If this matters for your school,
              raise it with us and with your adviser before you sign up.
              Details on sub-processors are in{" "}
              <Link href="/privacy" className="font-semibold text-marketing-navy-950 underline underline-offset-4">
                Part B of the privacy policy
              </Link>
              , and our approach to isolation and access is on the{" "}
              <Link href="/security" className="font-semibold text-marketing-navy-950 underline underline-offset-4">
                security page
              </Link>
              .
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 7 — FAQ */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Common Questions</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Frequently asked questions
          </h2>
          <div className="mt-8 flex flex-col gap-6">
            {FAQS.map((f) => (
              <div key={f.q}>
                <p className="text-base font-semibold text-white">{f.q}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/70">{f.a}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-xs leading-relaxed text-white/50">
            This guide summarises publicly available ODPC guidance and
            legislation as of September 2026 and is general information,
            not legal advice. EduCore is not affiliated with the ODPC. Check
            the current text of the Act, regulations and guidance notes, and
            take advice from a Kenyan advocate for your school&apos;s
            circumstances.
          </p>
        </Reveal>
      </Section>

      {/* 8 — CTA */}
      <Section tone="canvas" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow>Questions?</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-marketing-navy-950 sm:text-4xl">
            Ask us the hard questions before you decide.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/70">
            Bring the vendor checklist above to a demo. We will answer each
            one directly.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href="/contact">
                Book a Demo <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline">
              <Link href="/privacy">Read the Privacy Policy</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
