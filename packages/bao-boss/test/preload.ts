/**
 * Test preload — fails a run that cannot actually exercise the database.
 *
 * Suites used to guard themselves on DATABASE_URL and quietly skip the whole
 * file when it was unset, so a run without a database reported success having
 * executed nothing. A missing database is now a loud failure at load time.
 */
const databaseUrl = Bun.env['DATABASE_URL']
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. bao-boss tests run against a real PostgreSQL instance; ' +
    'start one with `docker compose up -d` and re-run with ' +
    'DATABASE_URL=postgresql://bao:bao@localhost:5432/bao bun test',
  )
}
