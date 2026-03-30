import { BaoBoss } from '../src/BaoBoss'
import type { Job, CreateQueueOptions } from '../src/types'

const skip = !Bun.env['DATABASE_URL']

/** Create a unique queue name to avoid test collisions */
export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
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
export function createTestBoss(overrides: Partial<import('../src/types').BaoBossOptions> = {}): BaoBoss {
  return new BaoBoss({
    connectionString: Bun.env['DATABASE_URL'],
    maintenanceIntervalSeconds: 1,
    ...overrides,
  })
}

/** Create a queue, send N jobs, return queue name and job IDs */
export async function createQueueWithJobs(
  boss: BaoBoss,
  opts: { prefix?: string; count?: number; queueOptions?: CreateQueueOptions; data?: unknown } = {}
): Promise<{ queueName: string; jobIds: string[] }> {
  const queueName = uniqueName(opts.prefix ?? 'test')
  await boss.createQueue(queueName, opts.queueOptions ?? {})
  const jobIds: string[] = []
  for (let i = 0; i < (opts.count ?? 1); i++) {
    const id = await boss.send(queueName, opts.data ?? { n: i })
    jobIds.push(id)
  }
  return { queueName, jobIds }
}

/** Safely delete a queue, ignoring errors if it doesn't exist */
export async function cleanupQueue(boss: BaoBoss, name: string): Promise<void> {
  try {
    await boss.deleteQueue(name)
  } catch {
    // Queue may not exist, that's fine
  }
}
