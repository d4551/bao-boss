# bao-boss

[![CI](https://github.com/d4551/bao-boss/actions/workflows/ci.yml/badge.svg)](https://github.com/d4551/bao-boss/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/bao-boss.svg)](https://www.npmjs.com/package/bao-boss)
[![Bun](https://img.shields.io/badge/bun-%E2%89%A5%201.2-000?logo=bun&logoColor=white)](https://bun.sh)
[![PostgreSQL](https://img.shields.io/badge/postgresql-%E2%89%A5%2015-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-223%20passing-2ea44f)](#testing)
[![License](https://img.shields.io/npm/l/bao-boss.svg)](LICENSE)

A Bun-native background job queue for PostgreSQL, with a built-in dashboard.

---

## Explain it like I'm five

Imagine a restaurant kitchen.

Orders come in faster than the cooks can make them, so you write each order on a
ticket and clip it to a rail. Cooks take the next ticket, cook it, and clip it to
the "done" rail. If a cook drops a dish, the ticket goes back on the rail to try
again. If a dish fails three times, it goes in a special bin so someone can look
at what keeps going wrong.

bao-boss is that rail, and your database is the wall it hangs on.

- **A job** is a ticket: "send this email", "build this report".
- **A queue** is one rail: all the email tickets hang together.
- **A worker** is a cook: it takes tickets off a rail and does the work.
- **Retries** put a dropped ticket back on the rail.
- **A dead-letter queue** is the bin for tickets that keep failing.
- **A schedule** is a kitchen timer that clips a new ticket up every morning.
- **The dashboard** is the window into the kitchen, so you can see what is
  cooking, what is stuck, and what burned.

Because the rail lives in PostgreSQL, two cooks never grab the same ticket, and
nothing is lost if the kitchen loses power.

---

## Why bao-boss

- **Nothing to run but Postgres.** No Redis, no broker, no sidecar. Jobs are
  rows; `SELECT … FOR UPDATE SKIP LOCKED` hands each one to exactly one worker.
- **Bun-native.** Uses `Bun.env`, `Bun.spawn`, `Bun.file` and `bun test`. There
  is no `node:` import anywhere in the library.
- **Typed end to end.** `send<T>()` and `work<T>()` carry your payload type
  through to the handler. Strict TypeScript with `noUncheckedIndexedAccess`.
- **A dashboard you can actually ship.** Server-rendered HTML, no client
  framework, no CDN, a strict Content-Security-Policy, and no inline script.
- **Optional.** The dashboard lives behind its own entry point, so Elysia stays
  an optional peer dependency.

---

## Install

```bash
bun add bao-boss @prisma/client prisma
bun add elysia          # only if you want the dashboard
```

Point `DATABASE_URL` at a PostgreSQL 15+ database, then apply the schema:

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/db bunx prisma migrate deploy
```

## Quick start

```ts
import { BaoBoss } from 'bao-boss'

const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
boss.on('error', console.error)
await boss.start()

await boss.createQueue('emails', {
  retryLimit: 3,
  retryBackoff: true,
  deadLetter: 'emails-dlq',
})

interface Email { to: string; subject: string }

await boss.work<Email>('emails', { batchSize: 5 }, async (jobs, { signal }) => {
  for (const job of jobs) {
    if (signal.aborted) return      // honour the handler timeout
    await sendEmail(job.data)
  }
})

await boss.send<Email>('emails', { to: 'a@example.com', subject: 'Hi' })
```

### Add the dashboard

```ts
import { Elysia } from 'elysia'
import { baoBossDashboard } from 'bao-boss/dashboard'

new Elysia()
  .use(baoBossDashboard(boss, { prefix: '/boss' }))
  .listen(3000)
```

---

## How it works

### A job's life

```mermaid
stateDiagram-v2
    [*] --> created: send() / insert() / publish() / schedule fires
    created --> active: worker fetch claims it (SKIP LOCKED)
    active --> completed: handler returned
    active --> created: handler threw, retries remain
    active --> failed: retries exhausted, or expireIn elapsed
    created --> cancelled: cancel(), or expireIfNotStartedIn elapsed
    active --> cancelled: cancel()
    failed --> created: resume()
    cancelled --> created: resume()
    failed --> dlq: a copy is written to the dead-letter queue
    completed --> [*]: purged once keepUntil passes
    failed --> [*]: purged once keepUntil passes
    cancelled --> [*]: purged once keepUntil passes

    state "dead-letter queue" as dlq
```

### What talks to what

```mermaid
flowchart TB
    subgraph app["Your application"]
        producer["Producer<br/>send / insert / publish"]
        handler["Handler<br/>your async function"]
    end

    subgraph lib["bao-boss"]
        boss["BaoBoss<br/>lifecycle, events, metrics"]
        manager["Manager<br/>queue, job, search, pub-sub"]
        worker["Worker<br/>self-scheduling poll loop"]
        maint["Maintenance<br/>expiry, archive, purge, cron"]
        dash["Dashboard<br/>Elysia plugin, optional"]
    end

    db[("PostgreSQL<br/>schema: baoboss")]

    producer --> boss
    boss --> manager
    boss --> worker
    boss --> maint
    worker -->|fetch / complete / fail| manager
    worker --> handler
    manager --> db
    maint --> db
    dash --> boss
    dash -->|"/metrics"| prom["Prometheus"]
```

### How a worker claims work

```mermaid
sequenceDiagram
    participant W as Worker
    participant P as PostgreSQL
    participant H as Your handler

    loop every pollingIntervalSeconds, up to maxConcurrency batches
        W->>P: SELECT … WHERE state='created' AND startAfter<=now()<br/>FOR UPDATE SKIP LOCKED
        P-->>W: rows, locked to this worker only
        P->>P: UPDATE state='active', startedOn=now()
        W->>H: handler(jobs, { signal })
        alt handler returns
            W->>P: UPDATE state='completed'
        else handler throws, or the signal fires
            W->>P: retryCount < retryLimit ? back to 'created' : 'failed'
            Note over P: a 'failed' job with a deadLetter<br/>is copied to that queue
        end
    end
```

`SKIP LOCKED` is what makes this safe to run on many machines at once: a row
another worker has locked is skipped rather than waited on, so workers never
queue behind each other and never hand the same job to two handlers.

---

## Features

| Capability | What it does |
|---|---|
| Concurrency | `FOR UPDATE SKIP LOCKED` — any number of workers, no double processing |
| Retries | Fixed delay, exponential backoff, and jitter, per queue or per job |
| Dead-letter queues | Exhausted jobs are copied to another queue, with the source queue recorded |
| Cron schedules | Five-field cron with names, ranges, lists and steps; IANA timezones; a distributed lock so one instance fires per minute |
| Pub/Sub | `publish(event)` fans out to every subscribed queue in one write |
| Dependencies | `dependsOn` holds a job until the jobs it depends on settle |
| Singleton keys | At most one open job per `(queue, singletonKey)`, enforced by a partial unique index |
| Debounce | Sends inside a window collapse into one batched job that keeps its real id |
| Rate limiting | At most N jobs started per queue per period |
| Fairness | A configurable share of picks is randomised so low-priority work is not starved |
| Priorities | Higher priority is claimed first |
| Batching | `batchSize` claims and completes many jobs per round trip |
| Handler timeouts | The handler receives an `AbortSignal` that actually fires |
| Graceful shutdown | `stop()` drains in-flight handlers before disconnecting |
| Metrics | Per-instance counters, a Prometheus endpoint, and per-queue depth |
| Dashboard | Queues, jobs, schedules, statistics, live updates, light and dark |

---

## Dashboard

Mounted at `prefix` (default `/boss`).

| Route | Purpose |
|---|---|
| `/` | Overview: counters, queues, schedules |
| `/queues` | Queue list with a filter held in the URL |
| `/queues/:name` | Queue settings, counters, and a paginated job list |
| `/jobs/:id` | One job: fields, payload, output, live progress |
| `/schedules` | Schedules, described in words, with inline delete confirmation |
| `/stats` | Counters on their own page |
| `/metrics` | Prometheus text exposition — not linked from the navigation |
| `/sse/live` | Server-sent stream backing the live counters and queue table |
| `/sse/progress/:id` | Server-sent stream for one job's progress bar |
| `/assets/:name` | Vendored CSS and JS, served with an ETag |

Design commitments, each covered by a test:

- **One navigation tree.** The sidebar is the only list of links; it pins open
  at `lg` rather than being duplicated as a second desktop row.
- **State in the URL.** Filter, page and delete-confirmation survive a refresh,
  the back button, and a shared link.
- **Live without polling.** Counters and the queue table arrive over SSE. The
  filter input sits outside the swapped region, so typing is never interrupted.
- **Undo instead of confirm.** Retry and cancel are reversible, so they run and
  offer the inverse. Only schedule deletion confirms, through page state rather
  than `window.confirm`.
- **Escaped by construction.** All markup is built with an `html` tagged
  template that escapes interpolation; nothing relies on remembering to escape.
- **No inline anything.** No inline script, style or event handler, so the
  Content-Security-Policy needs no `unsafe-inline` for scripts.
- **Theme without a flash.** Resolved on the server from
  `Sec-CH-Prefers-Color-Scheme` and an explicit choice, then rendered into
  `<html data-theme>`.

### Protecting it

```ts
baoBossDashboard(boss, {
  prefix: '/boss',
  dashboardAuth: { type: 'bearer', token: Bun.env['BAO_TOKEN']! },
  rateLimit: { windowMs: 60_000, max: 120 },
  trustProxy: true,   // only behind a proxy that strips client-sent X-Forwarded-*
  locale: 'en',
})
```

CSRF protection turns on automatically when authentication is configured. The
token comparison is timing-safe, and the rate limiter runs before authentication
so a wrong token is itself limited.

---

## API

### Lifecycle
`start()` · `stop()` · `migrate()`

### Queues
`createQueue(name, options)` · `updateQueue` · `deleteQueue` · `purgeQueue` ·
`pauseQueue` · `resumeQueue` · `getQueue` · `getQueues` · `getQueueSize` ·
`getQueueSizes`

### Jobs
`send<T>(queue, data, options)` · `insert(jobs)` · `fetch<T>` · `complete` ·
`fail` · `cancel` · `resume` · `cancelJobs` · `resumeJobs` · `getJobById` ·
`getJobsById` · `searchJobs` · `getJobDependencies` · `progress` · `getDLQDepth`

### Workers
`work<T>(queue, options, handler)` · `offWork(queueOrId)`

### Scheduling
`schedule(name, cron, data, { tz })` · `unschedule` · `getSchedules`

### Pub/Sub
`publish(event, data, options)` · `subscribe(event, queue)` · `unsubscribe`

### Module exports
`validateCron` · `parseCron` · `parseCronFields` · `describeCron` ·
`MetricsRegistry` · `getQueueDepths` · `toPrometheusFormat` · `escapeLabelValue` ·
`migrate` · `ensureSchemaVersion` · `JOB_DEFAULTS` · `WORKER_DEFAULTS` ·
`BOSS_DEFAULTS`

### Events

| Event | Payload |
|---|---|
| `error` | `Error` — including any error thrown by one of your own listeners |
| `dlq` | `{ jobId, queue, deadLetter }` |
| `progress` | `{ id, queue, progress }` — only when a row actually changed |
| `queue:paused` / `queue:resumed` | `{ queue }` |
| `stopped` | none |

### Options

```ts
new BaoBoss({
  connectionString: Bun.env['DATABASE_URL'],
  schema: 'baoboss',                  // validated; an invalid name throws
  maintenanceIntervalSeconds: 120,
  archiveCompletedAfterSeconds: 43_200,
  deleteArchivedAfterDays: 7,
  dlqRetentionDays: 14,
  shutdownGracePeriodSeconds: 30,
  maxPayloadBytes: 1_000_000,
  noSupervisor: false,                // skip the maintenance loop
  connectionPool: { min: 1, max: 10, idleTimeoutMillis: 30_000 },
  onBeforeFetch: async queue => {},
  onAfterComplete: async jobs => {},
  onRetry: async (job, error) => {},
})
```

```ts
await boss.createQueue('name', {
  policy: 'standard',        // 'standard' | 'short' | 'singleton' | 'stately'
  retryLimit: 2,
  retryDelay: 0,             // seconds
  retryBackoff: false,       // doubles the delay each attempt
  retryJitter: false,        // randomises within the delay
  expireIn: 900,             // seconds a job may stay active
  retentionDays: 14,
  deadLetter: 'name-dlq',
  rateLimit: { count: 100, period: 60 },
  debounce: 5,               // seconds
  fairness: { lowPriorityShare: 0.2 },
})
```

### Queue policies

| Policy | Behaviour |
|---|---|
| `standard` | Any number of jobs waiting and running |
| `short` | At most one job waiting; a send collapses onto it |
| `singleton` | At most one job running at a time |
| `stately` | One waiting and one running at a time |

---

## Database

Everything lives in the `baoboss` PostgreSQL schema.

```mermaid
erDiagram
    QUEUE ||--o{ JOB : "jobs are sent to"
    JOB ||--o{ JOB_DEPENDENCY : "waits on"
    SCHEDULE ||--o{ CRON_LOCK : "claims a minute in"
    SUBSCRIPTION }o--|| QUEUE : "fans out to"

    QUEUE {
        text name PK
        enum policy
        int retryLimit
        int expireIn
        int retentionDays
        text deadLetter
        bool paused
        jsonb rateLimit
        jsonb fairness
        int debounce
    }
    JOB {
        uuid id PK
        text queue
        enum state
        int priority
        jsonb data
        jsonb output
        int retryCount
        timestamptz startAfter
        timestamptz keepUntil
        text singletonKey
        int progress
    }
    JOB_DEPENDENCY {
        uuid jobId PK
        uuid dependsOnId PK
    }
    SCHEDULE {
        text name PK
        text cron
        text timezone
        jsonb data
    }
    SUBSCRIPTION {
        text event PK
        text queue PK
    }
    CRON_LOCK {
        text scheduleName PK
        text minuteBucket PK
        timestamptz lockedUntil
    }
    SCHEMA_VERSION {
        int version PK
        timestamptz appliedAt
    }
```

Indexes worth knowing about:

- `job(queue, state, startAfter, priority DESC)` serves the fetch query.
- A partial unique index on `job(queue, singletonKey)` where the state is open
  is what makes `singletonKey` mean something.
- Partial indexes on `startedOn` and `keepUntil` keep the maintenance sweeps off
  a sequential scan.

The maintenance loop expires overdue jobs, shortens `keepUntil` on settled ones,
deletes what is past `keepUntil`, purges aged cron locks, and fires due
schedules — each sweep self-scheduling so a slow pass never stacks on itself.

---

## Development

```bash
docker compose up -d                       # PostgreSQL 17
bun install

cd packages/bao-boss
export DATABASE_URL=postgresql://bao:bao@localhost:5432/bao
bunx prisma generate
bunx prisma migrate deploy

bun run validate:all                       # typecheck + lint + tests
```

| Script | What it runs |
|---|---|
| `bun run validate:all` | `typecheck`, then `lint`, then `test` |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | Project lint over src, test, scripts and the owned stylesheet |
| `bun test` | The full suite against a real database |
| `bun run verify:ui` | Drives a real browser over the dashboard (see below) |

### Testing

223 tests across 28 files, run against a real PostgreSQL instance. There are no
skipped tests and no arbitrary sleeps in test bodies — everything waits on a
condition. A run without `DATABASE_URL` fails loudly rather than passing with
nothing executed.

### The lint

`bun run lint` is a build gate, not advice. It has no warning level and no
suppression syntax, and it fails on:

raw class strings outside the token owner · markup interpolated without the
escaping template · user-facing text outside the message catalogue · suppression
comments · deferred-work markers · inline style, script or event handlers ·
`!important` · arbitrary Tailwind values · colour literals · physical-direction
classes · `100vh` · CDN URLs · undersized touch targets · native dialogs ·
`title` tooltips · timed refresh · missing `type`, `scope` or table tokens ·
skipped or exclusive tests · arbitrary waits · dead exports · re-export aliases ·
inline type imports · files over 350 lines · functions over 60 lines.

### Verifying the dashboard

```bash
cd apps/example && bun run dev            # in one terminal
cd packages/bao-boss && bun run verify:ui # in another
```

Drives Chromium over every surface at 390×844, 768×1024 and 1440×900 in both
themes — 30 cells — and writes a manifest with the counts alongside the
screenshots. It fails the run on horizontal overflow, a console or network
error, a theme mismatch, a touch target under 24 px, a contrast ratio below
WCAG 2.2 AA, a focus stop without a visible indicator, or a live mutation the
page does not pick up. It also sweeps the viewport from 320 px to 1920 px and
captures the forced-colors, reduced-motion and backdrop-filter-disabled paths.

---

## Repository layout

```mermaid
flowchart LR
    root["bao-boss/"] --> pkg["packages/bao-boss<br/>the library"]
    root --> ex["apps/example<br/>runnable Elysia app"]
    pkg --> src["src/"]
    pkg --> tests["test/ — 28 files"]
    pkg --> scripts["scripts/ — lint, UI verification"]
    pkg --> assets["assets/ — vendored CSS and JS"]
    pkg --> prisma["prisma/ — schema and migrations"]
    src --> core["BaoBoss · Manager · Worker<br/>Maintenance · Scheduler · Metrics"]
    src --> owners["defaults · schema · cron<br/>i18n · types"]
    src --> mgr["manager/ — queue, job, search,<br/>pub-sub, dead letter, mappers"]
    src --> dash["dashboard/ — shell, routes, html,<br/>tokens, theme, SSE, middleware"]
```

Each concept has exactly one owner: `defaults.ts` for every default value and
time constant, `schema.ts` for schema-name validation, `cron.ts` for the cron
grammar, `i18n.ts` for every user-facing string, `dashboard/ui.ts` for every
class token, `assets/baoboss.css` for the few primitives daisyUI does not
provide, and `dashboard/safe-html.ts` for the escaping boundary. Nothing
re-exports another module's symbol under a second name.

---

## Compatibility

| | |
|---|---|
| Bun | ≥ 1.2 |
| PostgreSQL | ≥ 15 (tested against 16 and 17) |
| Prisma | 7.x, via the `@prisma/adapter-pg` driver adapter |
| Elysia | ≥ 1.0, optional — only for the dashboard |

## License

MIT — see [LICENSE](LICENSE).
