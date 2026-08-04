import { PrismaClient, Prisma } from './generated/prisma/client.js'
import type { BaoBoss } from './BaoBoss.js'
import { parseCron } from './cron.js'
import { createDlqJobs, type DlqRow } from './manager/dlq.js'
import { buildJobCreateData, decodeSendOptions } from './manager/job-create.js'
import { validateSchema } from './schema.js'
import {
  CRON_LOCK_RETENTION_DAYS,
  CRON_LOCK_TTL_SECONDS,
  MS_PER_SECOND,
  secondsFromNow,
} from './defaults.js'

interface MaintenanceOptions {
  schema?: string
  intervalSeconds: number
  archiveCompletedAfterSeconds: number
  deleteArchivedAfterDays: number
  dlqRetentionDays: number
}

/** Row shape returned when the expiry sweep fails active jobs. */
interface ExpiredRow {
  id: string
  queue: string
  deadLetter: string | null
  data: Prisma.JsonValue
  priority: number
  expireIn: number
  singletonKey: string | null
}

/**
 * Resolve an instant into the wall-clock fields of a timezone.
 *
 * Built from `Intl.DateTimeFormat` parts rather than re-parsing a formatted
 * string: parsing `toLocaleString` output depends on the host's format and
 * silently yields the wrong hour when it does not match what `Date` expects.
 */
export function zonedWallClock(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find(candidate => candidate.type === type)
    if (!part) throw new RangeError(`Timezone '${timeZone}' produced no ${type} field`)
    return Number(part.value)
  }

  // Some ICU builds render midnight as hour 24 under hour12:false.
  return new Date(
    field('year'), field('month') - 1, field('day'),
    field('hour') % 24, field('minute'), field('second'),
  )
}

/** The UTC minute a cron firing belongs to, used as the distributed lock key. */
export function minuteBucket(instant: Date): string {
  return `${instant.toISOString().slice(0, 16)}:00Z`
}

export class Maintenance {
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null
  private running = false
  private readonly opts: MaintenanceOptions
  private readonly schema: string
  private readonly instanceId = crypto.randomUUID()

  constructor(
    private readonly prisma: PrismaClient,
    private readonly boss: BaoBoss,
    opts: MaintenanceOptions,
  ) {
    this.opts = opts
    this.schema = validateSchema(opts.schema ?? 'baoboss')
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.runGuarded()
  }

  /** Stop scheduling and wait for an in-flight sweep so no query outlives the client. */
  async stop(): Promise<void> {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.inFlight
  }

  /**
   * Run one sweep, then schedule the next.
   *
   * Self-rescheduling rather than `setInterval`: a sweep slower than the
   * interval would otherwise stack copies of itself against the same rows.
   */
  private async runGuarded(): Promise<void> {
    const sweep = this.run().catch((err: unknown) => { this.boss.emit('error', err) })
    this.inFlight = sweep
    await sweep
    this.inFlight = null
    if (!this.running) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.runGuarded()
    }, this.opts.intervalSeconds * MS_PER_SECOND)
  }

  async run(): Promise<void> {
    await Promise.all([
      this.expireActiveJobs(),
      this.expireUnstartedJobs(),
      this.archiveCompletedJobs(),
      this.purgeOldJobs(),
      this.purgeCronLocks(),
      this.fireCronSchedules(),
    ])
  }

  private async expireUnstartedJobs(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      UPDATE "${this.schema}".job
      SET state = 'cancelled', output = '{"error":"job expired before start"}'::jsonb
      WHERE state = 'created'
        AND "expireIfNotStartedIn" IS NOT NULL
        AND "createdOn" + ("expireIfNotStartedIn" || ' seconds')::interval < now()
    `)
  }

  /**
   * Fail active jobs that outran `expireIn` and copy them to their dead-letter
   * queue. The source queue is carried through so a dead-letter entry can be
   * traced back to where the work actually failed.
   */
  private async expireActiveJobs(): Promise<void> {
    const expired = await this.prisma.$queryRawUnsafe<ExpiredRow[]>(
      `UPDATE "${this.schema}".job SET state = 'failed', output = '{"error":"job expired"}'::jsonb
       WHERE state = 'active' AND "startedOn" + ("expireIn" || ' seconds')::interval < now()
       RETURNING id, queue, "deadLetter", data, priority, "expireIn", "singletonKey"`,
    )

    const dlqJobs: DlqRow[] = expired
      .filter((row): row is ExpiredRow & { deadLetter: string } => row.deadLetter !== null)
      .map(row => ({
        id: row.id,
        queue: row.queue,
        deadLetter: row.deadLetter,
        data: row.data,
        priority: row.priority,
        expireIn: row.expireIn,
        singletonKey: row.singletonKey,
      }))

    await createDlqJobs(
      this.prisma,
      dlqJobs,
      this.opts.dlqRetentionDays,
      payload => this.boss.emit('dlq', payload),
    )
  }

  private async archiveCompletedJobs(): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE "${this.schema}".job
       SET "keepUntil" = now() + ($2 || ' days')::interval
       WHERE state IN ('completed', 'failed')
         AND COALESCE("completedOn", "createdOn") < now() - ($1 || ' seconds')::interval
         AND "keepUntil" > now() + ($2 || ' days')::interval`,
      this.opts.archiveCompletedAfterSeconds,
      this.opts.deleteArchivedAfterDays,
    )
  }

  private async purgeOldJobs(): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "${this.schema}".job
       WHERE "keepUntil" < now() AND state IN ('completed', 'cancelled', 'failed')`,
    )
  }

  /**
   * Drop expired cron locks.
   * One row is written per schedule per fired minute; without this the table
   * grows without bound for the life of the deployment.
   */
  private async purgeCronLocks(): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "${this.schema}".cron_lock
       WHERE "lockedUntil" < now() - ($1 || ' days')::interval`,
      CRON_LOCK_RETENTION_DAYS,
    )
  }

  private async fireCronSchedules(): Promise<void> {
    const schedules = await this.prisma.schedule.findMany()
    if (schedules.length === 0) return
    const now = new Date()
    const bucket = minuteBucket(now)
    const queues = await this.prisma.queue.findMany({
      where: { name: { in: schedules.map(schedule => schedule.name) } },
    })
    const queueByName = new Map(queues.map(queue => [queue.name, queue]))

    for (const schedule of schedules) {
      try {
        if (!parseCron(schedule.cron)(zonedWallClock(now, schedule.timezone || 'UTC'))) continue
        if (!(await this.acquireCronLock(schedule.name, bucket))) continue
        // Cron jobs are ordinary jobs on their queue and inherit its retry,
        // expiry and retention settings like anything else sent to it.
        const opts = decodeSendOptions({ singletonKey: `cron:${schedule.name}` })
        await this.prisma.job.create({
          data: buildJobCreateData(
            schedule.name,
            schedule.data ?? null,
            opts,
            queueByName.get(schedule.name) ?? null,
          ),
        })
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.boss.emit('error', new Error(`Failed to fire schedule "${schedule.name}": ${error.message}`))
      }
    }
  }

  /** Claim the right to fire one schedule for one minute across every instance. */
  private async acquireCronLock(scheduleName: string, bucket: string): Promise<boolean> {
    const acquired = await this.prisma.$queryRawUnsafe<Array<{ scheduleName: string }>>(
      `INSERT INTO "${this.schema}".cron_lock ("scheduleName", "minuteBucket", "lockedUntil", "instanceId")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("scheduleName", "minuteBucket") DO UPDATE
       SET "lockedUntil" = EXCLUDED."lockedUntil", "instanceId" = EXCLUDED."instanceId"
       WHERE "${this.schema}".cron_lock."lockedUntil" < now()
       RETURNING "scheduleName"`,
      scheduleName,
      bucket,
      secondsFromNow(CRON_LOCK_TTL_SECONDS),
      this.instanceId,
    )
    return acquired.length > 0
  }
}
