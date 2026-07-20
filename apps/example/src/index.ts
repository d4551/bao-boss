import { BaoBoss } from 'bao-boss'
import { baoBossDashboard } from 'bao-boss/dashboard'
import { Elysia } from 'elysia'

interface EmailPayload { to: string; subject: string; body: string }

const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
boss.on('error', console.error)
await boss.start()

await boss.createQueue('emails-dlq')
await boss.createQueue('emails', { retryLimit: 3, retryBackoff: true, deadLetter: 'emails-dlq' })

await boss.schedule('daily-digest', '0 8 * * *', { type: 'digest' })

// Seed demo jobs for dashboard visual QA (idempotent-ish via unique payloads)
for (let i = 0; i < 3; i++) {
  await boss.send<EmailPayload>('emails', { to: `user${i}@example.com`, subject: `Hello ${i}`, body: 'demo' })
}
const failId = await boss.send<EmailPayload>('emails', { to: 'fail@example.com', subject: 'fail-me', body: 'demo' })
const [fetched] = await boss.fetch('emails')
if (fetched) {
  await boss.fail(fetched.id, 'seeded failure for dashboard')
}
void failId

await boss.work<EmailPayload>('emails', async ([job]) => {
  console.log(`Sending email to ${job.data.to}`)
})

const app = new Elysia()
  .use(baoBossDashboard(boss, { prefix: '/boss' }))
  .get('/', () => 'bao-boss example app')
  .post('/send-email', async ({ body }) => {
    const payload = body as EmailPayload
    const id = await boss.send<EmailPayload>('emails', payload)
    return { id }
  })
  .listen(3000)

console.log('Listening on http://localhost:3000')
console.log('Dashboard at http://localhost:3000/boss')
