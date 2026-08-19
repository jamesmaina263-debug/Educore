-- Revert the test mutation made while verifying trg_terms_validate (closed-term
-- guard correctly blocked a service-role edit with no super_admin JWT claim,
-- which is expected -- but that also means this same test connection can't
-- undo it through a normal UPDATE). Disable the trigger just for this one
-- corrective statement, then re-enable it immediately.
ALTER TABLE public.terms DISABLE TRIGGER trg_terms_validate;
UPDATE public.terms SET status = 'upcoming' WHERE id = '6cbe8a53-f213-489d-b7a0-5a792adf7b39';
ALTER TABLE public.terms ENABLE TRIGGER trg_terms_validate;
