import type { Job } from '../types.js'
import { formatNumber, formatState, t, tf } from '../i18n.js'
import { EMPTY, html, joinHtml, type SafeHtml } from './safe-html.js'
import {
  emptyRow, indicator, numericCell, pager, stateBadgeClass, timestamp,
  type PageState, type RenderContext,
} from './html.js'
import { UI } from './ui.js'

/** Form holding the bulk selection, and the element bulk results are swapped into. */
const BULK_FORM_ID = 'bao-bulk-jobs'
const BULK_RESULT_ID = 'bao-bulk-result'

/** Job states from which an action is offered. */
const RETRYABLE = new Set(['failed', 'cancelled'])
const CANCELLABLE = new Set(['created', 'active'])

export function progressBarHtml(progress: number | null, locale: string): SafeHtml {
  const value = progress ?? 0
  return html`<progress class="${UI.progress}" value="${value}" max="100"
    aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100"
    aria-valuetext="${formatNumber(value, locale)} ${t('aria.progressPercent', locale)}"></progress>`
}

/**
 * Row actions.
 *
 * Retry and cancel are both reversible, so neither interrupts with a
 * confirmation: the action runs and the result offers the inverse as undo.
 * Confirmation is reserved for what cannot be taken back.
 */
function jobActions(job: Job, context: RenderContext): SafeHtml {
  const { prefix, locale } = context
  const shortId = job.id.slice(0, 8)
  const retry = RETRYABLE.has(job.state)
    ? html`<button type="button" class="${UI.touchBtnPrimary}"
        aria-label="${tf('aria.retryJob', { id: shortId }, locale)}"
        hx-post="${prefix}/jobs/${job.id}/retry"
        hx-swap="outerHTML" hx-target="closest tr">${t('btn.retry', locale)}${indicator(locale)}</button>`
    : EMPTY
  const cancel = CANCELLABLE.has(job.state)
    ? html`<button type="button" class="${UI.touchBtnError}"
        aria-label="${tf('aria.cancelJob', { id: shortId }, locale)}"
        hx-delete="${prefix}/jobs/${job.id}"
        hx-swap="outerHTML" hx-target="closest tr">${t('btn.cancel', locale)}${indicator(locale)}</button>`
    : EMPTY
  return html`<td class="${UI.cellActions}">${retry}${cancel}</td>`
}

function jobRowHtml(job: Job, context: RenderContext): SafeHtml {
  const { prefix, locale } = context
  const shortId = job.id.slice(0, 8)
  const selectable = job.state !== 'completed'
  return html`<tr>
    <td>${selectable
      ? html`<input type="checkbox" class="${UI.checkbox}" name="ids" value="${job.id}"
          aria-label="${tf('aria.selectJob', { id: shortId }, locale)}">`
      : EMPTY}</td>
    <td><a href="${prefix}/jobs/${job.id}" class="${UI.linkId}">${shortId}</a></td>
    <td><span class="${stateBadgeClass(job.state)}">${formatState(job.state, locale)}</span></td>
    ${numericCell(job.priority, locale)}
    <td>${timestamp(job.createdOn, locale)}</td>
    ${jobActions(job, context)}
  </tr>`
}

interface JobsTableOptions extends RenderContext {
  jobs: Job[]
  page: PageState
  path: string
  params: Record<string, string | undefined>
}

/**
 * Job list.
 *
 * Selection lives in a form so bulk actions post real ids; the page, filter and
 * range live in the URL so the list survives a refresh and the back button.
 */
export function jobsTableHtml(options: JobsTableOptions): SafeHtml {
  const { jobs, page, path, params, prefix, locale } = options
  const emptyMessage = page.total > 0 ? t('empty.noJobsMatch', locale) : t('empty.noJobs', locale)
  const rows = jobs.length === 0
    ? emptyRow(6, emptyMessage)
    : joinHtml(jobs.map(job => jobRowHtml(job, { prefix, locale })))

  return html`<form id="${BULK_FORM_ID}" class="${UI.form}">
    <div class="${UI.bulkBar}" role="group" aria-label="${t('aria.bulkActions', locale)}">
      <button type="button" class="${UI.touchBtnPrimary}"
        hx-post="${prefix}/jobs/bulk/retry" hx-include="#${BULK_FORM_ID}"
        hx-target="#${BULK_RESULT_ID}" hx-swap="innerHTML">${t('btn.bulkRetry', locale)}${indicator(locale)}</button>
      <button type="button" class="${UI.touchBtnError}"
        hx-post="${prefix}/jobs/bulk/cancel" hx-include="#${BULK_FORM_ID}"
        hx-target="#${BULK_RESULT_ID}" hx-swap="innerHTML">${t('btn.bulkCancel', locale)}${indicator(locale)}</button>
      <span id="${BULK_RESULT_ID}" class="${UI.liveRegion}" role="status" aria-live="polite"></span>
    </div>
    <div class="${UI.tableWrap}">
      <table class="${UI.table}">
        <thead><tr>
          <th scope="col"><span class="${UI.srOnly}">${t('table.select', locale)}</span></th>
          <th scope="col">${t('table.id', locale)}</th>
          <th scope="col">${t('table.state', locale)}</th>
          <th scope="col" class="${UI.cellNumeric}">${t('table.priority', locale)}</th>
          <th scope="col">${t('table.created', locale)}</th>
          <th scope="col">${t('table.actions', locale)}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${pager(page, path, params, locale)}
  </form>`
}

/**
 * Result of an action, with its inverse offered as undo.
 *
 * An action that can be taken back should be taken back from where it happened,
 * not prevented by a dialog before it happens.
 */
export function undoableResult(options: {
  message: string
  undoMethod: 'post' | 'delete'
  undoUrl: string
  undoTarget: string
  locale: string
  badgeClass: string
}): SafeHtml {
  const { message, undoMethod, undoUrl, undoTarget, locale, badgeClass } = options
  const request = undoMethod === 'post'
    ? html`hx-post="${undoUrl}" hx-swap="outerHTML" hx-target="${undoTarget}"`
    : html`hx-delete="${undoUrl}" hx-swap="outerHTML" hx-target="${undoTarget}"`
  return html`<span class="${UI.liveRegion}">
    <span class="${badgeClass}">${message}</span>
    <button type="button" class="${UI.touchBtnGhost}" ${request}>${t('btn.undo', locale)}${indicator(locale)}</button>
  </span>`
}

/** A single-cell row replacing a job row after an action, carrying the undo control. */
export function jobRowResult(body: SafeHtml): SafeHtml {
  return html`<tr><td colspan="6">${body}</td></tr>`
}

export function jobDetailRows(job: Job, context: RenderContext, progressCell: SafeHtml): SafeHtml {
  const { prefix, locale } = context
  const optionalTime = (date: Date | null): SafeHtml =>
    date ? timestamp(date, locale) : html`${t('empty.none', locale)}`

  const rows: Array<[string, SafeHtml]> = [
    [t('field.queue', locale),
      html`<a href="${prefix}/queues/${encodeURIComponent(job.queue)}" class="${UI.link}">${job.queue}</a>`],
    [t('table.state', locale),
      html`<span class="${stateBadgeClass(job.state)}">${formatState(job.state, locale)}</span>`],
    [t('table.priority', locale), html`${formatNumber(job.priority, locale)}`],
    [t('field.retryCount', locale),
      html`${formatNumber(job.retryCount, locale)} / ${formatNumber(job.retryLimit, locale)}`],
    [t('stat.created', locale), timestamp(job.createdOn, locale)],
    [t('field.startAfter', locale), timestamp(job.startAfter, locale)],
    [t('field.startedOn', locale), optionalTime(job.startedOn)],
    [t('field.completedOn', locale), optionalTime(job.completedOn)],
    [t('field.keepUntil', locale), timestamp(job.keepUntil, locale)],
  ]

  return html`${joinHtml(rows.map(([label, value]) =>
    html`<tr><th scope="row">${label}</th><td>${value}</td></tr>`))}${progressCell}`
}

export { BULK_FORM_ID, BULK_RESULT_ID }
