import { Elysia } from 'elysia'
import type { BaoBoss } from './BaoBoss.js'
import type { BetterAuthSessionApi } from './types.js'
export type { BetterAuthSessionApi }
import { t } from './i18n.js'
import { CSRF_HEADER, createAuthMiddleware, createCsrfMiddleware, createRateLimitMiddleware } from './dashboard/middleware.js'
import { htmlResponse } from './dashboard/response.js'
import {
  dashboardIndex,
  queuesFragment,
  queueDetail,
  jobDetail,
  retryJob,
  cancelJob,
  schedulesPage,
  deleteSchedule,
  metricsEndpoint,
  statsFragment,
} from './dashboard/routes.js'
import { sseProgress } from './dashboard/sse.js'

interface DashboardOptions {
  prefix?: string
  /** Static bearer token. Ignored when dashboardAuth is set. */
  auth?: string
  /** Optional: bearer (static token) or better-auth (session). When set, overrides auth. */
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

function shell(
  prefix: string,
  content: string,
  title?: string,
  csrfToken?: string,
  lang = 'en',
  locale = lang
): string {
  const pageTitle = title ?? t('title.dashboard', locale)
  const csrfMeta = csrfToken ? `  <meta name="csrf-token" content="${csrfToken}">` : ''
  const csrfScript = csrfToken
    ? `  <script>document.body.addEventListener('htmx:configRequest', function(evt){evt.detail.headers['${CSRF_HEADER}']=document.querySelector('meta[name=csrf-token]')?.content||''})</script>`
    : ''
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
${csrfMeta}
  <title>${pageTitle}</title>
  <link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet" type="text/css" />
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script src="https://cdn.jsdelivr.net/npm/htmx.org@2.0.8/dist/htmx.min.js" integrity="sha384-/TgkGk7p307TH7EXJDuUlgG3Ce1UVolAOFopFekQkkXihi5u/6OCvVKyz1W+idaz" crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/htmx-ext-sse@2.2.4" integrity="sha384-A986SAtodyH8eg8x8irJnYUk7i9inVQqYigD6qZ9evobksGNIXfeFvDwLSHcp31N" crossorigin="anonymous"></script>
${csrfScript}
</head>
<body class="bg-base-100 text-base-content">
  <nav class="navbar bg-primary text-primary-content px-4" role="navigation" aria-label="${t('aria.mainNav', locale)}">
    <div class="navbar-start flex items-center gap-4">
      <span class="font-bold text-lg">${t('nav.brand', locale)}</span>
      <a href="${prefix}" class="link link-hover opacity-80 hover:opacity-100">${t('nav.dashboard', locale)}</a>
      <a href="${prefix}/queues" class="link link-hover opacity-80 hover:opacity-100">${t('nav.queues', locale)}</a>
      <a href="${prefix}/schedules" class="link link-hover opacity-80 hover:opacity-100">${t('nav.schedules', locale)}</a>
      <a href="${prefix}/stats" class="link link-hover opacity-80 hover:opacity-100">${t('nav.stats', locale)}</a>
      <a href="${prefix}/metrics" class="link link-hover opacity-80 hover:opacity-100">${t('nav.metrics', locale)}</a>
    </div>
  </nav>
  <main class="max-w-[1200px] mx-auto p-8" aria-label="${t('aria.dashboardContent', locale)}">
    ${content}
  </main>
</body>
</html>`
}

export function baoBossDashboard(boss: BaoBoss, options: DashboardOptions = {}) {
  const prefix = options.prefix ?? '/boss'
  const dashboardAuth = options.dashboardAuth
  const staticAuth = options.auth
  const authToken = dashboardAuth?.type === 'bearer' ? dashboardAuth.token : staticAuth
  const csrfEnabled = options.csrf ?? !!(authToken || dashboardAuth)
  const locale = options.locale ?? options.lang ?? 'en'
  const lang = options.lang ?? 'en'

  const app = new Elysia({ prefix })

  if (dashboardAuth?.type === 'better-auth') {
    app.onBeforeHandle({ as: 'global' }, createAuthMiddleware(dashboardAuth, locale))
  } else if (authToken) {
    app.onBeforeHandle({ as: 'global' }, createAuthMiddleware({ type: 'bearer', token: authToken }, locale))
  }

  if (csrfEnabled) {
    app.onBeforeHandle({ as: 'global' }, createCsrfMiddleware(locale))
  }

  if (options.rateLimit) {
    app.onBeforeHandle({ as: 'global' }, createRateLimitMiddleware(options.rateLimit, locale))
  }

  const getCsrf = () => (csrfEnabled ? crypto.randomUUID() : undefined)

  const fullPage = (content: string, title: string, csrfToken?: string, status = 200) =>
    htmlResponse(shell(prefix, content, title, csrfToken, lang, locale), csrfToken, status)

  app.get('/', () => dashboardIndex(boss, prefix, locale, fullPage, getCsrf()))
  app.get('/queues', () => queuesFragment(boss, prefix, locale))
  app.get('/queues/:name', ({ params }) => queueDetail(boss, prefix, locale, params.name, fullPage, getCsrf()))
  app.get('/jobs/:id', ({ params }) => jobDetail(boss, prefix, locale, params.id, fullPage, getCsrf()))
  app.post('/jobs/:id/retry', ({ params, query }) => retryJob(boss, locale, params.id, query.ctx === 'detail' ? 'detail' : 'list'))
  app.delete('/jobs/:id', ({ params, query }) => cancelJob(boss, locale, params.id, query.ctx === 'detail' ? 'detail' : 'list'))
  app.get('/schedules', () => schedulesPage(boss, prefix, locale, fullPage, getCsrf()))
  app.delete('/schedules/:name', ({ params }) => deleteSchedule(boss, params.name))
  app.get('/sse/progress/:id', ({ params, query }) => sseProgress(boss, prefix, locale, params.id, String(query.locale ?? '')))
  app.get('/metrics', () => metricsEndpoint(boss))
  app.get('/stats', () => statsFragment(boss, prefix, locale))

  return app
}
