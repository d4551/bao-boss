import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { SEARCH_LIMIT_MAX } from '../src/defaults'
import { uniqueName, createTestBoss, cleanupQueue } from './helpers'

describe('job output', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss({ noSupervisor: true })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  const completeWith = async (output: unknown): Promise<unknown> => {
    const queueName = uniqueName('output')
    await boss.createQueue(queueName)
    try {
      const id = await boss.send(queueName, {})
      await boss.fetch(queueName)
      await boss.complete(id, { output })
      return (await boss.getJobById(id))!.output
    } finally {
      await cleanupQueue(boss, queueName)
    }
  }

  it('stores a falsy result rather than discarding it', async () => {
    // Regression: `options.output ? ... : null` dropped 0, '' and false.
    expect(await completeWith(0)).toBe(0)
    expect(await completeWith('')).toBe('')
    expect(await completeWith(false)).toBe(false)
  })

  it('stores a structured result', async () => {
    expect(await completeWith({ ok: true, count: 3 })).toEqual({ ok: true, count: 3 })
  })

  it('records no output when none was given', async () => {
    expect(await completeWith(undefined)).toBeNull()
  })
})

describe('input validation', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss({ noSupervisor: true })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('caps the search page size instead of accepting any number', async () => {
    await expect(boss.searchJobs({ limit: SEARCH_LIMIT_MAX + 1 })).rejects.toThrow()
    await expect(boss.searchJobs({ limit: 5_000_000 })).rejects.toThrow()
  })

  it('rejects an unknown sort column', async () => {
    await expect(boss.searchJobs({ sortBy: 'nope' as 'createdOn' })).rejects.toThrow()
  })

  it('names the offending option when startAfter is unparseable', async () => {
    const queueName = uniqueName('startafter')
    await boss.createQueue(queueName)
    try {
      await expect(boss.send(queueName, {}, { startAfter: 'not-a-date' }))
        .rejects.toThrow('not a parseable date')
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('names the offending path when a payload cannot be stored as JSON', async () => {
    const queueName = uniqueName('payload')
    await boss.createQueue(queueName)
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    try {
      await expect(boss.send(queueName, circular)).rejects.toThrow('circular reference')
      await expect(boss.send(queueName, { when: new Date() })).rejects.toThrow('plain object')
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('rejects an invalid schema name at construction', () => {
    // Regression: an invalid name silently skipped CREATE SCHEMA instead of failing.
    expect(() => new BaoBoss({ schema: 'bad-name; DROP TABLE x' })).toThrow('Invalid schema name')
  })
})

describe('progress reporting', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss({ noSupervisor: true })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('does not announce progress for a job that never changed', async () => {
    // Regression: the event fired even when the update matched zero rows.
    const queueName = uniqueName('progress-noop')
    await boss.createQueue(queueName)
    try {
      const id = await boss.send(queueName, {})
      let events = 0
      boss.on('progress', () => { events++ })

      await boss.progress(id, 50)
      expect((await boss.getJobById(id))!.progress).toBeNull()
      expect(events).toBe(0)

      await boss.fetch(queueName)
      await boss.progress(id, 50)
      expect((await boss.getJobById(id))!.progress).toBe(50)
      expect(events).toBe(1)
    } finally {
      boss.removeAllListeners('progress')
      await cleanupQueue(boss, queueName)
    }
  })
})
