import { PrismaClient } from '@prisma/client'
import type { BaoBoss } from './BaoBoss.js'

interface MaintenanceOptions {
  intervalSeconds: number
  archiveCompletedAfterSeconds: number
  deleteArchivedAfterDays: number
}

function parseCron(cron: string): (date: Date) => boolean {
  // Simple cron check - returns true if current minute matches the cron expression
  const parts = cron.split(' ')
  if (parts.length !== 5) return () => false
  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string]

  function matchesPart(part: string, value: number): boolean {
    if (part === '*') return true
    if (part.includes('/')) {
      const stepStr = part.split('/')[1]
      const step = parseInt(stepStr ?? '1', 10)
      return value % step === 0
    }
    if (part.includes(',')) {
      return part.split(',').some(p => parseInt(p, 10) === value)
    }
    if (part.includes('-')) {
      const rangeParts = part.split('-')
      const start = parseInt(rangeParts[0] ?? '0', 10)
      const end = parseInt(rangeParts[1] ?? '0', 10)
      return value >= start && value <= end
    }
    return parseInt(part, 10) === value
  }

  return (date: Date) => {
    return (
      matchesPart(min, date.getMinutes()) &&
      matchesPart(hour, date.getHours()) &&
      matchesPart(dom, date.getDate()) &&
      matchesPart(month, date.getMonth() + 1) &&
      matchesPart(dow, date.getDay())
    )
  }
}

export class Maintenance {
  private timer: ReturnType<typeof setInterval> | null = null
  private opts: MaintenanceOptions

  constructor(
    private readonly prisma: PrismaClient,
    private readonly boss: BaoBoss,
    opts: MaintenanceOptions
  ) {
    this.opts = opts
  }

  start(): void {
    this.timer = setInterval(async () => {
      try {
        await this.run()
      } catch (err) {
        this.boss.emit('error', err)
      }
    }, this.opts.intervalSeconds * 1000)

    // Run immediately on start
    this.run().catch(err => this.boss.emit('error', err))
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async run(): Promise<void> {
    await Promise.all([
      this.expireActiveJobs(),
      this.archiveCompletedJobs(),
      this.purgeOldJobs(),
      this.fireCronSchedules(),
    ])
  }

  private async expireActiveJobs(): Promise<void> {
    // Expire jobs that have been active longer than expireIn seconds
    const expired = await this.prisma.$queryRaw<Array<{ id: string; dead_letter: string | null; data: unknown }>>`
      UPDATE baoboss.job
      SET state = 'failed',
          output = '{"error":"job expired"}'::jsonb
      WHERE state = 'active'
        AND "startedOn" + ("expireIn" || ' seconds')::interval < now()
      RETURNING id, "deadLetter" AS dead_letter, data
    `

    // Send to dead letter queues
    for (const job of expired) {
      if (job.dead_letter) {
        try {
          await this.prisma.job.create({
            data: {
              queue: job.dead_letter,
              data: job.data as never,
              policy: 'standard',
              keepUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            },
          })
        } catch (err) {
          this.boss.emit('error', err)
        }
      }
    }
  }

  private async archiveCompletedJobs(): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE baoboss.job
      SET state = 'cancelled'
      WHERE state IN ('completed', 'failed')
        AND "completedOn" < now() - (${this.opts.archiveCompletedAfterSeconds} || ' seconds')::interval
    `
  }

  private async purgeOldJobs(): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM baoboss.job
      WHERE "keepUntil" < now()
        AND state IN ('completed', 'cancelled', 'failed')
    `
  }

  private async fireCronSchedules(): Promise<void> {
    const schedules = await this.prisma.schedule.findMany()
    const now = new Date()

    for (const schedule of schedules) {
      try {
        const matches = parseCron(schedule.cron)
        if (matches(now)) {
          // Check if we already sent a job this minute
          const recentJob = await this.prisma.job.findFirst({
            where: {
              queue: schedule.name,
              createdOn: {
                gte: new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()),
              },
              singletonKey: `cron:${schedule.name}`,
            },
          })

          if (!recentJob) {
            await this.prisma.job.create({
              data: {
                queue: schedule.name,
                data: schedule.data as never,
                singletonKey: `cron:${schedule.name}`,
                policy: 'standard',
                keepUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
              },
            })
          }
        }
      } catch (err) {
        this.boss.emit('error', err)
      }
    }
  }
}
