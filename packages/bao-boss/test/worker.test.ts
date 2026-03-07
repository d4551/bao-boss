import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Worker', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('processes a job via work()', async () => {
    const qname = `test-work-${Date.now()}`
    await boss.createQueue(qname)
    const processed: string[] = []

    const workerId = await boss.work(qname, { pollingIntervalSeconds: 0.1 }, async ([job]) => {
      if (job) processed.push(job.id)
    })

    const id = await boss.send(qname, { hello: 'worker' })

    // Wait for job to be processed
    await new Promise(resolve => setTimeout(resolve, 500))

    await boss.offWork(workerId)
    expect(processed).toContain(id)

    // Verify the job is completed
    const job = await boss.getJobById(id)
    expect(job!.state).toBe('completed')

    await boss.deleteQueue(qname)
  })

  it('retries on handler failure', async () => {
    const qname = `test-work-retry-${Date.now()}`
    await boss.createQueue(qname, { retryLimit: 2, retryDelay: 0 })
    let attempts = 0

    const workerId = await boss.work(qname, { pollingIntervalSeconds: 0.1 }, async ([job]) => {
      attempts++
      if (attempts < 2) throw new Error('first attempt fails')
    })

    await boss.send(qname, {})
    await new Promise(resolve => setTimeout(resolve, 1000))

    await boss.offWork(workerId)
    expect(attempts).toBeGreaterThanOrEqual(2)
    await boss.deleteQueue(qname)
  })

  it('processes batch of jobs', async () => {
    const qname = `test-work-batch-${Date.now()}`
    await boss.createQueue(qname)
    const processed: string[] = []

    const workerId = await boss.work(qname, {
      pollingIntervalSeconds: 0.1,
      batchSize: 3,
    }, async (jobs) => {
      for (const j of jobs) processed.push(j.id)
    })

    const ids = await boss.insert([
      { name: qname, data: { n: 1 } },
      { name: qname, data: { n: 2 } },
      { name: qname, data: { n: 3 } },
    ])

    await new Promise(resolve => setTimeout(resolve, 500))

    await boss.offWork(workerId)
    for (const id of ids) {
      expect(processed).toContain(id)
    }
    await boss.deleteQueue(qname)
  })

  it('stops all workers for a queue via offWork(queueName)', async () => {
    const qname = `test-offwork-${Date.now()}`
    await boss.createQueue(qname)

    const w1 = await boss.work(qname, { pollingIntervalSeconds: 0.5 }, async () => {})
    const w2 = await boss.work(qname, { pollingIntervalSeconds: 0.5 }, async () => {})

    // Stop all workers for this queue by name
    await boss.offWork(qname)

    // Verify we can still send/fetch without workers interfering
    await boss.deleteQueue(qname)
  })

  it('concurrent workers on same queue do not double-process', async () => {
    const qname = `test-concurrent-${Date.now()}`
    await boss.createQueue(qname)
    const processed: string[] = []

    // Start two workers on the same queue
    const w1 = await boss.work(qname, { pollingIntervalSeconds: 0.1 }, async (jobs) => {
      for (const j of jobs) processed.push(j.id)
    })
    const w2 = await boss.work(qname, { pollingIntervalSeconds: 0.1 }, async (jobs) => {
      for (const j of jobs) processed.push(j.id)
    })

    // Send several jobs
    const ids = await boss.insert([
      { name: qname, data: { n: 1 } },
      { name: qname, data: { n: 2 } },
      { name: qname, data: { n: 3 } },
      { name: qname, data: { n: 4 } },
    ])

    await new Promise(resolve => setTimeout(resolve, 1000))

    await boss.offWork(w1)
    await boss.offWork(w2)

    // All jobs should be processed
    for (const id of ids) {
      expect(processed).toContain(id)
    }

    // No duplicates
    const unique = new Set(processed)
    expect(unique.size).toBe(processed.length)

    await boss.deleteQueue(qname)
  })
})
