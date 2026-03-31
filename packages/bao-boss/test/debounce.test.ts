import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, waitFor, createTestBoss, cleanupQueue } from './helpers'
import type { Job } from '../src/types'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Debounce', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss({ maintenanceIntervalSeconds: 1 })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('debounced sends return placeholder IDs', async () => {
    const qname = uniqueName('debounce-placeholder')
    await boss.createQueue(qname, { debounce: 2 })

    const id1 = await boss.send(qname, { msg: 'a' })
    const id2 = await boss.send(qname, { msg: 'b' })
    const id3 = await boss.send(qname, { msg: 'c' })

    expect(id1.startsWith('debounce:')).toBe(true)
    expect(id2.startsWith('debounce:')).toBe(true)
    expect(id3.startsWith('debounce:')).toBe(true)

    await cleanupQueue(boss, qname)
  })

  it('debounced sends flush as batched job', async () => {
    const qname = uniqueName('debounce-flush')
    await boss.createQueue(qname, { debounce: 1 })

    await boss.send(qname, { msg: 'a' })
    await boss.send(qname, { msg: 'b' })
    await boss.send(qname, { msg: 'c' })

    // Wait for the maintenance loop to flush the debounce window
    let jobs: Job[] = []
    await waitFor(async () => {
      jobs = await boss.fetch(qname, { batchSize: 10 })
      return jobs.length > 0
    }, 10000)

    expect(jobs).toHaveLength(1)
    const data = jobs[0]!.data as { _batched: boolean; items: unknown[] }
    expect(data._batched).toBe(true)
    expect(data.items).toHaveLength(3)
    expect(data.items).toContainEqual({ msg: 'a' })
    expect(data.items).toContainEqual({ msg: 'b' })
    expect(data.items).toContainEqual({ msg: 'c' })

    await boss.complete(jobs[0]!.id)
    await cleanupQueue(boss, qname)
  })

  it('new debounce window starts after flush', async () => {
    const qname = uniqueName('debounce-window')
    await boss.createQueue(qname, { debounce: 1 })

    // First batch of sends
    await boss.send(qname, { msg: 'first-a' })
    await boss.send(qname, { msg: 'first-b' })

    // Wait for first flush
    let firstJobs: Job[] = []
    await waitFor(async () => {
      firstJobs = await boss.fetch(qname, { batchSize: 10 })
      return firstJobs.length > 0
    }, 10000)

    expect(firstJobs).toHaveLength(1)
    const firstData = firstJobs[0]!.data as { _batched: boolean; items: unknown[] }
    expect(firstData._batched).toBe(true)
    expect(firstData.items).toHaveLength(2)

    await boss.complete(firstJobs[0]!.id)

    // Second batch of sends — new debounce window
    await boss.send(qname, { msg: 'second-a' })
    await boss.send(qname, { msg: 'second-b' })
    await boss.send(qname, { msg: 'second-c' })

    // Wait for second flush
    let secondJobs: Job[] = []
    await waitFor(async () => {
      secondJobs = await boss.fetch(qname, { batchSize: 10 })
      return secondJobs.length > 0
    }, 10000)

    expect(secondJobs).toHaveLength(1)
    const secondData = secondJobs[0]!.data as { _batched: boolean; items: unknown[] }
    expect(secondData._batched).toBe(true)
    expect(secondData.items).toHaveLength(3)

    await boss.complete(secondJobs[0]!.id)
    await cleanupQueue(boss, qname)
  })
})
