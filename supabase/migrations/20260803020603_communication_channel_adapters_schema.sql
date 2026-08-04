-- WhatsApp/Email channel adapters (blueprint SS7.7/item 4 of Phase 3). SMS's schema (Phase 2,
-- commit 416fe8b) was already built channel-aware — communication_templates.channel and
-- notification_logs.channel both already exist and default to 'sms', with no CHECK constraint
-- pinning them to that value. What's missing: notification_logs.recipient_phone was NOT NULL
-- (email has no phone), and there's no recipient_email or subject column.

alter table public.notification_logs
  alter column recipient_phone drop not null,
  add column recipient_email text,
  add column subject text;

alter table public.notification_logs
  add constraint notification_logs_recipient_matches_channel check (
    (channel = 'email' and recipient_email is not null)
    or (channel in ('sms','whatsapp') and recipient_phone is not null)
  );

comment on column public.notification_logs.recipient_email is 'Populated when channel = ''email''; recipient_phone is used for sms and whatsapp (WhatsApp addresses by phone number, per Twilio/360dialog).';
