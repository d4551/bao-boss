import { BaoBoss } from 'bao-boss'
import { baoBossDashboard } from 'bao-boss/dashboard'
import { Elysia } from 'elysia'

interface EmailPayload { to: string; subject: string; body: string }

const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
boss.on('error', console.error)
await boss.start()

await boss.createQueue('emails-dlq')
await boss.createQueue('emails', { retryLimit: 3, retryBackoff: true, deadLetter: 'emails-dlq' })
await boss.createQueue('demo-failed', { retryLimit: 0 })

await boss.schedule('daily-digest', '0 8 * * *', { type: 'digest' })

// Durable failed jobs for dashboard bulk/retry UI (no worker on demo-failed)
for (let i = 0; i < 3; i++) {
  const id = await boss.send('demo-failed', { n: i, kind: 'demo-fail' })
  const [job] = await boss.fetch('demo-failed')
  if (job) await boss.fail(job.id, `seeded failure ${i}`)
  void id
}

for (let i = 0; i < 2; i++) {
  await boss.send<EmailPayload>('emails', { to: `user${i}@example.com`, subject: `Hello ${i}`, body: 'demo' })
}

await boss.work<EmailPayload>('emails', async ([job]) => {
  console.log(`Sending email to ${job.data.to}`)
})

const app = new Elysia()
  .use(baoBossDashboard(boss, { prefix: '/boss' }))
  .get('/', () => 'bao-boss example app')
  .post('/send-email', async ({ body }) => {
    if (!body || typeof body !== 'object') {
      return new Response('Bad Request', { status: 400 })
    }
    const payload = body as EmailPayload
    const id = await boss.send<EmailPayload>('emails', payload)
    return { id }
  })
  .listen(3000)

console.log('Listening on http://localhost:3000')
console.log('Dashboard at http://localhost:3000/boss')
