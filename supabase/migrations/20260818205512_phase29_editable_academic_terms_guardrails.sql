-- Item #6 (editable academic terms): the RLS policies on terms/academic_years
-- already permit UPDATE for academics.write holders (ALL command policies),
-- so the DB has never blocked edits -- the gap was that no app code called
-- UPDATE, and there was zero validation to stop an edit from corrupting the
-- calendar (no overlap check existed even for INSERT, and a "closed"
-- historical term could be silently rewritten by anyone with academics.write).
-- This migration adds the guardrails so the update actions being added in
-- app code are safe by construction.

CREATE OR REPLACE FUNCTION public.validate_term_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Historical (closed) terms represent a school's actual past calendar --
  -- marks, attendance, fee periods, and report cards were all generated
  -- against these dates. Once closed, only a super admin can still edit
  -- them (e.g. to fix a genuine data-entry error), not a regular admin
  -- doing routine calendar upkeep.
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' AND NOT auth_is_super_admin() THEN
    RAISE EXCEPTION 'This term is closed and part of the historical record. Only a super admin can edit a closed term.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.terms t
    WHERE t.academic_year_id = NEW.academic_year_id
      AND t.id <> NEW.id
      AND t.start_date <= NEW.end_date
      AND t.end_date >= NEW.start_date
  ) THEN
    RAISE EXCEPTION 'Term dates overlap with another term in the same academic year.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_term_mutation() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_terms_validate ON public.terms;
CREATE TRIGGER trg_terms_validate
  BEFORE INSERT OR UPDATE ON public.terms
  FOR EACH ROW EXECUTE FUNCTION public.validate_term_mutation();

CREATE OR REPLACE FUNCTION public.validate_academic_year_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' AND NOT auth_is_super_admin() THEN
    RAISE EXCEPTION 'This academic year is closed and part of the historical record. Only a super admin can edit a closed year.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.academic_years y
    WHERE y.school_id = NEW.school_id
      AND y.id <> NEW.id
      AND y.start_date <= NEW.end_date
      AND y.end_date >= NEW.start_date
  ) THEN
    RAISE EXCEPTION 'Academic year dates overlap with another academic year for this school.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_academic_year_mutation() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_academic_years_validate ON public.academic_years;
CREATE TRIGGER trg_academic_years_validate
  BEFORE INSERT OR UPDATE ON public.academic_years
  FOR EACH ROW EXECUTE FUNCTION public.validate_academic_year_mutation();
