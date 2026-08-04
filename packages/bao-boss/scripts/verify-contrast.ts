/**
 * Colour maths for the UI verification pass — WCAG 2.2 relative luminance and
 * contrast ratio, kept apart from the browser driving so each can be read on
 * its own.
 */
/** Relative luminance per WCAG 2.2. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(channel => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const light = Math.max(luminance(a), luminance(b))
  const dark = Math.min(luminance(a), luminance(b))
  return (light + 0.05) / (dark + 0.05)
}

export function parseRgb(value: string): [number, number, number] | null {
  const match = value.match(/rgba?\(([^)]+)\)/)
  if (!match?.[1]) return null
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  const [r, g, b] = parts
  if (r === undefined || g === undefined || b === undefined) return null
  return [r, g, b]
}

