import type { PrismaClient, Prisma } from '../generated/prisma/client.js'
import { readFairness, readRateLimit } from './mappers.js'
import { secondsFromNow } from '../defaults.js'

/** Policies that allow at most one job in flight, so a fetch never claims more than one. */
const SERIAL_POLICIES = new Set(['singleton', 'stately'])

/**
 * Jobs this queue may still start inside the current rate-limit window.
 * `null` means the queue is unlimited.
 *
 * Counts every job that has *started* in the window regardless of how it ended —
 * counting only active and completed jobs let failed and cancelled work slip
 * through the limit for free.
 */
export async function rateLimitRemaining(
  prisma: PrismaClient,
  queue: string,
  rateLimitColumn: Prisma.JsonValue | null,
): Promise<number | null> {
  const rateLimit = readRateLimit(rateLimitColumn)
  if (!rateLimit || rateLimit.count <= 0 || rateLimit.period <= 0) return null
  const started = await prisma.job.count({
    where: { queue, startedOn: { gte: secondsFromNow(-rateLimit.period) } },
  })
  return Math.max(0, rateLimit.count - started)
}

/** How many jobs a single fetch may claim, given the queue policy and rate-limit headroom. */
export function effectiveBatchSize(
  requested: number | undefined,
  policy: string,
  remaining: number | null,
): number {
  const base = SERIAL_POLICIES.has(policy) ? 1 : Math.max(1, requested ?? 1)
  return remaining === null ? base : Math.min(base, remaining)
}

/**
 * Claim pending jobs with `FOR UPDATE SKIP LOCKED`.
 *
 * A job is claimable when it is `created`, its `startAfter` has passed, and every
 * job it depends on has settled. With fairness configured, a share of picks is
 * randomised so low-priority work is not starved by a busy high-priority stream.
 */
export function buildFetchQuery(
  schema: string,
  queue: string,
  fairnessColumn: Prisma.JsonValue | null,
  batchSize: number,
): { query: string; params: unknown[] } {
  const fairness = readFairness(fairnessColumn)?.lowPriorityShare ?? 0
  const useFairness = fairness > 0
  const orderBy = useFairness
    ? '(CASE WHEN random() < $2 THEN random() ELSE 1 END) ASC, j.priority DESC, j."createdOn" ASC'
    : 'j.priority DESC, j."createdOn" ASC'
  const limitParam = useFairness ? '$3' : '$2'

  const query = `
    WITH next_jobs AS (
      SELECT j.id
      FROM "${schema}".job j
      WHERE j.queue = $1
        AND j.state = 'created'
        AND j."startAfter" <= now()
        AND NOT EXISTS (
          SELECT 1 FROM "${schema}".job_dependency d
          WHERE d."jobId" = j.id
            AND d."dependsOnId" NOT IN (
              SELECT id FROM "${schema}".job WHERE state IN ('completed', 'cancelled')
            )
        )
      ORDER BY ${orderBy}
      LIMIT ${limitParam}
      FOR UPDATE SKIP LOCKED
    ), updated AS (
      UPDATE "${schema}".job j
      SET state = 'active', "startedOn" = now()
      FROM next_jobs
      WHERE j.id = next_jobs.id
      RETURNING j.*
    )
    SELECT * FROM updated ORDER BY priority DESC, "createdOn" ASC
  `
  const params = useFairness ? [queue, fairness, batchSize] : [queue, batchSize]
  return { query, params }
}
