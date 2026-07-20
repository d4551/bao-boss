import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { t } from '../i18n.js'
import { fragmentResponse } from './response.js'

const BulkBodySchema = Type.Object({
  ids: Type.Optional(Type.Union([
    Type.String({ minLength: 1 }),
    Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  ])),
})

export function decodeBulkIds(body: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Value.Check(BulkBodySchema, body)) {
    return { ok: false, error: 'invalid' }
  }
  const decoded = Value.Decode(BulkBodySchema, body)
  if (decoded.ids === undefined) {
    return { ok: true, ids: [] }
  }
  const ids = Array.isArray(decoded.ids) ? decoded.ids : [decoded.ids]
  return { ok: true, ids }
}

export function invalidBulkResponse(locale: string): Response {
  return new Response(
    `<span class="badge badge-error">${t('msg.bulkInvalid', locale)}</span>`,
    { status: 400, headers: { 'Content-Type': 'text/html' } },
  )
}

export function emptyBulkResponse(locale: string): Response {
  return fragmentResponse(`<span class="badge badge-ghost">${t('msg.bulkEmpty', locale)}</span>`)
}
