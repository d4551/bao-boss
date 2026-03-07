WITH next_jobs AS (
  SELECT id
  FROM baoboss.job
  WHERE queue        = $1
    AND state        = 'created'
    AND "startAfter" <= now()
  ORDER BY priority DESC, "createdOn" ASC
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
UPDATE baoboss.job j
SET    state       = 'active',
       "startedOn" = now()
FROM   next_jobs
WHERE  j.id = next_jobs.id
RETURNING j.*;
