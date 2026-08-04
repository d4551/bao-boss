import { PrismaClient } from './generated/prisma/client.js'
import { validateSchema } from './schema.js'
import { BOSS_DEFAULTS } from './defaults.js'

/**
 * Schema revision this build of bao-boss understands.
 * Bump it in the same commit as the migration that changes the tables.
 */
export const SCHEMA_VERSION = 3

/** Files `prisma migrate deploy` needs, relative to the package root. */
const REQUIRED_MIGRATE_FILES = ['prisma/schema.prisma', 'prisma.config.ts'] as const

function packageRoot(): string {
  return `${import.meta.dir}/..`
}

/**
 * Record the applied schema version and refuse to run against a newer one.
 *
 * Starting an old build against a database migrated by a newer release is how
 * silent corruption happens; this turns it into a startup error.
 */
export async function ensureSchemaVersion(
  prisma: PrismaClient,
  schema: string = BOSS_DEFAULTS.schema,
): Promise<void> {
  const s = validateSchema(schema)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${s}".schema_version (
      version INTEGER NOT NULL PRIMARY KEY,
      "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  const rows = await prisma.$queryRawUnsafe<Array<{ version: number }>>(
    `SELECT version FROM "${s}".schema_version ORDER BY version DESC LIMIT 1`,
  )
  const current = rows[0]?.version ?? 0
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema "${s}" is at version ${current}, but this build of bao-boss ` +
      `supports up to ${SCHEMA_VERSION}. Upgrade bao-boss before starting.`,
    )
  }
  if (current < SCHEMA_VERSION) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${s}".schema_version (version) VALUES ($1) ON CONFLICT (version) DO NOTHING`,
      SCHEMA_VERSION,
    )
  }
}

/**
 * Apply pending Prisma migrations by running `prisma migrate deploy` against
 * this package's own schema, then record the schema version.
 */
export async function migrate(prisma: PrismaClient, schema: string = BOSS_DEFAULTS.schema): Promise<void> {
  const cwd = packageRoot()
  for (const file of REQUIRED_MIGRATE_FILES) {
    if (!(await Bun.file(`${cwd}/${file}`).exists())) {
      throw new Error(
        `Cannot run migrations: ${file} is missing from the installed bao-boss package ` +
        `(looked in ${cwd}). Run 'prisma migrate deploy' from your own project instead.`,
      )
    }
  }

  const databaseUrl = Bun.env['DATABASE_URL']
  if (!databaseUrl) {
    throw new Error('Cannot run migrations: DATABASE_URL is not set')
  }

  const subprocess = Bun.spawn(['bunx', 'prisma', 'migrate', 'deploy'], {
    cwd,
    stdout: 'inherit',
    stderr: 'pipe',
    env: { ...Bun.env, DATABASE_URL: databaseUrl },
  })
  const [stderr, exitCode] = await Promise.all([
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`prisma migrate deploy failed with status ${exitCode}: ${stderr.trim()}`)
  }
  await ensureSchemaVersion(prisma, schema)
}
