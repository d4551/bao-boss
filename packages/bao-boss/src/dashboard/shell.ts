import { t } from '../i18n.js'
import { CSRF_HEADER } from './middleware.js'
import { html, joinHtml, raw, EMPTY, type SafeHtml } from './safe-html.js'
import { THEME_PARAM, nextTheme, type Theme } from './theme.js'
import { UI } from './ui.js'

interface NavItem {
  href: string
  labelKey: string
}

/** Identifier of the checkbox that drives the mobile drawer. */
const DRAWER_ID = 'bao-nav-drawer'
/** Target of the skip link, and the landmark htmx swaps never replace. */
const MAIN_ID = 'bao-main'

/** Primary human navigation — machine endpoints (metrics scrape) are never listed. */
export function navItems(prefix: string): NavItem[] {
  return [
    { href: prefix, labelKey: 'nav.dashboard' },
    { href: `${prefix}/queues`, labelKey: 'nav.queues' },
    { href: `${prefix}/schedules`, labelKey: 'nav.schedules' },
    { href: `${prefix}/stats`, labelKey: 'nav.stats' },
  ]
}

interface ShellOptions {
  prefix: string
  content: SafeHtml
  title: string
  csrfToken?: string
  lang: string
  locale: string
  theme: Theme
  /** Path of the current request, used to mark the active navigation entry. */
  path: string
  /** Query string of the current request, preserved by the theme control. */
  query: string
}

/** Inline icons. Sized from the token owner and hidden from assistive tech. */
function icon(path: SafeHtml): SafeHtml {
  return html`<svg xmlns="http://www.w3.org/2000/svg" class="${UI.icon}" fill="none" viewBox="0 0 24 24"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false">${path}</svg>`
}

const MENU_ICON = icon(raw('<path d="M4 6h16M4 12h16M4 18h16"/>'))

const SUN_ICON = icon(raw(
  '<path d="M12 3v2m0 14v2m9-9h-2M5 12H3m14.66 6.66l-1.42-1.42M7.76 7.76L6.34 6.34' +
  'm11.32 0l-1.42 1.42M7.76 16.24l-1.42 1.42"/><circle cx="12" cy="12" r="4"/>',
))

const MOON_ICON = icon(raw('<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>'))

/** Hidden inputs that carry the current query string through the theme form. */
function preservedQueryFields(query: string): SafeHtml {
  const params = new URLSearchParams(query)
  params.delete(THEME_PARAM)
  const fields = [...params].map(([name, value]) =>
    html`<input type="hidden" name="${name}" value="${value}">`)
  return joinHtml(fields)
}

/**
 * Theme control.
 *
 * A form rather than a link: a plain anchor with a side effect can be fired by
 * a prefetching browser. It needs no script, and the server renders the result
 * into `<html data-theme>` so the switch never flashes the previous theme.
 */
function themeControl(options: ShellOptions): SafeHtml {
  const target = nextTheme(options.theme)
  const label = t(target === 'dark' ? 'btn.themeDark' : 'btn.themeLight', options.locale)
  return html`<form method="get" action="${options.path}" class="${UI.transparentWrapper}">
        ${preservedQueryFields(options.query)}
        <input type="hidden" name="${THEME_PARAM}" value="${target}">
        <button type="submit" class="${UI.touchBtnGhost}" aria-label="${label}">
          ${target === 'dark' ? MOON_ICON : SUN_ICON}
        </button>
      </form>`
}

function navigation(options: ShellOptions): SafeHtml {
  const items = navItems(options.prefix).map(item => {
    const active = options.path === item.href
    return html`<li><a href="${item.href}" class="${active ? UI.navLinkActive : UI.navLink}"
          ${active ? raw('aria-current="page"') : EMPTY}>${t(item.labelKey, options.locale)}</a></li>`
  })
  return joinHtml(items)
}

/**
 * Full page frame.
 *
 * There is exactly one navigation list in the document: the drawer's. On wide
 * viewports `lg:drawer-open` pins it open beside the content instead of a second
 * copy of the same links, so assistive technology reads the navigation once.
 */
export function shell(options: ShellOptions): string {
  const { prefix, csrfToken, lang, locale, theme, title } = options
  const csrfMeta = csrfToken
    ? html`<meta name="csrf-token" content="${csrfToken}">`
    : EMPTY
  // htmx inherits hx-headers from an ancestor, so the CSRF token reaches every
  // request without a script tag and without weakening the page's CSP.
  const csrfHeaders = csrfToken
    ? html`hx-headers="${JSON.stringify({ [CSRF_HEADER]: csrfToken })}"`
    : EMPTY

  return `<!DOCTYPE html>
${html`<html lang="${lang}" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  ${csrfMeta}
  <title>${title}</title>
  <link href="${prefix}/assets/daisyui.css" rel="stylesheet" type="text/css">
  <link href="${prefix}/assets/baoboss.css" rel="stylesheet" type="text/css">
  <script src="${prefix}/assets/tailwind-browser.js"></script>
  <script src="${prefix}/assets/htmx.min.js" defer></script>
  <script src="${prefix}/assets/htmx-ext-sse.js" defer></script>
</head>
<body class="${UI.body}" ${csrfHeaders}>
  <a class="${UI.skipLink}" href="#${MAIN_ID}">${t('aria.skipToContent', locale)}</a>
  <div class="${UI.drawer}">
    <input id="${DRAWER_ID}" type="checkbox" class="${UI.drawerToggleInput}"
      aria-label="${t('aria.openMenu', locale)}">
    <div class="${UI.drawerContent}">
      <header class="${UI.navbar}">
        <div class="${UI.navbarStart}">
          <label for="${DRAWER_ID}" class="${UI.drawerButton}" aria-label="${t('aria.openMenu', locale)}">
            ${MENU_ICON}
          </label>
          <span class="${UI.brand}">${t('nav.brand', locale)}</span>
        </div>
        <div class="${UI.navbarEnd}">${themeControl(options)}</div>
      </header>
      <main id="${MAIN_ID}" class="${UI.main}" aria-label="${t('aria.dashboardContent', locale)}">
        ${options.content}
      </main>
    </div>
    <div class="${UI.drawerSide}">
      <label for="${DRAWER_ID}" aria-label="${t('aria.closeMenu', locale)}" class="${UI.drawerOverlay}"></label>
      <nav class="${UI.sidebar}" aria-label="${t('aria.mainNav', locale)}">
        <ul>
          <li class="${UI.sidebarTitle}"><span>${t('nav.brand', locale)}</span></li>
          ${navigation(options)}
        </ul>
      </nav>
    </div>
  </div>
</body>
</html>`}`
}

export { DRAWER_ID, MAIN_ID }
