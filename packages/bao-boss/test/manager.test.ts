import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'

// Tests require a running PostgreSQL instance
// DATABASE_URL must be set
const skip = !process.env['DATABASE_URL']

describe.skipIf(skip)('Manager', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = new BaoBoss({ connectionString: process.env['DATABASE_URL'] })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('creates and retrieves a queue', async () => {
    const name = `test-${Date.now()}`
    await boss.createQueue(name, { retryLimit: 3 })
    const q = await boss.getQueue(name)
    expect(q).not.toBeNull()
    expect(q!.name).toBe(name)
    expect(q!.retryLimit).toBe(3)
    await boss.deleteQueue(name)
  })

  it('updates a queue', async () => {
    const name = `test-update-${Date.now()}`
    await boss.createQueue(name, { retryLimit: 2 })
    await boss.updateQueue(name, { retryLimit: 5 })
    const q = await boss.getQueue(name)
    expect(q!.retryLimit).toBe(5)
    await boss.deleteQueue(name)
  })

  it('lists all queues', async () => {
    const n1 = `test-list1-${Date.now()}`
    const n2 = `test-list2-${Date.now()}`
    await boss.createQueue(n1)
    await boss.createQueue(n2)
    const queues = await boss.getQueues()
    const names = queues.map(q => q.name)
    expect(names).toContain(n1)
    expect(names).toContain(n2)
    await boss.deleteQueue(n1)
    await boss.deleteQueue(n2)
  })

  it('purges pending jobs from a queue', async () => {
    const qname = `test-purge-${Date.now()}`
    await boss.createQueue(qname)
    await boss.send(qname, { a: 1 })
    await boss.send(qname, { a: 2 })
    const sizeBefore = await boss.getQueueSize(qname)
    expect(sizeBefore).toBe(2)
    await boss.purgeQueue(qname)
    const sizeAfter = await boss.getQueueSize(qname)
    expect(sizeAfter).toBe(0)
    await boss.deleteQueue(qname)
  })

  it('sends and fetches a job', async () => {
    const qname = `test-fetch-${Date.now()}`
    await boss.createQueue(qname)
    const id = await boss.send(qname, { hello: 'world' })
    expect(typeof id).toBe('string')
    const jobs = await boss.fetch(qname, { batchSize: 1 })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.id).toBe(id)
    expect(jobs[0]!.state).toBe('active')
    await boss.complete(id)
    await boss.deleteQueue(qname)
  })

  it('sends with priority ordering', async () => {
    const qname = `test-priority-${Date.now()}`
    await boss.createQueue(qname)
    await boss.send(qname, { n: 'low' }, { priority: 1 })
    await boss.send(qname, { n: 'high' }, { priority: 10 })
    await boss.send(qname, { n: 'mid' }, { priority: 5 })
    const jobs = await boss.fetch(qname, { batchSize: 3 })
    expect(jobs).toHaveLength(3)
    expect((jobs[0]!.data as { n: string }).n).toBe('high')
    expect((jobs[1]!.data as { n: string }).n).toBe('mid')
    expect((jobs[2]!.data as { n: string }).n).toBe('low')
    await boss.complete(jobs.map(j => j.id))
    await boss.deleteQueue(qname)
  })

  it('sends with startAfter delay', async () => {
    const qname = `test-delay-${Date.now()}`
    await boss.createQueue(qname)
    await boss.send(qname, { delayed: true }, { startAfter: 60 }) // 60 seconds in future
    const jobs = await boss.fetch(qname, { batchSize: 1 })
    expect(jobs).toHaveLength(0) // Should not be fetchable yet
    await boss.deleteQueue(qname)
  })

  it('bulk inserts jobs', async () => {
    const qname = `test-bulk-${Date.now()}`
    await boss.createQueue(qname)
    const ids = await boss.insert([
      { name: qname, data: { n: 1 } },
      { name: qname, data: { n: 2 } },
      { name: qname, data: { n: 3 } },
    ])
    expect(ids).toHaveLength(3)
    const size = await boss.getQueueSize(qname)
    expect(size).toBe(3)
    await boss.deleteQueue(qname)
  })

  it('fails and retries a job', async () => {
    const qname = `test-retry-${Date.now()}`
    await boss.createQueue(qname, { retryLimit: 2, retryDelay: 0 })
    const id = await boss.send(qname, { test: true })
    const jobs = await boss.fetch(qname, { batchSize: 1 })
    expect(jobs).toHaveLength(1)
    await boss.fail(id, new Error('test error'))
    const retried = await boss.getJobById(id)
    expect(retried!.state).toBe('created')
    expect(retried!.retryCount).toBe(1)
    await boss.deleteQueue(qname)
  })

  it('retries with exponential backoff', async () => {
    const qname = `test-backoff-${Date.now()}`
    await boss.createQueue(qname, { retryLimit: 3, retryDelay: 10, retryBackoff: true })
    const id = await boss.send(qname, { test: true })

    // First attempt
    let jobs = await boss.fetch(qname, { batchSize: 1 })
    expect(jobs).toHaveLength(1)
    await boss.fail(id, new Error('fail 1'))

    let job = await boss.getJobById(id)
    expect(job!.state).toBe('created')
    expect(job!.retryCount).toBe(1)
    // startAfter should be ~10s in the future (10 * 2^0)
    const delay1 = job!.startAfter.getTime() - Date.now()
    expect(delay1).toBeGreaterThan(5000)
    expect(delay1).toBeLessThan(15000)

    await boss.deleteQueue(qname)
  })

  it('promotes to dead letter on exhausted retries', async () => {
    const dlq = `test-dlq-${Date.now()}`
    const qname = `test-main-${Date.now()}`
    await boss.createQueue(dlq)
    await boss.createQueue(qname, { retryLimit: 0, deadLetter: dlq })
    const id = await boss.send(qname)
    const jobs = await boss.fetch(qname, { batchSize: 1 })
    await boss.fail(id, 'exhausted')
    const failed = await boss.getJobById(id)
    expect(failed!.state).toBe('failed')
    // Check DLQ has a job
    const dlqJobs = await boss.fetch(dlq, { batchSize: 1 })
    expect(dlqJobs.length).toBeGreaterThan(0)
    await boss.deleteQueue(qname)
    await boss.deleteQueue(dlq)
  })

  it('enforces short policy', async () => {
    const qname = `test-short-${Date.now()}`
    await boss.createQueue(qname, { policy: 'short' })
    const id1 = await boss.send(qname, { n: 1 })
    const id2 = await boss.send(qname, { n: 2 })
    // Second send should return the same ID (no-op)
    expect(id1).toBe(id2)
    await boss.deleteQueue(qname)
  })

  it('enforces singleton policy — at most one active at a time', async () => {
    const qname = `test-singleton-${Date.now()}`
    await boss.createQueue(qname, { policy: 'singleton' })

    // Send two jobs — both should be created
    const id1 = await boss.send(qname, { n: 1 })
    const id2 = await boss.send(qname, { n: 2 })
    expect(id1).not.toBe(id2)

    // Fetch first — should become active
    const batch1 = await boss.fetch(qname, { batchSize: 2 })
    expect(batch1).toHaveLength(1) // only one at a time

    // Try to fetch again — should get nothing because one is active
    const batch2 = await boss.fetch(qname, { batchSize: 1 })
    expect(batch2).toHaveLength(0)

    // Complete the first, then fetch should work
    await boss.complete(batch1[0]!.id)
    const batch3 = await boss.fetch(qname, { batchSize: 1 })
    expect(batch3).toHaveLength(1)
    await boss.complete(batch3[0]!.id)

    await boss.deleteQueue(qname)
  })

  it('enforces stately policy — at most one created + one active', async () => {
    const qname = `test-stately-${Date.now()}`
    await boss.createQueue(qname, { policy: 'stately' })

    // First send creates a job
    const id1 = await boss.send(qname, { n: 1 })
    // Second send should return existing created job (at most one created)
    const id2 = await boss.send(qname, { n: 2 })
    expect(id1).toBe(id2)

    // Fetch the job (now active) — a new send should be allowed
    const batch1 = await boss.fetch(qname, { batchSize: 1 })
    expect(batch1).toHaveLength(1)

    // Now we have one active, can send one created
    const id3 = await boss.send(qname, { n: 3 })
    expect(id3).not.toBe(id1)

    // But another send should return existing created
    const id4 = await boss.send(qname, { n: 4 })
    expect(id3).toBe(id4)

    // Fetch should fail because there's already an active job
    const batch2 = await boss.fetch(qname, { batchSize: 1 })
    expect(batch2).toHaveLength(0)

    await boss.complete(batch1[0]!.id)
    await boss.deleteQueue(qname)
  })

  it('cancels and resumes a job', async () => {
    const qname = `test-cancel-${Date.now()}`
    await boss.createQueue(qname)
    const id = await boss.send(qname)
    await boss.cancel(id)
    const cancelled = await boss.getJobById(id)
    expect(cancelled!.state).toBe('cancelled')
    await boss.resume(id)
    const resumed = await boss.getJobById(id)
    expect(resumed!.state).toBe('created')
    await boss.deleteQueue(qname)
  })

  it('completes with output', async () => {
    const qname = `test-output-${Date.now()}`
    await boss.createQueue(qname)
    const id = await boss.send(qname, { input: true })
    await boss.fetch(qname, { batchSize: 1 })
    await boss.complete(id, { output: { result: 42 } })
    const job = await boss.getJobById(id)
    expect(job!.state).toBe('completed')
    expect(job!.output).toEqual({ result: 42 })
    await boss.deleteQueue(qname)
  })

  it('gets queue size with before filter', async () => {
    const qname = `test-size-${Date.now()}`
    await boss.createQueue(qname)
    await boss.send(qname, { a: 1 })
    await boss.send(qname, { a: 2 })
    const id3 = await boss.send(qname, { a: 3 })
    await boss.fetch(qname, { batchSize: 1 }) // make one active

    const total = await boss.getQueueSize(qname)
    expect(total).toBe(3) // 2 created + 1 active

    const pending = await boss.getQueueSize(qname, { before: 'active' })
    expect(pending).toBe(2) // only created

    await boss.deleteQueue(qname)
  })

  it('gets jobs by id', async () => {
    const qname = `test-getjobs-${Date.now()}`
    await boss.createQueue(qname)
    const id1 = await boss.send(qname, { n: 1 })
    const id2 = await boss.send(qname, { n: 2 })
    const jobs = await boss.getJobsById([id1, id2])
    expect(jobs).toHaveLength(2)
    await boss.deleteQueue(qname)
  })

  it('pub/sub fan-out', async () => {
    const q1 = `test-sub1-${Date.now()}`
    const q2 = `test-sub2-${Date.now()}`
    await boss.createQueue(q1)
    await boss.createQueue(q2)
    await boss.subscribe('test.event', q1)
    await boss.subscribe('test.event', q2)
    await boss.publish('test.event', { payload: 'data' })
    const j1 = await boss.fetch(q1, { batchSize: 1 })
    const j2 = await boss.fetch(q2, { batchSize: 1 })
    expect(j1).toHaveLength(1)
    expect(j2).toHaveLength(1)
    await boss.unsubscribe('test.event', q1)
    await boss.unsubscribe('test.event', q2)
    await boss.deleteQueue(q1)
    await boss.deleteQueue(q2)
  })

  it('SKIP LOCKED prevents double-processing under parallel fetch', async () => {
    const qname = `test-skiplock-${Date.now()}`
    await boss.createQueue(qname)

    // Insert multiple jobs
    await boss.insert([
      { name: qname, data: { n: 1 } },
      { name: qname, data: { n: 2 } },
      { name: qname, data: { n: 3 } },
      { name: qname, data: { n: 4 } },
      { name: qname, data: { n: 5 } },
    ])

    // Fetch in parallel — each should get different jobs
    const [batch1, batch2, batch3] = await Promise.all([
      boss.fetch(qname, { batchSize: 2 }),
      boss.fetch(qname, { batchSize: 2 }),
      boss.fetch(qname, { batchSize: 2 }),
    ])

    const allIds = [...batch1, ...batch2, ...batch3].map(j => j.id)
    const uniqueIds = new Set(allIds)

    // No duplicate job IDs across batches
    expect(uniqueIds.size).toBe(allIds.length)
    // Total should be <= 5
    expect(allIds.length).toBeLessThanOrEqual(5)

    await boss.deleteQueue(qname)
  })
})
