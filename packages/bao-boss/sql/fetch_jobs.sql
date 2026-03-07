WITH next_jobs AS (
  SELECT id
  FROM baoboss.job
  WHERE queue       = $1
    AND state       = 'created'
    AND start_after <= now()
  ORDER BY priority DESC, created_on ASC
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
UPDATE baoboss.job j
SET    state      = 'active',
       started_on = now(),
       retry_count = CASE WHEN state = 'failed' THEN retry_count + 1 ELSE retry_count END
FROM   next_jobs
WHERE  j.id = next_jobs.id
RETURNING j.*;
