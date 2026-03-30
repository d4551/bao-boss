import { PrismaClient, Prisma, type Job as PrismaJob, type Queue as PrismaQueue, type Policy } from './generated/prisma/client.js'
import { Type as t } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { Job, Queue, CreateQueueOptions, SendOptions, QueuePolicy, JobState } from './types.js'

const policySchema = t.Union([t.Literal('standard'), t.Literal('short'), t.Literal('singleton'), t.Literal('stately')])

const createQueueSchema = t.Object({
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

const sendOptionsSchema = t.Object({
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

function resolveStartAfter(startAfter?: number | string | Date): Date {
  if (!startAfter) return new Date()
  if (startAfter instanceof Date) return startAfter
  if (typeof startAfter === 'number') {
    return new Date(Date.now() + startAfter * 1000)
  }
  return new Date(startAfter)
}

function toDomainJob<T>(row: PrismaJob): Job<T> {
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

function toDomainQueue(row: PrismaQueue): Queue {
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
interface RawJobRow {
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

function rawRowToDomainJob<T>(row: RawJobRow): Job<T> {
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

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

const SCHEMA_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function validateSchema(schema: string): string {
  if (!SCHEMA_RE.test(schema)) throw new Error('Invalid schema name')
  return schema
}

export interface ManagerOptions {
  onRetry?: (job: Job<unknown>, error: Error) => Promise<void>
  onDlq?: (payload: { jobId: string; queue: string; deadLetter: string }) => void
}

export class Manager {
  private readonly schema: string

  constructor(
    private readonly prisma: PrismaClient,
    options: ManagerOptions & { schema?: string } = {}
  ) {
    const { schema, ...opts } = options
    this.schema = validateSchema(schema ?? 'baoboss')
    this.options = opts
  }

  private readonly options: ManagerOptions

  async createQueue(name: string, options: CreateQueueOptions = {}): Promise<Queue> {
    const opts = Value.Decode(createQueueSchema, options)
    const policyValue: Policy = (opts.policy ?? 'standard') as Policy
    const q = await this.prisma.queue.upsert({
      where: { name },
      create: {
        name,
        policy: policyValue,
        retryLimit: opts.retryLimit ?? 2,
        retryDelay: opts.retryDelay ?? 0,
        retryBackoff: opts.retryBackoff ?? false,
        retryJitter: opts.retryJitter ?? false,
        expireIn: opts.expireIn ?? 900,
        retentionDays: opts.retentionDays ?? 14,
        deadLetter: opts.deadLetter,
        rateLimit: opts.rateLimit ? toJsonValue(opts.rateLimit) : undefined,
        debounce: opts.debounce,
        fairness: opts.fairness ? toJsonValue(opts.fairness) : undefined,
      },
      update: {
        policy: opts.policy ? opts.policy as Policy : undefined,
        retryLimit: opts.retryLimit,
        retryDelay: opts.retryDelay,
        retryBackoff: opts.retryBackoff,
        retryJitter: opts.retryJitter,
        expireIn: opts.expireIn,
        retentionDays: opts.retentionDays,
        deadLetter: opts.deadLetter,
        rateLimit: opts.rateLimit ? toJsonValue(opts.rateLimit) : undefined,
        debounce: opts.debounce,
        fairness: opts.fairness ? toJsonValue(opts.fairness) : undefined,
      },
    })
    return toDomainQueue(q)
  }

  async updateQueue(name: string, options: Partial<CreateQueueOptions>): Promise<Queue> {
    const data: Prisma.QueueUpdateInput = {}
    if (options.policy !== undefined) data.policy = options.policy as Policy
    if (options.retryLimit !== undefined) data.retryLimit = options.retryLimit
    if (options.retryDelay !== undefined) data.retryDelay = options.retryDelay
    if (options.retryBackoff !== undefined) data.retryBackoff = options.retryBackoff
    if (options.retryJitter !== undefined) data.retryJitter = options.retryJitter
    if (options.expireIn !== undefined) data.expireIn = options.expireIn
    if (options.retentionDays !== undefined) data.retentionDays = options.retentionDays
    if (options.deadLetter !== undefined) data.deadLetter = options.deadLetter
    if (options.rateLimit !== undefined) data.rateLimit = toJsonValue(options.rateLimit)
    if (options.debounce !== undefined) data.debounce = options.debounce
    if (options.fairness !== undefined) data.fairness = toJsonValue(options.fairness)
    const q = await this.prisma.queue.update({
      where: { name },
      data,
    })
    return toDomainQueue(q)
  }

  async pauseQueue(name: string): Promise<void> {
    await this.prisma.queue.update({
      where: { name },
      data: { paused: true },
    })
  }

  async resumeQueue(name: string): Promise<void> {
    await this.prisma.queue.update({
      where: { name },
      data: { paused: false },
    })
  }

  async deleteQueue(name: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.job.deleteMany({ where: { queue: name } }),
      this.prisma.queue.delete({ where: { name } }),
    ])
  }

  async purgeQueue(name: string): Promise<void> {
    await this.prisma.job.deleteMany({
      where: { queue: name, state: { in: ['created'] } },
    })
  }

  async getQueue(name: string): Promise<Queue | null> {
    const q = await this.prisma.queue.findUnique({ where: { name } })
    if (!q) return null
    return toDomainQueue(q)
  }

  async getQueues(): Promise<Queue[]> {
    const qs = await this.prisma.queue.findMany()
    return qs.map(toDomainQueue)
  }

  async send<T = unknown>(name: string, data?: T, options: SendOptions = {}): Promise<string> {
    const opts = Value.Decode(sendOptionsSchema, options)

    // Check queue policy
    const queue = await this.prisma.queue.findUnique({ where: { name } })

    if (queue) {
      const policy = queue.policy as string
      const debounce = queue.debounce
      if (debounce && debounce > 0) {
        // Debounced queue: upsert debounce_state, return placeholder id
        const debounceUntil = new Date(Date.now() + debounce * 1000)
        const existing = await this.prisma.debounceState.findUnique({
          where: { queue_debounceKey: { queue: name, debounceKey: 'default' } },
        })
        const items = Array.isArray(existing?.dataAggregate) ? existing.dataAggregate : null
        const newItems = Array.isArray(items) ? [...items, data] : [data]
        await this.prisma.debounceState.upsert({
          where: { queue_debounceKey: { queue: name, debounceKey: 'default' } },
          create: {
            queue: name,
            debounceKey: 'default',
            dataAggregate: toJsonValue(newItems),
            debounceUntil,
          },
          update: {
            dataAggregate: toJsonValue(newItems),
            debounceUntil,
          },
        })
        return `debounce:${name}:default`
      }
      if (policy === 'short') {
        const existing = await this.prisma.job.findFirst({
          where: { queue: name, state: 'created' },
        })
        if (existing) return existing.id
      }
      // 'singleton': jobs are queued normally; the SKIP LOCKED fetch ensures only
      // one is active at a time because the active row is locked until complete/fail.
      // 'stately': at most one created + one active simultaneously.
      if (policy === 'stately') {
        const hasCreated = await this.prisma.job.findFirst({
          where: { queue: name, state: 'created' },
        })
        if (hasCreated) return hasCreated.id
      }
    }

    const job = await this.prisma.job.create({
      data: {
        queue: name,
        data: data as Prisma.InputJsonValue,
        priority: opts.priority ?? 0,
        startAfter: resolveStartAfter(opts.startAfter),
        retryLimit: opts.retryLimit ?? queue?.retryLimit ?? 2,
        retryDelay: opts.retryDelay ?? queue?.retryDelay ?? 0,
        retryBackoff: opts.retryBackoff ?? queue?.retryBackoff ?? false,
        retryJitter: opts.retryJitter ?? queue?.retryJitter ?? false,
        expireIn: opts.expireIn ?? queue?.expireIn ?? 900,
        expireIfNotStartedIn: opts.expireIfNotStartedIn,
        singletonKey: opts.singletonKey,
        deadLetter: opts.deadLetter ?? queue?.deadLetter,
        policy: queue?.policy ?? 'standard',
        keepUntil: new Date(Date.now() + (queue?.retentionDays ?? 14) * 24 * 60 * 60 * 1000),
      },
    })
    if (opts.dependsOn && opts.dependsOn.length > 0) {
      await this.prisma.jobDependency.createMany({
        data: opts.dependsOn.map(depId => ({ jobId: job.id, dependsOnId: depId })),
        skipDuplicates: true,
      })
    }
    return job.id
  }

  async insert(jobs: Array<{ name: string; data?: unknown; options?: SendOptions }>): Promise<string[]> {
    const ids: string[] = []
    await this.prisma.$transaction(async (tx) => {
      for (const job of jobs) {
        const opts = Value.Decode(sendOptionsSchema, job.options ?? {})
        const queue = await tx.queue.findUnique({ where: { name: job.name } })
        const created = await tx.job.create({
          data: {
            queue: job.name,
            data: job.data as Prisma.InputJsonValue,
            priority: opts.priority ?? 0,
            startAfter: resolveStartAfter(opts.startAfter),
            retryLimit: opts.retryLimit ?? queue?.retryLimit ?? 2,
            retryDelay: opts.retryDelay ?? queue?.retryDelay ?? 0,
            retryBackoff: opts.retryBackoff ?? queue?.retryBackoff ?? false,
            retryJitter: opts.retryJitter ?? queue?.retryJitter ?? false,
            expireIn: opts.expireIn ?? queue?.expireIn ?? 900,
            expireIfNotStartedIn: opts.expireIfNotStartedIn,
            singletonKey: opts.singletonKey,
            deadLetter: opts.deadLetter ?? queue?.deadLetter,
            policy: queue?.policy ?? 'standard',
            keepUntil: new Date(Date.now() + (queue?.retentionDays ?? 14) * 24 * 60 * 60 * 1000),
          },
        })
        if (opts.dependsOn && opts.dependsOn.length > 0) {
          await tx.jobDependency.createMany({
            data: opts.dependsOn.map((depId: string) => ({ jobId: created.id, dependsOnId: depId })),
            skipDuplicates: true,
          })
        }
        ids.push(created.id)
      }
    })
    return ids
  }

  async fetch<T = unknown>(queue: string, options: { batchSize?: number } = {}): Promise<Job<T>[]> {
    const batchSize = options.batchSize ?? 1

    const queueRow = await this.prisma.queue.findUnique({ where: { name: queue } })
    if (!queueRow) return []

    // Rate limit: count jobs started in the last period seconds
    const rateLimit = queueRow.rateLimit as { count: number; period: number } | null
    if (rateLimit && rateLimit.count > 0 && rateLimit.period > 0) {
      const since = new Date(Date.now() - rateLimit.period * 1000)
      const startedCount = await this.prisma.job.count({
        where: {
          queue,
          state: { in: ['active', 'completed'] },
          startedOn: { gte: since },
        },
      })
      if (startedCount >= rateLimit.count) return []
    }

    // For singleton/stately policies, enforce at most one active job at a time
    if (queueRow.policy === 'singleton' || queueRow.policy === 'stately') {
      const activeCount = await this.prisma.job.count({
        where: { queue, state: 'active' },
      })
      if (activeCount > 0) return []
    }

    // Skip paused queues
    if (queueRow.paused) return []

    const effectiveBatch = queueRow.policy === 'singleton' || queueRow.policy === 'stately'
      ? 1
      : batchSize

    const fairness = (queueRow.fairness as { lowPriorityShare?: number } | null)?.lowPriorityShare ?? 0
    const s = this.schema
    const orderByClause =
      fairness > 0
        ? '(CASE WHEN random() < $2 THEN 0 ELSE 1 END) ASC, j.priority DESC, j."createdOn" ASC'
        : 'j.priority DESC, j."createdOn" ASC'
    const limitParam = fairness > 0 ? 3 : 2
    const query = `
      WITH next_jobs AS (
        SELECT j.id
        FROM "${s}".job j
        WHERE j.queue = $1
          AND j.state = 'created'
          AND j."startAfter" <= now()
          AND NOT EXISTS (
            SELECT 1 FROM "${s}".job_dependency d
            WHERE d."jobId" = j.id
              AND d."dependsOnId" NOT IN (
                SELECT id FROM "${s}".job WHERE state IN ('completed', 'cancelled')
              )
          )
        ORDER BY ${orderByClause}
        LIMIT $${limitParam}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "${s}".job j
      SET state = 'active', "startedOn" = now()
      FROM next_jobs
      WHERE j.id = next_jobs.id
      RETURNING j.*
    `
    const params = fairness > 0 ? [queue, fairness, effectiveBatch] : [queue, effectiveBatch]
    const rows = await this.prisma.$queryRawUnsafe<RawJobRow[]>(query, ...params)
    return rows.map(row => rawRowToDomainJob<T>(row))
  }

  async complete(id: string | string[], options: { output?: unknown } = {}): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    const output = options.output ? JSON.stringify(options.output) : null
    const s = this.schema

    for (const jobId of ids) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "${s}".job SET state = 'completed', "completedOn" = now(), output = $1::jsonb WHERE id = $2::uuid AND state = 'active'`,
        output,
        jobId
      )
    }
  }

  async fail(id: string | string[], error?: Error | string): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    if (ids.length === 0) return
    const errorMsg = error instanceof Error ? error.message : (error ?? 'Unknown error')
    const output = JSON.stringify({ error: errorMsg })

    // Batch fetch all jobs in one query
    const jobs = await this.prisma.job.findMany({
      where: { id: { in: ids }, state: 'active' },
    })
    if (jobs.length === 0) return

    const s = this.schema
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ')
    const retryQuery = `
      UPDATE "${s}".job
      SET state = 'created', "retryCount" = "retryCount" + 1,
          "startAfter" = now() + (
            "retryDelay" * CASE WHEN "retryBackoff" THEN power(2, "retryCount")::int ELSE 1 END
            * CASE WHEN "retryJitter" THEN (0.5 + random() * 0.5) ELSE 1 END
            || ' seconds'
          )::interval,
          output = $1::jsonb
      WHERE id IN (${placeholders}) AND state = 'active' AND "retryCount" < "retryLimit"
    `
    const failQuery = `
      UPDATE "${s}".job
      SET state = 'failed', "retryCount" = "retryCount" + 1, output = $1::jsonb
      WHERE id IN (${placeholders}) AND state = 'active' AND "retryCount" >= "retryLimit"
      RETURNING id, "deadLetter", data, priority, "expireIn", "singletonKey"
    `

    // Call onRetry hook for each job that will be retried
    const retryJobs = jobs.filter(j => j.retryCount < j.retryLimit)
    for (const job of retryJobs) {
      await this.options.onRetry?.(toDomainJob(job), new Error(errorMsg))
    }

    // Batch retry: jobs with retryCount < retryLimit (with optional jitter)
    await this.prisma.$executeRawUnsafe(retryQuery, output, ...ids)

    // Batch fail: jobs with retryCount >= retryLimit, RETURNING for DLQ
    const exhausted = await this.prisma.$queryRawUnsafe<Array<{
      id: string
      deadLetter: string | null
      data: unknown
      priority: number
      expireIn: number
      singletonKey: string | null
    }>>(failQuery, output, ...ids)

    // Batch DLQ inserts for exhausted jobs with deadLetter
    type ExhaustedRow = (typeof exhausted)[number]
    const dlqJobs = exhausted.filter((j: ExhaustedRow) => j.deadLetter)
    if (dlqJobs.length > 0) {
      const keepUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      await this.prisma.job.createMany({
        data: dlqJobs.map((j: ExhaustedRow) => ({
          queue: j.deadLetter!,
          data: j.data as Prisma.InputJsonValue,
          priority: j.priority,
          retryLimit: 0,
          retryCount: 0,
          retryDelay: 0,
          retryBackoff: false,
          expireIn: j.expireIn,
          singletonKey: j.singletonKey,
          deadLetter: null,
          policy: 'standard',
          keepUntil,
        })),
      })
      const jobQueueMap = new Map(jobs.map(j => [j.id, j.queue]))
      for (const j of dlqJobs) {
        this.options.onDlq?.({ jobId: j.id, queue: jobQueueMap.get(j.id) ?? 'unknown', deadLetter: j.deadLetter! })
      }
    }
  }

  async getDLQDepth(deadLetterQueueName: string): Promise<number> {
    return this.prisma.job.count({
      where: { queue: deadLetterQueueName },
    })
  }

  async cancel(id: string | string[]): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    await this.prisma.job.updateMany({
      where: { id: { in: ids }, state: { in: ['created', 'active'] } },
      data: { state: 'cancelled' },
    })
  }

  async resume(id: string | string[]): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    await this.prisma.job.updateMany({
      where: { id: { in: ids }, state: { in: ['cancelled', 'failed'] } },
      data: { state: 'created', retryCount: 0 },
    })
  }

  async cancelJobs(queue: string, filter?: { state?: 'created' | 'active' }): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: {
        queue,
        state: { in: filter?.state ? [filter.state] : ['created', 'active'] },
      },
      data: { state: 'cancelled' },
    })
    return result.count
  }

  async resumeJobs(queue: string, filter?: { state?: 'failed' | 'cancelled' }): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: {
        queue,
        state: { in: filter?.state ? [filter.state] : ['cancelled', 'failed'] },
      },
      data: { state: 'created', retryCount: 0 },
    })
    return result.count
  }

  async searchJobs<T = unknown>(filter: import('./types.js').JobSearchOptions = {}): Promise<{ jobs: Job<T>[]; total: number }> {
    const where: Prisma.JobWhereInput = {}
    if (filter.queue) where.queue = filter.queue
    if (filter.state) {
      where.state = Array.isArray(filter.state) ? { in: filter.state } : filter.state
    }
    const limit = filter.limit ?? 50
    const offset = filter.offset ?? 0
    const sortBy = filter.sortBy ?? 'createdOn'
    const sortOrder = filter.sortOrder ?? 'desc'

    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        take: limit,
        skip: offset,
      }),
      this.prisma.job.count({ where }),
    ])

    return {
      jobs: jobs.map(j => toDomainJob<T>(j)),
      total,
    }
  }

  async getJobDependencies<T = unknown>(jobId: string): Promise<{ dependsOn: Job<T>[]; dependedBy: Job<T>[] }> {
    const [upstream, downstream] = await Promise.all([
      this.prisma.jobDependency.findMany({
        where: { jobId },
        select: { dependsOnId: true },
      }),
      this.prisma.jobDependency.findMany({
        where: { dependsOnId: jobId },
        select: { jobId: true },
      }),
    ])

    const [dependsOnJobs, dependedByJobs] = await Promise.all([
      upstream.length > 0
        ? this.prisma.job.findMany({ where: { id: { in: upstream.map(d => d.dependsOnId) } } })
        : [],
      downstream.length > 0
        ? this.prisma.job.findMany({ where: { id: { in: downstream.map(d => d.jobId) } } })
        : [],
    ])

    return {
      dependsOn: dependsOnJobs.map(j => toDomainJob<T>(j)),
      dependedBy: dependedByJobs.map(j => toDomainJob<T>(j)),
    }
  }

  async progress(id: string, value: number): Promise<void> {
    const p = Math.min(100, Math.max(0, Math.round(value)))
    await this.prisma.job.updateMany({
      where: { id, state: 'active' },
      data: { progress: p },
    })
  }

  async getJobById<T = unknown>(id: string): Promise<Job<T> | null> {
    const job = await this.prisma.job.findUnique({ where: { id } })
    if (!job) return null
    return toDomainJob<T>(job)
  }

  async getJobsById<T = unknown>(ids: string[]): Promise<Job<T>[]> {
    const jobs = await this.prisma.job.findMany({ where: { id: { in: ids } } })
    return jobs.map(j => toDomainJob<T>(j))
  }

  async getQueueSize(queue: string, options?: { before?: string }): Promise<number> {
    const states: JobState[] = options?.before === 'active'
      ? ['created']
      : ['created', 'active']
    const count = await this.prisma.job.count({
      where: { queue, state: { in: states } },
    })
    return count
  }

  async publish(event: string, data?: unknown, options?: SendOptions): Promise<void> {
    const subs = await this.prisma.subscription.findMany({ where: { event } })
    if (subs.length === 0) return

    await this.prisma.$transaction(async (tx) => {
      for (const sub of subs) {
        const opts = Value.Decode(sendOptionsSchema, options ?? {})
        const queue = await tx.queue.findUnique({ where: { name: sub.queue } })
        await tx.job.create({
          data: {
            queue: sub.queue,
            data: data as Prisma.InputJsonValue,
            priority: opts.priority ?? 0,
            startAfter: resolveStartAfter(opts.startAfter),
            retryLimit: opts.retryLimit ?? queue?.retryLimit ?? 2,
            retryDelay: opts.retryDelay ?? queue?.retryDelay ?? 0,
            retryBackoff: opts.retryBackoff ?? queue?.retryBackoff ?? false,
            retryJitter: opts.retryJitter ?? queue?.retryJitter ?? false,
            expireIn: opts.expireIn ?? queue?.expireIn ?? 900,
            expireIfNotStartedIn: opts.expireIfNotStartedIn,
            deadLetter: queue?.deadLetter,
            policy: queue?.policy ?? 'standard',
            keepUntil: new Date(Date.now() + (queue?.retentionDays ?? 14) * 24 * 60 * 60 * 1000),
          },
        })
      }
    })
  }

  async subscribe(event: string, queue: string): Promise<void> {
    await this.prisma.subscription.upsert({
      where: { event_queue: { event, queue } },
      create: { event, queue },
      update: {},
    })
  }

  async unsubscribe(event: string, queue: string): Promise<void> {
    await this.prisma.subscription.delete({
      where: { event_queue: { event, queue } },
    })
  }
}
