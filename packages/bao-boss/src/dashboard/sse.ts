import type { BaoBoss } from '../BaoBoss.js'
import { t } from '../i18n.js'
import { progressBarHtml } from './html.js'

export async function sseProgress(
  boss: BaoBoss,
  _prefix: string,
  locale: string,
  id: string,
  queryLocale?: string,
): Promise<Response> {
  const loc = queryLocale || locale
  const job = await boss.getJobById(id)
  if (!job) {
    return new Response(t('msg.jobNotFound', loc), { status: 404 })
  }
  const terminalStates = ['completed', 'failed', 'cancelled']
  if (terminalStates.includes(job.state)) {
    return new Response(t('msg.jobAlreadyFinished', loc), { status: 400 })
  }

  let intervalId: ReturnType<typeof setInterval> | null = null
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      let lastProgress: number | null = job.progress ?? null

      const send = (event: string, data: string) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data.replace(/\n/g, '\ndata: ')}\n\n`))
      }

      send('progress', progressBarHtml(lastProgress, loc))

      intervalId = setInterval(async () => {
        if (closed) { clearInterval(intervalId!); return }
        try {
          const j = await boss.getJobById(id)
          if (!j || terminalStates.includes(j.state)) {
            clearInterval(intervalId!)
            intervalId = null
            send('close', '{}')
            if (!closed) { closed = true; controller.close() }
            return
          }
          const p = j.progress ?? null
          if (p !== lastProgress) {
            lastProgress = p
            send('progress', progressBarHtml(p, loc))
          }
        } catch {
          clearInterval(intervalId!)
          intervalId = null
          if (!closed) { closed = true; controller.close() }
        }
      }, 2000)
    },
    cancel() {
      closed = true
      if (intervalId) { clearInterval(intervalId); intervalId = null }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
