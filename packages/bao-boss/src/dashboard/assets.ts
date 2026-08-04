import { t } from '../i18n.js'

/** Assets this dashboard serves, and nothing else — the name is never a path. */
const ASSET_FILES = {
  'daisyui.css': 'text/css; charset=utf-8',
  'baoboss.css': 'text/css; charset=utf-8',
  'tailwind-browser.js': 'text/javascript; charset=utf-8',
  'htmx.min.js': 'text/javascript; charset=utf-8',
  'htmx-ext-sse.js': 'text/javascript; charset=utf-8',
} as const

type AssetName = keyof typeof ASSET_FILES

/** One day, paired with revalidation so an upgraded asset is picked up promptly. */
const MAX_AGE_SECONDS = 86_400

function isAssetName(name: string): name is AssetName {
  return Object.prototype.hasOwnProperty.call(ASSET_FILES, name)
}

/** Resolve a vendored dashboard asset (packages/bao-boss/assets). */
function assetPath(name: AssetName): string {
  return `${import.meta.dir}/../../assets/${name}`
}

function assetContentType(name: AssetName): string {
  return ASSET_FILES[name]
}

/** Weak validator from size and modification time, so a redeploy invalidates caches. */
async function entityTag(file: ReturnType<typeof Bun.file>): Promise<string> {
  const stat = await file.stat()
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
}

/**
 * Serve a vendored asset.
 *
 * Caching is `max-age` plus an ETag rather than `max-age` alone: without a
 * validator an upgraded dashboard would keep serving yesterday's stylesheet
 * from the browser cache for a full day.
 */
export async function serveAsset(name: string, request: Request, locale: string): Promise<Response> {
  if (!isAssetName(name)) {
    return new Response(t('msg.notFound', locale), { status: 404 })
  }
  const file = Bun.file(assetPath(name))
  if (!(await file.exists())) {
    return new Response(t('msg.notFound', locale), { status: 404 })
  }

  const etag = await entityTag(file)
  const headers = {
    'Content-Type': assetContentType(name),
    'Cache-Control': `public, max-age=${MAX_AGE_SECONDS}, must-revalidate`,
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
  }
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(file, { headers })
}
