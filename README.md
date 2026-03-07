# 🥟 bao-boss

A Bun-native job queue library built on PostgreSQL — inspired by pg-boss, designed for the Bun runtime.

[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-336791?logo=postgresql)](https://www.postgresql.org)

## Features

- 🚀 **Bun-native** — built for the Bun runtime with Bun's native APIs
- 🔒 **SKIP LOCKED** — reliable concurrent job fetching with PostgreSQL advisory locks
- 🔄 **Automatic retries** — configurable retry limits, delays, and exponential backoff
- ⏰ **Cron scheduling** — built-in cron job scheduler
- 📨 **Pub/Sub** — event-based fan-out to multiple queues
- 💀 **Dead letter queues** — automatic routing of failed jobs
- 🎛️ **HTMX dashboard** — real-time web UI for monitoring and managing jobs
- 🛠️ **CLI** — command-line tools for queue management
- 📐 **TypeScript strict** — full type safety throughout

## Requirements

- [Bun](https://bun.sh) >= 1.0
- PostgreSQL 15+

## Quick Start

### 1. Start PostgreSQL

```bash
docker compose up -d
```

### 2. Set environment variable

```bash
export DATABASE_URL="postgresql://bao:bao@localhost:5432/bao"
```

### 3. Run migrations

```bash
cd packages/bao-boss
bunx prisma migrate deploy
```

### 4. Use in your app

```typescript
import { BaoBoss } from 'bao-boss'

const boss = new BaoBoss({ connectionString: process.env.DATABASE_URL })
await boss.start()

// Send a job
const id = await boss.send('emails', { to: 'user@example.com', subject: 'Hello' })

// Process jobs
await boss.work('emails', async ([job]) => {
  console.log('Processing:', job.data)
})
```

## Installation

```bash
bun add bao-boss
```

## API Reference

### `new BaoBoss(options?)`

Creates a new BaoBoss instance.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `connectionString` | `string` | `DATABASE_URL` env | PostgreSQL connection string |
| `prisma` | `PrismaClient` | — | Bring your own Prisma client |
| `maintenanceIntervalSeconds` | `number` | `120` | How often maintenance runs |
| `archiveCompletedAfterSeconds` | `number` | `43200` (12h) | Archive completed jobs after |
| `deleteArchivedAfterDays` | `number` | `7` | Delete archived jobs after |
| `noSupervisor` | `boolean` | `false` | Disable background maintenance |
| `shutdownGracePeriodSeconds` | `number` | `30` | Grace period for worker drain |

### `boss.start()`

Connects to the database and starts the maintenance supervisor.

```typescript
await boss.start()
```

### `boss.stop()`

Gracefully stops all workers and disconnects.

```typescript
await boss.stop()
```

---

### Queue Management

#### `boss.createQueue(name, options?)`

Creates or updates a queue.

```typescript
await boss.createQueue('emails', {
  policy: 'standard',       // 'standard' | 'short' | 'singleton' | 'stately'
  retryLimit: 3,
  retryDelay: 5,            // seconds between retries
  retryBackoff: true,       // exponential backoff
  expireIn: 300,            // seconds before active job expires
  retentionDays: 14,        // days to keep completed jobs
  deadLetter: 'emails-dlq', // dead letter queue name
})
```

**Queue Policies:**

| Policy | Description |
|--------|-------------|
| `standard` | Default — multiple jobs can be created and active |
| `short` | At most one pending job; new sends return the existing job ID |
| `singleton` | Only one job active at a time |
| `stately` | At most one created + one active job simultaneously |

#### `boss.updateQueue(name, options)`

Updates queue settings.

#### `boss.deleteQueue(name)`

Deletes a queue and all its jobs.

#### `boss.purgeQueue(name)`

Deletes all pending (created) jobs from a queue.

#### `boss.getQueue(name)`

Returns queue details or `null`.

#### `boss.getQueues()`

Returns all queues.

#### `boss.getQueueSize(name, options?)`

Returns the number of pending jobs.

```typescript
const size = await boss.getQueueSize('emails')
const pending = await boss.getQueueSize('emails', { before: 'active' }) // created only
```

---

### Job Operations

#### `boss.send(queue, data?, options?)`

Sends a job to a queue. Returns the job ID.

```typescript
const id = await boss.send('emails', { to: 'user@example.com' }, {
  priority: 10,           // higher = processed first (default: 0)
  startAfter: 30,         // seconds delay, or Date, or ISO string
  retryLimit: 5,
  retryDelay: 10,
  retryBackoff: true,
  expireIn: 60,
  singletonKey: 'unique', // prevent duplicate jobs
  deadLetter: 'emails-dlq',
})
```

#### `boss.insert(jobs)`

Batch-inserts multiple jobs in a single transaction.

```typescript
const ids = await boss.insert([
  { name: 'emails', data: { to: 'a@example.com' } },
  { name: 'emails', data: { to: 'b@example.com' } },
])
```

#### `boss.fetch(queue, options?)`

Manually fetches and locks jobs (SKIP LOCKED).

```typescript
const jobs = await boss.fetch('emails', { batchSize: 5 })
for (const job of jobs) {
  // process job...
  await boss.complete(job.id)
}
```

#### `boss.complete(id, options?)`

Marks a job as completed.

```typescript
await boss.complete(jobId, { output: { result: 'sent' } })
// Or complete multiple:
await boss.complete([id1, id2, id3])
```

#### `boss.fail(id, error?)`

Marks a job as failed (will retry if retries remain).

```typescript
await boss.fail(jobId, new Error('SMTP connection refused'))
```

#### `boss.cancel(id)`

Cancels a pending or active job.

```typescript
await boss.cancel(jobId)
// Or cancel multiple:
await boss.cancel([id1, id2])
```

#### `boss.resume(id)`

Re-enqueues a cancelled or failed job.

```typescript
await boss.resume(jobId)
```

#### `boss.getJobById(id)`

Fetches a job by ID.

#### `boss.getJobsById(ids)`

Fetches multiple jobs by ID.

---

### Workers

#### `boss.work(queue, options?, handler)`

Starts a worker that polls a queue and processes jobs.

```typescript
interface EmailPayload {
  to: string
  subject: string
  body: string
}

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

**WorkOptions:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `batchSize` | `number` | `1` | Jobs fetched per poll |
| `pollingIntervalSeconds` | `number` | `2` | Poll interval |
| `includeMetadata` | `boolean` | `false` | Include job metadata |
| `priority` | `boolean` | `true` | Process high-priority first |

#### `boss.offWork(queueOrWorkerId)`

Stops a worker (by ID or queue name) gracefully, waiting for in-flight jobs.

```typescript
await boss.offWork(workerId)
// or stop all workers for a queue:
await boss.offWork('emails')
```

---

### Scheduling

#### `boss.schedule(name, cron, data?, options?)`

Creates or updates a cron schedule.

```typescript
// Every day at 8am UTC
await boss.schedule('daily-digest', '0 8 * * *', { type: 'digest' })

// Every Monday at 9am in a specific timezone
await boss.schedule('weekly-report', '0 9 * * 1', { report: 'weekly' }, { tz: 'America/New_York' })
```

#### `boss.unschedule(name)`

Removes a cron schedule.

#### `boss.getSchedules()`

Lists all cron schedules.

---

### Pub/Sub

#### `boss.subscribe(event, queue)`

Subscribes a queue to an event.

```typescript
await boss.subscribe('user.registered', 'send-welcome-email')
await boss.subscribe('user.registered', 'setup-user-account')
```

#### `boss.publish(event, data?, options?)`

Publishes an event, sending a job to all subscribed queues.

```typescript
await boss.publish('user.registered', { userId: '123', email: 'new@example.com' })
```

#### `boss.unsubscribe(event, queue)`

Removes a queue subscription.

---

### Dashboard

Mount the HTMX dashboard as an Elysia plugin:

```typescript
import { Elysia } from 'elysia'
import { BaoBoss, baoBossDashboard } from 'bao-boss'

const boss = new BaoBoss()
await boss.start()

const app = new Elysia()
  .use(baoBossDashboard(boss, {
    prefix: '/boss',     // URL prefix (default: '/boss')
    auth: 'secret-token', // Optional bearer/header token
  }))
  .listen(3000)
```

Access the dashboard at `http://localhost:3000/boss`.

**Dashboard features:**
- Live stats (auto-refreshes every 10s via HTMX)
- Queue listing with pending job counts
- Per-queue job browser (last 50 jobs)
- Job detail view with data and output
- Retry failed/cancelled jobs
- Cancel pending/active jobs
- Cron schedule management
- Dark mode support

---

### CLI

```bash
# Run pending Prisma migrations
bao migrate

# Drop & recreate the baoboss schema
bao migrate:reset

# List queues and job counts
bao queues

# Purge all pending jobs from a queue
bao purge my-queue

# Retry a failed job by ID
bao retry <job-id>

# List cron schedules
bao schedule:ls

# Remove a cron schedule
bao schedule:rm daily-digest
```

---

## Events

`BaoBoss` extends `EventEmitter`:

```typescript
boss.on('error', (err) => console.error('BaoBoss error:', err))
boss.on('wip', (data) => console.log('Jobs in flight:', data))
boss.on('stopped', () => console.log('BaoBoss stopped'))
```

---

## Database Schema

All tables are created in the `baoboss` PostgreSQL schema.

| Table | Description |
|-------|-------------|
| `baoboss.job` | All jobs with state, retry info, payload |
| `baoboss.queue` | Queue configuration |
| `baoboss.schedule` | Cron schedules |
| `baoboss.subscription` | Event → queue subscriptions |

### Job States

```
created → active → completed
                ↘ failed (retries exhausted) → dead letter queue
created ← failed (retries remaining)
created/active → cancelled
cancelled/failed → created (resume)
```

---

## Development

```bash
# Start PostgreSQL
docker compose up -d

# Install dependencies
bun install

# Generate Prisma client
cd packages/bao-boss && bunx prisma generate

# Run migrations
bunx prisma migrate deploy

# Run tests (requires DATABASE_URL)
DATABASE_URL=postgresql://bao:bao@localhost:5432/bao bun test

# Run example app
cd apps/example && bun run dev
```

## License

MIT
