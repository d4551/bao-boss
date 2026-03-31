import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('searchJobs', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('search by queue name', async () => {
    const q1 = uniqueName('search-q1')
    const q2 = uniqueName('search-q2')
    await boss.createQueue(q1)
    await boss.createQueue(q2)

    await boss.send(q1, { from: 'q1' })
    await boss.send(q1, { from: 'q1' })
    await boss.send(q2, { from: 'q2' })

    const result = await boss.searchJobs({ queue: q1 })
    expect(result.jobs.length).toBe(2)
    for (const job of result.jobs) {
      expect(job.queue).toBe(q1)
    }

    await cleanupQueue(boss, q1)
    await cleanupQueue(boss, q2)
  })

  it('search by state', async () => {
    const queueName = uniqueName('search-state')
    await boss.createQueue(queueName)

    await boss.send(queueName, { n: 1 })
    await boss.send(queueName, { n: 2 })
    await boss.send(queueName, { n: 3 })

    // Fetch one to make it active
    const fetched = await boss.fetch(queueName)
    expect(fetched.length).toBeGreaterThan(0)

    const activeResult = await boss.searchJobs({ queue: queueName, state: 'active' })
    expect(activeResult.jobs.length).toBe(1)
    expect(activeResult.jobs[0]!.state).toBe('active')

    const createdResult = await boss.searchJobs({ queue: queueName, state: 'created' })
    expect(createdResult.jobs.length).toBe(2)
    for (const job of createdResult.jobs) {
      expect(job.state).toBe('created')
    }

    await cleanupQueue(boss, queueName)
  })

  it('search with pagination', async () => {
    const queueName = uniqueName('search-page')
    await boss.createQueue(queueName)

    for (let i = 0; i < 5; i++) {
      await boss.send(queueName, { n: i })
    }

    const page1 = await boss.searchJobs({ queue: queueName, limit: 2, offset: 0 })
    expect(page1.jobs.length).toBe(2)
    expect(page1.total).toBe(5)

    const page3 = await boss.searchJobs({ queue: queueName, limit: 2, offset: 3 })
    expect(page3.jobs.length).toBe(2)
    expect(page3.total).toBe(5)

    await cleanupQueue(boss, queueName)
  })

  it('search with sort order', async () => {
    const queueName = uniqueName('search-sort')
    await boss.createQueue(queueName)

    await boss.send(queueName, { n: 1 }, { priority: 1 })
    await boss.send(queueName, { n: 2 }, { priority: 10 })
    await boss.send(queueName, { n: 3 }, { priority: 5 })

    const result = await boss.searchJobs({
      queue: queueName,
      sortBy: 'priority',
      sortOrder: 'desc',
    })

    expect(result.jobs.length).toBe(3)
    expect(result.jobs[0]!.priority).toBe(10)
    expect(result.jobs[1]!.priority).toBe(5)
    expect(result.jobs[2]!.priority).toBe(1)

    await cleanupQueue(boss, queueName)
  })

  it('search with multiple state filters', async () => {
    const queueName = uniqueName('search-multi-state')
    await boss.createQueue(queueName, { retryLimit: 0 })

    const id1 = await boss.send(queueName, { n: 1 })
    const id2 = await boss.send(queueName, { n: 2 })
    const id3 = await boss.send(queueName, { n: 3 })

    // Complete one
    const fetched1 = await boss.fetch(queueName)
    expect(fetched1.length).toBeGreaterThan(0)
    await boss.complete(fetched1[0]!.id)

    // Fail one
    const fetched2 = await boss.fetch(queueName)
    expect(fetched2.length).toBeGreaterThan(0)
    await boss.fail(fetched2[0]!.id, 'test error')

    // Third remains created

    const result = await boss.searchJobs({
      queue: queueName,
      state: ['completed', 'failed'],
    })

    expect(result.jobs.length).toBe(2)
    const states = result.jobs.map(j => j.state)
    expect(states).toContain('completed')
    expect(states).toContain('failed')

    await cleanupQueue(boss, queueName)
  })
})
