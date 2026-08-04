export { BaoBoss } from './BaoBoss.js'
export { EventEmitter, ERROR_EVENT, type Listener } from './EventEmitter.js'
export { migrate, ensureSchemaVersion, SCHEMA_VERSION } from './Migrate.js'

export { MetricsRegistry, getQueueDepths, toPrometheusFormat, escapeLabelValue } from './Metrics.js'
export type { MetricsSnapshot, QueueMetrics } from './Metrics.js'

export type { Job, Queue, Schedule, Subscription, JobState, QueuePolicy } from './types.js'
export type {
  SendOptions, WorkOptions, CreateQueueOptions, BaoBossOptions,
  JobSearchOptions, BetterAuthSessionApi,
} from './types.js'
export type { JobHandler } from './Worker.js'

export {
  validateCron, parseCron, parseCronFields, resolveCronAliases,
  CRON_FIELD_COUNT, CRON_FIELD_NAMES,
} from './cron.js'
export type { CronField, CronFields, CronFieldIndex, CronTerm } from './cron.js'
export { describeCron } from './cron-describe.js'

export {
  JOB_DEFAULTS, WORKER_DEFAULTS, BOSS_DEFAULTS,
  DLQ_RETENTION_DAYS, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX,
} from './defaults.js'

// The dashboard lives behind its own entrypoint (`bao-boss/dashboard`) so that
// Elysia stays an optional peer dependency for consumers who do not need it.
