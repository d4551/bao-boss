import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Error Paths', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('complete on already-completed job is a no-op', async () => {
    const qname = uniqueName('err-complete-twice')
    await boss.createQueue(qname)
    const id = await boss.send(qname, { n: 1 })
    await boss.fetch(qname, { batchSize: 1 })
    await boss.complete(id)

    // Second complete should not throw (WHERE state='active' won't match)
    await boss.complete(id)

    const job = await boss.getJobById(id)
    expect(job!.state).toBe('completed')
    await cleanupQueue(boss, qname)
  })

  it('fail on completed job is a no-op', async () => {
    const qname = uniqueName('err-fail-completed')
    await boss.createQueue(qname)
    const id = await boss.send(qname, { n: 1 })
    await boss.fetch(qname, { batchSize: 1 })
    await boss.complete(id)

    // Fail should not throw (WHERE state='active' won't match)
    await boss.fail(id, 'should be ignored')

    const job = await boss.getJobById(id)
    expect(job!.state).toBe('completed')
    await cleanupQueue(boss, qname)
  })

  it('cancel on completed job does nothing', async () => {
    const qname = uniqueName('err-cancel-completed')
    await boss.createQueue(qname)
    const id = await boss.send(qname, { n: 1 })
    await boss.fetch(qname, { batchSize: 1 })
    await boss.complete(id)

    await boss.cancel(id)

    const job = await boss.getJobById(id)
    expect(job!.state).toBe('completed')
    await cleanupQueue(boss, qname)
  })

  it('resume on active job does nothing', async () => {
    const qname = uniqueName('err-resume-active')
    await boss.createQueue(qname)
    const id = await boss.send(qname, { n: 1 })
    await boss.fetch(qname, { batchSize: 1 })

    // Resume only works on cancelled/failed
    await boss.resume(id)

    const job = await boss.getJobById(id)
    expect(job!.state).toBe('active')
    await boss.complete(id)
    await cleanupQueue(boss, qname)
  })

  it('getJobById with non-existent ID returns null', async () => {
    const job = await boss.getJobById('00000000-0000-0000-0000-000000000000')
    expect(job).toBeNull()
  })

  it('fetch from non-existent queue returns empty array', async () => {
    const jobs = await boss.fetch('queue-that-does-not-exist', { batchSize: 1 })
    expect(jobs).toHaveLength(0)
  })

  it('complete with empty array does not throw', async () => {
    await boss.complete([])
  })

  it('fail with empty array does not throw', async () => {
    await boss.fail([])
  })

  it('cancel on already-cancelled job is idempotent', async () => {
    const qname = uniqueName('err-cancel-twice')
    await boss.createQueue(qname)
    const id = await boss.send(qname, { n: 1 })

    await boss.cancel(id)
    await boss.cancel(id)

    const job = await boss.getJobById(id)
    expect(job!.state).toBe('cancelled')
    await cleanupQueue(boss, qname)
  })

  it('resume on created job does nothing', async () => {
    const qname = uniqueName('err-resume-created')
    await boss.createQueue(qname)
    const id = await boss.send(qname, { n: 1 })

    // Resume only works on cancelled/failed
    await boss.resume(id)

    const job = await boss.getJobById(id)
    expect(job!.state).toBe('created')
    await cleanupQueue(boss, qname)
  })
})
