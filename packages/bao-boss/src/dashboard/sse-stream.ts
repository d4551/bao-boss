import { MS_PER_SECOND } from '../defaults.js'

/** Comment frame that keeps an intermediary from closing a quiet connection. */
const HEARTBEAT_INTERVAL_MS = 20 * MS_PER_SECOND
/** Reconnection delay the browser should use if the stream drops. */
const RETRY_MS = 5 * MS_PER_SECOND

const SSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Tell nginx not to buffer, which would hold every frame until the stream ends.
  'X-Accel-Buffering': 'no',
}

interface StreamController {
  /** Emit a named event carrying an HTML fragment or JSON payload. */
  send(event: string, data: string): void
  /** Emit `close` and end the stream. */
  finish(event?: string): void
  /** True once the client disconnected or the stream ended. */
  readonly closed: boolean
}

interface EventStreamOptions {
  /** Called once when the client connects. */
  onOpen(controller: StreamController): void | Promise<void>
  /** Called on every poll tick until the stream ends. */
  onTick?(controller: StreamController): void | Promise<void>
  /** Milliseconds between ticks. Omit for a send-once stream. */
  intervalMs?: number
  /** Reported when a tick throws. */
  onError(error: Error): void
}

/** One live connection: owns its timers, its encoder and its closed flag. */
class EventStreamSession implements StreamController {
  private readonly encoder = new TextEncoder()
  private poll: ReturnType<typeof setInterval> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private ended = false

  constructor(
    private readonly sink: ReadableStreamDefaultController<Uint8Array>,
    private readonly options: EventStreamOptions,
  ) {}

  get closed(): boolean {
    return this.ended
  }

  private write(frame: string): void {
    if (this.ended) return
    this.sink.enqueue(this.encoder.encode(frame))
  }

  send(event: string, data: string): void {
    this.write(`event: ${event}\ndata: ${data.replace(/\n/g, '\ndata: ')}\n\n`)
  }

  finish(event = 'close'): void {
    this.stopTimers()
    this.send(event, '{}')
    if (!this.ended) {
      this.ended = true
      this.sink.close()
    }
  }

  stopTimers(): void {
    if (this.poll !== null) { clearInterval(this.poll); this.poll = null }
    if (this.heartbeat !== null) { clearInterval(this.heartbeat); this.heartbeat = null }
  }

  abandon(): void {
    this.ended = true
    this.stopTimers()
  }

  private report(err: unknown): void {
    this.options.onError(err instanceof Error ? err : new Error(String(err)))
    this.finish('error')
  }

  async open(): Promise<void> {
    this.write(`retry: ${RETRY_MS}\n\n`)
    this.heartbeat = setInterval(() => this.write(': keep-alive\n\n'), HEARTBEAT_INTERVAL_MS)
    try {
      await this.options.onOpen(this)
    } catch (err) {
      this.report(err)
      return
    }
    this.startPolling()
  }

  private startPolling(): void {
    const { onTick, intervalMs } = this.options
    if (!onTick || intervalMs === undefined) return
    this.poll = setInterval(async () => {
      if (this.ended) { this.stopTimers(); return }
      try {
        await onTick(this)
      } catch (err) {
        this.report(err)
      }
    }, intervalMs)
  }
}

/**
 * Server-Sent Events plumbing — single owner.
 *
 * Both the progress stream and the live dashboard stream use this, so the
 * heartbeat, the reconnection hint, the close handling and the disconnect
 * cleanup are written once rather than re-derived per endpoint.
 */
export function eventStream(options: EventStreamOptions): Response {
  let session: EventStreamSession | null = null
  const stream = new ReadableStream<Uint8Array>({
    async start(sink) {
      session = new EventStreamSession(sink, options)
      await session.open()
    },
    cancel() {
      session?.abandon()
    },
  })
  return new Response(stream, { headers: SSE_HEADERS })
}
