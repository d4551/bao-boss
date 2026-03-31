import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, waitFor, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Maintenance', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss({ maintenanceIntervalSeconds: 1 })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('expires active jobs past expireIn', async () => {
    const qname = uniqueName('expire-active')
    await boss.createQueue(qname, { expireIn: 1 })
    const id = await boss.send(qname, { task: 'expire' })
    // Fetch to make active
    await boss.fetch(qname, { batchSize: 1 })

    // Wait for maintenance to expire the job (expireIn=1s + maintenance interval)
    await waitFor(async () => {
      const job = await boss.getJobById(id)
      return job!.state === 'failed'
    }, 5000)

    const job = await boss.getJobById(id)
    expect(job!.state).toBe('failed')
    await cleanupQueue(boss, qname)
  })

  it('expired active job with DLQ gets promoted', async () => {
    const dlqName = uniqueName('dlq')
    const qname = uniqueName('expire-dlq')
    await boss.createQueue(dlqName)
    await boss.createQueue(qname, { expireIn: 1, deadLetter: dlqName })

    const id = await boss.send(qname, { task: 'dlq-expire' })
    // Fetch to make active
    await boss.fetch(qname, { batchSize: 1 })

    // Wait for maintenance to expire and promote to DLQ
    await waitFor(async () => {
      const job = await boss.getJobById(id)
      return job!.state === 'failed'
    }, 5000)

    const mainJob = await boss.getJobById(id)
    expect(mainJob!.state).toBe('failed')

    // DLQ should have a job
    const dlqJobs = await boss.fetch(dlqName, { batchSize: 1 })
    expect(dlqJobs.length).toBeGreaterThan(0)

    await cleanupQueue(boss, qname)
    await cleanupQueue(boss, dlqName)
  })

  it('expires unstarted jobs past expireIfNotStartedIn', async () => {
    const qname = uniqueName('expire-unstarted')
    await boss.createQueue(qname)
    const id = await boss.send(qname, { task: 'never-started' }, { expireIfNotStartedIn: 1 })
    // Do NOT fetch — leave in created state

    await waitFor(async () => {
      const job = await boss.getJobById(id)
      return job!.state === 'cancelled'
    }, 5000)

    const job = await boss.getJobById(id)
    expect(job!.state).toBe('cancelled')
    expect(JSON.stringify(job!.output)).toContain('expired before start')
    await cleanupQueue(boss, qname)
  })

  it('purges old jobs past keepUntil', async () => {
    const qname = uniqueName('purge')
    await boss.createQueue(qname)
    const id = await boss.send(qname, { task: 'purge-me' })
    // Fetch and complete
    await boss.fetch(qname, { batchSize: 1 })
    await boss.complete(id)

    // Set keepUntil to the past so maintenance will purge it
    await boss.prisma.$executeRawUnsafe(
      `UPDATE "baoboss".job SET "keepUntil" = now() - interval '1 day' WHERE id = $1`,
      id
    )

    // Wait for maintenance to purge
    await waitFor(async () => {
      const job = await boss.getJobById(id)
      return job === null
    }, 5000)

    const job = await boss.getJobById(id)
    expect(job).toBeNull()
    await cleanupQueue(boss, qname)
  })

  it('archives completed jobs', async () => {
    const qname = uniqueName('archive')
    // Use very short archive threshold
    const archiveBoss = createTestBoss({
      maintenanceIntervalSeconds: 1,
      archiveCompletedAfterSeconds: 0,
      deleteArchivedAfterDays: 7,
    })
    await archiveBoss.start()

    try {
      await archiveBoss.createQueue(qname)
      const id = await archiveBoss.send(qname, { task: 'archive-me' })
      await archiveBoss.fetch(qname, { batchSize: 1 })
      await archiveBoss.complete(id)

      const before = await archiveBoss.getJobById(id)
      const originalKeepUntil = before!.keepUntil

      // Wait for maintenance to archive (update keepUntil)
      await waitFor(async () => {
        const job = await archiveBoss.getJobById(id)
        if (!job) return false
        return job.keepUntil.getTime() !== originalKeepUntil.getTime()
      }, 5000)

      const job = await archiveBoss.getJobById(id)
      expect(job).not.toBeNull()
      // keepUntil should have been updated by archival
      expect(job!.keepUntil.getTime()).not.toBe(originalKeepUntil.getTime())

      await cleanupQueue(archiveBoss, qname)
    } finally {
      await archiveBoss.stop()
    }
  })
})
