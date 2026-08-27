do $$
declare
  v_scale record;
  v_band record;
  v_target_labels text[];
  v_i int;
begin
  for v_scale in
    select gs.id, gs.model_type
    from grading_scales gs
    left join grading_scale_bands gsb on gsb.grading_scale_id = gs.id
    group by gs.id, gs.model_type
    having count(gsb.id) = 0 or count(gsb.id) <> count(distinct gsb.label)
  loop
    if v_scale.model_type = 'cbc' then
      v_target_labels := array['A — Exceeding Expectation', 'B — Meeting Expectation', 'C — Approaching Expectation', 'D — Below Expectation'];
    else
      v_target_labels := array['A', 'B', 'C', 'D', 'E'];
    end if;

    for v_i in 1 .. array_length(v_target_labels, 1) loop
      select * into v_band from grading_scale_bands where grading_scale_id = v_scale.id and level_order = v_i;

      if found then
        update grading_scale_bands
        set label = v_target_labels[v_i],
            min_score = case when v_scale.model_type = 'numeric' then (array[80,65,50,35,0])[v_i] else null end,
            max_score = case when v_scale.model_type = 'numeric' then (array[100,79.99,64.99,49.99,34.99])[v_i] else null end,
            points = case when v_scale.model_type = 'numeric' then (array[4,3,2,1,0])[v_i] else null end
        where id = v_band.id;
      else
        insert into grading_scale_bands (grading_scale_id, label, min_score, max_score, points, level_order)
        values (
          v_scale.id,
          v_target_labels[v_i],
          case when v_scale.model_type = 'numeric' then (array[80,65,50,35,0])[v_i] else null end,
          case when v_scale.model_type = 'numeric' then (array[100,79.99,64.99,49.99,34.99])[v_i] else null end,
          case when v_scale.model_type = 'numeric' then (array[4,3,2,1,0])[v_i] else null end,
          v_i
        );
      end if;
    end loop;

    delete from grading_scale_bands
    where grading_scale_id = v_scale.id
      and level_order > array_length(v_target_labels, 1)
      and id not in (select m.band_id from marks m where m.band_id is not null)
      and id not in (select cm.band_id from competency_marks cm where cm.band_id is not null);
  end loop;
end;
$$;
