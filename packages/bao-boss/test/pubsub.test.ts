import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Pub/Sub', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('publishes to a single subscriber', async () => {
    const q = uniqueName('pubsub-single')
    await boss.createQueue(q)
    await boss.subscribe('evt.single', q)

    await boss.publish('evt.single', { msg: 'hello' })

    const jobs = await boss.fetch(q, { batchSize: 10 })
    expect(jobs).toHaveLength(1)
    expect((jobs[0]!.data as { msg: string }).msg).toBe('hello')

    await boss.complete(jobs[0]!.id)
    await boss.unsubscribe('evt.single', q)
    await cleanupQueue(boss, q)
  })

  it('publishes to multiple subscribers', async () => {
    const q1 = uniqueName('pubsub-multi1')
    const q2 = uniqueName('pubsub-multi2')
    const q3 = uniqueName('pubsub-multi3')
    await boss.createQueue(q1)
    await boss.createQueue(q2)
    await boss.createQueue(q3)

    await boss.subscribe('evt.multi', q1)
    await boss.subscribe('evt.multi', q2)
    await boss.subscribe('evt.multi', q3)

    await boss.publish('evt.multi', { fan: 'out' })

    const j1 = await boss.fetch(q1, { batchSize: 1 })
    const j2 = await boss.fetch(q2, { batchSize: 1 })
    const j3 = await boss.fetch(q3, { batchSize: 1 })
    expect(j1).toHaveLength(1)
    expect(j2).toHaveLength(1)
    expect(j3).toHaveLength(1)

    await boss.unsubscribe('evt.multi', q1)
    await boss.unsubscribe('evt.multi', q2)
    await boss.unsubscribe('evt.multi', q3)
    await cleanupQueue(boss, q1)
    await cleanupQueue(boss, q2)
    await cleanupQueue(boss, q3)
  })

  it('publish with no subscribers is a no-op', async () => {
    // Should not throw
    await boss.publish('evt.nobody', { data: 'ignored' })
  })

  it('unsubscribe stops receiving events', async () => {
    const q = uniqueName('pubsub-unsub')
    await boss.createQueue(q)
    await boss.subscribe('evt.unsub', q)

    await boss.publish('evt.unsub', { n: 1 })
    const batch1 = await boss.fetch(q, { batchSize: 10 })
    expect(batch1).toHaveLength(1)
    await boss.complete(batch1[0]!.id)

    await boss.unsubscribe('evt.unsub', q)

    await boss.publish('evt.unsub', { n: 2 })
    const batch2 = await boss.fetch(q, { batchSize: 10 })
    expect(batch2).toHaveLength(0)

    await cleanupQueue(boss, q)
  })

  it('subscribe is idempotent', async () => {
    const q = uniqueName('pubsub-idem')
    await boss.createQueue(q)

    await boss.subscribe('evt.idem', q)
    await boss.subscribe('evt.idem', q)

    await boss.publish('evt.idem', { n: 1 })
    const jobs = await boss.fetch(q, { batchSize: 10 })
    // Should only get one job, not two
    expect(jobs).toHaveLength(1)

    await boss.unsubscribe('evt.idem', q)
    await cleanupQueue(boss, q)
  })

  it('publish passes send options to created jobs', async () => {
    const q = uniqueName('pubsub-opts')
    await boss.createQueue(q)
    await boss.subscribe('evt.opts', q)

    await boss.publish('evt.opts', { task: 'priority' }, { priority: 5 })

    const jobs = await boss.fetch(q, { batchSize: 1 })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.priority).toBe(5)

    await boss.complete(jobs[0]!.id)
    await boss.unsubscribe('evt.opts', q)
    await cleanupQueue(boss, q)
  })
})
