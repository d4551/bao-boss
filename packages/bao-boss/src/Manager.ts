import { PrismaClient, Prisma } from '@prisma/client'
import { z } from 'zod'
import type { Job, Queue, CreateQueueOptions, SendOptions } from './types.js'

const createQueueSchema = z.object({
  policy: z.enum(['standard', 'short', 'singleton', 'stately']).optional(),
  retryLimit: z.number().int().min(0).optional(),
  retryDelay: z.number().int().min(0).optional(),
  retryBackoff: z.boolean().optional(),
  expireIn: z.number().int().min(1).optional(),
  retentionDays: z.number().int().min(1).optional(),
  deadLetter: z.string().optional(),
})

const sendOptionsSchema = z.object({
  priority: z.number().int().optional(),
  startAfter: z.union([z.number(), z.string(), z.date()]).optional(),
  retryLimit: z.number().int().min(0).optional(),
  retryDelay: z.number().int().min(0).optional(),
  retryBackoff: z.boolean().optional(),
  expireIn: z.number().int().min(1).optional(),
  singletonKey: z.string().optional(),
  deadLetter: z.string().optional(),
})

function resolveStartAfter(startAfter?: number | string | Date): Date {
  if (!startAfter) return new Date()
  if (startAfter instanceof Date) return startAfter
  if (typeof startAfter === 'number') {
    return new Date(Date.now() + startAfter * 1000)
  }
  return new Date(startAfter)
}

function mapJob<T>(row: Record<string, unknown>): Job<T> {
  return {
    id: row['id'] as string,
    queue: row['queue'] as string,
    priority: row['priority'] as number,
    data: row['data'] as T,
    state: row['state'] as Job['state'],
    retryLimit: (row['retry_limit'] as number) ?? (row['retryLimit'] as number),
    retryCount: (row['retry_count'] as number) ?? (row['retryCount'] as number),
    retryDelay: (row['retry_delay'] as number) ?? (row['retryDelay'] as number),
    retryBackoff: (row['retry_backoff'] as boolean) ?? (row['retryBackoff'] as boolean),
    startAfter: new Date((row['start_after'] as string) ?? (row['startAfter'] as string)),
    startedOn: row['started_on'] != null ? new Date(row['started_on'] as string) : null,
    expireIn: (row['expire_in'] as number) ?? (row['expireIn'] as number),
    createdOn: new Date((row['created_on'] as string) ?? (row['createdOn'] as string)),
    completedOn: row['completed_on'] != null ? new Date(row['completed_on'] as string) : null,
    keepUntil: new Date((row['keep_until'] as string) ?? (row['keepUntil'] as string)),
    singletonKey: (row['singleton_key'] as string | null) ?? (row['singletonKey'] as string | null),
    output: row['output'] as unknown,
    deadLetter: (row['dead_letter'] as string | null) ?? (row['deadLetter'] as string | null),
    policy: row['policy'] as string | null,
  }
}

export class Manager {
  constructor(private readonly prisma: PrismaClient) {}

  async createQueue(name: string, options: CreateQueueOptions = {}): Promise<Queue> {
    const opts = createQueueSchema.parse(options)
    const q = await this.prisma.queue.upsert({
      where: { name },
      create: {
        name,
        policy: (opts.policy ?? 'standard') as never,
        retryLimit: opts.retryLimit ?? 2,
        retryDelay: opts.retryDelay ?? 0,
        retryBackoff: opts.retryBackoff ?? false,
        expireIn: opts.expireIn ?? 900,
        retentionDays: opts.retentionDays ?? 14,
        deadLetter: opts.deadLetter,
      },
      update: {
        policy: opts.policy as never,
        retryLimit: opts.retryLimit,
        retryDelay: opts.retryDelay,
        retryBackoff: opts.retryBackoff,
        expireIn: opts.expireIn,
        retentionDays: opts.retentionDays,
        deadLetter: opts.deadLetter,
      },
    })
    return q as unknown as Queue
  }

  async updateQueue(name: string, options: Partial<CreateQueueOptions>): Promise<Queue> {
    const q = await this.prisma.queue.update({
      where: { name },
      data: options as never,
    })
    return q as unknown as Queue
  }

  async deleteQueue(name: string): Promise<void> {
    await this.prisma.job.deleteMany({ where: { queue: name } })
    await this.prisma.queue.delete({ where: { name } })
  }

  async purgeQueue(name: string): Promise<void> {
    await this.prisma.job.deleteMany({
      where: { queue: name, state: { in: ['created'] } },
    })
  }

  async getQueue(name: string): Promise<Queue | null> {
    const q = await this.prisma.queue.findUnique({ where: { name } })
    return q as unknown as Queue | null
  }

  async getQueues(): Promise<Queue[]> {
    const qs = await this.prisma.queue.findMany()
    return qs as unknown as Queue[]
  }

  async send<T = unknown>(name: string, data?: T, options: SendOptions = {}): Promise<string> {
    const opts = sendOptionsSchema.parse(options)

    // Check queue policy
    const queue = await this.prisma.queue.findUnique({ where: { name } })

    if (queue) {
      const policy = queue.policy as string
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
        expireIn: opts.expireIn ?? queue?.expireIn ?? 900,
        singletonKey: opts.singletonKey,
        deadLetter: opts.deadLetter ?? queue?.deadLetter,
        policy: queue?.policy ?? 'standard',
        keepUntil: new Date(Date.now() + (queue?.retentionDays ?? 14) * 24 * 60 * 60 * 1000),
      },
    })
    return job.id
  }

  async insert(jobs: Array<{ name: string; data?: unknown; options?: SendOptions }>): Promise<string[]> {
    const ids: string[] = []
    await this.prisma.$transaction(async (tx) => {
      for (const job of jobs) {
        const opts = sendOptionsSchema.parse(job.options ?? {})
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
            expireIn: opts.expireIn ?? queue?.expireIn ?? 900,
            singletonKey: opts.singletonKey,
            deadLetter: opts.deadLetter ?? queue?.deadLetter,
            policy: queue?.policy ?? 'standard',
            keepUntil: new Date(Date.now() + (queue?.retentionDays ?? 14) * 24 * 60 * 60 * 1000),
          },
        })
        ids.push(created.id)
      }
    })
    return ids
  }

  async fetch<T = unknown>(queue: string, options: { batchSize?: number } = {}): Promise<Job<T>[]> {
    const batchSize = options.batchSize ?? 1

    // For singleton/stately policies, enforce at most one active job at a time
    const queueRow = await this.prisma.queue.findUnique({ where: { name: queue } })
    if (queueRow && (queueRow.policy === 'singleton' || queueRow.policy === 'stately')) {
      const activeCount = await this.prisma.job.count({
        where: { queue, state: 'active' },
      })
      if (activeCount > 0) return []
    }

    const effectiveBatch = queueRow && (queueRow.policy === 'singleton' || queueRow.policy === 'stately')
      ? 1
      : batchSize

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      WITH next_jobs AS (
        SELECT id
        FROM baoboss.job
        WHERE queue       = ${queue}
          AND state       = 'created'
          AND "startAfter" <= now()
        ORDER BY priority DESC, "createdOn" ASC
        LIMIT ${effectiveBatch}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE baoboss.job j
      SET    state       = 'active',
             "startedOn" = now()
      FROM   next_jobs
      WHERE  j.id = next_jobs.id
      RETURNING j.*;
    `
    return rows.map(row => mapJob<T>(row))
  }

  async complete(id: string | string[], options: { output?: unknown } = {}): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    const output = options.output ? JSON.stringify(options.output) : null

    for (const jobId of ids) {
      await this.prisma.$executeRaw`
        UPDATE baoboss.job
        SET    state        = 'completed',
               "completedOn" = now(),
               output       = ${output}::jsonb
        WHERE  id = ${jobId}::uuid
          AND  state = 'active'
      `
    }
  }

  async fail(id: string | string[], error?: Error | string): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    const errorMsg = error instanceof Error ? error.message : (error ?? 'Unknown error')
    const output = JSON.stringify({ error: errorMsg })

    for (const jobId of ids) {
      const job = await this.prisma.job.findUnique({ where: { id: jobId } })
      if (!job) continue

      if (job.retryCount < job.retryLimit) {
        // Retry
        let delay = job.retryDelay
        if (job.retryBackoff) {
          delay = job.retryDelay * Math.pow(2, job.retryCount)
        }
        const startAfter = new Date(Date.now() + delay * 1000)
        await this.prisma.job.update({
          where: { id: jobId },
          data: {
            state: 'created',
            retryCount: { increment: 1 },
            startAfter,
            output: output as Prisma.InputJsonValue,
          },
        })
      } else {
        // Failed — check dead letter
        await this.prisma.job.update({
          where: { id: jobId },
          data: {
            state: 'failed',
            retryCount: { increment: 1 },
            output: output as Prisma.InputJsonValue,
          },
        })

        if (job.deadLetter) {
          await this.prisma.job.create({
            data: {
              queue: job.deadLetter,
              data: job.data as Prisma.InputJsonValue,
              priority: job.priority,
              retryLimit: 0,
              retryCount: 0,
              retryDelay: 0,
              retryBackoff: false,
              expireIn: job.expireIn,
              singletonKey: job.singletonKey,
              deadLetter: null,
              policy: 'standard',
              keepUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            },
          })
        }
      }
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

  async getJobById<T = unknown>(id: string): Promise<Job<T> | null> {
    const job = await this.prisma.job.findUnique({ where: { id } })
    if (!job) return null
    return mapJob<T>(job as unknown as Record<string, unknown>)
  }

  async getJobsById<T = unknown>(ids: string[]): Promise<Job<T>[]> {
    const jobs = await this.prisma.job.findMany({ where: { id: { in: ids } } })
    return jobs.map(j => mapJob<T>(j as unknown as Record<string, unknown>))
  }

  async getQueueSize(queue: string, options?: { before?: string }): Promise<number> {
    const states = options?.before === 'active'
      ? ['created']
      : ['created', 'active']
    const count = await this.prisma.job.count({
      where: { queue, state: { in: states as never[] } },
    })
    return count
  }

  async publish(event: string, data?: unknown, options?: SendOptions): Promise<void> {
    const subs = await this.prisma.subscription.findMany({ where: { event } })
    if (subs.length === 0) return

    await this.prisma.$transaction(async (tx) => {
      for (const sub of subs) {
        const opts = sendOptionsSchema.parse(options ?? {})
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
            expireIn: opts.expireIn ?? queue?.expireIn ?? 900,
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
