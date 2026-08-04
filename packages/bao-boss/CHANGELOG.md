# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-04

A hardening release. An audit of the whole tree found a release-blocking
injection, several features that were stored but never enforced, and gates that
were passing while broken. Some public API changed, so this is a minor bump on a
pre-1.0 line.

### Security

- **Stored XSS in the dashboard**: a queue name reached `<title>` unescaped, so a
  name containing `</title><script>` executed in the document head. All markup is
  now built with an `html` tagged template that escapes interpolation by default.
- **Prometheus label injection**: an unescaped quote or newline in a queue name
  closed the label set and appended forged metric lines to `/metrics`.
- **Timing-unsafe token comparison**: the dashboard bearer token was compared
  with `!==`.
- **Rate limiter bypass and ordering**: the limiter ran after authentication, so
  token guessing was never limited, and it trusted `X-Forwarded-For`
  unconditionally. It now runs first and trusts the header only under the new
  `trustProxy` option.
- **CSRF token rotation**: a fresh token per render rotated the cookie out from
  under any other open tab, breaking its mutations. The token is issued once and
  scoped to the dashboard prefix, `Secure` on HTTPS.
- Dashboard pages now carry a strict `Content-Security-Policy`, `nosniff` and
  `frame-ancestors 'none'`.

### Fixed

- **`singletonKey` did nothing**: the column was stored and never enforced, so
  two sends with one key produced two jobs. A partial unique index now enforces
  it and a conflict resolves to the open job's id.
- **Cron validator and matcher disagreed**: `1-5,10` was accepted but read as
  minute 1 only, so minutes 2 to 5 silently never fired. One parser now serves
  validation, matching and description.
- **`complete(id, { output: 0 })` stored null**: falsy output is preserved.
- **Debounced `send()` returned a fake id** (`debounce:<queue>:default`). Batches
  are ordinary jobs holding a reserved singleton key, with real ids.
- **`handlerTimeoutSeconds` did not stop the handler**: it raced a rejection
  while the handler kept running, so a timed-out batch was failed and processed
  at the same time. Handlers now receive an `AbortSignal`.
- **Unbounded worker concurrency**: `maxConcurrency` defaulted to `Infinity` on a
  `setInterval` that stacked ticks. The worker self-schedules, bounded to 1 by
  default.
- **Dead-letter entries lost their origin**: the expiry path recorded every
  source queue as `expired`.
- **`progress()` emitted its event even when no row changed.**
- **`cron_lock` grew without bound**; it is purged by age.
- **`migrate()` could not run from an installed package**: `prisma.config.ts` was
  excluded from the tarball.
- **`EventEmitter` discarded every listener error**; it re-emits them on `error`.
- **`searchJobs` accepted any `limit`** and was the only public input not
  validated. It is schema-validated and capped.
- **`startAfter` and job payloads failed with opaque Prisma errors**; both are
  validated with a message naming the offending value.
- **N+1 queries** removed from the queue list, `/metrics`, `insert` and `publish`.
- **Missing indexes** added for the expiry and purge sweeps and the dependency
  lookup.

### Changed

- **`MetricsRegistry` replaces the module-level counters.** Metrics belong to a
  `BaoBoss` instance (`boss.metrics`), so two instances in one process no longer
  share a running total. `recordJobCompleted`, `recordJobFailed`,
  `recordProcessingDuration` and `getMetricsSnapshot` are no longer module
  exports.
- **Counter metric names gained the conventional `_total` suffix.**
- **`describeCron` moved to `bao-boss` root export from `cron-describe.ts`,**
  takes a locale, uses `Intl` for month and weekday names, and throws on an
  expression the scheduler could not run instead of echoing it back.
- **`WorkOptions.maxConcurrency` defaults to 1** (was unbounded).
- **A job handler receives a second argument**, `{ signal }`. Existing
  single-argument handlers continue to work.
- **`schema` must match the namespace the client was generated for.** A
  different value used to produce an instance whose Prisma calls and raw SQL
  pointed at different schemas; it now throws at construction.
- **`getDLQDepth` counts outstanding entries**, not every row ever written.
- **The `debounce_state` table is gone**; debounce batches are ordinary jobs.
- **Removed** `Scheduler.getSchedulesDue`, `BaoBoss.runOnRetry` and the three
  unreferenced files under `sql/`, which had drifted from the queries they
  mirrored and shipped in the tarball.

### Dashboard

- One navigation tree instead of a desktop row duplicating the drawer list.
- Filter, page and delete-confirmation state live in the URL.
- Counters and the queue table stream over SSE; the five-second panel refresh
  that destroyed focus and the caret in the filter input is gone.
- Job lists paginate and state their range instead of silently showing 50.
- `/stats` is reachable from the navigation.
- Undo replaces `window.confirm` on reversible actions.
- Theme follows `Sec-CH-Prefers-Color-Scheme` and an explicit choice, resolved on
  the server so the first paint is correct.
- `dvh` and safe-area insets replace `min-h-screen`; z-index and glass parameters
  moved into an owned stylesheet with `@supports`,
  `prefers-reduced-transparency` and `forced-colors` paths.
- Numbers, dates and durations go through `Intl`.

### CLI

- `bao purge`, `bao retry` and `bao schedule:rm` report what actually happened
  and exit non-zero when the target does not exist, instead of printing success.
- An unknown command exits non-zero instead of printing help as success.
- `bao queues` uses one grouped query rather than one per queue.
- `bao schedule:ls` describes each schedule in words.

### Tests and gates

- `tsc --noEmit` was failing on `main`, and CI runs it before lint, so CI was red.
- Every suite skipped itself when `DATABASE_URL` was unset, so a database-less
  run passed having executed nothing. It now fails loudly.
- The lint scanned `src/**` only; it now covers src, test, scripts and the owned
  stylesheet, has no warning level and no suppression syntax, and fails the build
  on raw classes, unescaped interpolation, hardcoded copy, suppression comments,
  inline style/script/handlers, `!important`, arbitrary values, colour literals,
  physical-direction classes, `100vh`, native dialogs, `title` tooltips, timed
  refresh, missing ARIA, skipped tests, arbitrary waits, dead exports and
  re-export aliases.
- `bun run validate:all` runs typecheck, lint and tests together.
- `bun run verify:ui` drives Chromium over 30 surface/viewport/theme cells and
  fails on overflow, console errors, undersized targets, contrast below WCAG 2.2
  AA, a focus stop without an indicator, or a live update the page misses.
- 236 tests across 29 files, up from 152. No skipped tests, no arbitrary sleeps.

## [0.1.11] - 2026-04-01

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
