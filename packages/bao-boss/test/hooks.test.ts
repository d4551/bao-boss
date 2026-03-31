import { describe, it, expect, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, waitFor, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Lifecycle hooks', () => {
  const instances: BaoBoss[] = []

  afterAll(async () => {
    for (const b of instances) {
      await b.stop()
    }
  })

  it('onBeforeFetch is called before each fetch cycle', async () => {
    const qname = uniqueName('hook-before')
    const fetchedQueues: string[] = []

    const boss = createTestBoss({
      onBeforeFetch: async (queue) => {
        fetchedQueues.push(queue)
      },
    })
    instances.push(boss)
    await boss.start()

    await boss.createQueue(qname)
    const id = await boss.send(qname, { x: 1 })

    const workerId = await boss.work(
      qname,
      { pollingIntervalSeconds: 0.1 },
      async () => {}
    )

    await waitFor(async () => {
      const job = await boss.getJobById(id)
      return job!.state === 'completed'
    }, 5000)

    await boss.offWork(workerId)

    expect(fetchedQueues.length).toBeGreaterThanOrEqual(1)
    expect(fetchedQueues).toContain(qname)

    await cleanupQueue(boss, qname)
  })

  it('onAfterComplete is called after completion', async () => {
    const qname = uniqueName('hook-after')
    const completedBatches: unknown[][] = []

    const boss = createTestBoss({
      onAfterComplete: async (jobs) => {
        completedBatches.push(jobs)
      },
    })
    instances.push(boss)
    await boss.start()

    await boss.createQueue(qname)
    const id = await boss.send(qname, { x: 1 })

    const workerId = await boss.work(
      qname,
      { pollingIntervalSeconds: 0.1 },
      async () => {}
    )

    await waitFor(async () => {
      const job = await boss.getJobById(id)
      return job!.state === 'completed'
    }, 5000)

    await boss.offWork(workerId)

    expect(completedBatches.length).toBeGreaterThanOrEqual(1)
    expect(completedBatches[0]!.length).toBeGreaterThanOrEqual(1)

    await cleanupQueue(boss, qname)
  })

  it('onRetry is called when job retried', async () => {
    const qname = uniqueName('hook-retry')
    const retries: Array<{ job: unknown; error: Error }> = []

    const boss = createTestBoss({
      onRetry: async (job, error) => {
        retries.push({ job, error })
      },
    })
    instances.push(boss)
    await boss.start()

    await boss.createQueue(qname, { retryLimit: 1, retryDelay: 0 })

    let callCount = 0
    const workerId = await boss.work(
      qname,
      { pollingIntervalSeconds: 0.1 },
      async () => {
        callCount++
        if (callCount === 1) throw new Error('retry me')
      }
    )

    const id = await boss.send(qname, { x: 1 })

    await waitFor(async () => {
      const job = await boss.getJobById(id)
      return job!.state === 'completed' || job!.state === 'failed'
    }, 5000)

    await boss.offWork(workerId)

    expect(retries.length).toBeGreaterThanOrEqual(1)
    expect(retries[0]!.error).toBeInstanceOf(Error)
    expect(retries[0]!.error.message).toBe('retry me')

    await cleanupQueue(boss, qname)
  })
})
