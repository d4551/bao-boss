UPDATE baoboss.job
SET    state        = CASE
                       WHEN "retryCount" < "retryLimit" THEN 'created'
                       ELSE 'failed'
                     END,
       "retryCount"  = "retryCount" + 1,
       "startAfter"  = CASE
                        WHEN "retryCount" < "retryLimit" AND "retryBackoff"
                          THEN now() + ("retryDelay" * power(2, "retryCount") || ' seconds')::interval
                        WHEN "retryCount" < "retryLimit"
                          THEN now() + ("retryDelay" || ' seconds')::interval
                        ELSE "startAfter"
                      END,
       output        = $2::jsonb
WHERE  id = $1::uuid
  AND  state = 'active'
RETURNING *;
