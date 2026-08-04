import { describe, it, expect } from 'bun:test'
import { EventEmitter } from '../src/EventEmitter'
import { secretsMatch } from '../src/dashboard/middleware'
import { escapeHtml, html, raw, joinHtml } from '../src/dashboard/safe-html'
import { minuteBucket, zonedWallClock } from '../src/Maintenance'
import { resolveTheme, readCookie, nextTheme } from '../src/dashboard/theme'
import { GENERATED_SCHEMA, validateSchema } from '../src/schema'

describe('EventEmitter', () => {
  it('surfaces a listener error instead of swallowing it', () => {
    // Regression: emit() caught and discarded every listener error, including
    // errors thrown by the code meant to report them.
    const emitter = new EventEmitter()
    const errors: unknown[] = []
    emitter.on('error', (err: unknown) => { errors.push(err) })
    emitter.on('thing', () => { throw new Error('listener blew up') })

    emitter.emit('thing')
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('listener blew up')
  })

  it('keeps calling the remaining listeners after one throws', () => {
    const emitter = new EventEmitter()
    const seen: string[] = []
    emitter.on('thing', () => { throw new Error('first') })
    emitter.on('thing', () => { seen.push('second') })
    emitter.on('error', () => undefined)

    emitter.emit('thing')
    expect(seen).toEqual(['second'])
  })

  it('removes a once listener after it fires', () => {
    const emitter = new EventEmitter()
    let calls = 0
    emitter.once('thing', () => { calls++ })
    emitter.emit('thing')
    emitter.emit('thing')
    expect(calls).toBe(1)
    expect(emitter.listenerCount('thing')).toBe(0)
  })
})

describe('HTML escaping', () => {
  it('escapes every character that can break out of markup', () => {
    expect(escapeHtml('<&>"\'')).toBe('&lt;&amp;&gt;&quot;&#39;')
  })

  it('escapes interpolated values by default', () => {
    expect(String(html`<p>${'<script>'}</p>`)).toBe('<p>&lt;script&gt;</p>')
  })

  it('splices already-safe markup verbatim', () => {
    expect(String(html`<p>${raw('<b>bold</b>')}</p>`)).toBe('<p><b>bold</b></p>')
  })

  it('renders nested fragments and arrays without double-escaping', () => {
    const rows = [html`<li>${'a<b'}</li>`, html`<li>${'c&d'}</li>`]
    expect(String(html`<ul>${rows}</ul>`)).toBe('<ul><li>a&lt;b</li><li>c&amp;d</li></ul>')
    expect(String(joinHtml(rows, '|'))).toBe('<li>a&lt;b</li>|<li>c&amp;d</li>')
  })

  it('renders null, undefined and false as nothing', () => {
    expect(String(html`${null}${undefined}${false}`)).toBe('')
  })
})

describe('secret comparison', () => {
  it('matches identical secrets and rejects everything else', () => {
    expect(secretsMatch('s3cret', 's3cret')).toBe(true)
    expect(secretsMatch('s3cret', 's3crey')).toBe(false)
    expect(secretsMatch('s3cret', 's3cret ')).toBe(false)
    expect(secretsMatch('', '')).toBe(true)
    expect(secretsMatch('', 'x')).toBe(false)
  })
})

describe('timezone resolution', () => {
  it('reads the wall clock of a zone without re-parsing a formatted string', () => {
    // 2026-06-01T12:00Z is 08:00 in New York and 21:00 in Tokyo.
    const instant = new Date('2026-06-01T12:00:00Z')
    expect(zonedWallClock(instant, 'America/New_York').getHours()).toBe(8)
    expect(zonedWallClock(instant, 'Asia/Tokyo').getHours()).toBe(21)
    expect(zonedWallClock(instant, 'UTC').getHours()).toBe(12)
  })

  it('keeps the calendar date of the target zone', () => {
    const instant = new Date('2026-06-01T23:30:00Z')
    const tokyo = zonedWallClock(instant, 'Asia/Tokyo')
    expect(tokyo.getDate()).toBe(2)
    expect(tokyo.getHours()).toBe(8)
  })

  it('buckets a firing by its UTC minute', () => {
    expect(minuteBucket(new Date('2026-06-01T12:34:56.789Z'))).toBe('2026-06-01T12:34:00Z')
  })
})

describe('theme negotiation', () => {
  const request = (headers: Record<string, string>) =>
    new Request('http://localhost/boss', { headers })

  it('defaults to light', () => {
    expect(resolveTheme(request({}))).toBe('light')
  })

  it('follows the client hint', () => {
    expect(resolveTheme(request({ 'Sec-CH-Prefers-Color-Scheme': 'dark' }))).toBe('dark')
  })

  it('lets an explicit cookie win over the hint', () => {
    expect(resolveTheme(request({
      'Sec-CH-Prefers-Color-Scheme': 'dark',
      cookie: 'bao-theme=light',
    }))).toBe('light')
  })

  it('matches a cookie name exactly, never by prefix', () => {
    expect(readCookie('bao-theme-other=dark', 'bao-theme')).toBeNull()
    expect(readCookie('other=1; bao-theme=dark', 'bao-theme')).toBe('dark')
  })

  it('toggles between the two themes', () => {
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('light')
  })
})

describe('schema binding', () => {
  it('matches the namespace the Prisma schema declares', async () => {
    // The generated client and the migrations bind to one namespace; if these
    // two ever disagree, half of every operation silently misses its tables.
    const prismaSchema = await Bun.file(`${import.meta.dir}/../prisma/schema.prisma`).text()
    const declared = [...prismaSchema.matchAll(/@@schema\("([a-z_][a-z0-9_]*)"\)/g)]
      .map(match => match[1])
    expect(new Set(declared)).toEqual(new Set([GENERATED_SCHEMA]))
  })

  it('accepts the generated namespace and rejects anything else', () => {
    expect(validateSchema(GENERATED_SCHEMA)).toBe(GENERATED_SCHEMA)
    expect(() => validateSchema('other')).toThrow('does not match')
    expect(() => validateSchema('bad-name')).toThrow('Invalid schema name')
    expect(() => validateSchema('1abc')).toThrow('Invalid schema name')
    expect(() => validateSchema('a; DROP TABLE x')).toThrow('Invalid schema name')
  })
})
