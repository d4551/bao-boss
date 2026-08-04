import { BaoBoss } from 'bao-boss'
import { baoBossDashboard } from 'bao-boss/dashboard'
import { Elysia } from 'elysia'

interface EmailPayload { to: string; subject: string; body: string }

const PORT = Number(Bun.env['PORT'] ?? 3000)

const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
boss.on('error', error => console.error('[bao-boss]', error))
boss.on('dlq', event => console.warn('[bao-boss] dead letter', event))
await boss.start()

// ── Queues ─────────────────────────────────────────────────────────
await boss.createQueue('emails-dlq')
await boss.createQueue('emails', { retryLimit: 3, retryBackoff: true, deadLetter: 'emails-dlq' })
await boss.createQueue('reports', { retentionDays: 3 })
await boss.createQueue('demo-failed', { retryLimit: 0 })

await boss.schedule('reports', '0 8 * * 1-5', { type: 'digest' }, { tz: 'Europe/Berlin' })
await boss.schedule('emails', '*/15 * * * *', { type: 'flush' })

// ── Seeded work ────────────────────────────────────────────────────
// Enough rows for the queue view to paginate rather than silently truncate.
await boss.insert(
  Array.from({ length: 40 }, (_, index) => ({
    name: 'reports',
    data: { region: index % 2 === 0 ? 'emea' : 'amer', index },
    options: { priority: index % 5 },
  })),
)

// Durable failures so the dead-letter and retry paths have something to show.
for (let index = 0; index < 3; index++) {
  await boss.send('demo-failed', { index, kind: 'demo-fail' })
  const [job] = await boss.fetch('demo-failed')
  if (job) await boss.fail(job.id, `seeded failure ${index}`)
}

for (let index = 0; index < 4; index++) {
  await boss.send<EmailPayload>('emails', {
    to: `user${index}@example.com`,
    subject: `Hello ${index}`,
    body: 'demo',
  })
}

// ── Workers ────────────────────────────────────────────────────────
await boss.work<EmailPayload>(
  'emails',
  { batchSize: 2, handlerTimeoutSeconds: 10 },
  async (jobs, { signal }) => {
    for (const job of jobs) {
      if (signal.aborted) return
      console.log(`Sending email to ${job.data.to}`)
    }
  },
)

// ── HTTP ───────────────────────────────────────────────────────────
const app = new Elysia()
  .use(baoBossDashboard(boss, { prefix: '/boss' }))
  .get('/', () => 'bao-boss example app — dashboard at /boss')
  .post('/send-email', async ({ body, set }) => {
    if (!body || typeof body !== 'object') {
      set.status = 400
      return { error: 'Expected a JSON object' }
    }
    const payload = body as EmailPayload
    return { id: await boss.send<EmailPayload>('emails', payload) }
  })
  .listen(PORT)

console.log(`Listening on http://localhost:${PORT}`)
console.log(`Dashboard at http://localhost:${PORT}/boss`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.stop().then(() => boss.stop()).then(() => process.exit(0))
  })
}
