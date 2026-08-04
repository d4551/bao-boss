/**
 * Human-readable rendering of a cron expression.
 *
 * Consumes `parseCronFields` — the one cron grammar owner — so a description can
 * never disagree with what the scheduler will actually fire. Month and weekday
 * names and list joining come from `Intl`, never from a baked-in English array.
 */
import {
  CRON_FIELD_NAMES,
  parseCronFields,
  type CronField,
  type CronFieldIndex,
  type CronTerm,
} from './cron.js'

/** A reference year whose January 1st is well-defined for name extraction. */
const NAME_REFERENCE_YEAR = 2023
/** 2023-01-01 was a Sunday, so day N of that week is weekday N. */
const WEEK_REFERENCE_DAY = 1

function monthName(month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(NAME_REFERENCE_YEAR, month - 1, 1)))
}

function weekdayName(day: number, locale: string): string {
  // 7 is a second spelling of Sunday.
  const normalised = day === 7 ? 0 : day
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(NAME_REFERENCE_YEAR, 0, WEEK_REFERENCE_DAY + normalised)))
}

function formatValue(value: number, index: CronFieldIndex, locale: string): string {
  if (index === 3) return monthName(value, locale)
  if (index === 4) return weekdayName(value, locale)
  return new Intl.NumberFormat(locale).format(value)
}

function joinList(parts: string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(parts)
}

function describeTerm(term: CronTerm, index: CronFieldIndex, locale: string): string {
  const unit = CRON_FIELD_NAMES[index]
  const step = new Intl.NumberFormat(locale).format(term.step)
  if (term.wildcard) {
    return term.step === 1 ? `every ${unit}` : `every ${step} ${unit}s`
  }
  if (term.start === term.end) {
    return formatValue(term.start, index, locale)
  }
  const span = `${formatValue(term.start, index, locale)}–${formatValue(term.end, index, locale)}`
  return term.step === 1 ? span : `every ${step} ${unit}s from ${span}`
}

function describeField(field: CronField, locale: string): string {
  return joinList(field.terms.map(term => describeTerm(term, field.index, locale)), locale)
}

/**
 * Describe a cron expression in the given locale.
 *
 * Throws the same error `validateCron` would for an unparseable expression —
 * returning the raw input would present a broken schedule as if it were readable.
 */
export function describeCron(cron: string, locale = 'en'): string {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parseCronFields(cron)
  const segments: string[] = []

  if (minute.always && hour.always) {
    segments.push('every minute')
  } else if (hour.always) {
    segments.push(`at minute ${describeField(minute, locale)} of every hour`)
  } else if (minute.always) {
    segments.push(`every minute during hour ${describeField(hour, locale)}`)
  } else {
    segments.push(`at minute ${describeField(minute, locale)} past hour ${describeField(hour, locale)}`)
  }

  if (!dayOfMonth.always) segments.push(`on day ${describeField(dayOfMonth, locale)} of the month`)
  if (!month.always) segments.push(`in ${describeField(month, locale)}`)
  if (!dayOfWeek.always) segments.push(`on ${describeField(dayOfWeek, locale)}`)

  return segments.join(', ')
}
