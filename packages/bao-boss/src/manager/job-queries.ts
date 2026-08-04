import { PrismaClient, Prisma } from '../generated/prisma/client.js'
import { Value } from '@sinclair/typebox/value'
import type { Job, JobSearchOptions, JobState } from '../types.js'
import { SEARCH_LIMIT_DEFAULT } from '../defaults.js'
import { jobSearchSchema, toDomainJob } from './mappers.js'

/** States a job can be brought back from. */
const RESUMABLE_STATES: readonly JobState[] = ['cancelled', 'failed']
/** States a job can be cancelled from. */
const CANCELLABLE_STATES: readonly JobState[] = ['created', 'active']
/** States that still count as outstanding dead-letter work. */
const DLQ_PENDING_STATES: readonly JobState[] = ['created', 'active']

export class JobQueries {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Page through jobs.
   *
   * The filter is validated like every other public input, and `limit` is capped
   * by the schema — an unbounded page size is a denial-of-service vector, not a
   * convenience.
   */
  async searchJobs<T = unknown>(filter: JobSearchOptions = {}): Promise<{ jobs: Job<T>[]; total: number }> {
    const opts = Value.Decode(jobSearchSchema, filter)
    const where: Prisma.JobWhereInput = {}
    if (opts.queue !== undefined) where.queue = opts.queue
    if (opts.state !== undefined) {
      where.state = Array.isArray(opts.state) ? { in: opts.state } : opts.state
    }

    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { [opts.sortBy ?? 'createdOn']: opts.sortOrder ?? 'desc' },
        take: opts.limit ?? SEARCH_LIMIT_DEFAULT,
        skip: opts.offset ?? 0,
      }),
      this.prisma.job.count({ where }),
    ])

    return { jobs: jobs.map(job => toDomainJob<T>(job)), total }
  }

  async getJobDependencies<T = unknown>(jobId: string): Promise<{ dependsOn: Job<T>[]; dependedBy: Job<T>[] }> {
    const [upstream, downstream] = await Promise.all([
      this.prisma.jobDependency.findMany({ where: { jobId }, select: { dependsOnId: true } }),
      this.prisma.jobDependency.findMany({ where: { dependsOnId: jobId }, select: { jobId: true } }),
    ])

    const [dependsOnJobs, dependedByJobs] = await Promise.all([
      this.findByIds(upstream.map(dep => dep.dependsOnId)),
      this.findByIds(downstream.map(dep => dep.jobId)),
    ])

    return {
      dependsOn: dependsOnJobs.map(job => toDomainJob<T>(job)),
      dependedBy: dependedByJobs.map(job => toDomainJob<T>(job)),
    }
  }

  private async findByIds(ids: string[]) {
    if (ids.length === 0) return []
    return this.prisma.job.findMany({ where: { id: { in: ids } } })
  }

  /**
   * Record progress on an active job.
   * Returns whether a row actually changed, so callers do not announce progress
   * for a job that has already finished.
   */
  async progress(id: string, value: number): Promise<boolean> {
    const percent = Math.min(100, Math.max(0, Math.round(value)))
    const result = await this.prisma.job.updateMany({
      where: { id, state: 'active' },
      data: { progress: percent },
    })
    return result.count > 0
  }

  async getJobById<T = unknown>(id: string): Promise<Job<T> | null> {
    const job = await this.prisma.job.findUnique({ where: { id } })
    return job ? toDomainJob<T>(job) : null
  }

  async getJobsById<T = unknown>(ids: string[]): Promise<Job<T>[]> {
    const jobs = await this.findByIds(ids)
    return jobs.map(job => toDomainJob<T>(job))
  }

  /** Outstanding entries in a dead-letter queue — work an operator still has to triage. */
  async getDLQDepth(deadLetterQueueName: string): Promise<number> {
    return this.prisma.job.count({
      where: { queue: deadLetterQueueName, state: { in: [...DLQ_PENDING_STATES] } },
    })
  }

  async cancel(id: string | string[]): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    if (ids.length === 0) return
    await this.prisma.job.updateMany({
      where: { id: { in: ids }, state: { in: [...CANCELLABLE_STATES] } },
      data: { state: 'cancelled' },
    })
  }

  async resume(id: string | string[]): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    if (ids.length === 0) return
    await this.prisma.job.updateMany({
      where: { id: { in: ids }, state: { in: [...RESUMABLE_STATES] } },
      data: { state: 'created', retryCount: 0 },
    })
  }

  async cancelJobs(queue: string, filter?: { state?: 'created' | 'active' }): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: { queue, state: { in: filter?.state ? [filter.state] : [...CANCELLABLE_STATES] } },
      data: { state: 'cancelled' },
    })
    return result.count
  }

  async resumeJobs(queue: string, filter?: { state?: 'failed' | 'cancelled' }): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: { queue, state: { in: filter?.state ? [filter.state] : [...RESUMABLE_STATES] } },
      data: { state: 'created', retryCount: 0 },
    })
    return result.count
  }
}
