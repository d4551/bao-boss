import { Elysia } from 'elysia'
import type { BaoBoss } from './BaoBoss.js'
import { formatDate, formatDateTime, t } from './i18n.js'
import { getMetricsSnapshot, getQueueDepths, toPrometheusFormat } from './Metrics.js'

/** Better Auth instance with getSession API. Pass your auth from createAuth(). */
export interface BetterAuthSessionApi {
  getSession(options: { headers: Headers | Record<string, string | undefined> }): Promise<{ user?: unknown } | null>
}

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

const CSRF_COOKIE = 'bao-csrf'
const CSRF_HEADER = 'x-csrf-token'

const CSS = `
main { max-width: 1200px; margin: 0 auto; padding: 2rem; }
.empty { text-align: center; padding: 2rem; }
`

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
  <style>${CSS}</style>
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
  <main aria-label="${t('aria.dashboardContent', locale)}">
    ${content}
  </main>
</body>
</html>`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function baoBossDashboard(boss: BaoBoss, options: DashboardOptions = {}): Elysia<any> {
  const prefix = options.prefix ?? '/boss'
  const dashboardAuth = options.dashboardAuth
  const staticAuth = options.auth
  const authToken = dashboardAuth?.type === 'bearer' ? dashboardAuth.token : staticAuth
  const csrfEnabled = options.csrf ?? !!(authToken || dashboardAuth)
  const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
  const locale = options.locale ?? options.lang ?? 'en'

  const app = new Elysia({ prefix })

  if (dashboardAuth?.type === 'better-auth') {
    app.onBeforeHandle({ as: 'global' }, async ({ request, set }) => {
      const session = await dashboardAuth.auth.getSession({ headers: request.headers })
      if (!session?.user) {
        set.status = 401
        return t('msg.unauthorized', locale)
      }
    })
  } else if (authToken) {
    app.onBeforeHandle({ as: 'global' }, ({ headers, set }) => {
      const token = (headers['authorization'] as string | undefined)?.replace('Bearer ', '') ?? (headers['x-bao-token'] as string | undefined)
      if (token !== authToken) {
        set.status = 401
        return t('msg.unauthorized', locale)
      }
    })
  }

  if (csrfEnabled) {
    app.onBeforeHandle({ as: 'global' }, async ({ request, path, set }) => {
      if (['POST', 'DELETE', 'PUT', 'PATCH'].includes(request.method)) {
        const token = request.headers.get(CSRF_HEADER) ?? request.headers.get('x-bao-csrf')
        const cookie = request.headers.get('cookie')?.split(';').find(c => c.trim().startsWith(CSRF_COOKIE + '='))
        const cookieToken = cookie?.split('=')[1]?.trim()
        if (!token || token !== cookieToken) {
          set.status = 403
          return t('msg.forbiddenCsrf', locale)
        }
      }
    })
  }

  if (options.rateLimit) {
    let lastCleanup = Date.now()
    app.onBeforeHandle({ as: 'global' }, ({ request, set }) => {
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? 'unknown'
      const now = Date.now()
      // Purge expired entries every 60s
      if (now - lastCleanup > 60_000) {
        for (const [key, val] of rateLimitMap) {
          if (now > val.resetAt) rateLimitMap.delete(key)
        }
        lastCleanup = now
      }
      const entry = rateLimitMap.get(ip)
      if (entry) {
        if (now > entry.resetAt) {
          rateLimitMap.set(ip, { count: 1, resetAt: now + options.rateLimit!.windowMs })
        } else if (entry.count >= options.rateLimit!.max) {
          set.status = 429
          return t('msg.tooManyRequests', locale)
        } else {
          entry.count++
        }
      } else {
        rateLimitMap.set(ip, { count: 1, resetAt: now + options.rateLimit!.windowMs })
      }
    })
  }

  const getCsrf = () => (csrfEnabled ? crypto.randomUUID() : undefined)
  const lang = options.lang ?? 'en'

  // Main dashboard
  app.get('/', async () => {
    const csrfToken = getCsrf()
    const queues = await boss.getQueues()
    const schedules = await boss.getSchedules()

    const queueRows = queues.length === 0
      ? `<tr><td colspan="6" class="empty text-base-content/70">${t('empty.noQueues', locale)}</td></tr>`
      : (await Promise.all(queues.map(async q => {
          const size = await boss.getQueueSize(q.name)
          return `<tr>
            <td><a href="${prefix}/queues/${encodeURIComponent(q.name)}" class="link link-primary">${esc(q.name)}</a></td>
            <td><span class="badge badge-ghost">${esc(q.policy)}</span></td>
            <td>${size}</td>
            <td>${q.retryLimit}</td>
            <td>${q.deadLetter ? esc(q.deadLetter) : t('empty.none', locale)}</td>
            <td>${formatDate(new Date(q.createdOn), locale)}</td>
          </tr>`
        }))).join('')

    const content = `
      <div hx-get="${prefix}/stats" hx-trigger="load, every 10s" hx-swap="outerHTML"></div>
      <div class="card bg-base-200 shadow-sm mb-6">
        <div class="card-body">
          <h2 class="card-title text-lg font-semibold mb-4">${t('section.queues', locale)}</h2>
          <div class="overflow-x-auto">
            <table class="table table-zebra" hx-get="${prefix}/queues" hx-trigger="every 5s" hx-swap="outerHTML">
              <thead><tr>
                <th scope="col">${t('table.name', locale)}</th><th scope="col">${t('table.policy', locale)}</th><th scope="col">${t('table.pending', locale)}</th><th scope="col">${t('table.retryLimit', locale)}</th><th scope="col">${t('table.deadLetter', locale)}</th><th scope="col">${t('table.created', locale)}</th>
              </tr></thead>
              <tbody>${queueRows}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="card bg-base-200 shadow-sm mb-6">
        <div class="card-body">
          <h2 class="card-title text-lg font-semibold mb-4">${t('section.schedules', locale)} (${schedules.length})</h2>
          ${schedules.length === 0 ? `<p class="empty text-base-content/70">${t('empty.noSchedules', locale)}</p>` : `
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
    const headers: Record<string, string> = { 'Content-Type': 'text/html' }
    if (csrfToken) headers['Set-Cookie'] = `${CSRF_COOKIE}=${csrfToken}; Path=/; HttpOnly; SameSite=Strict`
    return new Response(shell(prefix, content, t('title.dashboard', locale), csrfToken, lang, locale), { headers })
  })

  // Queues list fragment
  app.get('/queues', async () => {
    const queues = await boss.getQueues()
    const rows = await Promise.all(queues.map(async q => {
      const size = await boss.getQueueSize(q.name)
      return `<tr>
        <td><a href="${prefix}/queues/${encodeURIComponent(q.name)}" class="link link-primary">${esc(q.name)}</a></td>
        <td><span class="badge badge-ghost">${esc(q.policy)}</span></td>
        <td>${size}</td>
        <td>${q.retryLimit}</td>
        <td>${q.deadLetter ? esc(q.deadLetter) : t('empty.none', locale)}</td>
        <td>${formatDate(new Date(q.createdOn), locale)}</td>
      </tr>`
    }))
    return new Response(`
      <table class="table table-zebra" hx-get="${prefix}/queues" hx-trigger="every 5s" hx-swap="outerHTML">
        <thead><tr>
          <th scope="col">${t('table.name', locale)}</th><th scope="col">${t('table.policy', locale)}</th><th scope="col">${t('table.pending', locale)}</th><th scope="col">${t('table.retryLimit', locale)}</th><th scope="col">${t('table.deadLetter', locale)}</th><th scope="col">${t('table.created', locale)}</th>
        </tr></thead>
        <tbody>${rows.length === 0 ? `<tr><td colspan="6" class="empty text-base-content/70">${t('empty.noQueuesShort', locale)}</td></tr>` : rows.join('')}</tbody>
      </table>
    `, { headers: { 'Content-Type': 'text/html' } })
  })

  // Queue detail
  app.get('/queues/:name', async ({ params }) => {
    const csrfToken = getCsrf()
    const { name } = params
    const queue = await boss.getQueue(name)
    if (!queue) {
      const headers: Record<string, string> = { 'Content-Type': 'text/html' }
      if (csrfToken) headers['Set-Cookie'] = `${CSRF_COOKIE}=${csrfToken}; Path=/; HttpOnly; SameSite=Strict`
      return new Response(shell(prefix, `<p>${t('msg.queueNotFound', locale)}</p>`, `${t('section.queue', locale)}: ${esc(name)}`, csrfToken, lang, locale), {
        status: 404,
        headers,
      })
    }

    const [created, active, completed, failed, cancelled, dlqDepth] = await Promise.all([
      boss.getQueueSize(name, { before: 'active' }),
      boss.prisma.job.count({ where: { queue: name, state: 'active' } }),
      boss.prisma.job.count({ where: { queue: name, state: 'completed' } }),
      boss.prisma.job.count({ where: { queue: name, state: 'failed' } }),
      boss.prisma.job.count({ where: { queue: name, state: 'cancelled' } }),
      queue.deadLetter ? boss.getDLQDepth(queue.deadLetter) : Promise.resolve(0),
    ])

    const jobs = await boss.prisma.job.findMany({
      where: { queue: name },
      orderBy: { createdOn: 'desc' },
      take: 50,
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
            ${jobs.map(j => {
              const badgeClass = j.state === 'created' ? 'badge-info' : j.state === 'active' ? 'badge-warning' : j.state === 'completed' ? 'badge-success' : j.state === 'failed' ? 'badge-error' : 'badge-ghost'
              return `<tr>
              <td><a href="${prefix}/jobs/${j.id}" class="link link-primary">${j.id.slice(0, 8)}…</a></td>
              <td><span class="badge ${badgeClass}">${j.state}</span></td>
              <td>${j.priority}</td>
              <td>${formatDateTime(new Date(j.createdOn), locale)}</td>
              <td>
                ${j.state === 'failed' || j.state === 'cancelled' ? `
                  <button class="btn btn-primary btn-sm mr-1" type="button"
                    aria-label="${t('aria.retryJob', locale)} ${j.id.slice(0, 8)}"
                    hx-post="${prefix}/jobs/${j.id}/retry"
                    hx-confirm="${t('confirm.retryJob', locale).replace('{id}', j.id.slice(0, 8))}"
                    hx-swap="outerHTML" hx-target="closest tr">${t('btn.retry', locale)}</button>
                ` : ''}
                ${j.state !== 'completed' && j.state !== 'cancelled' ? `
                  <button class="btn btn-error btn-sm" type="button"
                    aria-label="${t('aria.cancelJob', locale)} ${j.id.slice(0, 8)}"
                    hx-delete="${prefix}/jobs/${j.id}"
                    hx-confirm="${t('confirm.cancelJob', locale).replace('{id}', j.id.slice(0, 8))}"
                    hx-swap="outerHTML" hx-target="closest tr">${t('btn.cancel', locale)}</button>
                ` : ''}
              </td>
            </tr>`
            }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `
    const headers: Record<string, string> = { 'Content-Type': 'text/html' }
    if (csrfToken) headers['Set-Cookie'] = `${CSRF_COOKIE}=${csrfToken}; Path=/; HttpOnly; SameSite=Strict`
    return new Response(shell(prefix, content, `${t('section.queue', locale)}: ${name}`, csrfToken, lang, locale), { headers })
  })

  // Job detail
  app.get('/jobs/:id', async ({ params }) => {
    const csrfToken = getCsrf()
    const job = await boss.getJobById(params.id)
    if (!job) {
      const headers: Record<string, string> = { 'Content-Type': 'text/html' }
      if (csrfToken) headers['Set-Cookie'] = `${CSRF_COOKIE}=${csrfToken}; Path=/; HttpOnly; SameSite=Strict`
      return new Response(shell(prefix, `<p>${t('msg.jobNotFound', locale)}</p>`, t('msg.jobNotFound', locale), csrfToken, lang, locale), {
        status: 404,
        headers,
      })
    }
    const badgeClass = job.state === 'created' ? 'badge-info' : job.state === 'active' ? 'badge-warning' : job.state === 'completed' ? 'badge-success' : job.state === 'failed' ? 'badge-error' : 'badge-ghost'
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
                ${(job as { progress?: number | null }).progress != null ? (() => {
  const p = (job as { progress?: number }).progress ?? 0;
  const progressBar = `<progress class="progress progress-primary w-48" value="${p}" max="100" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${p} ${t('aria.progressPercent', locale)}"></progress>`;
  const terminalStates = ['completed', 'failed', 'cancelled'];
  const useSse = !terminalStates.includes(job.state);
  return `<tr><td>${t('field.progress', locale)}</td><td>${useSse ? `<div hx-ext="sse" sse-connect="${prefix}/sse/progress/${job.id}?locale=${encodeURIComponent(locale)}" sse-swap="progress" hx-swap="innerHTML">${progressBar}</div>` : progressBar}</td></tr>`;
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
    const headers: Record<string, string> = { 'Content-Type': 'text/html' }
    if (csrfToken) headers['Set-Cookie'] = `${CSRF_COOKIE}=${csrfToken}; Path=/; HttpOnly; SameSite=Strict`
    return new Response(shell(prefix, content, `${t('section.job', locale)}: ${job.id}`, csrfToken, lang, locale), { headers })
  })

  // Retry job
  app.post('/jobs/:id/retry', async ({ params }) => {
    await boss.resume(params.id)
    return new Response(`<tr><td colspan="5" class="text-success">${t('msg.jobQueuedRetry', locale)}</td></tr>`, {
      headers: { 'Content-Type': 'text/html' },
    })
  })

  // Cancel job
  app.delete('/jobs/:id', async ({ params }) => {
    await boss.cancel(params.id)
    return new Response(`<tr><td colspan="5" class="text-base-content/70">${t('msg.jobCancelled', locale)}</td></tr>`, {
      headers: { 'Content-Type': 'text/html' },
    })
  })

  // Schedules list
  app.get('/schedules', async () => {
    const csrfToken = getCsrf()
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
              ? `<tr><td colspan="5" class="empty text-base-content/70">${t('empty.noSchedules', locale)}</td></tr>`
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
    const headers: Record<string, string> = { 'Content-Type': 'text/html' }
    if (csrfToken) headers['Set-Cookie'] = `${CSRF_COOKIE}=${csrfToken}; Path=/; HttpOnly; SameSite=Strict`
    return new Response(shell(prefix, content, t('section.schedules', locale), csrfToken, lang, locale), { headers })
  })

  // Delete schedule
  app.delete('/schedules/:name', async ({ params }) => {
    await boss.unschedule(params.name)
    return new Response('', { headers: { 'Content-Type': 'text/html' } })
  })

  // SSE progress stream for live job progress
  app.get('/sse/progress/:id', async ({ params, query, set }) => {
    const job = await boss.getJobById(params.id)
    const loc = (query.locale as string) ?? 'en'
    if (!job) {
      set.status = 404
      return t('msg.jobNotFound', loc)
    }
    const terminalStates = ['completed', 'failed', 'cancelled']
    if (terminalStates.includes(job.state)) {
      set.status = 400
      return t('msg.jobAlreadyFinished', loc)
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        let lastProgress: number | null = (job as { progress?: number | null }).progress ?? null

        const progressHtml = (p: number | null) => {
          const val = p ?? 0
          return `<progress class="progress progress-primary w-48" value="${val}" max="100" role="progressbar" aria-valuenow="${val}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${val} ${t('aria.progressPercent', loc)}"></progress>`
        }

        const send = (event: string, data: string) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data.replace(/\n/g, '\ndata: ')}\n\n`))

        send('progress', progressHtml(lastProgress))

        const interval = setInterval(async () => {
          try {
            const j = await boss.getJobById(params.id)
            if (!j || terminalStates.includes(j.state)) {
              clearInterval(interval)
              send('close', '{}')
              controller.close()
              return
            }
            const p = (j as { progress?: number | null }).progress ?? null
            if (p !== lastProgress) {
              lastProgress = p
              send('progress', progressHtml(p))
            }
          } catch {
            clearInterval(interval)
            controller.close()
          }
        }, 2000)
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  })

  // Prometheus metrics
  app.get('/metrics', async () => {
    const snapshot = getMetricsSnapshot()
    snapshot.queueDepth = await getQueueDepths(boss.prisma)
    return new Response(toPrometheusFormat(snapshot), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  })

  // Stats fragment
  app.get('/stats', async () => {
    const queues = await boss.getQueues()
    const [totalJobs, activeJobs, failedJobs, completedJobs] = await Promise.all([
      boss.prisma.job.count(),
      boss.prisma.job.count({ where: { state: 'active' } }),
      boss.prisma.job.count({ where: { state: 'failed' } }),
      boss.prisma.job.count({ where: { state: 'completed' } }),
    ])

    return new Response(`
      <div class="stats stats-vertical lg:stats-horizontal shadow mb-6" role="region" aria-label="${t('aria.dashboardStats', locale)}" hx-get="${prefix}/stats" hx-trigger="every 10s" hx-swap="outerHTML">
        <div class="stat"><div class="stat-value text-primary">${queues.length}</div><div class="stat-title">${t('stat.queues', locale)}</div></div>
        <div class="stat"><div class="stat-value text-primary">${totalJobs}</div><div class="stat-title">${t('stat.totalJobs', locale)}</div></div>
        <div class="stat"><div class="stat-value text-primary">${activeJobs}</div><div class="stat-title">${t('stat.active', locale)}</div></div>
        <div class="stat"><div class="stat-value text-primary">${completedJobs}</div><div class="stat-title">${t('stat.completed', locale)}</div></div>
        <div class="stat"><div class="stat-value text-primary">${failedJobs}</div><div class="stat-title">${t('stat.failed', locale)}</div></div>
      </div>
    `, { headers: { 'Content-Type': 'text/html' } })
  })

  return app
}
