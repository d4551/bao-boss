import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, waitFor, createTestBoss, cleanupQueue } from './helpers'

describe('dead letter routing', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss({ noSupervisor: true })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('reports the queue the job actually failed in', async () => {
    // Regression: the expiry path reported every source queue as "expired".
    const dlq = uniqueName('dlq-target')
    const source = uniqueName('dlq-source')
    await boss.createQueue(dlq)
    await boss.createQueue(source, { retryLimit: 0, deadLetter: dlq })
    try {
      const events: Array<{ queue: string; deadLetter: string }> = []
      boss.on('dlq', (payload: unknown) => {
        events.push(payload as { queue: string; deadLetter: string })
      })

      const id = await boss.send(source, { n: 1 })
      await boss.fetch(source)
      await boss.fail(id, 'boom')

      await waitFor(() => events.length > 0)
      expect(events[0]!.queue).toBe(source)
      expect(events[0]!.deadLetter).toBe(dlq)
      expect(await boss.getDLQDepth(dlq)).toBe(1)
    } finally {
      boss.removeAllListeners('dlq')
      await cleanupQueue(boss, source)
      await cleanupQueue(boss, dlq)
    }
  })

  it('counts only outstanding dead-letter work', async () => {
    const dlq = uniqueName('dlq-depth')
    await boss.createQueue(dlq)
    try {
      const id = await boss.send(dlq, {})
      expect(await boss.getDLQDepth(dlq)).toBe(1)
      await boss.fetch(dlq)
      await boss.complete(id)
      expect(await boss.getDLQDepth(dlq)).toBe(0)
    } finally {
      await cleanupQueue(boss, dlq)
    }
  })
})

describe('worker handler timeout', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss({ noSupervisor: true })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('aborts the handler rather than leaving it running', async () => {
    // Regression: the timeout raced a rejection while the handler kept going,
    // so a timed-out batch was failed and processed at the same time.
    const queueName = uniqueName('timeout-abort')
    await boss.createQueue(queueName, { retryLimit: 0 })
    let aborted = false
    let finishedAfterTimeout = false

    const workerId = await boss.work(
      queueName,
      { pollingIntervalSeconds: 0.05, handlerTimeoutSeconds: 0.2 },
      async (_jobs, { signal }) => {
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { finishedAfterTimeout = true; resolve() }, 5_000)
          signal.addEventListener('abort', () => {
            aborted = true
            clearTimeout(timer)
            resolve()
          }, { once: true })
        })
      },
    )
    try {
      const id = await boss.send(queueName, {})
      await waitFor(async () => (await boss.getJobById(id))!.state === 'failed')
      expect(aborted).toBe(true)
      expect(finishedAfterTimeout).toBe(false)
    } finally {
      await boss.offWork(workerId)
      await cleanupQueue(boss, queueName)
    }
  })

  it('bounds concurrency instead of stacking one batch per tick', async () => {
    const queueName = uniqueName('concurrency-bound')
    await boss.createQueue(queueName)
    let running = 0
    let peak = 0

    const workerId = await boss.work(
      queueName,
      { pollingIntervalSeconds: 0.01, maxConcurrency: 2 },
      async () => {
        running++
        peak = Math.max(peak, running)
        await Bun.sleep(60)
        running--
      },
    )
    try {
      await boss.insert(Array.from({ length: 12 }, (_, n) => ({ name: queueName, data: { n } })))
      await waitFor(async () => (await boss.getQueueSize(queueName)) === 0, 15_000)
      expect(peak).toBeLessThanOrEqual(2)
      expect(peak).toBeGreaterThan(0)
    } finally {
      await boss.offWork(workerId)
      await cleanupQueue(boss, queueName)
    }
  })
})

describe('cron locks', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss({ noSupervisor: true })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('purges cron locks that have aged out', async () => {
    // Regression: one row per schedule per fired minute accumulated forever.
    const name = uniqueName('lock-purge')
    await boss.prisma.$executeRawUnsafe(
      `INSERT INTO "baoboss".cron_lock ("scheduleName", "minuteBucket", "lockedUntil", "instanceId")
       VALUES ($1, $2, now() - interval '30 days', 'test')`,
      name,
      '2020-01-01T00:00:00Z',
    )
    const before = await boss.prisma.cronLock.count({ where: { scheduleName: name } })
    expect(before).toBe(1)

    const sweeper = createTestBoss({ maintenanceIntervalSeconds: 1 })
    await sweeper.start()
    try {
      await waitFor(async () => (await boss.prisma.cronLock.count({ where: { scheduleName: name } })) === 0)
    } finally {
      await sweeper.stop()
    }
  })
})
