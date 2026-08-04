import type { BaoBoss } from '../BaoBoss.js'
import type { Job, Queue } from '../types.js'
import { formatNumber, t, tf } from '../i18n.js'
import { getQueueDepths, toPrometheusFormat } from '../Metrics.js'
import { EMPTY, html, joinHtml, type SafeHtml } from './safe-html.js'
import {
  queueSettingsRows, queuesTableHtml, schedulesTableHtml, type PageState,
} from './html.js'
import {
  jobDetailRows, jobRowResult, jobsTableHtml, progressBarHtml, undoableResult,
} from './html-jobs.js'
import { fragmentResponse } from './response.js'
import { UI } from './ui.js'

/** Jobs listed per page on a queue detail view. */
const JOBS_PER_PAGE = 25

type FullPageFn = (content: SafeHtml, title: string, status?: number) => Response

export interface RouteContext {
  boss: BaoBoss
  prefix: string
  locale: string
  /** Path of the current request, so links and forms round-trip to it. */
  path: string
  fullPage: FullPageFn
}

function readPage(value: string | undefined): number {
  const page = Number.parseInt(value ?? '1', 10)
  return Number.isFinite(page) && page > 0 ? page : 1
}

/** Queues with their pending counts, filtered by name, in two queries total. */
async function listQueues(boss: BaoBoss, search: string): Promise<Array<{ queue: Queue; size: number }>> {
  const all = await boss.getQueues()
  const term = search.trim().toLowerCase()
  const matching = term.length > 0
    ? all.filter(queue => queue.name.toLowerCase().includes(term))
    : all
  const sizes = await boss.getQueueSizes(matching.map(queue => queue.name))
  return matching.map(queue => ({ queue, size: sizes.get(queue.name) ?? 0 }))
}

export async function queuesPage(context: RouteContext, search: string): Promise<Response> {
  const { boss, prefix, locale, path, fullPage } = context
  const queues = await listQueues(boss, search)
  const content = html`
    <h1 class="${UI.pageTitle}">${t('section.queues', locale)}</h1>
    <section class="${UI.card}"><div class="${UI.cardBody}">
      ${queuesTableHtml({ queues, search, path, prefix, locale })}
    </div></section>`
  return fullPage(content, t('title.queues', locale))
}

export async function dashboardIndex(context: RouteContext): Promise<Response> {
  const { boss, prefix, locale, fullPage } = context
  const [queues, schedules, stats] = await Promise.all([
    listQueues(boss, ''),
    boss.getSchedules(),
    collectStats(boss),
  ])
  const content = html`
    <h1 class="${UI.pageTitle}">${t('title.dashboard', locale)}</h1>
    <div hx-ext="sse" sse-connect="${prefix}/sse/live">
      <div id="${LIVE_STATS_ID}" sse-swap="stats" hx-swap="innerHTML">${statsHtml(stats, locale)}</div>
      <section class="${UI.card}"><div class="${UI.cardBody}">
        <h2 class="${UI.cardTitle}">${t('section.queues', locale)}</h2>
        <div id="${LIVE_QUEUES_ID}" sse-swap="queues" hx-swap="innerHTML">
          ${queuesTableHtml({ queues, search: '', path: `${prefix}/queues`, prefix, locale })}
        </div>
      </section></div>
    </div>
    <section class="${UI.card}"><div class="${UI.cardBody}">
      <h2 class="${UI.cardTitle}">${t('section.schedules', locale)}</h2>
      ${schedulesTableHtml({
        schedules, includeCreated: false, prefix, locale, path: `${prefix}/schedules`,
      })}
      <p class="${UI.hint}">
        <a class="${UI.linkQuiet}" href="${prefix}/metrics">${t('link.metricsScrape', locale)}</a>
      </p>
    </div></section>`
  return fullPage(content, t('title.dashboard', locale))
}

// ── Statistics ────────────────────────────────────────────────────

interface StatEntry {
  labelKey: string
  value: number
  alert?: boolean
}

async function collectStats(boss: BaoBoss): Promise<StatEntry[]> {
  const [queues, total, active, completed, failed] = await Promise.all([
    boss.getQueues(),
    boss.prisma.job.count(),
    boss.prisma.job.count({ where: { state: 'active' } }),
    boss.prisma.job.count({ where: { state: 'completed' } }),
    boss.prisma.job.count({ where: { state: 'failed' } }),
  ])
  return [
    { labelKey: 'stat.queues', value: queues.length },
    { labelKey: 'stat.totalJobs', value: total },
    { labelKey: 'stat.active', value: active },
    { labelKey: 'stat.completed', value: completed },
    { labelKey: 'stat.failed', value: failed, alert: failed > 0 },
  ]
}

const LIVE_STATS_ID = 'bao-live-stats'
const LIVE_QUEUES_ID = 'bao-live-queues'

function statsHtml(entries: StatEntry[], locale: string, labelKey = 'aria.dashboardStats'): SafeHtml {
  return html`<section class="${UI.stats}" aria-label="${t(labelKey, locale)}">
    ${joinHtml(entries.map(entry => html`<div class="${entry.alert ? UI.statAlert : UI.stat}">
      <div class="${UI.statValue}">${formatNumber(entry.value, locale)}</div>
      <div class="${UI.statTitle}">${t(entry.labelKey, locale)}</div>
    </div>`))}
  </section>`
}

export async function statsPage(context: RouteContext): Promise<Response> {
  const { boss, prefix, locale, fullPage } = context
  const stats = await collectStats(boss)
  const content = html`
    <h1 class="${UI.pageTitle}">${t('section.stats', locale)}</h1>
    <div hx-ext="sse" sse-connect="${prefix}/sse/live">
      <div id="${LIVE_STATS_ID}" sse-swap="stats" hx-swap="innerHTML">${statsHtml(stats, locale)}</div>
    </div>
    <p class="${UI.hint}">
      <a class="${UI.linkQuiet}" href="${prefix}/metrics">${t('link.metricsScrape', locale)}</a>
    </p>`
  return fullPage(content, t('title.stats', locale))
}

// ── Queue detail ──────────────────────────────────────────────────

async function queueStats(boss: BaoBoss, queue: Queue): Promise<StatEntry[]> {
  const counts = await Promise.all([
    boss.getQueueSize(queue.name, { before: 'active' }),
    boss.prisma.job.count({ where: { queue: queue.name, state: 'active' } }),
    boss.prisma.job.count({ where: { queue: queue.name, state: 'completed' } }),
    boss.prisma.job.count({ where: { queue: queue.name, state: 'failed' } }),
    boss.prisma.job.count({ where: { queue: queue.name, state: 'cancelled' } }),
    queue.deadLetter ? boss.getDLQDepth(queue.deadLetter) : Promise.resolve(0),
  ])
  const [created, active, completed, failed, cancelled, dlq] = counts
  const entries: StatEntry[] = [
    { labelKey: 'stat.created', value: created },
    { labelKey: 'stat.active', value: active },
    { labelKey: 'stat.completed', value: completed },
    { labelKey: 'stat.failed', value: failed, alert: failed > 0 },
    { labelKey: 'stat.cancelled', value: cancelled },
  ]
  if (queue.deadLetter) entries.push({ labelKey: 'stat.dlq', value: dlq, alert: dlq > 0 })
  return entries
}

export async function queueDetail(context: RouteContext, name: string, pageParam?: string): Promise<Response> {
  const { boss, prefix, locale, path, fullPage } = context
  const queue = await boss.getQueue(name)
  if (!queue) {
    return fullPage(
      html`<h1 class="${UI.pageTitle}">${t('msg.queueNotFound', locale)}</h1>
        <p><a class="${UI.link}" href="${prefix}/queues">${t('nav.queues', locale)}</a></p>`,
      t('title.notFound', locale),
      404,
    )
  }
  const page = readPage(pageParam)
  const [stats, results] = await Promise.all([
    queueStats(boss, queue),
    boss.searchJobs({
      queue: name,
      limit: JOBS_PER_PAGE,
      offset: (page - 1) * JOBS_PER_PAGE,
      sortBy: 'createdOn',
      sortOrder: 'desc',
    }),
  ])
  const pageState: PageState = { page, pageSize: JOBS_PER_PAGE, total: results.total }

  const content = html`
    <h1 class="${UI.pageTitle}">${t('section.queue', locale)}: ${queue.name}</h1>
    ${statsHtml(stats, locale, 'aria.queueStats')}
    <section class="${UI.card}"><div class="${UI.cardBody}">
      <h2 class="${UI.cardTitleSm}">${t('section.queueSettings', locale)}</h2>
      <div class="${UI.tableWrap}"><table class="${UI.table}">
        <thead><tr>
          <th scope="col">${t('table.setting', locale)}</th>
          <th scope="col">${t('table.value', locale)}</th>
        </tr></thead>
        <tbody>${queueSettingsRows(queue, locale)}</tbody>
      </table></div>
    </div></section>
    <section class="${UI.card}"><div class="${UI.cardBody}">
      <h2 class="${UI.cardTitleSm}">${t('section.recentJobs', locale)}</h2>
      ${jobsTableHtml({ jobs: results.jobs, page: pageState, path, params: {}, prefix, locale })}
    </div></section>`
  return fullPage(content, tf('title.queue', { name: queue.name }, locale))
}

// ── Job detail ────────────────────────────────────────────────────

function progressCell(job: Job, prefix: string, locale: string): SafeHtml {
  if (job.progress === null) return EMPTY
  const bar = progressBarHtml(job.progress, locale)
  const live = job.state === 'active'
    ? html`<div hx-ext="sse" sse-connect="${prefix}/sse/progress/${job.id}"
        sse-swap="progress" hx-swap="innerHTML">${bar}</div>`
    : bar
  return html`<tr><th scope="row">${t('field.progress', locale)}</th><td>${live}</td></tr>`
}

export async function jobDetail(context: RouteContext, id: string): Promise<Response> {
  const { boss, prefix, locale, fullPage } = context
  const job = await boss.getJobById(id)
  if (!job) {
    return fullPage(
      html`<h1 class="${UI.pageTitle}">${t('msg.jobNotFound', locale)}</h1>
        <p><a class="${UI.link}" href="${prefix}/queues">${t('nav.queues', locale)}</a></p>`,
      t('title.notFound', locale),
      404,
    )
  }
  const output = job.output !== null && job.output !== undefined
    ? html`<h3 class="${UI.subSectionTitle}">${t('section.output', locale)}</h3>
        <pre class="${UI.pre}">${JSON.stringify(job.output, null, 2)}</pre>`
    : EMPTY

  const content = html`
    <h1 class="${UI.pageTitle}"><span class="${UI.cellId}">${t('section.job', locale)}: ${job.id}</span></h1>
    <section class="${UI.card}"><div class="${UI.cardBodySplit}">
      <div>
        <h2 class="${UI.sectionTitle}">${t('section.details', locale)}</h2>
        <div class="${UI.tableWrap}"><table class="${UI.tableSm}"><tbody>
          ${jobDetailRows(job, { prefix, locale }, progressCell(job, prefix, locale))}
        </tbody></table></div>
      </div>
      <div>
        <h2 class="${UI.sectionTitle}">${t('section.data', locale)}</h2>
        <pre class="${UI.pre}">${JSON.stringify(job.data, null, 2)}</pre>
        ${output}
      </div>
    </div></section>`
  return fullPage(content, tf('title.job', { id: job.id }, locale))
}

// ── Mutations ─────────────────────────────────────────────────────

export async function retryJob(context: RouteContext, id: string): Promise<Response> {
  const { boss, prefix, locale } = context
  await boss.resume(id)
  return fragmentResponse(jobRowResult(undoableResult({
    message: t('msg.jobQueuedRetry', locale),
    undoMethod: 'delete',
    undoUrl: `${prefix}/jobs/${id}`,
    undoTarget: 'closest tr',
    badgeClass: UI.badgeOk,
    locale,
  })))
}

export async function cancelJob(context: RouteContext, id: string): Promise<Response> {
  const { boss, prefix, locale } = context
  await boss.cancel(id)
  return fragmentResponse(jobRowResult(undoableResult({
    message: t('msg.jobCancelled', locale),
    undoMethod: 'post',
    undoUrl: `${prefix}/jobs/${id}/retry`,
    undoTarget: 'closest tr',
    badgeClass: UI.badgeNeutral,
    locale,
  })))
}

/** Hidden inputs that let the undo control re-send exactly the ids just acted on. */
function idFields(ids: string[]): SafeHtml {
  return joinHtml(ids.map(id => html`<input type="hidden" name="ids" value="${id}">`))
}

async function bulkResult(
  context: RouteContext,
  ids: string[],
  messageKey: string,
  undoPath: string,
  badgeClass: string,
): Promise<Response> {
  const { prefix, locale } = context
  return fragmentResponse(html`<span class="${UI.liveRegion}">
    <span class="${badgeClass}">${tf(messageKey, { count: ids.length }, locale)}</span>
    <form class="${UI.transparentWrapper}" hx-post="${prefix}${undoPath}" hx-target="closest span" hx-swap="outerHTML">
      ${idFields(ids)}
      <button type="submit" class="${UI.touchBtnGhost}">${t('btn.undo', locale)}</button>
    </form>
  </span>`)
}

export async function bulkRetryJobs(context: RouteContext, ids: string[]): Promise<Response> {
  await context.boss.resume(ids)
  return bulkResult(context, ids, 'msg.bulkRetryDone', '/jobs/bulk/cancel', UI.badgeOk)
}

export async function bulkCancelJobs(context: RouteContext, ids: string[]): Promise<Response> {
  await context.boss.cancel(ids)
  return bulkResult(context, ids, 'msg.bulkCancelDone', '/jobs/bulk/retry', UI.badgeNeutral)
}

export async function deleteSchedule(context: RouteContext, name: string): Promise<Response> {
  await context.boss.unschedule(name)
  return fragmentResponse(EMPTY)
}

// ── Schedules and metrics ─────────────────────────────────────────

export async function schedulesPage(context: RouteContext, confirmDelete?: string): Promise<Response> {
  const { boss, prefix, locale, path, fullPage } = context
  const schedules = await boss.getSchedules()
  const content = html`
    <h1 class="${UI.pageTitle}">${t('section.schedules', locale)}</h1>
    <section class="${UI.card}"><div class="${UI.cardBody}">
      ${schedulesTableHtml({ schedules, includeCreated: true, prefix, locale, path, confirmDelete })}
    </div></section>`
  return fullPage(content, t('title.schedules', locale))
}

/** The stats block as the live stream sends it. */
export async function renderLiveStats(boss: BaoBoss, locale: string): Promise<string> {
  return String(statsHtml(await collectStats(boss), locale))
}

/** The queue table as the live stream sends it. */
export async function renderLiveQueues(
  boss: BaoBoss, prefix: string, locale: string, search: string,
): Promise<string> {
  const queues = await listQueues(boss, search)
  return String(queuesTableHtml({ queues, search, path: `${prefix}/queues`, prefix, locale }))
}

export async function metricsEndpoint(boss: BaoBoss): Promise<Response> {
  const snapshot = boss.metrics.snapshot()
  snapshot.queueDepth = await getQueueDepths(boss.prisma)
  return new Response(toPrometheusFormat(snapshot), {
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
  })
}

