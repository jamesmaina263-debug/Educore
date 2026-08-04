
create or replace function render_template(p_body text, p_values jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare
  v_result text := p_body;
  v_key text;
begin
  for v_key in select jsonb_object_keys(p_values) loop
    v_result := replace(v_result, '{{' || v_key || '}}', coalesce(p_values->>v_key, ''));
  end loop;
  return v_result;
end;
$$;
