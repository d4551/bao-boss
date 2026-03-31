import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, createTestBoss, cleanupQueue } from './helpers'
import type { Job } from '../src/types'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Fairness', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('without fairness, strict priority ordering', async () => {
    const qname = uniqueName('fairness-strict')
    await boss.createQueue(qname)

    // Send low priority then high priority
    await boss.send(qname, { n: 'low' }, { priority: 1 })
    await boss.send(qname, { n: 'high' }, { priority: 10 })
    await boss.send(qname, { n: 'mid' }, { priority: 5 })

    const jobs = await boss.fetch(qname, { batchSize: 3 })
    expect(jobs).toHaveLength(3)
    expect((jobs[0]!.data as { n: string }).n).toBe('high')
    expect((jobs[1]!.data as { n: string }).n).toBe('mid')
    expect((jobs[2]!.data as { n: string }).n).toBe('low')

    await boss.complete(jobs.map(j => j.id))
    await cleanupQueue(boss, qname)
  })

  it('with fairness, low priority jobs get fetched sometimes', async () => {
    const qname = uniqueName('fairness-share')
    await boss.createQueue(qname, { fairness: { lowPriorityShare: 1.0 } })

    // We will run 20 rounds. In each round, send one high and one low priority
    // job, fetch one, and record which priority came first.
    let lowFirstCount = 0
    const rounds = 20

    for (let i = 0; i < rounds; i++) {
      // Send low priority first, then high priority
      await boss.send(qname, { n: 'low', round: i }, { priority: 1 })
      await boss.send(qname, { n: 'high', round: i }, { priority: 10 })

      // Fetch one job at a time
      const batch = await boss.fetch(qname, { batchSize: 1 })
      expect(batch).toHaveLength(1)

      const data = batch[0]!.data as { n: string }
      if (data.n === 'low') {
        lowFirstCount++
      }

      // Drain the remaining job
      const remaining = await boss.fetch(qname, { batchSize: 1 })
      const allIds = [...batch, ...remaining].map(j => j.id)
      await boss.complete(allIds)
    }

    // With lowPriorityShare=1.0, low priority should appear first at least once
    // (in practice it should be nearly every time, but we use a loose threshold)
    expect(lowFirstCount).toBeGreaterThanOrEqual(1)

    await cleanupQueue(boss, qname)
  })
})
