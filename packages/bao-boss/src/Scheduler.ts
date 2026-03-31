import { PrismaClient, Prisma } from './generated/prisma/client.js'
import { validateCron } from './cron.js'
import type { Schedule } from './types.js'

function toSchedule(row: { name: string; cron: string; timezone: string; data: Prisma.JsonValue | null; options: Prisma.JsonValue | null; createdOn: Date; updatedOn: Date }): Schedule {
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

  async schedule(name: string, cron: string, data?: Prisma.InputJsonValue, options?: { tz?: string }): Promise<void> {
    validateCron(cron)
    const tz = options?.tz ?? 'UTC'
    if (!Intl.supportedValuesOf('timeZone').includes(tz)) {
      throw new Error(`Invalid timezone: '${tz}'`)
    }

    const jsonOptions: Prisma.InputJsonValue | undefined = tz !== 'UTC' ? { tz } : undefined

    await this.prisma.schedule.upsert({
      where: { name },
      create: {
        name,
        cron,
        timezone: tz,
        data: data ?? Prisma.JsonNull,
        options: jsonOptions ?? Prisma.JsonNull,
      },
      update: {
        cron,
        timezone: tz,
        data: data ?? Prisma.JsonNull,
        options: jsonOptions ?? Prisma.JsonNull,
      },
    })
  }

  async unschedule(name: string): Promise<void> {
    await this.prisma.schedule.delete({ where: { name } })
  }

  async getSchedules(): Promise<Schedule[]> {
    const schedules = await this.prisma.schedule.findMany()
    return schedules.map(toSchedule)
  }

  async getSchedulesDue(): Promise<Schedule[]> {
    // Return all schedules — the maintenance loop checks if they're due
    return this.getSchedules()
  }
}
