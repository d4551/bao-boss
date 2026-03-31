import { PrismaClient, Prisma } from '../generated/prisma/client.js'
import { Value } from '@sinclair/typebox/value'
import type { Job, SendOptions, JobState } from '../types.js'
import {
  sendOptionsSchema,
  resolveStartAfter,
  toDomainJob,
  rawRowToDomainJob,
  toJsonValue,
  type RawJobRow,
  type ManagerOptions,
} from './mappers.js'

// ── Helpers for breaking up long functions ────────────────────────

async function handleDebounce(
  prisma: PrismaClient,
  name: string,
  data: unknown,
  debounce: number,
): Promise<string> {
  const debounceUntil = new Date(Date.now() + debounce * 1000)
  const existing = await prisma.debounceState.findUnique({
    where: { queue_debounceKey: { queue: name, debounceKey: 'default' } },
  })
  const items = Array.isArray(existing?.dataAggregate) ? existing.dataAggregate : null
  const newItems = Array.isArray(items) ? [...items, data] : [data]
  await prisma.debounceState.upsert({
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

async function checkQueuePolicy(
  prisma: PrismaClient,
  name: string,
  policy: string,
): Promise<string | null> {
  if (policy === 'short') {
    const existing = await prisma.job.findFirst({
      where: { queue: name, state: 'created' },
    })
    if (existing) return existing.id
  }
  if (policy === 'stately') {
    const hasCreated = await prisma.job.findFirst({
      where: { queue: name, state: 'created' },
    })
    if (hasCreated) return hasCreated.id
  }
  return null
}

async function checkRateLimit(
  prisma: PrismaClient,
  queue: string,
  rateLimit: { count: number; period: number } | null,
): Promise<boolean> {
  if (!rateLimit || rateLimit.count <= 0 || rateLimit.period <= 0) return false
  const since = new Date(Date.now() - rateLimit.period * 1000)
  const startedCount = await prisma.job.count({
    where: {
      queue,
      state: { in: ['active', 'completed'] },
      startedOn: { gte: since },
    },
  })
  return startedCount >= rateLimit.count
}

function buildFetchQuery(
  schema: string,
  fairness: number,
  effectiveBatch: number,
): { query: string; params: (string | number)[] } {
  const orderByClause =
    fairness > 0
      ? '(CASE WHEN random() < $2 THEN 0 ELSE 1 END) ASC, j.priority DESC, j."createdOn" ASC'
      : 'j.priority DESC, j."createdOn" ASC'
  const limitParam = fairness > 0 ? 3 : 2
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
      ORDER BY ${orderByClause}
      LIMIT $${limitParam}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "${schema}".job j
    SET state = 'active', "startedOn" = now()
    FROM next_jobs
    WHERE j.id = next_jobs.id
    RETURNING j.*
  `
  const params: (string | number)[] = fairness > 0
    ? ['', fairness, effectiveBatch]
    : ['', effectiveBatch]
  return { query, params }
}

interface ExhaustedRow {
  id: string
  deadLetter: string | null
  data: unknown
  priority: number
  expireIn: number
  singletonKey: string | null
}

async function createDlqJobs(
  prisma: PrismaClient,
  dlqJobs: ExhaustedRow[],
  jobQueueMap: Map<string, string>,
  dlqRetentionDays: number,
  onDlq?: (payload: { jobId: string; queue: string; deadLetter: string }) => void,
): Promise<void> {
  const keepUntil = new Date(Date.now() + dlqRetentionDays * 24 * 60 * 60 * 1000)
  await prisma.job.createMany({
    data: dlqJobs.map((j) => ({
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
  for (const j of dlqJobs) {
    onDlq?.({ jobId: j.id, queue: jobQueueMap.get(j.id) ?? 'unknown', deadLetter: j.deadLetter! })
  }
}

// ── JobOps class ─────────────────────────────────────────────────

export class JobOps {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly schema: string,
    private readonly options: ManagerOptions,
  ) {}

  async send<T = unknown>(name: string, data?: T, options: SendOptions = {}): Promise<string> {
    const opts = Value.Decode(sendOptionsSchema, options)
    const queue = await this.prisma.queue.findUnique({ where: { name } })

    if (queue) {
      const debounce = queue.debounce
      if (debounce && debounce > 0) {
        return handleDebounce(this.prisma, name, data, debounce)
      }
      const policyResult = await checkQueuePolicy(this.prisma, name, queue.policy as string)
      if (policyResult) return policyResult
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

    const rateLimit = queueRow.rateLimit as { count: number; period: number } | null
    if (await checkRateLimit(this.prisma, queue, rateLimit)) return []

    if (queueRow.policy === 'singleton' || queueRow.policy === 'stately') {
      const activeCount = await this.prisma.job.count({
        where: { queue, state: 'active' },
      })
      if (activeCount > 0) return []
    }

    if (queueRow.paused) return []

    const effectiveBatch = queueRow.policy === 'singleton' || queueRow.policy === 'stately'
      ? 1
      : batchSize
    const fairness = (queueRow.fairness as { lowPriorityShare?: number } | null)?.lowPriorityShare ?? 0
    const { query, params } = buildFetchQuery(this.schema, fairness, effectiveBatch)
    params[0] = queue
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

    const retryJobs = jobs.filter(j => j.retryCount < j.retryLimit)
    for (const job of retryJobs) {
      await this.options.onRetry?.(toDomainJob(job), new Error(errorMsg))
    }

    await this.prisma.$executeRawUnsafe(retryQuery, output, ...ids)

    const exhausted = await this.prisma.$queryRawUnsafe<ExhaustedRow[]>(failQuery, output, ...ids)

    const dlqJobs = exhausted.filter((j) => j.deadLetter)
    if (dlqJobs.length > 0) {
      const jobQueueMap = new Map(jobs.map(j => [j.id, j.queue]))
      await createDlqJobs(
        this.prisma,
        dlqJobs,
        jobQueueMap,
        this.options.dlqRetentionDays ?? 14,
        this.options.onDlq,
      )
    }
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

}
