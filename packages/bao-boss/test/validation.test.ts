import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Validation', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('valid cron expression accepted', async () => {
    const name = uniqueName('val-cron-ok')
    await boss.schedule(name, '0 9 * * 1-5')
    // Should not throw
    await boss.unschedule(name)
  })

  it('invalid cron expression throws', async () => {
    const name = uniqueName('val-cron-bad')
    await expect(boss.schedule(name, 'invalid')).rejects.toThrow()
  })

  it('cron with wrong number of fields throws', async () => {
    const name = uniqueName('val-cron-fields')
    await expect(boss.schedule(name, '* * *')).rejects.toThrow('expected 5 fields')
  })

  it('cron with out-of-range value throws', async () => {
    const name = uniqueName('val-cron-range')
    await expect(boss.schedule(name, '60 * * * *')).rejects.toThrow('out of range')
  })

  it('cron aliases accepted', async () => {
    const name = uniqueName('val-cron-alias')
    await boss.schedule(name, '@daily')
    // Should not throw
    await boss.unschedule(name)
  })

  it('invalid timezone throws', async () => {
    const name = uniqueName('val-tz-bad')
    await expect(
      boss.schedule(name, '* * * * *', {}, { tz: 'Invalid/Zone' })
    ).rejects.toThrow('Invalid timezone')
  })

  it('valid timezone accepted', async () => {
    const name = uniqueName('val-tz-ok')
    await boss.schedule(name, '* * * * *', {}, { tz: 'America/New_York' })
    // Should not throw
    await boss.unschedule(name)
  })

  it('invalid schema name throws', () => {
    expect(() => {
      new BaoBoss({ schema: 'DROP TABLE', connectionString: 'postgresql://fake' })
    }).toThrow()
  })
})
