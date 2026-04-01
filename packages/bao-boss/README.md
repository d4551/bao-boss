# bao-boss

[![npm](https://img.shields.io/npm/v/bao-boss)](https://www.npmjs.com/package/bao-boss)
[![CI](https://github.com/d4551/bao-boss/actions/workflows/ci.yml/badge.svg)](https://github.com/d4551/bao-boss/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/d4551/bao-boss)](https://github.com/d4551/bao-boss)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.2-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

A Bun-native job queue library built on PostgreSQL.

## ELI5

- You create queues and send jobs to them.
- Workers poll for jobs using PostgreSQL SKIP LOCKED, so no two workers process the same job.
- Failed jobs retry automatically with exponential backoff.
- Jobs that exhaust all retries route to a dead letter queue.
- Cron schedules fire jobs on a timer with distributed locking.
- An HTMX dashboard lets you monitor everything in a browser.
- Prometheus metrics track throughput per queue.

## Why bao-boss

- Bun-native runtime with no Node.js polyfills or compatibility shims.
- SKIP LOCKED for concurrent job fetching without advisory locks.
- Prisma 7 for schema management, raw SQL only where SKIP LOCKED requires it.
- Queue policies (standard, short, singleton, stately) for concurrency control.
- Rate limiting, debouncing, and fairness at the queue level.
- Job dependencies for DAG workflows.
- HTMX dashboard with auth, CSRF, i18n, and ARIA accessibility.
- Per-queue Prometheus metrics with no external collector dependency.
- Multi-tenant schema isolation via configurable PostgreSQL schema name.

## Install

```bash
bun add bao-boss @prisma/client prisma
bun add elysia  # optional, only needed for the dashboard
```

Requires Bun >= 1.2 and PostgreSQL 15+.

## Quick Start

```ts
import { BaoBoss } from 'bao-boss'

const boss = new BaoBoss({ connectionString: Bun.env['DATABASE_URL'] })
await boss.start()

await boss.createQueue('emails-dlq')
await boss.createQueue('emails', {
  retryLimit: 3,
  retryBackoff: true,
  deadLetter: 'emails-dlq',
})

const id = await boss.send('emails', { to: 'user@example.com', subject: 'Hello' })

await boss.work('emails', async ([job]) => {
  console.log('Sending email to:', job.data.to)
})

await boss.schedule('daily-digest', '0 8 * * *', { type: 'digest' })

// On shutdown
await boss.stop()
```

## API Map

| Problem | API | Result |
|---------|-----|--------|
| Create a queue | `createQueue(name, options?)` | `Queue` |
| Update queue settings | `updateQueue(name, options)` | `Queue` |
| Delete a queue and its jobs | `deleteQueue(name)` | `void` |
| Remove pending jobs | `purgeQueue(name)` | `void` |
| Get queue config | `getQueue(name)` | `Queue \| null` |
| List all queues | `getQueues()` | `Queue[]` |
| Count pending + active jobs | `getQueueSize(name, options?)` | `number` |
| Pause / resume a queue | `pauseQueue(name)`, `resumeQueue(name)` | `void` |
| Send a job | `send(queue, data?, options?)` | `string` (job ID) |
| Batch insert jobs | `insert(jobs)` | `string[]` |
| Fetch and lock jobs | `fetch(queue, options?)` | `Job<T>[]` |
| Mark job done | `complete(id, options?)` | `void` |
| Mark job failed | `fail(id, error?)` | `void` |
| Cancel a job | `cancel(id)` | `void` |
| Re-enqueue a job | `resume(id)` | `void` |
| Update job progress | `progress(id, value)` | `void` |
| Get a job by ID | `getJobById(id)` | `Job<T> \| null` |
| Get jobs by IDs | `getJobsById(ids)` | `Job<T>[]` |
| Search jobs | `searchJobs(filter?)` | `{ jobs, total }` |
| Bulk cancel | `cancelJobs(queue, filter?)` | `number` |
| Bulk resume | `resumeJobs(queue, filter?)` | `number` |
| Query job DAG | `getJobDependencies(id)` | `{ dependsOn, dependedBy }` |
| Count DLQ jobs | `getDLQDepth(name)` | `number` |
| Start a polling worker | `work(queue, options?, handler)` | `string` (worker ID) |
| Stop a worker | `offWork(queueOrId)` | `void` |
| Create cron schedule | `schedule(name, cron, data?, options?)` | `void` |
| Remove cron schedule | `unschedule(name)` | `void` |
| List schedules | `getSchedules()` | `Schedule[]` |
| Publish event | `publish(event, data?, options?)` | `void` |
| Subscribe queue to event | `subscribe(event, queue)` | `void` |
| Unsubscribe | `unsubscribe(event, queue)` | `void` |
| Run migrations | `migrate()` | `void` |
| Connect and start maintenance | `start()` | `void` |
| Drain workers and disconnect | `stop()` | `void` |

## Queue Policies

Policies control how many jobs a queue allows in each state.

```ts
await boss.createQueue('reports', { policy: 'singleton' })
```

| Policy | Behaviour |
|--------|-----------|
| `standard` | Default FIFO. Multiple jobs of any state. |
| `short` | At most one `created` job. New sends return the existing ID. |
| `singleton` | At most one `active` job. Fetch returns empty while one runs. |
| `stately` | At most one `created` and one `active` simultaneously. |

## Workers

Workers poll for jobs, execute a handler, and mark jobs completed or failed.

```ts
const workerId = await boss.work<EmailPayload>(
  'emails',
  { batchSize: 5, pollingIntervalSeconds: 1 },
  async (jobs) => {
    for (const job of jobs) {
      await sendEmail(job.data.to, job.data.subject)
    }
  },
)

await boss.offWork(workerId)
```

Options: `batchSize`, `pollingIntervalSeconds`, `maxConcurrency`, `handlerTimeoutSeconds`.

## Cron Scheduling

The maintenance loop fires jobs when a cron expression matches, using distributed locking to prevent duplicates.

```ts
await boss.schedule('weekly-report', '0 9 * * 1', {}, { tz: 'America/New_York' })
await boss.unschedule('weekly-report')

import { validateCron, describeCron } from 'bao-boss'
validateCron('0 9 * * 1-5')           // passes
describeCron('0 9 * * 1-5')           // "at minute 0, at hour 9, on day-of-week 1-5"
```

Standard 5-field format. Aliases: `@yearly`, `@monthly`, `@weekly`, `@daily`, `@hourly`.

## Pub/Sub

Fan-out events to multiple queues.

```ts
await boss.subscribe('user.created', 'send-welcome-email')
await boss.subscribe('user.created', 'provision-account')

await boss.publish('user.created', { userId: 42 })

await boss.unsubscribe('user.created', 'send-welcome-email')
```

## Job Dependencies

Jobs can depend on other jobs, forming a DAG. A dependent job stays in `created` until all upstream jobs complete.

```ts
const parentId = await boss.send('etl', { step: 'extract' })
const childId = await boss.send('etl', { step: 'transform' }, { dependsOn: [parentId] })

const deps = await boss.getJobDependencies(childId)
// deps.dependsOn -> [parent job]
```

## Rate Limiting and Fairness

Queues support rate limits, debouncing, and fairness shares for low-priority jobs.

```ts
await boss.createQueue('api-calls', {
  rateLimit: { count: 100, period: 60 },
  debounce: 10,
  fairness: { lowPriorityShare: 0.2 },
})
```

## Search and Bulk Operations

```ts
const result = await boss.searchJobs({
  queue: 'emails',
  state: ['failed', 'cancelled'],
  limit: 20,
  sortBy: 'createdOn',
  sortOrder: 'desc',
})

const cancelled = await boss.cancelJobs('emails', { state: 'created' })
const resumed = await boss.resumeJobs('emails', { state: 'failed' })
```

## Dashboard

Mount the HTMX dashboard as an Elysia plugin. No JS framework required.

```ts
import { Elysia } from 'elysia'
import { BaoBoss } from 'bao-boss'
import { baoBossDashboard } from 'bao-boss/dashboard'

const boss = new BaoBoss()
await boss.start()

const app = new Elysia()
  .use(baoBossDashboard(boss, {
    prefix: '/boss',
    auth: 'secret-token',
    csrf: true,
    locale: 'en',
  }))
  .listen(3000)
```

Routes: queue list, queue detail, job detail, retry, cancel, schedules, stats, Prometheus metrics endpoint, SSE progress streaming.

## Metrics

Per-queue Prometheus metrics with no external collector.

```ts
import { getMetricsSnapshot, getQueueDepths, toPrometheusFormat } from 'bao-boss'

const snapshot = getMetricsSnapshot()
snapshot.queueDepth = await getQueueDepths(boss.prisma)
const text = toPrometheusFormat(snapshot)
```

Labels: `baoboss_jobs_processed_total`, `baoboss_jobs_failed_total`, `baoboss_processing_duration_seconds`, `baoboss_queue_depth{queue}`, and per-queue variants.

## Events

`BaoBoss` extends a minimal `EventEmitter` (no Node dependency).

```ts
boss.on('error', (err) => console.error(err))
boss.on('stopped', () => console.log('shutdown complete'))
boss.on('dlq', ({ jobId, queue, deadLetter }) => { /* alert */ })
boss.on('progress', ({ id, queue, progress }) => { /* update UI */ })
boss.on('queue:paused', ({ queue }) => { /* log */ })
boss.on('queue:resumed', ({ queue }) => { /* log */ })
```

## Public Entrypoints

| Entrypoint | Purpose |
|------------|---------|
| `bao-boss` | BaoBoss class, types, metrics, cron utilities, migration |
| `bao-boss/dashboard` | Elysia plugin for HTMX dashboard |

## CLI

| Command | Description |
|---------|-------------|
| `bao migrate` | Run pending Prisma migrations |
| `bao migrate:reset` | Drop and recreate the baoboss schema |
| `bao queues` | List all queues and job counts |
| `bao purge <queue>` | Purge pending jobs from a queue |
| `bao retry <id>` | Re-enqueue a failed job |
| `bao schedule:ls` | List all cron schedules |
| `bao schedule:rm <name>` | Remove a cron schedule |

## Repository Scripts

```bash
bun install
bun run lint
bun test
bunx tsc --noEmit
```

## License

MIT
