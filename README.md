# bao-boss

A Bun-native job queue library built on PostgreSQL — inspired by [pg-boss](https://github.com/timgit/pg-boss), designed for the Bun runtime.

[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-336791?logo=postgresql)](https://www.postgresql.org)

## Features

- **Bun-native** — built for the Bun runtime with Bun's native APIs
- **SKIP LOCKED** — reliable concurrent job fetching with PostgreSQL `SELECT … FOR UPDATE SKIP LOCKED`
- **Automatic retries** — configurable retry limits, delays, and exponential backoff
- **Cron scheduling** — built-in cron job scheduler with timezone support
- **Pub/Sub** — event-based fan-out to multiple queues
- **Dead letter queues** — automatic routing of exhausted-retry jobs
- **Queue policies** — `standard`, `short`, `singleton`, and `stately` concurrency modes
- **HTMX dashboard** — real-time web UI for monitoring and managing jobs (no JS framework)
- **CLI** — command-line tools for migrations, queue management, and scheduling
- **TypeScript strict** — full type safety with generics throughout the public API

## Architecture

```mermaid
graph LR
    subgraph App["Your Application"]
        Send["boss.send()"]
        Work["boss.work()"]
        Pub["boss.publish()"]
    end

    subgraph BaoBoss["bao-boss"]
        Manager
        Worker["Worker (poll loop)"]
        Scheduler
        Maintenance
        Dashboard["Dashboard (Elysia + HTMX)"]
        Metrics["Metrics"]
    end

    subgraph PostgreSQL
        JobTable["baoboss.job"]
        QueueTable["baoboss.queue"]
        ScheduleTable["baoboss.schedule"]
        SubTable["baoboss.subscription"]
    end

    Send --> Manager --> JobTable
    Work --> Worker -->|"SKIP LOCKED"| JobTable
    Pub --> Manager -->|fan-out| SubTable
    Scheduler --> ScheduleTable
    Maintenance -->|"expire / archive / purge / cron"| JobTable
    Dashboard --> Manager
    Dashboard --> Metrics
    Metrics --> PostgreSQL
```

## Job Lifecycle

```mermaid
stateDiagram-v2
    [*] --> created : send() / insert()
    created --> active : fetch() / work() [SKIP LOCKED]
    active --> completed : complete()
    active --> created : fail() with retries remaining
    active --> failed : fail() with retries exhausted / expire
    failed --> DLQ : deadLetter configured (copy)
    created --> cancelled : cancel()
    active --> cancelled : cancel()
    cancelled --> created : resume()
    failed --> created : resume()
    completed --> [*] : purged after keepUntil
```

## Request Flow

```mermaid
sequenceDiagram
    participant App as Application
    participant Boss as BaoBoss
    participant PG as PostgreSQL

    App->>Boss: boss.send("emails", payload)
    Boss->>PG: INSERT INTO baoboss.job

    loop Polling Worker
        Boss->>PG: SELECT … FOR UPDATE SKIP LOCKED
        PG-->>Boss: locked job rows
        Boss->>App: handler(jobs)
        App-->>Boss: return (success)
        Boss->>PG: UPDATE state = 'completed'
    end

    Note over Boss,PG: On handler throw → fail() with retry logic
```

## Dashboard Flow

```mermaid
sequenceDiagram
    participant User as User (browser)
    participant Elysia as Elysia
    participant HTMX as htmx
    participant Boss as BaoBoss

    User->>Elysia: GET /boss (full HTML)
    Elysia->>User: Shell + daisyUI + htmx + htmx-ext-sse
    User->>HTMX: hx-get /boss/queues (every 5s)
    HTMX->>Elysia: GET /boss/queues
    Elysia->>Boss: getQueues(), getQueueSize()
    Boss-->>Elysia: data
    Elysia-->>HTMX: HTML fragment (i18n, ARIA)
    HTMX-->>User: Swap into DOM
```

## Stack Composition

| Layer | Technology | Role |
|-------|-----------|------|
| Runtime | [Bun](https://bun.sh) | Native APIs (`Bun.spawn`, timers, `Bun.env`) |
| HTTP / routing | [Elysia](https://elysiajs.com) | Dashboard plugin, type-safe routes |
| Database ORM | [Prisma](https://www.prisma.io) | Migrations, schema, raw SQL for SKIP LOCKED |
| Dashboard UI | [htmx](https://htmx.org) 2.x + [htmx-ext-sse](https://htmx.org/extensions/sse/) | Server-rendered HTML, SSE for progress |
| Dashboard styling | [daisyUI](https://daisyui.com) 5 + Tailwind 4 | Component classes, theme support |
| Dashboard i18n | `i18n.ts` | Message keys, locale-aware dates |
| Language | TypeScript (strict) | Full type safety, generics |
| Database | PostgreSQL 15+ | `SKIP LOCKED`, `pgcrypto`, `baoboss` schema |

## Requirements

- [Bun](https://bun.sh) >= 1.1
- PostgreSQL 15+

---

## Quick Start

### 1. Start PostgreSQL

```bash
docker compose up -d
```

### 2. Set environment variable

```bash
export DATABASE_URL="postgresql://bao:bao@localhost:5432/bao"
```

### 3. Install and run migrations

```bash
bun install
cd packages/bao-boss
bunx prisma generate
bunx prisma migrate deploy
```

### 4. Use in your app

```typescript
import { BaoBoss } from 'bao-boss'

const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
await boss.start()

// Create a queue
await boss.createQueue('emails', {
  retryLimit: 3,
  retryBackoff: true,
  deadLetter: 'emails-dlq',
})

// Send a job
const id = await boss.send('emails', { to: 'user@example.com', subject: 'Hello' })

// Process jobs
await boss.work('emails', async ([job]) => {
  console.log('Sending email to:', job.data.to)
})
```

## Installation

```bash
bun add bao-boss @prisma/client prisma
```

Elysia is only needed if you use the HTMX dashboard:

```bash
bun add elysia  # optional — only for dashboard
```

> **Note:** bao-boss ships TypeScript source and requires Bun >= 1.1. It does not support Node.js.

---

## API Reference

### `new BaoBoss(options?)`

Creates a new BaoBoss instance.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `connectionString` | `string` | `DATABASE_URL` env | PostgreSQL connection string |
| `prisma` | `PrismaClient` | — | Bring your own Prisma client |
| `schema` | `string` | `'baoboss'` | PostgreSQL schema name (multi-tenant isolation) |
| `connectionPool` | `object` | — | Pool config: `min`, `max`, `idleTimeoutMillis`, `statementTimeout` |
| `maintenanceIntervalSeconds` | `number` | `120` | How often maintenance runs |
| `archiveCompletedAfterSeconds` | `number` | `43200` (12h) | Archive completed jobs after |
| `deleteArchivedAfterDays` | `number` | `7` | Delete archived jobs after |
| `noSupervisor` | `boolean` | `false` | Disable background maintenance |
| `shutdownGracePeriodSeconds` | `number` | `30` | Grace period for worker drain on `stop()` |
| `onBeforeFetch` | `(queue) => Promise<void>` | — | Hook called before each fetch |
| `onAfterComplete` | `(jobs) => Promise<void>` | — | Hook called after jobs complete |
| `onRetry` | `(job, error) => Promise<void>` | — | Hook called before retrying a failed job |
| `dlqRetentionDays` | `number` | `14` | Days to keep DLQ and debounce-flushed jobs |

### `boss.start()`

Connects to PostgreSQL, ensures the `baoboss` schema exists, and starts the maintenance supervisor.

### `boss.stop()`

Gracefully stops all workers (waits for in-flight handlers), stops maintenance, and disconnects.

---

### Queue Management

#### `boss.createQueue(name, options?)`

Creates a queue. Must exist before sending jobs.

```typescript
await boss.createQueue('emails', {
  policy: 'standard',       // 'standard' | 'short' | 'singleton' | 'stately'
  retryLimit: 3,
  retryDelay: 5,            // seconds between retries
  retryBackoff: true,       // exponential backoff
  retryJitter: true,        // add jitter to retry delays
  expireIn: 300,            // seconds before active job expires
  retentionDays: 14,        // days to keep completed jobs
  deadLetter: 'emails-dlq', // dead letter queue name
  rateLimit: { count: 10, period: 60 },  // jobs per period
  debounce: 30,             // seconds to coalesce duplicate sends
  fairness: { lowPriorityShare: 0.2 },    // reserve capacity for low-priority jobs
})
```

**Queue Policies:**

| Policy | Behaviour |
|--------|-----------|
| `standard` | Default FIFO. Multiple jobs of any state allowed. |
| `short` | At most one `created` job at a time. New `send()` returns existing job ID. |
| `singleton` | At most one `active` job at a time. Fetch returns empty while one is active. |
| `stately` | At most one `created` + one `active` simultaneously. |

#### `boss.updateQueue(name, options)`

Updates queue settings (retry, expiry, dead letter, etc.).

#### `boss.deleteQueue(name)`

Deletes a queue and all its jobs.

#### `boss.purgeQueue(name)`

Deletes all pending (`created`) jobs from a queue.

#### `boss.getQueue(name)` → `Queue | null`

Returns queue configuration or `null`.

#### `boss.getQueues()` → `Queue[]`

Returns all queues.

#### `boss.getQueueSize(name, options?)` → `number`

Returns the count of pending + active jobs.

```typescript
const total = await boss.getQueueSize('emails')
const pendingOnly = await boss.getQueueSize('emails', { before: 'active' })
```

---

### Job Operations

#### `boss.send<T>(queue, data?, options?)` → `string`

Sends a job to a queue. Returns the job UUID.

```typescript
const id = await boss.send('emails', { to: 'user@example.com' }, {
  priority: 10,           // higher = processed first (default: 0)
  startAfter: 30,         // delay in seconds, or Date, or ISO string
  retryLimit: 5,
  retryDelay: 10,
  retryBackoff: true,
  retryJitter: true,      // add jitter to retry delays
  expireIn: 60,           // seconds before active job expires
  expireIfNotStartedIn: 300,  // seconds before job expires if never started
  singletonKey: 'unique', // deduplicate by key within queue policy
  deadLetter: 'emails-dlq',
  dependsOn: [otherJobId], // DAG: job waits for these to complete
})
```

#### `boss.insert(jobs)` → `string[]`

Batch-inserts multiple jobs in a single Prisma transaction.

```typescript
const ids = await boss.insert([
  { name: 'emails', data: { to: 'a@example.com' } },
  { name: 'emails', data: { to: 'b@example.com' }, options: { priority: 5 } },
])
```

#### `boss.fetch<T>(queue, options?)` → `Job<T>[]`

Manually fetches and locks jobs using `SELECT … FOR UPDATE SKIP LOCKED`. Jobs transition to `active` state.

```typescript
const jobs = await boss.fetch('emails', { batchSize: 5 })
for (const job of jobs) {
  // process...
  await boss.complete(job.id)
}
```

#### `boss.complete(id, options?)`

Marks a job (or array of jobs) as `completed`.

```typescript
await boss.complete(jobId, { output: { result: 'sent' } })
await boss.complete([id1, id2, id3])
```

#### `boss.fail(id, error?)`

Marks a job as `failed`. If `retryCount < retryLimit`, the job is re-enqueued as `created` with the configured delay. If retries are exhausted and `deadLetter` is configured, a copy is inserted into the DLQ.

#### `boss.cancel(id)`

Cancels a pending or active job (sets state to `cancelled`).

#### `boss.resume(id)`

Re-enqueues a `cancelled` or `failed` job back to `created`.

#### `boss.getJobById<T>(id)` → `Job<T> | null`

#### `boss.getJobsById<T>(ids)` → `Job<T>[]`

#### `boss.progress(id, value)`

Updates job progress (0–100). Emits `progress` event.

#### `boss.pauseQueue(name)` / `boss.resumeQueue(name)`

Pause or resume a queue. Paused queues do not fetch jobs.

#### `boss.searchJobs<T>(filter?)` → `{ jobs: Job<T>[], total: number }`

Search and filter jobs with pagination.

```typescript
const result = await boss.searchJobs({
  queue: 'emails',
  state: ['failed', 'cancelled'],
  limit: 20,
  offset: 0,
  sortBy: 'createdOn',
  sortOrder: 'desc',
})
```

#### `boss.cancelJobs(queue, filter?)` → `number`

Bulk cancel jobs in a queue. Returns count of cancelled jobs.

```typescript
const count = await boss.cancelJobs('emails', { state: 'created' })
```

#### `boss.resumeJobs(queue, filter?)` → `number`

Bulk resume failed/cancelled jobs. Returns count.

```typescript
const count = await boss.resumeJobs('emails', { state: 'failed' })
```

#### `boss.getJobDependencies<T>(jobId)` → `{ dependsOn: Job<T>[], dependedBy: Job<T>[] }`

Query upstream and downstream job dependencies.

#### `boss.getDLQDepth(deadLetterQueueName)` → `number`

Returns the count of jobs in a dead letter queue.

#### `boss.migrate()`

Runs Prisma migrations. Call before `start()` when deploying.

---

### Workers

#### `boss.work<T>(queue, options?, handler)` → `string`

Starts a polling worker. Returns a worker ID. The handler receives a batch of jobs. Returning normally marks all jobs `completed`; throwing marks them `failed` (with retry).

```typescript
const workerId = await boss.work<EmailPayload>(
  'emails',
  { batchSize: 5, pollingIntervalSeconds: 1 },
  async (jobs) => {
    for (const job of jobs) {
      await sendEmail(job.data.to, job.data.subject, job.data.body)
    }
  }
)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `batchSize` | `number` | `1` | Jobs fetched per poll cycle |
| `pollingIntervalSeconds` | `number` | `2` | Seconds between polls |
| `maxConcurrency` | `number` | `Infinity` | Max concurrent handler invocations |
| `handlerTimeoutSeconds` | `number` | — | Timeout per handler; job fails if exceeded |

#### `boss.offWork(queueOrWorkerId)`

Stops a specific worker by ID, or all workers for a queue by name. Waits for in-flight handlers to finish.

```typescript
await boss.offWork(workerId)     // stop one worker
await boss.offWork('emails')     // stop all workers on 'emails'
```

---

### Scheduling

#### `boss.schedule(name, cron, data?, options?)`

Creates or updates a cron schedule. The maintenance loop fires a job into the named queue when the cron expression matches.

```typescript
await boss.schedule('daily-digest', '0 8 * * *', { type: 'digest' })
await boss.schedule('weekly-report', '0 9 * * 1', {}, { tz: 'America/New_York' })
```

Cron expressions use standard 5-field format: `minute hour day-of-month month day-of-week`.

#### `boss.unschedule(name)`

Removes a cron schedule.

#### `boss.getSchedules()` → `Schedule[]`

Lists all cron schedules.

#### Cron Utilities

```typescript
import { validateCron, describeCron } from 'bao-boss'

validateCron('0 9 * * 1-5')  // passes (weekdays at 9am)
validateCron('60 * * * *')   // throws Error('Invalid cron field...')

describeCron('0 9 * * 1-5')  // "at minute 0, at hour 9, on day-of-week 1-5"
describeCron('@daily')        // "Once a day (at midnight)"
```

Supported cron aliases: `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`, `@hourly`

---

### Pub/Sub

Fan-out events to multiple queues:

```typescript
// Subscribe queues to an event
await boss.subscribe('user.created', 'send-welcome-email')
await boss.subscribe('user.created', 'provision-account')

// Publish — sends a job copy to each subscribed queue
await boss.publish('user.created', { userId: 42 })

// Unsubscribe
await boss.unsubscribe('user.created', 'send-welcome-email')
```

---

### Dashboard

Mount the HTMX dashboard as an Elysia plugin:

```typescript
import { Elysia } from 'elysia'
import { BaoBoss } from 'bao-boss'
import { baoBossDashboard } from 'bao-boss/dashboard'

const boss = new BaoBoss()
await boss.start()

const app = new Elysia()
  .use(baoBossDashboard(boss, {
    prefix: '/boss',       // URL prefix (default: '/boss')
    auth: 'secret-token',  // optional Bearer / x-bao-token auth (ignored when dashboardAuth set)
    dashboardAuth: { type: 'bearer', token: 'secret' },  // or { type: 'better-auth', auth: yourAuth }
    csrf: true,           // enable CSRF for POST/DELETE (default: true when auth set)
    rateLimit: { windowMs: 60000, max: 60 },  // per-IP rate limit
    lang: 'en',           // HTML lang attribute
    locale: 'en',         // date/number formatting locale (i18n, date/number formats)
  }))
  .listen(3000)
```

**Dashboard routes:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/boss` | Main dashboard (full HTML page with HTMX wiring) |
| `GET` | `/boss/queues` | Live table of all queues + job counts by state |
| `GET` | `/boss/queues/:name` | Queue detail: jobs list, state breakdown, settings |
| `GET` | `/boss/jobs/:id` | Job detail: data, state, retry count, output |
| `POST` | `/boss/jobs/:id/retry` | Re-enqueue a failed/cancelled job |
| `DELETE` | `/boss/jobs/:id` | Cancel a job |
| `GET` | `/boss/schedules` | Cron schedule list |
| `DELETE` | `/boss/schedules/:name` | Remove a schedule |
| `GET` | `/boss/stats` | Aggregate stats fragment (queues, total, active, completed, failed) |
| `GET` | `/boss/metrics` | Prometheus-format metrics (queue depths, per-queue counters) |
| `GET` | `/boss/sse/progress/:id` | SSE stream for live job progress updates |

Prometheus metrics now include per-queue counters:

```
baoboss_jobs_processed_total 42
baoboss_jobs_failed_total 3
baoboss_processing_duration_seconds 12.5
baoboss_queue_depth{queue="emails"} 15
baoboss_jobs_processed_per_queue{queue="emails"} 30
baoboss_jobs_failed_per_queue{queue="emails"} 2
baoboss_processing_duration_per_queue_seconds{queue="emails"} 8.3
```

**Dashboard auth options:** Use `auth` for a static Bearer token, or `dashboardAuth` for Bearer or Better Auth session-based auth. When `dashboardAuth` is set, it overrides `auth`.

- Auto-refreshes via `hx-trigger="every 5s"` (queues) and `every 10s` (stats)
- daisyUI 5 + Tailwind 4 for styling; dark/light mode via `prefers-color-scheme`
- i18n via `locale` option; all user-facing strings use `t()` from `i18n.ts`
- ARIA attributes (`scope="col"`, `aria-label`, `type="button"`) for accessibility
- Job data displayed as formatted JSON in `<pre>` blocks
- Retry, cancel, and delete use `hx-post`/`hx-delete` with `hx-confirm`

---

### CLI

The `bao` binary is a Bun script (`packages/bao-boss/src/cli.ts`):

```bash
bao migrate              # Run pending Prisma migrations
bao migrate:reset        # Drop & recreate the baoboss schema
bao queues               # List all queues and job counts
bao purge <queue>        # Purge pending jobs from a queue
bao retry <id>           # Re-enqueue a specific failed job
bao schedule:ls          # List all cron schedules
bao schedule:rm <name>   # Remove a cron schedule
```

---

## Events

`BaoBoss` extends a minimal `EventEmitter` (no Node dependency; see `EventEmitter.ts`) and emits typed events:

| Event | Payload | Description |
|-------|---------|-------------|
| `error` | `Error` | Unhandled errors in maintenance loop or workers |
| `stopped` | — | Emitted when `stop()` resolves |
| `progress` | `{ id, queue, progress }` | Job progress updated via `boss.progress()` |
| `dlq` | `{ jobId, queue, deadLetter }` | Job moved to dead letter queue |
| `queue:paused` | `{ queue }` | Queue was paused |
| `queue:resumed` | `{ queue }` | Queue was resumed |

```typescript
boss.on('error', (err) => console.error('BaoBoss error:', err))
boss.on('stopped', () => console.log('BaoBoss stopped'))
boss.on('dlq', (data) => console.log('Job moved to DLQ:', data))
```

---

## Database Schema

All tables are created in the `baoboss` PostgreSQL schema. Migrations are managed by Prisma.

| Table | Description |
|-------|-------------|
| `baoboss.job` | Jobs with state, retry info, payload, timestamps |
| `baoboss.job_dependency` | DAG dependencies between jobs |
| `baoboss.queue` | Queue configuration and policies |
| `baoboss.schedule` | Cron schedules with timezone |
| `baoboss.subscription` | Event → queue pub/sub mappings |
| `baoboss.cron_lock` | Distributed lock for cron firing |
| `baoboss.debounce_state` | Debounced queue flush state |
| `baoboss.schema_version` | Migration tracking |

### Maintenance Loop

The background maintenance supervisor runs on `maintenanceIntervalSeconds` and performs:

- **Expire active jobs** — jobs active longer than `expireIn` are marked `failed` and sent to their dead letter queue
- **Expire unstarted jobs** — jobs in `created` state past their `expireIfNotStartedIn` are cancelled
- **Archive completed jobs** — completed/failed jobs older than `archiveCompletedAfterSeconds` have their `keepUntil` shortened to enable purge
- **Purge old jobs** — jobs past `keepUntil` are hard-deleted
- **Flush debounce buffers** — coalesced debounce entries past their window are flushed as batched jobs
- **Fire cron schedules** — sends jobs for any schedules whose cron expression matches the current time (with timezone conversion and distributed locking)

---

## Project Structure

```
bao-boss/
├── packages/
│   └── bao-boss/
│       ├── src/
│       │   ├── index.ts         # Public API exports
│       │   ├── BaoBoss.ts       # Main class (lifecycle, EventEmitter)
│       │   ├── EventEmitter.ts  # Minimal EventEmitter (no Node dependency)
│       │   ├── Manager.ts       # Facade delegating to manager/ modules
│       │   ├── Worker.ts        # Polling worker implementation
│       │   ├── Scheduler.ts     # Cron schedule management (with validation)
│       │   ├── Maintenance.ts   # Expiry, archival, purge, cron firing
│       │   ├── Dashboard.ts     # Elysia plugin (route wiring)
│       │   ├── Migrate.ts       # Prisma migration runner
│       │   ├── Metrics.ts       # Per-queue Prometheus metrics
│       │   ├── i18n.ts          # Dashboard i18n message keys
│       │   ├── cli.ts           # CLI binary (bao command)
│       │   ├── cron.ts          # Cron parser, validator, describer
│       │   ├── schema.ts        # Schema name validation (shared)
│       │   ├── types.ts         # TypeScript type definitions
│       │   ├── manager/         # Decomposed Manager modules
│       │   │   ├── mappers.ts   # Prisma-to-domain type mappers
│       │   │   ├── queue-ops.ts # Queue CRUD operations
│       │   │   ├── job-ops.ts   # Job mutations (send, fetch, fail)
│       │   │   ├── job-queries.ts # Job queries (search, deps, getById)
│       │   │   └── pubsub.ts    # Pub/Sub operations
│       │   └── dashboard/       # Decomposed Dashboard modules
│       │       ├── routes.ts    # Route handler functions
│       │       ├── sse.ts       # SSE progress streaming
│       │       ├── html.ts      # HTML rendering helpers
│       │       ├── middleware.ts # Auth, CSRF, rate limiting
│       │       └── response.ts  # Response builders
│       ├── scripts/
│       │   └── lint.ts          # Project-specific lint
│       ├── prisma/
│       │   ├── schema.prisma   # Prisma schema (baoboss namespace)
│       │   └── migrations/     # Prisma migrations
│       ├── sql/                # Raw SKIP LOCKED queries
│       └── test/               # 18 test files, 129 tests
├── apps/
│   └── example/                # Example Elysia app with dashboard
├── docker-compose.yaml         # PostgreSQL 17 for local dev
└── package.json                # Bun workspace root
```

---

## Development

Prisma 7 uses `prisma.config.ts` for the datasource URL. Set `DATABASE_URL` before running `prisma generate` or `prisma migrate`.

```bash
# Start PostgreSQL
docker compose up -d

# Set DATABASE_URL (required for Prisma 7 prisma.config.ts)
export DATABASE_URL="postgresql://bao:bao@localhost:5432/bao"

# Install dependencies
bun install

# Generate Prisma client
cd packages/bao-boss && bunx prisma generate

# Run migrations
bunx prisma migrate deploy

# Run tests
DATABASE_URL=postgresql://bao:bao@localhost:5432/bao bun test

# Run example app
cd apps/example && bun run dev
```

`boss.migrate()` runs `bunx prisma migrate deploy` asynchronously via `Bun.spawn` (non-blocking).

---

## Differences from pg-boss

| Feature | pg-boss | bao-boss |
|---------|---------|----------|
| Runtime | Node.js | **Bun** |
| Web framework | None (separate package) | **Elysia** (built-in dashboard) |
| ORM | Raw `pg` client | **Prisma** (+ raw SQL for SKIP LOCKED) |
| Dashboard | Separate `@pg-boss/dashboard` (React) | **HTMX routes built into the library** |
| Schema migrations | Internal migration system | **Prisma Migrate** |
| Scheduler | Custom timekeeper | **Bun-native timers + cron parser** |
| TypeScript | Compiled | **Runs natively in Bun** |

---

## AI Agent Integration

This repository is optimized for AI coding agents. The following context files provide agent-specific instructions and project context:

| File | Agent / Tool | Purpose |
|------|-------------|---------|
| [`CLAUDE.md`](CLAUDE.md) | Claude Code, Claude agents | Full project context, architecture, conventions |
| [`AGENTS.md`](AGENTS.md) | OpenAI Codex, general agents | Agent routing, coding rules, common tasks |
| [`CODEX.md`](CODEX.md) | OpenAI Codex / ChatGPT | Stack summary, file map, conventions |
| [`llms.txt`](llms.txt) | Any LLM | Machine-readable API reference ([llmstxt.org](https://llmstxt.org) format) |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | GitHub Copilot | VS Code / JetBrains Copilot context |
| [`.cursor/rules/bao-boss.mdc`](.cursor/rules/bao-boss.mdc) | Cursor | Cursor IDE rules |
| [`.clinerules`](.clinerules) | Cline | Cline agent rules |
| [`.windsurfrules`](.windsurfrules) | Windsurf | Windsurf agent rules |

### Using with AI Agents

**Claude Code / Claude agents** read `CLAUDE.md` automatically. It contains the full architecture, conventions, and development patterns.

**GitHub Copilot** reads `.github/copilot-instructions.md` for workspace context in VS Code and JetBrains.

**Cursor** loads `.cursor/rules/bao-boss.mdc` automatically when working with TypeScript, Prisma, or SQL files.

**Other agents** (Cline, Windsurf, Aider, Continue, Zed AI) each have their respective config files.

**`llms.txt`** follows the [llmstxt.org](https://llmstxt.org) specification -- a machine-readable plain-text format designed for LLM context ingestion. It contains the complete API surface, configuration options, and project structure in a format optimized for AI consumption.

### For AI Agent Developers

If you are building an AI agent that interacts with bao-boss:

1. **Start with `llms.txt`** for a complete API overview
2. **Read `CLAUDE.md`** for architecture decisions and code patterns
3. **Check `packages/bao-boss/src/types.ts`** for all TypeScript interfaces
4. **Review `packages/bao-boss/prisma/schema.prisma`** for the database schema
5. **See `apps/example/src/index.ts`** for a working integration example

### Request Flow (for AI context)

```
browser/client -> boss.send("queue", payload) -> INSERT INTO baoboss.job
                  boss.work("queue", handler)  -> SELECT ... FOR UPDATE SKIP LOCKED
                                               -> handler(jobs)
                                               -> UPDATE state = 'completed'
```

---

## License

MIT
