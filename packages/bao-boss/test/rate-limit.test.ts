import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, waitFor, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Rate Limiting', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('rate limit blocks fetch when count exceeded within period', async () => {
    const qname = uniqueName('ratelimit-block')
    await boss.createQueue(qname, { rateLimit: { count: 2, period: 10 } })

    await boss.send(qname, { n: 1 })
    await boss.send(qname, { n: 2 })
    await boss.send(qname, { n: 3 })

    // First fetch should return up to 2 jobs (rate limit count)
    const batch1 = await boss.fetch(qname, { batchSize: 3 })
    expect(batch1).toHaveLength(2)

    // Second fetch should return 0 — rate limit exhausted within the period
    const batch2 = await boss.fetch(qname, { batchSize: 3 })
    expect(batch2).toHaveLength(0)

    await boss.complete(batch1.map(j => j.id))
    await cleanupQueue(boss, qname)
  })

  it('rate limit allows fetch after period expires', async () => {
    const qname = uniqueName('ratelimit-expire')
    await boss.createQueue(qname, { rateLimit: { count: 1, period: 1 } })

    await boss.send(qname, { n: 1 })
    await boss.send(qname, { n: 2 })

    // First fetch should return 1 job
    const batch1 = await boss.fetch(qname, { batchSize: 1 })
    expect(batch1).toHaveLength(1)

    // Immediately after, should be rate limited
    const batch2 = await boss.fetch(qname, { batchSize: 1 })
    expect(batch2).toHaveLength(0)

    // Wait for the period to expire
    await Bun.sleep(1500)

    // Now fetch should succeed
    const batch3 = await boss.fetch(qname, { batchSize: 1 })
    expect(batch3).toHaveLength(1)

    await boss.complete([...batch1, ...batch3].map(j => j.id))
    await cleanupQueue(boss, qname)
  })

  it('rate limit works with batchSize', async () => {
    const qname = uniqueName('ratelimit-batch')
    await boss.createQueue(qname, { rateLimit: { count: 2, period: 10 } })

    for (let i = 0; i < 5; i++) {
      await boss.send(qname, { n: i })
    }

    // Request batchSize=5 but rate limit should cap at 2
    const batch = await boss.fetch(qname, { batchSize: 5 })
    expect(batch).toHaveLength(2)

    await boss.complete(batch.map(j => j.id))
    await cleanupQueue(boss, qname)
  })
})
