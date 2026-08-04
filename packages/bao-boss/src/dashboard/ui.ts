/**
 * Class tokens for the dashboard — single owner.
 *
 * Every `class` attribute in the dashboard is composed from these tokens. Values
 * come from daisyUI/Tailwind or from `assets/baoboss.css`, which owns the few
 * primitives they do not provide (z-scale, safe-area, glass, container queries).
 * No file outside this one writes a class string.
 */
export const UI = {
  // ── Page frame ──────────────────────────────────────────────────
  body: 'bg-base-100 text-base-content bao-min-h-dvh bao-stable-gutter',
  drawer: 'drawer lg:drawer-open',
  drawerToggleInput: 'drawer-toggle',
  drawerContent: 'drawer-content flex flex-col bao-min-h-dvh bao-min-w-0',
  drawerSide: 'drawer-side bao-z-drawer',
  drawerOverlay: 'drawer-overlay',
  sidebar: 'menu bg-base-200 text-base-content min-h-full w-72 p-4 gap-1 bao-inset-safe bao-inset-safe-top',
  sidebarTitle: 'menu-title text-base font-semibold',
  navbar: 'navbar bao-glass bg-primary text-primary-content px-3 sm:px-4 sticky top-0 bao-z-nav shadow-sm bao-inset-safe bao-inset-safe-top',
  navbarStart: 'navbar-start gap-2 bao-min-w-0',
  navbarEnd: 'navbar-end gap-1',
  navLink: 'btn btn-ghost min-h-11 h-11 px-3 justify-start',
  navLinkActive: 'btn btn-ghost btn-active min-h-11 h-11 px-3 justify-start',
  brand: 'font-bold text-lg px-1 truncate',
  drawerButton: 'btn btn-ghost btn-square min-h-11 h-11 w-11 lg:hidden',
  icon: 'h-5 w-5',
  main: 'max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 w-full bao-min-w-0 bao-inset-safe bao-inset-safe-bottom',
  skipLink: 'sr-only focus:not-sr-only focus:absolute focus:m-2 btn btn-primary min-h-11 h-11',

  // ── Surfaces ────────────────────────────────────────────────────
  card: 'card bg-base-200 shadow-sm mb-6 bao-panel',
  cardBody: 'card-body bao-min-w-0',
  cardBodySplit: 'card-body bao-min-w-0 bao-autofit',
  cardTitle: 'card-title text-lg font-semibold mb-4 bao-scroll-offset',
  cardTitleSm: 'card-title text-base font-semibold mb-4 bao-scroll-offset',
  pageTitle: 'text-xl font-semibold mb-4 bao-scroll-offset',
  sectionTitle: 'font-semibold mb-2',
  subSectionTitle: 'font-semibold mt-4 mb-2',
  pre: 'bg-base-300 p-4 rounded-box overflow-x-auto text-sm bao-min-w-0',

  // ── Tables ──────────────────────────────────────────────────────
  tableWrap: 'overflow-x-auto bao-min-w-0',
  table: 'table table-zebra',
  tableSm: 'table table-zebra table-sm',
  cellNumeric: 'bao-numeric',
  cellId: 'bao-id',
  cellNoWrap: 'whitespace-nowrap',
  cellActions: 'flex flex-wrap gap-2',
  code: 'whitespace-nowrap text-xs',

  // ── Stats ───────────────────────────────────────────────────────
  stats: 'stats stats-vertical sm:stats-horizontal shadow mb-6 w-full',
  stat: 'stat',
  statAlert: 'stat border-error',
  statValue: 'stat-value text-primary bao-numeric',
  statTitle: 'stat-title',

  // ── Controls ────────────────────────────────────────────────────
  touchBtn: 'btn min-h-11 h-11',
  touchBtnPrimary: 'btn btn-primary min-h-11 h-11',
  touchBtnError: 'btn btn-error min-h-11 h-11',
  touchBtnGhost: 'btn btn-ghost min-h-11 h-11',
  touchBtnErrorSquare: 'btn btn-error btn-square min-h-11 h-11 w-11',
  searchInput: 'input input-bordered min-h-11 h-11 w-full max-w-md text-base',
  searchForm: 'flex flex-wrap items-end gap-2 mb-4',
  fieldLabel: 'label cursor-pointer gap-2 min-h-11',
  fieldLabelText: 'label-text',
  checkbox: 'checkbox checkbox-primary min-h-5 min-w-5',
  bulkBar: 'flex flex-wrap items-center gap-2 mb-4',
  form: 'space-y-2',
  progress: 'progress progress-primary w-full max-w-xs',

  // ── Navigation between pages ────────────────────────────────────
  pager: 'join mt-4 flex flex-wrap items-center gap-2',
  pagerBtn: 'join-item btn min-h-11 h-11',
  pagerBtnDisabled: 'join-item btn min-h-11 h-11 btn-disabled',
  pagerStatus: 'text-sm text-base-content/70 bao-numeric px-2',

  // ── Feedback ────────────────────────────────────────────────────
  link: 'link link-primary bao-id',
  linkQuiet: 'link link-hover',
  badge: 'badge',
  badgeNeutral: 'badge badge-ghost',
  badgeOk: 'badge badge-success',
  badgeError: 'badge badge-error',
  empty: 'text-center p-8 text-base-content/70',
  hint: 'text-sm text-base-content/70 mt-2',
  liveRegion: 'flex flex-wrap items-center gap-2',
  indicator: 'htmx-indicator loading loading-spinner loading-sm align-middle',
  errorBanner: 'alert alert-error mb-4',
  /** Visible only to assistive technology. */
  srOnly: 'sr-only',
  /** Removes the wrapper's own box so its children join the parent's layout. */
  transparentWrapper: 'contents',
} as const


/** daisyUI badge modifier per job state. Keyed so a new state must be handled here. */
export const STATE_BADGE: Readonly<Record<string, string>> = {
  created: 'badge badge-info',
  active: 'badge badge-warning',
  completed: 'badge badge-success',
  cancelled: 'badge badge-ghost',
  failed: 'badge badge-error',
}

/** Fallback for a state the badge map does not cover. */
export const STATE_BADGE_DEFAULT = 'badge badge-ghost'
