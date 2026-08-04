#!/usr/bin/env bun
/**
 * Project lint for bao-boss.
 *
 * Scans every hand-written file — source, tests, scripts and the owned
 * stylesheet. Narrowing the scan is how debt hides, so the globs live in
 * lint-rules.ts and a path is skipped only when it is generated output.
 *
 * Usage: bun run scripts/lint.ts
 */
import { Glob } from 'bun'
import {
  CLASS_TOKEN_RE, LINE_RULES, MAX_FILE_LINES, MAX_FUNCTION_LINES, SCAN_GLOBS, SKIP_PATH_RE,
} from './lint-rules.js'

interface Finding {
  file: string
  line: number
  rule: string
  message: string
}

const findings: Finding[] = []
const NOT_A_FUNCTION = new Set(['if', 'for', 'while', 'switch', 'catch', 'return'])
/** True for any file under the test directory, at the root or nested. */
function isTestFile(file: string): boolean {
  return file.startsWith('test/') || file.includes('/test/')
}

/** A line that is only a comment: prose, not code a rule should judge. */
const COMMENT_ONLY_RE = /^\s*(?:\/\/|\*|\/\*|<!--)/

function report(file: string, line: number, rule: string, message: string): void {
  findings.push({ file, line, rule, message })
}

async function collectFiles(): Promise<string[]> {
  const files: string[] = []
  for (const pattern of SCAN_GLOBS) {
    for await (const path of new Glob(pattern).scan('.')) {
      if (!SKIP_PATH_RE.test(`/${path}`)) files.push(path)
    }
  }
  return files.sort()
}

/** Every i18n key the catalogue defines. */
async function readI18nKeys(files: string[]): Promise<Set<string>> {
  const keys = new Set<string>()
  const catalogue = files.find(file => file.endsWith('src/i18n.ts'))
  if (!catalogue) return keys
  const content = await Bun.file(catalogue).text()
  for (const match of content.matchAll(/'([a-z]+\.[a-zA-Z]+)':/g)) {
    if (match[1]) keys.add(match[1])
  }
  return keys
}

/** Class attributes must be composed from UI tokens, never written by hand. */
function checkClassAttributes(file: string, line: string, lineNumber: number): void {
  // ui.ts owns the tokens; the lint sources quote the patterns they match.
  if (file.endsWith('dashboard/ui.ts') || isTestFile(file) || file.startsWith('scripts/')) return
  for (const match of line.matchAll(/class="([^"]*)"/g)) {
    const value = match[1] ?? ''
    if (!CLASS_TOKEN_RE.test(value)) {
      report(file, lineNumber, 'no-raw-class',
        `Raw class string "${value}" — add it to the UI token owner and reference the token`)
    }
  }
}

/**
 * Markup must be built with the `html` tagged template so interpolation is
 * escaped. A bare template literal containing a tag and an interpolation is how
 * a queue name once reached the document head unescaped.
 */
function checkUnescapedMarkup(file: string, line: string, lineNumber: number): void {
  if (!file.includes('/dashboard/') || file.endsWith('safe-html.ts') || isTestFile(file)) return
  if (!/`[^`]*<[a-zA-Z!/][^`]*\$\{/.test(line)) return
  if (/\bhtml`/.test(line) || /\braw\(/.test(line)) return
  report(file, lineNumber, 'no-unescaped-markup',
    'Markup interpolated through a bare template literal — build it with the html`` tag')
}

/** User-facing text must come from the i18n catalogue. */
function checkHardcodedCopy(file: string, line: string, lineNumber: number): void {
  if (!file.includes('/dashboard/') || isTestFile(file)) return
  for (const match of line.matchAll(/>([A-Z][A-Za-z][A-Za-z ,.'-]{3,})</g)) {
    report(file, lineNumber, 'no-hardcoded-copy',
      `Hardcoded copy "${match[1]?.trim()}" — add a key to i18n.ts and use t()`)
  }
}

/** Every htmx request needs a stated swap target. */
function checkHtmxSwap(file: string, lines: string[], index: number): void {
  if (isTestFile(file)) return
  const line = lines[index] ?? ''
  if (!/hx-(?:get|post|put|delete|patch)=/.test(line)) return
  const nearby = lines.slice(index, index + 4).join(' ')
  if (!nearby.includes('hx-swap') && !nearby.includes('sse-swap')) {
    report(file, index + 1, 'htmx-missing-swap', 'htmx request without hx-swap within 3 lines')
  }
}

function checkI18nKeys(file: string, content: string, keys: Set<string>): void {
  if (!file.includes('/dashboard/') && !file.endsWith('src/Dashboard.ts')) return
  for (const match of content.matchAll(/(?:^|[\s(,`${}+])t[f]?\('([a-z]+\.[a-zA-Z]+)'/g)) {
    const key = match[1]
    if (key && !keys.has(key)) {
      const lineNumber = content.slice(0, match.index).split('\n').length
      report(file, lineNumber, 'i18n-missing-key', `t('${key}') references an undefined message key`)
    }
  }
}

function checkFunctionLength(file: string, lines: string[]): void {
  let start = -1
  let name = ''
  let depth = 0
  let inFunction = false

  lines.forEach((line, index) => {
    const match = line.match(/(?:async\s+)?(?:function\s+(\w+)|(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{)/)
    if (match && !inFunction) {
      name = match[1] ?? match[2] ?? 'anonymous'
      if (!(match[2] !== undefined && NOT_A_FUNCTION.has(name))) {
        start = index + 1
        inFunction = true
        depth = 0
      }
    }
    if (!inFunction) return
    for (const char of line) {
      if (char === '{') depth++
      if (char === '}') depth--
    }
    if (depth <= 0 && start > 0) {
      const length = index + 1 - start
      if (length > MAX_FUNCTION_LINES) {
        report(file, start, 'function-too-long',
          `Function '${name}' is ${length} lines (max ${MAX_FUNCTION_LINES}) — decompose it`)
      }
      inFunction = false
      start = -1
    }
  })
}

/** An exported symbol nothing imports is dead weight or an unwired feature. */
function checkDeadExports(files: Map<string, string>): void {
  const importedNames = new Set<string>()
  for (const content of files.values()) {
    // `export { X } from` publishes X, which is a consumer just like an import.
    for (const match of content.matchAll(/(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s+from/g)) {
      for (const part of (match[1] ?? '').split(',')) {
        const name = part.replace(/\btype\b/, '').split(' as ')[0]?.trim()
        if (name) importedNames.add(name)
      }
    }
    for (const match of content.matchAll(/\b(?:UI|Prisma|Value|Type)\.(\w+)/g)) {
      if (match[1]) importedNames.add(match[1])
    }
  }

  for (const [file, content] of files) {
    if (file.endsWith('src/index.ts') || file.endsWith('src/Dashboard.ts') || isTestFile(file)) continue
    const lines = content.split('\n')
    lines.forEach((line, index) => {
      const match = line.match(/^export\s+(?:async\s+)?(?:function|class|const|interface|type)\s+(\w+)/)
      const name = match?.[1]
      if (!name || importedNames.has(name)) return
      report(file, index + 1, 'dead-export',
        `'${name}' is exported but nothing imports it — wire it up or delete it`)
    })
  }
}

// ── Run ────────────────────────────────────────────────────────────

const paths = await collectFiles()
const i18nKeys = await readI18nKeys(paths)
const contents = new Map<string, string>()

for (const file of paths) {
  const content = await Bun.file(file).text()
  contents.set(file, content)
  const lines = content.split('\n')

  if (lines.length > MAX_FILE_LINES) {
    report(file, 1, 'file-too-long', `File is ${lines.length} lines (max ${MAX_FILE_LINES}) — decompose it`)
  }

  lines.forEach((line, index) => {
    const isComment = COMMENT_ONLY_RE.test(line)
    for (const rule of LINE_RULES) {
      if (rule.exclude?.test(file)) continue
      if (isComment && !rule.appliesToComments) continue
      if (rule.pattern.test(line)) report(file, index + 1, rule.rule, rule.message)
    }
    checkClassAttributes(file, line, index + 1)
    checkUnescapedMarkup(file, line, index + 1)
    checkHardcodedCopy(file, line, index + 1)
    checkHtmxSwap(file, lines, index)
  })

  checkI18nKeys(file, content, i18nKeys)
  if (file.endsWith('.ts')) checkFunctionLength(file, lines)
}

checkDeadExports(contents)

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
for (const finding of findings) {
  console.log(`ERROR  ${finding.file}:${finding.line}  [${finding.rule}]  ${finding.message}`)
}
console.log(`\n${paths.length} files scanned, ${findings.length} error(s)`)

if (findings.length > 0) process.exit(1)
