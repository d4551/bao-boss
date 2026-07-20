import type { BaoBoss } from '../BaoBoss.js'
import { t } from '../i18n.js'
import { getMetricsSnapshot, getQueueDepths, toPrometheusFormat } from '../Metrics.js'
import {
  esc, progressBarHtml, emptyRow, queueRowHtml, queuesTableHtml,
  schedulesTableHtml, jobsTableHtml, queueSettingsRows, jobDetailFieldsHtml,
} from './html.js'
import { fragmentResponse } from './response.js'
import { UI } from './ui.js'

type FullPageFn = (content: string, title: string, csrfToken?: string, status?: number) => Response

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
    <div class="${UI.card}"><div class="${UI.cardBody}">
      <h2 class="${UI.cardTitle}">${t('section.queues', locale)}</h2>
      ${queuesTableHtml(queueRows, prefix, locale)}
    </div></div>
    <div class="${UI.card}"><div class="${UI.cardBody}">
      <h2 class="${UI.cardTitle}">${t('section.schedules', locale)} (${schedules.length})</h2>
      ${schedulesTableHtml(schedules, prefix, locale, { includeCreated: false })}
      <p class="${UI.metricsHint}"><a class="link link-hover" href="${prefix}/metrics">${t('link.metricsScrape', locale)}</a></p>
    </div></div>`
  return fullPage(content, t('title.dashboard', locale), csrfToken)
}

export async function queuesFragment(
  boss: BaoBoss,
  prefix: string,
  locale: string,
  search?: string,
): Promise<Response> {
  let queues = await boss.getQueues()
  if (search) {
    const term = search.toLowerCase()
    queues = queues.filter(q => q.name.toLowerCase().includes(term))
  }
  const rows = await Promise.all(queues.map(async q => {
    const size = await boss.getQueueSize(q.name)
    return queueRowHtml(q, prefix, locale, size)
  }))
  return fragmentResponse(queuesTableHtml(
    rows.length === 0 ? emptyRow(6, t('empty.noQueuesShort', locale)) : rows.join(''),
    prefix, locale, search,
  ))
}

export async function queuesPage(
  boss: BaoBoss,
  prefix: string,
  locale: string,
  fullPage: FullPageFn,
  csrfToken?: string,
  search?: string,
): Promise<Response> {
  let queues = await boss.getQueues()
  if (search) {
    const term = search.toLowerCase()
    queues = queues.filter(q => q.name.toLowerCase().includes(term))
  }
  const rows = await Promise.all(queues.map(async q => {
    const size = await boss.getQueueSize(q.name)
    return queueRowHtml(q, prefix, locale, size)
  }))
  const table = queuesTableHtml(
    rows.length === 0 ? emptyRow(6, t('empty.noQueuesShort', locale)) : rows.join(''),
    prefix, locale, search,
  )
  const content = `
    <h1 class="${UI.pageTitle}">${t('section.queues', locale)}</h1>
    <div class="${UI.card}"><div class="${UI.cardBody}">${table}</div></div>`
  return fullPage(content, t('title.queues', locale), csrfToken)
}

async function queueStatCounts(boss: BaoBoss, name: string, deadLetter: string | null) {
  const [created, active, completed, failed, cancelled, dlqDepth] = await Promise.all([
    boss.getQueueSize(name, { before: 'active' }),
    boss.prisma.job.count({ where: { queue: name, state: 'active' } }),
    boss.prisma.job.count({ where: { queue: name, state: 'completed' } }),
    boss.prisma.job.count({ where: { queue: name, state: 'failed' } }),
    boss.prisma.job.count({ where: { queue: name, state: 'cancelled' } }),
    deadLetter ? boss.getDLQDepth(deadLetter) : Promise.resolve(0),
  ])
  return { created, active, completed, failed, cancelled, dlqDepth }
}

function queueStatsHtml(
  counts: Awaited<ReturnType<typeof queueStatCounts>>,
  deadLetter: string | null,
  locale: string,
): string {
  const dlq = deadLetter
    ? `<div class="stat${counts.dlqDepth > 0 ? ' border-error' : ''}"><div class="stat-value text-primary">${counts.dlqDepth}</div><div class="stat-title">${t('stat.dlq', locale)}</div></div>`
    : ''
  return `<div class="${UI.stats}" role="region" aria-label="${t('aria.queueStats', locale)}">
    <div class="stat"><div class="stat-value text-primary">${counts.created}</div><div class="stat-title">${t('stat.created', locale)}</div></div>
    <div class="stat"><div class="stat-value text-primary">${counts.active}</div><div class="stat-title">${t('stat.active', locale)}</div></div>
    <div class="stat"><div class="stat-value text-primary">${counts.completed}</div><div class="stat-title">${t('stat.completed', locale)}</div></div>
    <div class="stat"><div class="stat-value text-primary">${counts.failed}</div><div class="stat-title">${t('stat.failed', locale)}</div></div>
    <div class="stat"><div class="stat-value text-primary">${counts.cancelled}</div><div class="stat-title">${t('stat.cancelled', locale)}</div></div>
    ${dlq}
  </div>`
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
  const counts = await queueStatCounts(boss, name, queue.deadLetter)
  const { jobs } = await boss.searchJobs({ queue: name, limit: 50, sortBy: 'createdOn', sortOrder: 'desc' })
  const content = `
    <h1 class="${UI.pageTitle}">${t('section.queue', locale)}: ${esc(name)}</h1>
    ${queueStatsHtml(counts, queue.deadLetter, locale)}
    <div class="${UI.card}"><div class="${UI.cardBody}">
      <h2 class="${UI.cardTitleSm}">${t('section.queueSettings', locale)}</h2>
      <div class="${UI.tableWrap}"><table class="${UI.table}">
        <thead><tr><th scope="col">${t('table.setting', locale)}</th><th scope="col">${t('table.value', locale)}</th></tr></thead>
        <tbody>${queueSettingsRows(queue, locale)}</tbody>
      </table></div>
    </div></div>
    <div class="${UI.card}"><div class="${UI.cardBody}">
      <h2 class="${UI.cardTitleSm}">${t('section.recentJobs', locale)}</h2>
      ${jobsTableHtml(jobs, prefix, locale)}
    </div></div>`
  return fullPage(content, `${t('section.queue', locale)}: ${name}`, csrfToken)
}

function jobProgressCell(job: { id: string; state: string; progress: number | null }, prefix: string, locale: string): string {
  if (job.progress == null) return ''
  const bar = progressBarHtml(job.progress, locale)
  const terminal = ['completed', 'failed', 'cancelled'].includes(job.state)
  const body = terminal
    ? bar
    : `<div hx-ext="sse" sse-connect="${prefix}/sse/progress/${job.id}?locale=${encodeURIComponent(locale)}" sse-swap="progress" hx-swap="innerHTML">${bar}</div>`
  return `<tr><td>${t('field.progress', locale)}</td><td>${body}</td></tr>`
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
  const retryBtn = job.state === 'failed' || job.state === 'cancelled'
    ? `<button class="${UI.touchBtnPrimary}" type="button" aria-label="${t('aria.retryThis', locale)}"
        hx-post="${prefix}/jobs/${job.id}/retry?ctx=detail" hx-confirm="${t('confirm.retryThis', locale)}"
        hx-swap="innerHTML" hx-target="closest .card-actions">${t('btn.retry', locale)}</button>`
    : ''
  const cancelBtn = job.state !== 'completed' && job.state !== 'cancelled'
    ? `<button class="${UI.touchBtnError}" type="button" aria-label="${t('aria.cancelThis', locale)}"
        hx-delete="${prefix}/jobs/${job.id}?ctx=detail" hx-confirm="${t('confirm.cancelThis', locale)}"
        hx-swap="innerHTML" hx-target="closest .card-actions">${t('btn.cancel', locale)}</button>`
    : ''
  const output = job.output
    ? `<h3 class="font-semibold mt-4 mb-2">${t('section.output', locale)}</h3><pre class="${UI.pre}">${esc(JSON.stringify(job.output, null, 2))}</pre>`
    : ''
  const content = `
    <h1 class="${UI.pageTitle}">${t('section.job', locale)}: ${job.id}</h1>
    <div class="${UI.card}"><div class="${UI.cardBody} grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <h2 class="font-semibold mb-2">${t('section.details', locale)}</h2>
        <div class="${UI.tableWrap}"><table class="${UI.tableSm}"><tbody>
          ${jobDetailFieldsHtml(job, prefix, locale, jobProgressCell(job, prefix, locale))}
        </tbody></table></div>
      </div>
      <div>
        <h2 class="font-semibold mb-2">${t('section.data', locale)}</h2>
        <pre class="${UI.pre}">${esc(JSON.stringify(job.data, null, 2))}</pre>
        ${output}
      </div>
      <div class="card-actions mt-4 md:col-span-2 flex flex-wrap gap-2">${retryBtn}${cancelBtn}</div>
    </div></div>`
  return fullPage(content, `${t('section.job', locale)}: ${job.id}`, csrfToken)
}

export async function retryJob(
  boss: BaoBoss,
  locale: string,
  id: string,
  context: 'list' | 'detail' = 'list',
): Promise<Response> {
  await boss.resume(id)
  if (context === 'detail') {
    return fragmentResponse(`<span class="badge badge-success">${t('msg.jobQueuedRetry', locale)}</span>`)
  }
  return fragmentResponse(`<tr><td colspan="6" class="text-success">${t('msg.jobQueuedRetry', locale)}</td></tr>`)
}

export async function cancelJob(
  boss: BaoBoss,
  locale: string,
  id: string,
  context: 'list' | 'detail' = 'list',
): Promise<Response> {
  await boss.cancel(id)
  if (context === 'detail') {
    return fragmentResponse(`<span class="badge badge-ghost">${t('msg.jobCancelled', locale)}</span>`)
  }
  return fragmentResponse(`<tr><td colspan="6" class="text-base-content/70">${t('msg.jobCancelled', locale)}</td></tr>`)
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
    <h1 class="${UI.pageTitle}">${t('section.schedules', locale)}</h1>
    <div class="${UI.card}"><div class="${UI.cardBody}">
      ${schedulesTableHtml(schedules, prefix, locale, { includeCreated: true })}
    </div></div>`
  return fullPage(content, t('section.schedules', locale), csrfToken)
}

export async function statsPage(
  boss: BaoBoss,
  prefix: string,
  locale: string,
  fullPage: FullPageFn,
  csrfToken?: string,
): Promise<Response> {
  const frag = await statsFragment(boss, prefix, locale)
  const statsHtml = await frag.text()
  const content = `
    <h1 class="${UI.pageTitle}">${t('section.stats', locale)}</h1>
    ${statsHtml}
    <p class="${UI.metricsHint}"><a class="link link-hover" href="${prefix}/metrics">${t('link.metricsScrape', locale)}</a></p>`
  return fullPage(content, t('title.stats', locale), csrfToken)
}

export async function bulkRetryJobs(boss: BaoBoss, locale: string, ids: string[]): Promise<Response> {
  await boss.resume(ids)
  return fragmentResponse(`<span class="badge badge-success">${t('msg.bulkRetryDone', locale)}</span>`)
}

export async function bulkCancelJobs(boss: BaoBoss, locale: string, ids: string[]): Promise<Response> {
  await boss.cancel(ids)
  return fragmentResponse(`<span class="badge badge-ghost">${t('msg.bulkCancelDone', locale)}</span>`)
}

export async function deleteSchedule(boss: BaoBoss, name: string): Promise<Response> {
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
    <div class="${UI.stats}" role="region" aria-label="${t('aria.dashboardStats', locale)}" hx-get="${prefix}/stats" hx-trigger="every 10s" hx-swap="outerHTML">
      <div class="stat"><div class="stat-value text-primary">${queues.length}</div><div class="stat-title">${t('stat.queues', locale)}</div></div>
      <div class="stat"><div class="stat-value text-primary">${totalJobs}</div><div class="stat-title">${t('stat.totalJobs', locale)}</div></div>
      <div class="stat"><div class="stat-value text-primary">${activeJobs}</div><div class="stat-title">${t('stat.active', locale)}</div></div>
      <div class="stat"><div class="stat-value text-primary">${completedJobs}</div><div class="stat-title">${t('stat.completed', locale)}</div></div>
      <div class="stat"><div class="stat-value text-primary">${failedJobs}</div><div class="stat-title">${t('stat.failed', locale)}</div></div>
    </div>`)
}
