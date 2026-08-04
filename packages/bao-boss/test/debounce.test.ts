import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, createTestBoss, cleanupQueue, fetchWhenReady } from './helpers'

describe('Debounce', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss({ maintenanceIntervalSeconds: 1 })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('returns the id of the real batch job, not a placeholder', async () => {
    // Regression: send() used to return "debounce:<queue>:default", which no
    // other API accepts — getJobById on it could never succeed.
    const qname = uniqueName('debounce-id')
    await boss.createQueue(qname, { debounce: 2 })

    const id = await boss.send(qname, { msg: 'a' })
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

    const job = await boss.getJobById(id)
    expect(job).not.toBeNull()
    expect(job!.queue).toBe(qname)

    await cleanupQueue(boss, qname)
  })

  it('collapses sends in one window onto a single job id', async () => {
    const qname = uniqueName('debounce-collapse')
    await boss.createQueue(qname, { debounce: 2 })

    const first = await boss.send(qname, { msg: 'a' })
    const second = await boss.send(qname, { msg: 'b' })
    const third = await boss.send(qname, { msg: 'c' })

    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(await boss.getQueueSize(qname)).toBe(1)

    await cleanupQueue(boss, qname)
  })

  it('flushes as one batched job carrying every payload', async () => {
    const qname = uniqueName('debounce-flush')
    await boss.createQueue(qname, { debounce: 1 })

    await boss.send(qname, { msg: 'a' })
    await boss.send(qname, { msg: 'b' })
    await boss.send(qname, { msg: 'c' })

    const jobs = await fetchWhenReady(boss, qname, 1)
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

  it('opens a new window once the previous batch has been claimed', async () => {
    const qname = uniqueName('debounce-window')
    await boss.createQueue(qname, { debounce: 1 })

    await boss.send(qname, { msg: 'first-a' })
    await boss.send(qname, { msg: 'first-b' })

    const firstBatch = await fetchWhenReady(boss, qname, 1)
    expect((firstBatch[0]!.data as { items: unknown[] }).items).toHaveLength(2)
    await boss.complete(firstBatch[0]!.id)

    await boss.send(qname, { msg: 'second-a' })
    await boss.send(qname, { msg: 'second-b' })
    await boss.send(qname, { msg: 'second-c' })

    const secondBatch = await fetchWhenReady(boss, qname, 1)
    expect(secondBatch[0]!.id).not.toBe(firstBatch[0]!.id)
    expect((secondBatch[0]!.data as { items: unknown[] }).items).toHaveLength(3)

    await boss.complete(secondBatch[0]!.id)
    await cleanupQueue(boss, qname)
  })

  it('applies the queue retention to the batch job', async () => {
    // Regression: batch jobs used the DLQ retention setting for keepUntil.
    const qname = uniqueName('debounce-retention')
    await boss.createQueue(qname, { debounce: 5, retentionDays: 1 })

    const id = await boss.send(qname, { msg: 'a' })
    const job = await boss.getJobById(id)

    const daysUntilPurge = (job!.keepUntil.getTime() - Date.now()) / 86_400_000
    expect(daysUntilPurge).toBeGreaterThan(0.5)
    expect(daysUntilPurge).toBeLessThan(1.5)

    await cleanupQueue(boss, qname)
  })
})
