import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'

const skip = !process.env['DATABASE_URL']

describe.skipIf(skip)('Worker', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = new BaoBoss({ connectionString: process.env['DATABASE_URL'] })
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
})
