import { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { DLQ_JOB_RETRY, JOB_DEFAULTS, daysFromNow } from '../defaults.js'
import { toJsonInput } from './mappers.js'

/**
 * A job that has exhausted its retries and carries a dead-letter target.
 *
 * `queue` is the queue the job actually failed in — it is copied onto the
 * dead-letter event so operators can trace an entry back to its origin.
 */
export interface DlqRow {
  id: string
  queue: string
  deadLetter: string
  data: unknown
  priority: number
  expireIn: number
  singletonKey: string | null
}

interface DlqEvent {
  jobId: string
  queue: string
  deadLetter: string
}

function buildDlqJobCreateData(
  row: DlqRow,
  targets: Map<string, { deadLetter: string | null; retentionDays: number }>,
  fallbackRetentionDays: number,
): Prisma.JobCreateManyInput {
  const target = targets.get(row.deadLetter)
  return {
    queue: row.deadLetter,
    data: row.data === undefined ? Prisma.JsonNull : toJsonInput(row.data),
    priority: row.priority,
    ...DLQ_JOB_RETRY,
    expireIn: row.expireIn,
    // The dead-letter copy is a distinct job; carrying the source singleton key
    // would let one poisoned key block every later copy on the same index.
    singletonKey: null,
    deadLetter: target?.deadLetter ?? null,
    policy: JOB_DEFAULTS.policy,
    keepUntil: daysFromNow(target?.retentionDays ?? fallbackRetentionDays),
  }
}

/**
 * Copy exhausted jobs into their dead-letter queues.
 *
 * One `createMany` for the whole batch: either every dead-letter copy lands or
 * none does, so a partial failure cannot leave some failures traceable and
 * others silently gone.
 */
export async function createDlqJobs(
  prisma: PrismaClient,
  dlqJobs: DlqRow[],
  fallbackRetentionDays: number,
  onDlq?: (event: DlqEvent) => void,
): Promise<void> {
  if (dlqJobs.length === 0) return
  const names = [...new Set(dlqJobs.map(row => row.deadLetter))]
  const targetRows = await prisma.queue.findMany({
    where: { name: { in: names } },
    select: { name: true, deadLetter: true, retentionDays: true },
  })
  const targets = new Map(targetRows.map(row => [row.name, row]))

  await prisma.job.createMany({
    data: dlqJobs.map(row => buildDlqJobCreateData(row, targets, fallbackRetentionDays)),
  })

  for (const row of dlqJobs) {
    onDlq?.({ jobId: row.id, queue: row.queue, deadLetter: row.deadLetter })
  }
}
