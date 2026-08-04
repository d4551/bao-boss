import { BaoBoss } from '../src/BaoBoss'
import type { BaoBossOptions } from '../src/types'

/** Unique queue name so concurrent suites never collide on one queue. */
export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Simulate a handler that takes time.
 *
 * The single place a test may sleep: everywhere else waits on a condition, so a
 * slow machine cannot turn a passing test into a flaky one.
 */
export async function simulateWork(ms: number): Promise<void> {
  await Bun.sleep(ms)
}

/** Poll a predicate until true or timeout */
export async function waitFor(
  fn: () => Promise<boolean> | boolean,
  timeoutMs = 5000,
  intervalMs = 100
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return
    await Bun.sleep(intervalMs)
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`)
}

/** Create a BaoBoss instance configured for fast testing */
export function createTestBoss(overrides: Partial<BaoBossOptions> = {}): BaoBoss {
  return new BaoBoss({
    connectionString: Bun.env['DATABASE_URL'],
    maintenanceIntervalSeconds: 1,
    ...overrides,
  })
}

/** Delete a queue if it is still there. A queue a test never created is not an error. */
export async function cleanupQueue(boss: BaoBoss, name: string): Promise<void> {
  if (await boss.getQueue(name)) await boss.deleteQueue(name)
}

/** Wait until a queue holds at least `count` fetchable jobs, then claim them. */
export async function fetchWhenReady(
  boss: BaoBoss,
  queue: string,
  count: number,
  timeoutMs = 10_000,
): Promise<Awaited<ReturnType<BaoBoss['fetch']>>> {
  let claimed: Awaited<ReturnType<BaoBoss['fetch']>> = []
  await waitFor(async () => {
    claimed = await boss.fetch(queue, { batchSize: Math.max(count, 1) })
    return claimed.length >= count
  }, timeoutMs)
  return claimed
}
