/**
 * The HTML construction boundary — single owner.
 *
 * Every fragment of dashboard markup is built with the `html` tagged template.
 * Interpolated values are escaped by default; the only way to inject markup is
 * to pass a value that is already `SafeHtml`, which means it came through this
 * same escaping boundary. Hand-applied escaping is what let a queue name close
 * the `<title>` element and run script in the document head.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const ESCAPE_RE = /[&<>"']/g

/** Escape a string for interpolation into element text or a quoted attribute value. */
export function escapeHtml(value: string): string {
  return value.replace(ESCAPE_RE, char => ESCAPES[char] ?? char)
}

/** Markup that has already passed through the escaping boundary. */
export class SafeHtml {
  constructor(private readonly html: string) {}

  toString(): string {
    return this.html
  }

  get length(): number {
    return this.html.length
  }
}

/**
 * Mark a string as safe markup without escaping it.
 *
 * Only for markup this codebase authored literally — never for a value that
 * originated in the database, the request, or a job payload.
 */
export function raw(markup: string): SafeHtml {
  return new SafeHtml(markup)
}

/** The empty fragment. Use instead of `''` so conditional slots stay typed. */
export const EMPTY: SafeHtml = new SafeHtml('')

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === false) return ''
  if (value instanceof SafeHtml) return value.toString()
  if (Array.isArray(value)) return value.map(renderValue).join('')
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value)
  }
  return escapeHtml(String(value))
}

/**
 * Build escaped markup.
 *
 * ```ts
 * html`<h1>${queue.name}</h1>${rowsFragment}`
 * ```
 * `queue.name` is escaped; `rowsFragment` is spliced in as-is because it is `SafeHtml`.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? ''
  for (let i = 0; i < values.length; i++) {
    out += renderValue(values[i]) + (strings[i + 1] ?? '')
  }
  return new SafeHtml(out)
}

/** Join fragments with an optional separator, preserving safety. */
export function joinHtml(parts: readonly SafeHtml[], separator = ''): SafeHtml {
  return new SafeHtml(parts.map(part => part.toString()).join(separator))
}
