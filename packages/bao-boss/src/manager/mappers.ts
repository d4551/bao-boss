import { Prisma, type Job as PrismaJob, type Queue as PrismaQueue } from '../generated/prisma/client.js'
import { Type as t } from '@sinclair/typebox'
import type { Job, Queue, QueuePolicy, JobState } from '../types.js'
import { JOB_DEFAULTS, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX, secondsFromNow } from '../defaults.js'

// ── TypeBox schemas ──────────────────────────────────────────────

const policySchema = t.Union([
  t.Literal('standard'), t.Literal('short'), t.Literal('singleton'), t.Literal('stately'),
])

const jobStateSchema = t.Union([
  t.Literal('created'), t.Literal('active'), t.Literal('completed'),
  t.Literal('cancelled'), t.Literal('failed'),
])

export const createQueueSchema = t.Object({
  policy: t.Optional(policySchema),
  retryLimit: t.Optional(t.Integer({ minimum: 0 })),
  retryDelay: t.Optional(t.Integer({ minimum: 0 })),
  retryBackoff: t.Optional(t.Boolean()),
  retryJitter: t.Optional(t.Boolean()),
  expireIn: t.Optional(t.Integer({ minimum: 1 })),
  retentionDays: t.Optional(t.Integer({ minimum: 1 })),
  deadLetter: t.Optional(t.String({ minLength: 1 })),
  rateLimit: t.Optional(t.Object({ count: t.Integer({ minimum: 1 }), period: t.Integer({ minimum: 1 }) })),
  debounce: t.Optional(t.Integer({ minimum: 1 })),
  fairness: t.Optional(t.Object({ lowPriorityShare: t.Number({ minimum: 0, maximum: 1 }) })),
})

export const sendOptionsSchema = t.Object({
  priority: t.Optional(t.Integer()),
  startAfter: t.Optional(t.Union([t.Number(), t.String({ minLength: 1 }), t.Date()])),
  retryLimit: t.Optional(t.Integer({ minimum: 0 })),
  retryDelay: t.Optional(t.Integer({ minimum: 0 })),
  retryBackoff: t.Optional(t.Boolean()),
  retryJitter: t.Optional(t.Boolean()),
  expireIn: t.Optional(t.Integer({ minimum: 1 })),
  expireIfNotStartedIn: t.Optional(t.Integer({ minimum: 1 })),
  singletonKey: t.Optional(t.String({ minLength: 1 })),
  deadLetter: t.Optional(t.String({ minLength: 1 })),
  dependsOn: t.Optional(t.Array(t.String({ minLength: 1 }))),
})

export const jobSearchSchema = t.Object({
  queue: t.Optional(t.String({ minLength: 1 })),
  state: t.Optional(t.Union([jobStateSchema, t.Array(jobStateSchema, { minItems: 1 })])),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: SEARCH_LIMIT_MAX, default: SEARCH_LIMIT_DEFAULT })),
  offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
  sortBy: t.Optional(t.Union([t.Literal('createdOn'), t.Literal('priority'), t.Literal('startAfter')])),
  sortOrder: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
})

// ── JSON boundary ────────────────────────────────────────────────

/**
 * Verify a value is JSON-representable and hand it to Prisma as such.
 *
 * The public API accepts `unknown` job payloads, so something has to bridge to
 * `Prisma.InputJsonValue`. This walks the value instead of asserting it, which
 * turns a `Date`, `undefined` or circular reference into a named error at the
 * call site rather than an opaque Prisma validation dump.
 */
export function toJsonInput(value: unknown, path = 'data'): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const json = checkJson(value, path, new Set())
  return json === null ? Prisma.JsonNull : json
}

function checkJson(value: unknown, path: string, seen: Set<object>): Prisma.InputJsonValue | null {
  if (value === null) return null
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`${path} must be a finite number, received ${value}`)
      }
      return value
    case 'object':
      break
    default:
      throw new TypeError(`${path} cannot be stored as JSON (type ${typeof value})`)
  }

  const object = value as object
  if (seen.has(object)) {
    throw new TypeError(`${path} contains a circular reference and cannot be stored as JSON`)
  }
  seen.add(object)
  try {
    if (Array.isArray(object)) {
      return object.map((item, i) => checkJson(item, `${path}[${i}]`, seen))
    }
    if (Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null) {
      throw new TypeError(
        `${path} must be a plain object, array or primitive to be stored as JSON ` +
        `(received ${object.constructor?.name ?? 'a non-plain object'})`,
      )
    }
    const out: Record<string, Prisma.InputJsonValue | null> = {}
    for (const [key, entry] of Object.entries(object)) {
      if (entry === undefined) continue
      out[key] = checkJson(entry, `${path}.${key}`, seen)
    }
    return out
  } finally {
    seen.delete(object)
  }
}

// ── Mapping helpers ──────────────────────────────────────────────

/**
 * Resolve the `startAfter` option to an absolute instant.
 * A number is seconds from now; a string or Date is an absolute time.
 */
export function resolveStartAfter(startAfter?: number | string | Date): Date {
  if (startAfter === undefined || startAfter === null) return new Date()
  if (startAfter instanceof Date) {
    if (Number.isNaN(startAfter.getTime())) {
      throw new TypeError('startAfter is an invalid Date')
    }
    return startAfter
  }
  if (typeof startAfter === 'number') {
    if (!Number.isFinite(startAfter)) {
      throw new TypeError(`startAfter must be a finite number of seconds, received ${startAfter}`)
    }
    return secondsFromNow(startAfter)
  }
  const parsed = new Date(startAfter)
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`startAfter '${startAfter}' is not a parseable date`)
  }
  return parsed
}

/** A job row from Prisma or from raw SQL, where timestamps arrive as strings. */
export interface JobRow {
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

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function toDateOrNull(value: Date | string | null): Date | null {
  return value === null ? null : toDate(value)
}

/**
 * The one job mapper. Accepts both Prisma model rows and raw SQL rows so adding
 * a column can never be applied to one shape and forgotten on the other.
 */
export function toDomainJob<T = unknown>(row: JobRow | PrismaJob): Job<T> {
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
    startAfter: toDate(row.startAfter),
    startedOn: toDateOrNull(row.startedOn),
    expireIn: row.expireIn,
    expireIfNotStartedIn: row.expireIfNotStartedIn,
    createdOn: toDate(row.createdOn),
    completedOn: toDateOrNull(row.completedOn),
    keepUntil: toDate(row.keepUntil),
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
    policy: (row.policy ?? JOB_DEFAULTS.policy) as QueuePolicy,
    retryLimit: row.retryLimit,
    retryDelay: row.retryDelay,
    retryBackoff: row.retryBackoff,
    retryJitter: row.retryJitter,
    expireIn: row.expireIn,
    retentionDays: row.retentionDays,
    deadLetter: row.deadLetter,
    paused: row.paused,
    rateLimit: readRateLimit(row.rateLimit),
    debounce: row.debounce,
    fairness: readFairness(row.fairness),
    createdOn: row.createdOn,
    updatedOn: row.updatedOn,
  }
}

/** Read the `rateLimit` JSON column, rejecting rows that do not match the stored shape. */
export function readRateLimit(value: Prisma.JsonValue | null): { count: number; period: number } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const { count, period } = value as Record<string, unknown>
  if (typeof count !== 'number' || typeof period !== 'number') return null
  return { count, period }
}

/** Read the `fairness` JSON column, rejecting rows that do not match the stored shape. */
export function readFairness(value: Prisma.JsonValue | null): { lowPriorityShare: number } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const { lowPriorityShare } = value as Record<string, unknown>
  if (typeof lowPriorityShare !== 'number') return null
  return { lowPriorityShare }
}

export interface ManagerOptions {
  dlqRetentionDays?: number
  maxPayloadBytes?: number
  onRetry?: (job: Job<unknown>, error: Error) => Promise<void>
  onDlq?: (payload: { jobId: string; queue: string; deadLetter: string }) => void
}
