const SCHEMA_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function validateSchema(schema: string): string {
  if (!SCHEMA_RE.test(schema)) throw new Error(`Invalid schema name: '${schema}'`)
  return schema
}
