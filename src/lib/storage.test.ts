import { afterEach, describe, expect, it, vi } from 'vitest'
import { CACHE_PREFIX, saveLocal } from './storage'

/** A localStorage that holds only `limit` bytes, like a browser's 5 MB but smaller. */
function smallStorage(limit: number) {
  const m = new Map<string, string>()
  const used = () => [...m].reduce((s, [k, v]) => s + (k.length + v.length) * 2, 0)
  return {
    get length() {
      return m.size
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem(k: string, v: string) {
      const before = m.get(k)
      m.set(k, v)
      if (used() > limit) {
        if (before == null) m.delete(k)
        else m.set(k, before)
        throw new DOMException('quota', 'QuotaExceededError')
      }
    },
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
}

describe('saving when the storage is full', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('drops the oldest cached answers to keep what you pasted', () => {
    const store = smallStorage(10_000)
    vi.stubGlobal('localStorage', store)
    for (let t = 1; t <= 4; t++) store.setItem(`${CACHE_PREFIX}route:${t}`, JSON.stringify({ t, v: 'x'.repeat(1000) }))
    const answer = 'y'.repeat(2500)
    expect(saveLocal('tm-ideas2:trip', answer)).toBe(true)
    expect(store.getItem('tm-ideas2:trip')).toBe(answer)
    expect(store.getItem(`${CACHE_PREFIX}route:1`)).toBeNull() // the oldest went first
    expect(store.getItem(`${CACHE_PREFIX}route:4`)).not.toBeNull() // the newest stayed
  })

  it('says so, without failing, when something is too big even for an empty cache', () => {
    vi.stubGlobal('localStorage', smallStorage(1_000))
    expect(saveLocal('tm-ideas2:trip', 'y'.repeat(5000))).toBe(false)
  })
})
