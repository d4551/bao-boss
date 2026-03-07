# CLAUDE.md — bao-boss

> Context file for Claude Code and Claude-based AI agents working in this repository.

## Project Overview

bao-boss is a **Bun-native job queue library** built on PostgreSQL, inspired by pg-boss. It provides reliable background job processing with SKIP LOCKED concurrency, automatic retries, cron scheduling, pub/sub fan-out, dead letter queues, and an HTMX dashboard.

## Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Runtime | Bun >= 1.1 | Native APIs, test runner, package manager |
| HTTP | Elysia | Dashboard plugin with type-safe routes |
| ORM | Prisma 7 + PrismaPg adapter | Schema, migrations, raw SQL for SKIP LOCKED |
| Dashboard | htmx 2 + daisyUI 5 | Server-rendered HTML, i18n, ARIA |
| Language | TypeScript (strict) | Full type safety with generics |
| Database | PostgreSQL 15+ | SKIP LOCKED, pgcrypto, baoboss schema |
| Validation | TypeBox (`@sinclair/typebox`) | Runtime input validation |

## Repository Structure

```
bao-boss/
├── packages/bao-boss/        # Core library (publishable npm package)
│   ├── src/
│   │   ├── index.ts          # Public API exports
│   │   ├── BaoBoss.ts        # Main class — lifecycle, EventEmitter
│   │   ├── EventEmitter.ts   # Minimal EventEmitter (no Node dependency)
│   │   ├── Manager.ts        # Queue & job CRUD, SKIP LOCKED fetch
│   │   ├── Worker.ts         # Polling worker implementation
│   │   ├── Scheduler.ts      # Cron schedule management
│   │   ├── Maintenance.ts    # Expiry, archival, purge, cron firing
│   │   ├── Dashboard.ts      # Elysia plugin with HTMX routes
│   │   ├── Migrate.ts        # Prisma migration runner
│   │   ├── Metrics.ts        # Prometheus metrics
│   │   ├── i18n.ts           # Dashboard message keys
│   │   ├── cli.ts            # CLI binary (bao command)
│   │   └── types.ts          # TypeScript type definitions
│   ├── prisma/
│   │   ├── schema.prisma     # Prisma schema (baoboss namespace)
│   │   └── migrations/       # Prisma migrations
│   ├── sql/                  # Raw SKIP LOCKED query files
│   └── test/                 # Bun test suite
├── apps/example/             # Example Elysia app with dashboard
├── docker-compose.yaml       # PostgreSQL 17 for local dev
└── package.json              # Bun workspace root
```

## Development Conventions

- **Runtime**: Always use Bun, not Node.js. Use `bun test`, `bun run`, `bunx`.
- **TypeScript**: Strict mode enabled with `noUncheckedIndexedAccess`.
- **Module system**: ESNext modules (`.js` extension in imports even for `.ts` files).
- **Database**: All tables live in the `baoboss` PostgreSQL schema. Use Prisma for schema changes, raw SQL for SKIP LOCKED queries.
- **No JS frameworks**: Dashboard uses htmx with server-rendered HTML. No React/Vue/Svelte.
- **Monorepo**: Bun workspaces with `packages/*` and `apps/*`.
- **Testing**: Use `bun test` with tests in `packages/bao-boss/test/`.

## Key Architecture Decisions

1. **SKIP LOCKED** for concurrent job fetching — raw SQL via `prisma.$queryRawUnsafe` with validated schema (dynamic identifiers require Unsafe).
2. **Prisma 7 + PrismaPg adapter** — datasource URL in `prisma.config.ts` (not schema.prisma); uses `@prisma/adapter-pg` driver adapter with generated client from `src/generated/prisma/`.
3. **Multi-tenant schema** — `schema` option (default `baoboss`) is passed to Manager, Maintenance, Migrate; all raw SQL uses validated schema to prevent injection.
4. **EventEmitter** pattern — `BaoBoss` extends a minimal `EventEmitter` (no Node dependency; see `EventEmitter.ts`) for error/wip/stopped events.
5. **Queue policies** — `standard`, `short`, `singleton`, `stately` control concurrency at the queue level.
6. **Maintenance loop** — background supervisor handles expiry, archival, purge, and cron firing.
7. **Graceful shutdown** — workers drain in-flight handlers before stopping.
8. **Migrate** — uses `Bun.spawn` (async, non-blocking) for `prisma migrate deploy`.
9. **Separate dashboard entrypoint** — `bao-boss/dashboard` keeps Elysia as an optional peer dependency.

## Common Commands

```bash
docker compose up -d                    # Start PostgreSQL
bun install                             # Install dependencies
cd packages/bao-boss && bunx prisma generate  # Generate Prisma client
bunx prisma migrate deploy              # Run migrations
DATABASE_URL=postgresql://bao:bao@localhost:5432/bao bun test  # Run tests
cd apps/example && bun run dev          # Run example app
```

## Public API Surface

The main entrypoint (`bao-boss`) exports `BaoBoss` class and types. The dashboard is a separate entrypoint (`bao-boss/dashboard`) to keep Elysia optional:

- **Queue management**: `createQueue`, `updateQueue`, `deleteQueue`, `purgeQueue`, `getQueue`, `getQueues`, `pauseQueue`, `resumeQueue`
- **Job operations**: `send`, `insert`, `fetch`, `complete`, `fail`, `cancel`, `resume`, `getJobById`, `getJobsById`, `progress`
- **Workers**: `work` (start polling worker), `offWork` (stop worker)
- **Scheduling**: `schedule`, `unschedule`, `getSchedules`
- **Pub/Sub**: `publish`, `subscribe`, `unsubscribe`
- **Lifecycle**: `start`, `stop`
- **Utilities**: `migrate`, `getDLQDepth`, `migrate`; metrics exports: `getMetricsSnapshot`, `getQueueDepths`, `toPrometheusFormat`

## Code Patterns to Follow

When modifying this codebase:

- Use Prisma for standard CRUD, raw SQL only for SKIP LOCKED operations.
- Validate inputs with TypeBox schemas (`Type` from `@sinclair/typebox`, `Value.Decode` from `@sinclair/typebox/value`) in Manager.ts.
- Return `Job<T>` generic types from all job-returning methods.
- Emit errors via `boss.emit('error', err)` — never swallow errors silently.
- Use `Bun.sleep` or `setTimeout` for delays, not busy-waiting.
- Dashboard HTML is inline in Dashboard.ts — no template files.
- Dashboard: use `t()` from i18n.ts for all user-facing strings; add ARIA attributes (`scope="col"`, `aria-label`, `type="button"`) on tables and buttons.
- Keep the CLI simple — each command creates a BaoBoss instance, performs one action, then stops.
