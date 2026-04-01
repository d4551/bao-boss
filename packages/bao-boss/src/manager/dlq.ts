import { Prisma, PrismaClient } from '../generated/prisma/client.js'

export interface DlqRow {
  id: string
  deadLetter: string
  data: unknown
  priority: number
  expireIn: number
  singletonKey: string | null
}

function buildDlqJobCreateData(
  j: DlqRow,
  dlqQueueMap: Map<string, { deadLetter: string | null }>,
  keepUntil: Date,
) {
  const targetQueue = dlqQueueMap.get(j.deadLetter)
  return {
    queue: j.deadLetter,
    data: j.data as Prisma.InputJsonValue,
    priority: j.priority,
    retryLimit: 0,
    retryCount: 0,
    retryDelay: 0,
    retryBackoff: false,
    expireIn: j.expireIn,
    singletonKey: j.singletonKey,
    deadLetter: targetQueue?.deadLetter ?? null,
    policy: 'standard',
    keepUntil,
  }
}

export async function createDlqJobs(
  prisma: PrismaClient,
  dlqJobs: DlqRow[],
  jobQueueMap: Map<string, string>,
  dlqRetentionDays: number,
  onDlq?: (payload: { jobId: string; queue: string; deadLetter: string }) => void,
  onRowError?: (err: unknown) => void,
): Promise<void> {
  const keepUntil = new Date(Date.now() + dlqRetentionDays * 24 * 60 * 60 * 1000)
  const dlqNames = [...new Set(dlqJobs.map(j => j.deadLetter))]
  const dlqQueues = await prisma.queue.findMany({ where: { name: { in: dlqNames } } })
  const dlqQueueMap = new Map(dlqQueues.map(q => [q.name, q]))
  if (onRowError) {
    for (const j of dlqJobs) {
      try {
        await prisma.job.create({ data: buildDlqJobCreateData(j, dlqQueueMap, keepUntil) })
        onDlq?.({ jobId: j.id, queue: jobQueueMap.get(j.id) ?? 'unknown', deadLetter: j.deadLetter })
      } catch (err) {
        onRowError(err)
      }
    }
  } else {
    await prisma.job.createMany({
      data: dlqJobs.map((j) => buildDlqJobCreateData(j, dlqQueueMap, keepUntil)),
    })
    for (const j of dlqJobs) {
      onDlq?.({ jobId: j.id, queue: jobQueueMap.get(j.id) ?? 'unknown', deadLetter: j.deadLetter })
    }
  }
}
