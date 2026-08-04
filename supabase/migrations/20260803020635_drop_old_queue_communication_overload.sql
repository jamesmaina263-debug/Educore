drop function public.queue_communication(jsonb, uuid, text);

revoke all on function public.queue_communication(jsonb, uuid, text, text, text) from public, anon;
grant execute on function public.queue_communication(jsonb, uuid, text, text, text) to authenticated;
