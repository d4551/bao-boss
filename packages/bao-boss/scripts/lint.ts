#!/usr/bin/env bun
/**
 * Project-specific lint for bao-boss.
 *
 * Checks dashboard HTML, i18n, ARIA, HTMX, type-safety, DRY, complexity,
 * and style violations across all source files.
 *
 * Usage: bun run scripts/lint.ts
 */

import { Glob } from 'bun'

interface Finding {
  file: string
  line: number
  rule: string
  message: string
  severity: 'error' | 'warn'
}

const findings: Finding[] = []
const SRC = 'src'

function addFinding(file: string, line: number, rule: string, message: string, severity: 'error' | 'warn' = 'error') {
  findings.push({ file, line, rule, message, severity })
}

// ── Rule definitions ──────────────────────────────────────────────────

const LINE_RULES: Array<{
  pattern: RegExp
  rule: string
  message: string
  severity: 'error' | 'warn'
  exclude?: RegExp
}> = [
  // Type-safety violations
  {
    pattern: /\bas unknown\b/,
    rule: 'no-as-unknown',
    message: '`as unknown` typecast found — use proper typed mappers',
    severity: 'error',
  },
  {
    pattern: /\bas never\b/,
    rule: 'no-as-never',
    message: '`as never` typecast found — use Prisma.InputJsonValue or proper types',
    severity: 'error',
  },
  {
    pattern: /\bas any\b/,
    rule: 'no-as-any',
    message: '`as any` typecast found — use concrete types',
    severity: 'error',
  },
  {
    pattern: /eslint-disable/,
    rule: 'no-eslint-disable',
    message: 'eslint-disable comment — fix the underlying issue instead',
    severity: 'error',
  },
  {
    pattern: /@ts-ignore/,
    rule: 'no-ts-ignore',
    message: '@ts-ignore found — fix the type error',
    severity: 'error',
  },

  // i18n violations — hardcoded user-facing strings in Dashboard HTML
  {
    pattern: />\s*(Loading|Error|Success|Warning|Info|None|No |Not found|Unauthorized|Forbidden)\b/,
    rule: 'i18n-hardcoded-string',
    message: 'Possible hardcoded user-facing string — use t() from i18n.ts',
    severity: 'error',
    exclude: /i18n\.ts|\.test\.|cron\.ts/,
  },

  // ARIA violations
  {
    pattern: /<button(?![^>]*type=)/,
    rule: 'aria-button-type',
    message: '<button> missing type attribute — add type="button" or type="submit"',
    severity: 'error',
    exclude: /\.test\./,
  },
  {
    pattern: /<table(?![^>]*role=)(?![^>]*class="table)/,
    rule: 'aria-table-role',
    message: '<table> without DaisyUI table class or explicit role',
    severity: 'error',
    exclude: /\.test\./,
  },
  {
    pattern: /<th\s*>/,
    rule: 'aria-th-scope',
    message: '<th> missing scope attribute — add scope="col" or scope="row"',
    severity: 'error',
    exclude: /\.test\./,
  },

  // HTMX violations
  // Checked via custom logic below instead of line regex


  // Style violations
  {
    pattern: /style="/,
    rule: 'no-inline-style',
    message: 'Inline style attribute — use Tailwind/DaisyUI classes instead',
    severity: 'error',
    exclude: /\.test\./,
  },
  {
    pattern: /<style>/,
    rule: 'no-style-tag',
    message: '<style> tag — use Tailwind/DaisyUI classes instead',
    severity: 'error',
    exclude: /\.test\./,
  },

  // Complexity markers
  {
    pattern: /try\s*\{/,
    rule: 'try-catch-audit',
    message: 'try/catch block — verify it is structural (background loop) not avoidable',
    severity: 'warn',
  },
]

// ── File-level rules ──────────────────────────────────────────────────

const MAX_FILE_LINES = 350
const MAX_FUNCTION_LINES = 60

// ── Scan ──────────────────────────────────────────────────────────────

const glob = new Glob(`${SRC}/**/*.ts`)
const files: string[] = []
for await (const path of glob.scan('.')) {
  // Skip generated code
  if (path.includes('/generated/')) continue
  files.push(path)
}

// Collect all i18n keys
const i18nFile = files.find(f => f.endsWith('i18n.ts'))
const i18nKeys = new Set<string>()
if (i18nFile) {
  const content = await Bun.file(i18nFile).text()
  const keyPattern = /'([a-z]+\.[a-zA-Z]+)'/g
  let match
  while ((match = keyPattern.exec(content))) {
    i18nKeys.add(match[1]!)
  }
}

// Track constants for single-source-of-truth checks
const constantDefinitions = new Map<string, string[]>() // value -> [file:line, ...]
const interfaceDefinitions = new Map<string, string[]>() // name -> [file:line, ...]

for (const file of files) {
  const content = await Bun.file(file).text()
  const lines = content.split('\n')

  // File length check
  if (lines.length > MAX_FILE_LINES) {
    addFinding(file, 1, 'file-too-long', `File is ${lines.length} lines (max ${MAX_FILE_LINES}) — consider decomposing`, 'error')
  }

  // Track function lengths
  let fnStart = -1
  let fnName = ''
  let braceDepth = 0
  let inFn = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNum = i + 1

    // HTMX check: if line has hx-get/post/delete/put/patch, check that hx-swap appears
    // either on this line or within 3 lines after (multi-line HTML attributes)
    if (!file.includes('.test.')) {
      const htmxMatch = line.match(/hx-(?:get|post|put|delete|patch)=/)
      if (htmxMatch) {
        const nearby = lines.slice(i, Math.min(i + 4, lines.length)).join(' ')
        if (!nearby.includes('hx-swap') && !nearby.includes('sse-swap')) {
          addFinding(file, lineNum, 'htmx-missing-swap', 'HTMX request without hx-swap within 3 lines', 'error')
        }
      }
    }

    // Line rules
    for (const rule of LINE_RULES) {
      if (rule.exclude && rule.exclude.test(file)) continue
      if (rule.pattern.test(line)) {
        addFinding(file, lineNum, rule.rule, rule.message, rule.severity)
      }
    }

    // Track interface definitions for duplication detection
    const ifaceMatch = line.match(/^export\s+interface\s+(\w+)/)
    if (ifaceMatch) {
      const name = ifaceMatch[1]!
      const locs = interfaceDefinitions.get(name) ?? []
      locs.push(`${file}:${lineNum}`)
      interfaceDefinitions.set(name, locs)
    }

    // Track exported const string values
    const constMatch = line.match(/^(?:export\s+)?const\s+(\w+)\s*=\s*['"]([^'"]+)['"]/)
    if (constMatch) {
      const value = constMatch[2]!
      const locs = constantDefinitions.get(value) ?? []
      locs.push(`${file}:${lineNum}`)
      constantDefinitions.set(value, locs)
    }

    // Function length tracking (simplified)
    const fnMatch = line.match(/(?:async\s+)?(?:function\s+(\w+)|(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{)/)
    if (fnMatch && !inFn) {
      fnName = fnMatch[1] ?? fnMatch[2] ?? 'anonymous'
      fnStart = lineNum
      inFn = true
      braceDepth = 0
    }
    if (inFn) {
      for (const ch of line) {
        if (ch === '{') braceDepth++
        if (ch === '}') braceDepth--
      }
      if (braceDepth <= 0 && inFn && fnStart > 0) {
        const fnLength = lineNum - fnStart
        if (fnLength > MAX_FUNCTION_LINES) {
          addFinding(file, fnStart, 'function-too-long', `Function '${fnName}' is ${fnLength} lines (max ${MAX_FUNCTION_LINES}) — decompose`, 'error')
        }
        inFn = false
        fnStart = -1
      }
    }
  }

  // i18n: check Dashboard files for t() calls referencing undefined keys
  // Only match standalone t() calls (preceded by space, paren, comma, backtick, or start of line)
  if (file.includes('Dashboard') || file.includes('dashboard/')) {
    const tCalls = content.matchAll(/(?:^|[\s(,`${}+])t\('([a-z]+\.[a-zA-Z]+)'/g)
    for (const match of tCalls) {
      const key = match[1]!
      if (!i18nKeys.has(key)) {
        const lineIdx = content.substring(0, match.index).split('\n').length
        addFinding(file, lineIdx, 'i18n-missing-key', `t('${key}') references undefined i18n key`, 'error')
      }
    }
  }
}

// Single-source-of-truth: duplicated interfaces
for (const [name, locs] of interfaceDefinitions) {
  if (locs.length > 1) {
    addFinding(locs[0]!.split(':')[0]!, parseInt(locs[0]!.split(':')[1]!), 'duplicate-interface',
      `Interface '${name}' defined in ${locs.length} places: ${locs.join(', ')}`, 'error')
  }
}

// Single-source-of-truth: duplicated string constants
for (const [value, locs] of constantDefinitions) {
  if (locs.length > 1 && value.length > 5) {
    addFinding(locs[0]!.split(':')[0]!, parseInt(locs[0]!.split(':')[1]!), 'duplicate-constant',
      `Constant '${value}' defined in ${locs.length} places: ${locs.join(', ')}`, 'warn')
  }
}

// ── Report ────────────────────────────────────────────────────────────

const errors = findings.filter(f => f.severity === 'error')
const warnings = findings.filter(f => f.severity === 'warn')

findings.sort((a, b) => {
  if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1
  return a.file.localeCompare(b.file) || a.line - b.line
})

for (const f of findings) {
  const icon = f.severity === 'error' ? 'ERROR' : 'WARN '
  console.log(`${icon}  ${f.file}:${f.line}  [${f.rule}]  ${f.message}`)
}

console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`)

if (errors.length > 0) {
  process.exit(1)
}
