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
  startAfter: Date
  startedOn: Date | null
  expireIn: number
  createdOn: Date
  completedOn: Date | null
  keepUntil: Date
  singletonKey: string | null
  output: unknown
  deadLetter: string | null
  policy: string | null
}

export interface Queue {
  name: string
  policy: QueuePolicy
  retryLimit: number
  retryDelay: number
  retryBackoff: boolean
  expireIn: number
  retentionDays: number
  deadLetter: string | null
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
  expireIn?: number
  singletonKey?: string
  deadLetter?: string
}

export interface WorkOptions {
  batchSize?: number
  pollingIntervalSeconds?: number
  includeMetadata?: boolean
  priority?: boolean
}

export interface CreateQueueOptions {
  policy?: QueuePolicy
  retryLimit?: number
  retryDelay?: number
  retryBackoff?: boolean
  expireIn?: number
  retentionDays?: number
  deadLetter?: string
}

export interface BaoBossOptions {
  connectionString?: string
  prisma?: unknown
  maintenanceIntervalSeconds?: number
  archiveCompletedAfterSeconds?: number
  deleteArchivedAfterDays?: number
  noSupervisor?: boolean
  shutdownGracePeriodSeconds?: number
}
