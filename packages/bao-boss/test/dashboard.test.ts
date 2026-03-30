import { describe, it, expect } from 'bun:test'
import { Elysia } from 'elysia'
import { baoBossDashboard } from '../src/Dashboard'
import { BaoBoss } from '../src/BaoBoss'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Dashboard', () => {
  it('returns HTML for main route', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()

    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))

    const response = await app.handle(new Request('http://localhost/boss'))
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('bao-boss')
    expect(html).toContain('htmx')

    await boss.stop()
  })

  it('returns stats fragment', async () => {
    const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
    await boss.start()

    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))

    const response = await app.handle(new Request('http://localhost/boss/stats'))
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('stats')

    await boss.stop()
  })

  it('queue detail page renders', async () => {
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

    // Fetch and fail the job
    const fetched = await boss.fetch(queueName)
    expect(fetched.length).toBeGreaterThan(0)
    await boss.fail(fetched[0]!.id, 'test failure')

    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))

    const response = await app.handle(
      new Request(`http://localhost/boss/jobs/${jobId}/retry`, { method: 'POST' })
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
      new Request(`http://localhost/boss/jobs/${jobId}`, { method: 'DELETE' })
    )
    expect(response.status).toBe(200)

    const job = await boss.getJobById(jobId)
    expect(job!.state).toBe('cancelled')

    await boss.deleteQueue(queueName)
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
      new Request('http://localhost/boss/jobs/00000000-0000-0000-0000-000000000000')
    )
    expect(response.status).toBe(404)

    await boss.stop()
  })
})
