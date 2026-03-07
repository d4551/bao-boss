import type { PrismaClient } from './generated/prisma/client.js'

export interface MetricsSnapshot {
  jobsProcessedTotal: number
  jobsFailedTotal: number
  queueDepth: Record<string, number>
  processingDurationSeconds: number
}

const counters: { processed: number; failed: number; durationMs: number } = {
  processed: 0,
  failed: 0,
  durationMs: 0,
}

export function recordJobCompleted(): void {
  counters.processed++
}

export function recordJobFailed(): void {
  counters.failed++
}

export function recordProcessingDuration(ms: number): void {
  counters.durationMs += ms
}

export function getMetricsSnapshot(): MetricsSnapshot {
  return {
    jobsProcessedTotal: counters.processed,
    jobsFailedTotal: counters.failed,
    queueDepth: {},
    processingDurationSeconds: counters.durationMs / 1000,
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
  return lines.join('\n')
}
