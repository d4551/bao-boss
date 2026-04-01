import { PrismaClient, Prisma, type Policy } from '../generated/prisma/client.js'
import { Value } from '@sinclair/typebox/value'
import type { Queue, CreateQueueOptions, JobState } from '../types.js'
import { createQueueSchema, toDomainQueue, toJsonValue } from './mappers.js'

export class QueueOps {
  constructor(private readonly prisma: PrismaClient) {}

  async createQueue(name: string, options: CreateQueueOptions = {}): Promise<Queue> {
    const opts = Value.Decode(createQueueSchema, options)
    if (opts.deadLetter) {
      await this.validateDeadLetter(opts.deadLetter, name)
    }
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
    if (options.deadLetter !== undefined) {
      if (options.deadLetter) {
        await this.validateDeadLetter(options.deadLetter, name)
        data.deadLetter = options.deadLetter
      } else {
        data.deadLetter = null
      }
    }
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

  async getQueueSize(queue: string, options?: { before?: string }): Promise<number> {
    const states: JobState[] = options?.before === 'active'
      ? ['created']
      : ['created', 'active']
    return this.prisma.job.count({
      where: { queue, state: { in: states } },
    })
  }

  private async validateDeadLetter(deadLetter: string, queueName: string): Promise<void> {
    if (deadLetter === queueName) {
      throw new Error(`Queue '${queueName}' cannot use itself as its dead letter queue`)
    }
    const dlq = await this.prisma.queue.findUnique({ where: { name: deadLetter } })
    if (!dlq) {
      throw new Error(`Dead letter queue '${deadLetter}' does not exist`)
    }
    const visited = new Set<string>([queueName, deadLetter])
    let current = dlq.deadLetter
    while (current) {
      if (current === queueName) {
        throw new Error(`Circular dead letter reference involving queue '${queueName}'`)
      }
      if (visited.has(current)) break
      visited.add(current)
      const next = await this.prisma.queue.findUnique({ where: { name: current } })
      if (!next) break
      current = next.deadLetter
      if (visited.size > 32) break
    }
  }
}
