-- AlterTable job: add retryJitter, expireIfNotStartedIn, progress
ALTER TABLE "baoboss"."job" ADD COLUMN IF NOT EXISTS "retryJitter" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "baoboss"."job" ADD COLUMN IF NOT EXISTS "expireIfNotStartedIn" INTEGER;
ALTER TABLE "baoboss"."job" ADD COLUMN IF NOT EXISTS "progress" INTEGER;

-- AlterTable queue: add retryJitter, paused, rateLimit, debounce, fairness
ALTER TABLE "baoboss"."queue" ADD COLUMN IF NOT EXISTS "retryJitter" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "baoboss"."queue" ADD COLUMN IF NOT EXISTS "paused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "baoboss"."queue" ADD COLUMN IF NOT EXISTS "rateLimit" JSONB;
ALTER TABLE "baoboss"."queue" ADD COLUMN IF NOT EXISTS "debounce" INTEGER;
ALTER TABLE "baoboss"."queue" ADD COLUMN IF NOT EXISTS "fairness" JSONB;

-- CreateTable job_dependency
CREATE TABLE IF NOT EXISTS "baoboss"."job_dependency" (
    "jobId" UUID NOT NULL,
    "dependsOnId" UUID NOT NULL,

    CONSTRAINT "job_dependency_pkey" PRIMARY KEY ("jobId","dependsOnId")
);

-- CreateTable cron_lock
CREATE TABLE IF NOT EXISTS "baoboss"."cron_lock" (
    "scheduleName" TEXT NOT NULL,
    "minuteBucket" TEXT NOT NULL,
    "lockedUntil" TIMESTAMPTZ NOT NULL,
    "instanceId" TEXT NOT NULL,

    CONSTRAINT "cron_lock_pkey" PRIMARY KEY ("scheduleName","minuteBucket")
);

-- CreateTable debounce_state
CREATE TABLE IF NOT EXISTS "baoboss"."debounce_state" (
    "queue" TEXT NOT NULL,
    "debounceKey" TEXT NOT NULL DEFAULT 'default',
    "dataAggregate" JSONB,
    "debounceUntil" TIMESTAMPTZ NOT NULL,
    "updatedOn" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "debounce_state_pkey" PRIMARY KEY ("queue","debounceKey")
);

-- CreateTable schema_version
CREATE TABLE IF NOT EXISTS "baoboss"."schema_version" (
    "version" INTEGER NOT NULL,
    "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "schema_version_pkey" PRIMARY KEY ("version")
);

-- AddForeignKey job_dependency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_dependency_jobId_fkey'
  ) THEN
    ALTER TABLE "baoboss"."job_dependency" ADD CONSTRAINT "job_dependency_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "baoboss"."job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_dependency_dependsOnId_fkey'
  ) THEN
    ALTER TABLE "baoboss"."job_dependency" ADD CONSTRAINT "job_dependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "baoboss"."job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
