import { Elysia } from 'elysia'
import type { BaoBoss } from './BaoBoss.js'

interface DashboardOptions {
  prefix?: string
  auth?: string
}

const CSS = `
:root {
  --bg: #fff;
  --fg: #1a1a1a;
  --border: #e0e0e0;
  --primary: #6366f1;
  --danger: #ef4444;
  --success: #22c55e;
  --muted: #6b7280;
  --card: #f9fafb;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111827;
    --fg: #f9fafb;
    --border: #374151;
    --card: #1f2937;
    --muted: #9ca3af;
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.5; }
nav { background: var(--primary); color: white; padding: 1rem 2rem; display: flex; align-items: center; gap: 1rem; }
nav h1 { font-size: 1.25rem; font-weight: 700; }
nav a { color: white; text-decoration: none; opacity: 0.8; }
nav a:hover { opacity: 1; }
main { padding: 2rem; max-width: 1200px; margin: 0 auto; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 0.75rem; border-bottom: 2px solid var(--border); font-weight: 600; font-size: 0.875rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
td { padding: 0.75rem; border-bottom: 1px solid var(--border); font-size: 0.875rem; }
tr:last-child td { border-bottom: none; }
.badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
.badge-created { background: #dbeafe; color: #1d4ed8; }
.badge-active { background: #fef9c3; color: #a16207; }
.badge-completed { background: #dcfce7; color: #166534; }
.badge-failed { background: #fee2e2; color: #991b1b; }
.badge-cancelled { background: #f3f4f6; color: #6b7280; }
.btn { padding: 0.375rem 0.75rem; border-radius: 0.375rem; border: none; cursor: pointer; font-size: 0.875rem; font-weight: 500; }
.btn-primary { background: var(--primary); color: white; }
.btn-danger { background: var(--danger); color: white; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
.stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 0.5rem; padding: 1rem; text-align: center; }
.stat-value { font-size: 2rem; font-weight: 700; color: var(--primary); }
.stat-label { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
pre { background: var(--card); border: 1px solid var(--border); border-radius: 0.375rem; padding: 1rem; overflow-x: auto; font-size: 0.8rem; }
h2 { font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; }
h3 { font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem; }
.empty { color: var(--muted); text-align: center; padding: 2rem; }
a { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }
`

function shell(prefix: string, content: string, title = 'bao-boss Dashboard'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://unpkg.com/htmx.org@1.9.12"></script>
  <style>${CSS}</style>
</head>
<body>
  <nav>
    <h1>🥟 bao-boss</h1>
    <a href="${prefix}">Dashboard</a>
    <a href="${prefix}/queues">Queues</a>
    <a href="${prefix}/schedules">Schedules</a>
    <a href="${prefix}/stats">Stats</a>
  </nav>
  <main>
    ${content}
  </main>
</body>
</html>`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function baoBossDashboard(boss: BaoBoss, options: DashboardOptions = {}): Elysia<any> {
  const prefix = options.prefix ?? '/boss'
  const auth = options.auth

  const app = new Elysia({ prefix })

  if (auth) {
    app.onBeforeHandle(({ headers, set }) => {
      const token = (headers['authorization'] as string | undefined)?.replace('Bearer ', '') ?? (headers['x-bao-token'] as string | undefined)
      if (token !== auth) {
        set.status = 401
        return 'Unauthorized'
      }
    })
  }

  // Main dashboard
  app.get('/', async () => {
    const queues = await boss.getQueues()
    const schedules = await boss.getSchedules()

    const queueRows = queues.length === 0
      ? '<tr><td colspan="6" class="empty">No queues yet</td></tr>'
      : (await Promise.all(queues.map(async q => {
          const size = await boss.getQueueSize(q.name)
          return `<tr>
            <td><a href="${prefix}/queues/${q.name}">${q.name}</a></td>
            <td><span class="badge">${q.policy}</span></td>
            <td>${size}</td>
            <td>${q.retryLimit}</td>
            <td>${q.deadLetter ?? '—'}</td>
            <td>${new Date(q.createdOn).toLocaleDateString()}</td>
          </tr>`
        }))).join('')

    const content = `
      <div hx-get="${prefix}/stats" hx-trigger="load, every 10s" hx-swap="outerHTML"></div>
      <div class="card">
        <h2>Queues</h2>
        <table hx-get="${prefix}/queues" hx-trigger="every 5s" hx-swap="outerHTML">
          <thead><tr>
            <th>Name</th><th>Policy</th><th>Pending</th><th>Retry Limit</th><th>Dead Letter</th><th>Created</th>
          </tr></thead>
          <tbody>${queueRows}</tbody>
        </table>
      </div>
      <div class="card">
        <h2>Schedules (${schedules.length})</h2>
        ${schedules.length === 0 ? '<p class="empty">No schedules</p>' : `
        <table>
          <thead><tr><th>Name</th><th>Cron</th><th>Timezone</th><th>Actions</th></tr></thead>
          <tbody>${schedules.map(s => `
            <tr>
              <td>${s.name}</td>
              <td><code>${s.cron}</code></td>
              <td>${s.timezone}</td>
              <td>
                <button class="btn btn-danger"
                  hx-delete="${prefix}/schedules/${s.name}"
                  hx-confirm="Remove schedule '${s.name}'?"
                  hx-swap="outerHTML"
                  hx-target="closest tr">Delete</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>`}
      </div>
    `
    return new Response(shell(prefix, content), { headers: { 'Content-Type': 'text/html' } })
  })

  // Queues list fragment
  app.get('/queues', async () => {
    const queues = await boss.getQueues()
    const rows = await Promise.all(queues.map(async q => {
      const size = await boss.getQueueSize(q.name)
      return `<tr>
        <td><a href="${prefix}/queues/${q.name}">${q.name}</a></td>
        <td><span class="badge">${q.policy}</span></td>
        <td>${size}</td>
        <td>${q.retryLimit}</td>
        <td>${q.deadLetter ?? '—'}</td>
        <td>${new Date(q.createdOn).toLocaleDateString()}</td>
      </tr>`
    }))
    return new Response(`
      <table hx-get="${prefix}/queues" hx-trigger="every 5s" hx-swap="outerHTML">
        <thead><tr>
          <th>Name</th><th>Policy</th><th>Pending</th><th>Retry Limit</th><th>Dead Letter</th><th>Created</th>
        </tr></thead>
        <tbody>${rows.length === 0 ? '<tr><td colspan="6" class="empty">No queues</td></tr>' : rows.join('')}</tbody>
      </table>
    `, { headers: { 'Content-Type': 'text/html' } })
  })

  // Queue detail
  app.get('/queues/:name', async ({ params }) => {
    const { name } = params
    const queue = await boss.getQueue(name)
    if (!queue) {
      return new Response(shell(prefix, '<p>Queue not found</p>', `Queue: ${name}`), {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      })
    }

    const [created, active, completed, failed, cancelled] = await Promise.all([
      boss.getQueueSize(name, { before: 'active' }),
      boss.prisma.job.count({ where: { queue: name, state: 'active' } }),
      boss.prisma.job.count({ where: { queue: name, state: 'completed' } }),
      boss.prisma.job.count({ where: { queue: name, state: 'failed' } }),
      boss.prisma.job.count({ where: { queue: name, state: 'cancelled' } }),
    ])

    const jobs = await boss.prisma.job.findMany({
      where: { queue: name },
      orderBy: { createdOn: 'desc' },
      take: 50,
    })

    const content = `
      <h2>Queue: ${name}</h2>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${created}</div><div class="stat-label">Created</div></div>
        <div class="stat-card"><div class="stat-value">${active}</div><div class="stat-label">Active</div></div>
        <div class="stat-card"><div class="stat-value">${completed}</div><div class="stat-label">Completed</div></div>
        <div class="stat-card"><div class="stat-value">${failed}</div><div class="stat-label">Failed</div></div>
        <div class="stat-card"><div class="stat-value">${cancelled}</div><div class="stat-label">Cancelled</div></div>
      </div>
      <div class="card">
        <h3>Queue Settings</h3>
        <table>
          <thead><tr><th>Setting</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Policy</td><td>${queue.policy}</td></tr>
            <tr><td>Retry Limit</td><td>${queue.retryLimit}</td></tr>
            <tr><td>Retry Delay</td><td>${queue.retryDelay}s</td></tr>
            <tr><td>Retry Backoff</td><td>${queue.retryBackoff}</td></tr>
            <tr><td>Expire In</td><td>${queue.expireIn}s</td></tr>
            <tr><td>Retention Days</td><td>${queue.retentionDays}</td></tr>
            <tr><td>Dead Letter</td><td>${queue.deadLetter ?? '—'}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card">
        <h3>Recent Jobs (last 50)</h3>
        <table>
          <thead><tr><th>ID</th><th>State</th><th>Priority</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            ${jobs.map(j => `<tr>
              <td><a href="${prefix}/jobs/${j.id}">${j.id.slice(0, 8)}…</a></td>
              <td><span class="badge badge-${j.state}">${j.state}</span></td>
              <td>${j.priority}</td>
              <td>${new Date(j.createdOn).toLocaleString()}</td>
              <td>
                ${j.state === 'failed' || j.state === 'cancelled' ? `
                  <button class="btn btn-primary" style="margin-right:4px"
                    hx-post="${prefix}/jobs/${j.id}/retry"
                    hx-confirm="Retry job ${j.id.slice(0, 8)}?"
                    hx-swap="outerHTML" hx-target="closest tr">Retry</button>
                ` : ''}
                ${j.state !== 'completed' && j.state !== 'cancelled' ? `
                  <button class="btn btn-danger"
                    hx-delete="${prefix}/jobs/${j.id}"
                    hx-confirm="Cancel job ${j.id.slice(0, 8)}?"
                    hx-swap="outerHTML" hx-target="closest tr">Cancel</button>
                ` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `
    return new Response(shell(prefix, content, `Queue: ${name}`), { headers: { 'Content-Type': 'text/html' } })
  })

  // Job detail
  app.get('/jobs/:id', async ({ params }) => {
    const job = await boss.getJobById(params.id)
    if (!job) {
      return new Response(shell(prefix, '<p>Job not found</p>'), {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      })
    }
    const content = `
      <h2>Job: ${job.id}</h2>
      <div class="card">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
          <div>
            <h3>Details</h3>
            <table>
              <tbody>
                <tr><td>Queue</td><td><a href="${prefix}/queues/${job.queue}">${job.queue}</a></td></tr>
                <tr><td>State</td><td><span class="badge badge-${job.state}">${job.state}</span></td></tr>
                <tr><td>Priority</td><td>${job.priority}</td></tr>
                <tr><td>Retry Count</td><td>${job.retryCount} / ${job.retryLimit}</td></tr>
                <tr><td>Created</td><td>${new Date(job.createdOn).toLocaleString()}</td></tr>
                <tr><td>Start After</td><td>${new Date(job.startAfter).toLocaleString()}</td></tr>
                <tr><td>Started On</td><td>${job.startedOn ? new Date(job.startedOn).toLocaleString() : '—'}</td></tr>
                <tr><td>Completed On</td><td>${job.completedOn ? new Date(job.completedOn).toLocaleString() : '—'}</td></tr>
                <tr><td>Keep Until</td><td>${new Date(job.keepUntil).toLocaleString()}</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <h3>Data</h3>
            <pre>${JSON.stringify(job.data, null, 2)}</pre>
            ${job.output ? `<h3 style="margin-top:1rem">Output</h3><pre>${JSON.stringify(job.output, null, 2)}</pre>` : ''}
          </div>
        </div>
        <div style="margin-top:1rem">
          ${job.state === 'failed' || job.state === 'cancelled' ? `
            <button class="btn btn-primary" style="margin-right:8px"
              hx-post="${prefix}/jobs/${job.id}/retry"
              hx-confirm="Retry this job?"
              hx-swap="innerHTML" hx-target="body">Retry</button>
          ` : ''}
          ${job.state !== 'completed' && job.state !== 'cancelled' ? `
            <button class="btn btn-danger"
              hx-delete="${prefix}/jobs/${job.id}"
              hx-confirm="Cancel this job?"
              hx-swap="innerHTML" hx-target="body">Cancel</button>
          ` : ''}
        </div>
      </div>
    `
    return new Response(shell(prefix, content, `Job: ${job.id}`), { headers: { 'Content-Type': 'text/html' } })
  })

  // Retry job
  app.post('/jobs/:id/retry', async ({ params }) => {
    await boss.resume(params.id)
    return new Response(`<tr><td colspan="5" style="color:var(--success)">Job queued for retry</td></tr>`, {
      headers: { 'Content-Type': 'text/html' },
    })
  })

  // Cancel job
  app.delete('/jobs/:id', async ({ params }) => {
    await boss.cancel(params.id)
    return new Response(`<tr><td colspan="5" style="color:var(--muted)">Job cancelled</td></tr>`, {
      headers: { 'Content-Type': 'text/html' },
    })
  })

  // Schedules list
  app.get('/schedules', async () => {
    const schedules = await boss.getSchedules()
    const content = `
      <h2>Cron Schedules</h2>
      <div class="card">
        <table>
          <thead><tr><th>Name</th><th>Cron</th><th>Timezone</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            ${schedules.length === 0
              ? '<tr><td colspan="5" class="empty">No schedules</td></tr>'
              : schedules.map(s => `<tr>
                  <td>${s.name}</td>
                  <td><code>${s.cron}</code></td>
                  <td>${s.timezone}</td>
                  <td>${new Date(s.createdOn).toLocaleString()}</td>
                  <td>
                    <button class="btn btn-danger"
                      hx-delete="${prefix}/schedules/${s.name}"
                      hx-confirm="Remove schedule '${s.name}'?"
                      hx-swap="outerHTML" hx-target="closest tr">Delete</button>
                  </td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `
    return new Response(shell(prefix, content, 'Schedules'), { headers: { 'Content-Type': 'text/html' } })
  })

  // Delete schedule
  app.delete('/schedules/:name', async ({ params }) => {
    await boss.unschedule(params.name)
    return new Response('', { headers: { 'Content-Type': 'text/html' } })
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
      <div class="stats-grid" hx-get="${prefix}/stats" hx-trigger="every 10s" hx-swap="outerHTML">
        <div class="stat-card"><div class="stat-value">${queues.length}</div><div class="stat-label">Queues</div></div>
        <div class="stat-card"><div class="stat-value">${totalJobs}</div><div class="stat-label">Total Jobs</div></div>
        <div class="stat-card"><div class="stat-value">${activeJobs}</div><div class="stat-label">Active</div></div>
        <div class="stat-card"><div class="stat-value">${completedJobs}</div><div class="stat-label">Completed</div></div>
        <div class="stat-card"><div class="stat-value">${failedJobs}</div><div class="stat-label">Failed</div></div>
      </div>
    `, { headers: { 'Content-Type': 'text/html' } })
  })

  return app
}
