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

await boss.work<EmailPayload>('emails', async ([job]) => {
  console.log(`Sending email to ${job.data.to}`)
})

const app = new Elysia()
  .use(baoBossDashboard(boss, { prefix: '/boss' }))
  .get('/', () => 'bao-boss example app')
  .post('/send-email', async ({ body }) => {
    const id = await boss.send<EmailPayload>('emails', body as EmailPayload)
    return { id }
  })
  .listen(3000)

console.log('Listening on http://localhost:3000')
console.log('Dashboard at http://localhost:3000/boss')
