export { BaoBoss } from './BaoBoss.js'
export { migrate, ensureSchemaVersion } from './Migrate.js'
export {
  recordJobCompleted,
  recordJobFailed,
  recordProcessingDuration,
  getMetricsSnapshot,
  getQueueDepths,
  toPrometheusFormat,
} from './Metrics.js'
export type { MetricsSnapshot } from './Metrics.js'
export type { Job, Queue, Schedule, Subscription, JobState, QueuePolicy } from './types.js'
export type { SendOptions, WorkOptions, CreateQueueOptions, BaoBossOptions } from './types.js'

// Dashboard is available via separate entrypoint: import { baoBossDashboard } from 'bao-boss/dashboard'
// This keeps elysia as an optional peer dependency for consumers who don't need the dashboard.
