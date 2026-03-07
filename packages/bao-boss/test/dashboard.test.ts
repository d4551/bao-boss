import { describe, it, expect } from 'bun:test'
import { Elysia } from 'elysia'
import { baoBossDashboard } from '../src/Dashboard'
import { BaoBoss } from '../src/BaoBoss'

const skip = !process.env['DATABASE_URL']

describe.skipIf(skip)('Dashboard', () => {
  it('returns HTML for main route', async () => {
    const boss = new BaoBoss({ connectionString: process.env['DATABASE_URL'] })
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
    const boss = new BaoBoss({ connectionString: process.env['DATABASE_URL'] })
    await boss.start()

    const app = new Elysia().use(baoBossDashboard(boss, { prefix: '/boss' }))

    const response = await app.handle(new Request('http://localhost/boss/stats'))
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('stat-card')

    await boss.stop()
  })
})
