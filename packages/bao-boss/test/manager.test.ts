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
})
