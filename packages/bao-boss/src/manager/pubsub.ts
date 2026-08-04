import { PrismaClient } from '../generated/prisma/client.js'
import type { SendOptions } from '../types.js'
import { createJobs, decodeSendOptions, type JobRequest } from './job-create.js'

export class PubSubOps {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Fan an event out to every subscribed queue.
   *
   * Subscriber jobs are built by the same owner `send` uses, so a published job
   * inherits its queue's retry, expiry and retention settings identically.
   */
  async publish(event: string, data?: unknown, options?: SendOptions): Promise<void> {
    const subs = await this.prisma.subscription.findMany({
      where: { event },
      select: { queue: true },
    })
    if (subs.length === 0) return

    const opts = decodeSendOptions(options)
    const names = [...new Set(subs.map(sub => sub.queue))]
    const queueRows = await this.prisma.queue.findMany({ where: { name: { in: names } } })
    const queues = new Map(queueRows.map(row => [row.name, row]))

    const requests: JobRequest[] = subs.map(sub => ({
      queue: sub.queue,
      data,
      opts,
      queueRow: queues.get(sub.queue) ?? null,
    }))
    await createJobs(this.prisma, requests)
  }

  async subscribe(event: string, queue: string): Promise<void> {
    await this.prisma.subscription.upsert({
      where: { event_queue: { event, queue } },
      create: { event, queue },
      update: {},
    })
  }

  async unsubscribe(event: string, queue: string): Promise<void> {
    await this.prisma.subscription.delete({ where: { event_queue: { event, queue } } })
  }
}
