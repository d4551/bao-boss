import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, createTestBoss, cleanupQueue } from './helpers'

describe('singletonKey', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss({ noSupervisor: true })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('collapses a repeated key onto one open job', async () => {
    // Regression: the column was stored and never enforced, so "singleton"
    // produced as many jobs as you sent.
    const queueName = uniqueName('singleton-dedupe')
    await boss.createQueue(queueName)
    try {
      const first = await boss.send(queueName, { n: 1 }, { singletonKey: 'same' })
      const second = await boss.send(queueName, { n: 2 }, { singletonKey: 'same' })

      expect(second).toBe(first)
      expect(await boss.getQueueSize(queueName)).toBe(1)
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('keeps different keys independent', async () => {
    const queueName = uniqueName('singleton-distinct')
    await boss.createQueue(queueName)
    try {
      const a = await boss.send(queueName, { n: 1 }, { singletonKey: 'a' })
      const b = await boss.send(queueName, { n: 2 }, { singletonKey: 'b' })
      expect(a).not.toBe(b)
      expect(await boss.getQueueSize(queueName)).toBe(2)
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('allows a new job once the previous one has settled', async () => {
    const queueName = uniqueName('singleton-reopen')
    await boss.createQueue(queueName)
    try {
      const first = await boss.send(queueName, { n: 1 }, { singletonKey: 'cycle' })
      const [claimed] = await boss.fetch(queueName)
      await boss.complete(claimed!.id)

      const second = await boss.send(queueName, { n: 2 }, { singletonKey: 'cycle' })
      expect(second).not.toBe(first)
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('collapses concurrent sends of the same key', async () => {
    const queueName = uniqueName('singleton-race')
    await boss.createQueue(queueName)
    try {
      const ids = await Promise.all(
        Array.from({ length: 8 }, (_, n) => boss.send(queueName, { n }, { singletonKey: 'race' })),
      )
      expect(new Set(ids).size).toBe(1)
      expect(await boss.getQueueSize(queueName)).toBe(1)
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('deduplicates within a batch insert too', async () => {
    const queueName = uniqueName('singleton-insert')
    await boss.createQueue(queueName)
    try {
      const ids = await boss.insert([
        { name: queueName, data: { n: 1 }, options: { singletonKey: 'batch' } },
        { name: queueName, data: { n: 2 }, options: { singletonKey: 'batch' } },
      ])
      expect(new Set(ids).size).toBe(1)
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })
})
