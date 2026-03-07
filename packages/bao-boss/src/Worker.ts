import { randomUUID } from 'crypto'
import type { Job, WorkOptions } from './types.js'
import type { BaoBoss } from './BaoBoss.js'

/** Subset of BaoBoss methods needed by a Worker. */
interface BossClient {
  fetch<U>(queue: string, options: { batchSize: number }): Promise<Job<U>[]>
  complete(ids: string[]): Promise<void>
  fail(id: string, error: Error): Promise<void>
  emit(event: string, ...args: unknown[]): boolean
}

export class Worker<T = unknown> {
  readonly id: string
  readonly queue: string
  private handler: (jobs: Job<T>[]) => Promise<void>
  private opts: Required<WorkOptions>
  private boss: BossClient
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private inFlight = 0
  private draining = false
  private drainResolve: (() => void) | null = null

  constructor(
    queue: string,
    handler: (jobs: Job<T>[]) => Promise<void>,
    opts: WorkOptions,
    boss: BossClient
  ) {
    this.id = randomUUID()
    this.queue = queue
    this.handler = handler
    this.boss = boss
    this.opts = {
      batchSize: opts.batchSize ?? 1,
      pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 2,
      includeMetadata: opts.includeMetadata ?? false,
      priority: opts.priority ?? true,
    }
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.poll()
  }

  private poll(): void {
    this.timer = setInterval(async () => {
      if (this.draining) return
      try {
        const jobs = await this.boss.fetch<T>(this.queue, { batchSize: this.opts.batchSize })
        if (jobs.length === 0) return

        this.inFlight++
        try {
          await this.handler(jobs)
          await this.boss.complete(jobs.map((j: Job<T>) => j.id))
        } catch (err) {
          for (const job of jobs) {
            await this.boss.fail(job.id, err instanceof Error ? err : new Error(String(err)))
          }
          this.boss.emit('error', err)
        } finally {
          this.inFlight--
          if (this.draining && this.inFlight === 0 && this.drainResolve) {
            this.drainResolve()
          }
        }
      } catch (err) {
        this.boss.emit('error', err)
      }
    }, this.opts.pollingIntervalSeconds * 1000)
  }

  async stop(gracePeriodMs = 30_000): Promise<void> {
    if (!this.running) return
    this.running = false
    this.draining = true

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    if (this.inFlight > 0) {
      await Promise.race([
        new Promise<void>(resolve => { this.drainResolve = resolve }),
        new Promise<void>(resolve => setTimeout(resolve, gracePeriodMs)),
      ])
    }
    this.draining = false
  }
}
