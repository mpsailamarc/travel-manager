// The browser's localStorage holds only about 5 MB per site. Most of it is the cache of free-service answers (routes,
// places, weather…), which can always be fetched again; your own things (pasted answers, settings) must never fail to
// save because the cache filled it. So when it's full, the oldest cached answers make room.

export const CACHE_PREFIX = 'tm-cache:'

const size = (k: string, v: string) => (k.length + v.length) * 2 // bytes: localStorage keeps UTF-16

/** Removes the oldest cached answers: at least `bytes`, and at least a quarter of the cache. Returns the bytes freed. */
export function freeCache(bytes = 0): number {
  const entries: { k: string; t: number; n: number }[] = []
  let total = 0
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k?.startsWith(CACHE_PREFIX)) continue
    const v = localStorage.getItem(k) ?? ''
    const t = Number(v.match(/^\{"t":(\d+)/)?.[1] ?? 0) // cached as {"t": when, "v": …}
    entries.push({ k, t, n: size(k, v) })
    total += size(k, v)
  }
  entries.sort((a, b) => a.t - b.t)
  const target = Math.max(bytes, total / 4)
  let freed = 0
  for (const e of entries) {
    if (freed >= target) break
    localStorage.removeItem(e.k)
    freed += e.n
  }
  return freed
}

/** Saves to localStorage, dropping old cached answers when it's full. False only when it still doesn't fit. */
export function saveLocal(key: string, value: string): boolean {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      localStorage.setItem(key, value)
      return true
    } catch {
      if (!freeCache(size(key, value))) return false
    }
  }
  return false
}
