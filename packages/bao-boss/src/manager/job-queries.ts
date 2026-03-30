import { PrismaClient, Prisma } from '../generated/prisma/client.js'
import type { Job } from '../types.js'
import { toDomainJob } from './mappers.js'

export class JobQueries {
  constructor(private readonly prisma: PrismaClient) {}

  async searchJobs<T = unknown>(filter: import('../types.js').JobSearchOptions = {}): Promise<{ jobs: Job<T>[]; total: number }> {
    const where: Prisma.JobWhereInput = {}
    if (filter.queue) where.queue = filter.queue
    if (filter.state) {
      where.state = Array.isArray(filter.state) ? { in: filter.state } : filter.state
    }
    const limit = filter.limit ?? 50
    const offset = filter.offset ?? 0
    const sortBy = filter.sortBy ?? 'createdOn'
    const sortOrder = filter.sortOrder ?? 'desc'

    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        take: limit,
        skip: offset,
      }),
      this.prisma.job.count({ where }),
    ])

    return {
      jobs: jobs.map(j => toDomainJob<T>(j)),
      total,
    }
  }

  async getJobDependencies<T = unknown>(jobId: string): Promise<{ dependsOn: Job<T>[]; dependedBy: Job<T>[] }> {
    const [upstream, downstream] = await Promise.all([
      this.prisma.jobDependency.findMany({
        where: { jobId },
        select: { dependsOnId: true },
      }),
      this.prisma.jobDependency.findMany({
        where: { dependsOnId: jobId },
        select: { jobId: true },
      }),
    ])

    const [dependsOnJobs, dependedByJobs] = await Promise.all([
      upstream.length > 0
        ? this.prisma.job.findMany({ where: { id: { in: upstream.map(d => d.dependsOnId) } } })
        : [],
      downstream.length > 0
        ? this.prisma.job.findMany({ where: { id: { in: downstream.map(d => d.jobId) } } })
        : [],
    ])

    return {
      dependsOn: dependsOnJobs.map(j => toDomainJob<T>(j)),
      dependedBy: dependedByJobs.map(j => toDomainJob<T>(j)),
    }
  }

  async progress(id: string, value: number): Promise<void> {
    const p = Math.min(100, Math.max(0, Math.round(value)))
    await this.prisma.job.updateMany({
      where: { id, state: 'active' },
      data: { progress: p },
    })
  }

  async getJobById<T = unknown>(id: string): Promise<Job<T> | null> {
    const job = await this.prisma.job.findUnique({ where: { id } })
    if (!job) return null
    return toDomainJob<T>(job)
  }

  async getJobsById<T = unknown>(ids: string[]): Promise<Job<T>[]> {
    const jobs = await this.prisma.job.findMany({ where: { id: { in: ids } } })
    return jobs.map(j => toDomainJob<T>(j))
  }

  async getDLQDepth(deadLetterQueueName: string): Promise<number> {
    return this.prisma.job.count({
      where: { queue: deadLetterQueueName },
    })
  }

  async cancelJobs(queue: string, filter?: { state?: 'created' | 'active' }): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: {
        queue,
        state: { in: filter?.state ? [filter.state] : ['created', 'active'] },
      },
      data: { state: 'cancelled' },
    })
    return result.count
  }

  async resumeJobs(queue: string, filter?: { state?: 'failed' | 'cancelled' }): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: {
        queue,
        state: { in: filter?.state ? [filter.state] : ['cancelled', 'failed'] },
      },
      data: { state: 'created', retryCount: 0 },
    })
    return result.count
  }
}
