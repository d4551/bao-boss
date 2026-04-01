import type { Job, Queue } from '../types.js'
import { formatDate, formatDateTime, t } from '../i18n.js'

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
  return `<progress class="progress progress-primary w-48" value="${val}" max="100" role="progressbar" aria-valuenow="${val}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${val} ${t('aria.progressPercent', locale)}"></progress>`
}

export function emptyRow(colspan: number, message: string): string {
  return `<tr><td colspan="${colspan}" class="text-center p-8 text-base-content/70">${message}</td></tr>`
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
  return `<div>
    <input type="search" name="search" value="${searchVal}" placeholder="${t('field.search', locale)}"
      class="input input-bordered input-sm mb-4 w-full max-w-xs"
      aria-label="${t('aria.searchQueues', locale)}"
      hx-get="${prefix}/queues" hx-trigger="input changed delay:300ms, search" hx-target="closest div" hx-swap="outerHTML" />
    <table class="table table-zebra" hx-get="${prefix}/queues" hx-trigger="every 5s" hx-swap="outerHTML" hx-target="closest div" hx-include="[name='search']">
      <thead><tr>
        <th scope="col">${t('table.name', locale)}</th><th scope="col">${t('table.policy', locale)}</th><th scope="col">${t('table.pending', locale)}</th><th scope="col">${t('table.retryLimit', locale)}</th><th scope="col">${t('table.deadLetter', locale)}</th><th scope="col">${t('table.created', locale)}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

export function jobRowHtml(job: Job, prefix: string, locale: string): string {
  const badgeClass = stateBadgeClass(job.state)
  const shortId = job.id.slice(0, 8)
  return `<tr>
    <td><a href="${prefix}/jobs/${job.id}" class="link link-primary">${shortId}…</a></td>
    <td><span class="badge ${badgeClass}">${job.state}</span></td>
    <td>${job.priority}</td>
    <td>${formatDateTime(new Date(job.createdOn), locale)}</td>
    <td>
      ${job.state === 'failed' || job.state === 'cancelled' ? `
        <button class="btn btn-primary btn-sm mr-1" type="button"
          aria-label="${t('aria.retryJob', locale)} ${shortId}"
          hx-post="${prefix}/jobs/${job.id}/retry"
          hx-confirm="${t('confirm.retryJob', locale).replace('{id}', shortId)}"
          hx-swap="outerHTML" hx-target="closest tr">${t('btn.retry', locale)}</button>
      ` : ''}
      ${job.state !== 'completed' && job.state !== 'cancelled' ? `
        <button class="btn btn-error btn-sm" type="button"
          aria-label="${t('aria.cancelJob', locale)} ${shortId}"
          hx-delete="${prefix}/jobs/${job.id}"
          hx-confirm="${t('confirm.cancelJob', locale).replace('{id}', shortId)}"
          hx-swap="outerHTML" hx-target="closest tr">${t('btn.cancel', locale)}</button>
      ` : ''}
    </td>
  </tr>`
}
