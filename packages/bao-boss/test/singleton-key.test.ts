import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Singleton Key', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('singletonKey is stored on the job', async () => {
    const qname = uniqueName('sk-store')
    await boss.createQueue(qname)

    const id = await boss.send(qname, { n: 1 }, { singletonKey: 'unique-key' })
    const job = await boss.getJobById(id)
    expect(job!.singletonKey).toBe('unique-key')

    await cleanupQueue(boss, qname)
  })

  it('different singletonKeys create independent jobs', async () => {
    const qname = uniqueName('sk-diff')
    await boss.createQueue(qname)

    const id1 = await boss.send(qname, { n: 1 }, { singletonKey: 'key-a' })
    const id2 = await boss.send(qname, { n: 2 }, { singletonKey: 'key-b' })
    expect(id1).not.toBe(id2)

    const size = await boss.getQueueSize(qname)
    expect(size).toBe(2)

    await cleanupQueue(boss, qname)
  })

  it('singletonKey persists through job lifecycle', async () => {
    const qname = uniqueName('sk-lifecycle')
    await boss.createQueue(qname)

    const id = await boss.send(qname, { n: 1 }, { singletonKey: 'persist-key' })
    const jobs = await boss.fetch(qname, { batchSize: 1 })
    expect(jobs[0]!.singletonKey).toBe('persist-key')

    await boss.complete(id)
    const completed = await boss.getJobById(id)
    expect(completed!.singletonKey).toBe('persist-key')

    await cleanupQueue(boss, qname)
  })

  it('job without singletonKey has null singletonKey', async () => {
    const qname = uniqueName('sk-null')
    await boss.createQueue(qname)

    const id = await boss.send(qname, { n: 1 })
    const job = await boss.getJobById(id)
    expect(job!.singletonKey).toBeNull()

    await cleanupQueue(boss, qname)
  })
})
