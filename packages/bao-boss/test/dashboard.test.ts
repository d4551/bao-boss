import { describe, it, expect } from 'bun:test'
import { Elysia } from 'elysia'
import { baoBossDashboard } from '../src/Dashboard'
import { BaoBoss } from '../src/BaoBoss'
import { navItems } from '../src/dashboard/shell'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Dashboard', () => {
  it('returns HTML for main route with shell + vendored assets', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()
    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))
    const response = await app.handle(new Request('http://localhost/boss'))
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('bao-boss')
    expect(html).toContain('htmx.min.js')
    expect(html).toContain('/boss/assets/daisyui.css')
    expect(html).not.toContain('cdn.jsdelivr.net')
    expect(html).toContain('bao-nav-drawer')
    expect(html).toContain('min-h-11')
    for (const item of navItems('/boss')) {
      expect(html).toContain(`href="${item.href}"`)
    }
    expect(navItems('/boss').some(i => i.href.includes('/metrics'))).toBe(false)
    expect(html).toContain('href="/boss/metrics"') // scrape hint in content, not nav registry
    const navCenter = html.match(/navbar-center[\s\S]*?<\/div>/)?.[0] ?? ''
    expect(navCenter).not.toContain('/boss/metrics')
    await boss.stop()
  })

  it('serves vendored asset', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()
    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))
    const response = await app.handle(new Request('http://localhost/boss/assets/htmx.min.js'))
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text.length).toBeGreaterThan(100)
    await boss.stop()
  })

  it('queues full page without HX-Request', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()
    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))
    const response = await app.handle(new Request('http://localhost/boss/queues'))
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<nav')
    expect(html).toContain('bao-nav-drawer')
    expect(html).toContain('Search queues')
    await boss.stop()
  })

  it('queues fragment with HX-Request', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()
    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))
    const response = await app.handle(new Request('http://localhost/boss/queues', {
      headers: { 'HX-Request': 'true' },
    }))
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).not.toContain('<nav')
    expect(html).toContain('<table')
    await boss.stop()
  })

  it('returns stats fragment for HX and full page otherwise', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()
    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))
    const frag = await app.handle(new Request('http://localhost/boss/stats', {
      headers: { 'HX-Request': 'true' },
    }))
    expect(frag.status).toBe(200)
    const fragHtml = await frag.text()
    expect(fragHtml).toContain('stats')
    expect(fragHtml).not.toContain('<nav')
    const page = await app.handle(new Request('http://localhost/boss/stats'))
    expect(page.status).toBe(200)
    const pageHtml = await page.text()
    expect(pageHtml).toContain('<nav')
    expect(pageHtml).toContain('Prometheus metrics')
    await boss.stop()
  })

  it('queue detail page renders bulk toolbar', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()
    const queueName = `dash-detail-${Date.now()}`
    await boss.createQueue(queueName)
    await boss.send(queueName, { test: true })
    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))
    const response = await app.handle(new Request(`http://localhost/boss/queues/${queueName}`))
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain(queueName)
    expect(html).toContain('bulk-jobs')
    expect(html).toContain('/jobs/bulk/retry')
    expect(html).toContain('name="ids"')
    await boss.deleteQueue(queueName)
    await boss.stop()
  })

  it('job detail page renders', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()
    const queueName = `dash-job-${Date.now()}`
    await boss.createQueue(queueName)
    const jobId = await boss.send(queueName, { detail: true })
    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))
    const response = await app.handle(new Request(`http://localhost/boss/jobs/${jobId}`))
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain(jobId)
    await boss.deleteQueue(queueName)
    await boss.stop()
  })

  it('retry action works', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()
    const queueName = `dash-retry-${Date.now()}`
    await boss.createQueue(queueName, { retryLimit: 0 })
    const jobId = await boss.send(queueName, { retry: true })
    const fetched = await boss.fetch(queueName)
    expect(fetched.length).toBeGreaterThan(0)
    await boss.fail(fetched[0]!.id, 'test failure')
    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))
    const response = await app.handle(
      new Request(`http://localhost/boss/jobs/${jobId}/retry`, { method: 'POST' }),
    )
    expect(response.status).toBe(200)
    const job = await boss.getJobById(jobId)
    expect(job!.state).toBe('created')
    await boss.deleteQueue(queueName)
    await boss.stop()
  })

  it('cancel action works', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()
    const queueName = `dash-cancel-${Date.now()}`
    await boss.createQueue(queueName)
    const jobId = await boss.send(queueName, { cancel: true })
    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))
    const response = await app.handle(
      new Request(`http://localhost/boss/jobs/${jobId}`, { method: 'DELETE' }),
    )
    expect(response.status).toBe(200)
    const job = await boss.getJobById(jobId)
    expect(job!.state).toBe('cancelled')
    await boss.deleteQueue(queueName)
    await boss.stop()
  })

  it('bulk retry with json ids', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()
    const queueName = `dash-bulk-${Date.now()}`
    await boss.createQueue(queueName, { retryLimit: 0 })
    const jobId = await boss.send(queueName, { bulk: true })
    const fetched = await boss.fetch(queueName)
    await boss.fail(fetched[0]!.id, 'bulk fail')
    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))
    const response = await app.handle(new Request('http://localhost/boss/jobs/bulk/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [jobId] }),
    }))
    expect(response.status).toBe(200)
    const job = await boss.getJobById(jobId)
    expect(job!.state).toBe('created')
    await boss.deleteQueue(queueName)
    await boss.stop()
  })

  it('bulk invalid body returns 400', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()
    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))
    const response = await app.handle(new Request('http://localhost/boss/jobs/bulk/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: 123 }),
    }))
    expect(response.status).toBe(400)
    await boss.stop()
  })

  it('metrics endpoint returns prometheus format', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()
    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))
    const response = await app.handle(new Request('http://localhost/boss/metrics'))
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('baoboss_jobs_processed_total')
    await boss.stop()
  })

  it('returns 404 for non-existent job', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()
    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))
    const response = await app.handle(
      new Request('http://localhost/boss/jobs/00000000-0000-0000-0000-000000000000'),
    )
    expect(response.status).toBe(404)
    await boss.stop()
  })
})
