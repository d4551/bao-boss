import { EventEmitter } from 'events'
import { PrismaClient } from './generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import type { BaoBossOptions, CreateQueueOptions, SendOptions, WorkOptions, Job, Queue, Schedule } from './types.js'
import { Manager } from './Manager.js'
import { Worker } from './Worker.js'
import { Scheduler } from './Scheduler.js'
import { Maintenance } from './Maintenance.js'

export class BaoBoss extends EventEmitter {
  readonly prisma: PrismaClient
  private manager: Manager
  private scheduler: Scheduler
  private maintenance: Maintenance | null = null
  private workers: Map<string, Worker> = new Map()
  private started = false
  private stopping = false
  private opts: Required<BaoBossOptions>

  constructor(options: BaoBossOptions = {}) {
    super()
    this.opts = {
      connectionString: options.connectionString ?? process.env['DATABASE_URL'] ?? '',
      prisma: options.prisma ?? null,
      maintenanceIntervalSeconds: options.maintenanceIntervalSeconds ?? 120,
      archiveCompletedAfterSeconds: options.archiveCompletedAfterSeconds ?? 12 * 60 * 60,
      deleteArchivedAfterDays: options.deleteArchivedAfterDays ?? 7,
      noSupervisor: options.noSupervisor ?? false,
      shutdownGracePeriodSeconds: options.shutdownGracePeriodSeconds ?? 30,
    }

    if (options.prisma) {
      this.prisma = options.prisma as PrismaClient
    } else {
      const adapter = new PrismaPg({ connectionString: this.opts.connectionString })
      this.prisma = new PrismaClient({ adapter })
    }

    this.manager = new Manager(this.prisma)
    this.scheduler = new Scheduler(this.prisma)
  }

  async start(): Promise<void> {
    if (this.started) return
    await this.prisma.$connect()
    await this.prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS baoboss`)
    this.started = true

    if (!this.opts.noSupervisor) {
      this.maintenance = new Maintenance(this.prisma, this, {
        intervalSeconds: this.opts.maintenanceIntervalSeconds,
        archiveCompletedAfterSeconds: this.opts.archiveCompletedAfterSeconds,
        deleteArchivedAfterDays: this.opts.deleteArchivedAfterDays,
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

  async getJobById<T = unknown>(id: string): Promise<Job<T> | null> {
    return this.manager.getJobById<T>(id)
  }

  async getJobsById<T = unknown>(ids: string[]): Promise<Job<T>[]> {
    return this.manager.getJobsById<T>(ids)
  }

  async getQueueSize(queue: string, options?: { before?: string }): Promise<number> {
    return this.manager.getQueueSize(queue, options)
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
    this.workers.set(workerId, worker as unknown as Worker)
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
  async schedule(name: string, cron: string, data?: unknown, options?: { tz?: string }): Promise<void> {
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
