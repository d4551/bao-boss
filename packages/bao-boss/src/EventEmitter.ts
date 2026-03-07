/**
 * Minimal EventEmitter implementation — no Node.js dependency.
 * Bun-native: uses only standard JS (Map, Array, Function).
 */
type Listener = (...args: unknown[]) => void

export class EventEmitter {
  private listeners = new Map<string, Listener[]>()

  on(event: string, listener: Listener): this {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
    return this
  }

  emit(event: string, ...args: unknown[]): boolean {
    const list = this.listeners.get(event)
    if (!list || list.length === 0) return false
    for (const fn of list) {
      try {
        fn(...args)
      } catch {
        // Swallow to match Node EventEmitter behavior
      }
    }
    return true
  }

  removeListener(event: string, listener: Listener): this {
    const list = this.listeners.get(event)
    if (!list) return this
    const idx = list.indexOf(listener)
    if (idx >= 0) list.splice(idx, 1)
    if (list.length === 0) this.listeners.delete(event)
    return this
  }

  off(event: string, listener: Listener): this {
    return this.removeListener(event, listener)
  }
}
