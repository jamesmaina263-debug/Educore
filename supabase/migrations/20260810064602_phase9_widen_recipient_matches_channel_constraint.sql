-- Found via live testing: notification_logs_recipient_matches_channel only
-- knew about email/sms/whatsapp, so any in_app insert (which has neither
-- recipient_email nor recipient_phone) was unconditionally rejected.
alter table public.notification_logs drop constraint notification_logs_recipient_matches_channel;
alter table public.notification_logs add constraint notification_logs_recipient_matches_channel check (
  ((channel = 'email') and (recipient_email is not null))
  or ((channel = any (array['sms','whatsapp'])) and (recipient_phone is not null))
  or ((channel = 'in_app') and (recipient_school_user_id is not null))
);
