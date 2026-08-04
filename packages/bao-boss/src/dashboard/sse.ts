import type { BaoBoss } from '../BaoBoss.js'
import { t } from '../i18n.js'
import { MS_PER_SECOND } from '../defaults.js'
import { progressBarHtml } from './html-jobs.js'
import { eventStream } from './sse-stream.js'

/** How often a live stream re-reads the database. */
export const LIVE_POLL_INTERVAL_MS = 2 * MS_PER_SECOND

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled'])

/**
 * Stream one job's progress bar.
 *
 * The stream closes as soon as the job settles rather than leaving the bar
 * frozen at its last value with nothing to say the updates stopped.
 */
export async function sseProgress(boss: BaoBoss, locale: string, id: string): Promise<Response> {
  const job = await boss.getJobById(id)
  if (!job) return new Response(t('msg.jobNotFound', locale), { status: 404 })
  if (TERMINAL_STATES.has(job.state)) {
    return new Response(t('msg.jobAlreadyFinished', locale), { status: 409 })
  }

  let lastProgress = job.progress ?? null

  return eventStream({
    intervalMs: LIVE_POLL_INTERVAL_MS,
    onError: err => boss.emit('error', err),
    onOpen(controller) {
      controller.send('progress', String(progressBarHtml(lastProgress, locale)))
    },
    async onTick(controller) {
      const current = await boss.getJobById(id)
      if (!current || TERMINAL_STATES.has(current.state)) {
        controller.finish()
        return
      }
      const progress = current.progress ?? null
      if (progress !== lastProgress) {
        lastProgress = progress
        controller.send('progress', String(progressBarHtml(progress, locale)))
      }
    },
  })
}
