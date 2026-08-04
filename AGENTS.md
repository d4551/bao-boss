# AGENTS.md — bao-boss

> Instructions for AI coding agents (OpenAI Codex, GitHub Copilot Workspace, and others) working in this repository.

## What This Project Is

bao-boss is a Bun-native PostgreSQL job queue library. It provides background job processing with SKIP LOCKED concurrency, retries, cron scheduling, pub/sub, dead letter queues, and an HTMX dashboard. Think pg-boss, rebuilt for Bun.

## Agent Routing

| Question About | Read |
|---------------|------|
| Project overview | `README.md` |
| Architecture & conventions | `CLAUDE.md` |
| API reference | `README.md` → API Reference section |
| Database schema | `packages/bao-boss/prisma/schema.prisma` |
| Type definitions | `packages/bao-boss/src/types.ts` |
| Main class | `packages/bao-boss/src/BaoBoss.ts` |
| Job CRUD & SKIP LOCKED | `packages/bao-boss/src/Manager.ts`, `src/manager/` |
| Default values | `packages/bao-boss/src/defaults.ts` |
| HTML escaping | `packages/bao-boss/src/dashboard/safe-html.ts` |
| Worker polling | `packages/bao-boss/src/Worker.ts` |
| Cron scheduling | `packages/bao-boss/src/Scheduler.ts` |
| Maintenance loop | `packages/bao-boss/src/Maintenance.ts` |
| Dashboard routes | `packages/bao-boss/src/Dashboard.ts`, handlers in `src/dashboard/routes.ts` |
| Dashboard i18n | `packages/bao-boss/src/i18n.ts` |
| EventEmitter | `packages/bao-boss/src/EventEmitter.ts` |
| Migrations | `packages/bao-boss/src/Migrate.ts` |
| Metrics | `packages/bao-boss/src/Metrics.ts` |
| CLI commands | `packages/bao-boss/src/cli.ts` |
| Tests | `packages/bao-boss/test/` |
| Example app | `apps/example/src/index.ts` |

## Coding Rules

1. **Use Bun, not Node.js** — `bun test`, `bun run`, `bunx prisma`. No `node:` or `events` imports; use `EventEmitter.ts` for event emission.
2. **TypeScript strict mode** — no `any` types, use generics for job data.
3. **ESNext modules** — use `.js` extensions in imports (Bun resolves to `.ts`).
4. **Prisma 7 for schema** — modify `packages/bao-boss/prisma/schema.prisma` for DB changes, then run `bunx prisma migrate dev`. Uses `prisma-client` generator with output to `src/generated/prisma/` and `@prisma/adapter-pg` driver adapter.
5. **Raw SQL for SKIP LOCKED** — `manager/job-fetch.ts` builds the claim query; `prisma.$queryRawUnsafe` runs it. Never re-declare the schema regex: import `validateSchema` from `src/schema.ts`, which also rejects a namespace this build was not generated for.
6. **Import from generated client** — all source files import `PrismaClient` from `./generated/prisma/client.js`, never from `@prisma/client`.
7. **TypeBox validation** — schemas live in `manager/mappers.ts` and are decoded at the operation that uses them (`createQueueSchema`, `sendOptionsSchema`, `jobSearchSchema`). Job payloads cross into the database through `toJsonInput`, which walks the value rather than asserting it. Do not import from Elysia in core library files.
8. **No frontend frameworks** — htmx 2.x, server-rendered. Build every fragment with the `html` tagged template from `dashboard/safe-html.ts`; a bare template literal containing markup fails the lint. Class strings come from `dashboard/ui.ts` and copy comes from `i18n.ts`. Dashboard is a separate entrypoint (`bao-boss/dashboard`).
9. **Error handling** — emit errors via `boss.emit('error', err)`, never swallow them.
10. **Tests** — add tests in `packages/bao-boss/test/` using `bun test`. A running PostgreSQL instance is required; a run without `DATABASE_URL` fails loudly. Wait on a condition with `waitFor`, never on a fixed delay.
11. **Gates** — `bun run validate:all` runs typecheck, lint and tests. The lint has no warning level and no suppression syntax; fix the finding, never silence it.

## Database Schema

All tables use the `baoboss` PostgreSQL schema:

- `baoboss.job` — jobs with state machine (created → active → completed/failed)
- `baoboss.job_dependency` — DAG dependencies between jobs
- `baoboss.queue` — queue configuration and policies
- `baoboss.schedule` — cron schedules with timezone support
- `baoboss.subscription` — pub/sub event-to-queue mappings
- `baoboss.cron_lock` — distributed lock for cron firing
- `baoboss.schema_version` — migration tracking

## Job State Machine

```
created → active → completed
active → created (fail with retries remaining)
active → failed (fail with retries exhausted / expire)
failed → DLQ (deadLetter configured, copy)
created → cancelled
active → cancelled
cancelled/failed → created (resume)
```

## Common Tasks

### Add a new public method
1. Add the type to `src/types.ts`
2. Implement in the appropriate class (Manager, Scheduler, etc.)
3. Expose via `BaoBoss.ts` as a pass-through method
4. Export types from `src/index.ts`
5. Add tests in `test/`
6. Document in `README.md`

### Modify the database schema
1. Edit `packages/bao-boss/prisma/schema.prisma`
2. Run `bunx prisma migrate dev --name describe_change`
3. Update `toDomainJob` in `src/manager/mappers.ts` if column names changed
4. Update `src/types.ts` interfaces
5. Bump `SCHEMA_VERSION` in `src/Migrate.ts` in the same commit

### Add a dashboard route
1. Add the route in `Dashboard.ts` using Elysia's `app.get()` / `app.post()` / `app.delete()`
2. Put the handler in `dashboard/routes.ts` and the markup in `dashboard/html.ts` or `html-jobs.ts`, built with the `html` tagged template
3. Take class strings from `dashboard/ui.ts` and copy from `i18n.ts`; add ARIA attributes (`scope`, `aria-label`, `type="button"`) — the lint checks all of this
4. Keep state that should survive a refresh in the URL; stream anything live over SSE rather than a timed refresh
5. Document the route in the `README.md` Dashboard table and add a test
