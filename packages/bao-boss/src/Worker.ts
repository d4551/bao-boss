import type { Job, WorkOptions } from './types.js'
import type { BaoBoss } from './BaoBoss.js'
import { recordJobCompleted, recordJobFailed, recordProcessingDuration } from './Metrics.js'

/** Subset of BaoBoss methods needed by a Worker. */
interface BossClient {
  fetch<U>(queue: string, options: { batchSize: number }): Promise<Job<U>[]>
  complete(ids: string[]): Promise<void>
  fail(id: string, error: Error): Promise<void>
  emit(event: string, ...args: unknown[]): boolean
  runBeforeFetch(queue: string): Promise<void>
  runAfterComplete(jobs: Job<unknown>[]): Promise<void>
}

/** Internal worker options with handlerTimeoutSeconds explicitly optional. */
type WorkerOpts = Omit<Required<WorkOptions>, 'handlerTimeoutSeconds'> & {
  handlerTimeoutSeconds: number | undefined
}

export class Worker<T = unknown> {
  readonly id: string
  readonly queue: string
  private handler: (jobs: Job<T>[]) => Promise<void>
  private opts: WorkerOpts
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
    this.id = crypto.randomUUID()
    this.queue = queue
    this.handler = handler
    this.boss = boss
    this.opts = {
      batchSize: opts.batchSize ?? 1,
      pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 2,
      maxConcurrency: opts.maxConcurrency ?? Infinity,
      handlerTimeoutSeconds: opts.handlerTimeoutSeconds ?? undefined,
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
        if (this.inFlight >= this.opts.maxConcurrency) return
        this.inFlight++
        try {
          await this.boss.runBeforeFetch(this.queue)
          const jobs = await this.boss.fetch<T>(this.queue, { batchSize: this.opts.batchSize })
          if (jobs.length === 0) return
          const runHandler = async () => {
            if (this.opts.handlerTimeoutSeconds && this.opts.handlerTimeoutSeconds > 0) {
              const ac = new AbortController()
              const timer = setTimeout(() => ac.abort(), this.opts.handlerTimeoutSeconds * 1000)
              try {
                await Promise.race([
                  this.handler(jobs),
                  new Promise<never>((_, reject) => {
                    ac.signal.addEventListener('abort', () => reject(new Error(`Handler timed out after ${this.opts.handlerTimeoutSeconds}s on queue "${this.queue}"`)))
                  }),
                ])
              } finally {
                clearTimeout(timer)
              }
            } else {
              await this.handler(jobs)
            }
          }
          try {
            const start = Date.now()
            await runHandler()
            recordProcessingDuration(Date.now() - start, this.queue)
            for (let i = 0; i < jobs.length; i++) recordJobCompleted(this.queue)
            await this.boss.complete(jobs.map((j: Job<T>) => j.id))
            await this.boss.runAfterComplete(jobs)
          } catch (err) {
            for (let i = 0; i < jobs.length; i++) recordJobFailed(this.queue)
            const error = err instanceof Error ? err : new Error(String(err))
            for (const job of jobs) {
              await this.boss.fail(job.id, error)
            }
            this.boss.emit('error', err)
          }
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
