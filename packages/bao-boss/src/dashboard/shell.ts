import { t } from '../i18n.js'
import { CSRF_HEADER } from './middleware.js'
import { UI } from './ui.js'

export interface NavItem {
  href: string
  labelKey: string
}

/** Primary human navigation — machine endpoints (metrics scrape) are never listed. */
export function navItems(prefix: string): NavItem[] {
  return [
    { href: prefix, labelKey: 'nav.dashboard' },
    { href: `${prefix}/queues`, labelKey: 'nav.queues' },
    { href: `${prefix}/schedules`, labelKey: 'nav.schedules' },
  ]
}

export function shell(
  prefix: string,
  content: string,
  title?: string,
  csrfToken?: string,
  lang = 'en',
  locale = lang,
): string {
  const pageTitle = title ?? t('title.dashboard', locale)
  const csrfMeta = csrfToken ? `  <meta name="csrf-token" content="${csrfToken}">` : ''
  const csrfScript = csrfToken
    ? `  <script>document.body.addEventListener('htmx:configRequest',function(evt){evt.detail.headers['${CSRF_HEADER}']=document.querySelector('meta[name=csrf-token]')?.content||''})</script>`
    : ''
  const items = navItems(prefix)
  const desktopLinks = items
    .map(item => `<a href="${item.href}" class="${UI.navLink}">${t(item.labelKey, locale)}</a>`)
    .join('')
  const drawerItems = items
    .map(item => `<li><a href="${item.href}" class="${UI.navLink}">${t(item.labelKey, locale)}</a></li>`)
    .join('')

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
${csrfMeta}
  <title>${pageTitle}</title>
  <link href="${prefix}/assets/daisyui.css" rel="stylesheet" type="text/css" />
  <script src="${prefix}/assets/tailwind-browser.js"></script>
  <script src="${prefix}/assets/htmx.min.js"></script>
  <script src="${prefix}/assets/htmx-ext-sse.js"></script>
${csrfScript}
</head>
<body class="${UI.body}">
  <div class="drawer">
    <input id="bao-nav-drawer" type="checkbox" class="drawer-toggle" />
    <div class="drawer-content flex flex-col min-h-screen">
      <nav class="${UI.navbar}" role="navigation" aria-label="${t('aria.mainNav', locale)}">
        <div class="navbar-start gap-1">
          <label for="bao-nav-drawer" class="${UI.drawerToggle}" aria-label="${t('aria.openMenu', locale)}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </label>
          <span class="font-bold text-lg px-1">${t('nav.brand', locale)}</span>
        </div>
        <div class="navbar-center hidden lg:flex gap-1">${desktopLinks}</div>
        <div class="navbar-end"></div>
      </nav>
      <main class="${UI.main}" aria-label="${t('aria.dashboardContent', locale)}">
        ${content}
      </main>
    </div>
    <div class="drawer-side z-40">
      <label for="bao-nav-drawer" aria-label="${t('aria.closeMenu', locale)}" class="drawer-overlay"></label>
      <ul class="${UI.drawerSide}">
        <li class="menu-title"><span>${t('nav.brand', locale)}</span></li>
        ${drawerItems}
      </ul>
    </div>
  </div>
</body>
</html>`
}
