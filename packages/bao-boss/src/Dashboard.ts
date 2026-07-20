import { Elysia } from 'elysia'
import type { BaoBoss } from './BaoBoss.js'
import type { BetterAuthSessionApi } from './types.js'
export type { BetterAuthSessionApi }
import { serveAsset } from './dashboard/assets.js'
import { decodeBulkIds, emptyBulkResponse, invalidBulkResponse } from './dashboard/bulk.js'
import { createAuthMiddleware, createCsrfMiddleware, createRateLimitMiddleware } from './dashboard/middleware.js'
import { htmlResponse } from './dashboard/response.js'
import {
  dashboardIndex, queuesFragment, queuesPage, queueDetail, jobDetail,
  retryJob, cancelJob, bulkRetryJobs, bulkCancelJobs, schedulesPage,
  statsPage, deleteSchedule, metricsEndpoint, statsFragment,
} from './dashboard/routes.js'
import { shell } from './dashboard/shell.js'
import { sseProgress } from './dashboard/sse.js'

interface DashboardOptions {
  prefix?: string
  auth?: string
  dashboardAuth?: {
    type: 'bearer'
    token: string
  } | {
    type: 'better-auth'
    auth: BetterAuthSessionApi
  }
  csrf?: boolean
  rateLimit?: { windowMs: number; max: number }
  lang?: string
  locale?: string
}

function isHtmx(request: Request): boolean {
  return request.headers.get('HX-Request') === 'true'
}

function applyDashboardGuards(
  app: Elysia,
  options: DashboardOptions,
  locale: string,
): void {
  const dashboardAuth = options.dashboardAuth
  const authToken = dashboardAuth?.type === 'bearer' ? dashboardAuth.token : options.auth
  if (dashboardAuth?.type === 'better-auth') {
    app.onBeforeHandle({ as: 'global' }, createAuthMiddleware(dashboardAuth, locale))
  } else if (authToken) {
    app.onBeforeHandle({ as: 'global' }, createAuthMiddleware({ type: 'bearer', token: authToken }, locale))
  }
  const csrfEnabled = options.csrf ?? !!(authToken || dashboardAuth)
  if (csrfEnabled) {
    app.onBeforeHandle({ as: 'global' }, createCsrfMiddleware(locale))
  }
  if (options.rateLimit) {
    app.onBeforeHandle({ as: 'global' }, createRateLimitMiddleware(options.rateLimit, locale))
  }
}

function registerDashboardRoutes(
  app: Elysia,
  boss: BaoBoss,
  prefix: string,
  locale: string,
  lang: string,
  csrfEnabled: boolean,
): void {
  const getCsrf = () => (csrfEnabled ? crypto.randomUUID() : undefined)
  const fullPage = (content: string, title: string, csrfToken?: string, status = 200) =>
    htmlResponse(shell(prefix, content, title, csrfToken, lang, locale), csrfToken, status)

  app.get('/assets/:name', ({ params }) => serveAsset(params.name))
  app.get('/', () => dashboardIndex(boss, prefix, locale, fullPage, getCsrf()))
  app.get('/queues', ({ request, query }) => {
    const search = query.search ? String(query.search) : undefined
    if (isHtmx(request)) return queuesFragment(boss, prefix, locale, search)
    return queuesPage(boss, prefix, locale, fullPage, getCsrf(), search)
  })
  app.get('/queues/:name', ({ params }) => queueDetail(boss, prefix, locale, params.name, fullPage, getCsrf()))
  app.get('/jobs/:id', ({ params }) => jobDetail(boss, prefix, locale, params.id, fullPage, getCsrf()))
  app.post('/jobs/:id/retry', ({ params, query }) => retryJob(boss, locale, params.id, query.ctx === 'detail' ? 'detail' : 'list'))
  app.delete('/jobs/:id', ({ params, query }) => cancelJob(boss, locale, params.id, query.ctx === 'detail' ? 'detail' : 'list'))
  app.post('/jobs/bulk/retry', async ({ body }) => {
    const parsed = decodeBulkIds(body)
    if (!parsed.ok) return invalidBulkResponse(locale)
    if (parsed.ids.length === 0) return emptyBulkResponse(locale)
    return bulkRetryJobs(boss, locale, parsed.ids)
  })
  app.post('/jobs/bulk/cancel', async ({ body }) => {
    const parsed = decodeBulkIds(body)
    if (!parsed.ok) return invalidBulkResponse(locale)
    if (parsed.ids.length === 0) return emptyBulkResponse(locale)
    return bulkCancelJobs(boss, locale, parsed.ids)
  })
  app.get('/schedules', () => schedulesPage(boss, prefix, locale, fullPage, getCsrf()))
  app.delete('/schedules/:name', ({ params }) => deleteSchedule(boss, params.name))
  app.get('/sse/progress/:id', ({ params, query }) => sseProgress(boss, prefix, locale, params.id, String(query.locale ?? '')))
  app.get('/metrics', () => metricsEndpoint(boss))
  app.get('/stats', ({ request }) => {
    if (isHtmx(request)) return statsFragment(boss, prefix, locale)
    return statsPage(boss, prefix, locale, fullPage, getCsrf())
  })
}

export function baoBossDashboard(boss: BaoBoss, options: DashboardOptions = {}) {
  const prefix = options.prefix ?? '/boss'
  const locale = options.locale ?? options.lang ?? 'en'
  const lang = options.lang ?? 'en'
  const dashboardAuth = options.dashboardAuth
  const authToken = dashboardAuth?.type === 'bearer' ? dashboardAuth.token : options.auth
  const csrfEnabled = options.csrf ?? !!(authToken || dashboardAuth)
  const app = new Elysia({ prefix })
  applyDashboardGuards(app, options, locale)
  registerDashboardRoutes(app, boss, prefix, locale, lang, csrfEnabled)
  return app
}
