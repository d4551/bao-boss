UPDATE baoboss.job
SET    state       = CASE
                      WHEN retry_count < retry_limit THEN 'created'
                      ELSE 'failed'
                    END,
       retry_count  = retry_count + 1,
       start_after  = CASE
                       WHEN retry_count < retry_limit AND retry_backoff
                         THEN now() + (retry_delay * power(2, retry_count) || ' seconds')::interval
                       WHEN retry_count < retry_limit
                         THEN now() + (retry_delay || ' seconds')::interval
                       ELSE start_after
                     END,
       output       = $2::jsonb
WHERE  id = $1
  AND  state = 'active'
RETURNING *;
