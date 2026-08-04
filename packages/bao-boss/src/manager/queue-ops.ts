import { PrismaClient, Prisma, type Policy } from '../generated/prisma/client.js'
import { Value } from '@sinclair/typebox/value'
import type { Queue, CreateQueueOptions, JobState } from '../types.js'
import { DEAD_LETTER_CHAIN_MAX, JOB_DEFAULTS } from '../defaults.js'
import { createQueueSchema, toDomainQueue, toJsonInput } from './mappers.js'

/** Job states that still count toward a queue's outstanding work. */
const PENDING_STATES: readonly JobState[] = ['created', 'active']
const WAITING_STATES: readonly JobState[] = ['created']

type DecodedQueueOptions = ReturnType<typeof decodeQueueOptions>

function decodeQueueOptions(options: CreateQueueOptions) {
  return Value.Decode(createQueueSchema, options)
}

/** Columns written on both create and update, so the two can never drift apart. */
function queueWriteData(opts: DecodedQueueOptions): Prisma.QueueUpdateInput {
  return {
    policy: opts.policy as Policy | undefined,
    retryLimit: opts.retryLimit,
    retryDelay: opts.retryDelay,
    retryBackoff: opts.retryBackoff,
    retryJitter: opts.retryJitter,
    expireIn: opts.expireIn,
    retentionDays: opts.retentionDays,
    deadLetter: opts.deadLetter,
    rateLimit: opts.rateLimit === undefined ? undefined : toJsonInput(opts.rateLimit, 'rateLimit'),
    debounce: opts.debounce,
    fairness: opts.fairness === undefined ? undefined : toJsonInput(opts.fairness, 'fairness'),
  }
}

export class QueueOps {
  constructor(private readonly prisma: PrismaClient) {}

  async createQueue(name: string, options: CreateQueueOptions = {}): Promise<Queue> {
    const opts = decodeQueueOptions(options)
    if (opts.deadLetter) await this.validateDeadLetter(opts.deadLetter, name)
    const write = queueWriteData(opts)
    const queue = await this.prisma.queue.upsert({
      where: { name },
      create: {
        name,
        policy: (opts.policy ?? JOB_DEFAULTS.policy) as Policy,
        retryLimit: opts.retryLimit ?? JOB_DEFAULTS.retryLimit,
        retryDelay: opts.retryDelay ?? JOB_DEFAULTS.retryDelay,
        retryBackoff: opts.retryBackoff ?? JOB_DEFAULTS.retryBackoff,
        retryJitter: opts.retryJitter ?? JOB_DEFAULTS.retryJitter,
        expireIn: opts.expireIn ?? JOB_DEFAULTS.expireIn,
        retentionDays: opts.retentionDays ?? JOB_DEFAULTS.retentionDays,
        deadLetter: opts.deadLetter,
        rateLimit: write.rateLimit,
        debounce: opts.debounce,
        fairness: write.fairness,
      },
      update: write,
    })
    return toDomainQueue(queue)
  }

  /**
   * Patch a queue. Only supplied keys change; passing `deadLetter: undefined`
   * leaves it alone while passing an empty value clears it.
   */
  async updateQueue(name: string, options: Partial<CreateQueueOptions>): Promise<Queue> {
    const clearDeadLetter = 'deadLetter' in options && !options.deadLetter
    const opts = decodeQueueOptions(clearDeadLetter ? { ...options, deadLetter: undefined } : options)
    if (opts.deadLetter) await this.validateDeadLetter(opts.deadLetter, name)
    const data = queueWriteData(opts)
    if (clearDeadLetter) data.deadLetter = null
    const queue = await this.prisma.queue.update({ where: { name }, data })
    return toDomainQueue(queue)
  }

  async pauseQueue(name: string): Promise<void> {
    await this.prisma.queue.update({ where: { name }, data: { paused: true } })
  }

  async resumeQueue(name: string): Promise<void> {
    await this.prisma.queue.update({ where: { name }, data: { paused: false } })
  }

  async deleteQueue(name: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.job.deleteMany({ where: { queue: name } }),
      this.prisma.queue.delete({ where: { name } }),
    ])
  }

  async purgeQueue(name: string): Promise<void> {
    await this.prisma.job.deleteMany({ where: { queue: name, state: { in: [...WAITING_STATES] } } })
  }

  async getQueue(name: string): Promise<Queue | null> {
    const queue = await this.prisma.queue.findUnique({ where: { name } })
    return queue ? toDomainQueue(queue) : null
  }

  async getQueues(): Promise<Queue[]> {
    const queues = await this.prisma.queue.findMany({ orderBy: { name: 'asc' } })
    return queues.map(toDomainQueue)
  }

  /** Outstanding jobs. `before: 'active'` counts only jobs not yet started. */
  async getQueueSize(queue: string, options?: { before?: JobState }): Promise<number> {
    const states = options?.before === 'active' ? WAITING_STATES : PENDING_STATES
    return this.prisma.job.count({ where: { queue, state: { in: [...states] } } })
  }

  /** Pending jobs for many queues in one grouped query, keyed by queue name. */
  async getQueueSizes(queues: readonly string[]): Promise<Map<string, number>> {
    if (queues.length === 0) return new Map()
    const grouped = await this.prisma.job.groupBy({
      by: ['queue'],
      where: { queue: { in: [...queues] }, state: { in: [...PENDING_STATES] } },
      _count: true,
    })
    const sizes = new Map(queues.map(name => [name, 0]))
    for (const row of grouped) sizes.set(row.queue, row._count)
    return sizes
  }

  /**
   * Reject a dead-letter target that does not exist, is the queue itself, or
   * closes a cycle. A cycle would make a failing job circulate forever.
   */
  private async validateDeadLetter(deadLetter: string, queueName: string): Promise<void> {
    if (deadLetter === queueName) {
      throw new Error(`Queue '${queueName}' cannot use itself as its dead letter queue`)
    }
    const target = await this.prisma.queue.findUnique({ where: { name: deadLetter } })
    if (!target) {
      throw new Error(`Dead letter queue '${deadLetter}' does not exist`)
    }
    const visited = new Set<string>([queueName, deadLetter])
    let current = target.deadLetter
    while (current) {
      if (current === queueName || visited.has(current)) {
        throw new Error(`Circular dead letter reference involving queue '${queueName}'`)
      }
      if (visited.size >= DEAD_LETTER_CHAIN_MAX) {
        throw new Error(
          `Dead letter chain from '${queueName}' exceeds ${DEAD_LETTER_CHAIN_MAX} queues`,
        )
      }
      visited.add(current)
      const next: { deadLetter: string | null } | null =
        await this.prisma.queue.findUnique({ where: { name: current } })
      if (!next) return
      current = next.deadLetter
    }
  }
}
