import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import { baoBossDashboard } from '../src/Dashboard'
import { BaoBoss } from '../src/BaoBoss'
import { createTestBoss } from './helpers'

const PREFIX = '/boss'

describe('Dashboard theming', () => {
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

  it('renders light by default', async () => {
    expect(await (await get(PREFIX)).text()).toContain('data-theme="light"')
  })

  it('follows the browser colour-scheme client hint', async () => {
    const response = await get(PREFIX, { headers: { 'Sec-CH-Prefers-Color-Scheme': 'dark' } })
    expect(await response.text()).toContain('data-theme="dark"')
    expect(response.headers.get('accept-ch')).toContain('Sec-CH-Prefers-Color-Scheme')
    expect(response.headers.get('vary')).toContain('Sec-CH-Prefers-Color-Scheme')
  })

  it('persists an explicit choice over the hint', async () => {
    const chosen = await get(`${PREFIX}?theme=light`, {
      headers: { 'Sec-CH-Prefers-Color-Scheme': 'dark' },
    })
    expect(await chosen.text()).toContain('data-theme="light"')
    const cookies = chosen.headers.getSetCookie().join('; ')
    expect(cookies).toContain('bao-theme=light')
    expect(cookies).toContain(`Path=${PREFIX}`)

    const remembered = await get(PREFIX, { headers: { cookie: 'bao-theme=dark' } })
    expect(await remembered.text()).toContain('data-theme="dark"')
  })

  it('ignores an unknown theme value', async () => {
    expect(await (await get(`${PREFIX}?theme=neon`)).text()).toContain('data-theme="light"')
  })

  it('carries the current query through the theme control', async () => {
    const html = await (await get(`${PREFIX}/queues?search=abc`)).text()
    expect(html).toContain('<input type="hidden" name="search" value="abc">')
  })
})
