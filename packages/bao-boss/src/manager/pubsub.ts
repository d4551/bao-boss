import { PrismaClient, Prisma } from '../generated/prisma/client.js'
import { Value } from '@sinclair/typebox/value'
import type { SendOptions } from '../types.js'
import { sendOptionsSchema, resolveStartAfter } from './mappers.js'

export class PubSubOps {
  constructor(
    private readonly prisma: PrismaClient,
  ) {}

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
