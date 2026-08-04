/**
 * Theme resolution — single owner.
 *
 * The theme is decided on the server and rendered into `<html data-theme>`, so
 * the first paint is already correct: there is no flash of the wrong theme and
 * no client script deciding it after the fact. Precedence is an explicit choice
 * (cookie) over the browser's stated preference (client hint) over light.
 *
 * daisyUI's vendored build ships no `prefers-color-scheme` rule, so without
 * this the dashboard would ignore the viewer's system setting entirely.
 */

export type Theme = 'light' | 'dark'

const DEFAULT_THEME: Theme = 'light'

/** Cookie holding an explicit choice made through the theme control. */
const THEME_COOKIE = 'bao-theme'

/** Query parameter the theme control submits. */
export const THEME_PARAM = 'theme'

/** Client hint carrying the browser's colour-scheme preference. */
const THEME_HINT_HEADER = 'sec-ch-prefers-color-scheme'

/** Response headers that ask for the hint and keep caches from mixing themes. */
export const THEME_NEGOTIATION_HEADERS: Readonly<Record<string, string>> = {
  'Accept-CH': 'Sec-CH-Prefers-Color-Scheme',
  'Critical-CH': 'Sec-CH-Prefers-Color-Scheme',
  Vary: 'Sec-CH-Prefers-Color-Scheme, Cookie',
}

export function isTheme(value: string | undefined | null): value is Theme {
  return value === 'light' || value === 'dark'
}

/** The theme to render next, given an explicit choice and the browser's hint. */
export function resolveTheme(request: Request): Theme {
  const chosen = readThemeCookie(request.headers.get('cookie'))
  if (chosen) return chosen
  const hint = request.headers.get(THEME_HINT_HEADER)?.trim().toLowerCase()
  return isTheme(hint) ? hint : DEFAULT_THEME
}

function readThemeCookie(cookieHeader: string | null): Theme | null {
  const value = readCookie(cookieHeader, THEME_COOKIE)
  return isTheme(value) ? value : null
}

/** Read one cookie by name. Values are matched exactly, never by prefix. */
export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() !== name) continue
    return decodeURIComponent(part.slice(separator + 1).trim())
  }
  return null
}

/** The theme the control switches to. */
export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark'
}

/**
 * `Set-Cookie` for an explicit theme choice.
 * Scoped to the dashboard prefix so it never leaks into the host application,
 * and marked `Secure` on HTTPS.
 */
export function themeCookieHeader(theme: Theme, prefix: string, secure: boolean): string {
  const path = prefix.length > 0 ? prefix : '/'
  const oneYearSeconds = 60 * 60 * 24 * 365
  return [
    `${THEME_COOKIE}=${theme}`,
    `Path=${path}`,
    `Max-Age=${oneYearSeconds}`,
    'SameSite=Lax',
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ')
}
