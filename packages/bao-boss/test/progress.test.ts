import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, waitFor, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Progress', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('updates job progress', async () => {
    const qname = uniqueName('progress')
    await boss.createQueue(qname)
    const id = await boss.send(qname, { task: 'work' })
    // Fetch to make active (progress only updates active jobs)
    await boss.fetch(qname, { batchSize: 1 })
    await boss.progress(id, 50)
    const job = await boss.getJobById(id)
    expect(job!.progress).toBe(50)
    await cleanupQueue(boss, qname)
  })

  it('progress is clamped to 0-100', async () => {
    const qname = uniqueName('progress-clamp')
    await boss.createQueue(qname)
    const id = await boss.send(qname, { task: 'clamp' })
    await boss.fetch(qname, { batchSize: 1 })

    await boss.progress(id, 150)
    let job = await boss.getJobById(id)
    expect(job!.progress).toBe(100)

    await boss.progress(id, -5)
    job = await boss.getJobById(id)
    expect(job!.progress).toBe(0)

    await cleanupQueue(boss, qname)
  })

  it('progress event is emitted', async () => {
    const qname = uniqueName('progress-event')
    await boss.createQueue(qname)
    const id = await boss.send(qname, { task: 'event' })
    await boss.fetch(qname, { batchSize: 1 })

    const events: Array<{ id: string; queue: string; progress: number }> = []
    boss.on('progress', (payload: { id: string; queue: string; progress: number }) => {
      events.push(payload)
    })

    await boss.progress(id, 75)

    await waitFor(() => events.length > 0, 2000)
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0]!.id).toBe(id)
    expect(events[0]!.queue).toBe(qname)
    expect(events[0]!.progress).toBe(75)

    await cleanupQueue(boss, qname)
  })
})
