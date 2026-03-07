-- Complete a job (reference — actual query is in Manager.ts)
UPDATE "{schema}".job
SET    state         = 'completed',
       "completedOn" = now(),
       output        = $1::jsonb
WHERE  id = $2::uuid
  AND  state = 'active';
