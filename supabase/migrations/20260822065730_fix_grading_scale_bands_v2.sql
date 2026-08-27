-- Fixes grading scales that exist but have no usable bands -- found via
-- Gititu High School's marks-entry dropdown showing only one option.
--
-- Two distinct broken states found across the two schools that currently
-- exist, both left over from manual data setup (there's no automated
-- seeding of grading_scale_bands anywhere in the migration history):
--   - Gititu's "A-D" scale (model_type='cbc'): 2 bands, BOTH labeled 'A'.
--   - Demo Academy's "Standard 8-4-4 scale" (model_type='numeric'): 0 bands
--     at all.
--
-- This is written as an idempotent, general fixer (not a one-off patch for
-- these two rows) so it also repairs any other school in the same state,
-- now or in the future, rather than only fixing what happens to exist
-- today. It only touches scales matching the actual broken signature (zero
-- bands, or fewer distinct labels than bands) -- a school with a correctly
-- configured scale is left untouched.
--
-- model_type drives what "correct" means, matching the comment already on
-- grading_scale_bands: cbc bands are directly picked by the teacher (label
-- only, no score range), numeric bands resolve from a score range. So a
-- cbc-model scale gets competency-style bands (here: letter + wording
-- combined, per product decision, since the school's own scale is literally
-- named "A-D"), and a numeric-model scale gets real score ranges -- CBC
-- wording has no place on a scale whose whole point is range-based
-- resolution.
--
-- Update-in-place, not delete-then-insert: Gititu already had real marks
-- entered against the broken duplicate-'A' bands before this was caught, so
-- a blind delete violates marks.band_id's foreign key. Updating existing
-- bands by level_order preserves their id (any mark already pointing at
-- them keeps resolving correctly, just to a corrected label), and only
-- missing level_orders get freshly inserted. One side effect worth knowing:
-- any mark that was already entered against the *second* duplicate band
-- (level_order 2, previously also labeled 'A') now displays under that
-- band's corrected label instead -- for Gititu specifically, two existing
-- test marks moved from displaying 'A' to 'B — Meeting Expectation'.

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

    -- Remove any leftover band beyond the target count -- only ones not
    -- referenced by any real mark, so this can never violate a foreign key.
    delete from grading_scale_bands
    where grading_scale_id = v_scale.id
      and level_order > array_length(v_target_labels, 1)
      and id not in (select m.band_id from marks m where m.band_id is not null)
      and id not in (select cm.band_id from competency_marks cm where cm.band_id is not null);
  end loop;
end;
$$;
