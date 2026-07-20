const ASSET_FILES = {
  'daisyui.css': 'text/css; charset=utf-8',
  'tailwind-browser.js': 'application/javascript; charset=utf-8',
  'htmx.min.js': 'application/javascript; charset=utf-8',
  'htmx-ext-sse.js': 'application/javascript; charset=utf-8',
} as const

export type AssetName = keyof typeof ASSET_FILES

export function isAssetName(name: string): name is AssetName {
  return Object.prototype.hasOwnProperty.call(ASSET_FILES, name)
}

/** Resolve vendored dashboard assets (packages/bao-boss/assets). */
export function assetPath(name: AssetName): string {
  return `${import.meta.dir}/../../assets/${name}`
}

export function assetContentType(name: AssetName): string {
  return ASSET_FILES[name]
}

export async function serveAsset(name: string): Promise<Response> {
  if (!isAssetName(name)) {
    return new Response('Not Found', { status: 404 })
  }
  const file = Bun.file(assetPath(name))
  if (!(await file.exists())) {
    return new Response('Not Found', { status: 404 })
  }
  return new Response(file, {
    headers: {
      'Content-Type': assetContentType(name),
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
