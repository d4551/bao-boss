/**
 * PostgreSQL schema name — single owner.
 *
 * Both the generated Prisma client and the migrations bind to one namespace at
 * build time, so a running instance can only ever address that one. Accepting a
 * different value would produce an instance whose Prisma calls and whose raw SQL
 * point at different schemas, with half the operations silently missing their
 * tables. The check below turns that into an error at construction.
 *
 * To use a different namespace: change `@@schema` in prisma/schema.prisma and
 * `GENERATED_SCHEMA` here together, regenerate the client, and write a
 * migration. A test asserts the two stay in step.
 */

/** Valid PostgreSQL identifier: a letter or underscore, then word characters. */
const SCHEMA_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** The namespace this build's Prisma client and migrations were generated for. */
export const GENERATED_SCHEMA = 'baoboss'

export function validateSchema(schema: string): string {
  if (!SCHEMA_RE.test(schema)) {
    throw new Error(
      `Invalid schema name: '${schema}'. A schema name must start with a letter ` +
      'or underscore and contain only letters, digits and underscores.',
    )
  }
  if (schema !== GENERATED_SCHEMA) {
    throw new Error(
      `Schema '${schema}' does not match '${GENERATED_SCHEMA}', which this build's ` +
      'Prisma client and migrations were generated for. Change @@schema in ' +
      'prisma/schema.prisma and GENERATED_SCHEMA together, then regenerate.',
    )
  }
  return schema
}
