-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "baoboss";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA "public";

-- CreateEnum
CREATE TYPE "baoboss"."JobState" AS ENUM ('created', 'active', 'completed', 'cancelled', 'failed');

-- CreateEnum
CREATE TYPE "baoboss"."Policy" AS ENUM ('standard', 'short', 'singleton', 'stately');

-- CreateTable
CREATE TABLE "baoboss"."job" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "queue" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB,
    "state" "baoboss"."JobState" NOT NULL DEFAULT 'created',
    "retryLimit" INTEGER NOT NULL DEFAULT 2,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "retryDelay" INTEGER NOT NULL DEFAULT 0,
    "retryBackoff" BOOLEAN NOT NULL DEFAULT false,
    "startAfter" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "startedOn" TIMESTAMPTZ,
    "expireIn" INTEGER NOT NULL DEFAULT 900,
    "createdOn" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "completedOn" TIMESTAMPTZ,
    "keepUntil" TIMESTAMPTZ NOT NULL DEFAULT now() + interval '14 days',
    "singletonKey" TEXT,
    "output" JSONB,
    "deadLetter" TEXT,
    "policy" TEXT,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baoboss"."queue" (
    "name" TEXT NOT NULL,
    "policy" "baoboss"."Policy" NOT NULL DEFAULT 'standard',
    "retryLimit" INTEGER NOT NULL DEFAULT 2,
    "retryDelay" INTEGER NOT NULL DEFAULT 0,
    "retryBackoff" BOOLEAN NOT NULL DEFAULT false,
    "expireIn" INTEGER NOT NULL DEFAULT 900,
    "retentionDays" INTEGER NOT NULL DEFAULT 14,
    "deadLetter" TEXT,
    "createdOn" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedOn" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "queue_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "baoboss"."schedule" (
    "name" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "data" JSONB,
    "options" JSONB,
    "createdOn" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedOn" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "schedule_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "baoboss"."subscription" (
    "event" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "createdOn" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("event","queue")
);

-- CreateIndex
CREATE INDEX "job_queue_state_startAfter_priority_idx" ON "baoboss"."job"("queue", "state", "startAfter", "priority" DESC);
