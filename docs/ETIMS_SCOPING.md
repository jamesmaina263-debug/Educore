# KRA eTIMS: scoping report (WP 6.5)

Status: scoping only. **Nothing is built, no code or database object changes, and no KRA call is made.**
Prepared 2026-11-03 from a read of this repository and public KRA material. eTIMS is Phase 9 work: any build needs its
own audit document and explicit owner approval (per the gap-closure handover). C2B, payments processing and WhatsApp are out of
scope and untouched.

This is a product and engineering scoping note, **not tax or legal advice**. Anything marked "confirm" must be settled with
KRA or the owner's tax adviser before a design is committed.

## 1. What the rules say (and how sure we are)

| Claim | Source | Confidence |
|---|---|---|
| Persons in business who are not required to register for VAT, "schools supplying education services" named explicitly, must still onboard eTIMS and issue electronic tax invoices. | KRA, "What is eTIMS" (kra.go.ke) | High (KRA primary) |
| The reason it is not VAT-only: since 1 Jan 2024 a business expense is only claimable if supported by an electronic tax invoice. | KRA, "What is eTIMS" | High (KRA primary) |
| Education is VAT-exempt, but exemption does not remove the eTIMS duty; eTIMS applies to exempt supplies too. | KKCO FAQ (law-firm article); KPMG Kenya 2026 note | Medium (secondary, consistent with KRA page above) |
| From 1 Jan 2026 iTax validates income-tax returns against eTIMS and other KRA datasets. | KPMG Kenya 2026 note; invoicemonk explainer | Medium (secondary) |
| Software can connect through KRA's OSCU (online) or VSCU (virtual) system-to-system interfaces, either self-integrated or via a **KRA-certified third-party integrator**. Certification needs sandbox testing, an application with documents and issues an interim approval certificate. KRA publishes a list of approved integrators. | KRA eTIMS portal and KRA services page | High (KRA primary) |
| KRA's own "Online Portal" option is aimed at taxpayers in the **service sector where no goods are supplied**. | KRA eTIMS FAQ | High (KRA primary) |
| A credit note can only be generated from the same solution where the original invoice was raised. | KRA services page | High (KRA primary) |
| "Every business invoice over KES 100 must be issued through eTIMS." | One blog (helloduty) | **Unverified: do not rely on it. Confirm.** |
| Buyer PIN is validated before an invoice is finalised. | One blog (invoicemonk) | **Unverified for individual (parent) buyers. Confirm.** |

Open-source eTIMS client libraries exist (PHP, Python, Node). They are third-party, mostly alpha, and say production use needs
KRA's approval of the integration. They are useful as reading material for the message shapes, **not** a shortcut around certification.

## 2. What EduCore issues today (verified in this repo)

There are three different documents, with three different tax positions. They should not be designed as one thing.

**A. School to parent (the big one).** Per student per term: `invoices` (`total_amount`, status unpaid / partially_paid / paid,
unique per student and term) with `invoice_items` (name and amount). Numbers come from `generate_invoice_number(school)`, school-prefixed and
locked against concurrent duplicates. Each payment gets a `receipts` row (`receipt_number`, unique per school). Money can come back
out of an invoice through `payment_reversals`, `discounts` and `fee_waivers`. **No document here carries tax fields, buyer PIN,
item or tax classification codes, or any eTIMS reference.** Education fees are VAT-exempt, so the tax class would be exempt, but see section 5.

**B. EduCore to school (subscriptions).** `platform_invoices` already has `invoice_number`, a school snapshot including `kra_pin`
(`bill_to`), and optional `tax_label` / `tax_rate_percent` / `tax_kes` (tax is **off by default** in billing settings).
Whether EduCore itself must charge VAT on subscriptions depends on EduCore's own VAT registration, which this repo cannot tell us. **Confirm with the owner.**
EduCore is the taxpayer here, so this is the simplest first integration: one issuer, one PIN, one device.

**C. Supplier to school (expenses).** `supplier_invoices` stores the supplier's `invoice_number`, date and amount only. Schools must hold a supplier's eTIMS invoice
to claim the expense, and EduCore currently records no eTIMS reference, so a school cannot tell from EduCore which of its expenses are
supported.

Related facts that shape any design:
- `schools.kra_pin` exists but its column comment says it is the **employer PIN printed on payslips**. Whether it is the same PIN the school must invoice under is unconfirmed, and it is free text with no format check.
- No parent or guardian PIN is stored.
- Per-school secrets already have a pattern: M-Pesa credentials are stored through Supabase Vault (`vault.secrets` ids on the settings row). eTIMS device keys and tokens would reuse that, not plain columns.
- Per-school scheduled work already has a pattern: cron routes under `src/app/api/cron/*` plus idempotent database functions. An eTIMS submit queue with retries would follow it.
- Money columns are `numeric(10,2)`. eTIMS amounts are VAT-inclusive, calculated per line, so rounding rules must be pinned before any build.

## 3. How the objects would map (if built; all unconfirmed)

| EduCore | eTIMS idea | Note |
|---|---|---|
| Fee invoice line (`invoice_items`) | Sale line, a service item, tax class exempt | Fees for uniform, books or boarding extras may be goods or a different tax class. Needs a per-fee tax class, which does not exist today. |
| Receipt (`receipts`) | A sales receipt, or the invoice itself | **Timing question:** issue at invoicing time or at payment time? Changes the whole design. Confirm. |
| `discounts`, `fee_waivers` reducing a raised invoice | Credit note referencing the original | Credit notes can only come from the solution that raised the original. Mixed use (portal then EduCore) would break this. |
| `payment_reversals` | Probably a credit note or amended invoice | A reversed payment is not obviously a change to the *sale*. Confirm. |
| `platform_invoices` | Sale invoice from EduCore to a school | Cleanest case. Buyer is a business with a PIN already captured. |
| `supplier_invoices` | Purchase record; store the supplier's control-unit number / QR | Capture only. No KRA connection needed. |

## 4. Options

| # | Option | What it means | Main trade-offs |
|---|---|---|---|
| 1 | **Do nothing in product; school-side guidance** | Each school onboards itself on KRA's free routes (the Online Portal suits service-only schools) and issues invoices there. | No build and no certification. But invoices then live outside EduCore, so fee ledger and tax invoices can diverge, and credit notes must be raised in the same KRA tool. |
| 2 | **Capture only** | Add optional eTIMS reference fields: supplier invoice number / QR on supplier invoices and expenses, and a per-school "eTIMS onboarded" status. No KRA calls. | Small, safe, immediately useful for expense claims. Does not issue anything. |
| 3 | **Partner with a certified integrator** | EduCore sends sale data to an approved integrator that holds the KRA connection per school. | Fastest to market, and the integrator carries certification. Adds a vendor, a cost per school or per invoice, and a data-sharing agreement for parent data. |
| 4 | **Certify EduCore as an integrator (OSCU or VSCU)** | EduCore builds the system-to-system link, passes sandbox testing and KRA certification, then onboards each school's PIN, branch and device. | Full control and the best product. Largest build and ongoing duty: certification paperwork, per-school device setup, outage and retry handling, spec changes, support load. Cannot be started without owner approval. |
| 5 | **EduCore-only first (B above)** | Integrate only EduCore's own subscription invoices (one PIN, one device), then reuse the plumbing for schools. | Smallest real integration and a proving ground. Only helps EduCore's own compliance, not schools'. Needs EduCore's own tax position first. |

## 5. Recommendation

1. **Now (cheap, no KRA contact):** Option 2. Add optional eTIMS reference capture on supplier invoices and expenses, a per-school onboarding status, and a plain-English schools guide. It helps schools claim expenses today and needs no certification.
2. **Decide before any further build:** owner questions in section 7, especially timing of the tax document and who is the legal issuer (the school, per its own PIN, which is the KRA position).
3. **Then choose between Option 3 and Options 5 then 4.** My lean: prove the plumbing on EduCore's own invoices (5), and use a certified partner (3) for schools unless the volume justifies certification (4). That is a business call, not a technical one.

Do not promise schools "eTIMS compliant" in marketing until a certified path exists. Today the safe line is: EduCore keeps your fee records; issue your KRA tax invoices through KRA's tools.

## 6. Engineering constraints any build must respect

- **Never block the school desk.** Receipts and invoices must keep working if KRA is slow or down: queue, retry, mark pending, reconcile later. KRA rejection codes need a visible fix-it queue for the bursar.
- **Idempotent submission.** A retry must never create a second tax invoice. Store KRA's returned invoice number and signature against the EduCore document; never regenerate.
- **No edits after submission.** Issued tax documents are corrected only by credit note. This interacts with existing discount, waiver and reversal flows, which today adjust balances rather than documents.
- **Multi-tenant credentials.** Each school has its own PIN, branch and device or key; store secrets in Vault; never in audit logs (the audit trigger redaction pattern in migration `audit_hardening_privileged_paths` shows how).
- **Reconcile to the shilling.** Handover rule: totals must match the existing finance reports. eTIMS rounding is per line and VAT-inclusive, so a reconciliation report is part of the scope, not an extra.
- **Personal data.** Sending parent or child details to KRA or a partner is a new disclosure. Needs review against `DATA_PROTECTION_DESIGN.md` and the Data Protection Act, and a purpose statement in the privacy notice.
- **Dark first.** Per-school flag, off by default, and an additive-only migration, like every other recent work package.

## 7. Questions only the owner, KRA or a tax adviser can answer

1. Is EduCore VAT-registered, and does it charge VAT on subscriptions? (Decides whether B needs tax on by default.)
2. For a school, which document is the tax invoice: the term fee invoice, the payment receipt, or both? When must it be issued?
3. Is the KRA PIN in `schools.kra_pin` the one a school must invoice under? Do all schools have an eTIMS-onboarded PIN today?
4. Does an individual parent buyer need a PIN on the invoice? Is there any minimum value below which an invoice is not required (the KES 100 claim is unverified)?
5. Are uniform, books, transport or boarding charges taxable supplies, and in which class? (Schools often mix exempt fees with taxable sales.)
6. Is there a bulk or file upload route into eTIMS, so a file export could be offered like the QuickBooks and Sage exports?
7. Are partner integrators priced per school, per invoice or flat, and will they sign a data-processing agreement?
8. Does KRA allow a schools-only certified integrator, and what is the current certification lead time?

## 8. Sources (retrieved 2026-11-03)

- KRA, What is eTIMS: kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/what-is-etims
- KRA, Learn about eTIMS (FAQ): kra.go.ke/helping-tax-payers/faqs/learn-about-etims
- KRA, eTIMS services page (integration options, credit notes): kra.go.ke/services/service/16
- KRA, eTIMS taxpayer portal, system-to-system integration: etims.kra.go.ke/main/signup/indexLearnMore
- KPMG Kenya, eTIMS 2026 note (secondary): assets.kpmg.com (Kenya tax thought leadership, 2026)
- KKCO East Africa, eTIMS FAQ (secondary, education institutions question): kkcoeastafrica.com/insights/article/etims-frequently-asked-questions
- invoicemonk, KRA eTIMS explained (secondary, used only where marked medium or unverified)
- Repo evidence: migrations `20260731064813_finance_invoices`, `20260810072350_phase8_finance_receipts_and_payment_functions`, `20261004090000_platform_invoicing`, `20260917100228_add_school_prefixed_invoice_number`, `20260813010707_phase15_inventory_procurement`, `20260813150000_rectify_payslip_standard_fields`, `20260828064348_encrypt_mpesa_credentials_via_vault`.
