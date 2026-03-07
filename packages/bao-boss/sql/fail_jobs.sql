-- Retry: re-enqueue jobs that have retries remaining (reference — actual query is in Manager.ts)
UPDATE "{schema}".job
SET    state        = 'created',
       "retryCount" = "retryCount" + 1,
       "startAfter" = now() + (
         "retryDelay" * CASE WHEN "retryBackoff" THEN power(2, "retryCount")::int ELSE 1 END
         * CASE WHEN "retryJitter" THEN (0.5 + random() * 0.5) ELSE 1 END
         || ' seconds'
       )::interval,
       output       = $1::jsonb
WHERE  id IN ($2, ...)
  AND  state = 'active'
  AND  "retryCount" < "retryLimit";

-- Fail: mark exhausted jobs as failed, return DLQ info (reference — actual query is in Manager.ts)
UPDATE "{schema}".job
SET    state        = 'failed',
       "retryCount" = "retryCount" + 1,
       output       = $1::jsonb
WHERE  id IN ($2, ...)
  AND  state = 'active'
  AND  "retryCount" >= "retryLimit"
RETURNING id, "deadLetter", data, priority, "expireIn", "singletonKey";
