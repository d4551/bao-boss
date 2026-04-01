import { describe, it, expect } from 'bun:test'
import { validateCron, describeCron } from '../src/cron'

describe('validateCron', () => {
  it('accepts standard expressions', () => {
    expect(() => validateCron('* * * * *')).not.toThrow()
    expect(() => validateCron('0 0 * * *')).not.toThrow()
    expect(() => validateCron('30 4 1 1 0')).not.toThrow()
  })

  it('accepts step expressions', () => {
    expect(() => validateCron('*/5 * * * *')).not.toThrow()
    expect(() => validateCron('0 */2 * * *')).not.toThrow()
    expect(() => validateCron('10/15 * * * *')).not.toThrow()
  })

  it('accepts range expressions', () => {
    expect(() => validateCron('0 9-17 * * *')).not.toThrow()
    expect(() => validateCron('* * * * 1-5')).not.toThrow()
    expect(() => validateCron('0 0 1-15 * *')).not.toThrow()
  })

  it('accepts list expressions', () => {
    expect(() => validateCron('0 0 1,15 * *')).not.toThrow()
    expect(() => validateCron('0,30 * * * *')).not.toThrow()
    expect(() => validateCron('* * * 1,6,12 *')).not.toThrow()
  })

  it('accepts aliases', () => {
    expect(() => validateCron('@yearly')).not.toThrow()
    expect(() => validateCron('@annually')).not.toThrow()
    expect(() => validateCron('@monthly')).not.toThrow()
    expect(() => validateCron('@weekly')).not.toThrow()
    expect(() => validateCron('@daily')).not.toThrow()
    expect(() => validateCron('@midnight')).not.toThrow()
    expect(() => validateCron('@hourly')).not.toThrow()
  })

  it('rejects wrong field count', () => {
    expect(() => validateCron('* * *')).toThrow('expected 5 fields')
    expect(() => validateCron('* * * * * *')).toThrow('expected 5 fields')
    expect(() => validateCron('')).toThrow('expected 5 fields')
  })

  it('rejects out-of-range values', () => {
    expect(() => validateCron('60 * * * *')).toThrow('out of range')
    expect(() => validateCron('* 24 * * *')).toThrow('out of range')
    expect(() => validateCron('* * 32 * *')).toThrow('out of range')
    expect(() => validateCron('* * 0 * *')).toThrow('out of range')
    expect(() => validateCron('* * * 13 *')).toThrow('out of range')
    expect(() => validateCron('* * * 0 *')).toThrow('out of range')
    expect(() => validateCron('* * * * 7')).toThrow('out of range')
  })

  it('rejects invalid range (start > end)', () => {
    expect(() => validateCron('* 17-9 * * *')).toThrow('greater than end')
  })

  it('rejects non-numeric values', () => {
    expect(() => validateCron('abc * * * *')).toThrow()
  })

  it('rejects invalid step values', () => {
    expect(() => validateCron('*/0 * * * *')).toThrow('step must be a positive integer')
    expect(() => validateCron('*/-1 * * * *')).toThrow('step must be a positive integer')
  })
})

describe('describeCron', () => {
  it('describes aliases', () => {
    expect(describeCron('@daily')).toBe('Once a day (at midnight)')
    expect(describeCron('@hourly')).toBe('Once an hour (at minute 0)')
    expect(describeCron('@weekly')).toBe('Once a week (Sunday at midnight)')
    expect(describeCron('@monthly')).toBe('Once a month (1st at midnight)')
    expect(describeCron('@yearly')).toBe('Once a year (Jan 1 at midnight)')
    expect(describeCron('@annually')).toBe('Once a year (Jan 1 at midnight)')
    expect(describeCron('@midnight')).toBe('Once a day (at midnight)')
  })

  it('describes every-N-minutes', () => {
    const desc = describeCron('*/5 * * * *')
    expect(desc).toContain('every 5 minutes')
  })

  it('describes specific time', () => {
    const desc = describeCron('30 9 * * *')
    expect(desc).toContain('at minute 30')
    expect(desc).toContain('at hour 9')
  })

  it('describes day of month', () => {
    const desc = describeCron('0 0 1 * *')
    expect(desc).toContain('on day 1')
  })

  it('describes month', () => {
    const desc = describeCron('0 0 1 6 *')
    expect(desc).toContain('in Jun')
  })

  it('describes day of week', () => {
    const desc = describeCron('0 0 * * 1')
    expect(desc).toContain('on Mon')
  })

  it('returns raw expression for invalid input', () => {
    expect(describeCron('not a cron')).toBe('not a cron')
  })
})
