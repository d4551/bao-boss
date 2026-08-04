import { PrismaClient } from '../generated/prisma/client.js'
import type { Job, SendOptions } from '../types.js'
import { DLQ_RETENTION_DAYS, secondsFromNow } from '../defaults.js'
import { toDomainJob, toJsonInput, type JobRow, type ManagerOptions } from './mappers.js'
import { createJobs, decodeSendOptions, type JobRequest, type QueueDefaultsSource } from './job-create.js'
import { createDlqJobs } from './dlq.js'
import { buildFetchQuery, effectiveBatchSize, rateLimitRemaining } from './job-fetch.js'

/** Reserved singleton key that owns a queue's open debounce batch. */
function debounceKeyFor(queue: string): string {
  return `debounce:${queue}`
}

const textEncoder = new TextEncoder()

/** Create exactly one job through the shared creation path. */
async function createJobRow(
  client: Pick<PrismaClient, 'job' | 'jobDependency'>,
  request: JobRequest,
): Promise<string> {
  const [id] = await createJobs(client, [request])
  if (!id) throw new Error(`Failed to create a job on queue '${request.queue}'`)
  return id
}

export class JobOps {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly schema: string,
    private readonly options: ManagerOptions,
  ) {}

  private assertPayloadWithinLimit(data: unknown): void {
    const maxBytes = this.options.maxPayloadBytes
    if (!maxBytes || data === undefined) return
    let json: string
    try {
      json = JSON.stringify(data)
    } catch {
      throw new Error('Job payload cannot be serialized to JSON (circular reference or invalid type)')
    }
    const size = textEncoder.encode(json).byteLength
    if (size > maxBytes) {
      throw new Error(`Job payload size ${size} bytes exceeds maximum of ${maxBytes} bytes`)
    }
  }

  /**
   * Fold a send into the queue's open debounce batch, or open a new one.
   *
   * The batch is an ordinary job holding the reserved debounce singleton key, so
   * it has a real id, obeys the queue's retention and retry settings, and is
   * fetched by the normal path once its window closes.
   */
  private async appendToDebounceBatch(
    queueName: string,
    data: unknown,
    debounceSeconds: number,
    queue: QueueDefaultsSource,
  ): Promise<string> {
    const singletonKey = debounceKeyFor(queueName)
    const startAfter = secondsFromNow(debounceSeconds)
    const open = await this.prisma.job.findFirst({
      where: { queue: queueName, singletonKey, state: 'created' },
      select: { id: true, data: true },
    })
    if (open) {
      const current = open.data
      const items = isBatchPayload(current) ? current.items : []
      const updated = await this.prisma.job.updateMany({
        where: { id: open.id, state: 'created' },
        data: { data: toJsonInput({ _batched: true, items: [...items, data] }), startAfter },
      })
      // The batch was fetched between the read and the write; open a fresh window.
      if (updated.count > 0) return open.id
    }
    return createJobRow(this.prisma, {
      queue: queueName,
      data: { _batched: true, items: [data] },
      opts: decodeSendOptions({ singletonKey, startAfter }),
      queueRow: queue,
    })
  }

  async send<T = unknown>(name: string, data?: T, options: SendOptions = {}): Promise<string> {
    this.assertPayloadWithinLimit(data)
    const opts = decodeSendOptions(options)
    const queue = await this.prisma.queue.findUnique({ where: { name } })

    if (queue) {
      if (queue.debounce && queue.debounce > 0) {
        return this.appendToDebounceBatch(name, data, queue.debounce, queue)
      }
      const collapsed = await this.collapseByPolicy(name, queue.policy)
      if (collapsed) return collapsed
    }
    return createJobRow(this.prisma, { queue: name, data, opts, queueRow: queue })
  }

  /** `short` and `stately` queues hold at most one waiting job; a send collapses onto it. */
  private async collapseByPolicy(name: string, policy: string): Promise<string | null> {
    if (policy !== 'short' && policy !== 'stately') return null
    const existing = await this.prisma.job.findFirst({
      where: { queue: name, state: 'created' },
      orderBy: { createdOn: 'asc' },
      select: { id: true },
    })
    return existing?.id ?? null
  }

  async insert(jobs: Array<{ name: string; data?: unknown; options?: SendOptions }>): Promise<string[]> {
    for (const entry of jobs) this.assertPayloadWithinLimit(entry.data)
    if (jobs.length === 0) return []
    // One lookup for every distinct queue rather than one per job.
    const names = [...new Set(jobs.map(entry => entry.name))]
    const queueRows = await this.prisma.queue.findMany({ where: { name: { in: names } } })
    const queues = new Map(queueRows.map(row => [row.name, row]))

    const requests: JobRequest[] = jobs.map(entry => ({
      queue: entry.name,
      data: entry.data,
      opts: decodeSendOptions(entry.options),
      queueRow: queues.get(entry.name) ?? null,
    }))
    return this.prisma.$transaction(tx => createJobs(tx, requests))
  }

  async fetch<T = unknown>(queue: string, options: { batchSize?: number } = {}): Promise<Job<T>[]> {
    const queueRow = await this.prisma.queue.findUnique({ where: { name: queue } })
    if (!queueRow || queueRow.paused) return []

    const remaining = await rateLimitRemaining(this.prisma, queue, queueRow.rateLimit)
    if (remaining === 0) return []

    if (queueRow.policy === 'singleton' || queueRow.policy === 'stately') {
      const activeCount = await this.prisma.job.count({ where: { queue, state: 'active' } })
      if (activeCount > 0) return []
    }

    const batchSize = effectiveBatchSize(options.batchSize, queueRow.policy, remaining)
    if (batchSize <= 0) return []

    const { query, params } = buildFetchQuery(this.schema, queue, queueRow.fairness, batchSize)
    const rows = await this.prisma.$queryRawUnsafe<JobRow[]>(query, ...params)
    return rows.map(row => toDomainJob<T>(row))
  }

  /**
   * Mark active jobs completed in one statement.
   *
   * `undefined` output means "no output"; every other value — including `0`,
   * `''` and `false` — is stored, so a handler's legitimate falsy result is not
   * silently replaced with null.
   */
  async complete(id: string | string[], options: { output?: unknown } = {}): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    if (ids.length === 0) return
    const output = 'output' in options && options.output !== undefined
      ? JSON.stringify(toJsonInput(options.output, 'output'))
      : null
    await this.prisma.$executeRawUnsafe(
      `UPDATE "${this.schema}".job
       SET state = 'completed', "completedOn" = now(), output = $1::jsonb
       WHERE id = ANY($2::uuid[]) AND state = 'active'`,
      output,
      ids,
    )
  }

  async fail(id: string | string[], error?: Error | string): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    if (ids.length === 0) return
    const errorMsg = error instanceof Error ? error.message : (error ?? 'Unknown error')
    const output = JSON.stringify({ error: errorMsg })

    const jobs = await this.prisma.job.findMany({ where: { id: { in: ids }, state: 'active' } })
    if (jobs.length === 0) return

    const s = this.schema
    const retryJobs = jobs.filter(job => job.retryCount < job.retryLimit)
    for (const job of retryJobs) {
      await this.options.onRetry?.(toDomainJob(job), new Error(errorMsg))
    }

    await this.prisma.$executeRawUnsafe(
      `UPDATE "${s}".job
       SET state = 'created', "retryCount" = "retryCount" + 1,
           "startAfter" = now() + (
             "retryDelay" * CASE WHEN "retryBackoff" THEN power(2, LEAST("retryCount", 30))::int ELSE 1 END
             * CASE WHEN "retryJitter" THEN (0.5 + random() * 0.5) ELSE 1 END
             || ' seconds'
           )::interval,
           output = $1::jsonb
       WHERE id = ANY($2::uuid[]) AND state = 'active' AND "retryCount" < "retryLimit"`,
      output,
      ids,
    )

    const exhausted = await this.prisma.$queryRawUnsafe<ExhaustedRow[]>(
      `UPDATE "${s}".job
       SET state = 'failed', "retryCount" = "retryCount" + 1, output = $1::jsonb
       WHERE id = ANY($2::uuid[]) AND state = 'active' AND "retryCount" >= "retryLimit"
       RETURNING id, queue, "deadLetter", data, priority, "expireIn", "singletonKey"`,
      output,
      ids,
    )

    const dlqJobs = exhausted.filter(hasDeadLetter)
    if (dlqJobs.length > 0) {
      await createDlqJobs(
        this.prisma,
        dlqJobs,
        this.options.dlqRetentionDays ?? DLQ_RETENTION_DAYS,
        this.options.onDlq,
      )
    }
  }
}

interface ExhaustedRow {
  id: string
  queue: string
  deadLetter: string | null
  data: unknown
  priority: number
  expireIn: number
  singletonKey: string | null
}

function hasDeadLetter(row: ExhaustedRow): row is ExhaustedRow & { deadLetter: string } {
  return row.deadLetter !== null
}

interface BatchPayload {
  _batched: true
  items: unknown[]
}

function isBatchPayload(value: unknown): value is BatchPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return candidate['_batched'] === true && Array.isArray(candidate['items'])
}
