import { Prisma, type Job as PrismaJob, type Queue as PrismaQueue } from '../generated/prisma/client.js'
import { Type as t } from '@sinclair/typebox'
import type { Job, Queue, QueuePolicy, JobState } from '../types.js'

// ── TypeBox schemas ──────────────────────────────────────────────

export const policySchema = t.Union([t.Literal('standard'), t.Literal('short'), t.Literal('singleton'), t.Literal('stately')])

export const createQueueSchema = t.Object({
  policy: t.Optional(policySchema),
  retryLimit: t.Optional(t.Integer({ minimum: 0 })),
  retryDelay: t.Optional(t.Integer({ minimum: 0 })),
  retryBackoff: t.Optional(t.Boolean()),
  retryJitter: t.Optional(t.Boolean()),
  expireIn: t.Optional(t.Integer({ minimum: 1 })),
  retentionDays: t.Optional(t.Integer({ minimum: 1 })),
  deadLetter: t.Optional(t.String()),
  rateLimit: t.Optional(t.Object({ count: t.Integer({ minimum: 1 }), period: t.Integer({ minimum: 1 }) })),
  debounce: t.Optional(t.Integer({ minimum: 1 })),
  fairness: t.Optional(t.Object({ lowPriorityShare: t.Number({ minimum: 0, maximum: 1 }) })),
})

export const sendOptionsSchema = t.Object({
  priority: t.Optional(t.Integer()),
  startAfter: t.Optional(t.Union([t.Number(), t.String(), t.Date()])),
  retryLimit: t.Optional(t.Integer({ minimum: 0 })),
  retryDelay: t.Optional(t.Integer({ minimum: 0 })),
  retryBackoff: t.Optional(t.Boolean()),
  retryJitter: t.Optional(t.Boolean()),
  expireIn: t.Optional(t.Integer({ minimum: 1 })),
  expireIfNotStartedIn: t.Optional(t.Integer({ minimum: 1 })),
  singletonKey: t.Optional(t.String()),
  deadLetter: t.Optional(t.String()),
  dependsOn: t.Optional(t.Array(t.String())),
})

// ── Mapping helpers ──────────────────────────────────────────────

export function resolveStartAfter(startAfter?: number | string | Date): Date {
  if (!startAfter) return new Date()
  if (startAfter instanceof Date) return startAfter
  if (typeof startAfter === 'number') {
    return new Date(Date.now() + startAfter * 1000)
  }
  return new Date(startAfter)
}

export function toDomainJob<T>(row: PrismaJob): Job<T> {
  return {
    id: row.id,
    queue: row.queue,
    priority: row.priority,
    data: row.data as T,
    state: row.state as JobState,
    retryLimit: row.retryLimit,
    retryCount: row.retryCount,
    retryDelay: row.retryDelay,
    retryBackoff: row.retryBackoff,
    retryJitter: row.retryJitter,
    startAfter: row.startAfter,
    startedOn: row.startedOn,
    expireIn: row.expireIn,
    expireIfNotStartedIn: row.expireIfNotStartedIn,
    createdOn: row.createdOn,
    completedOn: row.completedOn,
    keepUntil: row.keepUntil,
    singletonKey: row.singletonKey,
    output: row.output,
    deadLetter: row.deadLetter,
    policy: row.policy,
    progress: row.progress,
  }
}

export function toDomainQueue(row: PrismaQueue): Queue {
  return {
    name: row.name,
    policy: row.policy as QueuePolicy,
    retryLimit: row.retryLimit,
    retryDelay: row.retryDelay,
    retryBackoff: row.retryBackoff,
    retryJitter: row.retryJitter,
    expireIn: row.expireIn,
    retentionDays: row.retentionDays,
    deadLetter: row.deadLetter,
    paused: row.paused,
    rateLimit: row.rateLimit as { count: number; period: number } | null,
    debounce: row.debounce,
    fairness: row.fairness as { lowPriorityShare: number } | null,
    createdOn: row.createdOn,
    updatedOn: row.updatedOn,
  }
}

/** Interface for raw SQL RETURNING rows from the fetch query */
export interface RawJobRow {
  id: string
  queue: string
  priority: number
  data: unknown
  state: string
  retryLimit: number
  retryCount: number
  retryDelay: number
  retryBackoff: boolean
  retryJitter: boolean
  startAfter: Date | string
  startedOn: Date | string | null
  expireIn: number
  expireIfNotStartedIn: number | null
  createdOn: Date | string
  completedOn: Date | string | null
  keepUntil: Date | string
  singletonKey: string | null
  output: unknown
  deadLetter: string | null
  policy: string | null
  progress: number | null
}

export function rawRowToDomainJob<T>(row: RawJobRow): Job<T> {
  return {
    id: row.id,
    queue: row.queue,
    priority: row.priority,
    data: row.data as T,
    state: row.state as JobState,
    retryLimit: row.retryLimit,
    retryCount: row.retryCount,
    retryDelay: row.retryDelay,
    retryBackoff: row.retryBackoff,
    retryJitter: row.retryJitter,
    startAfter: new Date(row.startAfter),
    startedOn: row.startedOn != null ? new Date(row.startedOn) : null,
    expireIn: row.expireIn,
    expireIfNotStartedIn: row.expireIfNotStartedIn,
    createdOn: new Date(row.createdOn),
    completedOn: row.completedOn != null ? new Date(row.completedOn) : null,
    keepUntil: new Date(row.keepUntil),
    singletonKey: row.singletonKey,
    output: row.output,
    deadLetter: row.deadLetter,
    policy: row.policy,
    progress: row.progress,
  }
}

export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

export interface ManagerOptions {
  dlqRetentionDays?: number
  maxPayloadBytes?: number
  onRetry?: (job: Job<unknown>, error: Error) => Promise<void>
  onDlq?: (payload: { jobId: string; queue: string; deadLetter: string }) => void
}

export { validateSchema } from '../schema.js'
