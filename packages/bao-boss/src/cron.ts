/**
 * Minimal 5-field cron parser and validator.
 *
 * Supported syntax per field:
 *   *          matches any value
 *   N          exact value
 *   N,M,...    comma-separated list
 *   N-M        inclusive range
 *   *\/N       step (every N)
 *
 * Supports aliases: @yearly, @monthly, @weekly, @daily, @hourly
 */

const FIELD_NAMES = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'] as const
const FIELD_RANGES: Array<[number, number]> = [
  [0, 59],  // minute
  [0, 23],  // hour
  [1, 31],  // day-of-month
  [1, 12],  // month
  [0, 6],   // day-of-week
]

const ALIASES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

function resolveAliases(cron: string): string {
  const trimmed = cron.trim().toLowerCase()
  return ALIASES[trimmed] ?? cron.trim()
}

function validateField(field: string, index: number): void {
  const [min, max] = FIELD_RANGES[index]!
  const name = FIELD_NAMES[index]!

  if (field === '*') return

  // Step: */N or N/N
  if (field.includes('/')) {
    const [base, stepStr] = field.split('/')
    if (base !== '*') {
      const baseNum = parseInt(base!, 10)
      if (isNaN(baseNum) || baseNum < min! || baseNum > max!) {
        throw new Error(`Invalid cron field '${field}' at position ${index} (${name}): base value ${base} out of range ${min}-${max}`)
      }
    }
    const step = parseInt(stepStr!, 10)
    if (isNaN(step) || step < 1) {
      throw new Error(`Invalid cron field '${field}' at position ${index} (${name}): step must be a positive integer`)
    }
    return
  }

  // List: N,M,...
  if (field.includes(',')) {
    for (const part of field.split(',')) {
      validateField(part, index)
    }
    return
  }

  // Range: N-M
  if (field.includes('-')) {
    const [startStr, endStr] = field.split('-')
    const start = parseInt(startStr!, 10)
    const end = parseInt(endStr!, 10)
    if (isNaN(start) || isNaN(end)) {
      throw new Error(`Invalid cron field '${field}' at position ${index} (${name}): range values must be integers`)
    }
    if (start < min! || start > max! || end < min! || end > max!) {
      throw new Error(`Invalid cron field '${field}' at position ${index} (${name}): range ${start}-${end} out of bounds ${min}-${max}`)
    }
    if (start > end) {
      throw new Error(`Invalid cron field '${field}' at position ${index} (${name}): range start ${start} is greater than end ${end}`)
    }
    return
  }

  // Exact value
  const val = parseInt(field, 10)
  if (isNaN(val) || val < min! || val > max!) {
    throw new Error(`Invalid cron field '${field}' at position ${index} (${name}): value ${field} out of range ${min}-${max}`)
  }
}

/** Validate a cron expression. Throws a descriptive error if invalid. */
export function validateCron(cron: string): void {
  const resolved = resolveAliases(cron)
  const parts = resolved.split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression '${cron}': expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`)
  }
  for (let i = 0; i < 5; i++) {
    validateField(parts[i]!, i)
  }
}

function matchesPart(part: string, value: number): boolean {
  if (part === '*') return true
  if (part.includes('/')) {
    const [base, stepStr] = part.split('/')
    const step = parseInt(stepStr ?? '1', 10)
    // Non-* step bases are validated but ignored for matching — legacy behavior
    // from pre–cron.ts Maintenance so stored N/M schedules keep the same fire times.
    if (base === '*') return value % step === 0
    return value % step === 0
  }
  if (part.includes(',')) {
    return part.split(',').some(p => parseInt(p, 10) === value)
  }
  if (part.includes('-')) {
    const [startStr, endStr] = part.split('-')
    const start = parseInt(startStr ?? '0', 10)
    const end = parseInt(endStr ?? '0', 10)
    return value >= start && value <= end
  }
  return parseInt(part, 10) === value
}

/** Parse a cron expression into a matcher function. */
export function parseCron(cron: string): (date: Date) => boolean {
  const resolved = resolveAliases(cron)
  const parts = resolved.split(/\s+/)
  if (parts.length !== 5) return () => false
  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string]

  return (date: Date) => {
    return (
      matchesPart(min, date.getMinutes()) &&
      matchesPart(hour, date.getHours()) &&
      matchesPart(dom, date.getDate()) &&
      matchesPart(month, date.getMonth() + 1) &&
      matchesPart(dow, date.getDay())
    )
  }
}

/** Return a human-readable description of a cron expression. */
export function describeCron(cron: string): string {
  const trimmed = cron.trim().toLowerCase()
  if (trimmed === '@yearly' || trimmed === '@annually') return 'Once a year (Jan 1 at midnight)'
  if (trimmed === '@monthly') return 'Once a month (1st at midnight)'
  if (trimmed === '@weekly') return 'Once a week (Sunday at midnight)'
  if (trimmed === '@daily' || trimmed === '@midnight') return 'Once a day (at midnight)'
  if (trimmed === '@hourly') return 'Once an hour (at minute 0)'

  const resolved = resolveAliases(cron)
  const parts = resolved.split(/\s+/)
  if (parts.length !== 5) return cron

  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string]

  const segments: string[] = []

  // Minute
  if (min === '*') segments.push('every minute')
  else if (min.includes('/')) segments.push(`every ${min.split('/')[1]} minutes`)
  else segments.push(`at minute ${min}`)

  // Hour
  if (hour === '*') { /* already covered */ }
  else if (hour.includes('/')) segments.push(`every ${hour.split('/')[1]} hours`)
  else segments.push(`at hour ${hour}`)

  // Day of month
  if (dom !== '*') segments.push(`on day ${dom}`)

  // Month
  if (month !== '*') {
    const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const monthNum = parseInt(month, 10)
    const monthIsPlainInteger = !isNaN(monthNum) && String(monthNum) === month
    segments.push(
      monthIsPlainInteger && months[monthNum]
        ? `in ${months[monthNum]!}`
        : `in month ${month}`,
    )
  }

  // Day of week
  if (dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const dayNum = parseInt(dow, 10)
    const dowIsPlainInteger = !isNaN(dayNum) && String(dayNum) === dow
    if (dowIsPlainInteger && days[dayNum]) segments.push(`on ${days[dayNum]}`)
    else segments.push(`on day-of-week ${dow}`)
  }

  return segments.join(', ')
}
