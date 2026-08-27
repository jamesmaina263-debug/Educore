-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Activates the day-scholar S1 Term1 fee structure
-- drafted in 20260825092112_draft_day_scholar_fee_structure_gititu_s1_term1.sql, matching
-- the live is_active = true state confirmed for this row.

UPDATE public.fee_structures
SET is_active = true
WHERE id = 'ea86ab2c-15f4-4ee4-8bc9-6cf13ab34596';
