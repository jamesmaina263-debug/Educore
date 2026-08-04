alter table public.notification_logs drop constraint notification_logs_channel_check;
alter table public.notification_logs add constraint notification_logs_channel_check check (channel in ('sms','email','whatsapp'));

alter table public.communication_templates drop constraint communication_templates_channel_check;
alter table public.communication_templates add constraint communication_templates_channel_check check (channel in ('sms','email','whatsapp'));
