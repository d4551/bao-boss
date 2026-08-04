/**
 * 5-field cron grammar — the single owner.
 *
 * `parseCronFields` is the only parser. Validation, matching and description all
 * consume its output, so a cron expression can never be accepted by one and
 * misread by another.
 *
 * Field syntax (Vixie/POSIX compatible):
 *   *          any value
 *   N          exact value
 *   NAME       month (jan…dec) or day-of-week (sun…sat) name
 *   A-B        inclusive range
 *   A,B,…      list of any of the above (each element parsed independently)
 *   *\/S       every S from the start of the field's range
 *   A-B/S      every S within the range
 *   A/S        every S from A to the end of the field's range
 *
 * Aliases: @yearly @annually @monthly @weekly @daily @midnight @hourly
 */

export const CRON_FIELD_COUNT = 5

export type CronFieldIndex = 0 | 1 | 2 | 3 | 4

export const CRON_FIELD_NAMES = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'] as const

/** Inclusive [min, max] per field. Day-of-week accepts 7 as a second spelling of Sunday. */
const FIELD_RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const satisfies { readonly [K in CronFieldIndex]: readonly [number, number] }

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

const ALIASES: Readonly<Record<string, string>> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

/** One comma-separated element of a field. `step` of 1 means "every value in [start, end]". */
export interface CronTerm {
  start: number
  end: number
  step: number
  /** True when the source text was `*` (with or without a step) — kept for description. */
  wildcard: boolean
}

export interface CronField {
  index: CronFieldIndex
  terms: CronTerm[]
  /** True when the field matches every value, i.e. a bare `*`. */
  always: boolean
}

export type CronFields = readonly [CronField, CronField, CronField, CronField, CronField]

function fieldError(field: string, index: number, detail: string): Error {
  return new Error(
    `Invalid cron field '${field}' at position ${index} (${CRON_FIELD_NAMES[index]}): ${detail}`,
  )
}

function range(index: CronFieldIndex): readonly [number, number] {
  return FIELD_RANGES[index]
}

/** Parse one value: a number, or a month/day name for fields 3 and 4. */
function parseValue(token: string, index: CronFieldIndex, field: string): number {
  const lower = token.toLowerCase()
  if (index === 3) {
    const month = MONTH_NAMES.indexOf(lower as (typeof MONTH_NAMES)[number])
    if (month >= 0) return month + 1
  }
  if (index === 4) {
    const day = DAY_NAMES.indexOf(lower as (typeof DAY_NAMES)[number])
    if (day >= 0) return day
  }
  if (!/^\d+$/.test(token)) {
    throw fieldError(field, index, `'${token}' is not a number${index >= 3 ? ' or a valid name' : ''}`)
  }
  const value = Number(token)
  const [min, max] = range(index)
  if (value < min || value > max) {
    throw fieldError(field, index, `value ${value} is outside ${min}-${max}`)
  }
  return value
}

function parseTerm(term: string, index: CronFieldIndex, field: string): CronTerm {
  const [spec, stepText, ...extra] = term.split('/')
  if (extra.length > 0 || spec === undefined) {
    throw fieldError(field, index, `'${term}' has more than one step separator`)
  }

  let step = 1
  if (stepText !== undefined) {
    if (!/^\d+$/.test(stepText) || Number(stepText) < 1) {
      throw fieldError(field, index, `step '${stepText}' must be a positive integer`)
    }
    step = Number(stepText)
  }

  const [min, max] = range(index)
  if (spec === '*') {
    return { start: min, end: max, step, wildcard: true }
  }

  // A range is only a range when the '-' separates two operands; a leading '-'
  // is a malformed value, not a range with an empty start.
  const dash = spec.indexOf('-', 1)
  if (dash > 0) {
    const start = parseValue(spec.slice(0, dash), index, field)
    const end = parseValue(spec.slice(dash + 1), index, field)
    if (start > end) {
      throw fieldError(field, index, `range start ${start} is greater than end ${end}`)
    }
    return { start, end, step, wildcard: false }
  }

  const value = parseValue(spec, index, field)
  // `N/S` steps from N to the end of the field; a bare `N` is that value alone.
  return { start: value, end: stepText === undefined ? value : max, step, wildcard: false }
}

function parseField(field: string, index: CronFieldIndex): CronField {
  if (field.length === 0) {
    throw fieldError(field, index, 'field is empty')
  }
  // Split on ',' first so every element — including ranges and steps — is parsed
  // as a whole term. Splitting on '/' or '-' first silently truncates `1-5,10`.
  const terms = field.split(',').map(term => parseTerm(term, index, field))
  const [min, max] = range(index)
  const always = terms.some(t => t.start <= min && t.end >= max && t.step === 1)
  return { index, terms, always }
}

/** Expand `@daily`-style aliases and normalise whitespace. */
export function resolveCronAliases(cron: string): string {
  const trimmed = cron.trim()
  return ALIASES[trimmed.toLowerCase()] ?? trimmed
}

/**
 * Parse a cron expression into its five fields.
 * Throws a descriptive `Error` for any expression this implementation cannot execute.
 */
export function parseCronFields(cron: string): CronFields {
  const resolved = resolveCronAliases(cron)
  if (resolved.length === 0) {
    throw new Error(`Invalid cron expression '${cron}': expression is empty`)
  }
  const parts = resolved.split(/\s+/)
  if (parts.length !== CRON_FIELD_COUNT) {
    throw new Error(
      `Invalid cron expression '${cron}': expected ${CRON_FIELD_COUNT} fields ` +
      `(${CRON_FIELD_NAMES.join(' ')}), got ${parts.length}`,
    )
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  return [
    parseField(minute ?? '', 0),
    parseField(hour ?? '', 1),
    parseField(dayOfMonth ?? '', 2),
    parseField(month ?? '', 3),
    parseField(dayOfWeek ?? '', 4),
  ]
}

/** Validate a cron expression. Throws a descriptive error if it is invalid. */
export function validateCron(cron: string): void {
  parseCronFields(cron)
}

function termMatches(term: CronTerm, value: number): boolean {
  if (value < term.start || value > term.end) return false
  return (value - term.start) % term.step === 0
}

function fieldMatches(field: CronField, value: number): boolean {
  return field.terms.some(term => termMatches(term, value))
}

/**
 * Build a matcher for a cron expression.
 *
 * Throws on an invalid expression — a schedule that can never fire is a
 * configuration error, not a silently inert matcher.
 *
 * The matcher reads the calendar fields of the supplied date as-is; callers
 * pass a date already resolved into the schedule's timezone.
 */
export function parseCron(cron: string): (date: Date) => boolean {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parseCronFields(cron)

  return (date: Date) => {
    if (!fieldMatches(minute, date.getMinutes())) return false
    if (!fieldMatches(hour, date.getHours())) return false
    if (!fieldMatches(month, date.getMonth() + 1)) return false

    const dow = date.getDay()
    // 7 and 0 both mean Sunday, so a field written `7` must match `getDay() === 0`.
    const dowHit = fieldMatches(dayOfWeek, dow) || (dow === 0 && fieldMatches(dayOfWeek, 7))
    const domHit = fieldMatches(dayOfMonth, date.getDate())

    // Vixie cron: when both day fields are restricted the job runs when *either*
    // matches; when only one is restricted that one decides.
    if (dayOfMonth.always) return dowHit
    if (dayOfWeek.always) return domHit
    return domHit || dowHit
  }
}
