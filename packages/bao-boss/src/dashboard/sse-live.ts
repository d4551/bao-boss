import type { BaoBoss } from '../BaoBoss.js'
import { renderLiveQueues, renderLiveStats } from './routes.js'
import { eventStream } from './sse-stream.js'
import { LIVE_POLL_INTERVAL_MS } from './sse.js'

/**
 * Live dashboard stream.
 *
 * The counters and the queue table are pushed as they change instead of the
 * page re-fetching itself on a timer. A timed swap of the whole panel destroyed
 * focus and the caret whenever somebody was typing in the filter inside it; the
 * filter now lives outside the swapped region and never moves.
 *
 * Frames are sent only when the rendered markup actually differs, so an idle
 * dashboard costs one query per interval and no DOM work at all.
 */
export function sseLive(
  boss: BaoBoss,
  prefix: string,
  locale: string,
  search: string,
): Response {
  let lastStats = ''
  let lastQueues = ''

  const push = async (send: (event: string, data: string) => void): Promise<void> => {
    const [stats, queues] = await Promise.all([
      renderLiveStats(boss, locale),
      renderLiveQueues(boss, prefix, locale, search),
    ])
    if (stats !== lastStats) {
      lastStats = stats
      send('stats', stats)
    }
    if (queues !== lastQueues) {
      lastQueues = queues
      send('queues', queues)
    }
  }

  return eventStream({
    intervalMs: LIVE_POLL_INTERVAL_MS,
    onError: err => boss.emit('error', err),
    // The page already rendered the current markup, so record it as the
    // baseline and stay silent until something genuinely changes.
    async onOpen() {
      await push(() => {})
    },
    async onTick(controller) {
      await push((event, data) => controller.send(event, data))
    },
  })
}
