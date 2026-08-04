import { describe, it, expect } from 'bun:test'
import { validateCron, parseCron, parseCronFields } from '../src/cron'
import { describeCron } from '../src/cron-describe'

/** Build a local Date on a known weekday: 2026-01-05 is a Monday. */
function at(minute: number, hour = 12, day = 5, month = 1): Date {
  return new Date(2026, month - 1, day, hour, minute, 0, 0)
}

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
    expect(() => validateCron('0-30/10 * * * *')).not.toThrow()
  })

  it('accepts range and list expressions', () => {
    expect(() => validateCron('0 9-17 * * *')).not.toThrow()
    expect(() => validateCron('* * * * 1-5')).not.toThrow()
    expect(() => validateCron('0 0 1,15 * *')).not.toThrow()
    expect(() => validateCron('0-5,10 * * * *')).not.toThrow()
  })

  it('accepts month and weekday names', () => {
    expect(() => validateCron('0 0 1 jan *')).not.toThrow()
    expect(() => validateCron('0 0 * * mon')).not.toThrow()
    expect(() => validateCron('0 0 * * MON-FRI')).not.toThrow()
  })

  it('accepts 7 as a second spelling of Sunday', () => {
    expect(() => validateCron('* * * * 7')).not.toThrow()
  })

  it('accepts aliases', () => {
    for (const alias of ['@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly']) {
      expect(() => validateCron(alias)).not.toThrow()
    }
  })

  it('rejects wrong field count', () => {
    expect(() => validateCron('* * *')).toThrow('expected 5 fields')
    expect(() => validateCron('* * * * * *')).toThrow('expected 5 fields')
    expect(() => validateCron('')).toThrow('empty')
  })

  it('rejects out-of-range values', () => {
    expect(() => validateCron('60 * * * *')).toThrow('outside 0-59')
    expect(() => validateCron('* 24 * * *')).toThrow('outside 0-23')
    expect(() => validateCron('* * 32 * *')).toThrow('outside 1-31')
    expect(() => validateCron('* * 0 * *')).toThrow('outside 1-31')
    expect(() => validateCron('* * * 13 *')).toThrow('outside 1-12')
    expect(() => validateCron('* * * * 8')).toThrow('outside 0-7')
  })

  it('rejects an inverted range', () => {
    expect(() => validateCron('* 17-9 * * *')).toThrow('greater than end')
  })

  it('rejects non-numeric values', () => {
    expect(() => validateCron('abc * * * *')).toThrow('not a number')
    expect(() => validateCron('* * * xyz *')).toThrow('not a number or a valid name')
  })

  it('rejects invalid step values', () => {
    expect(() => validateCron('*/0 * * * *')).toThrow('positive integer')
    expect(() => validateCron('*/-1 * * * *')).toThrow('positive integer')
    expect(() => validateCron('*/1/2 * * * *')).toThrow('more than one step separator')
  })
})

describe('parseCron', () => {
  it('matches every minute for a bare wildcard', () => {
    const matches = parseCron('* * * * *')
    expect(matches(at(0))).toBe(true)
    expect(matches(at(37))).toBe(true)
  })

  it('matches every value of a range inside a list', () => {
    // Regression: the validator accepted `1-5,10` while the matcher parsed the
    // list first and read '1-5' as the single value 1, so minutes 2-5 never fired.
    const matches = parseCron('1-5,10 * * * *')
    for (const minute of [1, 2, 3, 4, 5, 10]) {
      expect(matches(at(minute))).toBe(true)
    }
    for (const minute of [0, 6, 9, 11]) {
      expect(matches(at(minute))).toBe(false)
    }
  })

  it('honours steps within a range', () => {
    const matches = parseCron('0-30/10 * * * *')
    expect([0, 10, 20, 30].every(m => matches(at(m)))).toBe(true)
    expect([5, 15, 40].some(m => matches(at(m)))).toBe(false)
  })

  it('steps from a base value to the end of the field', () => {
    const matches = parseCron('10/15 * * * *')
    expect([10, 25, 40, 55].every(m => matches(at(m)))).toBe(true)
    expect(matches(at(5))).toBe(false)
  })

  it('treats day-of-week 7 as Sunday', () => {
    const matches = parseCron('0 0 * * 7')
    // 2026-01-04 is a Sunday, 2026-01-05 a Monday.
    expect(matches(at(0, 0, 4))).toBe(true)
    expect(matches(at(0, 0, 5))).toBe(false)
  })

  it('matches names as well as numbers', () => {
    const byName = parseCron('0 0 * * mon')
    expect(byName(at(0, 0, 5))).toBe(true)
    expect(byName(at(0, 0, 6))).toBe(false)
  })

  it('runs on either day field when both are restricted', () => {
    // Vixie cron: restricted day-of-month OR restricted day-of-week.
    const matches = parseCron('0 0 1 * mon')
    expect(matches(at(0, 0, 1))).toBe(true)   // 1st of the month
    expect(matches(at(0, 0, 5))).toBe(true)   // a Monday
    expect(matches(at(0, 0, 6))).toBe(false)  // neither
  })

  it('throws rather than returning a matcher that never fires', () => {
    expect(() => parseCron('not a cron')).toThrow()
    expect(() => parseCron('99 * * * *')).toThrow()
  })
})

describe('parseCronFields', () => {
  it('reports a bare wildcard as always matching', () => {
    const [minute, hour] = parseCronFields('* 3 * * *')
    expect(minute.always).toBe(true)
    expect(hour.always).toBe(false)
  })

  it('expands aliases through the same parser', () => {
    const [minute, hour, dom, month, dow] = parseCronFields('@yearly')
    expect(minute.terms[0]?.start).toBe(0)
    expect(hour.terms[0]?.start).toBe(0)
    expect(dom.terms[0]?.start).toBe(1)
    expect(month.terms[0]?.start).toBe(1)
    expect(dow.always).toBe(true)
  })
})

describe('describeCron', () => {
  it('describes a plain wildcard', () => {
    expect(describeCron('* * * * *')).toBe('every minute')
  })

  it('describes every-N-minutes', () => {
    expect(describeCron('*/5 * * * *')).toContain('every 5 minutes')
  })

  it('describes a specific time', () => {
    const description = describeCron('30 9 * * *')
    expect(description).toContain('30')
    expect(description).toContain('9')
  })

  it('names months and weekdays through Intl', () => {
    expect(describeCron('0 0 1 6 *')).toContain('June')
    expect(describeCron('0 0 * * 1')).toContain('Monday')
  })

  it('honours the requested locale', () => {
    expect(describeCron('0 0 1 6 *', 'fr')).toContain('juin')
  })

  it('describes each element of a list', () => {
    const description = describeCron('0 0 1,15 * *')
    expect(description).toContain('1')
    expect(description).toContain('15')
  })

  it('throws on an expression the scheduler could not run', () => {
    // Returning the raw text would present a broken schedule as a readable one.
    expect(() => describeCron('not a cron')).toThrow()
  })
})
