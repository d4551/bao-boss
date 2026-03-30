import { t } from '../i18n.js'
import type { BetterAuthSessionApi } from '../types.js'

const CSRF_COOKIE = 'bao-csrf'
const CSRF_HEADER = 'x-csrf-token'

export { CSRF_COOKIE, CSRF_HEADER }

type ElysiaSet = { status?: number }

export function createAuthMiddleware(
  dashboardAuth: { type: 'better-auth'; auth: BetterAuthSessionApi } | { type: 'bearer'; token: string },
  locale: string
) {
  if (dashboardAuth.type === 'better-auth') {
    return async ({ request, set }: { request: Request; set: ElysiaSet }) => {
      const session = await dashboardAuth.auth.getSession({ headers: request.headers })
      if (!session?.user) {
        set.status = 401
        return t('msg.unauthorized', locale)
      }
    }
  }
  const token = dashboardAuth.token
  return ({ headers, set }: { headers: Record<string, string | undefined>; set: ElysiaSet }) => {
    const provided = headers['authorization']?.replace('Bearer ', '') ?? headers['x-bao-token']
    if (provided !== token) {
      set.status = 401
      return t('msg.unauthorized', locale)
    }
  }
}

export function createCsrfMiddleware(locale: string) {
  return async ({ request, set }: { request: Request; set: ElysiaSet }) => {
    if (['POST', 'DELETE', 'PUT', 'PATCH'].includes(request.method)) {
      const token = request.headers.get(CSRF_HEADER) ?? request.headers.get('x-bao-csrf')
      const cookie = request.headers.get('cookie')?.split(';').find(c => c.trim().startsWith(CSRF_COOKIE + '='))
      const cookieToken = cookie?.split('=')[1]?.trim()
      if (!token || token !== cookieToken) {
        set.status = 403
        return t('msg.forbiddenCsrf', locale)
      }
    }
  }
}

export function createRateLimitMiddleware(
  rateLimitOpts: { windowMs: number; max: number },
  locale: string
) {
  const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
  let lastCleanup = Date.now()

  return ({ request, set }: { request: Request; set: ElysiaSet }) => {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? 'unknown'
    const now = Date.now()
    if (now - lastCleanup > 60_000) {
      for (const [key, val] of rateLimitMap) {
        if (now > val.resetAt) rateLimitMap.delete(key)
      }
      lastCleanup = now
    }
    const entry = rateLimitMap.get(ip)
    if (entry) {
      if (now > entry.resetAt) {
        rateLimitMap.set(ip, { count: 1, resetAt: now + rateLimitOpts.windowMs })
      } else if (entry.count >= rateLimitOpts.max) {
        set.status = 429
        return t('msg.tooManyRequests', locale)
      } else {
        entry.count++
      }
    } else {
      rateLimitMap.set(ip, { count: 1, resetAt: now + rateLimitOpts.windowMs })
    }
  }
}
