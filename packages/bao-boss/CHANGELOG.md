# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1-rc1] - 2026-04-01

### Added

- **Dead letter queue validation**: `createQueue`/`updateQueue` reject non-existent, self-referencing, and circular dead letter queue references
- **Job payload size validation**: new `maxPayloadBytes` option on `BaoBossOptions` rejects oversized job payloads at send time
- **Dashboard queue search**: HTMX live search input filters queues by name on the dashboard
- **Dashboard bulk operations**: `POST /jobs/bulk/retry` and `POST /jobs/bulk/cancel` routes for batch job management
- **Rate limit response headers**: dashboard rate limiter returns `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### Fixed

- **DLQ cascade**: dead letter queue jobs now inherit the target queue's `deadLetter` setting in both the `fail()` path and the maintenance expiry path, enabling proper cascading through chained DLQ configurations
- **Worker concurrency**: fixed race condition where `setInterval` could bypass `maxConcurrency` guard during async `fetch()`, and fixed `inFlight` leak when `fetch()` throws
- **Payload size**: uses `TextEncoder.encode().byteLength` for byte-accurate measurement; catches circular references with a clear error
- **Empty string deadLetter**: `updateQueue({ deadLetter: '' })` now clears to `null` instead of persisting an empty string
- **Schedule test**: replaced wall-clock-dependent sleep with deterministic manual `Maintenance.run()` calls
- **README**: Quick Start example now creates the DLQ queue before referencing it
- **README**: Fixed `getQueueDepths` API signature (takes `prisma`, not `boss`)
- **README**: Documented `maxPayloadBytes`, DLQ validation, dashboard search and bulk operations

### Tests

- 23 test files with 146 tests (up from 18 files / 96 tests)
- **New**: `pubsub.test.ts` — subscribe, publish fan-out, unsubscribe, idempotent subscribe, send options propagation
- **New**: `cron.test.ts` — `validateCron` accepts/rejects, `describeCron` aliases and patterns
- **New**: `error-paths.test.ts` — idempotent complete/fail/cancel, no-op resume, null for missing IDs, empty arrays
- **New**: `singleton-key.test.ts` — storage, independence, lifecycle persistence
- **New**: `validation-advanced.test.ts` — DLQ self-reference, non-existent DLQ, circular DLQ, payload size limits
- **Extended**: `dependencies.test.ts` — `getJobDependencies` upstream/downstream queries
- **Extended**: `maintenance.test.ts` — DLQ cascade through chained dead letter queues

## [0.1.0] - 2026-03-31

### Added

- **Core job queue** with PostgreSQL `SKIP LOCKED` for concurrent job fetching
- **Queue management**: `createQueue`, `updateQueue`, `deleteQueue`, `purgeQueue`, `getQueue`, `getQueues`, `pauseQueue`, `resumeQueue`
- **Job operations**: `send`, `insert`, `fetch`, `complete`, `fail`, `cancel`, `resume`, `getJobById`, `getJobsById`, `progress`
- **Job search/filter API**: `searchJobs` with pagination, state filtering, and sorting
- **Bulk operations**: `cancelJobs`, `resumeJobs` for queue-wide operations
- **Job dependency graph**: `getJobDependencies` returns upstream and downstream jobs
- **Workers**: `work` (polling worker with batch processing), `offWork` (stop workers)
- **Worker options**: `batchSize`, `pollingIntervalSeconds`, `maxConcurrency`, `handlerTimeoutSeconds`
- **Queue policies**: `standard`, `short`, `singleton`, `stately` concurrency modes
- **Automatic retries** with configurable limits, delays, exponential backoff, and jitter
- **Dead letter queues** with configurable `dlqRetentionDays`
- **Rate limiting** per queue with `rateLimit: { count, period }`
- **Debouncing** per queue with configurable window
- **Fairness ordering** with `lowPriorityShare` for low-priority job scheduling
- **Cron scheduling**: `schedule`, `unschedule`, `getSchedules` with timezone support
- **Cron utilities**: `validateCron` (throws on invalid), `describeCron` (human-readable)
- **Cron aliases**: `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`, `@hourly`
- **Pub/Sub fan-out**: `publish`, `subscribe`, `unsubscribe`
- **HTMX Dashboard** with Elysia plugin: queue list, job detail, schedule management, live progress
- **Dashboard auth**: Bearer token and Better Auth session support
- **Dashboard CSRF protection** with httpOnly cookie + header verification
- **Dashboard rate limiting** per IP
- **Dashboard i18n** with `t()` message keys and locale-aware date formatting
- **Dashboard ARIA** accessibility: scope, aria-label, type attributes throughout
- **Prometheus metrics** endpoint with per-queue counters
- **Per-queue metrics**: `baoboss_jobs_processed_per_queue`, `baoboss_jobs_failed_per_queue`, `baoboss_processing_duration_per_queue_seconds`
- **Events**: `error`, `stopped`, `progress`, `dlq`, `queue:paused`, `queue:resumed`
- **Lifecycle hooks**: `onBeforeFetch`, `onAfterComplete`, `onRetry`
- **CLI**: `bao migrate`, `bao queues`, `bao purge`, `bao retry`, `bao schedule:ls`, `bao schedule:rm`
- **Prisma 7** with PrismaPg adapter for schema management and migrations
- **Multi-tenant schema** support via configurable `schema` option
- **Graceful shutdown** with configurable grace period for worker drain
- **Project lint** (`bun run lint`) checking typecasts, i18n, ARIA, HTMX, DRY, file/function length

### Architecture

- **Decomposed Manager**: thin facade delegating to `manager/` submodules (queue-ops, job-ops, job-queries, pubsub, mappers)
- **Decomposed Dashboard**: route wiring only; handlers, middleware, HTML helpers, SSE in `dashboard/` submodules
- **Centralized schema validation** in `schema.ts`
- **Extracted cron module** in `cron.ts` (parser, validator, describer)
- **Zero `as unknown`/`as never`/`as any`** typecasts — uses typed domain mappers
- **All files under 350 lines**, all functions under 60 lines
- **18 test files** with 96 tests across all features
