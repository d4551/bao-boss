#!/usr/bin/env bun
import { BaoBoss } from './BaoBoss.js'

const [,, command, ...args] = process.argv

const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] ?? '' })

async function main() {
  switch (command) {
    case 'migrate': {
      const proc = Bun.spawn(['bunx', 'prisma', 'migrate', 'deploy'], {
        cwd: import.meta.dir + '/..',
        stdout: 'inherit',
        stderr: 'inherit',
        env: Bun.env,
      })
      const exitCode = await proc.exited
      if (exitCode !== 0) process.exit(exitCode)
      break
    }
    case 'migrate:reset': {
      const proc = Bun.spawn(['bunx', 'prisma', 'migrate', 'reset', '--force'], {
        cwd: import.meta.dir + '/..',
        stdout: 'inherit',
        stderr: 'inherit',
        env: Bun.env,
      })
      const exitCode = await proc.exited
      if (exitCode !== 0) process.exit(exitCode)
      break
    }
    case 'queues': {
      await boss.start()
      const queues = await boss.getQueues()
      if (queues.length === 0) {
        console.log('No queues found.')
      } else {
        console.log('Queues:')
        for (const q of queues) {
          const size = await boss.getQueueSize(q.name)
          console.log(`  ${q.name} (${q.policy}) — ${size} pending`)
        }
      }
      await boss.stop()
      break
    }
    case 'purge': {
      const queue = args[0]
      if (!queue) { console.error('Usage: bao purge <queue>'); process.exit(1) }
      await boss.start()
      await boss.purgeQueue(queue)
      console.log(`Purged queue: ${queue}`)
      await boss.stop()
      break
    }
    case 'retry': {
      const id = args[0]
      if (!id) { console.error('Usage: bao retry <id>'); process.exit(1) }
      await boss.start()
      await boss.resume(id)
      console.log(`Retrying job: ${id}`)
      await boss.stop()
      break
    }
    case 'schedule:ls': {
      await boss.start()
      const schedules = await boss.getSchedules()
      if (schedules.length === 0) {
        console.log('No schedules.')
      } else {
        for (const s of schedules) {
          console.log(`  ${s.name}: ${s.cron} (${s.timezone})`)
        }
      }
      await boss.stop()
      break
    }
    case 'schedule:rm': {
      const name = args[0]
      if (!name) { console.error('Usage: bao schedule:rm <name>'); process.exit(1) }
      await boss.start()
      await boss.unschedule(name)
      console.log(`Removed schedule: ${name}`)
      await boss.stop()
      break
    }
    default: {
      console.log(`bao-boss CLI

Commands:
  bao migrate           Run pending Prisma migrations
  bao migrate:reset     Drop & recreate the baoboss schema
  bao queues            List all queues and job counts
  bao purge <queue>     Purge pending jobs from a queue
  bao retry <id>        Re-enqueue a specific failed job
  bao schedule:ls       List all cron schedules
  bao schedule:rm <name>  Remove a cron schedule
`)
      break
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
