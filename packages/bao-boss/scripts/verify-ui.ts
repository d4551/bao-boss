#!/usr/bin/env bun
/**
 * Capture the dashboard from a real browser and record what was checked.
 *
 * Writes a manifest alongside the screenshots so the counts can be audited
 * rather than taken on trust. Requires the example app to be running.
 *
 * Usage: bun run scripts/verify-ui.ts <baseUrl> <outDir>
 */
import { chromium, type Browser, type Page } from 'playwright'
import { contrastRatio, parseRgb } from './verify-contrast.js'

const BASE_URL = Bun.argv[2] ?? 'http://127.0.0.1:3000'
const OUT_DIR = Bun.argv[3] ?? '/tmp/bao-ui'
const PREFIX = '/boss'

const SURFACES = [
  { name: 'overview', path: PREFIX },
  { name: 'queues', path: `${PREFIX}/queues` },
  { name: 'queue-detail', path: `${PREFIX}/queues/reports` },
  { name: 'schedules', path: `${PREFIX}/schedules` },
  { name: 'stats', path: `${PREFIX}/stats` },
] as const

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const

const THEMES = ['light', 'dark'] as const

interface Check {
  cell: string
  screenshot: string
  horizontalOverflow: boolean
  consoleErrors: string[]
  failedRequests: string[]
  theme: string
  smallTargets: number
  contrastFailures: string[]
}

const manifest: Check[] = []
const notes: string[] = []

async function measure(page: Page): Promise<{
  overflow: boolean
  smallTargets: number
  samples: Array<{ label: string; color: string; background: string; size: number; bold: boolean }>
}> {
  return page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1

    let smallTargets = 0
    for (const element of document.querySelectorAll('a, button, input, label[for], summary')) {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      const style = getComputedStyle(element)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      // Visually hidden until focused: not presented as a target in this state.
      if (element.classList.contains('sr-only') && element !== document.activeElement) continue
      // An input whose pointer target is a visible label is sized by that label.
      if (element.id && document.querySelector(`label[for="${element.id}"]`)) continue
      if (rect.height < 24 || rect.width < 24) smallTargets++
    }

    /** A computed colour whose alpha channel is zero paints nothing. */
    const isTransparent = (value: string): boolean => {
      const channels = value.match(/\(([^)]+)\)/)?.[1]
      if (!channels) return value === 'transparent'
      const parts = channels.split(/[\s,/]+/).filter(Boolean).map(Number)
      return parts.length > 3 && parts[3] === 0
    }

    /** Walk up for the first ancestor that actually paints a background. */
    const backgroundOf = (element: Element): string => {
      let current: Element | null = element
      while (current) {
        const background = getComputedStyle(current).backgroundColor
        if (background && !isTransparent(background)) return background
        current = current.parentElement
      }
      return getComputedStyle(document.body).backgroundColor
    }

    const samples: Array<{ label: string; color: string; background: string; size: number; bold: boolean }> = []
    const seen = new Set<string>()
    for (const element of document.querySelectorAll('h1, h2, th, td, a, button, .stat-title, .stat-value, span')) {
      const text = element.textContent?.trim() ?? ''
      if (text.length === 0 || element.children.length > 0) continue
      const style = getComputedStyle(element)
      const key = `${style.color}|${backgroundOf(element)}|${style.fontSize}`
      if (seen.has(key)) continue
      seen.add(key)
      samples.push({
        label: `${element.tagName.toLowerCase()}: ${text.slice(0, 28)}`,
        color: style.color,
        background: backgroundOf(element),
        size: Number.parseFloat(style.fontSize),
        bold: Number(style.fontWeight) >= 700,
      })
    }
    return { overflow, smallTargets, samples }
  })
}

async function captureCell(browser: Browser, surface: typeof SURFACES[number],
  viewport: typeof VIEWPORTS[number], theme: typeof THEMES[number]): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme,
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('requestfailed', request => {
    failedRequests.push(`${request.method()} ${request.url()}`)
  })
  page.on('response', response => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`)
  })

  await page.goto(`${BASE_URL}${surface.path}?theme=${theme}`, { waitUntil: 'networkidle' })
  const appliedTheme = await page.getAttribute('html', 'data-theme') ?? 'unknown'
  const { overflow, smallTargets, samples } = await measure(page)

  const contrastFailures = samples
    .map(sample => {
      const fg = parseRgb(sample.color)
      const bg = parseRgb(sample.background)
      if (!fg || !bg) return null
      const ratio = contrastRatio(fg, bg)
      const large = sample.size >= 24 || (sample.bold && sample.size >= 18.66)
      const required = large ? 3 : 4.5
      return ratio < required ? `${sample.label} ${ratio.toFixed(2)}:1 (needs ${required}:1)` : null
    })
    .filter((entry): entry is string => entry !== null)

  const cell = `${surface.name}-${viewport.name}-${theme}`
  const screenshot = `${OUT_DIR}/${cell}.png`
  await page.screenshot({ path: screenshot, fullPage: true })

  manifest.push({
    cell, screenshot, horizontalOverflow: overflow, consoleErrors, failedRequests,
    theme: appliedTheme, smallTargets, contrastFailures,
  })
  await context.close()
}

/** Capture the viewport after scrolling, where fixed and sticky chrome is proven. */
async function scrolledPass(browser: Browser, path: string): Promise<string> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => window.scrollTo(0, 1200))
  await page.waitForTimeout(200)
  const chrome = await page.evaluate(() => {
    const sidebar = document.querySelector('.drawer-side')?.getBoundingClientRect()
    const header = document.querySelector('header')?.getBoundingClientRect()
    return {
      sidebarVisible: sidebar !== undefined && sidebar.top <= 0 && sidebar.bottom >= window.innerHeight - 1,
      headerPinned: header !== undefined && Math.abs(header.top) < 2,
    }
  })
  await page.screenshot({ path: `${OUT_DIR}/scrolled-desktop.png` })
  await context.close()
  return `sidebar fills the viewport: ${chrome.sidebarVisible}, header pinned: ${chrome.headerPinned}`
}

/** Sweep the viewport continuously and record any width that scrolls sideways. */
async function resizeSweep(browser: Browser, path: string): Promise<number[]> {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 } })
  const page = await context.newPage()
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' })
  const broken: number[] = []
  for (let width = 320; width <= 1920; width += 20) {
    await page.setViewportSize({ width, height: 800 })
    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (overflows) broken.push(width)
  }
  await context.close()
  return broken
}

/** Keyboard-only traversal: every focus stop must be visibly focused. */
async function keyboardPass(browser: Browser, path: string): Promise<string[]> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' })
  const problems: string[] = []
  for (let step = 0; step < 40; step++) {
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => {
      const element = document.activeElement
      if (!element || element === document.body) return null
      const style = getComputedStyle(element)
      // When the control is hidden behind a label, the ring is painted there.
      const paired = element.id ? document.querySelector(`label[for="${element.id}"]`) : null
      const pairedStyle = paired ? getComputedStyle(paired) : null
      return {
        tag: element.tagName.toLowerCase(),
        label: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 30),
        outline: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
        labelRing: pairedStyle !== null
          && (pairedStyle.outlineStyle !== 'none' || pairedStyle.boxShadow !== 'none'),
      }
    })
    if (!focused) break
    const hasRing = focused.outline !== 'none' || focused.boxShadow !== 'none'
    if (!hasRing) problems.push(`${focused.tag} "${focused.label}" has no focus indicator`)
  }
  await context.close()
  return problems
}

/** Re-capture with the glass effect unavailable, forced colours, and reduced transparency. */
async function fallbackPass(browser: Browser, path: string): Promise<void> {
  const modes = [
    { name: 'forced-colors', options: { forcedColors: 'active' as const } },
    { name: 'reduced-motion', options: { reducedMotion: 'reduce' as const } },
  ]
  for (const mode of modes) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ...mode.options,
    })
    const page = await context.newPage()
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' })
    await page.screenshot({ path: `${OUT_DIR}/fallback-${mode.name}.png`, fullPage: true })
    await context.close()
  }

  // backdrop-filter unavailable: the glass surface must stay legible on its tint alone.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: '.bao-glass{backdrop-filter:none;-webkit-backdrop-filter:none}' })
  await page.screenshot({ path: `${OUT_DIR}/fallback-no-backdrop-filter.png`, fullPage: true })
  await context.close()
}

/** Mutate the database behind the page and confirm the view updates itself. */
async function livePass(browser: Browser, path: string, mutate: () => Promise<void>): Promise<string> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' })
  const before = await page.textContent('#bao-live-stats') ?? ''
  await mutate()
  try {
    await page.waitForFunction(
      previous => (document.querySelector('#bao-live-stats')?.textContent ?? '') !== previous,
      before,
      { timeout: 15_000 },
    )
    await page.screenshot({ path: `${OUT_DIR}/live-updated.png`, fullPage: true })
    return 'updated without a reload'
  } catch {
    return 'DID NOT UPDATE'
  } finally {
    await context.close()
  }
}

// ── Run ────────────────────────────────────────────────────────────

await Bun.$`mkdir -p ${OUT_DIR}`.quiet()
const CHROMIUM = Bun.env['CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: CHROMIUM })

for (const surface of SURFACES) {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      await captureCell(browser, surface, viewport, theme)
    }
  }
}

notes.push(`scrolled chrome: ${await scrolledPass(browser, `${PREFIX}/queues/reports`)}`)

const sweepBroken = await resizeSweep(browser, `${PREFIX}/queues/reports`)
notes.push(`resize sweep 320-1920: ${sweepBroken.length === 0 ? 'no horizontal overflow at any width' : `overflow at ${sweepBroken.join(', ')}`}`)

const focusProblems = await keyboardPass(browser, PREFIX)
notes.push(`keyboard traversal: ${focusProblems.length === 0 ? 'every stop shows a focus indicator' : focusProblems.join('; ')}`)

await fallbackPass(browser, PREFIX)
notes.push('fallback captures: forced-colors, reduced-motion, backdrop-filter disabled')

const liveResult = await livePass(browser, PREFIX, async () => {
  await fetch(`${BASE_URL}/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: 'live@example.com', subject: 'live', body: 'live' }),
  })
})
notes.push(`live mutation: ${liveResult}`)

await browser.close()

const declared = SURFACES.length * VIEWPORTS.length * THEMES.length
await Bun.write(`${OUT_DIR}/manifest.json`, JSON.stringify({ declared, manifest, notes }, null, 2))

const overflowing = manifest.filter(entry => entry.horizontalOverflow)
const withErrors = manifest.filter(entry => entry.consoleErrors.length > 0 || entry.failedRequests.length > 0)
const wrongTheme = manifest.filter(entry => !entry.cell.endsWith(entry.theme))
const smallTargets = manifest.filter(entry => entry.smallTargets > 0)
const lowContrast = manifest.filter(entry => entry.contrastFailures.length > 0)

console.log(`declared cells: ${declared}`)
console.log(`captured cells: ${manifest.length}`)
console.log(`horizontal overflow: ${overflowing.map(entry => entry.cell).join(', ') || 'none'}`)
console.log(`console/network errors: ${withErrors.map(entry => `${entry.cell} ${[...entry.consoleErrors, ...entry.failedRequests].join(' | ')}`).join(' ;; ') || 'none'}`)
console.log(`theme mismatch: ${wrongTheme.map(entry => entry.cell).join(', ') || 'none'}`)
console.log(`targets under 24px: ${smallTargets.map(entry => `${entry.cell}=${entry.smallTargets}`).join(', ') || 'none'}`)
console.log(`contrast failures: ${lowContrast.map(entry => `${entry.cell}: ${entry.contrastFailures.join(' | ')}`).join(' ;; ') || 'none'}`)
for (const note of notes) console.log(note)

const failed = overflowing.length + withErrors.length + wrongTheme.length + smallTargets.length + lowContrast.length
if (manifest.length !== declared || failed > 0 || sweepBroken.length > 0
  || focusProblems.length > 0 || liveResult === 'DID NOT UPDATE') {
  process.exit(1)
}
