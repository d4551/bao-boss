import { PrismaClient } from './generated/prisma/client.js'
import type { BaoBoss } from './BaoBoss.js'

const SCHEMA_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function validateSchema(schema: string): string {
  if (!SCHEMA_RE.test(schema)) throw new Error('Invalid schema name')
  return schema
}

interface MaintenanceOptions {
  schema?: string
  intervalSeconds: number
  archiveCompletedAfterSeconds: number
  deleteArchivedAfterDays: number
}

/**
 * Minimal 5-field cron parser: "minute hour day-of-month month day-of-week"
 *
 * Supported syntax per field:
 *   *          matches any value
 *   N          exact value
 *   N,M,...    comma-separated list of values
 *   N-M        inclusive range
 *   *\/N or N\/N  step (e.g. *\/5 = every 5 units)
 *
 * Limitations:
 *   - No @yearly / @monthly / @weekly / @daily / @hourly aliases
 *   - No L (last), W (weekday), # (nth weekday) modifiers
 *   - Seconds field not supported (standard 5-field only)
 *   - Timezone handling is left to the caller
 */
function parseCron(cron: string): (date: Date) => boolean {
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
  private readonly schema: string

  constructor(
    private readonly prisma: PrismaClient,
    private readonly boss: BaoBoss,
    opts: MaintenanceOptions
  ) {
    this.opts = opts
    this.schema = validateSchema(opts.schema ?? 'baoboss')
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
      this.expireUnstartedJobs(),
      this.archiveCompletedJobs(),
      this.purgeOldJobs(),
      this.flushDebounceStates(),
      this.fireCronSchedules(),
    ])
  }

  private async flushDebounceStates(): Promise<void> {
    const ready = await this.prisma.debounceState.findMany({
      where: { debounceUntil: { lt: new Date() } },
    })
    for (const state of ready) {
      try {
        const items = (state.dataAggregate as unknown[]) ?? []
        await this.prisma.job.create({
          data: {
            queue: state.queue,
            data: { _batched: true, items } as never,
            policy: 'standard',
            keepUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          },
        })
        await this.prisma.debounceState.delete({
          where: { queue_debounceKey: { queue: state.queue, debounceKey: state.debounceKey } },
        })
      } catch (err) {
        this.boss.emit('error', err)
      }
    }
  }

  private async expireUnstartedJobs(): Promise<void> {
    const s = this.schema
    await this.prisma.$executeRawUnsafe(`
      UPDATE "${s}".job
      SET state = 'cancelled', output = '{"error":"job expired before start"}'::jsonb
      WHERE state = 'created'
        AND "expireIfNotStartedIn" IS NOT NULL
        AND "createdOn" + ("expireIfNotStartedIn" || ' seconds')::interval < now()
    `)
  }

  private async expireActiveJobs(): Promise<void> {
    const s = this.schema
    const expired = await this.prisma.$queryRawUnsafe<Array<{ id: string; dead_letter: string | null; data: unknown }>>(
      `UPDATE "${s}".job SET state = 'failed', output = '{"error":"job expired"}'::jsonb
       WHERE state = 'active' AND "startedOn" + ("expireIn" || ' seconds')::interval < now()
       RETURNING id, "deadLetter" AS dead_letter, data`
    )

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
    const s = this.schema
    await this.prisma.$executeRawUnsafe(
      `UPDATE "${s}".job
       SET "keepUntil" = now() + ($2 || ' days')::interval
       WHERE state IN ('completed', 'failed')
         AND COALESCE("completedOn", "createdOn") < now() - ($1 || ' seconds')::interval
         AND "keepUntil" > now() + ($2 || ' days')::interval`,
      this.opts.archiveCompletedAfterSeconds,
      this.opts.deleteArchivedAfterDays
    )
  }

  private async purgeOldJobs(): Promise<void> {
    const s = this.schema
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "${s}".job WHERE "keepUntil" < now() AND state IN ('completed', 'cancelled', 'failed')`
    )
  }

  private async fireCronSchedules(): Promise<void> {
    const schedules = await this.prisma.schedule.findMany()
    const now = new Date()
    const minuteBucket = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:00Z`
    const instanceId = `instance-${Math.random().toString(36).slice(2, 10)}`
    const lockedUntil = new Date(Date.now() + 120_000) // 2 min TTL

    for (const schedule of schedules) {
      try {
        const matches = parseCron(schedule.cron)
        const tz = (schedule.timezone as string) || 'UTC'
        const tzNow = new Date(now.toLocaleString('en-US', { timeZone: tz }))
        if (matches(tzNow)) {
          // Distributed lock: only one instance fires per minute
          const s = this.schema
          const acquired = await this.prisma.$queryRawUnsafe<Array<{ scheduleName: string }>>(
            `INSERT INTO "${s}".cron_lock ("scheduleName", "minuteBucket", "lockedUntil", "instanceId")
             VALUES ($1, $2, $3, $4)
             ON CONFLICT ("scheduleName", "minuteBucket") DO UPDATE
             SET "lockedUntil" = EXCLUDED."lockedUntil", "instanceId" = EXCLUDED."instanceId"
             WHERE "${s}".cron_lock."lockedUntil" < now()
             RETURNING "scheduleName"`,
            schedule.name,
            minuteBucket,
            lockedUntil,
            instanceId
          )
          if (acquired.length === 0) continue

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
      } catch (err) {
        this.boss.emit('error', err)
      }
    }
  }
}
