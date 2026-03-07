import { PrismaClient } from './generated/prisma/client.js'
import type { Schedule } from './types.js'

export class Scheduler {
  constructor(private readonly prisma: PrismaClient) {}

  async schedule(name: string, cron: string, data?: unknown, options?: { tz?: string }): Promise<void> {
    await this.prisma.schedule.upsert({
      where: { name },
      create: {
        name,
        cron,
        timezone: options?.tz ?? 'UTC',
        data: data as never,
        options: options as never,
      },
      update: {
        cron,
        timezone: options?.tz ?? 'UTC',
        data: data as never,
        options: options as never,
      },
    })
  }

  async unschedule(name: string): Promise<void> {
    await this.prisma.schedule.delete({ where: { name } })
  }

  async getSchedules(): Promise<Schedule[]> {
    const schedules = await this.prisma.schedule.findMany()
    return schedules as unknown as Schedule[]
  }

  async getSchedulesDue(): Promise<Schedule[]> {
    // Return all schedules — the maintenance loop checks if they're due
    return this.getSchedules()
  }
}
