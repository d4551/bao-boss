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
| CLI commands | `packages/bao-boss/src/cli.ts` |
| Tests | `packages/bao-boss/test/` |
| Example app | `apps/example/src/index.ts` |

## Coding Rules

1. **Use Bun, not Node.js** — `bun test`, `bun run`, `bunx prisma`.
2. **TypeScript strict mode** — no `any` types, use generics for job data.
3. **ESNext modules** — use `.js` extensions in imports (Bun resolves to `.ts`).
4. **Prisma 7 for schema** — modify `packages/bao-boss/prisma/schema.prisma` for DB changes, then run `bunx prisma migrate dev`. Uses `prisma-client` generator with output to `src/generated/prisma/` and `@prisma/adapter-pg` driver adapter.
5. **Raw SQL for SKIP LOCKED** — the `fetch` method uses `prisma.$queryRaw` with `FOR UPDATE SKIP LOCKED`. Keep this pattern.
6. **Import from generated client** — all source files import `PrismaClient` from `./generated/prisma/client.js`, never from `@prisma/client`.
7. **TypeBox validation** — validate all user-facing inputs in Manager.ts using `Type` from `@sinclair/typebox` and `Value.Decode` from `@sinclair/typebox/value`. Do not import from Elysia in core library files.
8. **No frontend frameworks** — Dashboard uses htmx 2.x with inline HTML strings in Dashboard.ts. Dashboard is a separate entrypoint (`bao-boss/dashboard`).
9. **Error handling** — emit errors via `boss.emit('error', err)`, never swallow them.
10. **Tests** — add tests in `packages/bao-boss/test/` using `bun test`. Tests require a running PostgreSQL instance.

## Database Schema

All tables use the `baoboss` PostgreSQL schema:

- `baoboss.job` — jobs with state machine (created → active → completed/failed)
- `baoboss.queue` — queue configuration and policies
- `baoboss.schedule` — cron schedules with timezone support
- `baoboss.subscription` — pub/sub event-to-queue mappings

## Job State Machine

```
created → active → completed
                  → failed → created (retry)
                           → DLQ (retries exhausted)
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
3. Use the existing CSS variables for consistent styling
4. Document the route in `README.md` Dashboard section
