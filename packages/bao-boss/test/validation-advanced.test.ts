import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Dead Letter Queue Validation', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('rejects self-referencing dead letter queue', async () => {
    const qname = uniqueName('dlq-self')
    await boss.createQueue(qname)
    await expect(
      boss.updateQueue(qname, { deadLetter: qname })
    ).rejects.toThrow('cannot use itself')
    await cleanupQueue(boss, qname)
  })

  it('rejects non-existent dead letter queue', async () => {
    const qname = uniqueName('dlq-noexist')
    await expect(
      boss.createQueue(qname, { deadLetter: 'queue-that-does-not-exist' })
    ).rejects.toThrow('does not exist')
  })

  it('rejects circular dead letter references', async () => {
    const q1 = uniqueName('dlq-circ1')
    const q2 = uniqueName('dlq-circ2')
    await boss.createQueue(q1)
    await boss.createQueue(q2, { deadLetter: q1 })
    await expect(
      boss.updateQueue(q1, { deadLetter: q2 })
    ).rejects.toThrow('Circular dead letter')
    await cleanupQueue(boss, q1)
    await cleanupQueue(boss, q2)
  })

  it('rejects deep circular dead letter references (A -> B -> C -> A)', async () => {
    const qA = uniqueName('dlq-deep-a')
    const qB = uniqueName('dlq-deep-b')
    const qC = uniqueName('dlq-deep-c')
    await boss.createQueue(qA)
    await boss.createQueue(qB, { deadLetter: qA })
    await boss.createQueue(qC, { deadLetter: qB })
    // A -> C -> B -> A would create a cycle
    await expect(
      boss.updateQueue(qA, { deadLetter: qC })
    ).rejects.toThrow('Circular dead letter')
    await cleanupQueue(boss, qA)
    await cleanupQueue(boss, qB)
    await cleanupQueue(boss, qC)
  })

  it('clears dead letter queue when set to empty string', async () => {
    const dlq = uniqueName('dlq-clear')
    const qname = uniqueName('dlq-clearmain')
    await boss.createQueue(dlq)
    await boss.createQueue(qname, { deadLetter: dlq })
    const before = await boss.getQueue(qname)
    expect(before!.deadLetter).toBe(dlq)
    await boss.updateQueue(qname, { deadLetter: '' })
    const after = await boss.getQueue(qname)
    expect(after!.deadLetter).toBeNull()
    await cleanupQueue(boss, qname)
    await cleanupQueue(boss, dlq)
  })

  it('allows valid dead letter queue reference', async () => {
    const dlq = uniqueName('dlq-valid')
    const qname = uniqueName('dlq-main')
    await boss.createQueue(dlq)
    await boss.createQueue(qname, { deadLetter: dlq })
    const q = await boss.getQueue(qname)
    expect(q!.deadLetter).toBe(dlq)
    await cleanupQueue(boss, qname)
    await cleanupQueue(boss, dlq)
  })
})

describe.skipIf(skip)('Payload Size Validation', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss({ maxPayloadBytes: 100 })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('allows payloads within size limit', async () => {
    const qname = uniqueName('payload-ok')
    await boss.createQueue(qname)
    const id = await boss.send(qname, { small: 'data' })
    expect(typeof id).toBe('string')
    await cleanupQueue(boss, qname)
  })

  it('rejects payloads exceeding size limit', async () => {
    const qname = uniqueName('payload-big')
    await boss.createQueue(qname)
    const largeData = { big: 'x'.repeat(200) }
    await expect(
      boss.send(qname, largeData)
    ).rejects.toThrow('exceeds maximum')
    await cleanupQueue(boss, qname)
  })

  it('rejects oversized payloads in insert() too', async () => {
    const qname = uniqueName('payload-insert')
    await boss.createQueue(qname)
    const largeData = { big: 'x'.repeat(200) }
    await expect(
      boss.insert([{ name: qname, data: largeData }])
    ).rejects.toThrow('exceeds maximum')
    await cleanupQueue(boss, qname)
  })

  it('allows undefined data regardless of limit', async () => {
    const qname = uniqueName('payload-undef')
    await boss.createQueue(qname)
    const id = await boss.send(qname)
    expect(typeof id).toBe('string')
    await cleanupQueue(boss, qname)
  })
})
