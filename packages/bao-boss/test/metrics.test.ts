import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import {
  recordJobCompleted,
  recordJobFailed,
  recordProcessingDuration,
  getMetricsSnapshot,
  toPrometheusFormat,
  getQueueDepths,
} from '../src/Metrics'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe('Metrics (unit)', () => {
  // Note: module-level state persists between tests, so we track baselines

  it('recordJobCompleted increments counter', () => {
    const before = getMetricsSnapshot().jobsProcessedTotal
    recordJobCompleted()
    const after = getMetricsSnapshot().jobsProcessedTotal
    expect(after).toBe(before + 1)
  })

  it('recordJobFailed increments counter', () => {
    const before = getMetricsSnapshot().jobsFailedTotal
    recordJobFailed()
    const after = getMetricsSnapshot().jobsFailedTotal
    expect(after).toBe(before + 1)
  })

  it('recordProcessingDuration accumulates', () => {
    const before = getMetricsSnapshot().processingDurationSeconds
    recordProcessingDuration(1000)
    recordProcessingDuration(2000)
    const after = getMetricsSnapshot().processingDurationSeconds
    expect(after).toBeCloseTo(before + 3.0, 2)
  })

  it('per-queue metrics tracked', () => {
    const beforeEmail = getMetricsSnapshot().perQueue['email']?.processed ?? 0
    const beforeSms = getMetricsSnapshot().perQueue['sms']?.processed ?? 0

    recordJobCompleted('email')
    recordJobCompleted('email')
    recordJobCompleted('sms')

    const snapshot = getMetricsSnapshot()
    expect(snapshot.perQueue['email']!.processed).toBe(beforeEmail + 2)
    expect(snapshot.perQueue['sms']!.processed).toBe(beforeSms + 1)
  })

  it('toPrometheusFormat generates valid output', () => {
    const snapshot = getMetricsSnapshot()
    snapshot.queueDepth = { orders: 5, emails: 12 }
    const output = toPrometheusFormat(snapshot)

    expect(output).toContain('baoboss_jobs_processed_total')
    expect(output).toContain('baoboss_jobs_failed_total')
    expect(output).toContain('baoboss_processing_duration_seconds')
    expect(output).toContain('baoboss_queue_depth{queue="orders"} 5')
    expect(output).toContain('baoboss_queue_depth{queue="emails"} 12')
    expect(output).toContain('# HELP')
    expect(output).toContain('# TYPE')
  })
})

describe.skipIf(skip)('Metrics (integration)', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('getQueueDepths returns correct counts', async () => {
    const queueName = uniqueName('metrics-depth')
    await boss.createQueue(queueName)

    await boss.send(queueName, { n: 1 })
    await boss.send(queueName, { n: 2 })

    const depths = await getQueueDepths(boss.prisma)
    expect(depths[queueName]).toBe(2)

    await cleanupQueue(boss, queueName)
  })
})
