import type { Queue, Schedule } from '../types.js'
import {
  formatDate, formatDateTime, formatDateTimeExact, formatDays, formatNumber, formatSeconds, t, tf,
} from '../i18n.js'
import { describeCron } from '../cron-describe.js'
import { EMPTY, html, joinHtml, type SafeHtml } from './safe-html.js'
import { UI, STATE_BADGE, STATE_BADGE_DEFAULT } from './ui.js'

/** Query parameter names, so a link and the handler that reads it cannot drift. */
export const PARAM = {
  search: 'search',
  page: 'page',
  confirmDelete: 'confirm',
} as const

export interface RenderContext {
  prefix: string
  locale: string
}

/** daisyUI badge classes for a job state. */
export function stateBadgeClass(state: string): string {
  return STATE_BADGE[state] ?? STATE_BADGE_DEFAULT
}

/** A number rendered for the locale, right-aligned with tabular figures. */
export function numericCell(value: number, locale: string): SafeHtml {
  return html`<td class="${UI.cellNumeric}">${formatNumber(value, locale)}</td>`
}

/** A timestamp with its exact value available on hover and focus. */
export function timestamp(date: Date, locale: string, withTime = true): SafeHtml {
  const shown = withTime ? formatDateTime(date, locale) : formatDate(date, locale)
  return html`<time datetime="${date.toISOString()}" title="${formatDateTimeExact(date, locale)}"
    class="${UI.cellNoWrap}">${shown}</time>`
}

/** The spinner htmx shows while a request from this element is in flight. */
export function indicator(locale: string): SafeHtml {
  return html`<span class="${UI.indicator}" role="status" aria-label="${t('aria.busy', locale)}"></span>`
}

export function emptyRow(colspan: number, message: string): SafeHtml {
  return html`<tr><td colspan="${colspan}" class="${UI.empty}">${message}</td></tr>`
}

/** Build a dashboard URL with the given query parameters, dropping empty ones. */
function urlWith(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query.length > 0 ? `${path}?${query}` : path
}

export interface PageState {
  page: number
  pageSize: number
  total: number
}

/**
 * Pagination.
 *
 * The page is a real link carrying URL state, so the browser's back button, a
 * refresh and a shared link all land on the same rows. The range is stated
 * explicitly rather than silently truncating a longer list.
 */
export function pager(state: PageState, path: string, params: Record<string, string | undefined>, locale: string): SafeHtml {
  const { page, pageSize, total } = state
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return EMPTY
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)

  const link = (target: number, labelKey: string, enabled: boolean): SafeHtml =>
    enabled
      ? html`<a class="${UI.pagerBtn}" href="${urlWith(path, { ...params, [PARAM.page]: target })}"
          rel="${labelKey === 'btn.previous' ? 'prev' : 'next'}">${t(labelKey, locale)}</a>`
      : html`<span class="${UI.pagerBtnDisabled}" aria-disabled="true">${t(labelKey, locale)}</span>`

  return html`<nav class="${UI.pager}" aria-label="${t('aria.pagination', locale)}">
    ${link(page - 1, 'btn.previous', page > 1)}
    <span class="${UI.pagerStatus}" aria-live="polite">${tf('msg.showingRange', { from, to, total }, locale)}</span>
    ${link(page + 1, 'btn.next', page < lastPage)}
  </nav>`
}

// ── Queues ────────────────────────────────────────────────────────

function queueRowHtml(queue: Queue, size: number, context: RenderContext): SafeHtml {
  const { prefix, locale } = context
  return html`<tr>
    <td><a href="${prefix}/queues/${encodeURIComponent(queue.name)}" class="${UI.link}">${queue.name}</a></td>
    <td><span class="${UI.badgeNeutral}">${queue.policy}</span></td>
    ${numericCell(size, locale)}
    ${numericCell(queue.retryLimit, locale)}
    <td>${queue.deadLetter ?? t('empty.none', locale)}</td>
    <td>${timestamp(queue.createdOn, locale, false)}</td>
  </tr>`
}

interface QueuesTableOptions extends RenderContext {
  queues: Array<{ queue: Queue; size: number }>
  search: string
  path: string
}

/**
 * Queue list with a filter.
 *
 * The filter submits as a normal form so its value lives in the URL. The list
 * does not poll: replacing the container on a timer destroys focus and the
 * caret while somebody is still typing in it.
 */
export function queuesTableHtml(options: QueuesTableOptions): SafeHtml {
  const { queues, search, path, prefix, locale } = options
  const emptyMessage = search.length > 0
    ? tf('empty.noQueuesMatch', { search }, locale)
    : t('empty.noQueues', locale)
  const rows = queues.length === 0
    ? emptyRow(6, emptyMessage)
    : joinHtml(queues.map(entry => queueRowHtml(entry.queue, entry.size, { prefix, locale })))

  return html`<form method="get" action="${path}" class="${UI.searchForm}" role="search">
    <input type="search" name="${PARAM.search}" value="${search}" enterkeyhint="search"
      placeholder="${t('field.search', locale)}" class="${UI.searchInput}"
      aria-label="${t('aria.searchQueues', locale)}" autocomplete="off">
    <button type="submit" class="${UI.touchBtnPrimary}">${t('btn.apply', locale)}</button>
    ${search.length > 0
      ? html`<a class="${UI.touchBtnGhost}" href="${path}">${t('btn.clear', locale)}</a>`
      : EMPTY}
  </form>
  <div class="${UI.tableWrap}">
    <table class="${UI.table}">
      <thead><tr>
        <th scope="col">${t('table.name', locale)}</th>
        <th scope="col">${t('table.policy', locale)}</th>
        <th scope="col" class="${UI.cellNumeric}">${t('table.pending', locale)}</th>
        <th scope="col" class="${UI.cellNumeric}">${t('table.retryLimit', locale)}</th>
        <th scope="col">${t('table.deadLetter', locale)}</th>
        <th scope="col">${t('table.created', locale)}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

// ── Schedules ─────────────────────────────────────────────────────

/** Human description of a cron expression, or a clear marker when it will not parse. */
function cronDescription(cron: string, locale: string): string {
  try {
    return describeCron(cron, locale)
  } catch {
    return t('msg.cronInvalid', locale)
  }
}

interface SchedulesTableOptions extends RenderContext {
  schedules: Schedule[]
  includeCreated: boolean
  path: string
  /** Name of the schedule whose inline delete confirmation is open, if any. */
  confirmDelete?: string
}

/**
 * Delete confirmation, inline and addressable.
 *
 * Deleting a schedule cannot be undone, so it is confirmed — but through a real
 * page state rather than `window.confirm`, which is unstyled, untranslatable,
 * and impossible to reach on some assistive setups.
 */
function scheduleDeleteCell(schedule: Schedule, options: SchedulesTableOptions): SafeHtml {
  const { locale, prefix, path, confirmDelete } = options
  if (confirmDelete === schedule.name) {
    return html`<td class="${UI.cellActions}">
      <button type="button" class="${UI.touchBtnError}"
        aria-label="${tf('aria.removeSchedule', { name: schedule.name }, locale)}"
        hx-delete="${prefix}/schedules/${encodeURIComponent(schedule.name)}"
        hx-swap="outerHTML" hx-target="closest tr">${t('btn.delete', locale)}</button>
      <a class="${UI.touchBtnGhost}" href="${path}">${t('btn.cancel', locale)}</a>
    </td>`
  }
  return html`<td>
    <a class="${UI.touchBtn}" href="${urlWith(path, { [PARAM.confirmDelete]: schedule.name })}"
      aria-label="${tf('aria.removeSchedule', { name: schedule.name }, locale)}">${t('btn.delete', locale)}</a>
  </td>`
}

export function schedulesTableHtml(options: SchedulesTableOptions): SafeHtml {
  const { schedules, includeCreated, locale } = options
  const columns = includeCreated ? 5 : 4
  const createdHead = includeCreated
    ? html`<th scope="col">${t('table.created', locale)}</th>`
    : EMPTY

  const rows = schedules.length === 0
    ? emptyRow(columns, t('empty.noSchedules', locale))
    : joinHtml(schedules.map(schedule => html`<tr>
        ${scheduleDeleteCell(schedule, options)}
        <td class="${UI.cellNoWrap}">${schedule.name}</td>
        <td><code class="${UI.code}">${schedule.cron}</code></td>
        <td>${cronDescription(schedule.cron, locale)}</td>
        ${includeCreated ? html`<td>${timestamp(schedule.createdOn, locale)}</td>` : EMPTY}
      </tr>`))

  return html`<div class="${UI.tableWrap}">
    <table class="${UI.table}">
      <thead><tr>
        <th scope="col">${t('table.actions', locale)}</th>
        <th scope="col">${t('table.name', locale)}</th>
        <th scope="col">${t('table.cron', locale)}</th>
        <th scope="col">${t('table.cronDescription', locale)}</th>
        ${createdHead}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

// ── Queue settings ────────────────────────────────────────────────

export function queueSettingsRows(queue: Queue, locale: string): SafeHtml {
  const rows: Array<[string, SafeHtml | string]> = [
    [t('table.policy', locale), queue.policy],
    [t('table.retryLimit', locale), formatNumber(queue.retryLimit, locale)],
    [t('field.retryDelay', locale), formatSeconds(queue.retryDelay, locale)],
    [t('field.retryBackoff', locale), String(queue.retryBackoff)],
    [t('field.retryJitter', locale), String(queue.retryJitter)],
    [t('field.expireIn', locale), formatSeconds(queue.expireIn, locale)],
    [t('field.retentionDays', locale), formatDays(queue.retentionDays, locale)],
    [t('table.deadLetter', locale), queue.deadLetter ?? t('empty.none', locale)],
    [t('field.paused', locale), String(queue.paused)],
  ]
  return joinHtml(rows.map(([label, value]) => html`<tr><th scope="row">${label}</th><td>${value}</td></tr>`))
}

