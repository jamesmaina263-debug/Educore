-- Fix: audit_row_change() (Phase 17) reads NEW.id/OLD.id unconditionally on every table it
-- triggers on. mpesa_settings uses school_id as its primary key (no separate id), so the
-- trigger raised '42703: record "new" has no field "id"' on the very first insert. Adding a
-- plain id column (not the primary key -- school_id stays that) satisfies the trigger without
-- changing anything else about the table's shape or the set_mpesa_credentials() upsert logic,
-- which still targets school_id via "on conflict (school_id)".
alter table public.mpesa_settings add column id uuid not null default gen_random_uuid();
