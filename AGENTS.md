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
| Job CRUD & SKIP LOCKED | `packages/bao-boss/src/Manager.ts` |
| Worker polling | `packages/bao-boss/src/Worker.ts` |
| Cron scheduling | `packages/bao-boss/src/Scheduler.ts` |
| Maintenance loop | `packages/bao-boss/src/Maintenance.ts` |
| Dashboard routes | `packages/bao-boss/src/Dashboard.ts` |
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
5. **Raw SQL for SKIP LOCKED** — the `fetch` method uses `prisma.$queryRawUnsafe` with validated schema. Schema is passed from BaoBoss options; validate with `/^[a-zA-Z_][a-zA-Z0-9_]*$/` before use.
6. **Import from generated client** — all source files import `PrismaClient` from `./generated/prisma/client.js`, never from `@prisma/client`.
7. **TypeBox validation** — validate all user-facing inputs in Manager.ts using `Type` from `@sinclair/typebox` and `Value.Decode` from `@sinclair/typebox/value`. Do not import from Elysia in core library files.
8. **No frontend frameworks** — Dashboard uses htmx 2.x with inline HTML strings in Dashboard.ts. Dashboard is a separate entrypoint (`bao-boss/dashboard`).
9. **Error handling** — emit errors via `boss.emit('error', err)`, never swallow them.
10. **Tests** — add tests in `packages/bao-boss/test/` using `bun test`. Tests require a running PostgreSQL instance.

## Database Schema

All tables use the `baoboss` PostgreSQL schema:

- `baoboss.job` — jobs with state machine (created → active → completed/failed)
- `baoboss.job_dependency` — DAG dependencies between jobs
- `baoboss.queue` — queue configuration and policies
- `baoboss.schedule` — cron schedules with timezone support
- `baoboss.subscription` — pub/sub event-to-queue mappings
- `baoboss.cron_lock` — distributed lock for cron firing
- `baoboss.debounce_state` — debounced queue flush state
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
3. Update `Manager.ts` mapJob function if column names changed
4. Update `src/types.ts` interfaces

### Add a dashboard route
1. Add route in `Dashboard.ts` using Elysia's `app.get()` / `app.post()` / `app.delete()`
2. Return HTML strings with htmx attributes for interactivity
3. Use daisyUI classes and i18n (`t()`) for consistent styling and localization; ensure ARIA attributes (`scope="col"`, `aria-label`, `type="button"`) on interactive elements
4. Document the route in `README.md` Dashboard section
