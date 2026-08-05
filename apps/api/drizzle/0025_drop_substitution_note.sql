-- #357 — strip the misleading `substitutionNote` values from stored plans.
--
-- The key was never written by the code that owns it: `applyEquipmentSubstitutions`
-- fired zero times in production, and every stored value was authored by the LLM,
-- which filled it with execution coaching ("Keep core engaged") because the
-- structured-output schema exposed it as a second undescribed string next to
-- `notes`. The plan view rendered those tips in the slot that means "we swapped
-- this exercise for you". The field is gone from the contract as of this change,
-- so these values are now unreadable residue.
--
-- SCOPE: `workout_plans.program_json` ONLY. `session_exercises.notes` also carries
-- this text (copied at session-start by `combineExerciseNotes`), and it is
-- deliberately left untouched: a tracker row is a snapshot of what was prescribed,
-- and rewriting it would falsify training history.
--
-- Shape-safe: rebuilds `weeklySessions` preserving every other key at every level,
-- and `coalesce(..., '[]'::jsonb)` keeps an empty `exercises` array an empty array
-- instead of collapsing it to NULL (jsonb_agg over zero rows returns NULL).
UPDATE workout_plans AS w
SET program_json = jsonb_set(
      w.program_json,
      '{weeklySessions}',
      coalesce((
        SELECT jsonb_agg(
                 jsonb_set(
                   s.value,
                   '{exercises}',
                   coalesce((
                     SELECT jsonb_agg(e.value - 'substitutionNote' ORDER BY e.ordinality)
                     FROM jsonb_array_elements(s.value -> 'exercises')
                          WITH ORDINALITY AS e(value, ordinality)
                   ), '[]'::jsonb)
                 )
                 ORDER BY s.ordinality
               )
        FROM jsonb_array_elements(w.program_json -> 'weeklySessions')
             WITH ORDINALITY AS s(value, ordinality)
      ), '[]'::jsonb)
    )
WHERE w.program_json IS NOT NULL
  AND jsonb_path_exists(w.program_json, '$.weeklySessions[*].exercises[*].substitutionNote');
