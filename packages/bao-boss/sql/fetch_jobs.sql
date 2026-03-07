-- Fetch jobs using SKIP LOCKED (reference — actual query is in Manager.ts)
-- Supports: dependency checks, fairness-based ordering, parameterized schema
WITH next_jobs AS (
  SELECT j.id
  FROM "{schema}".job j
  WHERE j.queue = $1
    AND j.state = 'created'
    AND j."startAfter" <= now()
    AND NOT EXISTS (
      SELECT 1 FROM "{schema}".job_dependency d
      WHERE d."jobId" = j.id
        AND d."dependsOnId" NOT IN (
          SELECT id FROM "{schema}".job WHERE state IN ('completed', 'cancelled')
        )
    )
  ORDER BY j.priority DESC, j."createdOn" ASC
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
UPDATE "{schema}".job j
SET    state       = 'active',
       "startedOn" = now()
FROM   next_jobs
WHERE  j.id = next_jobs.id
RETURNING j.*;
