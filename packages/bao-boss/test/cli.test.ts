import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { BaoBoss } from '../src/BaoBoss'
import { runCommand, USAGE } from '../src/cli'
import { uniqueName, createTestBoss, cleanupQueue } from './helpers'

describe('bao CLI', () => {
  let boss: BaoBoss

  beforeAll(async () => {
    boss = createTestBoss({ noSupervisor: true })
    await boss.start()
  })

  afterAll(async () => {
    await boss.stop()
  })

  it('prints usage with no command', async () => {
    const result = await runCommand(boss, undefined, [])
    expect(result.status).toBe(0)
    expect(result.output.join('\n')).toContain(USAGE)
  })

  it('exits non-zero on an unknown command instead of printing help as success', async () => {
    const result = await runCommand(boss, 'frobnicate', [])
    expect(result.status).toBe(1)
    expect(result.output[0]).toContain('Unknown command')
  })

  it('lists queues with their pending counts', async () => {
    const queueName = uniqueName('cli-queues')
    await boss.createQueue(queueName)
    await boss.send(queueName, {})
    try {
      const result = await runCommand(boss, 'queues', [])
      expect(result.status).toBe(0)
      expect(result.output.join('\n')).toContain(`${queueName} (standard) — 1 pending`)
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('reports how many jobs a purge actually removed', async () => {
    const queueName = uniqueName('cli-purge')
    await boss.createQueue(queueName)
    await boss.insert([{ name: queueName }, { name: queueName }])
    try {
      const result = await runCommand(boss, 'purge', [queueName])
      expect(result.status).toBe(0)
      expect(result.output[0]).toContain('Purged 2 waiting job(s)')
      expect(await boss.getQueueSize(queueName)).toBe(0)
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('fails rather than claiming success for a queue that does not exist', async () => {
    const result = await runCommand(boss, 'purge', [uniqueName('cli-missing')])
    expect(result.status).toBe(1)
    expect(result.output[0]).toContain('No such queue')
  })

  it('requires an argument where one is needed', async () => {
    expect((await runCommand(boss, 'purge', [])).status).toBe(1)
    expect((await runCommand(boss, 'retry', [])).status).toBe(1)
    expect((await runCommand(boss, 'schedule:rm', [])).status).toBe(1)
  })

  it('retries a failed job and names the queue it went back to', async () => {
    const queueName = uniqueName('cli-retry')
    await boss.createQueue(queueName, { retryLimit: 0 })
    const id = await boss.send(queueName, {})
    await boss.fetch(queueName)
    await boss.fail(id, 'boom')
    try {
      const result = await runCommand(boss, 'retry', [id])
      expect(result.status).toBe(0)
      expect(result.output[0]).toContain(queueName)
      expect((await boss.getJobById(id))!.state).toBe('created')
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('refuses to retry a job that is not failed or cancelled', async () => {
    const queueName = uniqueName('cli-retry-state')
    await boss.createQueue(queueName)
    const id = await boss.send(queueName, {})
    try {
      const result = await runCommand(boss, 'retry', [id])
      expect(result.status).toBe(1)
      expect(result.output[0]).toContain('only failed or cancelled')
    } finally {
      await cleanupQueue(boss, queueName)
    }
  })

  it('fails rather than claiming success for a job that does not exist', async () => {
    const result = await runCommand(boss, 'retry', ['00000000-0000-4000-8000-000000000000'])
    expect(result.status).toBe(1)
    expect(result.output[0]).toContain('No such job')
  })

  it('describes each schedule in words', async () => {
    const name = uniqueName('cli-sched')
    await boss.schedule(name, '0 9 * * 1')
    try {
      const result = await runCommand(boss, 'schedule:ls', [])
      expect(result.status).toBe(0)
      expect(result.output.join('\n')).toContain('Monday')
    } finally {
      await boss.unschedule(name)
    }
  })

  it('removes a schedule and fails for one that is not there', async () => {
    const name = uniqueName('cli-sched-rm')
    await boss.schedule(name, '0 9 * * *')
    expect((await runCommand(boss, 'schedule:rm', [name])).status).toBe(0)
    const second = await runCommand(boss, 'schedule:rm', [name])
    expect(second.status).toBe(1)
    expect(second.output[0]).toContain('No such schedule')
  })
})
