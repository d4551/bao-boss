import { CSRF_COOKIE } from './middleware.js'
import { THEME_NEGOTIATION_HEADERS, themeCookieHeader, type Theme } from './theme.js'
import type { SafeHtml } from './safe-html.js'

const HTML_CONTENT_TYPE = 'text/html; charset=utf-8'

/**
 * Headers every dashboard page carries.
 *
 * The CSP is deliberately strict: the dashboard serves its own assets and
 * contains no inline script or style, so nothing here has to be relaxed for it
 * to work. `frame-ancestors 'none'` blocks clickjacking of the action buttons.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
}

interface PageHeaderOptions {
  csrfToken?: string
  /** Set when the request chose a theme, so the choice persists. */
  setTheme?: Theme
  prefix: string
  secure: boolean
}

/**
 * A CSRF cookie is issued once and then left alone.
 *
 * Minting a fresh token on every render rotated the cookie out from under any
 * other open tab, whose page still held the previous value — every mutation
 * from that tab then failed the check.
 */
function pageHeaders(options: PageHeaderOptions): Headers {
  const headers = new Headers({ 'Content-Type': HTML_CONTENT_TYPE, ...SECURITY_HEADERS, ...THEME_NEGOTIATION_HEADERS })
  const path = options.prefix.length > 0 ? options.prefix : '/'
  if (options.csrfToken) {
    headers.append('Set-Cookie', [
      `${CSRF_COOKIE}=${options.csrfToken}`,
      `Path=${path}`,
      'SameSite=Strict',
      options.secure ? 'Secure' : '',
    ].filter(Boolean).join('; '))
  }
  if (options.setTheme) {
    headers.append('Set-Cookie', themeCookieHeader(options.setTheme, options.prefix, options.secure))
  }
  return headers
}

export function htmlResponse(body: string, options: PageHeaderOptions, status = 200): Response {
  return new Response(body, { status, headers: pageHeaders(options) })
}

/** An htmx fragment. Fragments never re-issue cookies or page-level headers. */
export function fragmentResponse(fragment: SafeHtml | string, status = 200): Response {
  return new Response(String(fragment), {
    status,
    headers: { 'Content-Type': HTML_CONTENT_TYPE, 'X-Content-Type-Options': 'nosniff' },
  })
}

/** Whether the request arrived over HTTPS, directly or through a trusted proxy. */
export function isSecureRequest(request: Request, trustProxy: boolean): boolean {
  if (new URL(request.url).protocol === 'https:') return true
  if (!trustProxy) return false
  return request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https'
}
