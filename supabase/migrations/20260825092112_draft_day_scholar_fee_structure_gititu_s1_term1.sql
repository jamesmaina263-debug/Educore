-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Tenant-specific operational data (drafting a fee
-- structure for one real school), not a schema change — but the row still needs to exist for
-- a fresh database to match production, so it's reconstructed here as an idempotent insert
-- keyed on the real IDs confirmed live.

INSERT INTO public.fee_structures (id, school_id, term_id, class_id, fee_category, boarding_type, is_active)
VALUES (
  'ea86ab2c-15f4-4ee4-8bc9-6cf13ab34596', -- Gititu High Schoool
  '1dea95ea-c9b6-46da-9c07-aba712c84d61',
  '6cbe8a53-f213-489d-b7a0-5a792adf7b39', -- Term 1
  'e2c43a15-bf1d-4670-b906-1dca3877f3d8',
  'core',
  'day',
  false -- drafted inactive; activated separately by 20260825092603_activate_s1_day_fee_structure.sql
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.fee_items (fee_structure_id, name, amount)
SELECT 'ea86ab2c-15f4-4ee4-8bc9-6cf13ab34596', 'Tuition', 5000.00
WHERE NOT EXISTS (
  SELECT 1 FROM public.fee_items WHERE fee_structure_id = 'ea86ab2c-15f4-4ee4-8bc9-6cf13ab34596' AND name = 'Tuition'
);
