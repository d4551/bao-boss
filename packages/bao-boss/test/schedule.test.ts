import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { Maintenance } from '../src/Maintenance'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Scheduler', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = new BaoBoss({
      connectionString: Bun.env['DATABASE_URL'],
      noSupervisor: true, // manual control over maintenance
    })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('creates and lists schedules', async () => {
    const name = `test-schedule-${Date.now()}`
    await boss.schedule(name, '0 9 * * *', { type: 'report' }, { tz: 'America/New_York' })

    const schedules = await boss.getSchedules()
    const found = schedules.find(s => s.name === name)
    expect(found).not.toBeUndefined()
    expect(found!.cron).toBe('0 9 * * *')
    expect(found!.timezone).toBe('America/New_York')

    await boss.unschedule(name)
  })

  it('unschedules a cron', async () => {
    const name = `test-unsched-${Date.now()}`
    await boss.schedule(name, '*/5 * * * *')
    await boss.unschedule(name)

    const schedules = await boss.getSchedules()
    expect(schedules.find(s => s.name === name)).toBeUndefined()
  })

  it('fires a cron schedule that matches current time', async () => {
    const name = `test-cron-fire-${Date.now()}`
    await boss.createQueue(name)
    await boss.schedule(name, '* * * * *', { fired: true })

    // Fire maintenance manually once
    const m = new Maintenance(boss.prisma, boss, {
      schema: 'baoboss', intervalSeconds: 999,
      archiveCompletedAfterSeconds: 43200, deleteArchivedAfterDays: 7, dlqRetentionDays: 14,
    })
    await m.run()

    const jobs = await boss.fetch(name, { batchSize: 1 })
    expect(jobs.length).toBeGreaterThan(0)
    expect((jobs[0]!.data as { fired: boolean }).fired).toBe(true)

    await boss.unschedule(name)
    await boss.deleteQueue(name)
  })

  it('does not duplicate cron jobs within the same minute', async () => {
    const name = `test-cron-dedup-${Date.now()}`
    await boss.createQueue(name)
    await boss.schedule(name, '* * * * *', { dedup: true })

    // Fire maintenance manually twice in the same minute
    const m = new Maintenance(boss.prisma, boss, {
      schema: 'baoboss', intervalSeconds: 999,
      archiveCompletedAfterSeconds: 43200, deleteArchivedAfterDays: 7, dlqRetentionDays: 14,
    })
    await m.run()
    await m.run()

    // Cron lock prevents duplicate — should only have 1 job
    const size = await boss.getQueueSize(name)
    expect(size).toBe(1)

    await boss.unschedule(name)
    await boss.deleteQueue(name)
  })
})
