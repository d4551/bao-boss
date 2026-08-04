import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { t } from '../i18n.js'
import { html } from './safe-html.js'
import { fragmentResponse } from './response.js'
import { UI } from './ui.js'

/** Upper bound on a single bulk action, so one request cannot rewrite the table. */
const MAX_BULK_IDS = 500

const BulkBodySchema = Type.Object({
  ids: Type.Optional(Type.Union([
    Type.String({ minLength: 1 }),
    Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: MAX_BULK_IDS }),
  ])),
})

type BulkDecodeResult =
  | { ok: true; ids: string[] }
  | { ok: false; reason: 'invalid' }

/** Read the ids from an htmx form post. A single checkbox arrives as a bare string. */
export function decodeBulkIds(body: unknown): BulkDecodeResult {
  if (!Value.Check(BulkBodySchema, body)) return { ok: false, reason: 'invalid' }
  const decoded = Value.Decode(BulkBodySchema, body)
  if (decoded.ids === undefined) return { ok: true, ids: [] }
  const ids = Array.isArray(decoded.ids) ? decoded.ids : [decoded.ids]
  return { ok: true, ids: [...new Set(ids)] }
}

export function invalidBulkResponse(locale: string): Response {
  return fragmentResponse(
    html`<span class="${UI.badgeError}">${t('msg.bulkInvalid', locale)}</span>`,
    400,
  )
}

export function emptyBulkResponse(locale: string): Response {
  return fragmentResponse(html`<span class="${UI.badgeNeutral}">${t('msg.bulkEmpty', locale)}</span>`)
}

export { MAX_BULK_IDS }
