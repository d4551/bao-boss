import { PrismaClient, Prisma } from './generated/prisma/client.js'
import { validateCron } from './cron.js'
import type { Schedule } from './types.js'

/** IANA zone names, resolved once — `supportedValuesOf` allocates ~600 entries per call. */
let supportedTimeZones: Set<string> | null = null

function isSupportedTimeZone(timeZone: string): boolean {
  supportedTimeZones ??= new Set(Intl.supportedValuesOf('timeZone'))
  if (supportedTimeZones.has(timeZone)) return true
  // UTC and a handful of zone links are valid but absent from supportedValuesOf.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

interface ScheduleRow {
  name: string
  cron: string
  timezone: string
  data: Prisma.JsonValue | null
  options: Prisma.JsonValue | null
  createdOn: Date
  updatedOn: Date
}

function toSchedule(row: ScheduleRow): Schedule {
  return {
    name: row.name,
    cron: row.cron,
    timezone: row.timezone,
    data: row.data,
    options: row.options,
    createdOn: row.createdOn,
    updatedOn: row.updatedOn,
  }
}

export class Scheduler {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Create or replace a schedule.
   *
   * Both the cron expression and the timezone are rejected up front — a
   * schedule that can never fire should fail at the call that created it, not
   * silently at every maintenance sweep.
   */
  async schedule(
    name: string,
    cron: string,
    data?: Prisma.InputJsonValue,
    options?: { tz?: string },
  ): Promise<void> {
    validateCron(cron)
    const tz = options?.tz ?? 'UTC'
    if (!isSupportedTimeZone(tz)) {
      throw new Error(`Invalid timezone: '${tz}'`)
    }

    // The timezone lives in its own column. `options` carries anything else the
    // caller attached, so the two columns never state the same fact.
    const extra: Prisma.InputJsonValue = options
      ? Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'tz'))
      : {}

    const row = { cron, timezone: tz, data: data ?? Prisma.JsonNull, options: extra }
    await this.prisma.schedule.upsert({
      where: { name },
      create: { name, ...row },
      update: row,
    })
  }

  async unschedule(name: string): Promise<void> {
    await this.prisma.schedule.delete({ where: { name } })
  }

  async getSchedules(): Promise<Schedule[]> {
    const schedules = await this.prisma.schedule.findMany({ orderBy: { name: 'asc' } })
    return schedules.map(toSchedule)
  }
}
