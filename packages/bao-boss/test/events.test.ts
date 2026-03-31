import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, waitFor, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Events', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('error event emitted on worker failure', async () => {
    const queueName = uniqueName('evt-error')
    await boss.createQueue(queueName, { retryLimit: 0 })

    const errors: Error[] = []
    boss.on('error', (err: Error) => {
      errors.push(err)
    })

    const workerId = await boss.work(queueName, { pollingIntervalSeconds: 0.1 }, async () => {
      throw new Error('handler exploded')
    })

    await boss.send(queueName, { boom: true })

    await waitFor(() => errors.length > 0, 5000)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]!.message).toContain('handler exploded')

    await boss.offWork(workerId)
    await cleanupQueue(boss, queueName)
  })

  it('dlq event emitted on DLQ promotion', async () => {
    const queueName = uniqueName('evt-dlq')
    const dlqName = uniqueName('evt-dlq-dest')
    await boss.createQueue(dlqName)
    await boss.createQueue(queueName, { retryLimit: 0, deadLetter: dlqName })

    const dlqEvents: Array<{ jobId: string; queue: string; deadLetter: string }> = []
    boss.on('dlq', (payload: { jobId: string; queue: string; deadLetter: string }) => {
      dlqEvents.push(payload)
    })

    const jobId = await boss.send(queueName, { test: 'dlq' })
    const fetched = await boss.fetch(queueName)
    expect(fetched.length).toBeGreaterThan(0)
    await boss.fail(fetched[0]!.id, 'permanent failure')

    await waitFor(() => dlqEvents.length > 0, 5000)
    expect(dlqEvents.length).toBeGreaterThan(0)
    expect(dlqEvents[0]!.jobId).toBe(jobId)
    expect(dlqEvents[0]!.queue).toBe(queueName)
    expect(dlqEvents[0]!.deadLetter).toBe(dlqName)

    await cleanupQueue(boss, queueName)
    await cleanupQueue(boss, dlqName)
  })

  it('progress event emitted', async () => {
    const queueName = uniqueName('evt-progress')
    await boss.createQueue(queueName)

    const progressEvents: Array<{ id: string; queue: string; progress: number }> = []
    boss.on('progress', (payload: { id: string; queue: string; progress: number }) => {
      progressEvents.push(payload)
    })

    const jobId = await boss.send(queueName, { work: true })
    const fetched = await boss.fetch(queueName)
    expect(fetched.length).toBeGreaterThan(0)

    await boss.progress(jobId, 75)

    await waitFor(() => progressEvents.length > 0, 3000)
    expect(progressEvents.length).toBeGreaterThan(0)
    expect(progressEvents[0]!.id).toBe(jobId)
    expect(progressEvents[0]!.queue).toBe(queueName)
    expect(progressEvents[0]!.progress).toBe(75)

    await cleanupQueue(boss, queueName)
  })

  it('stopped event emitted on shutdown', async () => {
    const separateBoss = createTestBoss()
    await separateBoss.start()

    const stoppedEvents: unknown[] = []
    separateBoss.on('stopped', () => {
      stoppedEvents.push(true)
    })

    await separateBoss.stop()

    expect(stoppedEvents.length).toBe(1)
  })
})
