-- Enforce singletonKey: at most one open job per (queue, singletonKey).
-- Without this the column was stored and never honoured, so two sends with the
-- same key produced two jobs.
CREATE UNIQUE INDEX IF NOT EXISTS "job_singleton_open_key"
  ON "baoboss"."job" ("queue", "singletonKey")
  WHERE "singletonKey" IS NOT NULL AND "state" IN ('created', 'active');

-- Expiry sweeps scan active jobs by startedOn; purge scans terminal jobs by
-- keepUntil. Both were sequential scans of the whole job table.
CREATE INDEX IF NOT EXISTS "job_active_startedOn_idx"
  ON "baoboss"."job" ("startedOn")
  WHERE "state" = 'active';

CREATE INDEX IF NOT EXISTS "job_keepUntil_idx"
  ON "baoboss"."job" ("keepUntil")
  WHERE "state" IN ('completed', 'cancelled', 'failed');

-- The dependency check in the fetch query looks up dependants by dependsOnId,
-- which the composite primary key cannot serve.
CREATE INDEX IF NOT EXISTS "job_dependency_dependsOnId_idx"
  ON "baoboss"."job_dependency" ("dependsOnId");

-- Cron locks are purged by age.
CREATE INDEX IF NOT EXISTS "cron_lock_lockedUntil_idx"
  ON "baoboss"."cron_lock" ("lockedUntil");

-- Debounce batches are now ordinary jobs holding a reserved singleton key, so
-- the side table and its flush pass are gone.
DROP TABLE IF EXISTS "baoboss"."debounce_state";
