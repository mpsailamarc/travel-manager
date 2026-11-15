import 'fake-indexeddb/auto'
import { afterEach, beforeEach, vi } from 'vitest'

// A small localStorage (the app caches free-service answers and keeps settings like the sync code there).
class MemoryStorage {
  private m = new Map<string, string>()
  get length() {
    return this.m.size
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v))
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
  clear() {
    this.m.clear()
  }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })

// No network in tests: free services "fail", so the offline fallbacks are used. A test can replace fetch to fake a server.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('no network in tests'))))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  localStorage.clear()
  const { db } = await import('../db')
  await Promise.all(db.tables.map((t) => t.clear()))
})
