import type { Job, WorkOptions } from './types.js'
import { MS_PER_SECOND, WORKER_DEFAULTS } from './defaults.js'
import type { MetricsRegistry } from './Metrics.js'

/** Subset of BaoBoss a Worker needs. Kept explicit so an unused hook cannot rot unnoticed. */
interface BossClient {
  fetch<U>(queue: string, options: { batchSize: number }): Promise<Job<U>[]>
  complete(ids: string[]): Promise<void>
  fail(id: string, error: Error): Promise<void>
  emit(event: string, ...args: unknown[]): boolean
  runBeforeFetch(queue: string): Promise<void>
  runAfterComplete(jobs: Job<unknown>[]): Promise<void>
  readonly metrics: MetricsRegistry
}

/** A handler may accept the abort signal so it can stop work when the timeout fires. */
export type JobHandler<T> = (jobs: Job<T>[], context: { signal: AbortSignal }) => Promise<void>

interface ResolvedOptions {
  batchSize: number
  pollingIntervalMs: number
  maxConcurrency: number
  handlerTimeoutMs: number | null
}

function resolveOptions(opts: WorkOptions): ResolvedOptions {
  const timeout = opts.handlerTimeoutSeconds
  return {
    batchSize: Math.max(1, opts.batchSize ?? WORKER_DEFAULTS.batchSize),
    // Clamp in milliseconds: clamping the seconds value first turned a
    // sub-second polling interval into a full second.
    pollingIntervalMs: Math.max(
      1,
      Math.round((opts.pollingIntervalSeconds ?? WORKER_DEFAULTS.pollingIntervalSeconds) * MS_PER_SECOND),
    ),
    maxConcurrency: Math.max(1, opts.maxConcurrency ?? WORKER_DEFAULTS.maxConcurrency),
    handlerTimeoutMs: timeout != null && timeout > 0 ? timeout * MS_PER_SECOND : null,
  }
}

class TimeoutError extends Error {
  constructor(seconds: number, queue: string) {
    super(`Handler timed out after ${seconds}s on queue "${queue}"`)
    this.name = 'TimeoutError'
  }
}

/**
 * Polling worker.
 *
 * Scheduling is a self-rescheduling loop rather than `setInterval`: an interval
 * whose callback outlives its period stacks invocations until the connection
 * pool is exhausted. Concurrency is counted per in-flight batch and bounded by
 * `maxConcurrency`, which defaults to 1.
 */
export class Worker<T = unknown> {
  readonly id: string
  readonly queue: string
  private readonly handler: JobHandler<T>
  private readonly opts: ResolvedOptions
  private readonly boss: BossClient
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private inFlight = 0
  private readonly idle: Set<() => void> = new Set()

  constructor(queue: string, handler: JobHandler<T>, opts: WorkOptions, boss: BossClient) {
    this.id = crypto.randomUUID()
    this.queue = queue
    this.handler = handler
    this.boss = boss
    this.opts = resolveOptions(opts)
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.scheduleNext(0)
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick()
    }, delayMs)
  }

  private async tick(): Promise<void> {
    if (!this.running) return
    // Fill every free concurrency slot before waiting for the next interval.
    const slots = this.opts.maxConcurrency - this.inFlight
    for (let i = 0; i < slots; i++) {
      this.inFlight++
      void this.claimAndRun().finally(() => {
        this.inFlight--
        if (this.inFlight === 0) {
          for (const resolve of this.idle) resolve()
        }
      })
    }
    this.scheduleNext(this.opts.pollingIntervalMs)
  }

  private async claimAndRun(): Promise<void> {
    let jobs: Job<T>[] = []
    try {
      await this.boss.runBeforeFetch(this.queue)
      jobs = await this.boss.fetch<T>(this.queue, { batchSize: this.opts.batchSize })
    } catch (err) {
      this.boss.emit('error', err)
      return
    }
    if (jobs.length === 0) return

    const started = performance.now()
    try {
      await this.runHandler(jobs)
    } catch (err) {
      await this.failBatch(jobs, err)
      return
    }
    try {
      await this.boss.complete(jobs.map(job => job.id))
      this.boss.metrics.recordProcessingDuration(performance.now() - started, this.queue)
      this.boss.metrics.recordJobCompleted(this.queue, jobs.length)
      await this.boss.runAfterComplete(jobs)
    } catch (err) {
      // The handler succeeded but the completion write did not — surface it
      // rather than counting the batch as processed.
      this.boss.emit('error', err)
    }
  }

  /**
   * Run the handler under an abort signal.
   *
   * The signal is passed to the handler so a timeout can actually stop the work.
   * Racing a rejection without it would fail the jobs while the handler kept
   * running, which double-processes every timed-out batch.
   */
  private async runHandler(jobs: Job<T>[]): Promise<void> {
    const timeoutMs = this.opts.handlerTimeoutMs
    if (timeoutMs === null) {
      await this.handler(jobs, { signal: new AbortController().signal })
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      await Promise.race([
        this.handler(jobs, { signal: controller.signal }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new TimeoutError(timeoutMs / MS_PER_SECOND, this.queue)),
            { once: true },
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }

  private async failBatch(jobs: Job<T>[], err: unknown): Promise<void> {
    const error = err instanceof Error ? err : new Error(String(err))
    this.boss.metrics.recordJobFailed(this.queue, jobs.length)
    for (const job of jobs) {
      try {
        await this.boss.fail(job.id, error)
      } catch (failErr) {
        this.boss.emit('error', failErr)
      }
    }
    this.boss.emit('error', error)
  }

  /** Stop polling and wait for in-flight batches, up to the grace period. */
  async stop(gracePeriodMs = 30_000): Promise<void> {
    if (!this.running) return
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.inFlight === 0) return

    let onIdle: (() => void) | null = null
    const drained = new Promise<void>(resolve => {
      onIdle = resolve
      this.idle.add(resolve)
    })
    try {
      let graceTimer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        drained,
        new Promise<void>(resolve => { graceTimer = setTimeout(resolve, gracePeriodMs) }),
      ]).finally(() => clearTimeout(graceTimer))
    } finally {
      if (onIdle) this.idle.delete(onIdle)
    }
  }
}
