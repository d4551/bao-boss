/**
 * Lint rule table for bao-boss.
 *
 * Every rule is an error. There is no warning level and no suppression syntax:
 * a rule that can be switched off at the call site is a rule that will be.
 */

interface LineRule {
  rule: string
  pattern: RegExp
  message: string
  /** Files this rule does not apply to. Each entry needs a stated reason. */
  exclude?: RegExp
  /**
   * Set for rules that target comments themselves. Every other rule skips
   * comment-only lines, so prose describing a banned construct is not a finding.
   */
  appliesToComments?: boolean
}

/** Files that legitimately contain the thing a rule looks for, because they own it. */
const OWNERS = {
  /** ui.ts is the class-token owner; baoboss.css is the stylesheet owner. */
  styleTokens: /dashboard\/ui\.ts$/,
  /** safe-html.ts owns escaping and therefore contains the escape table. */
  escaping: /dashboard\/safe-html\.ts$/,
  /** i18n.ts owns every user-facing string. */
  copy: /(^|\/)i18n\.ts$/,
  /** The lint sources describe the patterns they ban. */
  lint: /scripts\/lint(-rules)?\.ts$/,
  /** Tests assert on the markup and messages that production code must not contain. */
  tests: /(?:^|\/)test\//,
} as const

export const LINE_RULES: LineRule[] = [
  // ── Type safety ────────────────────────────────────────────────
  {
    rule: 'no-unsafe-cast',
    pattern: /\bas\s+(unknown|any|never)\b/,
    message: '`as unknown` / `as any` / `as never` — use a typed mapper or a runtime check',
    exclude: OWNERS.lint,
  },
  {
    rule: 'no-non-null-assertion',
    pattern: /[\w)\]]!\s*[.[(,;)\]}]|[\w)\]]!\s*$/,
    message: 'Non-null assertion — narrow the type or handle the empty case',
    exclude: new RegExp(`${OWNERS.tests.source}|${OWNERS.lint.source}`),
  },
  {
    rule: 'no-suppression-comment',
    pattern: /@ts-ignore|@ts-expect-error|eslint-disable|biome-ignore|istanbul ignore|c8 ignore|stylelint-disable|prettier-ignore/,
    message: 'Suppression comment — fix the underlying issue',
    exclude: OWNERS.lint,
    appliesToComments: true,
  },
  {
    rule: 'no-todo-marker',
    pattern: /\/\/\s*(TODO|FIXME|HACK|XXX|LATER)\b|\/\*\s*(TODO|FIXME|HACK|XXX|LATER)\b/,
    message: 'Deferred-work marker — implement it or delete the code',
    exclude: OWNERS.lint,
    appliesToComments: true,
  },

  // ── Single source of truth ─────────────────────────────────────
  {
    rule: 'no-re-export',
    pattern: /^export\s+(?:type\s+)?\{[^}]*\}\s+from\s+/,
    message: 'Re-export creates a second import path for one owner — import from the owner',
    exclude: /(^|\/)src\/index\.ts$|scripts\//,
  },
  {
    rule: 'no-inline-type-import',
    pattern: /:\s*import\(['"]\.[^'"]+['"]\)\./,
    message: 'Inline `import(...)` type — add a named import at the top of the file',
    exclude: OWNERS.lint,
  },

  // ── Markup and styling ─────────────────────────────────────────
  {
    rule: 'no-inline-style',
    pattern: /\sstyle="/,
    message: 'Inline style — add a token to dashboard/ui.ts or assets/baoboss.css',
    exclude: new RegExp(`${OWNERS.tests.source}|${OWNERS.lint.source}`),
  },
  {
    rule: 'no-style-tag',
    pattern: /<style[\s>]/,
    message: '<style> tag — put the rule in assets/baoboss.css',
    exclude: new RegExp(`${OWNERS.tests.source}|${OWNERS.lint.source}`),
  },
  {
    rule: 'no-inline-script',
    pattern: /<script(?![^>]*\ssrc=)/,
    message: 'Inline <script> — serve it from assets/ so the CSP stays strict',
    exclude: new RegExp(`${OWNERS.tests.source}|${OWNERS.lint.source}`),
  },
  {
    rule: 'no-inline-handler',
    pattern: /\son(click|change|input|submit|load|error|focus|blur|keydown|keyup)=["']/,
    message: 'Inline event handler — drive it declaratively with htmx or a form',
    exclude: new RegExp(`${OWNERS.tests.source}|${OWNERS.lint.source}`),
  },
  {
    rule: 'no-important',
    pattern: /!important/,
    message: '!important — fix the cascade with @layer and token order',
    exclude: OWNERS.lint,
  },
  {
    rule: 'no-arbitrary-value',
    pattern: /(?:^|["'\s])(?:[a-z-]+:)*[a-z-]+-\[[^\]]+\]/,
    message: 'Arbitrary Tailwind value — add a token instead',
    exclude: new RegExp(`${OWNERS.styleTokens.source}|${OWNERS.lint.source}|${OWNERS.tests.source}`),
  },
  {
    rule: 'no-colour-literal',
    pattern: /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/,
    message: 'Colour literal — use a daisyUI semantic colour or a token',
    exclude: new RegExp(`${OWNERS.lint.source}|${OWNERS.tests.source}`),
  },
  {
    rule: 'no-physical-direction',
    pattern: /\b(?:m|p)(?:l|r)-\d|\btext-(?:left|right)\b|\b(?:left|right)-\d/,
    message: 'Physical direction class — use the logical equivalent (ms-/me-/ps-/pe-/text-start/text-end)',
    exclude: OWNERS.lint,
  },
  {
    rule: 'no-viewport-height-hack',
    pattern: /\b(?:min-)?h-screen\b|\b100vh\b/,
    message: '100vh collapses under a mobile toolbar — use the dvh token',
    exclude: OWNERS.lint,
  },
  {
    rule: 'no-cdn',
    pattern: /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/,
    message: 'CDN URL — vendor the asset under assets/ and serve it from /assets',
    exclude: new RegExp(`${OWNERS.tests.source}|${OWNERS.lint.source}`),
  },
  {
    rule: 'no-small-touch-target',
    pattern: /\bbtn-(?:xs|sm)\b/,
    message: 'Undersized touch target — use the UI.touchBtn tokens',
    exclude: new RegExp(`${OWNERS.styleTokens.source}|${OWNERS.lint.source}|${OWNERS.tests.source}`),
  },

  // ── Interaction ────────────────────────────────────────────────
  {
    rule: 'no-native-dialog',
    pattern: /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(|hx-confirm=/,
    message: 'Native dialog — offer undo for reversible actions, page state for the rest',
    exclude: new RegExp(`${OWNERS.lint.source}|${OWNERS.tests.source}`),
  },
  {
    rule: 'no-title-tooltip',
    pattern: /\stitle="\$\{t\(|<(?:button|a|span|div)[^>]*\stitle="(?!\$\{formatDateTimeExact)/,
    message: 'title= tooltip is invisible to touch and keyboard — use a visible label',
    exclude: new RegExp(`${OWNERS.lint.source}|${OWNERS.tests.source}`),
  },
  {
    rule: 'no-unsafe-target-blank',
    pattern: /target="_blank"(?![^>]*rel="[^"]*noopener)/,
    message: 'target="_blank" without rel="noopener noreferrer"',
    exclude: OWNERS.lint,
  },
  {
    rule: 'no-polling',
    pattern: /hx-trigger="[^"]*\bevery\b/,
    message: 'Timed refresh — stream the change over SSE instead',
    exclude: new RegExp(`${OWNERS.lint.source}|${OWNERS.tests.source}`),
  },

  // ── Accessibility ──────────────────────────────────────────────
  {
    rule: 'aria-button-type',
    pattern: /<button(?![^>]*\stype=)/,
    message: '<button> without a type attribute defaults to submit',
    exclude: new RegExp(`${OWNERS.tests.source}|${OWNERS.lint.source}`),
  },
  {
    rule: 'aria-th-scope',
    pattern: /<th(?![^>]*\sscope=)[\s>]/,
    message: '<th> without scope="col" or scope="row"',
    exclude: new RegExp(`${OWNERS.tests.source}|${OWNERS.lint.source}`),
  },
  {
    rule: 'aria-table-class',
    pattern: /<table(?![^>]*\$\{UI\.table)/,
    message: '<table> not using a UI table token',
    exclude: new RegExp(`${OWNERS.tests.source}|${OWNERS.lint.source}`),
  },

  // ── Tests ──────────────────────────────────────────────────────
  {
    rule: 'no-test-skip',
    pattern: /\b(?:describe|it|test)\.(?:skip|only|skipIf|todo|failing)\b/,
    message: 'Skipped or exclusive test — fix it or delete it',
    exclude: OWNERS.lint,
  },
  {
    rule: 'no-arbitrary-wait',
    pattern: /setTimeout\(\s*resolve|Bun\.sleep\(\s*\d{3,}/,
    message: 'Arbitrary wait — poll the condition with waitFor instead',
    exclude: new RegExp(`${OWNERS.lint.source}|src/`),
  },
]

/** Interpolations allowed inside a `class="..."` attribute. */
export const CLASS_TOKEN_RE = /^(?:\$\{UI\.[A-Za-z]+\}|\$\{[A-Za-z.?!]+ \? UI\.[A-Za-z]+ : UI\.[A-Za-z]+\}|\$\{stateBadgeClass\([^)]*\)\}|\$\{[A-Za-z.]+\}|\s)+$/

export const MAX_FILE_LINES = 350
export const MAX_FUNCTION_LINES = 60

/** Files a rule may never be excluded from without a stated reason. */
export const SCAN_GLOBS = ['src/**/*.ts', 'test/**/*.ts', 'scripts/**/*.ts', 'assets/*.css'] as const

/** Generated output is regenerated from its source, never hand-edited. */
export const SKIP_PATH_RE = /\/generated\/|assets\/(?:daisyui|htmx|htmx-ext-sse|tailwind-browser)\./

export { OWNERS }
