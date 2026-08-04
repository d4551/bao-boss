/**
 * Dashboard copy and locale formatting — single owner.
 *
 * Every string a person can read comes from here, including `aria-label`,
 * `title` and `alt` text. Numbers, dates and lists are formatted through `Intl`
 * so a non-English locale is rendered correctly rather than approximated.
 */

/** Message catalogue. Keys are stable; English is the fallback for every locale. */
const messages: Record<string, Record<string, string>> = {
  en: {
    // Navigation
    'nav.brand': '🥟 bao-boss',
    'nav.dashboard': 'Overview',
    'nav.queues': 'Queues',
    'nav.schedules': 'Schedules',
    'nav.stats': 'Statistics',
    'nav.metrics': 'Prometheus metrics',

    // Page titles
    'title.dashboard': 'bao-boss Dashboard',
    'title.queues': 'Queues — bao-boss',
    'title.stats': 'Statistics — bao-boss',
    'title.schedules': 'Schedules — bao-boss',
    'title.queue': 'Queue {name} — bao-boss',
    'title.job': 'Job {id} — bao-boss',
    'title.notFound': 'Not found — bao-boss',

    // Sections
    'section.queues': 'Queues',
    'section.schedules': 'Schedules',
    'section.stats': 'Statistics',
    'section.queue': 'Queue',
    'section.job': 'Job',
    'section.queueSettings': 'Queue settings',
    'section.recentJobs': 'Recent jobs',
    'section.details': 'Details',
    'section.data': 'Data',
    'section.output': 'Output',

    // Table headers
    'table.name': 'Name',
    'table.policy': 'Policy',
    'table.pending': 'Pending',
    'table.retryLimit': 'Retry limit',
    'table.deadLetter': 'Dead letter',
    'table.created': 'Created',
    'table.id': 'ID',
    'table.state': 'State',
    'table.priority': 'Priority',
    'table.actions': 'Actions',
    'table.setting': 'Setting',
    'table.value': 'Value',
    'table.cron': 'Schedule',
    'table.cronDescription': 'Runs',
    'table.timezone': 'Timezone',
    'table.select': 'Select',

    // Fields
    'field.queue': 'Queue',
    'field.retryDelay': 'Retry delay',
    'field.retryBackoff': 'Retry backoff',
    'field.retryJitter': 'Retry jitter',
    'field.expireIn': 'Expire in',
    'field.retentionDays': 'Retention',
    'field.retryCount': 'Retries',
    'field.startAfter': 'Start after',
    'field.startedOn': 'Started',
    'field.completedOn': 'Completed',
    'field.keepUntil': 'Keep until',
    'field.progress': 'Progress',
    'field.search': 'Filter by name',
    'field.paused': 'Paused',

    // Statistics
    'stat.created': 'Waiting',
    'stat.active': 'Running',
    'stat.completed': 'Completed',
    'stat.failed': 'Failed',
    'stat.cancelled': 'Cancelled',
    'stat.queues': 'Queues',
    'stat.totalJobs': 'Jobs',
    'stat.dlq': 'Dead letter',

    // Job states, so a state is never printed as a raw database value
    'state.created': 'Waiting',
    'state.active': 'Running',
    'state.completed': 'Completed',
    'state.cancelled': 'Cancelled',
    'state.failed': 'Failed',

    // Buttons
    'btn.retry': 'Retry',
    'btn.cancel': 'Cancel',
    'btn.delete': 'Delete',
    'btn.undo': 'Undo',
    'btn.apply': 'Apply',
    'btn.clear': 'Clear',
    'btn.selectAll': 'Select all',
    'btn.bulkRetry': 'Retry selected',
    'btn.bulkCancel': 'Cancel selected',
    'btn.previous': 'Previous',
    'btn.next': 'Next',
    'btn.themeDark': 'Switch to dark theme',
    'btn.themeLight': 'Switch to light theme',

    // Empty states, kept distinct — no results is not the same as nothing yet
    'empty.none': '—',
    'empty.noQueues': 'No queues yet. Create one with boss.createQueue(name).',
    'empty.noQueuesMatch': 'No queue matches “{search}”.',
    'empty.noSchedules': 'No schedules yet. Add one with boss.schedule(name, cron).',
    'empty.noJobs': 'No jobs in this queue yet.',
    'empty.noJobsMatch': 'No job on this page. Try an earlier page.',

    // Messages
    'msg.queueNotFound': 'That queue does not exist. It may have been deleted.',
    'msg.jobNotFound': 'That job does not exist. It may have been purged after its retention window.',
    'msg.unauthorized': 'Unauthorized',
    'msg.forbiddenCsrf': 'Forbidden: invalid CSRF token',
    'msg.tooManyRequests': 'Too many requests. Try again shortly.',
    'msg.notFound': 'Not found',
    'msg.jobQueuedRetry': 'Queued for retry',
    'msg.jobCancelled': 'Cancelled',
    'msg.jobAlreadyFinished': 'Job already finished',
    'msg.bulkInvalid': 'That request could not be read',
    'msg.bulkEmpty': 'Select at least one job first',
    'msg.bulkRetryDone': '{count} queued for retry',
    'msg.bulkCancelDone': '{count} cancelled',
    'msg.requestFailed': 'That action failed. Nothing was changed — try again.',
    'msg.showingRange': 'Showing {from}–{to} of {total}',
    'msg.cronInvalid': 'Unreadable schedule',

    // Links
    'link.metricsScrape': 'Prometheus metrics (scrape endpoint)',

    // Accessible names
    'aria.mainNav': 'Main navigation',
    'aria.dashboardContent': 'Dashboard content',
    'aria.skipToContent': 'Skip to main content',
    'aria.openMenu': 'Open navigation menu',
    'aria.closeMenu': 'Close navigation menu',
    'aria.searchQueues': 'Filter queues by name',
    'aria.queueStats': 'Queue statistics',
    'aria.dashboardStats': 'Dashboard statistics',
    'aria.retryJob': 'Retry job {id}',
    'aria.cancelJob': 'Cancel job {id}',
    'aria.retryThis': 'Retry this job',
    'aria.cancelThis': 'Cancel this job',
    'aria.removeSchedule': 'Delete schedule {name}',
    'aria.selectJob': 'Select job {id}',
    'aria.bulkActions': 'Bulk job actions',
    'aria.progressPercent': 'percent complete',
    'aria.pagination': 'Job pages',
    'aria.busy': 'Loading',
  },
}

/** Look up a message. Falls back to English, then to the key itself. */
export function t(key: string, locale = 'en'): string {
  const english = messages['en'] ?? {}
  const catalogue = messages[locale] ?? messages[baseLanguage(locale)] ?? english
  return catalogue[key] ?? english[key] ?? key
}

function baseLanguage(locale: string): string {
  const separator = locale.indexOf('-')
  return separator > 0 ? locale.slice(0, separator) : locale
}

/**
 * Look up a message and substitute `{name}` placeholders.
 * Values are substituted as-is; the caller escapes them for its output context.
 */
export function tf(key: string, values: Record<string, string | number>, locale = 'en'): string {
  return t(key, locale).replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name]
    if (value === undefined) return match
    return typeof value === 'number' ? formatNumber(value, locale) : value
  })
}

/** Format an integer or decimal for the locale (grouping separators included). */
export function formatNumber(value: number, locale = 'en'): string {
  return new Intl.NumberFormat(locale).format(value)
}

/** Format a duration in seconds, choosing the largest sensible unit. */
export function formatSeconds(seconds: number, locale = 'en'): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'long' })
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1],
  ]
  for (const [unit, size] of units) {
    if (seconds >= size && seconds % size === 0) {
      // Drop the "in"/"ago" framing: this is a duration, not a point in time.
      return format
        .formatToParts(seconds / size, unit)
        .filter(part => part.type !== 'literal' || part.value.trim().length > 0)
        .map(part => part.value)
        .join('')
        .replace(/^in\s+/i, '')
        .trim()
    }
  }
  return format.format(seconds, 'second').replace(/^in\s+/i, '').trim()
}

/** Format a count of days for the locale. */
export function formatDays(days: number, locale = 'en'): string {
  return formatSeconds(days * 86_400, locale)
}

/** Format a date without a time component. */
export function formatDate(date: Date, locale = 'en', options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options ?? { dateStyle: 'medium' }).format(date)
}

/** Format a date and time. */
export function formatDateTime(date: Date, locale = 'en', options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options ?? { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** Full precision including the zone, for the title of a relative timestamp. */
export function formatDateTimeExact(date: Date, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'long' }).format(date)
}

/** The name of a job state in the viewer's language. */
export function formatState(state: string, locale = 'en'): string {
  const key = `state.${state}`
  const label = t(key, locale)
  return label === key ? state : label
}
