import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { uniqueName, createTestBoss, cleanupQueue } from './helpers'

const skip = !Bun.env['DATABASE_URL']

describe.skipIf(skip)('Job Dependencies', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss()
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('job with dependency is not fetched until dependency completes', async () => {
    const qname = uniqueName('deps-basic')
    await boss.createQueue(qname)

    // Send job A
    const idA = await boss.send(qname, { name: 'A' })

    // Send job B depending on A
    const idB = await boss.send(qname, { name: 'B' }, { dependsOn: [idA] })

    // B should not be fetchable while A is still in created state
    const batch1 = await boss.fetch(qname, { batchSize: 10 })
    // Should only get A (B is blocked by dependency)
    expect(batch1).toHaveLength(1)
    expect(batch1[0]!.id).toBe(idA)

    // Complete A
    await boss.complete(idA)

    // Now B should be fetchable
    const batch2 = await boss.fetch(qname, { batchSize: 10 })
    expect(batch2).toHaveLength(1)
    expect(batch2[0]!.id).toBe(idB)

    await boss.complete(idB)
    await cleanupQueue(boss, qname)
  })

  it('job with dependency fetchable after dependency cancelled', async () => {
    const qname = uniqueName('deps-cancel')
    await boss.createQueue(qname)

    const idA = await boss.send(qname, { name: 'A' })
    const idB = await boss.send(qname, { name: 'B' }, { dependsOn: [idA] })

    // B should not be fetchable yet
    const batch1 = await boss.fetch(qname, { batchSize: 10 })
    expect(batch1).toHaveLength(1)
    expect(batch1[0]!.id).toBe(idA)

    // Cancel A (instead of completing)
    await boss.cancel(idA)

    // Now B should be fetchable since dependency is cancelled
    const batch2 = await boss.fetch(qname, { batchSize: 10 })
    expect(batch2).toHaveLength(1)
    expect(batch2[0]!.id).toBe(idB)

    await boss.complete(idB)
    await cleanupQueue(boss, qname)
  })

  it('job with multiple dependencies waits for all', async () => {
    const qname = uniqueName('deps-multi')
    await boss.createQueue(qname)

    const idA = await boss.send(qname, { name: 'A' })
    const idB = await boss.send(qname, { name: 'B' })
    const idC = await boss.send(qname, { name: 'C' }, { dependsOn: [idA, idB] })

    // Fetch A and B (C should be blocked)
    const batch1 = await boss.fetch(qname, { batchSize: 10 })
    expect(batch1).toHaveLength(2)
    const fetchedIds = batch1.map(j => j.id).sort()
    expect(fetchedIds).toEqual([idA, idB].sort())

    // Complete only A
    await boss.complete(idA)

    // C should still be blocked because B is not completed
    const batch2 = await boss.fetch(qname, { batchSize: 10 })
    expect(batch2).toHaveLength(0)

    // Complete B
    await boss.complete(idB)

    // Now C should be fetchable
    const batch3 = await boss.fetch(qname, { batchSize: 10 })
    expect(batch3).toHaveLength(1)
    expect(batch3[0]!.id).toBe(idC)

    await boss.complete(idC)
    await cleanupQueue(boss, qname)
  })

  it('dependency chain A -> B -> C', async () => {
    const qname = uniqueName('deps-chain')
    await boss.createQueue(qname)

    const idA = await boss.send(qname, { name: 'A' })
    const idB = await boss.send(qname, { name: 'B' }, { dependsOn: [idA] })
    const idC = await boss.send(qname, { name: 'C' }, { dependsOn: [idB] })

    // Only A should be fetchable
    const batch1 = await boss.fetch(qname, { batchSize: 10 })
    expect(batch1).toHaveLength(1)
    expect(batch1[0]!.id).toBe(idA)

    // Complete A
    await boss.complete(idA)

    // Now B should be fetchable (C still blocked)
    const batch2 = await boss.fetch(qname, { batchSize: 10 })
    expect(batch2).toHaveLength(1)
    expect(batch2[0]!.id).toBe(idB)

    // Complete B
    await boss.complete(idB)

    // Now C should be fetchable
    const batch3 = await boss.fetch(qname, { batchSize: 10 })
    expect(batch3).toHaveLength(1)
    expect(batch3[0]!.id).toBe(idC)

    await boss.complete(idC)
    await cleanupQueue(boss, qname)
  })
})
