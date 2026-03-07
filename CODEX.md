# CODEX.md — bao-boss

> Context for OpenAI Codex and ChatGPT agents working in this repository.

## Project

bao-boss — A Bun-native job queue library built on PostgreSQL with SKIP LOCKED concurrency, inspired by pg-boss.

## Stack

| Layer | Tool | Purpose |
|-------|------|---------|
| Runtime | Bun | Package manager, test runner, native APIs |
| HTTP | Elysia | Type-safe routes for dashboard plugin |
| ORM | Prisma | Schema, migrations, raw SQL for SKIP LOCKED |
| UI | htmx | Server-rendered dashboard without JS frameworks |
| Validation | TypeBox (via Elysia `t`) | Input validation |
| Language | TypeScript (strict) | Full type safety |
| Database | PostgreSQL 15+ | SKIP LOCKED, pgcrypto |

## Conventions

- Use Bun exclusively — not Node.js
- TypeScript strict mode with `noUncheckedIndexedAccess`
- ESNext modules with `.js` import extensions
- All database tables in `baoboss` PostgreSQL schema
- Prisma for CRUD, raw SQL only for SKIP LOCKED fetch
- Validate inputs with TypeBox (`t` from Elysia, `Value.Decode`) in Manager.ts
- Dashboard uses htmx — no React/Vue/Svelte
- Tests use `bun test` and require PostgreSQL

## File Map

- `packages/bao-boss/src/BaoBoss.ts` — Main class, lifecycle, event emitter
- `packages/bao-boss/src/Manager.ts` — Queue/job CRUD, SKIP LOCKED queries
- `packages/bao-boss/src/Worker.ts` — Polling worker with graceful drain
- `packages/bao-boss/src/Scheduler.ts` — Cron schedule management
- `packages/bao-boss/src/Maintenance.ts` — Background supervisor (expiry, archival, cron)
- `packages/bao-boss/src/Dashboard.ts` — Elysia plugin with htmx routes
- `packages/bao-boss/src/types.ts` — All TypeScript interfaces and types
- `packages/bao-boss/src/cli.ts` — CLI binary
- `packages/bao-boss/prisma/schema.prisma` — Database schema

## Commands

```bash
bun install                  # Install dependencies
bun test                     # Run tests (needs PostgreSQL)
bunx prisma generate         # Generate Prisma client
bunx prisma migrate deploy   # Run migrations
docker compose up -d         # Start PostgreSQL
```
