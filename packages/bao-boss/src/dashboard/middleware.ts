import { t } from '../i18n.js'
import type { BetterAuthSessionApi } from '../types.js'
import { readCookie } from './theme.js'

export const CSRF_COOKIE = 'bao-csrf'
export const CSRF_HEADER = 'x-csrf-token'

/** Methods that change state and therefore need a CSRF token. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

type ElysiaHeaders = Record<string, string | number | undefined>
type ElysiaSet = { status?: number | string; headers?: ElysiaHeaders }

export interface RateLimitOptions {
  windowMs: number
  max: number
  /**
   * Trust `X-Forwarded-For` for the client address.
   *
   * Off by default: the header is attacker-controlled, so trusting it without a
   * proxy in front turns the rate limiter into a no-op — a new spoofed address
   * per request means no request ever hits the limit.
   */
  trustProxy?: boolean
}

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * Both sides are hashed first so the comparison length never depends on the
 * secret, which keeps `===` from returning early on the first wrong byte.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const encoder = new TextEncoder()
  const a = new Uint8Array(Bun.SHA256.hash(encoder.encode(provided)).buffer)
  const b = new Uint8Array(Bun.SHA256.hash(encoder.encode(expected)).buffer)
  let difference = provided.length ^ expected.length
  for (let i = 0; i < a.length; i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return difference === 0
}

export type DashboardAuth =
  | { type: 'better-auth'; auth: BetterAuthSessionApi }
  | { type: 'bearer'; token: string }

export function createAuthMiddleware(dashboardAuth: DashboardAuth, locale: string) {
  if (dashboardAuth.type === 'better-auth') {
    return async ({ request, set }: { request: Request; set: ElysiaSet }) => {
      const session = await dashboardAuth.auth.getSession({ headers: request.headers })
      if (!session?.user) {
        set.status = 401
        return t('msg.unauthorized', locale)
      }
      return undefined
    }
  }
  const token = dashboardAuth.token
  return ({ request, set }: { request: Request; set: ElysiaSet }) => {
    const header = request.headers.get('authorization')
    const provided = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : request.headers.get('x-bao-token')
    if (!provided || !secretsMatch(provided, token)) {
      set.status = 401
      set.headers = { ...set.headers, 'WWW-Authenticate': 'Bearer' }
      return t('msg.unauthorized', locale)
    }
    return undefined
  }
}

/**
 * Double-submit CSRF check.
 *
 * The token is issued once per session and stored in a cookie scoped to the
 * dashboard; the page echoes it back in a header. Comparing them is enough to
 * prove the request came from a page this origin rendered.
 */
export function createCsrfMiddleware(locale: string) {
  return ({ request, set }: { request: Request; set: ElysiaSet }) => {
    if (!UNSAFE_METHODS.has(request.method)) return undefined
    const header = request.headers.get(CSRF_HEADER)
    const cookie = readCookie(request.headers.get('cookie'), CSRF_COOKIE)
    if (!header || !cookie || !secretsMatch(header, cookie)) {
      set.status = 403
      return t('msg.forbiddenCsrf', locale)
    }
    return undefined
  }
}

/** Fixed-window rate limiter keyed by client address. */
export function createRateLimitMiddleware(options: RateLimitOptions, locale: string) {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  let lastCleanup = Date.now()

  const clientKey = (request: Request): string => {
    if (options.trustProxy) {
      const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      if (forwarded) return forwarded
      const real = request.headers.get('x-real-ip')?.trim()
      if (real) return real
    }
    // Without a trusted proxy every caller shares one bucket, which limits the
    // dashboard as a whole rather than pretending to limit a spoofable address.
    return 'all'
  }

  return ({ request, set }: { request: Request; set: ElysiaSet }) => {
    const now = Date.now()
    if (now - lastCleanup > options.windowMs) {
      for (const [key, bucket] of buckets) {
        if (now > bucket.resetAt) buckets.delete(key)
      }
      lastCleanup = now
    }

    const key = clientKey(request)
    let bucket = buckets.get(key)
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + options.windowMs }
      buckets.set(key, bucket)
    }
    bucket.count++

    const remaining = Math.max(0, options.max - bucket.count)
    set.headers = {
      ...set.headers,
      'X-RateLimit-Limit': String(options.max),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(Math.ceil(bucket.resetAt / 1000)),
    }

    if (bucket.count > options.max) {
      set.status = 429
      set.headers['Retry-After'] = String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)))
      return t('msg.tooManyRequests', locale)
    }
    return undefined
  }
}
