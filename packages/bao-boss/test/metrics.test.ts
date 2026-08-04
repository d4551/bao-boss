import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { MetricsRegistry, toPrometheusFormat, getQueueDepths, escapeLabelValue } from '../src/Metrics'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, createTestBoss, cleanupQueue } from './helpers'

describe('MetricsRegistry', () => {
  it('starts empty, so one instance never reads another instance\'s totals', () => {
    const a = new MetricsRegistry()
    const b = new MetricsRegistry()
    a.recordJobCompleted('email')
    expect(a.snapshot().jobsProcessedTotal).toBe(1)
    expect(b.snapshot().jobsProcessedTotal).toBe(0)
  })

  it('counts completions and failures', () => {
    const metrics = new MetricsRegistry()
    metrics.recordJobCompleted('email', 3)
    metrics.recordJobFailed('email')
    const snapshot = metrics.snapshot()
    expect(snapshot.jobsProcessedTotal).toBe(3)
    expect(snapshot.jobsFailedTotal).toBe(1)
    expect(snapshot.perQueue['email']).toEqual({ processed: 3, failed: 1, durationSeconds: 0 })
  })

  it('accumulates processing duration in seconds', () => {
    const metrics = new MetricsRegistry()
    metrics.recordProcessingDuration(1000, 'email')
    metrics.recordProcessingDuration(2000, 'email')
    expect(metrics.snapshot().processingDurationSeconds).toBeCloseTo(3, 5)
  })

  it('tracks queues independently', () => {
    const metrics = new MetricsRegistry()
    metrics.recordJobCompleted('email', 2)
    metrics.recordJobCompleted('sms')
    const snapshot = metrics.snapshot()
    expect(snapshot.perQueue['email']?.processed).toBe(2)
    expect(snapshot.perQueue['sms']?.processed).toBe(1)
  })

  it('resets to zero', () => {
    const metrics = new MetricsRegistry()
    metrics.recordJobCompleted('email')
    metrics.reset()
    expect(metrics.snapshot().jobsProcessedTotal).toBe(0)
    expect(metrics.snapshot().perQueue).toEqual({})
  })
})

describe('toPrometheusFormat', () => {
  it('emits HELP, TYPE and samples', () => {
    const metrics = new MetricsRegistry()
    const snapshot = metrics.snapshot()
    snapshot.queueDepth = { orders: 5, emails: 12 }
    const output = toPrometheusFormat(snapshot)

    expect(output).toContain('# HELP baoboss_jobs_processed_total')
    expect(output).toContain('# TYPE baoboss_queue_depth gauge')
    expect(output).toContain('baoboss_queue_depth{queue="orders"} 5')
    expect(output).toContain('baoboss_queue_depth{queue="emails"} 12')
  })

  it('names counters with the _total suffix the convention requires', () => {
    const output = toPrometheusFormat(new MetricsRegistry().snapshot())
    expect(output).toContain('baoboss_processing_duration_seconds_total')
  })

  it('escapes label values so a queue name cannot forge metric lines', () => {
    // Regression: an unescaped quote and newline in a queue name closed the
    // label set and appended attacker-chosen series to the scrape output.
    const metrics = new MetricsRegistry()
    const snapshot = metrics.snapshot()
    snapshot.queueDepth = { ['evil"} 999\nbaoboss_injected{a="b']: 1 }
    const output = toPrometheusFormat(snapshot)

    expect(output).not.toContain('baoboss_injected{a="b"}')
    expect(output).toContain('baoboss_queue_depth{queue="evil\\"} 999\\nbaoboss_injected{a=\\"b"} 1')
    expect(output.split('\n').filter(line => line.startsWith('baoboss_queue_depth'))).toHaveLength(1)
  })

  it('escapes backslashes, quotes and newlines', () => {
    expect(escapeLabelValue('a\\b')).toBe('a\\\\b')
    expect(escapeLabelValue('a"b')).toBe('a\\"b')
    expect(escapeLabelValue('a\nb')).toBe('a\\nb')
  })
})

describe('getQueueDepths', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('counts pending jobs per queue', async () => {
    const queueName = uniqueName('metrics-depth')
    await boss.createQueue(queueName)
    await boss.send(queueName, { n: 1 })
    await boss.send(queueName, { n: 2 })

    const depths = await getQueueDepths(boss.prisma)
    expect(depths[queueName]).toBe(2)

    await cleanupQueue(boss, queueName)
  })

  it('reports zero for a queue with no pending work', async () => {
    const queueName = uniqueName('metrics-empty')
    await boss.createQueue(queueName)

    const depths = await getQueueDepths(boss.prisma)
    expect(depths[queueName]).toBe(0)

    await cleanupQueue(boss, queueName)
  })
})
