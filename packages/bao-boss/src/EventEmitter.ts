/**
 * Minimal EventEmitter — no Node.js dependency.
 *
 * A listener that throws does not stop the other listeners, but the failure is
 * never discarded: it is re-emitted on `error`, and if the `error` listener
 * itself throws the exception is rethrown asynchronously so the runtime's
 * default handler reports it. Swallowing listener errors hides real bugs.
 */
export type Listener = (...args: never[]) => void

/** Event name reserved for surfacing failures, including a listener's own. */
export const ERROR_EVENT = 'error'

export class EventEmitter {
  private readonly listeners = new Map<string, Listener[]>()

  on(event: string, listener: Listener): this {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
    return this
  }

  once(event: string, listener: Listener): this {
    const wrapper = ((...args: never[]) => {
      this.removeListener(event, wrapper)
      listener(...args)
    }) as Listener
    return this.on(event, wrapper)
  }

  /** Returns whether any listener was invoked. */
  emit(event: string, ...args: unknown[]): boolean {
    // Copy first: a listener may add or remove listeners while we iterate.
    const list = this.listeners.get(event)
    if (!list || list.length === 0) return false
    for (const listener of [...list]) {
      this.invoke(event, listener, args)
    }
    return true
  }

  private invoke(event: string, listener: Listener, args: unknown[]): void {
    try {
      const call = listener as (...callArgs: unknown[]) => void
      call(...args)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      if (event === ERROR_EVENT) {
        // Reporting an error listener's failure through itself would loop.
        queueMicrotask(() => { throw error })
        return
      }
      this.emit(ERROR_EVENT, error)
    }
  }

  removeListener(event: string, listener: Listener): this {
    const list = this.listeners.get(event)
    if (!list) return this
    const index = list.indexOf(listener)
    if (index >= 0) list.splice(index, 1)
    if (list.length === 0) this.listeners.delete(event)
    return this
  }

  off(event: string, listener: Listener): this {
    return this.removeListener(event, listener)
  }

  removeAllListeners(event?: string): this {
    if (event === undefined) this.listeners.clear()
    else this.listeners.delete(event)
    return this
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0
  }
}
