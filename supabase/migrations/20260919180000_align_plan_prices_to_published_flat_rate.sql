-- Aligns the platform's plan prices with the rate published on the marketing
-- site (Sep 14 2026, PR #294): a flat KES 100 per student, per term, the same
-- across Starter, Growth and Enterprise -- tiers differ by module coverage and
-- support, not price.
--
-- The seed (20260805082627_billing_seed_default_plans) still carried the
-- original placeholder prices (150 / 200 / 250). generate_platform_invoice()
-- prices from subscription_plans.price_per_student_kes at invoice time, so a
-- school converting after its 30-day trial would have been billed more than
-- the site advertises.
--
-- Only the catalogue changes. Existing platform_invoices store their own
-- amount_kes and are untouched (the two that exist are already paid/cancelled).
-- Idempotent: rows already at 100 are skipped.

update public.subscription_plans
set price_per_student_kes = 100,
    updated_at = now()
where code in ('starter', 'growth', 'enterprise')
  and price_per_student_kes is distinct from 100;
