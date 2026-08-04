# CLAUDE.md — bao-boss

> Context file for Claude Code and Claude-based AI agents working in this repository.

## Project Overview

bao-boss is a **Bun-native job queue library** built on PostgreSQL, inspired by pg-boss. It provides reliable background job processing with SKIP LOCKED concurrency, automatic retries, cron scheduling, pub/sub fan-out, dead letter queues, and an HTMX dashboard.

## Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Runtime | Bun >= 1.2 | Native APIs, test runner, package manager |
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
│   │   ├── Manager.ts        # Facade delegating to manager/ modules
│   │   ├── Worker.ts         # Polling worker implementation
│   │   ├── Scheduler.ts      # Cron schedule management (with validation)
│   │   ├── Maintenance.ts    # Expiry, archival, purge, cron firing
│   │   ├── Dashboard.ts      # Elysia plugin (route wiring)
│   │   ├── Migrate.ts        # Prisma migration runner
│   │   ├── Metrics.ts        # Per-queue Prometheus metrics
│   │   ├── i18n.ts           # Dashboard i18n message keys
│   │   ├── cli.ts            # CLI binary (bao command)
│   │   ├── cron.ts           # Cron parser, validator, describer
│   │   ├── schema.ts         # Schema name validation (centralized)
│   │   ├── types.ts          # TypeScript type definitions
│   │   ├── defaults.ts       # Every default value and time constant
│   │   ├── cron-describe.ts  # Human rendering of a parsed cron expression
│   │   ├── manager/          # Decomposed Manager modules
│   │   │   ├── mappers.ts    # Schemas, JSON boundary, row-to-domain mapper
│   │   │   ├── job-create.ts # The one job-creation path (singleton aware)
│   │   │   ├── job-fetch.ts  # SKIP LOCKED query builder, rate limit, batching
│   │   │   ├── queue-ops.ts  # Queue CRUD operations
│   │   │   ├── job-ops.ts    # Job mutations (send, fetch, complete, fail)
│   │   │   ├── job-queries.ts # Job queries (search, deps, progress)
│   │   │   ├── dlq.ts        # Dead-letter copies
│   │   │   └── pubsub.ts     # Pub/Sub operations
│   │   └── dashboard/        # Decomposed Dashboard modules
│   │       ├── safe-html.ts  # The escaping boundary (html`` tag)
│   │       ├── shell.ts      # Full-page shell + nav SSOT
│   │       ├── ui.ts         # daisyUI/Tailwind class tokens
│   │       ├── theme.ts      # Server-side theme negotiation
│   │       ├── assets.ts     # Vendored static asset serving
│   │       ├── bulk.ts       # Bulk body decode (TypeBox)
│   │       ├── routes.ts     # Route handler functions
│   │       ├── sse-stream.ts # SSE plumbing (heartbeat, retry, close)
│   │       ├── sse.ts        # Per-job progress stream
│   │       ├── sse-live.ts   # Live counters and queue table stream
│   │       ├── html.ts       # Shared markup helpers, queues, schedules
│   │       ├── html-jobs.ts  # Job rows, table, detail, undo results
│   │       ├── middleware.ts # Auth, CSRF, rate limiting
│   │       └── response.ts   # Response builders, security headers
│   ├── assets/               # Vendored daisyUI/htmx/tailwind + owned baoboss.css
│   ├── scripts/
│   │   ├── lint.ts           # Build-gate lint (src, test, scripts, css)
│   │   ├── lint-rules.ts     # The rule table
│   │   ├── verify-ui.ts      # Real-browser capture matrix
│   │   └── verify-contrast.ts # WCAG contrast maths
│   ├── prisma/
│   │   ├── schema.prisma     # Prisma schema (baoboss namespace)
│   │   └── migrations/       # Prisma migrations
│   └── test/                 # 28 test files, 225 tests
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
10. **Decomposed Manager** — Manager.ts is a thin facade delegating to manager/ submodules (queue-ops, job-ops, job-queries, pubsub, mappers).
11. **Decomposed Dashboard** — Dashboard.ts is route wiring only; handlers, middleware, HTML helpers, and SSE in dashboard/ submodules.
12. **Centralized schema validation** — `schema.ts` is single source for SCHEMA_RE and validateSchema.
13. **Cron module** — `cron.ts` extracts cron parsing, validation, and description from Maintenance.ts.
14. **Per-queue metrics** — Metrics.ts tracks counters per queue, exports Prometheus labels.

## Common Commands

```bash
docker compose up -d                    # Start PostgreSQL
bun install                             # Install dependencies
cd packages/bao-boss && DATABASE_URL=postgresql://bao:bao@localhost:5432/bao bunx prisma generate  # Generate Prisma client
DATABASE_URL=postgresql://bao:bao@localhost:5432/bao bunx prisma migrate deploy  # Run migrations
DATABASE_URL=postgresql://bao:bao@localhost:5432/bao bun run validate:all  # typecheck + lint + tests
cd apps/example && bun run dev          # Run example app
cd packages/bao-boss && bun run verify:ui  # Real-browser capture matrix (app must be running)
```

## Public API Surface

The main entrypoint (`bao-boss`) exports `BaoBoss` class and types. The dashboard is a separate entrypoint (`bao-boss/dashboard`) to keep Elysia optional:

- **Queue management**: `createQueue`, `updateQueue`, `deleteQueue`, `purgeQueue`, `getQueue`, `getQueues`, `pauseQueue`, `resumeQueue`
- **Job operations**: `send`, `insert`, `fetch`, `complete`, `fail`, `cancel`, `resume`, `getJobById`, `getJobsById`, `progress`, `searchJobs`, `cancelJobs`, `resumeJobs`, `getJobDependencies`
- **Workers**: `work` (start polling worker), `offWork` (stop worker)
- **Scheduling**: `schedule`, `unschedule`, `getSchedules`
- **Pub/Sub**: `publish`, `subscribe`, `unsubscribe`
- **Lifecycle**: `start`, `stop`
- **Utilities**: `migrate`, `getDLQDepth`, `validateCron`, `describeCron`; metrics exports: `getMetricsSnapshot`, `getQueueDepths`, `toPrometheusFormat`

## Code Patterns to Follow

When modifying this codebase:

- Use Prisma for standard CRUD, raw SQL only for SKIP LOCKED operations.
- Validate inputs with TypeBox schemas (`Type` from `@sinclair/typebox`, `Value.Decode` from `@sinclair/typebox/value`) in Manager.ts.
- Return `Job<T>` generic types from all job-returning methods.
- Emit errors via `boss.emit('error', err)` — never swallow errors silently.
- Use `Bun.sleep` or `setTimeout` for delays, not busy-waiting.
- Dashboard HTML is composed in `dashboard/` modules (shell/html/html-jobs/routes) — no template files; no CDN (assets under `packages/bao-boss/assets/`, including the owned `baoboss.css`).
- Dashboard: use `t()` from i18n.ts for all user-facing strings; use `UI` tokens from `dashboard/ui.ts` for classes; add ARIA attributes (`scope="col"`, `aria-label`, `type="button"`) on tables and buttons; primary nav via `navItems()` only.
- Keep the CLI simple — each command creates a BaoBoss instance, performs one action, then stops.
- Run `bun run validate:all` before committing. The lint has no warning level and no suppression syntax — fix the finding, never silence it.
- No `as unknown`, `as never`, `as any` typecasts, and no non-null assertions in `src/` — use the typed mappers in `manager/mappers.ts`.
- Keep files under 350 lines and functions under 60 lines.
- Import `validateSchema` and `GENERATED_SCHEMA` from `schema.ts` (never re-declare the regex or the namespace).
- Import every default value and time constant from `defaults.ts`.
- Build dashboard markup with the `html` tagged template from `dashboard/safe-html.ts`; class strings come from `dashboard/ui.ts`, copy from `i18n.ts`.
- Nothing re-exports another module's symbol; `src/index.ts` is the only file that publishes.
- Import `parseCron` from `cron.ts` (not local definitions).
