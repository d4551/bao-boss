import { CSRF_COOKIE } from './middleware.js'

export function csrfHeaders(csrfToken?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'text/html' }
  if (csrfToken) headers['Set-Cookie'] = `${CSRF_COOKIE}=${csrfToken}; Path=/; HttpOnly; SameSite=Strict`
  return headers
}

export function htmlResponse(body: string, csrfToken?: string, status = 200): Response {
  return new Response(body, { status, headers: csrfHeaders(csrfToken) })
}

export function fragmentResponse(html: string): Response {
  return new Response(html, { headers: { 'Content-Type': 'text/html' } })
}
