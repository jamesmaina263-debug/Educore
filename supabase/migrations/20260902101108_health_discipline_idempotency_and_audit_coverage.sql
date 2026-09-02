-- Health/discipline narrative writes were confirmed (not assumed) to lack two things:
--
-- 1. Idempotency: health:logEmergency, health:createReferral, discipline:createIncidentAction,
--    discipline:createCaseAction, discipline:addDisciplinaryActionAction,
--    discipline:createWelfareConcernAction, discipline:createSafeguardingReportAction are all
--    genuinely wired into the offline mutation queue (confirmed in src/lib/offline/handlers.ts),
--    so all 7 are exposed to the same lost-ack replay risk OS-08 already fixed for
--    library/inventory/medication. These are one-off narrative records, not stock/dose
--    duplication, so lower urgency than OS-08's items -- but a genuine remaining gap, closing
--    it now. Same pattern: an optional client-supplied client_mutation_id, generated once by the
--    browser at queue time, naturally reused on every replay since the offline queue persists
--    and resends the exact same payload. App-level check-first-return-existing (these are plain
--    single-table inserts, not RPCs -- same style as medication_administrations' own check).
--
-- 2. Audit-log coverage: confirmed via information_schema.triggers that discipline_records and
--    discipline_cases already carry trg_audit_discipline_records/trg_audit_discipline_cases from
--    Phase 17 (2026-08-12) -- NOT re-added here to avoid double-logging. health_emergencies,
--    health_referrals, disciplinary_actions, welfare_concerns, and safeguarding_reports carry no
--    trigger at all -- confirmed absent, not assumed. All five have their own school_id column
--    directly (no via_student/via_fee_structure resolution needed), so the plain
--    public.audit_row_change() function (already exists, Phase 17) applies unchanged.

-- ============================================================================
-- Idempotency keys
-- ============================================================================
alter table public.health_emergencies add column if not exists client_mutation_id uuid;
create unique index if not exists health_emergencies_school_client_mutation_id_key
  on public.health_emergencies (school_id, client_mutation_id)
  where client_mutation_id is not null;

alter table public.health_referrals add column if not exists client_mutation_id uuid;
create unique index if not exists health_referrals_school_client_mutation_id_key
  on public.health_referrals (school_id, client_mutation_id)
  where client_mutation_id is not null;

alter table public.discipline_records add column if not exists client_mutation_id uuid;
create unique index if not exists discipline_records_school_client_mutation_id_key
  on public.discipline_records (school_id, client_mutation_id)
  where client_mutation_id is not null;

alter table public.discipline_cases add column if not exists client_mutation_id uuid;
create unique index if not exists discipline_cases_school_client_mutation_id_key
  on public.discipline_cases (school_id, client_mutation_id)
  where client_mutation_id is not null;

alter table public.disciplinary_actions add column if not exists client_mutation_id uuid;
create unique index if not exists disciplinary_actions_school_client_mutation_id_key
  on public.disciplinary_actions (school_id, client_mutation_id)
  where client_mutation_id is not null;

alter table public.welfare_concerns add column if not exists client_mutation_id uuid;
create unique index if not exists welfare_concerns_school_client_mutation_id_key
  on public.welfare_concerns (school_id, client_mutation_id)
  where client_mutation_id is not null;

alter table public.safeguarding_reports add column if not exists client_mutation_id uuid;
create unique index if not exists safeguarding_reports_school_client_mutation_id_key
  on public.safeguarding_reports (school_id, client_mutation_id)
  where client_mutation_id is not null;

-- ============================================================================
-- Audit-log coverage for the 5 tables genuinely missing it
-- ============================================================================
create trigger trg_audit_health_emergencies
  after insert or update or delete on public.health_emergencies
  for each row execute function public.audit_row_change();

create trigger trg_audit_health_referrals
  after insert or update or delete on public.health_referrals
  for each row execute function public.audit_row_change();

create trigger trg_audit_disciplinary_actions
  after insert or update or delete on public.disciplinary_actions
  for each row execute function public.audit_row_change();

create trigger trg_audit_welfare_concerns
  after insert or update or delete on public.welfare_concerns
  for each row execute function public.audit_row_change();

create trigger trg_audit_safeguarding_reports
  after insert or update or delete on public.safeguarding_reports
  for each row execute function public.audit_row_change();