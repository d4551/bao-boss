import { EventEmitter } from './EventEmitter.js'
import { PrismaClient, Prisma } from './generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import type { BaoBossOptions, CreateQueueOptions, SendOptions, WorkOptions, Job, Queue, Schedule } from './types.js'
import { Manager } from './Manager.js'
import { Worker } from './Worker.js'
import { Scheduler } from './Scheduler.js'
import { Maintenance } from './Maintenance.js'
import { migrate as runMigrate } from './Migrate.js'

export class BaoBoss extends EventEmitter {
  readonly prisma: PrismaClient
  private manager: Manager
  private scheduler: Scheduler
  private maintenance: Maintenance | null = null
  private workers: Map<string, { stop(ms?: number): Promise<void>; readonly queue: string; readonly id: string }> = new Map()
  private started = false
  private stopping = false
  private opts: BaoBossOptions & {
    connectionString: string
    maintenanceIntervalSeconds: number
    archiveCompletedAfterSeconds: number
    deleteArchivedAfterDays: number
    dlqRetentionDays: number
    noSupervisor: boolean
    shutdownGracePeriodSeconds: number
  }

  constructor(options: BaoBossOptions = {}) {
    super()
    this.opts = {
      connectionString: options.connectionString ?? Bun.env['DATABASE_URL'] ?? '',
      prisma: options.prisma,
      schema: options.schema ?? 'baoboss',
      maintenanceIntervalSeconds: options.maintenanceIntervalSeconds ?? 120,
      archiveCompletedAfterSeconds: options.archiveCompletedAfterSeconds ?? 12 * 60 * 60,
      deleteArchivedAfterDays: options.deleteArchivedAfterDays ?? 7,
      dlqRetentionDays: options.dlqRetentionDays ?? 14,
      noSupervisor: options.noSupervisor ?? false,
      shutdownGracePeriodSeconds: options.shutdownGracePeriodSeconds ?? 30,
      connectionPool: options.connectionPool,
      onBeforeFetch: options.onBeforeFetch,
      onAfterComplete: options.onAfterComplete,
      onRetry: options.onRetry,
    }

    if (options.prisma) {
      this.prisma = options.prisma
    } else {
      const poolConfig: { connectionString: string; max?: number; min?: number; idleTimeoutMillis?: number; connectionTimeoutMillis?: number; statement_timeout?: number } = {
        connectionString: this.opts.connectionString,
      }
      if (this.opts.connectionPool) {
        if (this.opts.connectionPool.max != null) poolConfig.max = this.opts.connectionPool.max
        if (this.opts.connectionPool.min != null) poolConfig.min = this.opts.connectionPool.min
        if (this.opts.connectionPool.idleTimeoutMillis != null) poolConfig.idleTimeoutMillis = this.opts.connectionPool.idleTimeoutMillis
        if (this.opts.connectionPool.statementTimeout != null) poolConfig.statement_timeout = this.opts.connectionPool.statementTimeout
      }
      const adapter = new PrismaPg(poolConfig)
      this.prisma = new PrismaClient({ adapter })
    }

    this.manager = new Manager(this.prisma, {
      schema: this.opts.schema,
      dlqRetentionDays: this.opts.dlqRetentionDays,
      maxPayloadBytes: options.maxPayloadBytes,
      onRetry: this.opts.onRetry
        ? (job, err) => this.opts.onRetry!(job, err)
        : undefined,
      onDlq: (payload) => this.emit('dlq', payload),
    })
    this.scheduler = new Scheduler(this.prisma)
  }

  async start(): Promise<void> {
    if (this.started) return
    await this.prisma.$connect()
    const schema = this.opts.schema ?? 'baoboss'
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
      await this.prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    }
    this.started = true

    if (!this.opts.noSupervisor) {
      this.maintenance = new Maintenance(this.prisma, this, {
        schema: this.opts.schema,
        intervalSeconds: this.opts.maintenanceIntervalSeconds,
        archiveCompletedAfterSeconds: this.opts.archiveCompletedAfterSeconds,
        deleteArchivedAfterDays: this.opts.deleteArchivedAfterDays,
        dlqRetentionDays: this.opts.dlqRetentionDays,
      })
      this.maintenance.start()
    }
  }

  async stop(): Promise<void> {
    if (!this.started || this.stopping) return
    this.stopping = true

    if (this.maintenance) {
      this.maintenance.stop()
    }

    const gracePeriodMs = this.opts.shutdownGracePeriodSeconds * 1000
    const stopPromises = Array.from(this.workers.values()).map(w => w.stop(gracePeriodMs))
    await Promise.all(stopPromises)

    await this.prisma.$disconnect()
    this.started = false
    this.stopping = false
    this.emit('stopped')
  }

  // Queue management
  async createQueue(name: string, options: CreateQueueOptions = {}): Promise<Queue> {
    return this.manager.createQueue(name, options)
  }

  async updateQueue(name: string, options: Partial<CreateQueueOptions>): Promise<Queue> {
    return this.manager.updateQueue(name, options)
  }

  async pauseQueue(name: string): Promise<void> {
    await this.manager.pauseQueue(name)
    this.emit('queue:paused', { queue: name })
  }

  async resumeQueue(name: string): Promise<void> {
    await this.manager.resumeQueue(name)
    this.emit('queue:resumed', { queue: name })
  }

  async deleteQueue(name: string): Promise<void> {
    return this.manager.deleteQueue(name)
  }

  async purgeQueue(name: string): Promise<void> {
    return this.manager.purgeQueue(name)
  }

  async getQueue(name: string): Promise<Queue | null> {
    return this.manager.getQueue(name)
  }

  async getQueues(): Promise<Queue[]> {
    return this.manager.getQueues()
  }

  // Job operations
  async send<T = unknown>(name: string, data?: T, options: SendOptions = {}): Promise<string> {
    return this.manager.send(name, data, options)
  }

  async insert(jobs: Array<{ name: string; data?: unknown; options?: SendOptions }>): Promise<string[]> {
    return this.manager.insert(jobs)
  }

  async fetch<T = unknown>(queue: string, options: { batchSize?: number } = {}): Promise<Job<T>[]> {
    return this.manager.fetch<T>(queue, options)
  }

  async complete(id: string | string[], options: { output?: unknown } = {}): Promise<void> {
    return this.manager.complete(id, options)
  }

  async fail(id: string | string[], error?: Error | string): Promise<void> {
    return this.manager.fail(id, error)
  }

  async cancel(id: string | string[]): Promise<void> {
    return this.manager.cancel(id)
  }

  async resume(id: string | string[]): Promise<void> {
    return this.manager.resume(id)
  }

  async cancelJobs(queue: string, filter?: { state?: 'created' | 'active' }): Promise<number> {
    return this.manager.cancelJobs(queue, filter)
  }

  async resumeJobs(queue: string, filter?: { state?: 'failed' | 'cancelled' }): Promise<number> {
    return this.manager.resumeJobs(queue, filter)
  }

  async searchJobs<T = unknown>(filter?: import('./types.js').JobSearchOptions): Promise<{ jobs: Job<T>[]; total: number }> {
    return this.manager.searchJobs<T>(filter)
  }

  async getJobDependencies<T = unknown>(jobId: string): Promise<{ dependsOn: Job<T>[]; dependedBy: Job<T>[] }> {
    return this.manager.getJobDependencies<T>(jobId)
  }

  async getJobById<T = unknown>(id: string): Promise<Job<T> | null> {
    return this.manager.getJobById<T>(id)
  }

  async getJobsById<T = unknown>(ids: string[]): Promise<Job<T>[]> {
    return this.manager.getJobsById<T>(ids)
  }

  async getQueueSize(queue: string, options?: { before?: string }): Promise<number> {
    return this.manager.getQueueSize(queue, options)
  }

  async getDLQDepth(deadLetterQueueName: string): Promise<number> {
    return this.manager.getDLQDepth(deadLetterQueueName)
  }

  /** Run Prisma migrations. Call before start() when deploying. */
  async migrate(): Promise<void> {
    return runMigrate(this.prisma, this.opts.schema)
  }

  async progress(id: string, value: number): Promise<void> {
    const job = await this.manager.getJobById(id)
    await this.manager.progress(id, value)
    if (job) {
      this.emit('progress', { id, queue: job.queue, progress: Math.min(100, Math.max(0, Math.round(value))) })
    }
  }

  /** Called by Worker before fetch - lifecycle hook */
  async runBeforeFetch(queue: string): Promise<void> {
    await this.opts.onBeforeFetch?.(queue)
  }

  /** Called by Worker after complete - lifecycle hook */
  async runAfterComplete(jobs: Job[]): Promise<void> {
    await this.opts.onAfterComplete?.(jobs)
  }

  /** Called by Worker before retry - lifecycle hook */
  async runOnRetry(job: Job, error: Error): Promise<void> {
    await this.opts.onRetry?.(job, error)
  }

  // Worker
  async work<T = unknown>(
    queue: string,
    optionsOrHandler: WorkOptions | ((jobs: Job<T>[]) => Promise<void>),
    handler?: (jobs: Job<T>[]) => Promise<void>
  ): Promise<string> {
    let opts: WorkOptions = {}
    let fn: (jobs: Job<T>[]) => Promise<void>

    if (typeof optionsOrHandler === 'function') {
      fn = optionsOrHandler
    } else {
      opts = optionsOrHandler
      fn = handler!
    }

    const worker = new Worker<T>(queue, fn, opts, this)
    const workerId = worker.id
    this.workers.set(workerId, worker)
    await worker.start()
    return workerId
  }

  async offWork(queueOrId: string): Promise<void> {
    const byId = this.workers.get(queueOrId)
    if (byId) {
      await byId.stop()
      this.workers.delete(queueOrId)
      return
    }
    const toStop: string[] = []
    for (const [id, worker] of this.workers) {
      if (worker.queue === queueOrId) {
        toStop.push(id)
      }
    }
    await Promise.all(toStop.map(async id => {
      await this.workers.get(id)!.stop()
      this.workers.delete(id)
    }))
  }

  // Scheduling
  async schedule(name: string, cron: string, data?: Prisma.InputJsonValue, options?: { tz?: string }): Promise<void> {
    return this.scheduler.schedule(name, cron, data, options)
  }

  async unschedule(name: string): Promise<void> {
    return this.scheduler.unschedule(name)
  }

  async getSchedules(): Promise<Schedule[]> {
    return this.scheduler.getSchedules()
  }

  // Pub/Sub
  async publish(event: string, data?: unknown, options?: SendOptions): Promise<void> {
    return this.manager.publish(event, data, options)
  }

  async subscribe(event: string, queue: string): Promise<void> {
    return this.manager.subscribe(event, queue)
  }

  async unsubscribe(event: string, queue: string): Promise<void> {
    return this.manager.unsubscribe(event, queue)
  }
}
