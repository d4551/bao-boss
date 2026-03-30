import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, waitFor, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Worker (advanced)', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('maxConcurrency limits parallel handlers', async () => {
    const qname = uniqueName('max-conc')
    await boss.createQueue(qname)

    await boss.insert([
      { name: qname, data: { n: 1 } },
      { name: qname, data: { n: 2 } },
      { name: qname, data: { n: 3 } },
    ])

    let concurrent = 0
    let maxConcurrent = 0

    const workerId = await boss.work(
      qname,
      { pollingIntervalSeconds: 0.1, maxConcurrency: 1 },
      async () => {
        concurrent++
        if (concurrent > maxConcurrent) maxConcurrent = concurrent
        await Bun.sleep(200)
        concurrent--
      }
    )

    await waitFor(async () => {
      const size = await boss.getQueueSize(qname, { before: 'active' })
      return size === 0
    }, 5000)

    await boss.offWork(workerId)
    expect(maxConcurrent).toBe(1)
    await cleanupQueue(boss, qname)
  })

  it('handlerTimeoutSeconds causes timeout error', async () => {
    const qname = uniqueName('timeout')
    await boss.createQueue(qname, { retryLimit: 0 })
    const id = await boss.send(qname, { slow: true })

    const workerId = await boss.work(
      qname,
      { pollingIntervalSeconds: 0.1, handlerTimeoutSeconds: 0.5 },
      async () => {
        await Bun.sleep(3000)
      }
    )

    await waitFor(async () => {
      const job = await boss.getJobById(id)
      return job!.state === 'failed'
    }, 5000)

    await boss.offWork(workerId)
    const job = await boss.getJobById(id)
    expect(job!.state).toBe('failed')
    await cleanupQueue(boss, qname)
  })

  it('worker continues polling after handler error', async () => {
    const qname = uniqueName('err-continue')
    await boss.createQueue(qname, { retryLimit: 0 })

    const id1 = await boss.send(qname, { n: 1 })
    const id2 = await boss.send(qname, { n: 2 })

    let callCount = 0
    const workerId = await boss.work(
      qname,
      { pollingIntervalSeconds: 0.1 },
      async () => {
        callCount++
        if (callCount === 1) throw new Error('first call fails')
      }
    )

    await waitFor(async () => {
      const j1 = await boss.getJobById(id1)
      const j2 = await boss.getJobById(id2)
      return (j1!.state === 'failed' || j1!.state === 'completed') &&
             (j2!.state === 'failed' || j2!.state === 'completed')
    }, 5000)

    await boss.offWork(workerId)
    expect(callCount).toBeGreaterThanOrEqual(2)
    await cleanupQueue(boss, qname)
  })

  it('error event emitted on handler failure', async () => {
    const qname = uniqueName('err-event')
    await boss.createQueue(qname, { retryLimit: 0 })
    await boss.send(qname, { fail: true })

    const errors: unknown[] = []
    boss.on('error', (err: unknown) => errors.push(err))

    const workerId = await boss.work(
      qname,
      { pollingIntervalSeconds: 0.1 },
      async () => {
        throw new Error('boom')
      }
    )

    await waitFor(() => errors.length > 0, 5000)
    await boss.offWork(workerId)

    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0]).toBeInstanceOf(Error)
    await cleanupQueue(boss, qname)
  })

  it('graceful shutdown drains in-flight', async () => {
    const qname = uniqueName('drain')
    await boss.createQueue(qname)
    const id = await boss.send(qname, { drain: true })

    let handlerFinished = false
    const workerId = await boss.work(
      qname,
      { pollingIntervalSeconds: 0.1 },
      async () => {
        await Bun.sleep(300)
        handlerFinished = true
      }
    )

    // Wait for the handler to start processing
    await waitFor(async () => {
      const job = await boss.getJobById(id)
      return job!.state === 'active'
    }, 3000)

    // Stop the worker — should drain in-flight
    await boss.offWork(workerId)

    expect(handlerFinished).toBe(true)
    const job = await boss.getJobById(id)
    expect(job!.state).toBe('completed')
    await cleanupQueue(boss, qname)
  })
})
