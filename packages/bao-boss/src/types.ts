export type JobState = 'created' | 'active' | 'completed' | 'cancelled' | 'failed'
export type QueuePolicy = 'standard' | 'short' | 'singleton' | 'stately'

export interface Job<T = unknown> {
  id: string
  queue: string
  priority: number
  data: T
  state: JobState
  retryLimit: number
  retryCount: number
  retryDelay: number
  retryBackoff: boolean
  retryJitter: boolean
  startAfter: Date
  startedOn: Date | null
  expireIn: number
  expireIfNotStartedIn: number | null
  createdOn: Date
  completedOn: Date | null
  keepUntil: Date
  singletonKey: string | null
  output: unknown
  deadLetter: string | null
  policy: string | null
  progress: number | null
}

export interface Queue {
  name: string
  policy: QueuePolicy
  retryLimit: number
  retryDelay: number
  retryBackoff: boolean
  retryJitter: boolean
  expireIn: number
  retentionDays: number
  deadLetter: string | null
  paused: boolean
  rateLimit: { count: number; period: number } | null
  debounce: number | null
  fairness: { lowPriorityShare: number } | null
  createdOn: Date
  updatedOn: Date
}

export interface Schedule {
  name: string
  cron: string
  timezone: string
  data: unknown
  options: unknown
  createdOn: Date
  updatedOn: Date
}

export interface Subscription {
  event: string
  queue: string
  createdOn: Date
}

export interface SendOptions {
  priority?: number
  startAfter?: number | string | Date
  retryLimit?: number
  retryDelay?: number
  retryBackoff?: boolean
  retryJitter?: boolean
  expireIn?: number
  expireIfNotStartedIn?: number
  singletonKey?: string
  deadLetter?: string
  dependsOn?: string[]
}

export interface WorkOptions {
  batchSize?: number
  pollingIntervalSeconds?: number
  maxConcurrency?: number
  handlerTimeoutSeconds?: number
}

export interface CreateQueueOptions {
  policy?: QueuePolicy
  retryLimit?: number
  retryDelay?: number
  retryBackoff?: boolean
  retryJitter?: boolean
  expireIn?: number
  retentionDays?: number
  deadLetter?: string
  rateLimit?: { count: number; period: number }
  debounce?: number
  fairness?: { lowPriorityShare: number }
}

export interface JobSearchOptions {
  queue?: string
  state?: JobState | JobState[]
  limit?: number
  offset?: number
  sortBy?: 'createdOn' | 'priority' | 'startAfter'
  sortOrder?: 'asc' | 'desc'
}

export interface BaoBossOptions {
  connectionString?: string
  prisma?: unknown
  schema?: string
  maintenanceIntervalSeconds?: number
  archiveCompletedAfterSeconds?: number
  deleteArchivedAfterDays?: number
  noSupervisor?: boolean
  shutdownGracePeriodSeconds?: number
  connectionPool?: {
    min?: number
    max?: number
    idleTimeoutMillis?: number
    statementTimeout?: number
  }
  onBeforeFetch?: (queue: string) => Promise<void>
  onAfterComplete?: (jobs: Job[]) => Promise<void>
  onRetry?: (job: Job, error: Error) => Promise<void>
  dlqRetentionDays?: number
}
