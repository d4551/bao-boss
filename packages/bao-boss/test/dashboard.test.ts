import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import { baoBossDashboard } from '../src/Dashboard'
import { BaoBoss } from '../src/BaoBoss'
import { navItems } from '../src/dashboard/shell'
import { uniqueName, createTestBoss, cleanupQueue } from './helpers'

const PREFIX = '/boss'

describe('Dashboard', () => {
  let boss: BaoBoss
  let app: Elysia

  beforeAll(async () => {
    boss = createTestBoss({ noSupervisor: true })
    await boss.start()
    app = new Elysia().use(baoBossDashboard(boss, { prefix: PREFIX }))
  })

  afterAll(async () => {
    await boss.stop()
  })

  const get = (path: string, init?: RequestInit) =>
    app.handle(new Request(`http://localhost${path}`, init))

  const text = async (path: string, init?: RequestInit) => (await get(path, init)).text()

  it('renders the shell with vendored assets and no CDN', async () => {
    const html = await text(PREFIX)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain(`${PREFIX}/assets/daisyui.css`)
    expect(html).toContain(`${PREFIX}/assets/baoboss.css`)
    expect(html).toContain(`${PREFIX}/assets/htmx.min.js`)
    expect(html).not.toContain('cdn.jsdelivr.net')
    expect(html).not.toContain('unpkg.com')
  })

  it('renders navigation exactly once, with no duplicated link tree', async () => {
    // Regression: the shell rendered a desktop link row and a drawer list with
    // the same links, so assistive technology announced navigation twice.
    const html = await text(PREFIX)
    for (const item of navItems(PREFIX)) {
      const occurrences = html.split(`href="${item.href}"`).length - 1
      expect(occurrences).toBe(1)
    }
    expect(html.split('<nav').length - 1).toBe(1)
  })

  it('exposes every human page in the navigation', async () => {
    // Regression: /stats existed as a page but nothing linked to it.
    const hrefs = navItems(PREFIX).map(item => item.href)
    expect(hrefs).toContain(`${PREFIX}/stats`)
    expect(hrefs.some(href => href.includes('/metrics'))).toBe(false)
    for (const href of hrefs) {
      expect((await get(href)).status).toBe(200)
    }
  })

  it('marks the current page in the navigation', async () => {
    const html = await text(`${PREFIX}/queues`)
    expect(html).toContain(`href="${PREFIX}/queues" class="btn btn-ghost btn-active`)
    expect(html).toContain('aria-current="page"')
  })

  it('offers a skip link and a labelled main landmark', async () => {
    const html = await text(PREFIX)
    expect(html).toContain('href="#bao-main"')
    expect(html).toContain('<main id="bao-main"')
  })

  it('contains no inline script, style or event handler', async () => {
    const html = await text(PREFIX)
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/)
    expect(html).not.toContain('<style')
    expect(html).not.toContain('style="')
    expect(html).not.toMatch(/\son(click|change|input|submit)=/)
  })

  it('sends a strict content security policy', async () => {
    const response = await get(PREFIX)
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain('unsafe-eval')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('escapes a hostile queue name instead of emitting markup', async () => {
    // Regression: the queue name reached <title> unescaped, so a name
    // containing </title><script> executed in the document head.
    const hostile = `${uniqueName('xss')}</title><script>alert(1)</script>`
    await boss.createQueue(hostile)
    try {
      const html = await text(`${PREFIX}/queues/${encodeURIComponent(hostile)}`)
      expect(html).not.toContain('<script>alert(1)</script>')
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      const titles = html.match(/<title>[\s\S]*?<\/title>/g) ?? []
      expect(titles).toHaveLength(1)
    } finally {
      await cleanupQueue(boss, hostile)
    }
  })

  it('escapes a hostile queue name in the list view', async () => {
    const hostile = `${uniqueName('xss-list')}<img src=x onerror=alert(1)>`
    await boss.createQueue(hostile)
    try {
      const html = await text(`${PREFIX}/queues`)
      expect(html).not.toContain('<img src=x onerror=alert(1)>')
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    } finally {
      await cleanupQueue(boss, hostile)
    }
  })

  it('keeps the queue filter in the URL rather than polling the panel', async () => {
    // Regression: the panel replaced itself every 5s, destroying focus and the
    // caret in the filter input it contained.
    const html = await text(`${PREFIX}/queues?search=nothing-matches-this`)
    expect(html).not.toContain('every 5s')
    expect(html).toContain('value="nothing-matches-this"')
    expect(html).toContain('No queue matches')
  })

  it('distinguishes an empty database from an empty filter result', async () => {
    const queueName = uniqueName('dash-empty')
    await boss.createQueue(queueName)
    try {
      const filtered = await text(`${PREFIX}/queues?search=definitely-not-a-queue`)
      expect(filtered).toContain('No queue matches')
      const unfiltered = await text(`${PREFIX}/queues`)
      expect(unfiltered).not.toContain('No queue matches')
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('renders the queue detail page with pagination and a bulk toolbar', async () => {
    const queueName = uniqueName('dash-detail')
    await boss.createQueue(queueName)
    await boss.send(queueName, { test: true })
    try {
      const html = await text(`${PREFIX}/queues/${queueName}`)
      expect(html).toContain(queueName)
      expect(html).toContain('bao-bulk-jobs')
      expect(html).toContain('/jobs/bulk/retry')
      expect(html).toContain('name="ids"')
      expect(html).toContain('Showing')
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('states the visible range instead of silently truncating', async () => {
    const queueName = uniqueName('dash-page')
    await boss.createQueue(queueName)
    await boss.insert(Array.from({ length: 30 }, (_, n) => ({ name: queueName, data: { n } })))
    try {
      const first = await text(`${PREFIX}/queues/${queueName}`)
      expect(first).toContain('of 30')
      expect(first).toContain(`${PREFIX}/queues/${queueName}?page=2`)

      const second = await text(`${PREFIX}/queues/${queueName}?page=2`)
      expect(second).toContain('26')
      expect(second).toContain('of 30')
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('renders the job detail page', async () => {
    const queueName = uniqueName('dash-job')
    await boss.createQueue(queueName)
    const jobId = await boss.send(queueName, { detail: true })
    try {
      const html = await text(`${PREFIX}/jobs/${jobId}`)
      expect(html).toContain(jobId)
      expect(html).toContain('Details')
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('returns a themed 404 page for a missing queue and job', async () => {
    const missing = await get(`${PREFIX}/queues/${uniqueName('nope')}`)
    expect(missing.status).toBe(404)
    const html = await missing.text()
    expect(html).toContain('<main id="bao-main"')
    expect(html).toContain('does not exist')

    const job = await get(`${PREFIX}/jobs/00000000-0000-4000-8000-000000000000`)
    expect(job.status).toBe(404)
  })

  it('retries a job and offers undo instead of a confirmation prompt', async () => {
    const queueName = uniqueName('dash-retry')
    await boss.createQueue(queueName, { retryLimit: 0 })
    const jobId = await boss.send(queueName, { retry: true })
    const fetched = await boss.fetch(queueName)
    await boss.fail(fetched[0]!.id, 'test failure')
    try {
      const response = await get(`${PREFIX}/jobs/${jobId}/retry`, { method: 'POST' })
      expect(response.status).toBe(200)
      const fragment = await response.text()
      expect(fragment).toContain('Undo')
      expect(fragment).not.toContain('hx-confirm')
      expect((await boss.getJobById(jobId))!.state).toBe('created')
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('cancels a job and offers undo', async () => {
    const queueName = uniqueName('dash-cancel')
    await boss.createQueue(queueName)
    const jobId = await boss.send(queueName, { cancel: true })
    try {
      const response = await get(`${PREFIX}/jobs/${jobId}`, { method: 'DELETE' })
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('Undo')
      expect((await boss.getJobById(jobId))!.state).toBe('cancelled')
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('uses no native confirm dialogs anywhere', async () => {
    const queueName = uniqueName('dash-noconfirm')
    await boss.createQueue(queueName)
    await boss.send(queueName, {})
    try {
      for (const path of [PREFIX, `${PREFIX}/queues`, `${PREFIX}/schedules`, `${PREFIX}/queues/${queueName}`]) {
        const html = await text(path)
        expect(html).not.toContain('hx-confirm')
        expect(html).not.toContain('confirm(')
      }
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('confirms schedule deletion through addressable page state', async () => {
    const name = uniqueName('dash-sched')
    await boss.schedule(name, '0 9 * * *')
    try {
      const list = await text(`${PREFIX}/schedules`)
      expect(list).toContain(`confirm=${encodeURIComponent(name)}`)
      expect(list).not.toContain('hx-delete')

      const confirming = await text(`${PREFIX}/schedules?confirm=${encodeURIComponent(name)}`)
      expect(confirming).toContain(`hx-delete="${PREFIX}/schedules/${encodeURIComponent(name)}"`)

      const deleted = await get(`${PREFIX}/schedules/${encodeURIComponent(name)}`, { method: 'DELETE' })
      expect(deleted.status).toBe(200)
      expect(await boss.getSchedules()).not.toContainEqual(expect.objectContaining({ name }))
    } finally {
      await boss.unschedule(name).catch(() => undefined)
    }
  })

  it('describes each schedule in words', async () => {
    const name = uniqueName('dash-desc')
    await boss.schedule(name, '0 9 * * 1')
    try {
      const html = await text(`${PREFIX}/schedules`)
      expect(html).toContain('Monday')
    } finally {
      await boss.unschedule(name)
    }
  })

  it('accepts a bulk retry and reports the count with undo', async () => {
    const queueName = uniqueName('dash-bulk')
    await boss.createQueue(queueName, { retryLimit: 0 })
    const jobId = await boss.send(queueName, { bulk: true })
    const fetched = await boss.fetch(queueName)
    await boss.fail(fetched[0]!.id, 'bulk fail')
    try {
      const response = await get(`${PREFIX}/jobs/bulk/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [jobId] }),
      })
      expect(response.status).toBe(200)
      const fragment = await response.text()
      expect(fragment).toContain('1 queued for retry')
      expect(fragment).toContain('Undo')
      expect((await boss.getJobById(jobId))!.state).toBe('created')
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('rejects a malformed bulk body', async () => {
    const response = await get(`${PREFIX}/jobs/bulk/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: 123 }),
    })
    expect(response.status).toBe(400)
  })

  it('serves the metrics endpoint in Prometheus text format', async () => {
    const response = await get(`${PREFIX}/metrics`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('version=0.0.4')
    expect(await response.text()).toContain('baoboss_jobs_processed_total')
  })

  it('serves vendored assets with a validator and honours revalidation', async () => {
    const response = await get(`${PREFIX}/assets/htmx.min.js`)
    expect(response.status).toBe(200)
    const etag = response.headers.get('etag')
    expect(etag).toBeTruthy()
    expect(response.headers.get('cache-control')).toContain('must-revalidate')

    const revalidated = await get(`${PREFIX}/assets/htmx.min.js`, {
      headers: { 'If-None-Match': etag! },
    })
    expect(revalidated.status).toBe(304)
  })

  it('refuses to serve a path outside the asset allowlist', async () => {
    expect((await get(`${PREFIX}/assets/..%2F..%2Fpackage.json`)).status).toBe(404)
    expect((await get(`${PREFIX}/assets/secret.env`)).status).toBe(404)
  })
})
