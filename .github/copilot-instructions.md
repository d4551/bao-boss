# GitHub Copilot Instructions — bao-boss

## Project

bao-boss is a Bun-native PostgreSQL job queue library with SKIP LOCKED concurrency, inspired by pg-boss.

## Stack

- **Runtime**: Bun (not Node.js) — use `bun test`, `bun run`, `bunx`
- **HTTP**: Elysia for type-safe dashboard routes
- **ORM**: Prisma 7 + PrismaPg adapter for schema/migrations + raw SQL for SKIP LOCKED
- **Dashboard**: htmx with server-rendered HTML (no React/Vue/Svelte)
- **Validation**: TypeBox (`@sinclair/typebox`) for input validation
- **Language**: TypeScript strict mode
- **Database**: PostgreSQL 15+ with `baoboss` schema

## Conventions

1. Always use Bun runtime, never Node.js
2. TypeScript strict mode with `noUncheckedIndexedAccess`
3. ESNext modules — use `.js` extensions in imports
4. All DB tables in `baoboss` PostgreSQL schema
5. Use Prisma 7 for CRUD (import from `src/generated/prisma/`), raw SQL only for `FOR UPDATE SKIP LOCKED` queries
6. Validate user inputs with TypeBox (`Type` + `Value.Decode`) in Manager.ts
7. No frontend JS frameworks — dashboard uses htmx
8. Emit errors via `boss.emit('error', err)`
9. Use generics (`Job<T>`) for type-safe job data
10. Tests require a running PostgreSQL instance

## Key Files

| File | Purpose |
|------|---------|
| `packages/bao-boss/src/BaoBoss.ts` | Main class, lifecycle, event emitter |
| `packages/bao-boss/src/Manager.ts` | Queue/job CRUD, SKIP LOCKED fetch |
| `packages/bao-boss/src/Worker.ts` | Polling worker with graceful drain |
| `packages/bao-boss/src/Scheduler.ts` | Cron schedule management |
| `packages/bao-boss/src/Maintenance.ts` | Background supervisor |
| `packages/bao-boss/src/Dashboard.ts` | Elysia plugin with htmx routes |
| `packages/bao-boss/src/types.ts` | TypeScript interfaces |
| `packages/bao-boss/prisma/schema.prisma` | Database schema |
