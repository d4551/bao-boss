import { EventEmitter } from './EventEmitter.js'
import { PrismaClient, Prisma } from './generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import type {
  BaoBossOptions, CreateQueueOptions, SendOptions, WorkOptions,
  Job, JobSearchOptions, JobState, Queue, Schedule,
} from './types.js'
import { BOSS_DEFAULTS, DLQ_RETENTION_DAYS, MS_PER_SECOND } from './defaults.js'
import { Manager } from './Manager.js'
import { MetricsRegistry } from './Metrics.js'
import { Worker, type JobHandler } from './Worker.js'
import { Scheduler } from './Scheduler.js'
import { Maintenance } from './Maintenance.js'
import { migrate as runMigrate } from './Migrate.js'
import { validateSchema } from './schema.js'

/** What BaoBoss needs from a worker, independent of the worker's payload type. */
interface RunningWorker {
  readonly id: string
  readonly queue: string
  stop(gracePeriodMs?: number): Promise<void>
}

interface ResolvedOptions extends BaoBossOptions {
  connectionString: string
  schema: string
  maintenanceIntervalSeconds: number
  archiveCompletedAfterSeconds: number
  deleteArchivedAfterDays: number
  dlqRetentionDays: number
  noSupervisor: boolean
  shutdownGracePeriodSeconds: number
}

function resolveOptions(options: BaoBossOptions): ResolvedOptions {
  return {
    ...options,
    connectionString: options.connectionString ?? Bun.env['DATABASE_URL'] ?? '',
    // Validated at construction: an invalid schema name must fail loudly, not
    // quietly skip the statements that interpolate it.
    schema: validateSchema(options.schema ?? BOSS_DEFAULTS.schema),
    maintenanceIntervalSeconds: options.maintenanceIntervalSeconds ?? BOSS_DEFAULTS.maintenanceIntervalSeconds,
    archiveCompletedAfterSeconds: options.archiveCompletedAfterSeconds ?? BOSS_DEFAULTS.archiveCompletedAfterSeconds,
    deleteArchivedAfterDays: options.deleteArchivedAfterDays ?? BOSS_DEFAULTS.deleteArchivedAfterDays,
    dlqRetentionDays: options.dlqRetentionDays ?? DLQ_RETENTION_DAYS,
    noSupervisor: options.noSupervisor ?? false,
    shutdownGracePeriodSeconds: options.shutdownGracePeriodSeconds ?? BOSS_DEFAULTS.shutdownGracePeriodSeconds,
  }
}

function buildPrisma(opts: ResolvedOptions): PrismaClient {
  if (opts.prisma) return opts.prisma
  const pool = opts.connectionPool
  const adapter = new PrismaPg({
    connectionString: opts.connectionString,
    ...(pool?.max != null ? { max: pool.max } : {}),
    ...(pool?.min != null ? { min: pool.min } : {}),
    ...(pool?.idleTimeoutMillis != null ? { idleTimeoutMillis: pool.idleTimeoutMillis } : {}),
    ...(pool?.statementTimeout != null ? { statement_timeout: pool.statementTimeout } : {}),
  })
  return new PrismaClient({ adapter })
}

export class BaoBoss extends EventEmitter {
  readonly prisma: PrismaClient
  /** Counters for this instance. Never shared with another BaoBoss in the process. */
  readonly metrics = new MetricsRegistry()
  private readonly manager: Manager
  private readonly scheduler: Scheduler
  private maintenance: Maintenance | null = null
  private readonly workers = new Map<string, RunningWorker>()
  private started = false
  private stopping = false
  private readonly opts: ResolvedOptions

  constructor(options: BaoBossOptions = {}) {
    super()
    this.opts = resolveOptions(options)
    this.prisma = buildPrisma(this.opts)
    this.manager = new Manager(this.prisma, {
      schema: this.opts.schema,
      dlqRetentionDays: this.opts.dlqRetentionDays,
      maxPayloadBytes: this.opts.maxPayloadBytes,
      onRetry: this.opts.onRetry,
      onDlq: payload => this.emit('dlq', payload),
    })
    this.scheduler = new Scheduler(this.prisma)
  }

  async start(): Promise<void> {
    if (this.started) return
    await this.prisma.$connect()
    await this.prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${this.opts.schema}"`)
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

  /**
   * Drain workers and the maintenance loop, then close the connection.
   * Maintenance is awaited before disconnecting so an in-flight sweep cannot
   * fire queries against a closed client.
   */
  async stop(): Promise<void> {
    if (!this.started || this.stopping) return
    this.stopping = true

    const gracePeriodMs = this.opts.shutdownGracePeriodSeconds * MS_PER_SECOND
    const workers = [...this.workers.values()]
    this.workers.clear()
    await Promise.all(workers.map(worker => worker.stop(gracePeriodMs)))

    if (this.maintenance) {
      await this.maintenance.stop()
      this.maintenance = null
    }

    await this.prisma.$disconnect()
    this.started = false
    this.stopping = false
    this.emit('stopped')
  }

  // ── Queue management ─────────────────────────────────────────────

  createQueue(name: string, options: CreateQueueOptions = {}): Promise<Queue> {
    return this.manager.createQueue(name, options)
  }

  updateQueue(name: string, options: Partial<CreateQueueOptions>): Promise<Queue> {
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

  deleteQueue(name: string): Promise<void> {
    return this.manager.deleteQueue(name)
  }

  purgeQueue(name: string): Promise<void> {
    return this.manager.purgeQueue(name)
  }

  getQueue(name: string): Promise<Queue | null> {
    return this.manager.getQueue(name)
  }

  getQueues(): Promise<Queue[]> {
    return this.manager.getQueues()
  }

  getQueueSize(queue: string, options?: { before?: JobState }): Promise<number> {
    return this.manager.getQueueSize(queue, options)
  }

  /** Pending counts for many queues in one query. */
  getQueueSizes(queues: readonly string[]): Promise<Map<string, number>> {
    return this.manager.getQueueSizes(queues)
  }

  // ── Job operations ───────────────────────────────────────────────

  send<T = unknown>(name: string, data?: T, options: SendOptions = {}): Promise<string> {
    return this.manager.send(name, data, options)
  }

  insert(jobs: Array<{ name: string; data?: unknown; options?: SendOptions }>): Promise<string[]> {
    return this.manager.insert(jobs)
  }

  fetch<T = unknown>(queue: string, options: { batchSize?: number } = {}): Promise<Job<T>[]> {
    return this.manager.fetch<T>(queue, options)
  }

  complete(id: string | string[], options: { output?: unknown } = {}): Promise<void> {
    return this.manager.complete(id, options)
  }

  fail(id: string | string[], error?: Error | string): Promise<void> {
    return this.manager.fail(id, error)
  }

  cancel(id: string | string[]): Promise<void> {
    return this.manager.cancel(id)
  }

  resume(id: string | string[]): Promise<void> {
    return this.manager.resume(id)
  }

  cancelJobs(queue: string, filter?: { state?: 'created' | 'active' }): Promise<number> {
    return this.manager.cancelJobs(queue, filter)
  }

  resumeJobs(queue: string, filter?: { state?: 'failed' | 'cancelled' }): Promise<number> {
    return this.manager.resumeJobs(queue, filter)
  }

  searchJobs<T = unknown>(filter?: JobSearchOptions): Promise<{ jobs: Job<T>[]; total: number }> {
    return this.manager.searchJobs<T>(filter)
  }

  getJobDependencies<T = unknown>(jobId: string): Promise<{ dependsOn: Job<T>[]; dependedBy: Job<T>[] }> {
    return this.manager.getJobDependencies<T>(jobId)
  }

  getJobById<T = unknown>(id: string): Promise<Job<T> | null> {
    return this.manager.getJobById<T>(id)
  }

  getJobsById<T = unknown>(ids: string[]): Promise<Job<T>[]> {
    return this.manager.getJobsById<T>(ids)
  }

  getDLQDepth(deadLetterQueueName: string): Promise<number> {
    return this.manager.getDLQDepth(deadLetterQueueName)
  }

  /** Run Prisma migrations. Call before `start()` when deploying. */
  migrate(): Promise<void> {
    return runMigrate(this.prisma, this.opts.schema)
  }

  /**
   * Report progress on an active job.
   * The `progress` event fires only when a row actually changed, so subscribers
   * are never told about progress on a job that has already finished.
   */
  async progress(id: string, value: number): Promise<void> {
    const job = await this.manager.getJobById(id)
    const updated = await this.manager.progress(id, value)
    if (updated && job) {
      this.emit('progress', {
        id,
        queue: job.queue,
        progress: Math.min(100, Math.max(0, Math.round(value))),
      })
    }
  }

  /** Called by Worker before fetch — lifecycle hook. */
  async runBeforeFetch(queue: string): Promise<void> {
    await this.opts.onBeforeFetch?.(queue)
  }

  /** Called by Worker after a batch completes — lifecycle hook. */
  async runAfterComplete(jobs: Job[]): Promise<void> {
    await this.opts.onAfterComplete?.(jobs)
  }

  // ── Workers ──────────────────────────────────────────────────────

  async work<T = unknown>(
    queue: string,
    optionsOrHandler: WorkOptions | JobHandler<T>,
    handler?: JobHandler<T>,
  ): Promise<string> {
    const opts = typeof optionsOrHandler === 'function' ? {} : optionsOrHandler
    const fn = typeof optionsOrHandler === 'function' ? optionsOrHandler : handler
    if (typeof fn !== 'function') {
      throw new TypeError(`work('${queue}') requires a handler function`)
    }
    const worker = new Worker<T>(queue, fn, opts, this)
    this.workers.set(worker.id, worker)
    await worker.start()
    return worker.id
  }

  /** Stop a worker by id, or every worker on a queue. */
  async offWork(queueOrId: string): Promise<void> {
    const byId = this.workers.get(queueOrId)
    const targets = byId
      ? [[queueOrId, byId] as const]
      : [...this.workers].filter(([, worker]) => worker.queue === queueOrId)
    for (const [id] of targets) this.workers.delete(id)
    await Promise.all(targets.map(([, worker]) => worker.stop()))
  }

  // ── Scheduling ───────────────────────────────────────────────────

  schedule(name: string, cron: string, data?: Prisma.InputJsonValue, options?: { tz?: string }): Promise<void> {
    return this.scheduler.schedule(name, cron, data, options)
  }

  unschedule(name: string): Promise<void> {
    return this.scheduler.unschedule(name)
  }

  getSchedules(): Promise<Schedule[]> {
    return this.scheduler.getSchedules()
  }

  // ── Pub/Sub ──────────────────────────────────────────────────────

  publish(event: string, data?: unknown, options?: SendOptions): Promise<void> {
    return this.manager.publish(event, data, options)
  }

  subscribe(event: string, queue: string): Promise<void> {
    return this.manager.subscribe(event, queue)
  }

  unsubscribe(event: string, queue: string): Promise<void> {
    return this.manager.unsubscribe(event, queue)
  }
}
