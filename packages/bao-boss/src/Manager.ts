import { PrismaClient } from './generated/prisma/client.js'
import type { Job, Queue, CreateQueueOptions, SendOptions } from './types.js'
import type { JobSearchOptions } from './types.js'
import { validateSchema, type ManagerOptions } from './manager/mappers.js'
import { QueueOps } from './manager/queue-ops.js'
import { JobOps } from './manager/job-ops.js'
import { JobQueries } from './manager/job-queries.js'
import { PubSubOps } from './manager/pubsub.js'

export type { ManagerOptions }

export class Manager {
  private readonly queueOps: QueueOps
  private readonly jobOps: JobOps
  private readonly jobQueries: JobQueries
  private readonly pubsubOps: PubSubOps

  constructor(
    prisma: PrismaClient,
    options: ManagerOptions & { schema?: string } = {}
  ) {
    const { schema, ...opts } = options
    const validatedSchema = validateSchema(schema ?? 'baoboss')
    this.queueOps = new QueueOps(prisma, validatedSchema)
    this.jobOps = new JobOps(prisma, validatedSchema, opts)
    this.jobQueries = new JobQueries(prisma)
    this.pubsubOps = new PubSubOps(prisma)
  }

  // ── Queue operations ──────────────────────────────────────────────

  createQueue(name: string, options: CreateQueueOptions = {}): Promise<Queue> {
    return this.queueOps.createQueue(name, options)
  }

  updateQueue(name: string, options: Partial<CreateQueueOptions>): Promise<Queue> {
    return this.queueOps.updateQueue(name, options)
  }

  pauseQueue(name: string): Promise<void> {
    return this.queueOps.pauseQueue(name)
  }

  resumeQueue(name: string): Promise<void> {
    return this.queueOps.resumeQueue(name)
  }

  deleteQueue(name: string): Promise<void> {
    return this.queueOps.deleteQueue(name)
  }

  purgeQueue(name: string): Promise<void> {
    return this.queueOps.purgeQueue(name)
  }

  getQueue(name: string): Promise<Queue | null> {
    return this.queueOps.getQueue(name)
  }

  getQueues(): Promise<Queue[]> {
    return this.queueOps.getQueues()
  }

  getQueueSize(queue: string, options?: { before?: string }): Promise<number> {
    return this.queueOps.getQueueSize(queue, options)
  }

  // ── Job operations ────────────────────────────────────────────────

  send<T = unknown>(name: string, data?: T, options: SendOptions = {}): Promise<string> {
    return this.jobOps.send(name, data, options)
  }

  insert(jobs: Array<{ name: string; data?: unknown; options?: SendOptions }>): Promise<string[]> {
    return this.jobOps.insert(jobs)
  }

  fetch<T = unknown>(queue: string, options: { batchSize?: number } = {}): Promise<Job<T>[]> {
    return this.jobOps.fetch<T>(queue, options)
  }

  complete(id: string | string[], options: { output?: unknown } = {}): Promise<void> {
    return this.jobOps.complete(id, options)
  }

  fail(id: string | string[], error?: Error | string): Promise<void> {
    return this.jobOps.fail(id, error)
  }

  cancel(id: string | string[]): Promise<void> {
    return this.jobOps.cancel(id)
  }

  resume(id: string | string[]): Promise<void> {
    return this.jobOps.resume(id)
  }

  cancelJobs(queue: string, filter?: { state?: 'created' | 'active' }): Promise<number> {
    return this.jobQueries.cancelJobs(queue, filter)
  }

  resumeJobs(queue: string, filter?: { state?: 'failed' | 'cancelled' }): Promise<number> {
    return this.jobQueries.resumeJobs(queue, filter)
  }

  searchJobs<T = unknown>(filter: JobSearchOptions = {}): Promise<{ jobs: Job<T>[]; total: number }> {
    return this.jobQueries.searchJobs<T>(filter)
  }

  getJobDependencies<T = unknown>(jobId: string): Promise<{ dependsOn: Job<T>[]; dependedBy: Job<T>[] }> {
    return this.jobQueries.getJobDependencies<T>(jobId)
  }

  progress(id: string, value: number): Promise<void> {
    return this.jobQueries.progress(id, value)
  }

  getJobById<T = unknown>(id: string): Promise<Job<T> | null> {
    return this.jobQueries.getJobById<T>(id)
  }

  getJobsById<T = unknown>(ids: string[]): Promise<Job<T>[]> {
    return this.jobQueries.getJobsById<T>(ids)
  }

  getDLQDepth(deadLetterQueueName: string): Promise<number> {
    return this.jobQueries.getDLQDepth(deadLetterQueueName)
  }

  // ── Pub/Sub operations ────────────────────────────────────────────

  publish(event: string, data?: unknown, options?: SendOptions): Promise<void> {
    return this.pubsubOps.publish(event, data, options)
  }

  subscribe(event: string, queue: string): Promise<void> {
    return this.pubsubOps.subscribe(event, queue)
  }

  unsubscribe(event: string, queue: string): Promise<void> {
    return this.pubsubOps.unsubscribe(event, queue)
  }
}
