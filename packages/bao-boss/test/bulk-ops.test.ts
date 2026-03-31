import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, waitFor, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Bulk Operations', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('cancelJobs cancels multiple jobs', async () => {
    const queueName = uniqueName('bulk-cancel')
    await boss.createQueue(queueName)

    const id1 = await boss.send(queueName, { n: 1 })
    const id2 = await boss.send(queueName, { n: 2 })
    const id3 = await boss.send(queueName, { n: 3 })

    const count = await boss.cancelJobs(queueName)
    expect(count).toBe(3)

    const j1 = await boss.getJobById(id1)
    const j2 = await boss.getJobById(id2)
    const j3 = await boss.getJobById(id3)
    expect(j1!.state).toBe('cancelled')
    expect(j2!.state).toBe('cancelled')
    expect(j3!.state).toBe('cancelled')

    await cleanupQueue(boss, queueName)
  })

  it('cancelJobs with state filter', async () => {
    const queueName = uniqueName('bulk-cancel-filter')
    await boss.createQueue(queueName)

    const id1 = await boss.send(queueName, { n: 1 })
    const id2 = await boss.send(queueName, { n: 2 })

    // Fetch one job to make it active
    const fetched = await boss.fetch(queueName)
    expect(fetched.length).toBeGreaterThan(0)
    const activeId = fetched[0]!.id

    // Cancel only 'created' jobs
    const count = await boss.cancelJobs(queueName, { state: 'created' })
    expect(count).toBe(1)

    // The unfetched job should be cancelled, the active one should remain active
    const remainingId = activeId === id1 ? id2 : id1
    const cancelledJob = await boss.getJobById(remainingId)
    expect(cancelledJob!.state).toBe('cancelled')

    const activeJob = await boss.getJobById(activeId)
    expect(activeJob!.state).toBe('active')

    await cleanupQueue(boss, queueName)
  })

  it('resumeJobs resumes failed jobs', async () => {
    const queueName = uniqueName('bulk-resume')
    await boss.createQueue(queueName, { retryLimit: 0 })

    const id1 = await boss.send(queueName, { n: 1 })
    const id2 = await boss.send(queueName, { n: 2 })

    // Fetch and fail both jobs
    const fetched1 = await boss.fetch(queueName)
    expect(fetched1.length).toBeGreaterThan(0)
    await boss.fail(fetched1[0]!.id, 'test error')

    const fetched2 = await boss.fetch(queueName)
    expect(fetched2.length).toBeGreaterThan(0)
    await boss.fail(fetched2[0]!.id, 'test error')

    const count = await boss.resumeJobs(queueName)
    expect(count).toBe(2)

    const j1 = await boss.getJobById(id1)
    const j2 = await boss.getJobById(id2)
    expect(j1!.state).toBe('created')
    expect(j2!.state).toBe('created')

    await cleanupQueue(boss, queueName)
  })

  it('resumeJobs with state filter', async () => {
    const queueName = uniqueName('bulk-resume-filter')
    await boss.createQueue(queueName, { retryLimit: 0 })

    const id1 = await boss.send(queueName, { n: 1 })
    const id2 = await boss.send(queueName, { n: 2 })

    // Fetch and fail one job
    const fetched = await boss.fetch(queueName)
    expect(fetched.length).toBeGreaterThan(0)
    const failedId = fetched[0]!.id
    await boss.fail(failedId, 'test error')

    // Cancel the other job
    const otherId = failedId === id1 ? id2 : id1
    await boss.cancel(otherId)

    // Resume only failed jobs
    const count = await boss.resumeJobs(queueName, { state: 'failed' })
    expect(count).toBe(1)

    const failedJob = await boss.getJobById(failedId)
    expect(failedJob!.state).toBe('created')

    const cancelledJob = await boss.getJobById(otherId)
    expect(cancelledJob!.state).toBe('cancelled')

    await cleanupQueue(boss, queueName)
  })
})
