import type { PrismaClient } from './generated/prisma/client.js'

export interface MetricsSnapshot {
  jobsProcessedTotal: number
  jobsFailedTotal: number
  queueDepth: Record<string, number>
  processingDurationSeconds: number
  perQueue: Record<string, { processed: number; failed: number; durationSeconds: number }>
}

const counters: { processed: number; failed: number; durationMs: number } = {
  processed: 0,
  failed: 0,
  durationMs: 0,
}

const perQueue: Map<string, { processed: number; failed: number; durationMs: number }> = new Map()

function getQueueCounters(queue: string): { processed: number; failed: number; durationMs: number } {
  let c = perQueue.get(queue)
  if (!c) {
    c = { processed: 0, failed: 0, durationMs: 0 }
    perQueue.set(queue, c)
  }
  return c
}

export function recordJobCompleted(queue?: string): void {
  counters.processed++
  if (queue) {
    getQueueCounters(queue).processed++
  }
}

export function recordJobFailed(queue?: string): void {
  counters.failed++
  if (queue) {
    getQueueCounters(queue).failed++
  }
}

export function recordProcessingDuration(ms: number, queue?: string): void {
  counters.durationMs += ms
  if (queue) {
    getQueueCounters(queue).durationMs += ms
  }
}

export function getMetricsSnapshot(): MetricsSnapshot {
  const perQueueSnapshot: Record<string, { processed: number; failed: number; durationSeconds: number }> = {}
  for (const [queue, c] of perQueue) {
    perQueueSnapshot[queue] = {
      processed: c.processed,
      failed: c.failed,
      durationSeconds: c.durationMs / 1000,
    }
  }
  return {
    jobsProcessedTotal: counters.processed,
    jobsFailedTotal: counters.failed,
    queueDepth: {},
    processingDurationSeconds: counters.durationMs / 1000,
    perQueue: perQueueSnapshot,
  }
}

export async function getQueueDepths(prisma: PrismaClient): Promise<Record<string, number>> {
  const queues = await prisma.queue.findMany({ select: { name: true } })
  const depths: Record<string, number> = {}
  for (const q of queues) {
    const count = await prisma.job.count({
      where: { queue: q.name, state: { in: ['created', 'active'] } },
    })
    depths[q.name] = count
  }
  return depths
}

/**
 * Prometheus text format export
 */
export function toPrometheusFormat(snapshot: MetricsSnapshot): string {
  const lines: string[] = [
    '# HELP baoboss_jobs_processed_total Total jobs completed',
    '# TYPE baoboss_jobs_processed_total counter',
    `baoboss_jobs_processed_total ${snapshot.jobsProcessedTotal}`,
    '# HELP baoboss_jobs_failed_total Total jobs failed',
    '# TYPE baoboss_jobs_failed_total counter',
    `baoboss_jobs_failed_total ${snapshot.jobsFailedTotal}`,
    '# HELP baoboss_processing_duration_seconds Total processing time in seconds',
    '# TYPE baoboss_processing_duration_seconds counter',
    `baoboss_processing_duration_seconds ${snapshot.processingDurationSeconds}`,
  ]
  lines.push('# HELP baoboss_queue_depth Pending jobs per queue')
  lines.push('# TYPE baoboss_queue_depth gauge')
  for (const [queue, depth] of Object.entries(snapshot.queueDepth)) {
    lines.push(`baoboss_queue_depth{queue="${queue}"} ${depth}`)
  }
  lines.push('# HELP baoboss_jobs_processed_per_queue Jobs completed per queue')
  lines.push('# TYPE baoboss_jobs_processed_per_queue counter')
  for (const [queue, stats] of Object.entries(snapshot.perQueue)) {
    lines.push(`baoboss_jobs_processed_per_queue{queue="${queue}"} ${stats.processed}`)
  }
  lines.push('# HELP baoboss_jobs_failed_per_queue Jobs failed per queue')
  lines.push('# TYPE baoboss_jobs_failed_per_queue counter')
  for (const [queue, stats] of Object.entries(snapshot.perQueue)) {
    lines.push(`baoboss_jobs_failed_per_queue{queue="${queue}"} ${stats.failed}`)
  }
  lines.push('# HELP baoboss_processing_duration_per_queue_seconds Processing time per queue in seconds')
  lines.push('# TYPE baoboss_processing_duration_per_queue_seconds counter')
  for (const [queue, stats] of Object.entries(snapshot.perQueue)) {
    lines.push(`baoboss_processing_duration_per_queue_seconds{queue="${queue}"} ${stats.durationSeconds}`)
  }
  return lines.join('\n')
}
