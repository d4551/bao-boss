import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, waitFor, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Pause / Resume', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('paused queue returns no jobs on fetch', async () => {
    const qname = uniqueName('pause-fetch')
    await boss.createQueue(qname)
    await boss.send(qname, { x: 1 })
    await boss.pauseQueue(qname)
    const jobs = await boss.fetch(qname, { batchSize: 1 })
    expect(jobs).toHaveLength(0)
    await cleanupQueue(boss, qname)
  })

  it('resumed queue returns jobs', async () => {
    const qname = uniqueName('pause-resume')
    await boss.createQueue(qname)
    await boss.send(qname, { x: 1 })
    await boss.pauseQueue(qname)
    await boss.resumeQueue(qname)
    const jobs = await boss.fetch(qname, { batchSize: 1 })
    expect(jobs).toHaveLength(1)
    await boss.complete(jobs[0]!.id)
    await cleanupQueue(boss, qname)
  })

  it('paused queue still accepts sends', async () => {
    const qname = uniqueName('pause-send')
    await boss.createQueue(qname)
    await boss.pauseQueue(qname)
    const id = await boss.send(qname, { x: 1 })
    expect(typeof id).toBe('string')
    await boss.resumeQueue(qname)
    const jobs = await boss.fetch(qname, { batchSize: 1 })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.id).toBe(id)
    await boss.complete(id)
    await cleanupQueue(boss, qname)
  })

  it('pause/resume emits events', async () => {
    const qname = uniqueName('pause-events')
    await boss.createQueue(qname)

    const paused: Array<{ queue: string }> = []
    const resumed: Array<{ queue: string }> = []

    boss.on('queue:paused', (payload: { queue: string }) => paused.push(payload))
    boss.on('queue:resumed', (payload: { queue: string }) => resumed.push(payload))

    await boss.pauseQueue(qname)
    await boss.resumeQueue(qname)

    await waitFor(() => paused.length > 0 && resumed.length > 0, 2000)
    expect(paused[0]!.queue).toBe(qname)
    expect(resumed[0]!.queue).toBe(qname)

    await cleanupQueue(boss, qname)
  })
})
