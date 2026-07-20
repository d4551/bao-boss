import type { Job, Queue, Schedule } from '../types.js'
import { formatDate, formatDateTime, t } from '../i18n.js'
import { UI } from './ui.js'

export function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function stateBadgeClass(state: string): string {
  switch (state) {
    case 'created': return 'badge-info'
    case 'active': return 'badge-warning'
    case 'completed': return 'badge-success'
    case 'failed': return 'badge-error'
    default: return 'badge-ghost'
  }
}

export function progressBarHtml(progress: number | null, locale: string): string {
  const val = progress ?? 0
  return `<progress class="progress progress-primary w-full max-w-xs" value="${val}" max="100" role="progressbar" aria-valuenow="${val}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${val} ${t('aria.progressPercent', locale)}"></progress>`
}

export function emptyRow(colspan: number, message: string): string {
  return `<tr><td colspan="${colspan}" class="${UI.empty}">${message}</td></tr>`
}

export function queueRowHtml(queue: Queue, prefix: string, locale: string, size: number): string {
  return `<tr>
    <td><a href="${prefix}/queues/${encodeURIComponent(queue.name)}" class="link link-primary">${esc(queue.name)}</a></td>
    <td><span class="badge badge-ghost">${esc(queue.policy)}</span></td>
    <td>${size}</td>
    <td>${queue.retryLimit}</td>
    <td>${queue.deadLetter ? esc(queue.deadLetter) : t('empty.none', locale)}</td>
    <td>${formatDate(new Date(queue.createdOn), locale)}</td>
  </tr>`
}

export function queuesTableHtml(rows: string, prefix: string, locale: string, search?: string): string {
  const searchVal = search ? esc(search) : ''
  return `<div class="${UI.tableWrap}">
    <input type="search" name="search" value="${searchVal}" placeholder="${t('field.search', locale)}"
      class="${UI.searchInput}"
      aria-label="${t('aria.searchQueues', locale)}"
      hx-get="${prefix}/queues" hx-trigger="input changed delay:300ms, search" hx-target="closest div" hx-swap="outerHTML" />
    <table class="${UI.table}" hx-get="${prefix}/queues" hx-trigger="every 5s" hx-swap="outerHTML" hx-target="closest div" hx-include="[name='search']">
      <thead><tr>
        <th scope="col">${t('table.name', locale)}</th><th scope="col">${t('table.policy', locale)}</th><th scope="col">${t('table.pending', locale)}</th><th scope="col">${t('table.retryLimit', locale)}</th><th scope="col">${t('table.deadLetter', locale)}</th><th scope="col">${t('table.created', locale)}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

export function scheduleRowHtml(schedule: Schedule, prefix: string, locale: string, includeCreated: boolean): string {
  const created = includeCreated
    ? `<td>${formatDateTime(new Date(schedule.createdOn), locale)}</td>`
    : ''
  const trashIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-7 0h8"/></svg>`
  return `<tr>
    <td>
      <button class="${UI.touchBtnErrorSquare}" type="button"
        aria-label="${t('aria.removeSchedule', locale)} ${esc(schedule.name)}"
        title="${t('btn.delete', locale)}"
        hx-delete="${prefix}/schedules/${encodeURIComponent(schedule.name)}"
        hx-confirm="${t('confirm.removeSchedule', locale).replace('{name}', esc(schedule.name))}"
        hx-swap="outerHTML" hx-target="closest tr">${trashIcon}</button>
    </td>
    <td class="whitespace-nowrap">${esc(schedule.name)}</td>
    <td><code class="whitespace-nowrap text-xs">${esc(schedule.cron)}</code></td>
    <td class="whitespace-nowrap">${esc(schedule.timezone)}</td>
    ${created}
  </tr>`
}

export function schedulesTableHtml(
  schedules: Schedule[],
  prefix: string,
  locale: string,
  opts: { includeCreated: boolean },
): string {
  const cols = opts.includeCreated ? 5 : 4
  if (schedules.length === 0) {
    return `<div class="${UI.tableWrap}"><table class="${UI.table}"><tbody>${emptyRow(cols, t('empty.noSchedules', locale))}</tbody></table></div>`
  }
  const createdHead = opts.includeCreated ? `<th scope="col">${t('table.created', locale)}</th>` : ''
  const rows = schedules.map(s => scheduleRowHtml(s, prefix, locale, opts.includeCreated)).join('')
  return `<div class="${UI.tableWrap}">
    <table class="${UI.table}">
      <thead><tr>
        <th scope="col">${t('table.actions', locale)}</th>
        <th scope="col">${t('table.name', locale)}</th>
        <th scope="col">${t('table.cron', locale)}</th>
        <th scope="col">${t('table.timezone', locale)}</th>
        ${createdHead}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

export function jobRowHtml(job: Job, prefix: string, locale: string): string {
  const badgeClass = stateBadgeClass(job.state)
  const shortId = job.id.slice(0, 8)
  const checkbox = job.state !== 'completed'
    ? `<input type="checkbox" class="${UI.checkbox}" name="ids" value="${job.id}" aria-label="${t('aria.selectJob', locale)} ${shortId}" />`
    : ''
  const retry = job.state === 'failed' || job.state === 'cancelled'
    ? `<button class="${UI.touchBtnPrimary}" type="button"
          aria-label="${t('aria.retryJob', locale)} ${shortId}"
          hx-post="${prefix}/jobs/${job.id}/retry"
          hx-confirm="${t('confirm.retryJob', locale).replace('{id}', shortId)}"
          hx-swap="outerHTML" hx-target="closest tr">${t('btn.retry', locale)}</button>`
    : ''
  const cancel = job.state !== 'completed' && job.state !== 'cancelled'
    ? `<button class="${UI.touchBtnError}" type="button"
          aria-label="${t('aria.cancelJob', locale)} ${shortId}"
          hx-delete="${prefix}/jobs/${job.id}"
          hx-confirm="${t('confirm.cancelJob', locale).replace('{id}', shortId)}"
          hx-swap="outerHTML" hx-target="closest tr">${t('btn.cancel', locale)}</button>`
    : ''
  return `<tr>
    <td>${checkbox}</td>
    <td><a href="${prefix}/jobs/${job.id}" class="link link-primary">${shortId}…</a></td>
    <td><span class="badge ${badgeClass}">${job.state}</span></td>
    <td>${job.priority}</td>
    <td>${formatDateTime(new Date(job.createdOn), locale)}</td>
    <td class="flex flex-wrap gap-2">${retry}${cancel}</td>
  </tr>`
}

export function jobsTableHtml(jobs: Job[], prefix: string, locale: string): string {
  const rows = jobs.length === 0
    ? emptyRow(6, t('empty.noJobs', locale))
    : jobs.map(j => jobRowHtml(j, prefix, locale)).join('')
  return `<form id="bulk-jobs" class="space-y-2">
    <div class="${UI.bulkBar}" role="group" aria-label="${t('aria.bulkActions', locale)}">
      <label class="label cursor-pointer gap-2 min-h-11">
        <input type="checkbox" class="${UI.checkbox}" aria-label="${t('btn.selectAll', locale)}"
          onchange="this.form.querySelectorAll('input[name=ids]').forEach(c=>c.checked=this.checked)" />
        <span class="label-text">${t('btn.selectAll', locale)}</span>
      </label>
      <button type="button" class="${UI.touchBtnPrimary}"
        aria-label="${t('btn.bulkRetry', locale)}"
        hx-post="${prefix}/jobs/bulk/retry"
        hx-include="#bulk-jobs"
        hx-confirm="${t('confirm.bulkRetry', locale)}"
        hx-target="#bulk-result" hx-swap="innerHTML">${t('btn.bulkRetry', locale)}</button>
      <button type="button" class="${UI.touchBtnError}"
        aria-label="${t('btn.bulkCancel', locale)}"
        hx-post="${prefix}/jobs/bulk/cancel"
        hx-include="#bulk-jobs"
        hx-confirm="${t('confirm.bulkCancel', locale)}"
        hx-target="#bulk-result" hx-swap="innerHTML">${t('btn.bulkCancel', locale)}</button>
      <span id="bulk-result" aria-live="polite"></span>
    </div>
    <div class="${UI.tableWrap}">
      <table class="${UI.table}">
        <thead><tr>
          <th scope="col">${t('table.select', locale)}</th>
          <th scope="col">${t('table.id', locale)}</th>
          <th scope="col">${t('table.state', locale)}</th>
          <th scope="col">${t('table.priority', locale)}</th>
          <th scope="col">${t('table.created', locale)}</th>
          <th scope="col">${t('table.actions', locale)}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </form>`
}

export function queueSettingsRows(queue: Queue, locale: string): string {
  return `
    <tr><td>${t('table.policy', locale)}</td><td>${esc(String(queue.policy))}</td></tr>
    <tr><td>${t('table.retryLimit', locale)}</td><td>${queue.retryLimit}</td></tr>
    <tr><td>${t('field.retryDelay', locale)}</td><td>${queue.retryDelay}${t('unit.seconds', locale)}</td></tr>
    <tr><td>${t('field.retryBackoff', locale)}</td><td>${queue.retryBackoff}</td></tr>
    <tr><td>${t('field.expireIn', locale)}</td><td>${queue.expireIn}${t('unit.seconds', locale)}</td></tr>
    <tr><td>${t('field.retentionDays', locale)}</td><td>${queue.retentionDays}</td></tr>
    <tr><td>${t('table.deadLetter', locale)}</td><td>${queue.deadLetter ? esc(queue.deadLetter) : t('empty.none', locale)}</td></tr>`
}

export function jobDetailFieldsHtml(
  job: Job,
  prefix: string,
  locale: string,
  progressCell: string,
): string {
  return `
    <tr><td>${t('field.queue', locale)}</td><td><a href="${prefix}/queues/${encodeURIComponent(job.queue)}" class="link link-primary">${esc(job.queue)}</a></td></tr>
    <tr><td>${t('table.state', locale)}</td><td><span class="badge ${stateBadgeClass(job.state)}">${job.state}</span></td></tr>
    <tr><td>${t('table.priority', locale)}</td><td>${job.priority}</td></tr>
    <tr><td>${t('field.retryCount', locale)}</td><td>${job.retryCount} / ${job.retryLimit}</td></tr>
    ${progressCell}
    <tr><td>${t('stat.created', locale)}</td><td>${formatDateTime(new Date(job.createdOn), locale)}</td></tr>
    <tr><td>${t('field.startAfter', locale)}</td><td>${formatDateTime(new Date(job.startAfter), locale)}</td></tr>
    <tr><td>${t('field.startedOn', locale)}</td><td>${job.startedOn ? formatDateTime(new Date(job.startedOn), locale) : t('empty.none', locale)}</td></tr>
    <tr><td>${t('field.completedOn', locale)}</td><td>${job.completedOn ? formatDateTime(new Date(job.completedOn), locale) : t('empty.none', locale)}</td></tr>
    <tr><td>${t('field.keepUntil', locale)}</td><td>${formatDateTime(new Date(job.keepUntil), locale)}</td></tr>`
}
