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

  it('exhausted retries without deadLetter does not create spurious DLQ job', async () => {
    const qname = uniqueName('no-dlq')
    await boss.createQueue(qname, { retryLimit: 0 })
    const id = await boss.send(qname, { task: 'no-dlq' })
    await boss.fetch(qname, { batchSize: 1 })
    await boss.fail(id, 'exhausted')

    const job = await boss.getJobById(id)
    expect(job!.state).toBe('failed')

    // No DLQ configured — total jobs in the system for this queue should be just this one
    const { jobs } = await boss.searchJobs({ queue: qname })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.id).toBe(id)
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

  it('DLQ job that also fails goes to its own DLQ', async () => {
    const dlq2 = uniqueName('dlq2')
    const dlq1 = uniqueName('dlq1')
    const qname = uniqueName('dlq-cascade')
    await boss.createQueue(dlq2)
    await boss.createQueue(dlq1, { retryLimit: 0, deadLetter: dlq2 })
    await boss.createQueue(qname, { retryLimit: 0, deadLetter: dlq1 })

    const id = await boss.send(qname, { task: 'cascade' })
    await boss.fetch(qname, { batchSize: 1 })
    await boss.fail(id, 'fail main')

    // Job should be in DLQ1
    const dlq1Jobs = await boss.fetch(dlq1, { batchSize: 1 })
    expect(dlq1Jobs).toHaveLength(1)

    // Fail the DLQ1 job — should cascade to DLQ2
    await boss.fail(dlq1Jobs[0]!.id, 'fail dlq1')

    const dlq2Jobs = await boss.fetch(dlq2, { batchSize: 1 })
    expect(dlq2Jobs).toHaveLength(1)

    await cleanupQueue(boss, qname)
    await cleanupQueue(boss, dlq1)
    await cleanupQueue(boss, dlq2)
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
