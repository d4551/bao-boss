import { PrismaClient } from './generated/prisma/client.js'
import { validateSchema } from './schema.js'

const SCHEMA_VERSION = 2

/**
 * Ensures the database schema is up to date. Run before start() when upgrading.
 * Creates schema_version table if missing and records the current version.
 */
export async function ensureSchemaVersion(prisma: PrismaClient, schema = 'baoboss'): Promise<void> {
  const s = validateSchema(schema)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${s}".schema_version (
      version INTEGER NOT NULL PRIMARY KEY,
      "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  const rows = await prisma.$queryRawUnsafe<Array<{ version: number }>>(
    `SELECT version FROM "${s}".schema_version ORDER BY version DESC LIMIT 1`
  )
  const current = rows[0]?.version ?? 0
  if (current < SCHEMA_VERSION) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${s}".schema_version (version) VALUES (${SCHEMA_VERSION}) ON CONFLICT (version) DO NOTHING`
    )
  }
}

/**
 * Run Prisma migrations. Call before start() in production.
 * Spawns `bunx prisma migrate deploy` to apply pending migrations.
 */
export async function migrate(prisma: PrismaClient, schema = 'baoboss'): Promise<void> {
  const packageRoot = import.meta.dir + '/..'
  const subprocess = Bun.spawn(['bunx', 'prisma', 'migrate', 'deploy'], {
    cwd: packageRoot,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...Bun.env },
  })
  const exitCode = await subprocess.exited
  if (exitCode !== 0) {
    throw new Error(`Prisma migrate deploy failed with status ${exitCode}`)
  }
  await ensureSchemaVersion(prisma, schema)
}
