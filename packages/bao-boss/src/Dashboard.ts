import { Elysia } from 'elysia'
import type { BaoBoss } from './BaoBoss.js'
import type { BetterAuthSessionApi } from './types.js'
export type { BetterAuthSessionApi }
import { serveAsset } from './dashboard/assets.js'
import { decodeBulkIds, emptyBulkResponse, invalidBulkResponse } from './dashboard/bulk.js'
import { PARAM } from './dashboard/html.js'
import {
  createAuthMiddleware, createCsrfMiddleware, createRateLimitMiddleware,
  type DashboardAuth, type RateLimitOptions,
} from './dashboard/middleware.js'
import { htmlResponse, isSecureRequest } from './dashboard/response.js'
import {
  dashboardIndex, queuesPage, queueDetail, jobDetail, retryJob, cancelJob,
  bulkRetryJobs, bulkCancelJobs, schedulesPage, statsPage, deleteSchedule,
  metricsEndpoint, type RouteContext,
} from './dashboard/routes.js'
import { shell } from './dashboard/shell.js'
import { sseProgress } from './dashboard/sse.js'
import { sseLive } from './dashboard/sse-live.js'
import { isTheme, resolveTheme, THEME_PARAM, type Theme } from './dashboard/theme.js'

export interface DashboardOptions {
  prefix?: string
  /** Shorthand for `dashboardAuth: { type: 'bearer', token }`. */
  auth?: string
  dashboardAuth?: DashboardAuth
  csrf?: boolean
  rateLimit?: RateLimitOptions
  lang?: string
  locale?: string
  /**
   * Trust `X-Forwarded-*` from the proxy in front of this app.
   * Enable only when such a proxy exists and strips client-supplied copies.
   */
  trustProxy?: boolean
}

interface ResolvedDashboard {
  prefix: string
  lang: string
  locale: string
  csrfEnabled: boolean
  trustProxy: boolean
  auth: DashboardAuth | null
  rateLimit: RateLimitOptions | null
}

function resolve(options: DashboardOptions): ResolvedDashboard {
  const bearer = options.dashboardAuth ?? (options.auth ? { type: 'bearer' as const, token: options.auth } : null)
  const lang = options.lang ?? 'en'
  return {
    prefix: options.prefix ?? '/boss',
    lang,
    locale: options.locale ?? lang,
    csrfEnabled: options.csrf ?? bearer !== null,
    trustProxy: options.trustProxy ?? false,
    auth: bearer,
    rateLimit: options.rateLimit ?? null,
  }
}

/** One CSRF token per process lifetime, issued to every page and never rotated
 *  mid-session — rotating it invalidated the token any other open tab was holding. */
function createCsrfToken(): string {
  return crypto.randomUUID()
}

interface RequestView {
  path: string
  query: string
  theme: Theme
  chosenTheme: Theme | undefined
}

/** Everything the shell needs to know about the incoming request. */
function readRequest(request: Request): RequestView {
  const url = new URL(request.url)
  const chosen = url.searchParams.get(THEME_PARAM)
  const chosenTheme = isTheme(chosen) ? chosen : undefined
  url.searchParams.delete(THEME_PARAM)
  return {
    path: url.pathname,
    query: url.searchParams.toString(),
    theme: chosenTheme ?? resolveTheme(request),
    chosenTheme,
  }
}

/**
 * Order matters: the rate limiter runs before authentication so a wrong token
 * is itself rate limited. Limiting only authenticated traffic leaves the token
 * open to unlimited guessing.
 */
function applyGuards(app: Elysia<string>, config: ResolvedDashboard): void {
  if (config.rateLimit) {
    app.onBeforeHandle(
      { as: 'global' },
      createRateLimitMiddleware({ ...config.rateLimit, trustProxy: config.trustProxy }, config.locale),
    )
  }
  if (config.auth) {
    app.onBeforeHandle({ as: 'global' }, createAuthMiddleware(config.auth, config.locale))
  }
  if (config.csrfEnabled) {
    app.onBeforeHandle({ as: 'global' }, createCsrfMiddleware(config.locale))
  }
}

function registerRoutes(app: Elysia<string>, boss: BaoBoss, config: ResolvedDashboard, csrfToken: string): void {
  const { prefix, locale, lang } = config

  const contextFor = (request: Request): RouteContext => {
    const view = readRequest(request)
    return {
      boss,
      prefix,
      locale,
      path: view.path,
      fullPage: (content, title, status = 200) => htmlResponse(
        shell({ prefix, content, title, csrfToken: config.csrfEnabled ? csrfToken : undefined, lang, locale, theme: view.theme, path: view.path, query: view.query }),
        {
          csrfToken: config.csrfEnabled ? csrfToken : undefined,
          setTheme: view.chosenTheme,
          prefix,
          secure: isSecureRequest(request, config.trustProxy),
        },
        status,
      ),
    }
  }

  const param = (query: Record<string, string | undefined>, name: string): string | undefined => {
    const value = query[name]
    return value === undefined ? undefined : String(value)
  }

  app.get('/assets/:name', ({ params, request }) => serveAsset(params.name, request, locale))
  app.get('/', ({ request }) => dashboardIndex(contextFor(request)))
  app.get('/queues', ({ request, query }) => queuesPage(contextFor(request), param(query, PARAM.search) ?? ''))
  app.get('/queues/:name', ({ request, params, query }) =>
    queueDetail(contextFor(request), params.name, param(query, PARAM.page)))
  app.get('/jobs/:id', ({ request, params }) => jobDetail(contextFor(request), params.id))
  app.post('/jobs/:id/retry', ({ request, params }) => retryJob(contextFor(request), params.id))
  app.delete('/jobs/:id', ({ request, params }) => cancelJob(contextFor(request), params.id))

  app.post('/jobs/bulk/retry', ({ request, body }) => {
    const parsed = decodeBulkIds(body)
    if (!parsed.ok) return invalidBulkResponse(locale)
    if (parsed.ids.length === 0) return emptyBulkResponse(locale)
    return bulkRetryJobs(contextFor(request), parsed.ids)
  })
  app.post('/jobs/bulk/cancel', ({ request, body }) => {
    const parsed = decodeBulkIds(body)
    if (!parsed.ok) return invalidBulkResponse(locale)
    if (parsed.ids.length === 0) return emptyBulkResponse(locale)
    return bulkCancelJobs(contextFor(request), parsed.ids)
  })

  app.get('/schedules', ({ request, query }) =>
    schedulesPage(contextFor(request), param(query, PARAM.confirmDelete)))
  app.delete('/schedules/:name', ({ request, params }) => deleteSchedule(contextFor(request), params.name))
  app.get('/stats', ({ request }) => statsPage(contextFor(request)))
  app.get('/sse/progress/:id', ({ params }) => sseProgress(boss, locale, params.id))
  app.get('/sse/live', ({ query }) => sseLive(boss, prefix, locale, param(query, PARAM.search) ?? ''))
  app.get('/metrics', () => metricsEndpoint(boss))
}

/**
 * Elysia plugin serving the bao-boss dashboard under `prefix`.
 *
 * The generic parameter is threaded through so the plugin keeps its declared
 * base path; typing the helpers as the default `Elysia<''>` discarded it and
 * broke the build.
 */
export function baoBossDashboard(boss: BaoBoss, options: DashboardOptions = {}) {
  const config = resolve(options)
  const csrfToken = createCsrfToken()
  const app = new Elysia({ prefix: config.prefix })
  applyGuards(app, config)
  registerRoutes(app, boss, config, csrfToken)
  return app
}
