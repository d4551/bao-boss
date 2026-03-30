import type { BaoBoss } from '../BaoBoss.js'
import { formatDateTime, t } from '../i18n.js'
import { getMetricsSnapshot, getQueueDepths, toPrometheusFormat } from '../Metrics.js'
import { esc, stateBadgeClass, progressBarHtml, emptyRow, queueRowHtml, jobRowHtml } from './html.js'
import { fragmentResponse } from './response.js'

type FullPageFn = (content: string, title: string, csrfToken?: string, status?: number) => Response

function queuesTableHtml(rows: string, prefix: string, locale: string): string {
  return `<table class="table table-zebra" hx-get="${prefix}/queues" hx-trigger="every 5s" hx-swap="outerHTML">
    <thead><tr>
      <th scope="col">${t('table.name', locale)}</th><th scope="col">${t('table.policy', locale)}</th><th scope="col">${t('table.pending', locale)}</th><th scope="col">${t('table.retryLimit', locale)}</th><th scope="col">${t('table.deadLetter', locale)}</th><th scope="col">${t('table.created', locale)}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

export async function dashboardIndex(
  boss: BaoBoss,
  prefix: string,
  locale: string,
  fullPage: FullPageFn,
  csrfToken?: string,
): Promise<Response> {
  const queues = await boss.getQueues()
  const schedules = await boss.getSchedules()

  const queueRows = queues.length === 0
    ? emptyRow(6, t('empty.noQueues', locale))
    : (await Promise.all(queues.map(async q => {
        const size = await boss.getQueueSize(q.name)
        return queueRowHtml(q, prefix, locale, size)
      }))).join('')

  const content = `
    <div hx-get="${prefix}/stats" hx-trigger="load, every 10s" hx-swap="outerHTML"></div>
    <div class="card bg-base-200 shadow-sm mb-6">
      <div class="card-body">
        <h2 class="card-title text-lg font-semibold mb-4">${t('section.queues', locale)}</h2>
        <div class="overflow-x-auto">
          ${queuesTableHtml(queueRows, prefix, locale)}
        </div>
      </div>
    </div>
    <div class="card bg-base-200 shadow-sm mb-6">
      <div class="card-body">
        <h2 class="card-title text-lg font-semibold mb-4">${t('section.schedules', locale)} (${schedules.length})</h2>
        ${schedules.length === 0 ? `<p class="text-center p-8 text-base-content/70">${t('empty.noSchedules', locale)}</p>` : `
        <div class="overflow-x-auto">
          <table class="table table-zebra">
            <thead><tr><th scope="col">${t('table.name', locale)}</th><th scope="col">${t('table.cron', locale)}</th><th scope="col">${t('table.timezone', locale)}</th><th scope="col">${t('table.actions', locale)}</th></tr></thead>
            <tbody>${schedules.map(s => `
              <tr>
                <td>${esc(s.name)}</td>
                <td><code>${esc(s.cron)}</code></td>
                <td>${esc(s.timezone)}</td>
                <td>
                  <button class="btn btn-error btn-sm" type="button"
                aria-label="${t('aria.removeSchedule', locale)} ${esc(s.name)}"
                hx-delete="${prefix}/schedules/${encodeURIComponent(s.name)}"
                hx-confirm="${t('confirm.removeSchedule', locale).replace('{name}', esc(s.name))}"
                hx-swap="outerHTML"
                hx-target="closest tr">${t('btn.delete', locale)}</button>
            </td>
          </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    </div>
  `
  return fullPage(content, t('title.dashboard', locale), csrfToken)
}

export async function queuesFragment(
  boss: BaoBoss,
  prefix: string,
  locale: string,
): Promise<Response> {
  const queues = await boss.getQueues()
  const rows = await Promise.all(queues.map(async q => {
    const size = await boss.getQueueSize(q.name)
    return queueRowHtml(q, prefix, locale, size)
  }))
  return fragmentResponse(queuesTableHtml(
    rows.length === 0 ? emptyRow(6, t('empty.noQueuesShort', locale)) : rows.join(''),
    prefix, locale
  ))
}

export async function queueDetail(
  boss: BaoBoss,
  prefix: string,
  locale: string,
  name: string,
  fullPage: FullPageFn,
  csrfToken?: string,
): Promise<Response> {
  const queue = await boss.getQueue(name)
  if (!queue) {
    return fullPage(`<p>${t('msg.queueNotFound', locale)}</p>`, `${t('section.queue', locale)}: ${esc(name)}`, csrfToken, 404)
  }

  const [created, active, completed, failed, cancelled, dlqDepth] = await Promise.all([
    boss.getQueueSize(name, { before: 'active' }),
    boss.prisma.job.count({ where: { queue: name, state: 'active' } }),
    boss.prisma.job.count({ where: { queue: name, state: 'completed' } }),
    boss.prisma.job.count({ where: { queue: name, state: 'failed' } }),
    boss.prisma.job.count({ where: { queue: name, state: 'cancelled' } }),
    queue.deadLetter ? boss.getDLQDepth(queue.deadLetter) : Promise.resolve(0),
  ])

  const { jobs } = await boss.searchJobs({
    queue: name,
    limit: 50,
    sortBy: 'createdOn',
    sortOrder: 'desc',
  })

  const content = `
    <h2 class="text-xl font-semibold mb-4">${t('section.queue', locale)}: ${esc(name)}</h2>
    <div class="stats stats-vertical lg:stats-horizontal shadow mb-6" role="region" aria-label="${t('aria.queueStats', locale)}">
      <div class="stat"><div class="stat-value text-primary">${created}</div><div class="stat-title">${t('stat.created', locale)}</div></div>
      <div class="stat"><div class="stat-value text-primary">${active}</div><div class="stat-title">${t('stat.active', locale)}</div></div>
      <div class="stat"><div class="stat-value text-primary">${completed}</div><div class="stat-title">${t('stat.completed', locale)}</div></div>
      <div class="stat"><div class="stat-value text-primary">${failed}</div><div class="stat-title">${t('stat.failed', locale)}</div></div>
      <div class="stat"><div class="stat-value text-primary">${cancelled}</div><div class="stat-title">${t('stat.cancelled', locale)}</div></div>
      ${queue.deadLetter ? `<div class="stat${dlqDepth > 0 ? ' border-error' : ''}"><div class="stat-value text-primary">${dlqDepth}</div><div class="stat-title">${t('stat.dlq', locale)}</div></div>` : ''}
    </div>
    <div class="card bg-base-200 shadow-sm mb-6">
      <div class="card-body">
        <h3 class="card-title text-base font-semibold mb-4">${t('section.queueSettings', locale)}</h3>
        <div class="overflow-x-auto">
          <table class="table table-zebra">
            <thead><tr><th scope="col">${t('table.setting', locale)}</th><th scope="col">${t('table.value', locale)}</th></tr></thead>
        <tbody>
          <tr><td>${t('table.policy', locale)}</td><td>${esc(String(queue.policy))}</td></tr>
          <tr><td>${t('table.retryLimit', locale)}</td><td>${queue.retryLimit}</td></tr>
          <tr><td>${t('field.retryDelay', locale)}</td><td>${queue.retryDelay}${t('unit.seconds', locale)}</td></tr>
          <tr><td>${t('field.retryBackoff', locale)}</td><td>${queue.retryBackoff}</td></tr>
          <tr><td>${t('field.expireIn', locale)}</td><td>${queue.expireIn}${t('unit.seconds', locale)}</td></tr>
          <tr><td>${t('field.retentionDays', locale)}</td><td>${queue.retentionDays}</td></tr>
          <tr><td>${t('table.deadLetter', locale)}</td><td>${queue.deadLetter ? esc(queue.deadLetter) : t('empty.none', locale)}</td></tr>
        </tbody>
      </table>
        </div>
      </div>
    </div>
    <div class="card bg-base-200 shadow-sm mb-6">
      <div class="card-body">
        <h3 class="card-title text-base font-semibold mb-4">${t('section.recentJobs', locale)}</h3>
        <div class="overflow-x-auto">
          <table class="table table-zebra">
            <thead><tr><th scope="col">${t('table.id', locale)}</th><th scope="col">${t('table.state', locale)}</th><th scope="col">${t('table.priority', locale)}</th><th scope="col">${t('table.created', locale)}</th><th scope="col">${t('table.actions', locale)}</th></tr></thead>
            <tbody>
          ${jobs.map(j => jobRowHtml(j, prefix, locale)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
  return fullPage(content, `${t('section.queue', locale)}: ${name}`, csrfToken)
}

export async function jobDetail(
  boss: BaoBoss,
  prefix: string,
  locale: string,
  id: string,
  fullPage: FullPageFn,
  csrfToken?: string,
): Promise<Response> {
  const job = await boss.getJobById(id)
  if (!job) {
    return fullPage(`<p>${t('msg.jobNotFound', locale)}</p>`, t('msg.jobNotFound', locale), csrfToken, 404)
  }
  const badgeClass = stateBadgeClass(job.state)
  const terminalStates = ['completed', 'failed', 'cancelled']
  const content = `
    <h2 class="text-xl font-semibold mb-4">${t('section.job', locale)}: ${job.id}</h2>
    <div class="card bg-base-200 shadow-sm">
      <div class="card-body grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h3 class="font-semibold mb-2">${t('section.details', locale)}</h3>
          <div class="overflow-x-auto">
            <table class="table table-zebra table-sm">
            <tbody>
              <tr><td>${t('field.queue', locale)}</td><td><a href="${prefix}/queues/${encodeURIComponent(job.queue)}" class="link link-primary">${esc(job.queue)}</a></td></tr>
              <tr><td>${t('table.state', locale)}</td><td><span class="badge ${badgeClass}">${job.state}</span></td></tr>
              <tr><td>${t('table.priority', locale)}</td><td>${job.priority}</td></tr>
              <tr><td>${t('field.retryCount', locale)}</td><td>${job.retryCount} / ${job.retryLimit}</td></tr>
              ${job.progress != null ? (() => {
  const bar = progressBarHtml(job.progress, locale);
  const useSse = !terminalStates.includes(job.state);
  return `<tr><td>${t('field.progress', locale)}</td><td>${useSse ? `<div hx-ext="sse" sse-connect="${prefix}/sse/progress/${job.id}?locale=${encodeURIComponent(locale)}" sse-swap="progress" hx-swap="innerHTML">${bar}</div>` : bar}</td></tr>`;
})() : ''}
              <tr><td>${t('stat.created', locale)}</td><td>${formatDateTime(new Date(job.createdOn), locale)}</td></tr>
              <tr><td>${t('field.startAfter', locale)}</td><td>${formatDateTime(new Date(job.startAfter), locale)}</td></tr>
              <tr><td>${t('field.startedOn', locale)}</td><td>${job.startedOn ? formatDateTime(new Date(job.startedOn), locale) : t('empty.none', locale)}</td></tr>
              <tr><td>${t('field.completedOn', locale)}</td><td>${job.completedOn ? formatDateTime(new Date(job.completedOn), locale) : t('empty.none', locale)}</td></tr>
              <tr><td>${t('field.keepUntil', locale)}</td><td>${formatDateTime(new Date(job.keepUntil), locale)}</td></tr>
            </tbody>
          </table>
          </div>
        </div>
        <div>
          <h3 class="font-semibold mb-2">${t('section.data', locale)}</h3>
          <pre class="bg-base-300 p-4 rounded overflow-x-auto text-sm">${esc(JSON.stringify(job.data, null, 2))}</pre>
          ${job.output ? `<h3 class="font-semibold mt-4 mb-2">${t('section.output', locale)}</h3><pre class="bg-base-300 p-4 rounded overflow-x-auto text-sm">${esc(JSON.stringify(job.output, null, 2))}</pre>` : ''}
        </div>
      </div>
      <div class="card-actions mt-4">
          ${job.state === 'failed' || job.state === 'cancelled' ? `
          <button class="btn btn-primary mr-2" type="button"
            aria-label="${t('aria.retryThis', locale)}"
            hx-post="${prefix}/jobs/${job.id}/retry"
            hx-confirm="${t('confirm.retryThis', locale)}"
            hx-swap="innerHTML" hx-target="body">${t('btn.retry', locale)}</button>
        ` : ''}
        ${job.state !== 'completed' && job.state !== 'cancelled' ? `
          <button class="btn btn-error" type="button"
            aria-label="${t('aria.cancelThis', locale)}"
            hx-delete="${prefix}/jobs/${job.id}"
            hx-confirm="${t('confirm.cancelThis', locale)}"
            hx-swap="innerHTML" hx-target="body">${t('btn.cancel', locale)}</button>
        ` : ''}
      </div>
    </div>
  `
  return fullPage(content, `${t('section.job', locale)}: ${job.id}`, csrfToken)
}

export async function retryJob(
  boss: BaoBoss,
  locale: string,
  id: string,
): Promise<Response> {
  await boss.resume(id)
  return fragmentResponse(`<tr><td colspan="5" class="text-success">${t('msg.jobQueuedRetry', locale)}</td></tr>`)
}

export async function cancelJob(
  boss: BaoBoss,
  locale: string,
  id: string,
): Promise<Response> {
  await boss.cancel(id)
  return fragmentResponse(`<tr><td colspan="5" class="text-base-content/70">${t('msg.jobCancelled', locale)}</td></tr>`)
}

export async function schedulesPage(
  boss: BaoBoss,
  prefix: string,
  locale: string,
  fullPage: FullPageFn,
  csrfToken?: string,
): Promise<Response> {
  const schedules = await boss.getSchedules()
  const content = `
    <h2 class="text-xl font-semibold mb-4">${t('section.schedules', locale)}</h2>
    <div class="card bg-base-200 shadow-sm">
      <div class="card-body">
        <div class="overflow-x-auto">
          <table class="table table-zebra">
            <thead><tr><th scope="col">${t('table.name', locale)}</th><th scope="col">${t('table.cron', locale)}</th><th scope="col">${t('table.timezone', locale)}</th><th scope="col">${t('table.created', locale)}</th><th scope="col">${t('table.actions', locale)}</th></tr></thead>
            <tbody>
          ${schedules.length === 0
            ? emptyRow(5, t('empty.noSchedules', locale))
            : schedules.map(s => `<tr>
                <td>${esc(s.name)}</td>
                <td><code>${esc(s.cron)}</code></td>
                <td>${esc(s.timezone)}</td>
                <td>${formatDateTime(new Date(s.createdOn), locale)}</td>
                <td>
                  <button class="btn btn-error btn-sm" type="button"
                    aria-label="${t('aria.removeSchedule', locale)} ${esc(s.name)}"
                    hx-delete="${prefix}/schedules/${encodeURIComponent(s.name)}"
                    hx-confirm="${t('confirm.removeSchedule', locale).replace('{name}', esc(s.name))}"
                    hx-swap="outerHTML" hx-target="closest tr">${t('btn.delete', locale)}</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
  return fullPage(content, t('section.schedules', locale), csrfToken)
}

export async function deleteSchedule(
  boss: BaoBoss,
  name: string,
): Promise<Response> {
  await boss.unschedule(name)
  return fragmentResponse('')
}

export async function metricsEndpoint(boss: BaoBoss): Promise<Response> {
  const snapshot = getMetricsSnapshot()
  snapshot.queueDepth = await getQueueDepths(boss.prisma)
  return new Response(toPrometheusFormat(snapshot), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export async function statsFragment(
  boss: BaoBoss,
  prefix: string,
  locale: string,
): Promise<Response> {
  const queues = await boss.getQueues()
  const [totalJobs, activeJobs, failedJobs, completedJobs] = await Promise.all([
    boss.prisma.job.count(),
    boss.prisma.job.count({ where: { state: 'active' } }),
    boss.prisma.job.count({ where: { state: 'failed' } }),
    boss.prisma.job.count({ where: { state: 'completed' } }),
  ])

  return fragmentResponse(`
    <div class="stats stats-vertical lg:stats-horizontal shadow mb-6" role="region" aria-label="${t('aria.dashboardStats', locale)}" hx-get="${prefix}/stats" hx-trigger="every 10s" hx-swap="outerHTML">
      <div class="stat"><div class="stat-value text-primary">${queues.length}</div><div class="stat-title">${t('stat.queues', locale)}</div></div>
      <div class="stat"><div class="stat-value text-primary">${totalJobs}</div><div class="stat-title">${t('stat.totalJobs', locale)}</div></div>
      <div class="stat"><div class="stat-value text-primary">${activeJobs}</div><div class="stat-title">${t('stat.active', locale)}</div></div>
      <div class="stat"><div class="stat-value text-primary">${completedJobs}</div><div class="stat-title">${t('stat.completed', locale)}</div></div>
      <div class="stat"><div class="stat-value text-primary">${failedJobs}</div><div class="stat-title">${t('stat.failed', locale)}</div></div>
    </div>
  `)
}
