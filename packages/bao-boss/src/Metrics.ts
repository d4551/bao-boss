import type { PrismaClient } from './generated/prisma/client.js'
import { MS_PER_SECOND } from './defaults.js'

export interface QueueMetrics {
  processed: number
  failed: number
  durationSeconds: number
}

export interface MetricsSnapshot {
  jobsProcessedTotal: number
  jobsFailedTotal: number
  queueDepth: Record<string, number>
  processingDurationSeconds: number
  perQueue: Record<string, QueueMetrics>
}

interface Counters {
  processed: number
  failed: number
  durationMs: number
}

function emptyCounters(): Counters {
  return { processed: 0, failed: 0, durationMs: 0 }
}

/**
 * Per-instance metrics store.
 *
 * Owned by a `BaoBoss` instance rather than the module, so two instances in one
 * process — the common case in tests and in multi-tenant hosts — report their
 * own numbers instead of a shared running total nobody can attribute or reset.
 */
export class MetricsRegistry {
  private readonly totals: Counters = emptyCounters()
  private readonly perQueue = new Map<string, Counters>()

  private counters(queue: string): Counters {
    let entry = this.perQueue.get(queue)
    if (!entry) {
      entry = emptyCounters()
      this.perQueue.set(queue, entry)
    }
    return entry
  }

  recordJobCompleted(queue: string, count = 1): void {
    this.totals.processed += count
    this.counters(queue).processed += count
  }

  recordJobFailed(queue: string, count = 1): void {
    this.totals.failed += count
    this.counters(queue).failed += count
  }

  recordProcessingDuration(ms: number, queue: string): void {
    this.totals.durationMs += ms
    this.counters(queue).durationMs += ms
  }

  /** Drop all recorded values. */
  reset(): void {
    this.totals.processed = 0
    this.totals.failed = 0
    this.totals.durationMs = 0
    this.perQueue.clear()
  }

  snapshot(): MetricsSnapshot {
    const perQueue: Record<string, QueueMetrics> = {}
    for (const [queue, counters] of this.perQueue) {
      perQueue[queue] = {
        processed: counters.processed,
        failed: counters.failed,
        durationSeconds: counters.durationMs / MS_PER_SECOND,
      }
    }
    return {
      jobsProcessedTotal: this.totals.processed,
      jobsFailedTotal: this.totals.failed,
      queueDepth: {},
      processingDurationSeconds: this.totals.durationMs / MS_PER_SECOND,
      perQueue,
    }
  }
}

/** Pending (created or active) job count per queue, in one grouped query. */
export async function getQueueDepths(prisma: PrismaClient): Promise<Record<string, number>> {
  const [queues, grouped] = await Promise.all([
    prisma.queue.findMany({ select: { name: true } }),
    prisma.job.groupBy({
      by: ['queue'],
      where: { state: { in: ['created', 'active'] } },
      _count: true,
    }),
  ])
  const counts = new Map(grouped.map(row => [row.queue, row._count]))
  const depths: Record<string, number> = {}
  for (const queue of queues) {
    depths[queue.name] = counts.get(queue.name) ?? 0
  }
  return depths
}

/**
 * Escape a Prometheus label value.
 *
 * Required by the exposition format: an unescaped `"` or newline in a queue name
 * lets that name close the label set and append forged metric lines to the scrape.
 */
export function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
}

interface MetricSeries {
  name: string
  help: string
  type: 'counter' | 'gauge'
  samples: Iterable<readonly [labels: Record<string, string>, value: number]>
}

function renderSeries(series: MetricSeries): string[] {
  const lines = [`# HELP ${series.name} ${series.help}`, `# TYPE ${series.name} ${series.type}`]
  for (const [labels, value] of series.samples) {
    const rendered = Object.entries(labels)
      .map(([key, label]) => `${key}="${escapeLabelValue(label)}"`)
      .join(',')
    lines.push(rendered.length > 0 ? `${series.name}{${rendered}} ${value}` : `${series.name} ${value}`)
  }
  return lines
}

function* queueSamples(
  perQueue: Record<string, QueueMetrics>,
  pick: (metrics: QueueMetrics) => number,
): Generator<readonly [Record<string, string>, number]> {
  for (const [queue, metrics] of Object.entries(perQueue)) {
    yield [{ queue }, pick(metrics)]
  }
}

/** Render a snapshot as Prometheus text exposition format. */
export function toPrometheusFormat(snapshot: MetricsSnapshot): string {
  const series: MetricSeries[] = [
    {
      name: 'baoboss_jobs_processed_total',
      help: 'Total jobs completed',
      type: 'counter',
      samples: [[{}, snapshot.jobsProcessedTotal]],
    },
    {
      name: 'baoboss_jobs_failed_total',
      help: 'Total jobs failed',
      type: 'counter',
      samples: [[{}, snapshot.jobsFailedTotal]],
    },
    {
      name: 'baoboss_processing_duration_seconds_total',
      help: 'Total processing time in seconds',
      type: 'counter',
      samples: [[{}, snapshot.processingDurationSeconds]],
    },
    {
      name: 'baoboss_queue_depth',
      help: 'Pending jobs per queue',
      type: 'gauge',
      samples: Object.entries(snapshot.queueDepth).map(([queue, depth]) => [{ queue }, depth] as const),
    },
    {
      name: 'baoboss_jobs_processed_per_queue_total',
      help: 'Jobs completed per queue',
      type: 'counter',
      samples: queueSamples(snapshot.perQueue, m => m.processed),
    },
    {
      name: 'baoboss_jobs_failed_per_queue_total',
      help: 'Jobs failed per queue',
      type: 'counter',
      samples: queueSamples(snapshot.perQueue, m => m.failed),
    },
    {
      name: 'baoboss_processing_duration_per_queue_seconds_total',
      help: 'Processing time per queue in seconds',
      type: 'counter',
      samples: queueSamples(snapshot.perQueue, m => m.durationSeconds),
    },
  ]
  return series.flatMap(renderSeries).join('\n')
}
