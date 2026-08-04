/**
 * Single owner for every default value and time constant in bao-boss.
 *
 * Nothing else in the codebase may re-declare these numbers. Queue rows,
 * job rows, the Prisma schema defaults and the TypeBox schemas all resolve
 * through here so a change lands in exactly one place.
 */

import { GENERATED_SCHEMA } from './schema.js'

// ── Time ─────────────────────────────────────────────────────────────

export const MS_PER_SECOND = 1_000
const SECONDS_PER_DAY = 86_400
const MS_PER_DAY = SECONDS_PER_DAY * MS_PER_SECOND

/** Add `seconds` to now. */
export function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * MS_PER_SECOND)
}

/** Add `days` to now. */
export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * MS_PER_DAY)
}

// ── Queue / job defaults ─────────────────────────────────────────────

/** Defaults applied when neither the caller nor the queue row specifies a value. */
export const JOB_DEFAULTS = {
  priority: 0,
  retryLimit: 2,
  retryDelay: 0,
  retryBackoff: false,
  retryJitter: false,
  /** Seconds an active job may run before the maintenance loop expires it. */
  expireIn: 900,
  /** Days a terminal job is kept before purge. */
  retentionDays: 14,
  policy: 'standard',
} as const

/** Days a dead-letter copy is kept before purge. */
export const DLQ_RETENTION_DAYS = 14

/** Retry settings stamped onto dead-letter copies — a DLQ entry is terminal evidence, never retried. */
export const DLQ_JOB_RETRY = {
  retryLimit: 0,
  retryCount: 0,
  retryDelay: 0,
  retryBackoff: false,
} as const

// ── Runtime defaults ─────────────────────────────────────────────────

export const WORKER_DEFAULTS = {
  batchSize: 1,
  pollingIntervalSeconds: 2,
  /** Jobs processed concurrently by one worker. Bounded by default — an unbounded
   *  default lets slow handlers pile up ticks until the pool is exhausted. */
  maxConcurrency: 1,
} as const

export const BOSS_DEFAULTS = {
  schema: GENERATED_SCHEMA,
  maintenanceIntervalSeconds: 120,
  /** 12 hours. */
  archiveCompletedAfterSeconds: 12 * 60 * 60,
  deleteArchivedAfterDays: 7,
  shutdownGracePeriodSeconds: 30,
} as const

/** Longest cron-lock hold before another instance may claim the same minute. */
export const CRON_LOCK_TTL_SECONDS = 120

/** Cron-lock rows older than this are purged by the maintenance loop. */
export const CRON_LOCK_RETENTION_DAYS = 2

// ── Query bounds ─────────────────────────────────────────────────────

/** Default page size for `searchJobs`. */
export const SEARCH_LIMIT_DEFAULT = 50

/** Hard ceiling for `searchJobs` — an unbounded limit is a denial-of-service vector. */
export const SEARCH_LIMIT_MAX = 1_000

/** Longest dead-letter chain walked when validating for cycles. */
export const DEAD_LETTER_CHAIN_MAX = 32
