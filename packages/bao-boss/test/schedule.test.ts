import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'

const skip = !process.env['DATABASE_URL']

describe.skipIf(skip)('Scheduler', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = new BaoBoss({
      connectionString: process.env['DATABASE_URL'],
      maintenanceIntervalSeconds: 1, // fast maintenance for testing
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
    // Create a schedule that matches every minute (wildcard)
    const name = `test-cron-fire-${Date.now()}`
    await boss.createQueue(name)
    await boss.schedule(name, '* * * * *', { fired: true })

    // Wait for maintenance loop to fire
    await new Promise(resolve => setTimeout(resolve, 2500))

    // Check that a job was created in the queue
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

    // Wait for 2 maintenance cycles
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Should only have 1 job for this minute
    const size = await boss.getQueueSize(name)
    expect(size).toBe(1)

    await boss.unschedule(name)
    await boss.deleteQueue(name)
  })
})
