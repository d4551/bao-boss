#!/usr/bin/env bun
/**
 * The `bao` command.
 *
 * Each command opens a connection, does one thing, reports what actually
 * happened, and exits with a status that reflects it. Output is operator-facing
 * English; the message catalogue in i18n.ts owns the dashboard's copy, which is
 * a different surface with a different audience.
 */
import { BaoBoss } from './BaoBoss.js'
import { migrate as runMigrate } from './Migrate.js'
import { describeCron } from './cron-describe.js'

interface CliResult {
  /** Lines to print. */
  output: string[]
  /** Process exit status. Non-zero when the command could not do its job. */
  status: number
}

function ok(...output: string[]): CliResult {
  return { output, status: 0 }
}

function fail(...output: string[]): CliResult {
  return { output, status: 1 }
}

export const USAGE = `bao-boss CLI

Commands:
  bao migrate             Apply pending migrations and record the schema version
  bao queues              List queues with their pending counts
  bao purge <queue>       Delete waiting jobs from a queue
  bao retry <id>          Re-enqueue one failed or cancelled job
  bao schedule:ls         List cron schedules
  bao schedule:rm <name>  Remove a cron schedule
  bao help                Show this message
`

async function cmdMigrate(boss: BaoBoss): Promise<CliResult> {
  await runMigrate(boss.prisma)
  return ok('Migrations applied.')
}

async function cmdQueues(boss: BaoBoss): Promise<CliResult> {
  const queues = await boss.getQueues()
  if (queues.length === 0) return ok('No queues.')
  // One grouped query rather than one per queue.
  const sizes = await boss.getQueueSizes(queues.map(queue => queue.name))
  return ok(
    'Queues:',
    ...queues.map(queue => `  ${queue.name} (${queue.policy}) — ${sizes.get(queue.name) ?? 0} pending`),
  )
}

async function cmdPurge(boss: BaoBoss, queueName: string): Promise<CliResult> {
  if (!(await boss.getQueue(queueName))) {
    return fail(`No such queue: ${queueName}`)
  }
  const before = await boss.getQueueSize(queueName, { before: 'active' })
  await boss.purgeQueue(queueName)
  return ok(`Purged ${before} waiting job(s) from ${queueName}.`)
}

async function cmdRetry(boss: BaoBoss, id: string): Promise<CliResult> {
  const job = await boss.getJobById(id)
  if (!job) return fail(`No such job: ${id}`)
  if (job.state !== 'failed' && job.state !== 'cancelled') {
    return fail(`Job ${id} is ${job.state}; only failed or cancelled jobs can be retried.`)
  }
  await boss.resume(id)
  return ok(`Re-enqueued ${id} on ${job.queue}.`)
}

async function cmdScheduleList(boss: BaoBoss): Promise<CliResult> {
  const schedules = await boss.getSchedules()
  if (schedules.length === 0) return ok('No schedules.')
  return ok(...schedules.map(schedule => {
    let description: string
    try {
      description = describeCron(schedule.cron)
    } catch {
      description = 'unreadable'
    }
    return `  ${schedule.name}: ${schedule.cron} (${schedule.timezone}) — ${description}`
  }))
}

async function cmdScheduleRemove(boss: BaoBoss, name: string): Promise<CliResult> {
  const existing = await boss.getSchedules()
  if (!existing.some(schedule => schedule.name === name)) {
    return fail(`No such schedule: ${name}`)
  }
  await boss.unschedule(name)
  return ok(`Removed schedule: ${name}`)
}

/**
 * Run one command against an already-started instance.
 * Returns what to print and the status to exit with, so the behaviour is
 * testable without spawning a process or capturing stdout.
 */
export async function runCommand(
  boss: BaoBoss,
  command: string | undefined,
  args: readonly string[],
): Promise<CliResult> {
  switch (command) {
    case 'migrate':
      return cmdMigrate(boss)
    case 'queues':
      return cmdQueues(boss)
    case 'purge': {
      const queue = args[0]
      return queue ? cmdPurge(boss, queue) : fail('Usage: bao purge <queue>')
    }
    case 'retry': {
      const id = args[0]
      return id ? cmdRetry(boss, id) : fail('Usage: bao retry <id>')
    }
    case 'schedule:ls':
      return cmdScheduleList(boss)
    case 'schedule:rm': {
      const name = args[0]
      return name ? cmdScheduleRemove(boss, name) : fail('Usage: bao schedule:rm <name>')
    }
    case 'help':
    case undefined:
      return ok(USAGE)
    default:
      // An unrecognised command is a mistake, so say so and exit non-zero
      // rather than printing help as though nothing were wrong.
      return fail(`Unknown command: ${command}`, '', USAGE)
  }
}

/** Commands that need neither a connection nor DATABASE_URL. */
const OFFLINE_COMMANDS = new Set(['help', undefined])

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv

  if (OFFLINE_COMMANDS.has(command)) {
    console.log(USAGE)
    return
  }

  const connectionString = Bun.env['DATABASE_URL']
  if (!connectionString) {
    console.error('DATABASE_URL is not set.')
    process.exit(1)
  }

  const boss = new BaoBoss({ connectionString, noSupervisor: true })
  try {
    await boss.start()
    const result = await runCommand(boss, command, args)
    for (const line of result.output) {
      if (result.status === 0) console.log(line)
      else console.error(line)
    }
    if (result.status !== 0) process.exitCode = result.status
  } finally {
    await boss.stop()
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
