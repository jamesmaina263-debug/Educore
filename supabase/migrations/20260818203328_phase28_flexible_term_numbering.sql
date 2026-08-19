-- Phase 28 (audit item #6): term_number was hard-checked to 1-3, hard-coding
-- a 3-term calendar. A school running semesters (2), quarters (4), or any
-- other structure couldn't represent its calendar at all. Confirmed via grep
-- that nothing else in the app hardcodes "exactly 3 terms" (every other
-- reference just orders by term_number for display) -- safe to loosen.
-- unique(academic_year_id, term_number) is untouched, so numbering still
-- can't collide within a year.

alter table public.terms drop constraint terms_term_number_check;
alter table public.terms add constraint terms_term_number_check check (term_number between 1 and 12);
