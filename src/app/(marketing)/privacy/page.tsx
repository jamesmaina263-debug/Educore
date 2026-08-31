import type { Metadata } from "next";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";

const TITLE = "Privacy Policy — EduCore";
const DESCRIPTION =
  "How EduCore Technologies Ltd collects, stores, and uses personal data across this website and the EduCore school-management application, including how student, parent, and staff data is handled under Kenya's Data Protection Act, 2019.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/privacy" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/privacy" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// This page has two parts, deliberately kept distinct rather than merged
// into one narrative, because they describe two different data flows with
// two different roles for EduCore:
//   Part A -- this marketing website (educoreafrica.com): EduCore is
//     the data controller for whatever you submit through the contact/demo
//     form. Small, self-contained, unchanged from the site's original
//     narrower privacy notice.
//   Part B -- the EduCore application, used by enrolled schools: EduCore is
//     the data processor, the School is the data controller, and the scope
//     (student, parent, staff, financial, biometric data) is much larger.
//     This is the substantive policy schools and families should read.
// Every statement here describes something verifiable in the codebase or
// confirmed directly with EduCore's founder (entity details, DPO, ODPC
// registration status) -- nothing is generic legal boilerplate, and the one
// known compliance gap (Section 9 of Part B, data localization) is
// disclosed rather than glossed over, per an explicit decision to keep that
// disclosure in when this page was finalized for publication.
export default function PrivacyPage() {
  return (
    <>
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Legal</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          This policy covers two things: this marketing website, and the
          EduCore school-management application used by enrolled schools.
          They&apos;re described separately below, because EduCore&apos;s
          role is different in each.
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/50">
          Effective August 31, 2026 · Published by EduCore Technologies Ltd
          (registration no. PVT-93SSQEELA), 7th Floor, Sanlam Towers, Waiyaki
          Way, Westlands, Nairobi, Kenya.
        </p>
      </Section>

      <Section tone="canvas">
        <div className="mx-auto max-w-3xl space-y-14">
          <div className="rounded-2xl border border-marketing-gold-500/30 bg-marketing-gold-500/10 p-6 text-sm leading-relaxed text-marketing-navy-950">
            <p className="font-semibold">Where things stand</p>
            <p className="mt-2 text-marketing-navy-900/80">
              This policy has been reviewed and approved by EduCore&apos;s
              founder for publication. It has not yet been reviewed by
              external legal counsel, and Part B includes one disclosed,
              unresolved item (data localization, Section 9) rather than
              claiming full compliance before that&apos;s addressed. This
              page will be updated as that review happens and as the Service
              changes.
            </p>
          </div>

          {/* ---------------------------------------------------------- */}
          {/* PART A -- this website                                     */}
          {/* ---------------------------------------------------------- */}

          <div>
            <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-marketing-navy-900/40">
              Part A
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-marketing-navy-950">
              This website
            </h2>
            <p className="mt-3 text-marketing-navy-900/75">
              This section covers only what happens when you use{" "}
              <span className="font-mono text-sm">educoreafrica.com</span>{" "}
              itself — not the application schools use once enrolled, which
              is covered in Part B below.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              What we collect
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              If you submit the contact/demo request form on this site, we
              collect the information you provide: your name, school name,
              role, email address, and phone number and message if you
              choose to include them. If you arrived via a marketing link
              containing campaign parameters (for example, from an ad or a
              shared link), we also record which campaign referred you at
              the time you submit the form, so we understand which channels
              are helpful. We do not collect this information anywhere else
              on the marketing site — pages you simply browse do not submit
              any personal information to us.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              How we store and use it
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              Demo request submissions are stored in a dedicated database
              table, separate from any school&apos;s student, academic, or
              financial records, and are only ever written to, never read
              back, by this website. Access is restricted to the EduCore
              team, and used solely to respond to your enquiry and arrange a
              demo. We do not sell this information, and we do not use it
              for advertising.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              Error monitoring, analytics, and cookies
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              This site uses Sentry to detect and diagnose technical errors.
              Default collection of personal data (such as IP addresses) is
              deliberately switched off in this configuration; Sentry
              receives only what is needed to identify and fix bugs, via an
              EU-region endpoint (see Section 9 in Part B for what that
              means for cross-border transfer).
            </p>
            <p className="mt-3 text-marketing-navy-900/75">
              This site uses Google Analytics (via Google Tag Manager) to
              understand aggregate visitor traffic — pages viewed, how
              visitors arrived, and general engagement — so we can see how
              the site is performing. This sets analytics cookies in your
              browser when you visit{" "}
              <span className="font-mono text-sm">educoreafrica.com</span>.
              It is scoped to this marketing website only; it is never
              active in the EduCore application that enrolled schools and
              families use, which instead uses a separate, cookie-less
              analytics tool (Plausible, described below) that does not
              track individuals. When you submit the contact/demo form,
              Google Analytics separately records that a form was
              submitted, so we can measure how many visitors convert into
              enquiries — it does not receive the name, email, phone
              number, or message you entered. We do not use Google
              Analytics for advertising or retargeting, and we do not share
              the data it collects with any third party beyond Google as
              the analytics processor.
            </p>
          </div>

          {/* ---------------------------------------------------------- */}
          {/* PART B -- the application                                  */}
          {/* ---------------------------------------------------------- */}

          <div className="border-t border-marketing-navy-900/10 pt-14">
            <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-marketing-navy-900/40">
              Part B
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-marketing-navy-950">
              The EduCore application
            </h2>
            <p className="mt-3 text-marketing-navy-900/75">
              This is the substantive policy for schools, parents/guardians,
              students, and staff using the EduCore school-management
              application (the &ldquo;Service&rdquo;).
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              1. Who this is for, and who does what
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              EduCore is used by <strong>Schools</strong> (the paying
              customer — a school, or group of schools) and by{" "}
              <strong>Users</strong> the School authorises: school owners,
              principals, administrators, teachers, finance and support
              staff, parents/guardians, and students.
            </p>
            <p className="mt-3 text-marketing-navy-900/75">
              For personal data relating to students, parents/guardians, and
              staff (&ldquo;School Personal Data&rdquo;),{" "}
              <strong>the School is the data controller</strong> under
              Kenya&apos;s Data Protection Act, 2019 (the &ldquo;DPA&rdquo;)
              — the School decides what data to collect and why.{" "}
              <strong>EduCore is the data processor</strong> — we process
              School Personal Data only to provide the Service, on the
              School&apos;s instructions, as set out in our Terms of Service
              and any Data Processing Addendum.
            </p>
            <p className="mt-3 text-marketing-navy-900/75">
              For personal data EduCore collects directly about the School
              itself as our customer (e.g., the school&apos;s own contact
              details, billing information, and the accounts of the
              individuals who administer the Account),{" "}
              <strong>EduCore is the data controller</strong>.
            </p>
            <p className="mt-3 text-marketing-navy-900/75">
              If you are a parent, guardian, student, or staff member and
              have a question about your own data, your school is your
              first point of contact — they control what&apos;s collected
              and why, and can action most requests directly. If your school
              is unable to help, you may also contact us using the details
              in Section 13.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              2. What we collect
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              Depending on which modules the School enables, the Service may
              process:
            </p>
            <div className="mt-4 overflow-hidden rounded-xl border border-marketing-navy-900/10">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-marketing-navy-900/10">
                  {[
                    ["Student identity & enrolment", "Name, date of birth, admission number, class/stream, guardian relationships"],
                    ["Academic records", "Grades, exam results, report-card comments (including AI-drafted, staff-reviewed comments), CBC competency assessments"],
                    ["Attendance", "Daily attendance records, biometric check-in timestamps (where the School enables biometric attendance)"],
                    ["Health & discipline", "Medical records relevant to school care (e.g., allergies, medication administered by school nurses), disciplinary records — only where the School's chosen modules collect these"],
                    ["Financial", "Fee invoices, payment records (via M-Pesa), payment history, discounts/scholarships/waivers"],
                    ["Communications", "Messages sent via the Service's WhatsApp/SMS integration (e.g., fee reminders, newsletters)"],
                    ["Staff", "Employment records, payroll data, statutory numbers (e.g., NSSF/SHIF), leave records"],
                    ["Guardian/parent", "Name, phone number, email, relationship to student"],
                    ["Technical", "Login activity, device/browser information, IP address (for security and troubleshooting)"],
                  ].map(([category, examples]) => (
                    <tr key={category}>
                      <td className="w-1/3 px-4 py-3 align-top font-medium text-marketing-navy-950">
                        {category}
                      </td>
                      <td className="px-4 py-3 align-top text-marketing-navy-900/75">
                        {examples}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-marketing-navy-900/75">
              We do not decide which of these categories a School collects —
              that is the School&apos;s decision, reflecting its own
              operations and legal obligations. We built the Service so a
              School only sees the modules (and therefore the data
              categories) it has actually enabled.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              3. Sensitive personal data
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              Under the DPA, <strong>biometric data and data concerning
              health are &ldquo;sensitive personal data,&rdquo;</strong>{" "}
              subject to stricter requirements than general personal data.
              Where a School enables biometric attendance or health/medical
              record-keeping, the School is responsible for obtaining
              explicit consent (from a parent/guardian for a student, or
              from staff for their own data) before that data is collected,
              consistent with DPA requirements for sensitive personal data.
              We support this technically (these modules are opt-in per
              School, and access to this data is more tightly restricted
              within the Service than general records), but the underlying
              consent is the School&apos;s responsibility to obtain and
              record.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              4. Children&apos;s data
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              Most students using the Service are children under Kenyan law
              (under 18). Consistent with DPA section 33, personal data
              relating to a child may only be processed with the consent of
              the child&apos;s parent or guardian, and where the processing
              is in the best interests of the child.{" "}
              <strong>This consent is obtained and recorded by the
              School</strong> as part of enrolment, not directly by EduCore
              — we are a processor acting on the School&apos;s instructions,
              not the party collecting consent from families. Schools should
              ensure their own enrolment/consent processes meet this
              standard.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              5. Why we process this data
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              We (as processor, on the School&apos;s instructions as
              controller) process School Personal Data for purposes
              including: delivering the modules the School has enabled
              (admissions, academics, attendance, finance, communication,
              staffing, etc.); enabling the School to communicate with
              parents/guardians; processing fee payments via M-Pesa and
              reconciling them against invoices; generating reports for the
              School&apos;s own use; maintaining the security and integrity
              of the Service; and complying with legal obligations that
              apply to us as a processor. The lawful basis for each of these
              (performance of a contract, legitimate interest, consent, or
              legal obligation, per DPA section 30) is ultimately the
              School&apos;s determination, since the School is the
              controller — our Data Processing Addendum sets out the basis
              on which we act.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              6. AI-assisted processing
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              The Service uses AI to draft report-card narrative comments
              (grounded in a student&apos;s recorded academic performance)
              and draft parent-facing WhatsApp/SMS messages.{" "}
              <strong>These drafts are always reviewed and approved by
              School staff before being finalised or sent</strong> — no
              AI-generated content reaches a parent, student, or permanent
              record without human review. We do not use automated
              processing to make decisions with legal or similarly
              significant effects on any individual (e.g., admissions,
              grading, or disciplinary outcomes) without meaningful human
              involvement.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              7. Who we share data with (sub-processors)
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              We use the following categories of third-party service to
              operate the Service. None of them are permitted to use School
              Personal Data for their own purposes.
            </p>
            <div className="mt-4 overflow-hidden rounded-xl border border-marketing-navy-900/10">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-marketing-navy-900/10">
                  {[
                    ["Supabase", "Database hosting, authentication, file storage", "All School Personal Data stored by the Service"],
                    ["Vercel", "Application hosting/CDN", "Technical/request data; no direct database access"],
                    ["Safaricom (M-Pesa)", "Fee payment processing", "Payment amount, phone number, transaction reference — not full financial account details"],
                    ["Twilio (WhatsApp Business API) / SMS gateway", "Sending parent communications the School initiates", "Recipient phone number, message content"],
                    ["Sentry", "Error monitoring", "Technical error data only — default PII collection is disabled in every environment. Ingest endpoint is EU-region (*.ingest.de.sentry.io) — see Section 9."],
                    ["Google Analytics (via Google Tag Manager)", "Website analytics (marketing site only, not the application)", "Aggregated visitor traffic (pages viewed, referral source, device/browser type) and anonymous form-submission events; sets analytics cookies on the marketing site only"],
                    ["Plausible", "Website analytics (marketing site only, not the application)", "Aggregated, cookie-less traffic data — not currently active"],
                  ].map(([name, purpose, data]) => (
                    <tr key={name}>
                      <td className="w-1/4 px-4 py-3 align-top font-medium text-marketing-navy-950">
                        {name}
                      </td>
                      <td className="w-1/4 px-4 py-3 align-top text-marketing-navy-900/75">
                        {purpose}
                      </td>
                      <td className="px-4 py-3 align-top text-marketing-navy-900/75">
                        {data}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-marketing-navy-900/75">
              We will update this list, and notify the School, if we change
              sub-processors in a way that affects how School Personal Data
              is handled.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              8. Data retention
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              We retain School Personal Data for as long as the
              School&apos;s Account is active, and for the periods described
              in our Terms of Service following termination (30 days for
              export, then deletion from active systems within a further 60
              days, subject to legal retention requirements and normal
              backup-rotation timing). Some records (e.g., payroll data
              relevant to tax obligations) may be subject to longer
              statutory retention periods, which are the School&apos;s
              responsibility to specify to us if they exceed our default
              schedule.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              9. International data transfers — current status
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              Our database infrastructure (Supabase) is hosted in the{" "}
              <strong>eu-central-1 region (Frankfurt, Germany)</strong>, and
              our error-monitoring provider (Sentry) also uses an EU-region
              ingest endpoint. This means data is transferred outside Kenya
              as part of normal Service operation — for Supabase, this
              includes the full range of School Personal Data; for Sentry,
              this is limited to technical error data with default PII
              collection explicitly disabled, which reduces but does not
              eliminate the transfer question, since error payloads can
              still incidentally include identifiers depending on where an
              error occurs.
            </p>
            <p className="mt-3 text-marketing-navy-900/75">
              <strong>This is flagged here deliberately, not glossed
              over.</strong> The DPA&apos;s cross-border transfer regime
              (sections 48–50) requires either an adequacy determination,
              appropriate safeguards, or another lawful transfer ground,
              before personal data leaves Kenya. Section 50 additionally
              imposes a heightened, specific requirement for certain
              categories of data controller/processor — including providers
              of basic (primary/secondary) education under the Basic
              Education Act — to keep at least one serving copy of personal
              data in a data centre located in Kenya. As a school-management
              platform serving Kenyan basic-education institutions, EduCore
              likely falls within that category, and{" "}
              <strong>we do not currently have a Kenya-based serving copy of
              the database</strong>. This is a genuine, unresolved item, not
              a documentation formality, and we are working through the
              engineering and legal steps required to address it.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              10. Data security
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              We maintain technical and organisational measures appropriate
              to the sensitivity of School Personal Data, including
              per-school data isolation at the database level (row-level
              security policies scope every school&apos;s data to that
              school), encryption of data in transit and at rest,
              role-based access control within the Service, security-definer
              database functions with pinned search paths and
              least-privilege grants to prevent privilege-escalation between
              tenants, restricted and encrypted access to M-Pesa credentials,
              and regular dependency and vulnerability review.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              11. Data breach notification
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              If we become aware of a security incident affecting School
              Personal Data, we will notify the affected School without
              undue delay, so the School can meet its own breach-notification
              obligations — including, where applicable, notifying the
              Office of the Data Protection Commissioner within the
              DPA&apos;s required timeframe and affected data subjects where
              required.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              12. Data subject rights
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              Individuals whose data is processed through the Service
              (students, via their parent/guardian; parents/guardians
              themselves; staff) have rights under the DPA, including to be
              informed of how their data is used, to access it, to request
              correction of inaccurate data, to object to certain
              processing, and to request erasure or data portability,
              subject to the conditions in the DPA.
            </p>
            <p className="mt-3 text-marketing-navy-900/75">
              <strong>Because the School is the data controller</strong>,
              these requests should generally go to the School first — they
              hold the records and are best placed to action most requests
              directly within the Service. Where a request requires our
              assistance, we support the School in fulfilling it. If
              you&apos;re unable to resolve a request with your school, you
              may contact us at{" "}
              <a
                href="mailto:dpo@educore.co.ke"
                className="text-marketing-blue underline underline-offset-2"
              >
                dpo@educore.co.ke
              </a>
              .
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              13. Contact and Data Protection Officer
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              Email:{" "}
              <a
                href="mailto:dpo@educore.co.ke"
                className="text-marketing-blue underline underline-offset-2"
              >
                dpo@educore.co.ke
              </a>
              <br />
              Data Protection Officer: James Maina, Founder
              <br />
              ODPC registration: EduCore Technologies Ltd is registered with
              the Office of the Data Protection Commissioner as required
              under the Data Protection Act, 2019.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-marketing-navy-950">
              14. Changes to this policy
            </h3>
            <p className="mt-3 text-marketing-navy-900/75">
              We will update this policy as the Service or our data
              practices change, and will notify Schools of material changes
              with reasonable notice, consistent with our Terms of Service.
            </p>
          </div>

          <p className="text-xs text-marketing-navy-900/50">
            Last updated: August 30, 2026.
          </p>
        </div>
      </Section>
    </>
  );
}
